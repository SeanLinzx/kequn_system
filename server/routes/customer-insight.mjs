import { Router } from "express";
import { authMiddleware, canAccessStoreSync } from "../auth.mjs";
import {
  getCustomerMatrix,
  getAgeSex,
  getTimePeak,
  getFlowTrend,
} from "../services/customer-insight.mjs";

const router = Router();
router.use(authMiddleware);

router.get("/matrix", (req, res) => {
  const { storeId } = req.query;
  if (!storeId) return res.status(400).json({ error: "需要 storeId" });
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) return res.status(403).json({ error: "无权限" });
  res.json(getCustomerMatrix(storeId));
});

router.get("/age-sex", (req, res) => {
  const { storeId } = req.query;
  if (!storeId) return res.status(400).json({ error: "需要 storeId" });
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) return res.status(403).json({ error: "无权限" });
  res.json(getAgeSex(storeId));
});

router.get("/time-peak", (req, res) => {
  const { storeId, start, end } = req.query;
  if (!storeId) return res.status(400).json({ error: "需要 storeId" });
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) return res.status(403).json({ error: "无权限" });
  try {
    res.json(getTimePeak(storeId, start, end));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/flow-trend", (req, res) => {
  const { storeId, start, end } = req.query;
  if (!storeId) return res.status(400).json({ error: "需要 storeId" });
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) return res.status(403).json({ error: "无权限" });
  try {
    res.json(getFlowTrend(storeId, start, end));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
