import "./load-env.mjs";
import express from "express";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

import { initDb, seedDb } from "./db.mjs";
import { initMysql, pingMysql } from "./db-mysql.mjs";
import { pool } from "./db-mysql.mjs";
import { handleTunnelConnection } from "./services/tunnel-server.mjs";
import { handleSshConnection } from "./services/ssh-tunnel.mjs";
import { WebSocketServer } from "ws";
import { proxyArkImage } from "./services/ai.mjs";
import authRoutes from "./routes/auth.mjs";
import storeRoutes from "./routes/stores.mjs";
import solutionRoutes from "./routes/solutions.mjs";
import taskRoutes from "./routes/tasks.mjs";
import messageRoutes from "./routes/messages.mjs";
import posterRoutes from "./routes/posters.mjs";
import adminRoutes from "./routes/admin.mjs";
import executorRoutes from "./routes/executors.mjs";
import customerInsightRoutes from "./routes/customer-insight.mjs";
import hikRoutes from "./routes/hik.mjs";
import brandRoutes from "./routes/brands.mjs";
import deviceRoutes from "./routes/devices.mjs";
import siteTokenRoutes from "./routes/site-tokens.mjs";
import edgeRoutes from "./routes/edge.mjs";
import consoleRoutes from "./routes/consoles.mjs";
import releaseRoutes from "./routes/releases.mjs";
import userRoutes from "./routes/users.mjs";
import { ensureLayout } from "./services/releases.mjs";
const PUBLIC_DIR = join(__dirname, "..", "public");
const UPLOAD_DIR = join(PUBLIC_DIR, "uploads");

const PORT = Number(process.env.PORT || 3011);

initDb();
seedDb();
// 发布管理目录初始化（public/releases/camera-local-console，静态托管供安装脚本/客户端拉包）
ensureLayout();
// MySQL（客群数据主库）：启动时建表 + seed；失败仅告警，演示功能（JsonTable）仍可运行
initMysql()
  .then(() => console.log("MySQL schema + seed ready"))
  .catch((e) => console.error("MySQL init failed:", e.message));

const app = express();
// verify 回调捕获原始报文（边缘事件需要全文落库）
app.use(express.json({ limit: "10mb", verify: (req, _res, buf) => { req.rawBody = buf; } }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/api/health", async (_req, res) => {
  let mysql = "ok";
  try {
    await pingMysql();
  } catch {
    mysql = "down";
  }
  res.json({ ok: true, service: "fenqun-system", port: PORT, mysql });
});

app.use("/api/auth", authRoutes);
app.use("/api/stores", storeRoutes);
app.use("/api/solutions", solutionRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/posters", posterRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/executors", executorRoutes);
app.use("/api/customer", customerInsightRoutes);

// 边缘事件接收（保持旧协议，无鉴权）
app.use("/api/hik", hikRoutes);

// 门店安装短码兑换（免鉴权）：GET /api/install-code/:code → 返回注入 token 的安装脚本
// 现场执行：curl -fsSL https://<域名>/api/install-code/<短码> | sudo bash
app.get("/api/install-code/:code", async (req, res) => {
  try {
    const code = String(req.params.code || "").trim().toUpperCase();
    const [rows] = await pool.query(
      `SELECT t.token, s.name AS store_name FROM site_token t
       JOIN store s ON s.id = t.store_id
       WHERE t.install_code = ? AND t.install_code_expires_at IS NOT NULL
         AND t.install_code_expires_at > NOW(3) AND t.enabled = 1`,
      [code],
    );
    const hit = rows[0];
    if (!hit) {
      res.status(404).send("安装短码无效或已过期，请联系管理员重新生成");
      return;
    }
    // 一次性使用：兑换后立即失效
    await pool.query(
      "UPDATE site_token SET install_code = NULL, install_code_expires_at = NULL WHERE install_code = ?",
      [code],
    );
    // 读取安装脚本并注入 token（保持脚本逻辑不变，仅填 token）
    const script = readFileSync(join(__dirname, "..", "public", "install", "linux.sh"), "utf8");
    const serverUrl = process.env.TUNNEL_PUBLIC_URL || `https://${req.hostname}`;
    const injected = script
      .replace(/^TOKEN="\$\{1:-\}"/m, `TOKEN="${hit.token}"`)
      .replace(/^SERVER_URL="\$\{2:-[^}]*\}"/m, `SERVER_URL="${serverUrl.replace(/\/+$/, "")}"`);
    res.type("text/plain").send(`# 安装门店：${hit.store_name}\n# 短码已兑换，token 已注入\n${injected}`);
  } catch (e) {
    res.status(500).send("短码兑换失败：" + e.message);
  }
});

// 管理与注册（JWT / 接入令牌）
app.use("/api/brands", brandRoutes);
app.use("/api/devices", deviceRoutes);
app.use("/api/site-tokens", siteTokenRoutes);
app.use("/api/consoles", consoleRoutes);
app.use("/api/edge", edgeRoutes);
app.use("/api/releases", releaseRoutes);
app.use("/api/users", userRoutes);

// Ark image proxy for poster generation
app.use("/api/v3", (req, res) => {
  proxyArkImage(req, res);
});

// static uploads
if (existsSync(UPLOAD_DIR)) {
  app.use("/uploads", express.static(UPLOAD_DIR));
}

// 静态前端（本地部署单进程即可访问；生产可继续用 nginx 托管 public/ 并反代 API）
app.use(express.static(PUBLIC_DIR));

const server = app.listen(PORT, () => {
  console.log(`fenqun-system API: http://localhost:${PORT}/api/health`);
});

// WS 统一入口：/ws/tunnel（异地访问隧道）+ /ws/ssh（Web 终端）
// 注意：ws 库多个 WebSocketServer 挂同一 server 时，先注册的会把不匹配 path 的升级请求 400 abort，
// 因此用单个 wss 按路径分发
const wss = new WebSocketServer({ server });
wss.on("connection", (ws, req) => {
  const path = String(req.url || "").split("?")[0];
  if (path === "/ws/tunnel") handleTunnelConnection(ws, req);
  else if (path === "/ws/ssh") handleSshConnection(ws, req);
  else ws.close(4004, "unknown ws path");
});
