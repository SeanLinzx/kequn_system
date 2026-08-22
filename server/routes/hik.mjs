// 边缘事件接收接口（保持旧协议兼容）
// 约定：始终返回 { code: 200, message: "操作成功", data: null }，处理失败也返回 200（避免边缘重试风暴）
import { Router } from "express";
import { ingestPeopleCounting, ingestHumanBody } from "../services/hik-ingest.mjs";

const router = Router();
const OK = { code: 200, message: "操作成功", data: null };

async function handle(req, res, ingest) {
  try {
    const rawBody = req.rawBody ? req.rawBody.toString("utf8") : null;
    const token = String(req.headers["x-access-token"] || "").trim() || null;
    await ingest(req.body, rawBody, token);
  } catch (e) {
    // 解析/落库失败：记录错误但依然返回 200
    console.error("hik ingest error:", e.message);
  }
  res.json(OK);
}

// 客流统计（ability=event_pdc）
router.post("/eventRcv", (req, res) => handle(req, res, ingestPeopleCounting));

// 人体属性/人像（ability=event_body）
router.post("/eventRtbw", (req, res) => handle(req, res, ingestHumanBody));

export default router;
