import { Router } from "express";
import bcrypt from "bcryptjs";
import { tables, sendMessage } from "../db.mjs";
import { authMiddleware, canAccessStoreSync, requireRole, getUserStoresLegacy } from "../auth.mjs";
import { sendEmail, taskPushEmail, siteLink } from "../services/email.mjs";
import { printTaskToStore } from "../services/printer.mjs";
import { PUSH_TEMPLATES, PUSH_FACTOR_GROUPS, refinePushPlan, generatePushDecision, getPushInsight, followupPushDecision, followupPushPlan } from "../services/push-plan.mjs";

const router = Router();
router.use(authMiddleware);
router.use(requireRole("super_admin", "ops_manager"));

function accessibleStoreIds(user) {
  return getUserStoresLegacy(user.id, user.role).map((s) => s.id);
}

function executorBindings(executorId) {
  return tables.user_stores.filter((b) => b.user_id === executorId);
}

function canManageExecutor(user, executorId) {
  if (user.role === "super_admin") return true;
  const storeIds = accessibleStoreIds(user);
  const bindings = executorBindings(executorId);
  if (!bindings.length) return true;
  return bindings.some((b) => storeIds.includes(b.store_id));
}

function mapExecutor(u, visibleStoreIds) {
  const bindings = executorBindings(u.id)
    .filter((b) => visibleStoreIds.includes(b.store_id))
    .map((b) => {
      const store = tables.stores.findOne((s) => s.id === b.store_id);
      return { storeId: b.store_id, storeName: store?.name || b.store_id };
    });
  const tasks = tables.tasks.filter((t) => t.assignee_id === u.id && visibleStoreIds.includes(t.store_id));
  const pending = tasks.filter((t) => t.status !== "done").length;
  const done = tasks.filter((t) => t.status === "done").length;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    created_at: u.created_at,
    updated_at: u.updated_at,
    bindings,
    taskStats: { pending, done, total: tasks.length },
  };
}

function syncExecutorStores(executorId, storeIds, allowedStores) {
  const targetIds = storeIds.filter((s) => allowedStores.includes(s));
  const rows = tables.user_stores.all();
  for (let i = rows.length - 1; i >= 0; i--) {
    const b = rows[i];
    if (b.user_id === executorId && allowedStores.includes(b.store_id) && !targetIds.includes(b.store_id)) {
      tables.user_stores.rows.splice(i, 1);
    }
  }
  tables.user_stores.save();
  for (const sid of targetIds) {
    if (!tables.user_stores.findOne((b) => b.user_id === executorId && b.store_id === sid)) {
      tables.user_stores.insert({ user_id: executorId, store_id: sid });
    }
  }
}

router.get("/", (req, res) => {
  const storeId = req.query.storeId;
  const storeIds = accessibleStoreIds(req.user);
  let executors = tables.users
    .filter((u) => u.role === "executor")
    .filter((u) => canManageExecutor(req.user, u.id))
    .map((u) => mapExecutor(u, storeIds));

  if (storeId) {
    executors = executors.filter((e) => e.bindings.some((b) => b.storeId === storeId));
  }
  res.json({ executors, stores: getUserStoresLegacy(req.user.id, req.user.role) });
});

router.get("/templates/list", (_req, res) => {
  res.json({ templates: PUSH_TEMPLATES, groups: PUSH_FACTOR_GROUPS });
});

router.get("/push-insight", (req, res) => {
  const storeId = req.query.storeId;
  if (!storeId) return res.status(400).json({ error: "需要 storeId" });
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  try {
    res.json(getPushInsight(storeId));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/ai-decision", async (req, res) => {
  const { templateId, storeId } = req.body || {};
  if (!storeId || !templateId) return res.status(400).json({ error: "需要门店与样板" });
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  const store = tables.stores.findOne((s) => s.id === storeId);
  try {
    const insight = getPushInsight(storeId);
    const decision = await generatePushDecision({
      templateId,
      storeName: store?.name,
      insight,
      userId: req.user.id,
      storeId,
    });
    res.json({ decision, insight });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.post("/ai-refine", async (req, res) => {
  const { templateId, title, steps, brief, storeId, extraContext, imageUrls, decision } = req.body || {};
  if (!storeId) return res.status(400).json({ error: "需要门店" });
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  const store = tables.stores.findOne((s) => s.id === storeId);
  try {
    const insight = getPushInsight(storeId);
    const plan = await refinePushPlan({
      templateId,
      title,
      steps: Array.isArray(steps) ? steps : [],
      brief,
      storeName: store?.name,
      extraContext,
      imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
      decision,
      insight,
      userId: req.user.id,
      storeId,
    });
    res.json({ plan });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.post("/ai-followup", async (req, res) => {
  const { phase, message, storeId, templateId, decision, plan, history } = req.body || {};
  if (!storeId || !message?.trim()) return res.status(400).json({ error: "需要门店与追问内容" });
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  const store = tables.stores.findOne((s) => s.id === storeId);
  const insight = getPushInsight(storeId);
  try {
    if (phase === "plan") {
      const result = await followupPushPlan({
        message: message.trim(),
        plan: plan || {},
        decision,
        insight,
        templateId,
        storeName: store?.name,
        history: Array.isArray(history) ? history : [],
        userId: req.user.id,
        storeId,
      });
      return res.json(result);
    }
    const result = await followupPushDecision({
      message: message.trim(),
      decision: decision || {},
      insight,
      templateId,
      storeName: store?.name,
      history: Array.isArray(history) ? history : [],
      userId: req.user.id,
      storeId,
    });
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

router.get("/:id", (req, res) => {
  const id = Number(req.params.id);
  const u = tables.users.get(id);
  if (!u || u.role !== "executor") return res.status(404).json({ error: "执行者不存在" });
  if (!canManageExecutor(req.user, id)) return res.status(403).json({ error: "无权限" });
  res.json({ executor: mapExecutor(u, accessibleStoreIds(req.user)) });
});

router.post("/", (req, res) => {
  const { name, email, password, storeIds } = req.body || {};
  if (!name?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: "需要姓名、邮箱和密码" });
  }
  if (password.length < 6) return res.status(400).json({ error: "密码至少 6 位" });
  if (tables.users.findOne((u) => u.email === email.trim())) {
    return res.status(400).json({ error: "邮箱已存在" });
  }

  const allowedStores = accessibleStoreIds(req.user);
  const r = tables.users.insert({
    email: email.trim(),
    name: name.trim(),
    password_hash: bcrypt.hashSync(password, 10),
    role: "executor",
  });

  if (Array.isArray(storeIds) && storeIds.length) {
    syncExecutorStores(r.lastInsertRowid, storeIds, allowedStores);
  }

  res.json({ ok: true, executor: mapExecutor(tables.users.get(r.lastInsertRowid), allowedStores) });
});

router.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const u = tables.users.get(id);
  if (!u || u.role !== "executor") return res.status(404).json({ error: "执行者不存在" });
  if (!canManageExecutor(req.user, id)) return res.status(403).json({ error: "无权限" });

  const { name, email, password, storeIds } = req.body || {};
  const patch = {};
  if (name?.trim()) patch.name = name.trim();
  if (email?.trim()) {
    const dup = tables.users.findOne((x) => x.email === email.trim() && x.id !== id);
    if (dup) return res.status(400).json({ error: "邮箱已存在" });
    patch.email = email.trim();
  }
  if (password) {
    if (password.length < 6) return res.status(400).json({ error: "密码至少 6 位" });
    patch.password_hash = bcrypt.hashSync(password, 10);
  }
  if (Object.keys(patch).length) tables.users.update(id, patch);

  if (Array.isArray(storeIds)) {
    syncExecutorStores(id, storeIds, accessibleStoreIds(req.user));
  }

  res.json({ ok: true, executor: mapExecutor(tables.users.get(id), accessibleStoreIds(req.user)) });
});

router.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const u = tables.users.get(id);
  if (!u || u.role !== "executor") return res.status(404).json({ error: "执行者不存在" });
  if (!canManageExecutor(req.user, id)) return res.status(403).json({ error: "无权限" });

  const pending = tables.tasks.filter((t) => t.assignee_id === id && t.status !== "done");
  if (pending.length) {
    return res.status(400).json({ error: `该执行者有 ${pending.length} 个未完成任务，无法删除` });
  }

  const bindings = tables.user_stores.all();
  for (let i = bindings.length - 1; i >= 0; i--) {
    if (bindings[i].user_id === id) tables.user_stores.rows.splice(i, 1);
  }
  tables.user_stores.save();

  const msgs = tables.messages.all();
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].user_id === id) tables.messages.rows.splice(i, 1);
  }
  tables.messages.save();

  tables.users.remove(id);
  res.json({ ok: true });
});

router.post("/bind", (req, res) => {
  const { userId, storeId } = req.body || {};
  if (!userId || !storeId) return res.status(400).json({ error: "需要 userId 和 storeId" });
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限管理该门店" });
  }
  const user = tables.users.get(Number(userId));
  if (!user || user.role !== "executor") return res.status(400).json({ error: "无效执行者" });
  if (!canManageExecutor(req.user, user.id)) return res.status(403).json({ error: "无权限管理该执行者" });
  if (!tables.user_stores.findOne((b) => b.user_id === user.id && b.store_id === storeId)) {
    tables.user_stores.insert({ user_id: user.id, store_id: storeId });
  }
  res.json({ ok: true });
});

router.post("/unbind", (req, res) => {
  const { userId, storeId } = req.body || {};
  if (!userId || !storeId) return res.status(400).json({ error: "需要 userId 和 storeId" });
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }
  if (!canManageExecutor(req.user, Number(userId))) return res.status(403).json({ error: "无权限管理该执行者" });
  const rows = tables.user_stores.all();
  const idx = rows.findIndex((b) => b.user_id === Number(userId) && b.store_id === storeId);
  if (idx >= 0) {
    tables.user_stores.rows.splice(idx, 1);
    tables.user_stores.save();
  }
  res.json({ ok: true });
});

router.post("/push", async (req, res) => {
  const {
    executorId,
    executorIds,
    storeId,
    title,
    steps,
    deadline,
    channels,
    brief,
    images,
    templateId,
    verifyPoints,
  } = req.body || {};

  const ids = Array.isArray(executorIds) && executorIds.length
    ? [...new Set(executorIds.map(Number).filter(Boolean))]
    : executorId
      ? [Number(executorId)]
      : [];

  if (!ids.length || !storeId || !title) {
    return res.status(400).json({ error: "需要执行者、门店和任务标题" });
  }
  if (!canAccessStoreSync(req.user.id, req.user.role, storeId)) {
    return res.status(403).json({ error: "无权限" });
  }

  const stepList = Array.isArray(steps) ? steps.filter(Boolean) : [];
  if (!stepList.length) return res.status(400).json({ error: "请填写至少一条执行步骤" });

  const verifyList = Array.isArray(verifyPoints) ? verifyPoints.filter(Boolean) : [];
  const checklist = [
    ...stepList.map((s) => ({ text: s, done: false })),
    ...verifyList.map((s) => ({ text: "✓ " + s, done: false })),
  ];
  const imageList = Array.isArray(images) ? images.filter(Boolean) : [];
  const useEmail = !channels || channels.includes("email");
  const useMsg = !channels || channels.includes("message");
  const usePrinter = channels && channels.includes("printer");
  const msgBody = [brief, ...stepList].filter(Boolean).join("\n");

  const executors = [];
  for (const eid of ids) {
    const executor = tables.users.get(eid);
    if (!executor || executor.role !== "executor") {
      return res.status(400).json({ error: `无效执行者 ID: ${eid}` });
    }
    if (!canManageExecutor(req.user, executor.id)) {
      return res.status(403).json({ error: `无权限管理执行者：${executor.name}` });
    }
    const bound = tables.user_stores.findOne(
      (b) => b.user_id === executor.id && b.store_id === storeId,
    );
    if (!bound) {
      return res.status(400).json({ error: `${executor.name} 未绑定此门店，请先分配` });
    }
    executors.push(executor);
  }

  const results = [];
  for (const executor of executors) {
    const r = tables.tasks.insert({
      solution_id: null,
      store_id: storeId,
      assignee_id: executor.id,
      created_by: req.user.id,
      title,
      brief: brief || null,
      template_id: templateId || null,
      steps_json: JSON.stringify(stepList),
      checklist_json: JSON.stringify(checklist.length ? checklist : stepList.map((s) => ({ text: s, done: false }))),
      attach_images_json: JSON.stringify(imageList),
      deadline: deadline || "尽快",
      status: "pending",
      photo_urls_json: "[]",
    });

    const link = siteLink(`/executor.html?task=${r.lastInsertRowid}`);
    if (useMsg) {
      sendMessage({
        userId: executor.id,
        title: `新执行任务：${title}`,
        body: msgBody + (imageList.length ? `\n[含 ${imageList.length} 张参考图/海报]` : ""),
        link,
      });
    }
    if (useEmail) {
      const mail = taskPushEmail({
        taskTitle: title,
        brief,
        steps: stepList,
        verifyPoints: verifyList,
        images: imageList,
        link,
      });
      await sendEmail({ to: executor.email, ...mail });
    }

    results.push({ taskId: r.lastInsertRowid, assignee: { id: executor.id, name: executor.name } });
  }

  let printResult = null;
  const warnings = [];
  if (usePrinter) {
    try {
      printResult = await printTaskToStore(storeId, {
        title,
        brief,
        steps: stepList,
        deadline: deadline || "尽快",
        verifyPoints: verifyList,
      });
    } catch (e) {
      const msg = `小票机打印失败：${e.message}`;
      warnings.push(msg);
      printResult = { ok: false, error: e.message };
    }
  }

  res.json({
    ok: true,
    count: results.length,
    tasks: results,
    assignees: results.map((r) => r.assignee),
    warnings,
    printer: printResult
      ? printResult.ok === false
        ? printResult
        : { ok: true, machineCode: printResult.machineCode, order: printResult.order }
      : null,
  });
});

export default router;
