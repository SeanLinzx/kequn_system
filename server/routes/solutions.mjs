import { Router } from "express";
import { tables, sendMessage } from "../db.mjs";
import { authMiddleware, canAccessStoreSync, requireRole } from "../auth.mjs";
import { generateSolutions } from "../services/ai.mjs";
import { sendEmail, taskPushEmail, siteLink } from "../services/email.mjs";
import { printTaskToStore } from "../services/printer.mjs";

const router = Router();
router.use(authMiddleware);

function listSolutions(user, storeId) {
  let rows = tables.solutions.all();
  if (storeId) rows = rows.filter((s) => s.store_id === storeId);
  if (user.role === "ops_manager") {
    const ids = tables.user_stores.filter((x) => x.user_id === user.id).map((x) => x.store_id);
    rows = rows.filter((s) => ids.includes(s.store_id));
  }
  return rows
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 50)
    .map((r) => ({
      ...r,
      content: JSON.parse(r.content_json || "[]"),
      creator_name: tables.users.get(r.created_by)?.name,
    }));
}

router.get("/", (req, res) => {
  res.json({ solutions: listSolutions(req.user, req.query.storeId) });
});

router.post("/", requireRole("super_admin", "ops_manager", "store_manager"), async (req, res) => {
  const { storeId, riskFactor, title, content, periodStart, periodEnd, diagnosis } = req.body || {};
  if (!storeId || !title) return res.status(400).json({ error: "缺少参数" });
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  let items = content;
  if (!items && diagnosis) {
    try {
      items = await generateSolutions({
        diagnosis,
        riskFactor,
        userId: req.user.id,
        storeId,
      });
    } catch (e) {
      return res.status(502).json({ error: e.message });
    }
  }
  const result = tables.solutions.insert({
    store_id: storeId,
    created_by: req.user.id,
    risk_factor: riskFactor || null,
    title,
    content_json: JSON.stringify(items || []),
    status: "draft",
    period_start: periodStart || null,
    period_end: periodEnd || null,
  });
  res.json({ id: result.lastInsertRowid, content: items });
});

router.put("/:id", requireRole("super_admin", "ops_manager", "store_manager"), (req, res) => {
  const row = tables.solutions.get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "方案不存在" });
  if (!canAccessStoreSync(req.user.id, req.user.role, row.store_id)) {
    return res.status(403).json({ error: "无权限" });
  }
  const { title, content, status } = req.body || {};
  tables.solutions.update(row.id, {
    ...(title != null ? { title } : {}),
    ...(content ? { content_json: JSON.stringify(content) } : {}),
    ...(status != null ? { status } : {}),
  });
  res.json({ ok: true });
});

router.post("/:id/push", requireRole("super_admin", "ops_manager", "store_manager"), async (req, res) => {
  const row = tables.solutions.get(Number(req.params.id));
  if (!row) return res.status(404).json({ error: "方案不存在" });
  if (!canAccessStoreSync(req.user.id, req.user.role, row.store_id)) {
    return res.status(403).json({ error: "无权限" });
  }
  const content = JSON.parse(row.content_json || "[]");
  const { assigneeId, channels } = req.body || {};
  const executor = assigneeId
    ? tables.users.findOne((u) => u.id === assigneeId && u.role === "executor")
    : tables.user_stores
        .filter((us) => us.store_id === row.store_id)
        .map((us) => tables.users.get(us.user_id))
        .find((u) => u && u.role === "executor");
  if (!executor) return res.status(400).json({ error: "未找到执行者" });

  const taskIds = [];
  for (const item of content) {
    const r = tables.tasks.insert({
      solution_id: row.id,
      store_id: row.store_id,
      assignee_id: executor.id,
      created_by: req.user.id,
      title: item.title || row.title,
      steps_json: JSON.stringify(item.steps || []),
      checklist_json: JSON.stringify((item.steps || []).map((s) => ({ text: s, done: false }))),
      deadline: item.deadline || null,
      status: "pending",
      photo_urls_json: "[]",
    });
    taskIds.push(r.lastInsertRowid);
  }

  tables.solutions.update(row.id, { status: "pushed" });

  const useEmail = !channels || channels.includes("email");
  const useMsg = !channels || channels.includes("message");
  const usePrinter = channels && channels.includes("printer");

  for (const taskId of taskIds) {
    const task = tables.tasks.get(taskId);
    const steps = JSON.parse(task.steps_json || "[]");
    const link = siteLink(`/executor.html?task=${taskId}`);
    if (useMsg) {
      sendMessage({ userId: executor.id, title: `新任务：${task.title}`, body: steps.join("\n"), link });
    }
    if (useEmail) {
      const mail = taskPushEmail({ taskTitle: task.title, steps, link });
      await sendEmail({ to: executor.email, ...mail });
    }
  }

  let printResult = null;
  const warnings = [];
  if (usePrinter && taskIds.length) {
    const first = tables.tasks.get(taskIds[0]);
    const steps = JSON.parse(first.steps_json || "[]");
    try {
      printResult = await printTaskToStore(row.store_id, {
        title: first.title,
        brief: row.title,
        steps,
        deadline: first.deadline,
        verifyPoints: [],
      });
    } catch (e) {
      const msg = `小票机打印失败：${e.message}`;
      warnings.push(msg);
      printResult = { ok: false, error: e.message };
    }
  }

  res.json({
    ok: true,
    taskIds,
    assignee: { id: executor.id, name: executor.name },
    warnings,
    printer: printResult
      ? printResult.ok === false
        ? printResult
        : { ok: true, machineCode: printResult.machineCode, order: printResult.order }
      : null,
  });
});

export default router;
