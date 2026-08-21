import { request as httpsRequest } from "node:https";
import { logAiUsage } from "../db.mjs";
import { parseAiArray, parseAiObject } from "../lib/ai-json.mjs";
import { SOLUTION_SYSTEM, HOTSPOT_STRATEGY_SYSTEM } from "../prompts.mjs";

const ARK_HOST = "ark.cn-beijing.volces.com";
const ARK_ORIGIN = `https://${ARK_HOST}`;
const API_KEY = process.env.ARK_API_KEY || "";
const TEXT_MODEL = process.env.ARK_TEXT_MODEL || "doubao-seed-2-0-pro-260215";

function arkRequest(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = httpsRequest(
      {
        hostname: ARK_HOST,
        port: 443,
        path,
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          try {
            resolve({ status: res.statusCode, data: JSON.parse(text), raw: text });
          } catch {
            resolve({ status: res.statusCode, data: null, raw: text });
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(120000, () => {
      req.destroy();
      reject(new Error("AI 请求超时"));
    });
    req.write(payload);
    req.end();
  });
}

export function extractText(data) {
  if (!data) return "";
  if (data.output_text) return data.output_text;
  if (Array.isArray(data.output)) {
    return data.output
      .flatMap((item) => {
        if (item.type !== "message" || !Array.isArray(item.content)) return [];
        return item.content
          .filter((c) => (c.type === "output_text" || c.type === "text") && c.text)
          .map((c) => c.text);
      })
      .join("\n");
  }
  return data.choices?.[0]?.message?.content || "";
}

export async function callAI({ input, tools, userId, storeId, action }) {
  const body = { model: TEXT_MODEL, input };
  if (tools) body.tools = tools;
  const result = await arkRequest("/api/v3/responses", body);
  if (result.status >= 400) {
    throw new Error(result.data?.error?.message || result.raw || "AI 调用失败");
  }
  const text = extractText(result.data);
  logAiUsage({
    userId,
    storeId,
    action: action || "ai_call",
    model: TEXT_MODEL,
    tokensEst: Math.ceil(text.length / 2),
  });
  return text;
}

export async function generateSolutions({ diagnosis, riskFactor, userId, storeId }) {
  const factor = diagnosis.factors.find((f) => f.key === riskFactor) || diagnosis.factors[0];
  const user = `门店：${diagnosis.meta?.name || storeId}
时间段：${diagnosis.period.start} ~ ${diagnosis.period.end}
诊断摘要：${diagnosis.summary}
重点因子：${factor.name}，当前${factor.display || factor.current}，偏差${factor.pct?.toFixed?.(1) || factor.pct}%
请针对「${factor.name}」问题给出执行层解决方案。`;

  const text = await callAI({
    input: [
      { role: "system", content: SOLUTION_SYSTEM },
      { role: "user", content: user },
    ],
    userId,
    storeId,
    action: "generate_solutions",
  });

  const parsed = parseAiArray(text);
  if (parsed?.length) return parsed;

  return [
    {
      title: `${factor.name}改善方案`,
      owner: "门店店长",
      deadline: "本周内",
      steps: [text.slice(0, 500)],
      verifyPoints: ["拍照上传执行结果"],
    },
  ];
}

export async function generateHotspotStrategy({ storeName, hotWords, period, userId, storeId }) {
  const user = `门店：${storeName}
周期：${period}（今日/本周/本月）
热搜词：${hotWords.map((w) => w.kw).join("、")}
请给出3条营销策略建议，每条包含：话题结合方式、主推品类、时段建议、预期效果。
返回 JSON：{"strategies":[{"title":"","topic":"","categories":[],"timeSlot":"","actions":[],"expected":""}]}`;

  const text = await callAI({
    input: [
      { role: "system", content: HOTSPOT_STRATEGY_SYSTEM },
      { role: "user", content: user },
    ],
    userId,
    storeId,
    action: "hotspot_strategy",
  });

  const parsed = parseAiObject(text);
  if (parsed) return parsed;

  return { strategies: [{ title: "热点营销", topic: hotWords[0]?.kw, actions: [text] }] };
}

export async function proxyArkImage(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  return new Promise((resolve) => {
    const upstream = httpsRequest(
      {
        hostname: ARK_HOST,
        port: 443,
        path: "/api/v3" + (req.url.startsWith("/") ? req.url : "/" + req.url),
        method: req.method,
        headers: {
          Authorization: req.headers.authorization || `Bearer ${API_KEY}`,
          "Content-Type": req.headers["content-type"] || "application/json",
          "Content-Length": body.length,
        },
      },
      (upstreamRes) => {
        const parts = [];
        upstreamRes.on("data", (c) => parts.push(c));
        upstreamRes.on("end", () => {
          res.status(upstreamRes.statusCode || 502);
          res.setHeader("Content-Type", upstreamRes.headers["content-type"] || "application/json");
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.end(Buffer.concat(parts));
          resolve();
        });
      },
    );
    upstream.on("error", () => {
      res.status(502).json({ error: "Ark proxy failed" });
      resolve();
    });
    upstream.setTimeout(300000, () => {
      upstream.destroy();
      if (!res.headersSent) res.status(504).json({ error: "timeout" });
      resolve();
    });
    if (body.length) upstream.write(body);
    upstream.end();
  });
}

export { TEXT_MODEL, ARK_ORIGIN };
