import { Router } from "express";
import { tables } from "../db.mjs";
import { authMiddleware, requireRole } from "../auth.mjs";
import { storeHealth } from "../services/funnel.mjs";

const router = Router();
router.use(authMiddleware);
router.use(requireRole("super_admin"));

router.get("/stats", (_req, res) => {
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
  const stores = tables.stores.all().sort((a, b) => b.is_real - a.is_real);
  res.json({
    aiUsage: Object.values(aiMap),
    posterCount: tables.posters.all().length,
    taskStats: Object.entries(taskStats).map(([status, c]) => ({ status, c })),
    stores: stores.map((s) => ({ ...s, health: storeHealth(s.id) })),
    userCount: tables.users.all().length,
  });
});

router.get("/brand-dashboard", (_req, res) => {
  const stores = tables.stores.all();
  const byBrand = {};
  for (const s of stores) {
    const brand = s.brand || "未分组";
    if (!byBrand[brand]) byBrand[brand] = [];
    byBrand[brand].push(s);
  }
  const brands = Object.entries(byBrand).map(([brand, list]) => ({
    brand,
    storeCount: list.length,
    stores: list.map((s) => ({
      id: s.id,
      name: s.name,
      isReal: s.is_real,
      health: storeHealth(s.id),
    })),
  }));
  res.json({ brandCount: brands.length, storeCount: stores.length, brands });
});

router.get("/users", (_req, res) => {
  res.json({
    users: tables.users.all().map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      created_at: u.created_at,
    })),
    bindings: tables.user_stores.all().map((b) => ({
      user_id: b.user_id,
      store_id: b.store_id,
    })),
  });
});

router.post("/trigger-hotspot", async (_req, res) => {
  const { runHotspotPush } = await import("../services/scheduler.mjs");
  await runHotspotPush();
  res.json({ ok: true, message: "热点推送已触发" });
});

export default router;
