import { Router } from "express";
import { tables, sendMessage } from "../db.mjs";
import { authMiddleware, canAccessStoreSync, requireRole } from "../auth.mjs";
import { fetchWeiboHot, FALLBACK_HOT } from "../services/weibo.mjs";
import { searchHotWords } from "../services/hot-topics.mjs";
import { generateHotspotStrategy } from "../services/ai.mjs";
import { sendEmail, hotspotEmail, posterDoneEmail, siteLink } from "../services/email.mjs";
import { getXiaohongshuPicks } from "../services/xiaohongshu-agent.mjs";

const router = Router();
router.use(authMiddleware);

router.get("/xiaohongshu-picks", (req, res) => {
  const { storeId } = req.query;
  if (!storeId) return res.status(400).json({ error: "需要 storeId" });
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  try {
    res.json(getXiaohongshuPicks(storeId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/hot", async (req, res) => {
  try {
    const result = await searchHotWords({
      userId: req.user?.id,
      storeId: req.query.storeId,
      limit: 20,
    });
    res.json(result);
  } catch (e) {
    res.json({
      words: FALLBACK_HOT,
      source: "fallback",
      message: e.message || "热点检索失败",
    });
  }
});

router.get("/", (req, res) => {
  let rows = tables.posters.all();
  if (req.query.storeId) rows = rows.filter((p) => p.store_id === req.query.storeId);
  if (req.user.role === "ops_manager") {
    const ids = tables.user_stores.filter((x) => x.user_id === req.user.id).map((x) => x.store_id);
    rows = rows.filter((p) => ids.includes(p.store_id));
  }
  res.json({
    posters: rows
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 50)
      .map((p) => ({ ...p, strategy: p.strategy_json ? JSON.parse(p.strategy_json) : null })),
  });
});

router.post("/strategy", requireRole("super_admin", "ops_manager", "store_manager"), async (req, res) => {
  const { storeId, period, hotWords } = req.body || {};
  if (!storeId) return res.status(400).json({ error: "需要 storeId" });
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  const store = tables.stores.findOne((s) => s.id === storeId);
  let words = hotWords;
  if (!words?.length) {
    try {
      const hot = await searchHotWords({ userId: req.user.id, storeId, limit: 15 });
      words = hot.words;
    } catch {
      words = FALLBACK_HOT;
    }
  }
  try {
    const strategy = await generateHotspotStrategy({
      storeName: store.name,
      hotWords: words,
      period: period || "今日",
      userId: req.user.id,
      storeId,
    });
    res.json({ words, strategy });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.post("/", requireRole("super_admin", "ops_manager", "store_manager"), async (req, res) => {
  const { storeId, hotTopic, strategy, imageUrl } = req.body || {};
  if (!storeId) return res.status(400).json({ error: "需要 storeId" });
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  const r = tables.posters.insert({
    store_id: storeId,
    created_by: req.user.id,
    hot_topic: hotTopic || null,
    strategy_json: strategy ? JSON.stringify(strategy) : null,
    image_url: imageUrl || null,
    status: "done",
  });

  const store = tables.stores.findOne((s) => s.id === storeId);
  const user = tables.users.get(req.user.id);
  const link = siteLink("/ops.html#poster");
  sendMessage({
    userId: req.user.id,
    title: `海报已生成：${hotTopic || store.name}`,
    body: "您的促销海报已生成完成。",
    link,
  });
  if (user?.email) {
    const mail = posterDoneEmail({ storeName: store.name, imageUrl, link });
    await sendEmail({ to: user.email, ...mail });
  }
  res.json({ id: r.lastInsertRowid });
});

export default router;
