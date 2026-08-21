import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import { tables } from "../db.mjs";
import { authMiddleware, canAccessStoreSync, getUserStores, requireRole } from "../auth.mjs";
import { diagnose, storeHealth } from "../services/funnel.mjs";
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

const router = Router();
router.use(authMiddleware);

const STORES_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "stores");

router.get("/", (req, res) => {
  res.json({ stores: getUserStores(req.user.id, req.user.role) });
});

router.get("/:storeId/meta", (req, res) => {
  const { storeId } = req.params;
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限访问该门店" });
  }
  try {
    const funnel = JSON.parse(readFileSync(join(STORES_ROOT, storeId, "funnel.json"), "utf8"));
    const promoPath = join(STORES_ROOT, storeId, "promo-context.json");
    const promo = existsSync(promoPath) ? JSON.parse(readFileSync(promoPath, "utf8")) : null;
    res.json({ meta: funnel.meta, range: { lo: funnel.lo, hi: funnel.hi }, promo });
  } catch {
    res.status(404).json({ error: "门店数据不存在" });
  }
});

router.post("/:storeId/diagnose", (req, res) => {
  const { storeId } = req.params;
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  const { start, end } = req.body || {};
  if (!start || !end) return res.status(400).json({ error: "需要 start 和 end" });
  try {
    res.json(diagnose(storeId, start, end));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/:storeId/dashboard", (req, res) => {
  const { storeId } = req.params;
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  try {
    res.json(getStoreDashboard(storeId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/:storeId/printer", (req, res) => {
  const { storeId } = req.params;
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  res.json({
    storeId,
    machineCode: getStorePrinterCode(storeId),
    defaultMachineCode: DEFAULT_MACHINE_CODE,
    configured: isPrinterConfigured(),
  });
});

router.put("/:storeId/printer", requireRole("super_admin", "ops_manager", "store_manager"), (req, res) => {
  const { storeId } = req.params;
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  try {
    const code = setStorePrinterCode(storeId, req.body?.machineCode);
    res.json({ ok: true, storeId, machineCode: code });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/:storeId/printer/test", requireRole("super_admin", "ops_manager", "store_manager"), async (req, res) => {
  const { storeId } = req.params;
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  try {
    const r = await printTestTicket(storeId);
    res.json({ ok: true, machineCode: r.machineCode, order: r.order });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.get("/:storeId/health", (req, res) => {
  const { storeId } = req.params;
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  try {
    res.json(storeHealth(storeId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/:storeId/targets", (req, res) => {
  const { storeId } = req.params;
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  try {
    res.json({ storeId, targets: getTargets(storeId) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put("/:storeId/targets", requireRole("super_admin", "ops_manager", "store_manager"), (req, res) => {
  const { storeId } = req.params;
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  const { periodType, value } = req.body || {};
  try {
    const targets = setTarget(storeId, periodType, value, req.user.id);
    res.json({ storeId, targets });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/:storeId/margin-cost", (req, res) => {
  const { storeId } = req.params;
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  try {
    res.json(getMarginCost(storeId, req.query.start, req.query.end));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/compare", (req, res) => {
  const stores = getUserStores(req.user.id, req.user.role);
  try {
    res.json(buildStoreCompareRows(stores.map((s) => s.id)));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/transformation-compare", (req, res) => {
  const stores = getUserStores(req.user.id, req.user.role);
  try {
    res.json(compareTransformation(stores.map((s) => s.id)));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/closure-compare", (req, res) => {
  const stores = getUserStores(req.user.id, req.user.role);
  try {
    res.json(compareClosure(stores.map((s) => s.id)));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/:storeId/transformation-advice", (req, res) => {
  const { storeId } = req.params;
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  try {
    res.json(getTransformationAdvice(storeId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/:storeId/closure-assessment", (req, res) => {
  const { storeId } = req.params;
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  try {
    res.json(getClosureAssessment(storeId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/:storeId/diagnosis-report", requireRole("super_admin", "ops_manager", "store_manager"), async (req, res) => {
  const { storeId } = req.params;
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  try {
    const report = await buildDiagnosisReport(storeId, req.body?.periodType, { userId: req.user.id });
    tables.diagnosis_reports.insert({
      store_id: storeId,
      created_by: req.user.id,
      period_type: report.periodType,
      report_json: JSON.stringify(report),
    });
    res.json(report);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/:storeId/diagnosis-reports", (req, res) => {
  const { storeId } = req.params;
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  const rows = tables.diagnosis_reports
    .filter((r) => r.store_id === storeId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 20)
    .map((r) => ({ id: r.id, createdAt: r.created_at, periodType: r.period_type, report: JSON.parse(r.report_json) }));
  res.json({ reports: rows });
});

router.get("/:storeId/report-subscription", (req, res) => {
  const { storeId } = req.params;
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  const row = tables.report_subscriptions.findOne((s) => s.store_id === storeId);
  res.json({ subscription: row || null });
});

router.post("/:storeId/report-subscription", requireRole("super_admin", "ops_manager", "store_manager"), (req, res) => {
  const { storeId } = req.params;
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  const { emails, frequency, active } = req.body || {};
  if (!emails) return res.status(400).json({ error: "请填写收件邮箱" });
  const existing = tables.report_subscriptions.findOne((s) => s.store_id === storeId);
  const patch = {
    store_id: storeId,
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
  res.json({ subscription: tables.report_subscriptions.findOne((s) => s.store_id === storeId) });
});

router.post("/:storeId/report-subscription/send-now", requireRole("super_admin", "ops_manager", "store_manager"), async (req, res) => {
  const { storeId } = req.params;
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  const { periodType, emails } = req.body || {};
  const sub = tables.report_subscriptions.findOne((s) => s.store_id === storeId);
  const targetEmails = emails || sub?.emails;
  if (!targetEmails) return res.status(400).json({ error: "请先配置收件邮箱" });
  try {
    const { results } = await sendDiagnosisReportNow(storeId, periodType || "week", targetEmails);
    if (sub) tables.report_subscriptions.update(sub.id, { last_sent_at: new Date().toISOString() });
    const sent = results.some((r) => r.ok);
    res.json({ ok: true, sent, results });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
