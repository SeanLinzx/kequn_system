import "../load-env.mjs";
import crypto from "node:crypto";
import { request as httpsRequest } from "node:https";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tables } from "../db.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKEN_PATH = join(__dirname, "..", "..", "data", ".yly_token.json");

const API_BASE = process.env.YLY_API_BASE || "https://open-api.10ss.net";
const API_HOST = new URL(API_BASE).hostname;
const API_PREFIX = new URL(API_BASE).pathname.replace(/\/$/, "");
const CLIENT_ID = process.env.YLY_CLIENT_ID || "";
const CLIENT_SECRET = process.env.YLY_CLIENT_SECRET || "";
export const DEFAULT_MACHINE_CODE = process.env.YLY_DEFAULT_MACHINE_CODE || "4004904861";

function md5(s) {
  return crypto.createHash("md5").update(s).digest("hex");
}

function uuid() {
  return crypto.randomBytes(16).toString("hex");
}

export function isPrinterConfigured() {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

export function getStorePrinterCode(storeId) {
  const store = tables.stores.get(storeId);
  return store?.printer_machine_code || DEFAULT_MACHINE_CODE;
}

export function setStorePrinterCode(storeId, machineCode) {
  const code = String(machineCode || "").trim();
  if (!/^\d{8,12}$/.test(code)) {
    throw new Error("终端号须为 8～12 位数字");
  }
  const store = tables.stores.get(storeId);
  if (!store) throw new Error("门店不存在");
  tables.stores.update(storeId, { printer_machine_code: code });
  return code;
}

export function formatTaskTicket({
  storeName,
  title,
  brief,
  steps = [],
  deadline,
  verifyPoints = [],
}) {
  const lines = [
    "【分群数据·执行策略】",
    `门店：${storeName || "—"}`,
    `任务：${title || "—"}`,
    `时限：${deadline || "尽快"}`,
    "----------------",
  ];
  if (brief) {
    lines.push("目标：", brief, "");
  }
  if (steps.length) {
    lines.push("执行步骤：");
    steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push("");
  }
  if (verifyPoints.length) {
    lines.push("验收点：");
    verifyPoints.forEach((v) => lines.push(`✓ ${v}`));
    lines.push("");
  }
  lines.push("请登录执行者台完成任务并上传照片");
  lines.push(`打印时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`);
  let text = lines.join("\n");
  if (text.length > 5000) text = text.slice(0, 5000);
  return text;
}

function loadToken() {
  if (!existsSync(TOKEN_PATH)) return null;
  try {
    return JSON.parse(readFileSync(TOKEN_PATH, "utf8"));
  } catch {
    return null;
  }
}

function saveToken(token) {
  const dir = dirname(TOKEN_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(TOKEN_PATH, JSON.stringify({ access_token: token, ts: Date.now() }), "utf8");
}

function ylyHttpsPost(path, formBody, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const body = typeof formBody === "string" ? formBody : new URLSearchParams(formBody).toString();
    const req = httpsRequest(
      {
        hostname: API_HOST,
        port: 443,
        path: `${API_PREFIX}${path}`,
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error(`易联云返回非 JSON (HTTP ${res.statusCode}): ${text.slice(0, 200)}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error("易联云请求超时"));
    });
    req.write(body);
    req.end();
  });
}

async function refreshToken(force = false) {
  if (!isPrinterConfigured()) {
    throw new Error("易联云打印未配置，请在服务器 .env 设置 YLY_CLIENT_ID / YLY_CLIENT_SECRET");
  }
  const cached = loadToken();
  if (!force && cached?.access_token && Date.now() - (cached.ts || 0) < 20 * 3600 * 1000) {
    return cached.access_token;
  }
  const ts = String(Math.floor(Date.now() / 1000));
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "client_credentials",
    scope: "all",
    sign: md5(CLIENT_ID + ts + CLIENT_SECRET),
    timestamp: ts,
    id: uuid(),
  });
  const resp = await ylyHttpsPost("/oauth/oauth", body.toString(), 30000);
  if (resp.error !== "0" && resp.error !== 0) {
    throw new Error(`易联云 token 获取失败: ${JSON.stringify(resp)}`);
  }
  const token = resp.body?.access_token;
  if (!token) throw new Error("易联云 access_token 为空");
  saveToken(token);
  return token;
}

async function ylyPost(path, payload, timeoutMs = 60000) {
  return ylyHttpsPost(path, payload, timeoutMs);
}

async function signedPayload(extra, machineCode) {
  const token = await refreshToken();
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    client_id: CLIENT_ID,
    access_token: token,
    machine_code: machineCode || DEFAULT_MACHINE_CODE,
    sign: md5(CLIENT_ID + ts + CLIENT_SECRET),
    timestamp: ts,
    id: uuid(),
    ...extra,
  };
}

export async function printText(content, machineCode, retry = true) {
  const payload = await signedPayload(
    { content, origin_id: uuid().slice(0, 28) },
    machineCode,
  );
  const resp = await ylyPost("/print/index", payload, 30000);
  if (String(resp.error) === "18" && retry) {
    await refreshToken(true);
    return printText(content, machineCode, false);
  }
  if (String(resp.error) !== "0") {
    throw new Error(`易联云文本打印失败: ${JSON.stringify(resp)}`);
  }
  return resp.body || resp;
}

export async function printTaskToStore(storeId, task) {
  const store = tables.stores.get(storeId);
  const machineCode = getStorePrinterCode(storeId);
  const content = formatTaskTicket({
    storeName: store?.name,
    title: task.title,
    brief: task.brief,
    steps: task.steps,
    deadline: task.deadline,
    verifyPoints: task.verifyPoints,
  });
  const order = await printText(content, machineCode);
  return { machineCode, order, content };
}

export async function printTestTicket(storeId) {
  const store = tables.stores.get(storeId);
  return printTaskToStore(storeId, {
    title: "小票机联通测试",
    brief: "若您看到本张测试小票，说明门店打印机配置正确。",
    steps: ["检查打印清晰度", "确认终端号与门店匹配", "可开始接收策略推送"],
    deadline: "—",
    verifyPoints: [],
  });
}
