const user = FenqunAPI.requireRole(["ops_manager", "super_admin", "store_manager"]);
if (!user) throw new Error("auth");
document.getElementById("userName").textContent = user.name;
if (user.role === "super_admin") {
  document.getElementById("backAdmin").style.display = "block";
}
FenqunAPI.bindLogout();

// 门店管理员：强制单店视角，隐藏「多店对比」与「单店/多店」切换
if (user.role === "store_manager") {
  const multiLink = document.querySelector('a[data-diag="multi"]');
  if (multiLink) multiLink.style.display = "none";
  const solModeToggle = document.getElementById("sidebarSolMode");
  if (solModeToggle) solModeToggle.style.display = "none";
}

let stores = [];
const globalStore = document.getElementById("globalStore");

function populateStoreSelects() {
  globalStore.innerHTML = "";
  document.getElementById("pushStore").innerHTML = "";
  stores.forEach(function (s) {
    const label = s.is_real || s.name.includes("模拟") ? s.name : s.name + "（模拟）";
    globalStore.innerHTML += `<option value="${s.id}">${label}</option>`;
    document.getElementById("pushStore").innerHTML += `<option value="${s.id}">${s.name}</option>`;
  });
}

let currentDiag = null;
let dashboardData = null;

const TABS = ["diagnosis", "solutions-hub", "customer", "push", "tasks"];
const SOLUTION_CATS = ["site", "capture", "conversion", "aov"];
const CUSTOMER_CATS = ["report", "matrix", "age-sex", "time-peak", "flow-trend"];
const DIAG_MODES = ["overview", "dim", "multi", "report"];
const DIAG_TITLES = { overview: "业绩概览", dim: "三维度诊断", multi: "多店对比", report: "报告中心" };
const FACTOR_SOLUTION_MAP = {
  pass: { cat: "site", label: "选址与闭店策略" },
  capture: { cat: "capture", sub: "poster", label: "捕获率提升策略" },
  conv: { cat: "conversion", label: "转化率提升策略" },
  aov: { cat: "aov", label: "客单价提升策略" },
};
let currentSolutionCat = "site";
let currentDiagMode = "overview";
let currentCustomerCat = "report";
let executorCache = [];
const DEFAULT_EXEC_PASSWORD = ExecutorAdmin.DEFAULT_PASSWORD;

function getStoreId() { return globalStore.value; }

function updateSidebarStore() {
  const s = stores.find((x) => x.id === getStoreId());
  document.getElementById("sidebarStoreName").textContent = s?.name || "—";
  document.getElementById("sidebarStoreMeta").textContent = s?.is_real ? "长沙标杆店 · 完整报告库" : "演示模拟店";
}

function fillExecutorSelect(sel, storeId) {
  if (!sel) return;
  const matched = executorCache.filter((e) => !storeId || e.bindings.some((b) => b.storeId === storeId));
  sel.innerHTML = matched.length
    ? matched.map((e) => `<option value="${e.id}">${e.name}（${e.email}）</option>`).join("")
    : '<option value="">暂无可选执行者</option>';
}

function renderStoreChecks(selectedIds) {
  selectedIds = selectedIds || [];
  document.getElementById("exStoreChecks").innerHTML = stores.map(function (s) {
    const checked = selectedIds.includes(s.id) ? "checked" : "";
    return `<label class="store-check"><input type="checkbox" value="${s.id}" ${checked}/> ${s.name}</label>`;
  }).join("");
}

function getSelectedStoreIds() {
  return Array.from(document.querySelectorAll("#exStoreChecks input:checked")).map((el) => el.value);
}

function closeExecutorModal() {
  document.getElementById("executorFormModal").style.display = "none";
}

function openExecutorModal(ex) {
  const modal = document.getElementById("executorFormModal");
  if (ex) {
    document.getElementById("exEditId").value = ex.id;
    document.getElementById("exName").value = ex.name;
    document.getElementById("exEmail").value = ex.email;
    document.getElementById("exPassword").value = "";
    document.getElementById("exPassword").placeholder = "留空则不修改密码";
    document.getElementById("executorFormTitle").textContent = "编辑执行者";
    renderStoreChecks(ex.bindings.map((b) => b.storeId));
  } else {
    document.getElementById("exEditId").value = "";
    document.getElementById("exName").value = "";
    document.getElementById("exEmail").value = "";
    document.getElementById("exPassword").value = DEFAULT_EXEC_PASSWORD;
    document.getElementById("exPassword").placeholder = "默认 " + DEFAULT_EXEC_PASSWORD;
    document.getElementById("executorFormTitle").textContent = "新增执行者";
    renderStoreChecks([getStoreId()]);
  }
  modal.style.display = "flex";
}

function resetExecutorForm() {
  closeExecutorModal();
}

async function loadExecutors() {
  try {
    const data = await FenqunAPI.api("/executors");
    executorCache = data.executors || [];
    fillExecutorSelect(document.getElementById("pushExecutor"), getStoreId());
    if (window.PushStrategy?.renderExecutors) {
      PushStrategy.renderExecutors(executorCache, document.getElementById("pushStore")?.value || getStoreId());
    }
    const listEl = document.getElementById("executorList");
    if (!executorCache.length) {
      listEl.innerHTML = "<p class='muted'>暂无执行者，点击右上角「新增执行者」创建</p>";
      return;
    }
    const storeOptions = stores.map((s) => `<option value="${s.id}">${s.name}</option>`).join("");
    listEl.innerHTML = `<div class="table-wrap"><table class="exec-table">
      <thead><tr>
        <th>姓名</th><th>邮箱</th><th>绑定门店</th><th>任务</th><th>绑定操作</th><th>操作</th>
      </tr></thead>
      <tbody>${executorCache.map(function (ex) {
      const bound = ex.bindings.map((b) => `<span class="tag tag-green">${b.storeName}</span>`).join(" ") || "<span class='muted'>未绑定</span>";
      return `<tr class="executor-row" data-id="${ex.id}">
        <td><strong>${ex.name}</strong></td>
        <td>${ex.email}</td>
        <td>${bound}</td>
        <td>待办 ${ex.taskStats.pending} · 完成 ${ex.taskStats.done}</td>
        <td class="exec-bind-cell">
          <select class="bind-store">${storeOptions}</select>
          <button type="button" class="btn secondary btn-xs btn-bind" data-id="${ex.id}">绑定</button>
          <button type="button" class="btn secondary btn-xs btn-unbind" data-id="${ex.id}">解绑</button>
        </td>
        <td class="exec-actions">
          <button type="button" class="btn secondary btn-xs btn-edit-ex" data-id="${ex.id}">编辑</button>
          <button type="button" class="btn warn btn-xs btn-del-ex" data-id="${ex.id}">删除</button>
        </td>
      </tr>`;
    }).join("")}</tbody></table></div>`;

    listEl.querySelectorAll(".btn-edit-ex").forEach(function (btn) {
      btn.onclick = function () {
        const ex = executorCache.find((e) => String(e.id) === btn.dataset.id);
        if (ex) openExecutorModal(ex);
      };
    });
    listEl.querySelectorAll(".btn-del-ex").forEach(function (btn) {
      btn.onclick = async function () {
        const ex = executorCache.find((e) => String(e.id) === btn.dataset.id);
        if (!ex || !confirm(`确定删除执行者「${ex.name}」？此操作不可恢复。`)) return;
        try {
          await ExecutorAdmin.deleteExecutor(ex.id);
          FenqunAPI.toast("已删除");
          resetExecutorForm();
          loadExecutors();
        } catch (e) { FenqunAPI.toast(e.message); }
      };
    });
    listEl.querySelectorAll(".btn-bind").forEach(function (btn) {
      btn.onclick = async function () {
        const row = btn.closest(".executor-row");
        const storeId = row.querySelector(".bind-store").value;
        await FenqunAPI.api("/executors/bind", { method: "POST", body: { userId: btn.dataset.id, storeId } });
        FenqunAPI.toast("已绑定");
        loadExecutors();
      };
    });
    listEl.querySelectorAll(".btn-unbind").forEach(function (btn) {
      btn.onclick = async function () {
        await FenqunAPI.api("/executors/unbind", { method: "POST", body: { userId: btn.dataset.id, storeId: getStoreId() } });
        FenqunAPI.toast("已解绑");
        loadExecutors();
      };
    });
  } catch (e) {
    document.getElementById("executorList").innerHTML = `<div class="warn-box">${e.message}</div>`;
  }
}

document.getElementById("btnSaveExecutor").onclick = async function () {
  const editId = document.getElementById("exEditId").value;
  const body = {
    name: document.getElementById("exName").value.trim(),
    email: document.getElementById("exEmail").value.trim(),
    storeIds: getSelectedStoreIds(),
  };
  const password = document.getElementById("exPassword").value;
  if (password) body.password = password;
  if (!body.name || !body.email) return FenqunAPI.toast("请填写姓名和邮箱");
  if (!editId && !password) body.password = DEFAULT_EXEC_PASSWORD;
  try {
    await ExecutorAdmin.saveExecutor({
      editId: editId || null,
      name: body.name,
      email: body.email,
      password: body.password,
      storeIds: body.storeIds,
    });
    FenqunAPI.toast(editId ? "已更新" : "已创建，默认密码 " + DEFAULT_EXEC_PASSWORD);
    closeExecutorModal();
    loadExecutors();
  } catch (e) { FenqunAPI.toast(e.message); }
};

document.getElementById("btnCancelExecutor").onclick = closeExecutorModal;
document.getElementById("executorModalClose").onclick = closeExecutorModal;
document.getElementById("btnNewExecutor").onclick = function () { openExecutorModal(); };
document.getElementById("executorFormModal").onclick = function (e) {
  if (e.target.id === "executorFormModal") closeExecutorModal();
};

async function loadDashboard() {
  try {
    dashboardData = await FenqunAPI.api("/stores/" + getStoreId() + "/dashboard");
    DashboardUI.renderDashboardCore(document.getElementById("dashboardArea"), dashboardData);
    bindReportButtons();
    if (dashboardData.range?.hi) {
      document.getElementById("endDate").value = dashboardData.range.hi;
      const d = new Date(dashboardData.range.hi);
      d.setDate(d.getDate() - 6);
      document.getElementById("startDate").value = FenqunAPI.fmtDate(d);
      syncQuickRangeActive();
    }
  } catch (e) {
    document.getElementById("dashboardArea").innerHTML = `<div class="warn-box">${e.message}</div>`;
  }
}

function renderReportsTab() {
  if (!dashboardData) return loadDashboard().then(renderReportsTab);
  const el = document.getElementById("reportsCatalog");
  const tmp = document.createElement("div");
  DashboardUI.renderDashboard(tmp, dashboardData);
  const lanes = tmp.querySelector(".cat-lanes")?.parentElement;
  const demos = tmp.querySelector("#valueDemoCatalog");
  el.innerHTML = (lanes ? lanes.outerHTML : "") + (demos ? demos.outerHTML : "");
  bindReportButtons();
}
window.renderReportsTab = renderReportsTab;

function bindReportButtons() {
  document.querySelectorAll(".report-open").forEach(function (btn) {
    btn.onclick = function () {
      const url = btn.dataset.url;
      if (!url) return FenqunAPI.toast("请切换至长沙望城银杉路零食店查看完整报告");
      switchTab("diagnosis", { diag: "report" });
      DashboardUI.renderReportViewer(url, btn.dataset.name, btn.dataset.template || "");
    };
  });
}

function showPushSub(sub) {
  document.querySelectorAll("#pushSubNav .step-pill").forEach((p) => p.classList.toggle("active", p.dataset.pushsub === sub));
  document.getElementById("pushSubSend").style.display = sub === "send" ? "block" : "none";
  document.getElementById("pushSubExecutors").style.display = sub === "executors" ? "block" : "none";
  if (sub === "executors") loadExecutors();
}
window.showPushSub = showPushSub;
document.querySelectorAll("#pushSubNav .step-pill").forEach(function (p) {
  p.onclick = function () { showPushSub(p.dataset.pushsub); };
});

function showTaskSub(sub) {
  document.querySelectorAll("#taskSubNav .step-pill").forEach((p) => p.classList.toggle("active", p.dataset.tasksub === sub));
  document.getElementById("taskSubTracking").style.display = sub === "tracking" ? "block" : "none";
  document.getElementById("taskSubSolutions").style.display = sub === "solutions" ? "block" : "none";
  if (sub === "tracking") loadTasks(); else loadSolutions();
}
document.querySelectorAll("#taskSubNav .step-pill").forEach(function (p) {
  p.onclick = function () { showTaskSub(p.dataset.tasksub); };
});

function goToSolutionForFactor(factor) {
  const mapping = FACTOR_SOLUTION_MAP[factor];
  if (!mapping) return FenqunAPI.toast("暂无对应运营方案");
  switchTab("solutions-hub", { cat: mapping.cat });
  if (mapping.sub) SolutionsHub.setCaptureSub(mapping.sub);
  FenqunAPI.toast("已跳转至「" + mapping.label + "」");
}

function switchTab(tab, opts) {
  opts = opts || {};
  if (opts.cat && SOLUTION_CATS.includes(opts.cat)) currentSolutionCat = opts.cat;
  if (opts.cat && CUSTOMER_CATS.includes(opts.cat)) currentCustomerCat = opts.cat;
  if (opts.diag && DIAG_MODES.includes(opts.diag)) currentDiagMode = opts.diag;

  document.querySelectorAll(".sidebar nav a, .sidebar .sidebar-subnav a").forEach(function (x) {
    const linkTab = x.dataset.tab;
    const linkCat = x.dataset.cat;
    const linkDiag = x.dataset.diag;
    if (linkTab === tab) {
      if (tab === "solutions-hub") {
        x.classList.toggle("active", linkCat === currentSolutionCat);
      } else if (tab === "customer") {
        x.classList.toggle("active", linkCat === currentCustomerCat);
      } else if (tab === "diagnosis") {
        x.classList.toggle("active", linkDiag === currentDiagMode);
      } else {
        x.classList.toggle("active", true);
      }
    } else {
      x.classList.remove("active");
    }
  });

  TABS.forEach(function (t) {
    const panel = document.getElementById("tab-" + t);
    if (panel) panel.style.display = t === tab ? "block" : "none";
  });

  if (tab === "solutions-hub") {
    SolutionsHub.showCategory(currentSolutionCat);
    history.replaceState(null, "", "#solutions-" + currentSolutionCat);
  } else if (tab === "customer") {
    CustomerInsight.showCategory(currentCustomerCat);
    const customerTitles = { report: "综合报告", matrix: "客群矩阵", "age-sex": "年龄性别", "time-peak": "时段高峰", "flow-trend": "客流趋势" };
    window.FenqunTopbar?.setPageTitle?.(customerTitles[currentCustomerCat] || "客群基本信息");
    history.replaceState(null, "", "#customer-" + currentCustomerCat);
  } else if (tab === "diagnosis") {
    PerfDiagnosis.setMode(currentDiagMode);
    history.replaceState(null, "", "#diagnosis-" + currentDiagMode);
    window.FenqunTopbar?.setPageTitle?.(DIAG_TITLES[currentDiagMode] || "业绩诊断");
  } else {
    history.replaceState(null, "", "#" + tab);
    const titles = { push: "策略推送", tasks: "任务管理" };
    window.FenqunTopbar?.setPageTitle?.(titles[tab] || "运营工作台");
  }

  if (tab === "push") { loadExecutors(); PushStrategy.loadInsight?.(); PushStrategy.loadPrinterConfig?.(); }
  if (tab === "tasks") { loadTasks(); loadSolutions(); }
}

document.querySelectorAll(".sidebar nav a, .sidebar .sidebar-subnav a").forEach(function (a) {
  a.onclick = function (e) {
    e.preventDefault();
    switchTab(a.dataset.tab, { cat: a.dataset.cat, diag: a.dataset.diag });
  };
});

globalStore.onchange = function () {
  updateSidebarStore();
  document.getElementById("pushStore").value = getStoreId();
  loadDashboard();
  FunnelUI.destroyCharts?.();
  document.getElementById("diagResult").innerHTML = "";
  PerfDiagnosis.onStoreChange?.();
  SolutionsHub.onStoreChange?.();
  HotProductAgent.onStoreChange?.();
  CustomerInsight.onStoreChange?.();
};

document.getElementById("reportClose").onclick = function () {
  document.getElementById("reportViewer").style.display = "none";
  document.getElementById("reportFrame").src = "about:blank";
};

window.addEventListener("message", function (e) {
  if (!FenqunAPI.isTrustedOrigin(e.origin)) return;
  if (e.data?.type !== "fenqun:push-from-report") return;
  document.getElementById("reportViewer").style.display = "none";
  document.getElementById("reportFrame").src = "about:blank";
  showPushSub("send");
  switchTab("push");
  PushStrategy.openFromReport?.(e.data);
});

function syncQuickRangeActive() {
  const start = document.getElementById("startDate")?.value;
  const end = document.getElementById("endDate")?.value;
  if (!start || !end) return;
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  const spanDays = Math.round((endMs - startMs) / 86400000) + 1;
  document.querySelectorAll(".quick-range").forEach(function (btn) {
    btn.classList.toggle("active", Number(btn.dataset.days) === spanDays);
  });
}

function setQuickRange(days) {
  const end = dashboardData?.range?.hi || FenqunAPI.fmtDate(new Date());
  document.getElementById("endDate").value = end;
  const d = new Date(end);
  d.setDate(d.getDate() - (days - 1));
  document.getElementById("startDate").value = FenqunAPI.fmtDate(d);
  syncQuickRangeActive();
}

document.querySelectorAll(".quick-range").forEach(function (btn) {
  btn.onclick = function () {
    setQuickRange(Number(btn.dataset.days));
  };
});

document.getElementById("startDate").addEventListener("change", syncQuickRangeActive);
document.getElementById("endDate").addEventListener("change", syncQuickRangeActive);

document.getElementById("runDiag").onclick = async function () {
  try {
    currentDiag = await FenqunAPI.api("/stores/" + getStoreId() + "/diagnose", {
      method: "POST",
      body: { start: document.getElementById("startDate").value, end: document.getElementById("endDate").value },
    });
    FunnelUI.renderDiagnosis(document.getElementById("diagResult"), currentDiag);
    document.querySelectorAll(".btn-go-solution").forEach(function (btn) {
      btn.onclick = function () { goToSolutionForFactor(btn.dataset.factor); };
    });
    FenqunAPI.toast("诊断完成");
  } catch (e) { FenqunAPI.toast(e.message); }
};

window.switchTab = switchTab;
window.loadTasks = loadTasks;
window.getStoreId = getStoreId;
window.goToSolutionForFactor = goToSolutionForFactor;

document.getElementById("pushStore").onchange = function () {
  if (window.PushStrategy?.renderExecutors) {
    PushStrategy.renderExecutors(executorCache, document.getElementById("pushStore").value);
  }
};


async function loadSolutions() {
  const data = await FenqunAPI.api("/solutions?storeId=" + getStoreId());
  document.getElementById("solutionList").innerHTML = data.solutions.map((s) =>
    `<div class="solution-item"><h4>${s.title}</h4><span class="tag tag-blue">${s.status}</span>
    <ul>${(s.content || []).map((c) => "<li>" + c.title + "</li>").join("")}</ul></div>`).join("") || "<p class='muted'>暂无</p>";
}
async function loadTasks() {
  const data = await FenqunAPI.api("/tasks");
  document.getElementById("taskList").innerHTML = data.tasks.map((t) =>
    `<div class="solution-item task-card">
      <div class="card-hd-row" style="margin-bottom:6px">
        <h4 style="margin:0">${t.title}</h4>
        <span class="tag tag-${t.status === "done" ? "green" : "blue"}">${t.status === "done" ? "已完成" : t.status === "in_progress" ? "进行中" : "待办"}</span>
      </div>
      <p class="muted">执行者：${t.assignee_name || "—"} · ${t.deadline || "尽快"}</p>
      ${(t.photoUrls || []).length ? `<p class="muted">已上传 ${t.photoUrls.length} 张照片</p>` : ""}
      <button type="button" class="btn secondary btn-xs btn-task-view" data-id="${t.id}">查看详情</button>
    </div>`).join("") || "<p class='muted'>暂无</p>";
  document.querySelectorAll(".btn-task-view").forEach(function (btn) {
    btn.onclick = function () { showTaskDetail(Number(btn.dataset.id)); };
  });
}

function renderTaskDetailHtml(t) {
  const statusLabel = t.status === "done" ? "已完成" : t.status === "in_progress" ? "进行中" : "待办";
  const tagClass = t.status === "done" ? "green" : "blue";
  return `<p><span class="tag tag-${tagClass}">${statusLabel}</span> · 执行者：${t.assignee_name || "—"} · ${t.deadline || "尽快"}</p>
    ${t.brief ? `<div class="task-brief">${t.brief}</div>` : ""}
    <h4 class="task-detail-hd">执行步骤</h4>
    <ul class="task-detail-list">${(t.steps || []).map((s) => `<li>${s}</li>`).join("") || "<li class='muted'>—</li>"}</ul>
    ${(t.checklist || []).length ? `<h4 class="task-detail-hd">完成清单</h4><ul class="task-detail-list">${t.checklist.map((c) => `<li>${c.done ? "✅" : "⬜"} ${c.text}</li>`).join("")}</ul>` : ""}
    <h4 class="task-detail-hd">执行照片</h4>
    ${(t.photoUrls || []).length
      ? `<div class="task-ref-images">${t.photoUrls.map((u) => `<a href="${u}" target="_blank" rel="noopener"><img src="${u}" class="photo-preview" alt="执行照片"/></a>`).join("")}</div>`
      : "<p class='muted'>暂无上传照片</p>"}
    ${(t.attachImages || []).length
      ? `<h4 class="task-detail-hd">参考图 / 海报</h4><div class="task-ref-images">${t.attachImages.map((u) => `<img src="${u}" class="photo-preview" alt="参考图"/>`).join("")}</div>`
      : ""}`;
}

async function resolveTaskIdFromMessage(msg) {
  const fromLink = FenqunAPI.parseTaskIdFromLink(msg.link);
  if (fromLink) return fromLink;
  if (msg.title && msg.title.startsWith("任务已完成：")) {
    const title = msg.title.slice("任务已完成：".length);
    const data = await FenqunAPI.api("/tasks");
    const t = (data.tasks || []).find((x) => x.title === title && x.status === "done");
    return t?.id || null;
  }
  return null;
}

async function showTaskDetail(taskId) {
  try {
    const t = await FenqunAPI.api("/tasks/" + taskId);
    document.getElementById("taskDetailTitle").textContent = t.title;
    document.getElementById("taskDetailBody").innerHTML = renderTaskDetailHtml(t);
    document.getElementById("taskDetailModal").style.display = "flex";
  } catch (e) {
    FenqunAPI.toast(e.message);
  }
}

function closeTaskDetailModal() {
  document.getElementById("taskDetailModal").style.display = "none";
}

async function handleOpenMessage(msg) {
  try {
    await FenqunAPI.api("/messages/" + msg.id + "/read", { method: "POST" });
  } catch (_) { /* ignore */ }
  const taskId = await resolveTaskIdFromMessage(msg);
  if (taskId) {
    await showTaskDetail(taskId);
    switchTab("tasks");
    showTaskSub("tracking");
  } else if (msg.link && /poster/.test(msg.link)) {
    switchTab("solutions-hub", { cat: "capture" });
    SolutionsHub.setCaptureSub("poster");
  } else if (msg.link && /tasks/.test(msg.link)) {
    switchTab("tasks");
  } else if (msg.link && /diagnosis/.test(msg.link)) {
    switchTab("diagnosis", { diag: "report" });
  } else {
    FenqunAPI.toast(msg.body || "暂无更多详情");
  }
}

document.getElementById("taskDetailClose").onclick = closeTaskDetailModal;
document.getElementById("taskDetailModal").onclick = function (e) {
  if (e.target.id === "taskDetailModal") closeTaskDetailModal();
};

function initOpsPage() {
updateSidebarStore();
document.getElementById("pushStore").value = getStoreId();
loadDashboard();
PushStrategy.init();
PerfDiagnosis.init();
SolutionsHub.init();
HotProductAgent.init();
FenqunTopbar.init({ pageTitle: "运营工作台", onOpenMessage: handleOpenMessage });
const taskParam = new URLSearchParams(location.search).get("task");
if (taskParam) { showTaskDetail(Number(taskParam)); switchTab("tasks"); }
const hash = location.hash.replace("#", "");
if (hash.startsWith("solutions-")) {
  const cat = hash.slice("solutions-".length);
  if (SOLUTION_CATS.includes(cat)) switchTab("solutions-hub", { cat: cat });
} else if (hash.startsWith("diagnosis-")) {
  const diag = hash.slice("diagnosis-".length);
  if (DIAG_MODES.includes(diag)) switchTab("diagnosis", { diag: diag });
} else if (hash === "diagnosis") {
  switchTab("diagnosis", { diag: "overview" });
} else if (hash && TABS.includes(hash)) {
  switchTab(hash);
} else {
  switchTab("diagnosis", { diag: "overview" });
}
}

(async function bootstrap() {
  try {
    await FenqunAPI.refreshSession();
  } catch (_) { /* 沿用本地缓存 */ }
  stores = FenqunAPI.getStores();
  populateStoreSelects();
  initOpsPage();
})();
