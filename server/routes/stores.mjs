import { Router } from "express";
import { pool } from "../db-mysql.mjs";
import { authMiddleware, canAccessStore, getUserStores, requireRole } from "../auth.mjs";
import { diagnose, storeHealth, loadPromoContext } from "../services/funnel.mjs";
import { getStoreDashboard } from "../services/dashboard.mjs";
import { getTargets, setTarget } from "../services/targets.mjs";
import { buildStoreCompareRows } from "../services/store-compare.mjs";
import { getMarginCost } from "../services/margin-cost.mjs";
import {
  getTransformationAdvice,
  compareTransformation,
  getClosureAssessment,
  compareClosure,
} from "../services/transformation-advisor.mjs";
import { buildDiagnosisReport } from "../services/report-builder.mjs";
import { sendDiagnosisReportNow } from "../services/scheduler.mjs";
import {
  getStorePrinterCode,
  setStorePrinterCode,
  printTestTicket,
  isPrinterConfigured,
  DEFAULT_MACHINE_CODE,
} from "../services/printer.mjs";
import { getCustomerRange } from "../services/customer-insight.mjs";

const router = Router();
router.use(authMiddleware);

/**
 * 解析门店（MySQL）：权限校验 + 返回门店行（含 code）。
 * 失败时已写响应并返回 null。
 */
async function resolveStore(req, res) {
  const storeId = req.params.storeId;
  if (!(await canAccessStore(req.user.id, req.user.role, storeId))) {
    res.status(403).json({ error: "无权限" });
    return null;
  }
  const [rows] = await pool.query("SELECT * FROM store WHERE id = ?", [storeId]);
  if (!rows[0]) {
    res.status(404).json({ error: "门店不存在" });
    return null;
  }
  return rows[0];
}

router.get("/", async (req, res) => {
  let stores = await getUserStores(req.user.id, req.user.role);
  // 按品牌过滤（可选）
  const brandId = req.query.brandId;
  if (brandId) stores = stores.filter((s) => String(s.brand_id) === String(brandId));
  if (!stores.length) return res.json({ stores: [] });
  const ids = stores.map((s) => s.id);
  // 品牌名 + 门店令牌
  const [brands] = await pool.query(
    `SELECT id, name FROM brand WHERE id IN (${[...new Set(stores.map((s) => s.brand_id).filter(Boolean))].map(() => "?").join(",")})`,
    [...new Set(stores.map((s) => s.brand_id).filter(Boolean))],
  );
  const brandNameById = Object.fromEntries(brands.map((b) => [b.id, b.name]));
  const [tokens] = await pool.query(
    `SELECT store_id, token FROM site_token WHERE store_id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  const tokenByStore = Object.fromEntries(tokens.map((t) => [t.store_id, t.token]));
  res.json({
    stores: stores.map((s) => ({
      ...s,
      brand: brandNameById[s.brand_id] || null,
      token: tokenByStore[s.id] || null,
    })),
  });
});

// 创建门店（super_admin）
router.post("/", requireRole("super_admin"), async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: "需要 name" });
  const code = b.code ? String(b.code).trim() : `st-${Date.now().toString(36)}`;
  try {
    if (b.brandId != null) {
      const [brands] = await pool.query("SELECT id FROM brand WHERE id = ?", [b.brandId]);
      if (!brands[0]) return res.status(400).json({ error: "品牌不存在" });
    }
    const [result] = await pool.query(
      `INSERT INTO store (code, name, brand_id, location, business_hours, is_demo) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        code,
        String(b.name),
        b.brandId != null ? b.brandId : null,
        String(b.location || ""),
        String(b.businessHours || ""),
        b.isDemo ? 1 : 0,
      ],
    );
    // 创建门店时自动生成门店 token
    const token = (await import("node:crypto")).randomBytes(24).toString("hex");
    await pool.query("INSERT INTO site_token (token, name, store_id) VALUES (?, ?, ?)", [
      token, `${String(b.name)}门店令牌`, result.insertId,
    ]);
    const [rows] = await pool.query("SELECT * FROM store WHERE id = ?", [result.insertId]);
    res.json({ store: { ...rows[0], is_real: rows[0].is_demo ? 0 : 1, token } });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return res.status(400).json({ error: "门店编码已存在" });
    res.status(500).json({ error: e.message });
  }
});

// 编辑门店（super_admin）
router.put("/:storeId", requireRole("super_admin"), async (req, res) => {
  const b = req.body || {};
  const sets = [];
  const params = [];
  const fields = { name: "name", code: "code", location: "location", businessHours: "business_hours" };
  for (const [k, col] of Object.entries(fields)) {
    if (b[k] !== undefined) { sets.push(`${col} = ?`); params.push(String(b[k])); }
  }
  if (b.brandId !== undefined) { sets.push("brand_id = ?"); params.push(b.brandId != null ? b.brandId : null); }
  if (b.isDemo !== undefined) { sets.push("is_demo = ?"); params.push(b.isDemo ? 1 : 0); }
  if (b.status !== undefined) { sets.push("status = ?"); params.push(b.status ? 1 : 0); }
  if (!sets.length) return res.status(400).json({ error: "没有可更新的字段" });
  params.push(req.params.storeId);
  try {
    const [result] = await pool.query(`UPDATE store SET ${sets.join(", ")} WHERE id = ?`, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: "门店不存在" });
    const [rows] = await pool.query("SELECT * FROM store WHERE id = ?", [req.params.storeId]);
    res.json({ store: { ...rows[0], is_real: rows[0].is_demo ? 0 : 1 } });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return res.status(400).json({ error: "门店编码已存在" });
    res.status(500).json({ error: e.message });
  }
});

// 删除门店（super_admin；有设备则拒绝；同步删除门店 token）
router.delete("/:storeId", requireRole("super_admin"), async (req, res) => {
  try {
    const [devices] = await pool.query("SELECT COUNT(*) AS c FROM camera_device WHERE store_id = ?", [req.params.storeId]);
    if (devices[0].c > 0) {
      return res.status(400).json({ error: `该门店下有 ${devices[0].c} 台设备，请先移除设备` });
    }
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("DELETE FROM site_token WHERE store_id = ?", [req.params.storeId]);
      const [result] = await conn.query("DELETE FROM store WHERE id = ?", [req.params.storeId]);
      await conn.commit();
      if (result.affectedRows === 0) return res.status(404).json({ error: "门店不存在" });
    } finally {
      conn.release();
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 门店元信息 + 数据可用日期范围（真实数据来自 MySQL 聚合；promo 来自演示 context）
router.get("/:storeId/meta", async (req, res) => {
  const store = await resolveStore(req, res);
  if (!store) return;
  try {
    const { range } = await getCustomerRange(store.id);
    const promo = loadPromoContext(store.code) || null;
    const [tokens] = await pool.query("SELECT token FROM site_token WHERE store_id = ?", [store.id]);
    res.json({
      meta: {
        id: store.id,
        code: store.code,
        name: store.name,
        brandId: store.brand_id,
        location: store.location,
        isDemo: store.is_demo === 1,
        boundAt: store.bound_at,
        token: tokens[0]?.token || null,
      },
      range: range || { lo: null, hi: null },
      promo,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/:storeId/diagnose", async (req, res) => {
  const store = await resolveStore(req, res);
  if (!store) return;
  const { start, end } = req.body || {};
  if (!start || !end) return res.status(400).json({ error: "需要 start 和 end" });
  try {
    res.json(diagnose(store.code, start, end));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/:storeId/dashboard", async (req, res) => {
  const store = await resolveStore(req, res);
  if (!store) return;
  try {
    res.json(getStoreDashboard(store.code));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/:storeId/printer", async (req, res) => {
  const store = await resolveStore(req, res);
  if (!store) return;
  res.json({
    storeId: store.id,
    machineCode: getStorePrinterCode(store.code),
    defaultMachineCode: DEFAULT_MACHINE_CODE,
    configured: isPrinterConfigured(),
  });
});

router.put("/:storeId/printer", requireRole("super_admin", "ops_manager", "store_manager"), async (req, res) => {
  const store = await resolveStore(req, res);
  if (!store) return;
  try {
    const code = setStorePrinterCode(store.code, req.body?.machineCode);
    res.json({ ok: true, storeId: store.id, machineCode: code });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/:storeId/printer/test", requireRole("super_admin", "ops_manager", "store_manager"), async (req, res) => {
  const store = await resolveStore(req, res);
  if (!store) return;
  try {
    const r = await printTestTicket(store.code);
    res.json({ ok: true, machineCode: r.machineCode, order: r.order });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.get("/:storeId/health", async (req, res) => {
  const store = await resolveStore(req, res);
  if (!store) return;
  try {
    res.json(storeHealth(store.code));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/:storeId/targets", async (req, res) => {
  const store = await resolveStore(req, res);
  if (!store) return;
  try {
    res.json({ storeId: store.id, targets: getTargets(store.code) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put("/:storeId/targets", requireRole("super_admin", "ops_manager", "store_manager"), async (req, res) => {
  const store = await resolveStore(req, res);
  if (!store) return;
  const { periodType, value } = req.body || {};
  try {
    const targets = setTarget(store.code, periodType, value, req.user.id);
    res.json({ storeId: store.id, targets });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/:storeId/margin-cost", async (req, res) => {
  const store = await resolveStore(req, res);
  if (!store) return;
  try {
    res.json(getMarginCost(store.code, req.query.start, req.query.end));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/compare", async (req, res) => {
  const stores = await getUserStores(req.user.id, req.user.role);
  try {
    res.json(buildStoreCompareRows(stores.map((s) => s.code)));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/transformation-compare", async (req, res) => {
  const stores = await getUserStores(req.user.id, req.user.role);
  try {
    res.json(compareTransformation(stores.map((s) => s.code)));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/closure-compare", async (req, res) => {
  const stores = await getUserStores(req.user.id, req.user.role);
  try {
    res.json(compareClosure(stores.map((s) => s.code)));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/:storeId/transformation-advice", async (req, res) => {
  const store = await resolveStore(req, res);
  if (!store) return;
  try {
    res.json(getTransformationAdvice(store.code));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/:storeId/closure-assessment", async (req, res) => {
  const store = await resolveStore(req, res);
  if (!store) return;
  try {
    res.json(getClosureAssessment(store.code));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/:storeId/diagnosis-report", requireRole("super_admin", "ops_manager", "store_manager"), async (req, res) => {
  const store = await resolveStore(req, res);
  if (!store) return;
  try {
    const report = await buildDiagnosisReport(store.code, req.body?.periodType, { userId: req.user.id });
    const { tables } = await import("../db.mjs");
    tables.diagnosis_reports.insert({
      store_id: store.code,
      created_by: req.user.id,
      period_type: report.periodType,
      report_json: JSON.stringify(report),
    });
    res.json(report);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/:storeId/diagnosis-reports", async (req, res) => {
  const store = await resolveStore(req, res);
  if (!store) return;
  const { tables } = await import("../db.mjs");
  const rows = tables.diagnosis_reports
    .filter((r) => r.store_id === store.code)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 20)
    .map((r) => ({ id: r.id, createdAt: r.created_at, periodType: r.period_type, report: JSON.parse(r.report_json) }));
  res.json({ reports: rows });
});

router.get("/:storeId/report-subscription", async (req, res) => {
  const store = await resolveStore(req, res);
  if (!store) return;
  const { tables } = await import("../db.mjs");
  const row = tables.report_subscriptions.findOne((s) => s.store_id === store.code);
  res.json({ subscription: row || null });
});

router.post("/:storeId/report-subscription", requireRole("super_admin", "ops_manager", "store_manager"), async (req, res) => {
  const store = await resolveStore(req, res);
  if (!store) return;
  const { emails, frequency, active } = req.body || {};
  if (!emails) return res.status(400).json({ error: "请填写收件邮箱" });
  const { tables } = await import("../db.mjs");
  const existing = tables.report_subscriptions.findOne((s) => s.store_id === store.code);
  const patch = {
    store_id: store.code,
    emails,
    frequency: frequency || "weekly",
    active: active !== false,
    updated_by: req.user.id,
  };
  if (existing) {
    tables.report_subscriptions.update(existing.id, patch);
  } else {
    tables.report_subscriptions.insert(patch);
  }
  res.json({ subscription: tables.report_subscriptions.findOne((s) => s.store_id === store.code) });
});

router.post("/:storeId/report-subscription/send-now", requireRole("super_admin", "ops_manager", "store_manager"), async (req, res) => {
  const store = await resolveStore(req, res);
  if (!store) return;
  const { periodType, emails } = req.body || {};
  const { tables } = await import("../db.mjs");
  const sub = tables.report_subscriptions.findOne((s) => s.store_id === store.code);
  const targetEmails = emails || sub?.emails;
  if (!targetEmails) return res.status(400).json({ error: "请先配置收件邮箱" });
  try {
    const { results } = await sendDiagnosisReportNow(store.code, periodType || "week", targetEmails);
    if (sub) tables.report_subscriptions.update(sub.id, { last_sent_at: new Date().toISOString() });
    const sent = results.some((r) => r.ok);
    res.json({ ok: true, sent, results });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
