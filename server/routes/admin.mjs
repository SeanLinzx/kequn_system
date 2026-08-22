import { Router } from "express";
import { pool } from "../db-mysql.mjs";
import { tables } from "../db.mjs";
import { authMiddleware, requireRole } from "../auth.mjs";
import { storeHealth } from "../services/funnel.mjs";

const router = Router();
router.use(authMiddleware);
router.use(requireRole("super_admin"));

router.get("/stats", async (_req, res) => {
  // 客群主库（MySQL）：品牌/门店/用户来自真实数据
  const [brands] = await pool.query("SELECT id, code, name FROM brand ORDER BY id");
  const [stores] = await pool.query(
    `SELECT s.id, s.code, s.name, s.brand_id, s.is_demo, b.code AS brand_code, b.name AS brand_name
     FROM store s LEFT JOIN brand b ON b.id = s.brand_id ORDER BY s.id`,
  );
  const [userRows] = await pool.query("SELECT COUNT(*) AS c FROM sys_user");
  const userCount = userRows[0]?.c || 0;

  const byBrand = new Map();
  for (const s of stores) {
    const key = s.brand_name || "未分组";
    if (!byBrand.has(key)) byBrand.set(key, { brand: key, storeCount: 0, stores: [] });
    const health = storeHealth(String(s.id));
    byBrand.get(key).stores.push({
      id: s.id,
      name: s.name,
      isReal: s.is_demo ? 0 : 1,
      health,
    });
    byBrand.get(key).storeCount += 1;
  }
  const brandDashboard = [...byBrand.values()];

  // 遗留演示功能（海报/任务/AI 用量）仍读 JSON，生产为空即显示"暂无数据"
  const logs = tables.ai_usage_logs.all();
  const aiMap = {};
  for (const l of logs) {
    if (!aiMap[l.action]) aiMap[l.action] = { action: l.action, count: 0, tokens: 0 };
    aiMap[l.action].count += 1;
    aiMap[l.action].tokens += l.tokens_est || 0;
  }
  const taskStats = {};
  for (const t of tables.tasks.all()) {
    taskStats[t.status] = (taskStats[t.status] || 0) + 1;
  }

  res.json({
    aiUsage: Object.values(aiMap),
    posterCount: tables.posters.all().length,
    taskStats: Object.entries(taskStats).map(([status, c]) => ({ status, c })),
    stores: stores.map((s) => ({ ...s, health: storeHealth(String(s.id)) })),
    brands: brandDashboard,
    userCount,
  });
});

router.get("/users", async (_req, res) => {
  const [users] = await pool.query(
    "SELECT id, email, name, role, created_at FROM sys_user ORDER BY id",
  );
  const [bindings] = await pool.query("SELECT user_id, store_id FROM sys_user_store");
  res.json({ users, bindings });
});

router.post("/trigger-hotspot", async (_req, res) => {
  const { runHotspotPush } = await import("../services/scheduler.mjs");
  await runHotspotPush();
  res.json({ ok: true, message: "热点推送已触发" });
});

export default router;
