// 反向 SSH 隧道（A 方案）：门店 autossh 把 22 端口反向映射到总部，管理面板 Web 终端运维
// 密钥策略：
//   总部→门店：ssh-setup 时生成 ed25519 私钥（存 server/data/ssh-keys/<consoleId>.key），公钥交给安装脚本加入门店 authorized_keys
//   门店→总部：安装脚本本地生成密钥，公钥经 ssh-pubkey 上报，加入总部 fenqun-tunnel 用户的 authorized_keys
import { Client } from "ssh2";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { pool } from "../db-mysql.mjs";
import { verifyToken, canAccessStore } from "../auth.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SSH_PORT_BASE = 32000;
const SSH_PORT_MAX = 32999;
const KEYS_DIR = join(__dirname, "..", "data", "ssh-keys");

const GATEWAY_USER = process.env.SSH_TUNNEL_GATEWAY_USER || "fenqun-tunnel"; // 门店 autossh 登录总部的用户
const TERMINAL_USER = process.env.SSH_TUNNEL_USER || "root"; // Web 终端连门店使用的用户
const AUTHORIZED_KEYS = process.env.SSH_AUTHORIZED_KEYS_FILE || join(os.homedir(), ".ssh", "authorized_keys");

function sshKeyPath(storeId) {
  return join(KEYS_DIR, `store-${String(storeId).replace(/[^0-9a-zA-Z_-]/g, "_")}.key`);
}

async function findSshPort(storeId) {
  const [rows] = await pool.query(
    "SELECT ssh_port FROM console_deployment WHERE store_id = ? AND ssh_port IS NOT NULL",
    [storeId],
  );
  if (rows[0]?.ssh_port) return rows[0].ssh_port;
  const [used] = await pool.query(
    "SELECT ssh_port FROM console_deployment WHERE ssh_port IS NOT NULL",
  );
  const usedSet = new Set(used.map((r) => r.ssh_port));
  for (let p = SSH_PORT_BASE; p <= SSH_PORT_MAX; p++) {
    if (!usedSet.has(p)) return p;
  }
  return null;
}

/** 生成总部→门店密钥对（ssh-keygen 产出 OpenSSH 格式，ssh2/authorized_keys 均兼容），分配 ssh_port */
export async function setupSsh(storeId, consoleId) {
  fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
  const keyPath = sshKeyPath(storeId);
  let privateKey;
  let publicKey;
  if (fs.existsSync(keyPath)) {
    privateKey = fs.readFileSync(keyPath, "utf8");
    publicKey = fs.existsSync(keyPath + ".pub") ? fs.readFileSync(keyPath + ".pub", "utf8").trim() : "";
  } else {
    execSync(`ssh-keygen -t ed25519 -f "${keyPath}" -N "" -C "fenqun-store-${storeId}"`, { stdio: "ignore" });
    privateKey = fs.readFileSync(keyPath, "utf8");
    publicKey = fs.readFileSync(keyPath + ".pub", "utf8").trim();
  }
  const sshPort = await findSshPort(storeId);
  if (!sshPort) throw new Error("SSH 端口池已满");
  await pool.query(
    `INSERT INTO console_deployment (store_id, ssh_port, console_id) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE ssh_port = VALUES(ssh_port), console_id = IF(VALUES(console_id) = '', console_id, VALUES(console_id))`,
    [storeId, sshPort, String(consoleId || "")],
  );
  return { sshPort, publicKey, gatewayUser: GATEWAY_USER };
}

/** 登记门店→总部公钥：追加到总部 fenqun-tunnel 用户的 authorized_keys（去重） */
export async function registerSshPubkey(storeId, publicKey) {
  const key = String(publicKey || "").trim();
  if (!key || !/^(ssh-ed25519|ssh-rsa|ecdsa-)/.test(key)) {
    throw new Error("无效的公钥格式");
  }
  fs.mkdirSync(path.dirname(AUTHORIZED_KEYS), { recursive: true, mode: 0o700 });
  let content = "";
  if (fs.existsSync(AUTHORIZED_KEYS)) content = fs.readFileSync(AUTHORIZED_KEYS, "utf8");
  if (content.includes(key.split(" ")[1] || key)) return { ok: true, added: false };
  fs.appendFileSync(AUTHORIZED_KEYS, `${key}\n`, { mode: 0o600 });
  return { ok: true, added: true };
}

/** 探测 SSH 隧道是否在线（TCP 连 127.0.0.1:ssh_port），并刷新 ssh_last_seen */
export async function probeSsh(storeId) {
  const [rows] = await pool.query(
    "SELECT ssh_port, console_id FROM console_deployment WHERE store_id = ? AND ssh_port IS NOT NULL",
    [storeId],
  );
  if (!rows[0]) return { online: false, port: null };
  const { ssh_port: port } = rows[0];
  const online = await tcpProbe(port);
  if (online) {
    await pool.query("UPDATE console_deployment SET ssh_last_seen = NOW(3) WHERE store_id = ?", [storeId]);
  }
  return { online, port };
}

function tcpProbe(port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    let done = false;
    const finish = (ok) => { if (!done) { done = true; sock.destroy(); resolve(ok); } };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}

/** Web SSH 终端：/ws/ssh?token=<JWT>，消息 {type:'connect'|'in'|'resize', storeId, cols, rows, data}
 *  由 index.mjs 的统一 wss 按路径分发到此 */
export function handleSshConnection(ws, req) {
  return handleSsh(ws, req);
}

function parseToken(url) {
  const q = new URL(url, "http://x");
  return q.searchParams.get("token") || "";
}

async function handleSsh(ws, req) {
  const token = parseToken(req.url);
  let user;
  try {
    user = verifyToken(token);
  } catch {
    ws.close(4001, "unauthorized");
    return;
  }
  let conn = null;
  let stream = null;
  ws.on("message", async (data) => {
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    if (msg.type === "connect") {
      const storeId = msg.storeId;
      if (!(await canAccessStore(user.id, user.role, storeId))) {
        ws.send(JSON.stringify({ type: "error", message: "无权限" }));
        return;
      }
      const [rows] = await pool.query(
        "SELECT ssh_port FROM console_deployment WHERE store_id = ? AND ssh_port IS NOT NULL",
        [storeId],
      );
      if (!rows[0]) {
        ws.send(JSON.stringify({ type: "error", message: "该门店未启用 SSH 隧道（请先运行安装脚本）" }));
        return;
      }
      const keyPath = sshKeyPath(storeId);
      if (!fs.existsSync(keyPath)) {
        ws.send(JSON.stringify({ type: "error", message: "总部密钥缺失" }));
        return;
      }
      const client = new Client();
      conn = client;
      client.on("ready", () => {
        ws.send(JSON.stringify({ type: "ready" }));
        client.shell({ cols: msg.cols || 120, rows: msg.rows || 32 }, (err, sh) => {
          if (err) { ws.send(JSON.stringify({ type: "error", message: err.message })); return; }
          stream = sh;
          sh.on("data", (chunk) => {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: "out", data: chunk.toString("base64") }));
            }
          });
          sh.on("close", () => { try { ws.close(); } catch {} });
        });
      });
      client.on("error", (e) => {
        ws.send(JSON.stringify({ type: "error", message: `SSH 连接失败：${e.message}` }));
        try { ws.close(); } catch {}
      });
      client.connect({
        host: "127.0.0.1",
        port: rows[0].ssh_port,
        username: TERMINAL_USER,
        privateKey: fs.readFileSync(keyPath, "utf8"),
        readyTimeout: 10_000,
      });
    } else if (msg.type === "in" && stream) {
      stream.write(Buffer.from(msg.data || "", "base64"));
    } else if (msg.type === "resize" && stream) {
      stream.setWindow(msg.rows || 32, msg.cols || 120);
    }
  });
  ws.on("close", () => {
    if (stream) { try { stream.end(); } catch {} }
    if (conn) { try { conn.end(); } catch {} }
  });
}
