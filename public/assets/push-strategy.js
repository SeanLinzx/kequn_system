(function () {
  let templates = [];
  let factorGroups = [];
  let selectedTemplateId = null;
  let pendingTemplateId = null;
  let attachImages = [];
  let lastVerifyPoints = [];
  let lastDecision = null;
  let lastInsight = null;
  let executorCache = [];
  let pushAiProg = null;
  let decisionProg = null;
  let insightProg = null;
  let planReady = false;
  let decisionChatHistory = [];
  let planChatHistory = [];
  let followupProg = null;

  const FACTOR_HINT = {
    pass: "过店",
    capture: "捕获率",
    conv: "成交率",
    aov: "客单价",
  };

  function el(id) {
    return document.getElementById(id);
  }

  function getStoreId() {
    return el("pushStore")?.value || window.getStoreId?.();
  }

  function getSelectedExecutorIds() {
    return Array.from(el("pushExecChecks")?.querySelectorAll("input:checked") || []).map((x) =>
      Number(x.value),
    );
  }

  function renderExecutors(executors, storeId) {
    executorCache = executors || [];
    const box = el("pushExecChecks");
    if (!box) return;
    const matched = executorCache.filter(
      (e) => !storeId || e.bindings.some((b) => b.storeId === storeId),
    );
    if (!matched.length) {
      box.innerHTML = "<p class='muted'>当前门店暂无可选执行者，请先在「执行者管理」绑定门店</p>";
      return;
    }
    const prev = new Set(getSelectedExecutorIds());
    box.innerHTML = matched
      .map(function (e) {
        const checked = prev.has(e.id) || prev.size === 0 ? "checked" : "";
        return `<label class="exec-chip">
          <input type="checkbox" value="${e.id}" ${checked}/>
          <span class="exec-chip-name">${e.name}</span>
          <span class="exec-chip-email">${e.email}</span>
          <span class="exec-chip-stat">待办 ${e.taskStats?.pending || 0}</span>
        </label>`;
      })
      .join("");
  }

  function factorChipClass(pct) {
    if (pct >= 5) return "factor-chip--strong";
    if (pct < 0) return "factor-chip--weak";
    return "factor-chip--normal";
  }

  function factorGroupStatusClass(pct) {
    if (pct >= 5) return "push-factor-group--strong";
    if (pct < 0) return "push-factor-group--weak";
    return "push-factor-group--normal";
  }

  function factorByKey(key) {
    return lastInsight?.factors?.find((f) => f.key === key);
  }

  function renderWeeklyInsight(insight) {
    const box = el("pushWeeklyInsight");
    if (!box) return;
    if (!insight) {
      box.innerHTML = "暂无分析数据，请选择门店后重试";
      return;
    }
    lastInsight = insight;
    const chips = insight.factors
      .map(function (f) {
        const sign = f.pct >= 0 ? "+" : "";
        const tag = f.pct >= 5 ? "强" : f.pct < 0 ? "弱" : "平";
        return `<span class="factor-chip ${factorChipClass(f.pct)}" title="${f.name}">
          <span class="factor-chip-name">${f.name}</span>
          <span class="factor-chip-pct">${sign}${f.pct}%</span>
          <span class="factor-chip-tag">${tag}</span>
        </span>`;
      })
      .join("");
    const guide = insight.weak.length
      ? `建议优先关注 <b>${insight.weak.map((f) => f.name).join("、")}</b>，可点击下方对应方向样板`
      : "四因子整体平稳，可按经营重点选择样板";
    box.innerHTML = `<div class="push-insight-hd">
        <strong>近 7 天分析结论</strong>
        <span class="muted">${insight.period.start} ~ ${insight.period.end}</span>
      </div>
      <div class="factor-chip-row">${chips}</div>
      <p class="push-insight-guide">${guide}</p>
      <p class="muted push-insight-summary">${insight.summary}</p>`;
  }

  async function loadInsight() {
    const storeId = getStoreId();
    if (!storeId) return;
    const box = el("pushWeeklyInsight");
    if (box) box.innerHTML = "加载一周分析…";
    try {
      const data = await FenqunAPI.api("/executors/push-insight?storeId=" + storeId);
      renderWeeklyInsight(data);
      renderTemplates();
    } catch (e) {
      if (box) box.innerHTML = `<span class="error-text">${e.message}</span>`;
    }
  }

  function renderTemplates() {
    const box = el("pushTemplates");
    if (!box) return;
    const groups = factorGroups.length
      ? factorGroups
      : [
          { key: "pass", title: "提升过店人数" },
          { key: "capture", title: "提升过店捕获率" },
          { key: "conv", title: "提升成交率" },
          { key: "aov", title: "提升客单价" },
        ];
    box.innerHTML = groups
      .map(function (g) {
        const items = templates.filter((t) => t.factor === g.key);
        if (!items.length) return "";
        const factor = factorByKey(g.key);
        const statusCls = factor ? factorGroupStatusClass(factor.pct) : "push-factor-group--normal";
        const sign = factor && factor.pct >= 0 ? "+" : "";
        const tag = factor ? (factor.pct >= 5 ? "强" : factor.pct < 0 ? "弱" : "平") : "";
        const badge = factor
          ? `<span class="factor-chip ${factorChipClass(factor.pct)} push-factor-badge" title="${factor.name}">
              <span class="factor-chip-name">${factor.name}</span>
              <span class="factor-chip-pct">${sign}${factor.pct}%</span>
              <span class="factor-chip-tag">${tag}</span>
            </span>`
          : "";
        return `<div class="push-factor-group ${statusCls}">
          <div class="push-factor-hd">
            <strong>${g.title}</strong>
            <span class="muted">${g.sub || FACTOR_HINT[g.key] || ""}</span>
            ${badge}
            <button type="button" class="btn-link push-goto-solution" data-factor="${g.key}">查看运营方案 →</button>
          </div>
          <div class="push-tpl-compact-row">${items
            .map(function (t) {
              const active = t.id === selectedTemplateId ? " active" : "";
              const match = lastInsight?.weak?.some((f) => f.key === t.factor);
              const rec = match ? '<span class="tpl-rec">荐</span>' : "";
              return `<button type="button" class="push-tpl-chip${active}" data-tpl="${t.id}" title="${t.desc}">
                <span class="push-tpl-chip-icon">${t.icon}</span>
                <span class="push-tpl-chip-name">${t.name}</span>${rec}
              </button>`;
            })
            .join("")}</div>
        </div>`;
      })
      .join("");

    box.querySelectorAll(".push-tpl-chip").forEach(function (btn) {
      btn.onclick = function () {
        previewTemplate(btn.dataset.tpl);
      };
    });
    box.querySelectorAll(".push-goto-solution").forEach(function (btn) {
      btn.onclick = function (e) {
        e.stopPropagation();
        window.goToSolutionForFactor?.(btn.dataset.factor);
      };
    });
  }

  function showTplConfirm(t) {
    const panel = el("pushTplConfirm");
    if (!panel || !t) return;
    el("pushTplConfirmIcon").textContent = t.icon || "📋";
    el("pushTplConfirmName").textContent = t.name || "";
    el("pushTplConfirmDesc").textContent = t.desc || "";
    panel.style.display = "block";
    panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function hideTplConfirm() {
    if (el("pushTplConfirm")) el("pushTplConfirm").style.display = "none";
    pendingTemplateId = null;
  }

  function previewTemplate(id) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    pendingTemplateId = id;
    selectedTemplateId = id;
    renderTemplates();
    showTplConfirm(t);
    if (t.suggestPoster) FenqunAPI.toast("此样板建议附带海报，生成决策后可从海报库选择");
  }

  function cancelTplConfirm() {
    hideTplConfirm();
    selectedTemplateId = null;
    renderTemplates();
  }

  function canDirectPush() {
    const title = el("pushTitle")?.value.trim();
    const steps = (el("pushSteps")?.value || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    return Boolean(title && steps.length);
  }

  function updatePushReady() {
    const ready = canDirectPush();
    if (el("btnDirectPush")) el("btnDirectPush").disabled = !ready;
    planReady = ready;
  }

  function openWorkflowFromTemplate(id) {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    selectedTemplateId = id;
    el("pushTitle").value = t.draftTitle || "";
    el("pushBrief").value = t.desc || "";
    el("pushSteps").value = (t.draftSteps || []).join("\n");
    if (el("pushVerify")) el("pushVerify").value = "";
    el("pushExtra").value = "";
    el("pushDecisionPanel").innerHTML = "";
    if (el("pushDecisionChat")) el("pushDecisionChat").style.display = "none";
    el("pushAiPreview").innerHTML = "";
    lastDecision = null;
    lastVerifyPoints = [];
    resetDecisionChat();
    resetPlanChat();
    el("btnAiRefine").disabled = false;
    el("pushWorkflowCard").style.display = "block";
    renderTemplates();
    updatePushReady();
  }

  function skipAiAndFill() {
    const id = pendingTemplateId;
    if (!id) return;
    hideTplConfirm();
    openWorkflowFromTemplate(id);
    FenqunAPI.toast("已载入样板草稿，可直接编辑并推送");
  }

  async function confirmAndGenerate() {
    const id = pendingTemplateId;
    if (!id) return;
    hideTplConfirm();
    await runAiDecision(id);
  }

  function collectDecisionFromForm() {
    return {
      title: el("pushDecTitle")?.value.trim() || "",
      goal: el("pushDecGoal")?.value.trim() || "",
      rationale: el("pushDecRationale")?.value.trim() || "",
      actions: (el("pushDecActions")?.value || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      focusHours: el("pushDecFocusHours")?.value.trim() || "",
      expectedEffect: el("pushDecExpected")?.value.trim() || "",
    };
  }

  function collectPlanFromForm() {
    return {
      title: el("pushTitle")?.value.trim() || "",
      brief: el("pushBrief")?.value.trim() || "",
      deadline: el("pushDeadline")?.value.trim() || "",
      steps: (el("pushSteps")?.value || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      verifyPoints: (el("pushVerify")?.value || "")
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    };
  }

  function applyDecisionToForm(decision) {
    if (!decision) return;
    lastDecision = decision;
    if (el("pushDecTitle")) el("pushDecTitle").value = decision.title || "";
    if (el("pushDecGoal")) el("pushDecGoal").value = decision.goal || "";
    if (el("pushDecRationale")) el("pushDecRationale").value = decision.rationale || "";
    if (el("pushDecActions")) el("pushDecActions").value = (decision.actions || []).join("\n");
    if (el("pushDecFocusHours")) el("pushDecFocusHours").value = decision.focusHours || "";
    if (el("pushDecExpected")) el("pushDecExpected").value = decision.expectedEffect || "";
    if (decision.goal && el("pushBrief") && !el("pushBrief").value.trim()) {
      el("pushBrief").value = decision.goal;
    }
    el("btnAiRefine").disabled = false;
  }

  function applyPlanToForm(plan) {
    if (!plan) return;
    if (plan.title) el("pushTitle").value = plan.title;
    if (plan.brief) el("pushBrief").value = plan.brief;
    if (plan.deadline) el("pushDeadline").value = plan.deadline;
    if (plan.steps?.length) el("pushSteps").value = plan.steps.join("\n");
    if (plan.verifyPoints?.length) {
      lastVerifyPoints = plan.verifyPoints;
      if (el("pushVerify")) el("pushVerify").value = plan.verifyPoints.join("\n");
    }
    planReady = true;
    updatePushReady();
    renderPlanPreview(plan);
  }

  function renderPlanPreview(plan) {
    const box = el("pushAiPreview");
    if (!box) return;
    const p = plan || collectPlanFromForm();
    box.innerHTML = `<div class="ai-preview-box">
      <strong>② 可执行方案（可编辑）</strong>
      <p class="muted decision-edit-hint">上方字段可直接修改，或通过下方与 AI 对话追问细化</p>
      <p class="muted">${p.brief || ""}</p>
      <ol class="plan-step-preview">${(p.steps || []).map((s) => `<li>${s}</li>`).join("")}</ol>
      ${(p.verifyPoints || []).length ? `<p><b>验收点：</b>${p.verifyPoints.join("；")}</p>` : ""}
    </div>`;
    if (el("pushPlanChat")) el("pushPlanChat").style.display = "block";
  }

  function renderChatMsgs(boxId, history) {
    const box = el(boxId);
    if (!box) return;
    if (!history.length) {
      box.innerHTML = '<p class="push-ai-chat-empty">暂无对话，输入问题让 AI 帮你调整</p>';
      return;
    }
    box.innerHTML = history
      .map(function (h) {
        const cls = h.role === "user" ? "push-ai-chat-msg--user" : "push-ai-chat-msg--ai";
        return `<div class="push-ai-chat-msg ${cls}">${h.content}</div>`;
      })
      .join("");
    box.scrollTop = box.scrollHeight;
  }

  function resetDecisionChat() {
    decisionChatHistory = [];
    renderChatMsgs("pushDecisionChatMsgs", []);
    if (el("pushDecisionChatInput")) el("pushDecisionChatInput").value = "";
  }

  function resetPlanChat() {
    planChatHistory = [];
    renderChatMsgs("pushPlanChatMsgs", []);
    if (el("pushPlanChatInput")) el("pushPlanChatInput").value = "";
    if (el("pushPlanChat")) el("pushPlanChat").style.display = "none";
  }

  function renderDecision(decision) {
    const panel = el("pushDecisionPanel");
    if (!panel) return;
    if (!decision) {
      panel.innerHTML = "";
      if (el("pushDecisionChat")) el("pushDecisionChat").style.display = "none";
      return;
    }
    lastDecision = decision;
    panel.innerHTML = `<div class="decision-preview-box">
      <div class="decision-preview-hd">
        <span class="ai-tag">① AI 推荐决策</span>
        <strong>可编辑 · 可追问</strong>
      </div>
      <p class="muted decision-edit-hint">可直接修改下方内容，或通过对话让 AI 按你的要求调整</p>
      <div class="decision-edit-grid">
        <div class="field field--full">
          <label>决策标题</label>
          <input type="text" id="pushDecTitle" value="${(decision.title || "").replace(/"/g, "&quot;")}"/>
        </div>
        <div class="field field--full">
          <label>目标</label>
          <input type="text" id="pushDecGoal" value="${(decision.goal || "").replace(/"/g, "&quot;")}"/>
        </div>
        <div class="field field--full">
          <label>决策理由（结合数据）</label>
          <textarea id="pushDecRationale" rows="3">${decision.rationale || ""}</textarea>
        </div>
        <div class="field field--full">
          <label>经营动作（每行一条）</label>
          <textarea id="pushDecActions" rows="3">${(decision.actions || []).join("\n")}</textarea>
        </div>
        <div class="field">
          <label>重点时段</label>
          <input type="text" id="pushDecFocusHours" value="${(decision.focusHours || "").replace(/"/g, "&quot;")}"/>
        </div>
        <div class="field">
          <label>预期效果</label>
          <input type="text" id="pushDecExpected" value="${(decision.expectedEffect || "").replace(/"/g, "&quot;")}"/>
        </div>
      </div>
    </div>`;
    if (el("pushDecisionChat")) el("pushDecisionChat").style.display = "block";
    el("btnAiRefine").disabled = false;
    planReady = false;
    updatePushReady();
    el("pushAiPreview").innerHTML = "";
    resetPlanChat();
  }

  async function runAiDecision(id) {
    openWorkflowFromTemplate(id);
    el("btnAiRefine").disabled = true;

    decisionProg = decisionProg || FQ_AI.createProgressController(el("pushDecisionProgressHost"));
    try {
      const data = await FQ_AI.runWithProgress(
        decisionProg,
        "结合近 7 天诊断数据，生成推荐决策…",
        function () {
          return FenqunAPI.api("/executors/ai-decision", {
            method: "POST",
            body: { templateId: id, storeId: getStoreId() },
          });
        },
      );
      if (data.insight) renderWeeklyInsight(data.insight);
      renderDecision(data.decision);
      if (data.decision?.goal) el("pushBrief").value = data.decision.goal;
      resetDecisionChat();
      updatePushReady();
      FenqunAPI.toast("推荐决策已生成，可编辑或与 AI 对话调整后转化为方案");
    } catch (e) {
      renderDecision(null);
      el("btnAiRefine").disabled = false;
      updatePushReady();
      FenqunAPI.toast(e.message);
    }
  }

  function applyTemplate(id) {
    previewTemplate(id);
  }

  function renderImages() {
    const box = el("pushImageList");
    if (!box) return;
    box.innerHTML = attachImages.length
      ? attachImages
          .map(function (url, i) {
            return `<div class="push-img-item">
              <img src="${url}" alt="参考图"/>
              <button type="button" class="btn secondary btn-xs push-img-rm" data-idx="${i}">移除</button>
            </div>`;
          })
          .join("")
      : "<p class='muted push-img-empty'>暂无图片</p>";

    box.querySelectorAll(".push-img-rm").forEach(function (btn) {
      btn.onclick = function () {
        attachImages.splice(Number(btn.dataset.idx), 1);
        renderImages();
      };
    });
  }

  function addImage(url) {
    if (!url || attachImages.includes(url)) return;
    attachImages.push(url);
    renderImages();
  }

  async function loadTemplates() {
    try {
      const data = await FenqunAPI.api("/executors/templates/list");
      templates = data.templates || [];
      factorGroups = data.groups || [];
      renderTemplates();
    } catch (e) {
      if (el("pushTemplates")) el("pushTemplates").innerHTML = `<p class="muted">${e.message}</p>`;
    }
  }

  async function pickPoster() {
    const storeId = getStoreId();
    try {
      const data = await FenqunAPI.api("/posters?storeId=" + storeId);
      const posters = (data.posters || []).filter((p) => p.image_url);
      if (!posters.length) return FenqunAPI.toast("暂无海报，请先在「热点海报」页生成");
      const modal = el("posterPickModal");
      const list = el("posterPickList");
      list.innerHTML = posters
        .slice(0, 12)
        .map(function (p) {
          return `<button type="button" class="poster-pick-item" data-url="${p.image_url}">
            <img src="${p.image_url}" alt="${p.hot_topic || "海报"}"/>
            <span>${p.hot_topic || "促销海报"}</span>
          </button>`;
        })
        .join("");
      modal.style.display = "flex";
      list.querySelectorAll(".poster-pick-item").forEach(function (btn) {
        btn.onclick = function () {
          addImage(btn.dataset.url);
          modal.style.display = "none";
          FenqunAPI.toast("已添加海报");
        };
      });
    } catch (e) {
      FenqunAPI.toast(e.message);
    }
  }

  async function aiRefine() {
    const decision = collectDecisionFromForm();
    const hasDecision = Boolean(decision.title || decision.goal);
    const plan = collectPlanFromForm();
    if (!hasDecision && !plan.title && !plan.brief && !plan.steps.length) {
      return FenqunAPI.toast("请填写方案内容或先生成推荐决策");
    }
    if (hasDecision) lastDecision = decision;
    const title = el("pushTitle").value.trim();
    el("btnAiRefine").disabled = true;
    try {
      const data = await FQ_AI.runWithProgress(
        pushAiProg,
        "AI 正在将决策转化为可执行方案…",
        function () {
          return FenqunAPI.api("/executors/ai-refine", {
            method: "POST",
            body: {
              templateId: selectedTemplateId,
              title,
              brief: el("pushBrief").value.trim(),
              steps: el("pushSteps").value.split("\n").map((s) => s.trim()).filter(Boolean),
              storeId: getStoreId(),
              extraContext: el("pushExtra").value.trim(),
              imageUrls: attachImages,
              decision: hasDecision ? decision : null,
            },
          });
        },
      );
      applyPlanToForm(data.plan || {});
      resetPlanChat();
      FenqunAPI.toast("可执行方案已生成，可编辑或与 AI 对话后继续调整");
    } catch (e) {
      el("pushAiPreview").innerHTML = "";
      FenqunAPI.toast(e.message);
    } finally {
      el("btnAiRefine").disabled = false;
    }
  }

  async function decisionFollowup() {
    const input = el("pushDecisionChatInput");
    const msg = input?.value.trim();
    if (!msg) return FenqunAPI.toast("请输入追问内容");
    const decision = collectDecisionFromForm();
    if (!decision.title && !decision.goal) return FenqunAPI.toast("请先生成推荐决策");
    lastDecision = decision;
    decisionChatHistory.push({ role: "user", content: msg });
    renderChatMsgs("pushDecisionChatMsgs", decisionChatHistory);
    input.value = "";
    followupProg = followupProg || FQ_AI.createProgressController(el("pushDecisionProgressHost"));
    try {
      const data = await FQ_AI.runWithProgress(
        followupProg,
        "AI 正在根据追问调整决策…",
        function () {
          return FenqunAPI.api("/executors/ai-followup", {
            method: "POST",
            body: {
              phase: "decision",
              message: msg,
              storeId: getStoreId(),
              templateId: selectedTemplateId,
              decision,
              history: decisionChatHistory.slice(0, -1),
            },
          });
        },
      );
      if (data.reply) {
        decisionChatHistory.push({ role: "assistant", content: data.reply });
        renderChatMsgs("pushDecisionChatMsgs", decisionChatHistory);
      }
      if (data.decision) {
        renderDecision(data.decision);
        if (data.decision.goal) el("pushBrief").value = data.decision.goal;
        planReady = false;
        updatePushReady();
        el("pushAiPreview").innerHTML = "";
      }
      FenqunAPI.toast("决策已更新");
    } catch (e) {
      decisionChatHistory.pop();
      renderChatMsgs("pushDecisionChatMsgs", decisionChatHistory);
      FenqunAPI.toast(e.message);
    }
  }

  async function planFollowup() {
    const input = el("pushPlanChatInput");
    const msg = input?.value.trim();
    if (!msg) return FenqunAPI.toast("请输入追问内容");
    const plan = collectPlanFromForm();
    if (!plan.steps.length) return FenqunAPI.toast("请先生成或填写执行步骤");
    const decision = collectDecisionFromForm();
    planChatHistory.push({ role: "user", content: msg });
    renderChatMsgs("pushPlanChatMsgs", planChatHistory);
    input.value = "";
    try {
      const data = await FQ_AI.runWithProgress(
        pushAiProg,
        "AI 正在根据追问调整方案…",
        function () {
          return FenqunAPI.api("/executors/ai-followup", {
            method: "POST",
            body: {
              phase: "plan",
              message: msg,
              storeId: getStoreId(),
              templateId: selectedTemplateId,
              decision,
              plan,
              history: planChatHistory.slice(0, -1),
            },
          });
        },
      );
      if (data.reply) {
        planChatHistory.push({ role: "assistant", content: data.reply });
        renderChatMsgs("pushPlanChatMsgs", planChatHistory);
      }
      if (data.plan) applyPlanToForm(data.plan);
      FenqunAPI.toast("方案已更新");
    } catch (e) {
      planChatHistory.pop();
      renderChatMsgs("pushPlanChatMsgs", planChatHistory);
      FenqunAPI.toast(e.message);
    }
  }

  function openPushPreview() {
    if (!canDirectPush()) return FenqunAPI.toast("请填写任务标题和至少一条执行步骤");
    const executorIds = getSelectedExecutorIds();
    const title = el("pushTitle").value.trim();
    const steps = el("pushSteps").value.split("\n").map((s) => s.trim()).filter(Boolean);
    lastVerifyPoints = (el("pushVerify")?.value || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!executorIds.length) return FenqunAPI.toast("请至少选择一位执行者");
    if (!title) return FenqunAPI.toast("请填写任务标题");
    if (!steps.length) return FenqunAPI.toast("请填写至少一条执行步骤");

    const names = executorCache.filter((e) => executorIds.includes(e.id)).map((e) => e.name).join("、");
    const ch = [];
    if (el("chEmail")?.checked) ch.push("邮件");
    if (el("chMsg")?.checked) ch.push("站内信");
    if (el("chPrinter")?.checked) ch.push("小票机 " + (el("pushPrinterCode")?.value || "4004904861"));
    el("pushPreviewMeta").textContent = `任务：${title} · 执行者：${names} · 时限：${el("pushDeadline").value || "本周内"}`;
    const chBox = el("pushPreviewChannels");
    if (chBox) chBox.textContent = ch.length ? `推送渠道：${ch.join(" · ")}` : "请至少选择一种推送渠道";
    el("pushPreviewSteps").innerHTML = steps
      .map(function (s, i) {
        return `<label class="push-check-item"><input type="checkbox" checked data-step="${i}"/><span>${i + 1}. ${s}</span></label>`;
      })
      .join("");
    el("pushPreviewVerify").innerHTML = lastVerifyPoints.length
      ? `<p class="muted"><b>验收点：</b></p>${lastVerifyPoints.map((v) => `<label class="push-check-item"><input type="checkbox" checked disabled/><span>${v}</span></label>`).join("")}`
      : "";
    el("pushPreviewModal").style.display = "flex";
  }

  function formatPushResultToast(r, base) {
    let toast = base;
    if (r.printer?.ok) toast += `；小票机 ${r.printer.machineCode} 已打印`;
    else if (r.printer?.ok === false) toast += `；小票机未打印：${r.printer.error || "未知错误"}`;
    if (r.warnings?.length) toast += `（${r.warnings.join("；")}）`;
    return toast;
  }

  async function doPush() {
    const executorIds = getSelectedExecutorIds();
    const storeId = getStoreId();
    const title = el("pushTitle").value.trim();
    const steps = el("pushSteps").value.split("\n").map((s) => s.trim()).filter(Boolean);
    lastVerifyPoints = (el("pushVerify")?.value || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const channels = [];
    if (el("chEmail").checked) channels.push("email");
    if (el("chMsg").checked) channels.push("message");
    if (el("chPrinter")?.checked) channels.push("printer");
    el("btnConfirmPush").disabled = true;
    try {
      const r = await FenqunAPI.api("/executors/push", {
        method: "POST",
        body: {
          executorIds,
          storeId,
          title,
          steps,
          brief: el("pushBrief").value.trim(),
          deadline: el("pushDeadline").value,
          channels,
          images: attachImages,
          templateId: selectedTemplateId,
          verifyPoints: lastVerifyPoints,
        },
      });
      const names = (r.assignees || []).map((a) => a.name).join("、");
      FenqunAPI.toast(formatPushResultToast(r, `已推送给 ${r.count} 位执行者：${names}`));
      el("pushPreviewModal").style.display = "none";
      el("pushWorkflowCard").style.display = "none";
      el("pushTitle").value = "";
      el("pushBrief").value = "";
      el("pushSteps").value = "";
      el("pushVerify").value = "";
      el("pushExtra").value = "";
      el("pushAiPreview").innerHTML = "";
      el("pushDecisionPanel").innerHTML = "";
      resetDecisionChat();
      resetPlanChat();
      attachImages = [];
      lastVerifyPoints = [];
      lastDecision = null;
      planReady = false;
      selectedTemplateId = null;
      pendingTemplateId = null;
      hideTplConfirm();
      renderImages();
      renderTemplates();
      if (window.switchTab) {
        window.switchTab("tasks");
        window.loadTasks?.();
      }
    } catch (e) {
      FenqunAPI.toast(e.message);
    } finally {
      el("btnConfirmPush").disabled = false;
    }
  }

  function applyPoster(url, topic) {
    if (!url) return;
    addImage(url);
    if (topic && !el("pushTitle").value) {
      applyTemplate("hotspot_poster");
      el("pushTitle").value = `热点海报落地：${topic}`;
    }
    if (window.switchTab) window.switchTab("push");
    FenqunAPI.toast("海报已加入推送内容");
  }

  function init() {
    if (init.done) return;
    init.done = true;
    pushAiProg = window.FQ_AI && FQ_AI.createProgressController(el("pushAiProgressHost"));
    loadTemplates();
    loadInsight();
    loadPrinterConfig();
    renderImages();

    el("pushStore")?.addEventListener("change", function () {
      loadInsight();
      loadPrinterConfig();
      selectedTemplateId = null;
      pendingTemplateId = null;
      hideTplConfirm();
      lastDecision = null;
      planReady = false;
      resetDecisionChat();
      resetPlanChat();
      el("pushWorkflowCard").style.display = "none";
      renderTemplates();
      loadExecutors?.();
    });

    el("btnExecAll")?.addEventListener("click", function () {
      el("pushExecChecks")?.querySelectorAll("input[type=checkbox]").forEach((x) => {
        x.checked = true;
      });
    });
    el("btnExecClear")?.addEventListener("click", function () {
      el("pushExecChecks")?.querySelectorAll("input[type=checkbox]").forEach((x) => {
        x.checked = false;
      });
    });
    el("btnAddImage")?.addEventListener("click", function () {
      const url = el("pushImageUrl").value.trim();
      if (!url) return FenqunAPI.toast("请输入图片 URL");
      addImage(url);
      el("pushImageUrl").value = "";
    });
    el("btnPickPoster")?.addEventListener("click", pickPoster);
    el("posterPickClose")?.addEventListener("click", function () {
      el("posterPickModal").style.display = "none";
    });
    el("btnUseLatestPoster")?.addEventListener("click", function () {
      const url = window._latestPosterUrl;
      if (!url) return FenqunAPI.toast("请先在热点海报页生成海报");
      addImage(url);
      FenqunAPI.toast("已使用最新海报");
    });
    el("btnAiRefine")?.addEventListener("click", aiRefine);
    el("btnDecisionFollowup")?.addEventListener("click", decisionFollowup);
    el("btnPlanFollowup")?.addEventListener("click", planFollowup);
    el("pushDecisionChatInput")?.addEventListener("keydown", function (e) {
      if (e.key === "Enter") decisionFollowup();
    });
    el("pushPlanChatInput")?.addEventListener("keydown", function (e) {
      if (e.key === "Enter") planFollowup();
    });
    el("btnTplConfirm")?.addEventListener("click", confirmAndGenerate);
    el("btnTplSkip")?.addEventListener("click", skipAiAndFill);
    ["pushTitle", "pushSteps", "pushVerify"].forEach(function (id) {
      el(id)?.addEventListener("input", updatePushReady);
    });
    el("btnTplCancel")?.addEventListener("click", cancelTplConfirm);
    el("btnSavePrinter")?.addEventListener("click", savePrinterConfig);
    el("btnTestPrinter")?.addEventListener("click", testPrinter);
    el("btnDirectPush")?.addEventListener("click", openPushPreview);
    el("pushPreviewClose")?.addEventListener("click", function () {
      el("pushPreviewModal").style.display = "none";
    });
    el("btnConfirmPush")?.addEventListener("click", doPush);
  }

  async function loadPrinterConfig() {
    const storeId = getStoreId();
    const input = el("pushPrinterCode");
    if (!storeId || !input) return;
    try {
      const data = await FenqunAPI.api("/stores/" + storeId + "/printer");
      input.value = data.machineCode || data.defaultMachineCode || "4004904861";
      input.placeholder = data.defaultMachineCode || "4004904861";
    } catch (e) {
      input.value = "4004904861";
    }
  }

  async function savePrinterConfig() {
    const storeId = getStoreId();
    const code = el("pushPrinterCode")?.value?.trim();
    if (!storeId || !code) return FenqunAPI.toast("请填写终端号");
    try {
      const r = await FenqunAPI.api("/stores/" + storeId + "/printer", {
        method: "PUT",
        body: { machineCode: code },
      });
      FenqunAPI.toast("小票机已保存：" + r.machineCode);
    } catch (e) {
      FenqunAPI.toast(e.message);
    }
  }

  async function testPrinter() {
    const storeId = getStoreId();
    if (!storeId) return FenqunAPI.toast("请先选择门店");
    const code = el("pushPrinterCode")?.value?.trim();
    if (code) {
      try {
        await FenqunAPI.api("/stores/" + storeId + "/printer", {
          method: "PUT",
          body: { machineCode: code },
        });
      } catch (e) {
        return FenqunAPI.toast(e.message);
      }
    }
    try {
      const r = await FenqunAPI.api("/stores/" + storeId + "/printer/test", { method: "POST" });
      FenqunAPI.toast("测试小票已发送至 " + r.machineCode);
    } catch (e) {
      FenqunAPI.toast(e.message);
    }
  }

  function openFromReport(opts) {
    init();
    const name = opts?.name || "数据报告";
    const extra = el("pushExtra");
    if (extra) {
      extra.value = `来源数据报告：${name}\n请结合报告中的策略要点与近 7 天门店数据，生成可落地的执行方案。`;
    }
    if (opts?.templateId) {
      previewTemplate(opts.templateId);
    } else {
      FenqunAPI.toast("已跳转策略推送，请选择样板并确认生成 AI 决策");
    }
  }

  window.PushStrategy = {
    init,
    loadInsight,
    loadPrinterConfig,
    applyPoster,
    applyTemplate,
    addImage,
    renderExecutors,
    openFromReport,
  };
})();
