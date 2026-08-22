import { Router } from "express";
import { authMiddleware, canAccessStoreSync } from "../auth.mjs";
import {
  getCustomerReport,
  getCustomerMatrix,
  getCustomerAgeSex,
  getCustomerTimePeak,
  getCustomerFlowTrend,
  getCustomerRange,
} from "../services/customer-insight.mjs";

const router = Router();
router.use(authMiddleware);

/** 参数校验：storeId 必填；start/end 可省（缺省=全部范围） */
function parseRange(req) {
  const { storeId, start, end } = req.query;
  if (!storeId) return { error: "需要 storeId" };
  const s = start || "1970-01-01";
  const e = end || "2099-12-31";
  return { storeId, start: s, end: e };
}

async function handle(req, res, fn) {
  const { error, storeId, start, end } = parseRange(req);
  if (error) return res.status(400).json({ error });
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  try {
    res.json(await fn(storeId, start, end));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

// 综合报告
router.get("/report", (req, res) => handle(req, res, getCustomerReport));

// 客群矩阵
router.get("/matrix", (req, res) => handle(req, res, getCustomerMatrix));

// 年龄性别/人群结构
router.get("/age-sex", (req, res) => handle(req, res, getCustomerAgeSex));

// 时段高峰
router.get("/time-peak", (req, res) => handle(req, res, getCustomerTimePeak));

// 客流趋势
router.get("/flow-trend", (req, res) => handle(req, res, getCustomerFlowTrend));

// 数据可用范围（日期选择器）
router.get("/range", async (req, res) => {
  const { storeId } = req.query;
  if (!storeId) return res.status(400).json({ error: "需要 storeId" });
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  try {
    res.json(await getCustomerRange(storeId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
