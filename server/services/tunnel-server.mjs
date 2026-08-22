// 隧道服务：门店控制台（camera-local-console）主动连入，管理员异地访问
// 协议：门店 WS 连 /ws/tunnel?token=<门店token> → 后端验证 → 自动分配端口 → 双向转发 HTTP
// 访问凭证：隧道端口要求 URL 前缀 /t/<tunnel_token>（管理面板展示完整 URL）
import { WebSocketServer } from "ws";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { pool } from "../db-mysql.mjs";

// 隧道端口段：33000-33999（避开服务器既有服务 31001、SSH 隧道 32000-32999、nginx 8443）
const TUNNEL_PORT_BASE = 33000;
const TUNNEL_PORT_MAX = 33999;
const HEARTBEAT_TIMEOUT_MS = 90_000;

const connections = new Map(); // tunnelPort -> { ws, storeId }
const portServers = new Map(); // tunnelPort -> http.Server
const portTokens = new Map(); // tunnelPort -> 当前访问凭证（重连时更新）
const reqMap = new Map(); // requestId -> { res, bodyChunks, timeout }
let reqSeq = 0;

/** 由 index.mjs 的统一 wss 按 /ws/tunnel 路径分发到此 */
export function handleTunnelConnection(ws, req) {
  handleConnection(ws, req);
}

/** 隧道诊断：当前活跃连接与端口服务器（供调试/管理接口用） */
export function tunnelDiagnostics() {
  const conns = [];
  for (const [port, c] of connections) {
    conns.push({
      port,
      storeId: c.storeId,
      wsState: c.ws?.readyState ?? -1, // 0=CONNECTING 1=OPEN 2=CLOSING 3=CLOSED
      isAlive: !!c.ws?.isAlive,
      token: portTokens.get(port) || null,
    });
  }
  return {
    connections: conns,
    portServers: [...portServers.keys()],
    portTokens: [...portTokens.keys()].map((p) => ({ port: p, hasToken: !!portTokens.get(p) })),
  };
}

function parseUrlQuery(url) {
  const q = new URL(url, "http://x");
  return q.searchParams;
}

async function handleConnection(ws, req) {
  const remote = req.socket?.remoteAddress || "?";
  const token = parseUrlQuery(req.url).get("token") || "";
  console.log(`[tunnel] 新连接 from=${remote} token=${token.slice(0, 8)}...`);
  const [rows] = await pool.query("SELECT * FROM site_token WHERE token = ? AND enabled = 1", [token]);
  const siteToken = rows[0];
  if (!siteToken) {
    console.log(`[tunnel] 连接被拒: token 无效 from=${remote}`);
    ws.close(4001, "invalid token");
    return;
  }
  if (siteToken.store_id == null) {
    console.log(`[tunnel] 连接被拒: 品牌 token 无门店 from=${remote}`);
    // 品牌 token 无法确定门店，隧道要求门店 token
    ws.close(4002, "store token required");
    return;
  }
  const storeId = siteToken.store_id;

  // 分配/复用隧道端口
  let tunnelPort = await findTunnelPort(storeId);
  if (!tunnelPort) {
    ws.close(4003, "no tunnel port available");
    return;
  }

  // upsert console_deployment 隧道字段
  const tunnelToken = randomBytes(12).toString("hex");
  try {
    await pool.query(
      `INSERT INTO console_deployment (store_id, console_id, name, ip_address, port, tunnel_port, tunnel_token, tunnel_last_seen)
       VALUES (?, ?, '', '', ?, ?, ?, NOW(3))
       ON DUPLICATE KEY UPDATE
         tunnel_port = VALUES(tunnel_port), tunnel_token = VALUES(tunnel_token), tunnel_last_seen = NOW(3)`,
      [storeId, String(siteToken.id), 3000, tunnelPort, tunnelToken],
    );
  } catch (e) {
    console.error(`[tunnel] upsert 失败 store=${storeId} err=${e.message}`);
    ws.close(4004, "db error");
    return;
  }

  connections.set(tunnelPort, { ws, storeId });
  portTokens.set(tunnelPort, tunnelToken);
  ensurePortServer(tunnelPort);

  console.log(`[tunnel] 隧道建立 store=${storeId} port=${tunnelPort} from=${remote}`);
  ws.send(JSON.stringify({ type: "ready", port: tunnelPort, token: tunnelToken }));
  ws.on("message", (data) => handleMessage(tunnelPort, data.toString("utf8")));
  ws.on("close", () => cleanup(tunnelPort, storeId));
  ws.on("error", () => cleanup(tunnelPort, storeId));
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  const hb = setInterval(async () => {
    if (!ws.isAlive) {
      ws.terminate();
      clearInterval(hb);
      return;
    }
    ws.isAlive = false;
    ws.ping();
    await pool.query("UPDATE console_deployment SET tunnel_last_seen = NOW(3) WHERE store_id = ?", [storeId]);
  }, 30_000);
  ws.hbTimer = hb;
}

async function findTunnelPort(storeId) {
  // 已有端口且未被占用则复用
  const [rows] = await pool.query("SELECT tunnel_port FROM console_deployment WHERE store_id = ? AND tunnel_port IS NOT NULL", [storeId]);
  if (rows[0]?.tunnel_port && !connections.has(rows[0].tunnel_port)) return rows[0].tunnel_port;
  for (let p = TUNNEL_PORT_BASE; p <= TUNNEL_PORT_MAX; p++) {
    if (!connections.has(p) && !portServers.has(p)) return p;
  }
  return null;
}

function ensurePortServer(tunnelPort) {
  if (portServers.has(tunnelPort)) return;
  const srv = http.createServer((req, res) => {
    const tunnelToken = portTokens.get(tunnelPort) || "";
    // 访问凭证：URL 前缀 /t/<token>/ 首次进入 → 种 HttpOnly cookie → 302 到无前缀路径；
    // 之后页面内绝对路径请求（/api/...、/assets/...）凭 cookie 通过
    const m = req.url.match(/^\/t\/([a-f0-9]+)\//);
    if (m) {
      if (m[1] !== tunnelToken) {
        res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("tunnel credential required");
        return;
      }
      const target = req.url.slice(m[0].length - 1) || "/";
      res.writeHead(302, {
        Location: target,
        "Set-Cookie": `tunnel_cred=${tunnelToken}; Path=/; HttpOnly; SameSite=Lax`,
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.tunnel_cred !== tunnelToken) {
      res.writeHead(401, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("tunnel credential required");
      return;
    }
    const conn = connections.get(tunnelPort);
    if (!conn || conn.ws.readyState !== conn.ws.OPEN) {
      res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("tunnel offline");
      return;
    }
    const id = ++reqSeq;
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      const payload = {
        type: "req", id,
        method: req.method,
        url: req.url,
        headers: filterHeaders(req.headers),
        body: body.length ? body.toString("base64") : "",
      };
      const timer = setTimeout(() => {
        reqMap.delete(id);
        res.writeHead(504); res.end("tunnel timeout");
      }, 30_000);
      reqMap.set(id, { res, timer });
      conn.ws.send(JSON.stringify(payload));
    });
  });
  // 绑定 127.0.0.1：公网访问由 nginx 同端口 TLS 转发（见 deploy/nginx-kequn.fenqunshuju.com.conf）
  srv.listen(tunnelPort, "127.0.0.1");
  portServers.set(tunnelPort, srv);
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function filterHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (["host", "content-length", "connection", "upgrade"].includes(k)) continue;
    out[k] = v;
  }
  return out;
}

async function handleMessage(tunnelPort, text) {
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  if (msg.type === "res") {
    const pending = reqMap.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    reqMap.delete(msg.id);
    pending.res.writeHead(msg.status || 500, msg.headers || {});
    pending.res.end(msg.body ? Buffer.from(msg.body, "base64") : "");
  }
}

function cleanup(tunnelPort, storeId) {
  const conn = connections.get(tunnelPort);
  if (conn) {
    clearInterval(conn.ws.hbTimer);
    connections.delete(tunnelPort);
  }
  const srv = portServers.get(tunnelPort);
  if (srv) {
    try { srv.close(); } catch {}
    portServers.delete(tunnelPort);
  }
  // 清空隧道状态（保留端口复用信息？直接清掉，下次重连重新分配）
  pool.query("UPDATE console_deployment SET tunnel_last_seen = NULL WHERE store_id = ?", [storeId]).catch(() => {});
}
