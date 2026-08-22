/* 系统管理面板（角色感知）：
   super_admin：总览/门店(创建+品牌过滤)/设备(只读+过滤)/控制台(只读+过滤)/品牌(管理)/令牌(只读)/用户
   ops_manager：门店(创建+本品牌)/设备(只读+过滤)/控制台(只读+过滤)/品牌(只读含token)/令牌(只读)
   store_manager：门店(本店只读)/设备(本店只读)/控制台(本店只读)/令牌(本店只读) */
const user = FenqunAPI.requireRole(["super_admin", "ops_manager", "store_manager"]);
if (!user) throw new Error("auth");
const ROLE = user.role;
const isSuper = ROLE === "super_admin";
const isOps = ROLE === "ops_manager";
FenqunTopbar.init({ pageTitle: "系统管理" });
document.getElementById("userName").textContent = `${user.name}（${ROLE}）`;
FenqunAPI.bindLogout();
document.getElementById("pageSub").textContent =
  isSuper ? "品牌 · 门店 · 摄像头设备 · 接入令牌 · 本地控制台" :
  isOps ? `品牌运营视图：本品牌（${user.name}）门店、设备、令牌与控制台` :
  "门店视图：本店设备、令牌与控制台";

// ============ Tab 权限 ============
const ALL_TABS = ["dashboard", "stores", "devices", "consoles", "brands", "tokens", "releases", "users"];
const ROLE_TABS = {
  super_admin: ALL_TABS,
  ops_manager: ["stores", "devices", "consoles", "brands", "tokens", "users"],
  store_manager: ["stores", "devices", "consoles", "tokens"],
};
const ACTIVE_TABS = ROLE_TABS[ROLE];

// 隐藏无权限 Tab
document.querySelectorAll(".sidebar nav a[data-tab]").forEach((a) => {
  if (!ACTIVE_TABS.includes(a.dataset.tab)) a.style.display = "none";
});
ALL_TABS.forEach((t) => {
  if (!ACTIVE_TABS.includes(t)) {
    const sec = document.getElementById("tab-" + t);
    if (sec) sec.style.display = "none";
  }
});
// 超管保留"返回运营工作台"外链；其余角色经此进入管理
document.getElementById("pageSub").style.display = "block";

let activeTab = ACTIVE_TABS[0];
document.querySelectorAll(".sidebar nav a[data-tab]").forEach(function (a) {
  a.onclick = function (e) {
    e.preventDefault();
    document.querySelectorAll(".sidebar nav a").forEach((x) => x.classList.remove("active"));
    a.classList.add("active");
    ACTIVE_TABS.forEach(function (t) {
      document.getElementById("tab-" + t).style.display = t === a.dataset.tab ? "block" : "none";
    });
    activeTab = a.dataset.tab;
    if (activeTab === "stores") loadStores();
    if (activeTab === "devices") loadDevices();
    if (activeTab === "consoles") loadConsoles();
    if (activeTab === "brands") loadBrands();
    if (activeTab === "tokens") loadTokens();
    if (activeTab === "releases") loadReleases();
    if (activeTab === "users") { loadExecutorsAdmin(); loadUsers(); }
    if (activeTab === "dashboard") loadStats();
  };
});

function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmtT(v) { return v ? String(v).replace("T", " ").slice(0, 19) : "—"; }
function copyText(text, label) {
  navigator.clipboard.writeText(text).then(() => FenqunAPI.toast(`${label}已复制`)).catch(() => FenqunAPI.toast("复制失败"));
}

// ============ 品牌 ============
let brandsCache = [];
async function loadBrands() {
  try {
    const data = await FenqunAPI.api("/brands");
    brandsCache = data.brands || [];
    const canManage = isSuper;
    document.getElementById("brandCreateCard").style.display = canManage ? "" : "none";
    document.getElementById("brandList").innerHTML = brandsCache.length
      ? `<div class="table-wrap"><table class="exec-table">
          <thead><tr><th>编码</th><th>名称</th><th>门店数</th><th>品牌令牌</th>${canManage ? "<th>操作</th>" : ""}</tr></thead>
          <tbody>${brandsCache.map((b) => `<tr>
            <td><code>${esc(b.code)}</code></td>
            <td><strong>${esc(b.name)}</strong></td>
            <td>${b.store_count}</td>
            <td>${b.token ? `<code class="copy-input" style="max-width:170px">${esc(b.token)}</code> <button class="btn secondary btn-xs tk-copy" data-token="${esc(b.token)}">复制</button>` : '<span class="muted">—</span>'}</td>
            ${canManage ? `<td>
              <button class="btn secondary btn-xs br-rename" data-id="${b.id}" data-name="${esc(b.name)}">重命名</button>
              <button class="btn warn btn-xs br-del" data-id="${b.id}" data-name="${esc(b.name)}">删除</button>
            </td>` : ""}
          </tr>`).join("")}</tbody></table></div>`
      : "<p class='muted'>暂无品牌</p>";
    fillBrandSelect(document.getElementById("stBrand"), isOps && brandsCache.length ? brandsCache[0].id : "");
    // 统一填充三个"按品牌过滤"下拉（门店/设备/控制台）
    fillBrandFilter("stFilterBrand");
    fillBrandFilter("dvFilterBrand");
    fillBrandFilter("csFilterBrand");
    document.querySelectorAll(".tk-copy").forEach((btn) => {
      btn.onclick = () => copyText(btn.dataset.token, "令牌");
    });
    if (canManage) {
      document.querySelectorAll(".br-rename").forEach((btn) => {
        btn.onclick = function () {
          const name = prompt("新的品牌名称：", btn.dataset.name);
          if (name && name.trim()) renameBrand(btn.dataset.id, name.trim());
        };
      });
      document.querySelectorAll(".br-del").forEach((btn) => {
        btn.onclick = async function () {
          if (!confirm(`确定删除品牌「${btn.dataset.name}」？`)) return;
          try {
            await FenqunAPI.api("/brands/" + btn.dataset.id, { method: "DELETE" });
            FenqunAPI.toast("已删除");
            loadBrands();
          } catch (e) { FenqunAPI.toast(e.message); }
        };
      });
    }
  } catch (e) {
    document.getElementById("brandList").innerHTML = `<div class="warn-box">${esc(e.message)}</div>`;
  }
}
function fillBrandSelect(sel, selectedId) {
  const opts = brandsCache.length
    ? brandsCache.map((b) => `<option value="${b.id}" ${String(b.id) === String(selectedId) ? "selected" : ""}>${esc(b.name)}</option>`)
    : ['<option value="">无品牌</option>'];
  sel.innerHTML = isOps ? opts.join("") : `<option value="">不限品牌</option>` + opts.join("");
}

/** 填充"按品牌过滤"下拉（保留当前选中值） */
function fillBrandFilter(id) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="">全部品牌</option>' +
    (brandsCache || []).map((b) => `<option value="${b.id}" ${String(b.id) === String(cur) ? "selected" : ""}>${esc(b.name)}</option>`).join("");
}
async function renameBrand(id, name) {
  try {
    await FenqunAPI.api("/brands/" + id, { method: "PUT", body: { name } });
    FenqunAPI.toast("已重命名");
    loadBrands();
  } catch (e) { FenqunAPI.toast(e.message); }
}
document.getElementById("brSave").onclick = async function () {
  const code = document.getElementById("brCode").value.trim();
  const name = document.getElementById("brName").value.trim();
  if (!code || !name) return FenqunAPI.toast("请填写品牌编码和名称");
  try {
    await FenqunAPI.api("/brands", { method: "POST", body: { code, name } });
    FenqunAPI.toast("品牌已创建（品牌令牌已自动生成）");
    document.getElementById("brCode").value = "";
    document.getElementById("brName").value = "";
    loadBrands();
  } catch (e) { FenqunAPI.toast(e.message); }
};

// ============ 门店 ============
async function loadStores() {
  try {
    const brandId = document.getElementById("stFilterBrand")?.value || "";
    const q = brandId ? "?brandId=" + brandId : "";
    const data = await FenqunAPI.api("/stores" + q);
    const stores = data.stores || [];
    const canCreate = isSuper || isOps;
    const canDelete = isSuper;
    document.getElementById("storeCreateCard").style.display = canCreate ? "" : "none";
    // 品牌过滤（仅超管可见；选项由 loadBrands 统一填充）
    const filterRow = document.getElementById("stFilterRow");
    if (filterRow) filterRow.style.display = isSuper ? "" : "none";
    document.getElementById("storeList").innerHTML = stores.length
      ? `<div class="table-wrap"><table class="exec-table">
          <thead><tr><th>编码</th><th>名称</th><th>品牌</th><th>地址</th><th>演示</th><th>门店令牌</th>${canDelete ? "<th>操作</th>" : ""}</tr></thead>
          <tbody>${stores.map((s) => `<tr>
            <td><code>${esc(s.code)}</code></td>
            <td><strong>${esc(s.name)}</strong></td>
            <td>${esc(s.brand || "—")}</td>
            <td class="muted">${esc(s.location || "—")}</td>
            <td>${s.is_demo ? '<span class="tag tag-yellow">演示</span>' : '<span class="tag tag-green">真实</span>'}</td>
            <td>${s.token ? `<code class="copy-input" style="max-width:150px">${esc(s.token)}</code> <button class="btn secondary btn-xs tk-copy" data-token="${esc(s.token)}">复制</button>` : '<span class="muted">—</span>'}</td>
            ${canDelete ? `<td><button class="btn warn btn-xs st-del" data-id="${s.id}" data-name="${esc(s.name)}">删除</button></td>` : ""}
          </tr>`).join("")}</tbody></table></div>`
      : "<p class='muted'>暂无门店</p>";
    document.querySelectorAll(".tk-copy").forEach((btn) => {
      btn.onclick = () => copyText(btn.dataset.token, "令牌");
    });
    if (canDelete) {
      document.querySelectorAll(".st-del").forEach((btn) => {
        btn.onclick = async function () {
          if (!confirm(`确定删除门店「${btn.dataset.name}」？`)) return;
          try {
            await FenqunAPI.api("/stores/" + btn.dataset.id, { method: "DELETE" });
            FenqunAPI.toast("已删除");
            loadStores();
          } catch (e) { FenqunAPI.toast(e.message); }
        };
      });
    }
    // 填充设备/控制台的门店过滤下拉
    fillStoreFilter("dvFilterStore", stores);
    fillStoreFilter("csFilterStore", stores);
  } catch (e) {
    document.getElementById("storeList").innerHTML = `<div class="warn-box">${esc(e.message)}</div>`;
  }
}
function fillStoreFilter(id, stores) {
  const sel = document.getElementById(id);
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">全部门店</option>' +
    stores.map((s) => `<option value="${s.id}" ${String(s.id) === String(current) ? "selected" : ""}>${esc(s.name)}</option>`).join("");
}
document.getElementById("stSave").onclick = async function () {
  const name = document.getElementById("stName").value.trim();
  if (!name) return FenqunAPI.toast("请填写门店名称");
  const body = {
    name,
    brandId: document.getElementById("stBrand").value || null,
    location: document.getElementById("stLocation").value.trim(),
    businessHours: document.getElementById("stHours").value.trim(),
  };
  try {
    await FenqunAPI.api("/stores", { method: "POST", body });
    FenqunAPI.toast("门店已创建（门店令牌已自动生成）");
    document.getElementById("stName").value = "";
    document.getElementById("stLocation").value = "";
    document.getElementById("stHours").value = "";
    loadStores();
  } catch (e) { FenqunAPI.toast(e.message); }
};
document.getElementById("stFilterBrand").addEventListener("change", loadStores);

// ============ 设备（只读 + 过滤） ============
const POSITION_LABELS = { OUTSIDE_PASSBY: "店外过店", ENTRANCE_COUNTER: "门口进出", INSIDE_BODY: "店内人体", UNKNOWN: "未配置" };

async function loadDevices() {
  const brandId = document.getElementById("dvFilterBrand").value || "";
  const storeId = document.getElementById("dvFilterStore").value || "";
  const params = new URLSearchParams();
  if (brandId) params.set("brandId", brandId);
  if (storeId) params.set("storeId", storeId);
  const q = params.toString() ? "?" + params.toString() : "";
  try {
    const data = await FenqunAPI.api("/devices" + q);
    const devices = data.devices || [];
    document.getElementById("deviceList").innerHTML = devices.length
      ? `<div class="table-wrap"><table class="exec-table">
          <thead><tr><th>设备名</th><th>编号</th><th>门店</th><th>类型</th><th>能力</th><th>最后上报</th></tr></thead>
          <tbody>${devices.map((d) => `<tr>
            <td><strong>${esc(d.deviceName || "—")}</strong></td>
            <td><code style="font-size:.72rem">${esc(d.deviceIndexCode)}</code></td>
            <td>${esc(d.storeName || "未绑定")}</td>
            <td><span class="tag tag-blue">${esc(POSITION_LABELS[d.positionType] || d.positionType)}</span></td>
            <td>${d.bodyCapable ? '<span class="tag tag-green">人像</span>' : ""}</td>
            <td class="muted">${fmtT(d.lastReportAt)}</td>
          </tr>`).join("")}</tbody></table></div>`
      : "<p class='muted'>暂无设备（设备由边缘控制台注册后自动出现）</p>";
  } catch (e) {
    document.getElementById("deviceList").innerHTML = `<div class="warn-box">${esc(e.message)}</div>`;
  }
}
document.getElementById("dvFilterBrand").addEventListener("change", loadDevices);
document.getElementById("dvFilterStore").addEventListener("change", loadDevices);

// ============ 控制台（只读 + 过滤） ============
async function loadConsoles() {
  const brandId = document.getElementById("csFilterBrand").value || "";
  const storeId = document.getElementById("csFilterStore").value || "";
  const params = new URLSearchParams();
  if (brandId) params.set("brandId", brandId);
  if (storeId) params.set("storeId", storeId);
  const q = params.toString() ? "?" + params.toString() : "";
  try {
    const data = await FenqunAPI.api("/consoles" + q);
    const consoles = data.consoles || [];
    document.getElementById("consoleList").innerHTML = consoles.length
      ? `<div class="table-wrap"><table class="exec-table">
          <thead><tr><th>门店</th><th>品牌</th><th>控制台</th><th>局域网地址</th><th>异地访问</th><th>SSH</th><th>更新</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>${consoles.map((c) => {
            const ut = c.updateTask;
            const updCell = ut
              ? (ut.status === "pending"
                  ? `<span class="tag tag-blue">更新中 ${esc(ut.version)}</span>`
                  : ut.status === "done"
                    ? `<span class="tag tag-green">已更新 ${esc(ut.version)}</span>`
                    : `<span class="tag tag-red" title="${esc(ut.message || "")}">更新失败</span>`)
              : '<span class="muted">—</span>';
            return `<tr>
            <td><strong>${esc(c.storeName)}</strong></td>
            <td>${esc(c.brandName || "—")}</td>
            <td class="muted">${esc(c.name || c.consoleId || "—")}</td>
            <td><code>${esc(c.url || "—")}</code></td>
            <td>${c.tunnelOnline && c.tunnelUrl ? `<a class="btn secondary" href="${esc(c.tunnelUrl)}" target="_blank" rel="noopener">异地打开</a>` : '<span class="muted">隧道离线</span>'}</td>
            <td>${c.sshPort ? `<button class="btn secondary btn-xs ssh-open" data-store-id="${c.storeId}" data-name="${esc(c.storeName)}" ${c.sshOnline ? "" : "disabled"}>SSH 终端</button>` : '<span class="muted">未启用</span>'}</td>
            <td>${updCell}</td>
            <td>${c.online ? '<span class="tag tag-green">在线</span>' : '<span class="tag tag-gray">离线</span>'}</td>
            <td>
              <button class="btn secondary btn-xs rel-update" data-store-id="${c.storeId}" data-name="${esc(c.storeName)}" ${ut && ut.status === "pending" ? "disabled" : ""}>远程更新</button>
              ${c.url ? `<a class="btn" href="${esc(c.url)}" target="_blank" rel="noopener">打开控制台</a>` : ""}
            </td>
          </tr>`;
          }).join("")}</tbody></table></div>`
      : "<p class='muted'>暂无控制台上报。请到门店现场打开 camera-local-console，配置数据服务地址 + 接入令牌并确认门店。</p>";
    document.querySelectorAll(".ssh-open").forEach((btn) => {
      btn.onclick = () => openSshTerminal(btn.dataset.storeId, btn.dataset.name);
    });
    document.querySelectorAll(".rel-update").forEach((btn) => {
      btn.onclick = () => openRemoteUpdate(btn.dataset.storeId, btn.dataset.name);
    });
  } catch (e) {
    document.getElementById("consoleList").innerHTML = `<div class="warn-box">${esc(e.message)}</div>`;
  }
}
document.getElementById("csFilterBrand").addEventListener("change", loadConsoles);
document.getElementById("csFilterStore").addEventListener("change", loadConsoles);

// ============ 令牌（只显示） ============
async function loadTokens() {
  try {
    const data = await FenqunAPI.api("/site-tokens");
    const tokens = data.tokens || [];
    document.getElementById("tokenList").innerHTML = tokens.length
      ? `<div class="table-wrap"><table class="exec-table">
          <thead><tr><th>类型</th><th>名称</th><th>令牌</th><th>状态</th><th>最近使用</th><th>操作</th></tr></thead>
          <tbody>${tokens.map((t) => `<tr>
            <td>${t.storeId ? '<span class="tag tag-green">门店</span>' : '<span class="tag tag-blue">品牌</span>'}</td>
            <td>${esc(t.name)}</td>
            <td><code class="copy-input" style="max-width:180px">${esc(t.token)}</code></td>
            <td>${t.enabled ? '<span class="tag tag-green">启用</span>' : '<span class="tag tag-gray">停用</span>'}</td>
            <td class="muted">${fmtT(t.lastUsedAt)}</td>
            <td><button class="btn secondary btn-xs tk-copy" data-token="${esc(t.token)}">复制</button></td>
          </tr>`).join("")}</tbody></table></div>`
      : "<p class='muted'>暂无令牌（令牌在创建品牌/门店时自动生成）</p>";
    document.querySelectorAll(".tk-copy").forEach((btn) => {
      btn.onclick = () => copyText(btn.dataset.token, "令牌");
    });
  } catch (e) {
    document.getElementById("tokenList").innerHTML = `<div class="warn-box">${esc(e.message)}</div>`;
  }
}

// ============ 总览 / 用户（超管） ============
async function loadStats() {
  const data = await FenqunAPI.api("/admin/stats");
  const done = (data.taskStats || []).find((t) => t.status === "done");
  const total = (data.taskStats || []).reduce((s, t) => s + t.c, 0);
  document.getElementById("kpiGrid").innerHTML = `
    <div class="kpi"><div class="val">${data.posterCount}</div><div class="lbl">海报生成数</div></div>
    <div class="kpi"><div class="val">${data.userCount}</div><div class="lbl">系统用户</div></div>
    <div class="kpi"><div class="val">${data.stores.length}</div><div class="lbl">门店数</div></div>
    <div class="kpi"><div class="val">${total ? Math.round(((done?.c || 0) / total) * 100) : 0}%</div><div class="lbl">任务完成率</div></div>`;
  document.querySelector("#aiTable tbody").innerHTML = (data.aiUsage || [])
    .map((r) => `<tr><td>${esc(r.action)}</td><td>${r.count}</td><td>${r.tokens || 0}</td></tr>`)
    .join("") || "<tr><td colspan='3'>暂无数据</td></tr>";
  document.getElementById("brandDashboard").innerHTML = (data.brands || [])
    .map(function (b) {
      const cards = (b.stores || []).map(function (s) {
        const h = s.health?.health || "gray";
        const tag =
          h === "red" ? '<span class="tag tag-red">风险</span>'
          : h === "yellow" ? '<span class="tag tag-yellow">关注</span>'
          : h === "green" ? '<span class="tag tag-green">健康</span>'
          : '<span class="tag tag-gray">无数据</span>';
        return `<div class="solution-item"><h4>${esc(s.name)} ${s.isReal ? "（真实）" : "（演示）"} ${tag}</h4><p class="muted">${esc(s.health?.summary || "—")}</p></div>`;
      }).join("");
      return `<div style="margin-bottom:16px">
        <h4 style="margin:0 0 8px"><span class="tag tag-blue">${esc(b.brand)}</span> <span class="muted">${b.storeCount} 家门店</span></h4>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px">${cards}</div>
      </div>`;
    }).join("");
}

async function loadExecutorsAdmin() {
  const data = await FenqunAPI.api("/executors");
  const rows = (data.executors || []).map(function (ex) {
    const bound = (ex.bindings || []).map((b) => `<span class="tag tag-green">${esc(b.storeName)}</span>`).join(" ") || "<span class='muted'>未绑定</span>";
    return `<tr class="executor-row" data-id="${ex.id}">
      <td><strong>${esc(ex.name)}</strong></td>
      <td>${esc(ex.email)}</td>
      <td>${bound}</td>
      <td>待办 ${ex.taskStats?.pending || 0} · 完成 ${ex.taskStats?.done || 0}</td>
      <td class="exec-actions">
        <button type="button" class="btn secondary btn-xs adm-ex-edit" data-id="${ex.id}">编辑</button>
        <button type="button" class="btn warn btn-xs adm-ex-del" data-id="${ex.id}">删除</button>
      </td>
    </tr>`;
  }).join("");
  document.getElementById("admExecutorList").innerHTML = rows
    ? `<div class="table-wrap"><table class="exec-table"><thead><tr><th>姓名</th><th>邮箱</th><th>绑定门店</th><th>任务</th><th>操作</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : "<p class='muted'>暂无执行者</p>";
  document.querySelectorAll(".adm-ex-edit").forEach(function (btn) {
    btn.onclick = function () {
      const ex = data.executors.find((e) => String(e.id) === btn.dataset.id);
      if (!ex) return;
      document.getElementById("admExEditId").value = ex.id;
      document.getElementById("admExName").value = ex.name;
      document.getElementById("admExEmail").value = ex.email;
      document.getElementById("admExPass").value = "";
      document.getElementById("admExCancel").style.display = "inline-block";
    };
  });
  document.querySelectorAll(".adm-ex-del").forEach(function (btn) {
    btn.onclick = async function () {
      const ex = data.executors.find((e) => String(e.id) === btn.dataset.id);
      if (!ex || !confirm(`确定删除「${ex.name}」？`)) return;
      try {
        await ExecutorAdmin.deleteExecutor(ex.id);
        FenqunAPI.toast("已删除");
        loadExecutorsAdmin();
        loadUsers();
      } catch (e) { FenqunAPI.toast(e.message); }
    };
  });
}

document.getElementById("admExSave").onclick = async function () {
  const editId = document.getElementById("admExEditId").value;
  const name = document.getElementById("admExName").value.trim();
  const email = document.getElementById("admExEmail").value.trim();
  const pass = document.getElementById("admExPass").value;
  if (!name || !email) return FenqunAPI.toast("请填写姓名和邮箱");
  if (!editId && !pass) return FenqunAPI.toast("新增需设置密码");
  try {
    await ExecutorAdmin.saveExecutor({ editId: editId || null, name, email, password: pass || undefined });
    FenqunAPI.toast("已保存");
    document.getElementById("admExEditId").value = "";
    document.getElementById("admExName").value = "";
    document.getElementById("admExEmail").value = "";
    document.getElementById("admExPass").value = "";
    document.getElementById("admExCancel").style.display = "none";
    loadExecutorsAdmin();
    loadUsers();
  } catch (e) { FenqunAPI.toast(e.message); }
};

document.getElementById("admExCancel").onclick = function () {
  document.getElementById("admExEditId").value = "";
  document.getElementById("admExName").value = "";
  document.getElementById("admExEmail").value = "";
  document.getElementById("admExPass").value = "";
  document.getElementById("admExCancel").style.display = "none";
};

// ============ 系统用户管理（超管 / 品牌管理员） ============
let userRoleOptions = [];
let userStoreOptions = [];

async function initUserMgmt() {
  const meta = await FenqunAPI.api("/users/meta/roles");
  userRoleOptions = meta.roles || [];
  const roleSel = document.getElementById("admUserRole");
  roleSel.innerHTML = userRoleOptions
    .map((r) => `<option value="${r}">${esc(ROLE_LABEL(r))}</option>`)
    .join("");
  await refreshUserStores();
  await loadUsers();
  document.getElementById("admUserSave").onclick = saveUser;
  document.getElementById("admUserCancel").onclick = resetUserForm;
}

function ROLE_LABEL(r) {
  return { super_admin: "超级管理员", ops_manager: "品牌管理员", store_manager: "门店管理员", executor: "执行者" }[r] || r;
}

async function refreshUserStores() {
  const stores = await FenqunAPI.api("/stores?all=1");
  const list = stores.stores || stores || [];
  const sel = document.getElementById("admUserStores");
  sel.innerHTML = list
    .map((s) => `<option value="${s.id}">${esc(s.brand_name || s.name)} · ${esc(s.name)}</option>`)
    .join("");
  userStoreOptions = list;
}

async function loadUsers() {
  const data = await FenqunAPI.api("/users");
  const users = data.users || [];
  const listEl = document.getElementById("admUserList");
  if (!users.length) {
    listEl.innerHTML = "<p class='muted'>暂无用户</p>";
    return;
  }
  listEl.innerHTML = `<div class="table-wrap"><table class="exec-table">
    <thead><tr><th>姓名</th><th>邮箱</th><th>角色</th><th>绑定门店</th><th>状态</th><th>操作</th></tr></thead>
    <tbody>${users.map(renderUserRow).join("")}</tbody></table></div>`;
  document.querySelectorAll(".adm-user-edit").forEach(function (btn) {
    btn.onclick = function () { editUser(Number(btn.dataset.id)); };
  });
  document.querySelectorAll(".adm-user-reset").forEach(function (btn) {
    btn.onclick = function () { resetUserPwd(Number(btn.dataset.id)); };
  });
  document.querySelectorAll(".adm-user-del").forEach(function (btn) {
    btn.onclick = function () { deleteUser(Number(btn.dataset.id)); };
  });
}

function renderUserRow(u) {
  const stores = (u.bindings || []).map((b) => b.storeName).join("、") || "—";
  const status = u.must_change_password
    ? '<span class="tag tag-yellow">待改密</span>'
    : '<span class="tag tag-green">正常</span>';
  const role = ROLE_LABEL(u.role);
  return `<tr class="executor-row">
    <td><strong>${esc(u.name)}</strong></td>
    <td>${esc(u.email)}</td>
    <td><span class="tag tag-blue">${esc(role)}</span></td>
    <td class="muted">${esc(stores)}</td>
    <td>${status}</td>
    <td class="exec-actions">
      <button type="button" class="btn secondary btn-xs adm-user-edit" data-id="${u.id}">编辑</button>
      <button type="button" class="btn warn btn-xs adm-user-reset" data-id="${u.id}">重置密码</button>
      <button type="button" class="btn warn btn-xs adm-user-del" data-id="${u.id}">删除</button>
    </td>
  </tr>`;
}

function resetUserForm() {
  document.getElementById("admUserEditId").value = "";
  document.getElementById("admUserName").value = "";
  document.getElementById("admUserEmail").value = "";
  document.getElementById("admUserRole").selectedIndex = 0;
  Array.from(document.querySelectorAll("#admUserStores option")).forEach((o) => (o.selected = false));
  document.getElementById("admUserPwdHint").style.display = "none";
  document.getElementById("admUserSave").textContent = "创建用户";
  document.getElementById("admUserCancel").style.display = "none";
}

function editUser(id) {
  FenqunAPI.api("/users").then(function (data) {
    const u = (data.users || []).find((x) => x.id === id);
    if (!u) return;
    document.getElementById("admUserEditId").value = id;
    document.getElementById("admUserName").value = u.name;
    document.getElementById("admUserEmail").value = u.email;
    const roleSel = document.getElementById("admUserRole");
    // 编辑时保留原角色（仅当角色在可选项内才允许改）
    if (userRoleOptions.includes(u.role)) {
      roleSel.value = u.role;
    } else {
      roleSel.innerHTML = `<option value="${u.role}">${esc(ROLE_LABEL(u.role))}</option>`;
    }
    Array.from(document.querySelectorAll("#admUserStores option")).forEach((o) => {
      o.selected = (u.bindings || []).some((b) => String(b.storeId) === o.value);
    });
    document.getElementById("admUserSave").textContent = "保存修改";
    document.getElementById("admUserCancel").style.display = "inline-block";
  });
}

async function saveUser() {
  const id = document.getElementById("admUserEditId").value;
  const body = {
    name: document.getElementById("admUserName").value.trim(),
    email: document.getElementById("admUserEmail").value.trim(),
    role: document.getElementById("admUserRole").value,
    storeIds: Array.from(document.querySelectorAll("#admUserStores option"))
      .filter((o) => o.selected)
      .map((o) => Number(o.value)),
  };
  try {
    const data = await FenqunAPI.api(id ? "/users/" + id : "/users", {
      method: id ? "PUT" : "POST",
      body,
    });
    if (!id && data.defaultPassword) {
      const hint = document.getElementById("admUserPwdHint");
      hint.textContent = `已创建 ${body.email}，默认密码：${data.defaultPassword}（首次登录强制修改）`;
      hint.style.display = "block";
    }
    FenqunAPI.toast(id ? "用户已更新" : "用户已创建");
    resetUserForm();
    await loadUsers();
  } catch (e) {
    FenqunAPI.toast(e.message);
  }
}

async function resetUserPwd(id) {
  if (!confirm("确认将该用户密码重置为默认密码？用户下次登录将强制修改密码。")) return;
  try {
    const data = await FenqunAPI.api("/users/" + id + "/reset-password", { method: "POST" });
    const hint = document.getElementById("admUserPwdHint");
    hint.textContent = `已重置 ${data.email} 的密码，默认密码：${data.defaultPassword}（下次登录强制修改）`;
    hint.style.display = "block";
    await loadUsers();
  } catch (e) {
    FenqunAPI.toast(e.message);
  }
}

async function deleteUser(id) {
  if (!confirm("确认删除该用户？此操作不可恢复。")) return;
  try {
    await FenqunAPI.api("/users/" + id, { method: "DELETE" });
    FenqunAPI.toast("用户已删除");
    await loadUsers();
  } catch (e) {
    FenqunAPI.toast(e.message);
  }
}

const hotTriggerProg = FQ_AI.createProgressController(document.getElementById("hotTriggerProgressHost"));
document.getElementById("triggerHot").onclick = async function () {
  const btn = document.getElementById("triggerHot");
  btn.disabled = true;
  try {
    await FQ_AI.runWithProgress(hotTriggerProg, "AI 汇总热点并生成推送策略…", function () {
      return FenqunAPI.api("/admin/trigger-hotspot", { method: "POST" });
    });
    FenqunAPI.toast("热点推送已触发");
  } catch (e) {
    FenqunAPI.toast(e.message);
  } finally {
    btn.disabled = false;
  }
};

// ============ 初始化 ============
if (isSuper) {
  loadStats();
  loadExecutorsAdmin();
}
// 超管与品牌管理员都可管理系统用户
if (isSuper || isOps) {
  initUserMgmt().catch(function (e) {
    FenqunAPI.toast(e.message);
  });
}
// 默认激活角色第一个可用 Tab
const firstTabEl = document.querySelector(`.sidebar nav a[data-tab="${activeTab}"]`);
if (firstTabEl) {
  document.querySelectorAll(".sidebar nav a").forEach((x) => x.classList.remove("active"));
  firstTabEl.classList.add("active");
}
ALL_TABS.forEach((t) => {
  const sec = document.getElementById("tab-" + t);
  if (sec) sec.style.display = t === activeTab ? "block" : "none";
});
loadBrands();
loadStores();

// ============ SSH Web 终端（xterm.js → /ws/ssh → ssh2 → 门店反向 SSH） ============
let sshTerm = null;
let sshFit = null;
let sshWs = null;
let sshStoreId = null;

function openSshTerminal(storeId, storeName) {
  if (typeof Terminal === "undefined" || typeof FitAddon === "undefined") {
    FenqunAPI.toast("xterm 组件加载失败（需要网络访问 CDN）");
    return;
  }
  sshStoreId = storeId;
  document.getElementById("sshTitle").textContent = "SSH 终端 · " + (storeName || "门店");
  document.getElementById("sshStatus").textContent = "正在连接…";
  document.getElementById("sshModal").style.display = "flex";

  const termEl = document.getElementById("sshTerm");
  termEl.innerHTML = "";
  sshTerm = new Terminal({ cursorBlink: true, fontSize: 13, fontFamily: "Menlo, Consolas, monospace" });
  sshFit = new FitAddon.FitAddon();
  sshTerm.loadAddon(sshFit);
  sshTerm.open(termEl);
  sshFit.fit();
  sshTerm.focus();

  // 建立 WS 连接（同源，token 放 query）
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${proto}//${location.host}/ws/ssh?token=${encodeURIComponent(FenqunAPI.getToken())}`;
  sshWs = new WebSocket(wsUrl);
  sshWs.onopen = () => {
    sshWs.send(JSON.stringify({ type: "connect", storeId, cols: sshTerm.cols, rows: sshTerm.rows }));
  };
  sshWs.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    if (msg.type === "ready") {
      document.getElementById("sshStatus").textContent = "已连接（root@" + (storeName || "") + "）";
    } else if (msg.type === "out") {
      sshTerm.write(Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0)));
    } else if (msg.type === "error") {
      document.getElementById("sshStatus").textContent = msg.message;
      sshTerm.write("\r\n\x1b[31m" + msg.message + "\x1b[0m\r\n");
    }
  };
  sshWs.onclose = () => {
    document.getElementById("sshStatus").textContent = "连接已关闭";
    sshWs = null;
  };
  sshTerm.onData((data) => {
    if (sshWs && sshWs.readyState === WebSocket.OPEN) {
      sshWs.send(JSON.stringify({ type: "in", data: btoa(unescape(encodeURIComponent(data))) }));
    }
  });
  const onResize = () => {
    if (sshFit) sshFit.fit();
    if (sshWs && sshWs.readyState === WebSocket.OPEN) {
      sshWs.send(JSON.stringify({ type: "resize", cols: sshTerm.cols, rows: sshTerm.rows }));
    }
  };
  sshTerm.onResize(onResize);
  window.__sshResize = onResize;
  window.addEventListener("resize", onResize);
}
document.getElementById("sshClose").onclick = closeSshTerminal;
document.getElementById("sshModal").onclick = function (e) {
  if (e.target.id === "sshModal") closeSshTerminal();
};
function closeSshTerminal() {
  if (sshWs) { try { sshWs.close(); } catch {} }
  sshWs = null;
  if (sshTerm) { try { sshTerm.dispose(); } catch {} }
  sshTerm = null; sshFit = null;
  window.removeEventListener("resize", window.__sshResize);
  document.getElementById("sshModal").style.display = "none";
}

// ============ 发布管理（超管；合并自 release-admin） ============
const REL_CHANNEL_NAMES = { stable: "稳定版 stable", beta: "测试版 beta", canary: "灰度版 canary" };

async function loadReleases() {
  try {
    const data = await FenqunAPI.api("/releases/state");
    const st = data;
    // 通道卡片
    document.getElementById("releaseChannels").innerHTML = Object.entries(st.channels || {}).map(([name, m]) => {
      if (!m) {
        return `<div class="solution-item" style="border-left:4px solid #94a3b8">
          <h4>${REL_CHANNEL_NAMES[name] || name} <span class="tag tag-gray">未发布</span></h4>
          <p class="muted">暂无版本。</p></div>`;
      }
      const manifestUrl = `${st.baseUrl}/channels/${name}.json`;
      return `<div class="solution-item" style="border-left:4px solid #047857">
        <h4>${REL_CHANNEL_NAMES[name] || name} <span class="tag tag-green">已发布</span> <span class="tag tag-blue">${esc(m.platform)}</span></h4>
        <p><strong>版本：</strong>${esc(m.version)} · ${esc(m.notes || "暂无说明")}</p>
        <p class="muted">SHA256：<code>${esc(m.sha256)}</code></p>
        <p><a class="btn secondary btn-xs" href="${esc(m.url)}" target="_blank" rel="noopener">下载安装包</a>
           <a class="btn secondary btn-xs" href="${esc(manifestUrl)}" target="_blank" rel="noopener">查看清单</a>
           <button class="btn warn btn-xs rel-revoke" data-channel="${name}">撤回通道</button></p></div>`;
    }).join("") || "<p class='muted'>无通道数据</p>";

    // 包列表
    const pkgs = st.packages || [];
    document.getElementById("releasePackages").innerHTML = pkgs.length
      ? `<div class="table-wrap"><table class="exec-table">
          <thead><tr><th>版本</th><th>平台</th><th>状态/通道</th><th>SHA256</th><th>操作</th></tr></thead>
          <tbody>${pkgs.map((p) => {
            const chans = (p.publishedChannels || []).map((c) => REL_CHANNEL_NAMES[c] || c).join("，") || "—";
            const statusTag = (p.publishedChannels || []).length
              ? `<span class="tag tag-green">已发布</span>`
              : p.status === "revoked" ? '<span class="tag tag-gray">已撤回</span>' : '<span class="tag tag-yellow">未发布</span>';
            const canDelete = !(p.publishedChannels || []).length;
            return `<tr>
              <td><strong>${esc(p.version)}</strong><p class="muted">${esc(p.notes || "")}</p></td>
              <td>${esc(p.platform)}</td>
              <td>${statusTag} <span class="muted">${esc(chans)}</span></td>
              <td><code style="font-size:.7rem">${esc(p.sha256)}</code></td>
              <td><div class="row" style="gap:6px">
                ${["stable", "beta", "canary"].map((c) => `<button class="btn secondary btn-xs rel-promote" data-channel="${c}" data-version="${esc(p.version)}" data-platform="${esc(p.platform)}">发布到 ${c}</button>`).join("")}
                <button class="btn warn btn-xs rel-del" data-version="${esc(p.version)}" data-platform="${esc(p.platform)}" ${canDelete ? "" : "disabled title='请先从通道撤回'"}">删除</button>
              </div></td></tr>`;
          }).join("")}</tbody></table></div>`
      : "<p class='muted'>暂无安装包，请上传（win-x64 / linux-arm64 / linux-x64）</p>";

    // 历史
    document.getElementById("releaseHistory").textContent = (st.channelHistory || []).length
      ? st.channelHistory.map((h) => `${h.at}  ${h.action}  ${h.channel ? REL_CHANNEL_NAMES[h.channel] || h.channel : "-"} -> ${h.version} / ${h.platform}`).join("\n")
      : "暂无发布历史";

    document.querySelectorAll(".rel-promote").forEach((btn) => {
      btn.onclick = () => releaseApi("/releases/channels/promote", { channel: btn.dataset.channel, version: btn.dataset.version, platform: btn.dataset.platform }, `已发布到 ${REL_CHANNEL_NAMES[btn.dataset.channel] || btn.dataset.channel}`);
    });
    document.querySelectorAll(".rel-revoke").forEach((btn) => {
      btn.onclick = () => {
        if (!confirm(`确认撤回 ${REL_CHANNEL_NAMES[btn.dataset.channel] || btn.dataset.channel} 当前版本？客户端将不再从该通道检查到。`)) return;
        releaseApi("/releases/channels/revoke", { channel: btn.dataset.channel }, "已撤回");
      };
    });
    document.querySelectorAll(".rel-del").forEach((btn) => {
      btn.onclick = () => {
        if (!confirm(`确认删除 ${btn.dataset.version} / ${btn.dataset.platform}？将删除安装包与清单。`)) return;
        releaseApi("/releases/packages/delete", { version: btn.dataset.version, platform: btn.dataset.platform }, "已删除");
      };
    });
  } catch (e) {
    document.getElementById("releaseChannels").innerHTML = `<div class="warn-box">${esc(e.message)}</div>`;
  }
}

async function releaseApi(path, body, okMsg) {
  try {
    const data = await FenqunAPI.api(path, { method: "POST", body });
    FenqunAPI.toast(okMsg || "操作成功");
    if (data.suggestedNextVersion && !document.getElementById("relVersion").value) {
      document.getElementById("relVersion").value = data.suggestedNextVersion;
    }
    loadReleases();
  } catch (e) {
    FenqunAPI.toast(e.message);
  }
}

document.getElementById("relUpload").onclick = async function () {
  const file = document.getElementById("relFile").files[0];
  const version = document.getElementById("relVersion").value.trim();
  const platform = document.getElementById("relPlatform").value;
  if (!file) return FenqunAPI.toast("请选择安装包文件");
  if (!version) return FenqunAPI.toast("请填写版本号");
  const statusEl = document.getElementById("relStatus");
  const form = new FormData();
  form.append("packageFile", file);
  form.append("version", version);
  form.append("platform", platform);
  form.append("notes", document.getElementById("relNotes").value.trim());
  statusEl.textContent = "正在上传并生成清单…";
  const btn = document.getElementById("relUpload");
  btn.disabled = true;
  try {
    const data = await FenqunAPI.api("/releases/packages/upload", { method: "POST", body: form });
    statusEl.textContent = "上传成功：已生成清单（SHA256 校验通过）";
    FenqunAPI.toast("上传成功");
    document.getElementById("relFile").value = "";
    document.getElementById("relNotes").value = "";
    loadReleases();
  } catch (e) {
    statusEl.textContent = "上传失败：" + e.message;
    FenqunAPI.toast(e.message);
  } finally {
    btn.disabled = false;
  }
};

// ============ 远程更新控制台 ============
let relUpdateStoreId = null;

async function openRemoteUpdate(storeId, storeName) {
  relUpdateStoreId = storeId;
  document.getElementById("relUpdateTitle").textContent = "远程更新控制台";
  document.getElementById("relUpdateStore").value = storeName || "门店";
  const sel = document.getElementById("relUpdateVersion");
  sel.innerHTML = '<option value="">加载版本…</option>';
  document.getElementById("relUpdateModal").style.display = "flex";
  try {
    const st = await FenqunAPI.api("/releases/state");
    const pkgs = st.packages || [];
    const CH = { stable: "stable", beta: "beta", canary: "canary" };
    sel.innerHTML = pkgs.length
      ? pkgs.map((p) => {
          const chans = (p.publishedChannels || []).join("/") || "未发布";
          return `<option value="${esc(p.version)}|${esc(p.platform)}">${esc(p.version)} / ${esc(p.platform)}（${esc(chans)}）</option>`;
        }).join("")
      : '<option value="">暂无安装包（请先到发布管理上传）</option>';
  } catch (e) {
    sel.innerHTML = '<option value="">版本加载失败</option>';
    document.getElementById("relUpdateHint").textContent = "版本加载失败：" + e.message;
  }
}

document.getElementById("relUpdateGo").onclick = async function () {
  const val = document.getElementById("relUpdateVersion").value;
  if (!val || !relUpdateStoreId) return FenqunAPI.toast("请选择目标版本");
  const [version, platform] = val.split("|");
  if (!version) return FenqunAPI.toast("请选择目标版本");
  if (!confirm(`确认将门店控制台更新到 ${version}（${platform}）？控制台将自动下载、校验并重启。`)) return;
  const btn = this;
  btn.disabled = true;
  try {
    await FenqunAPI.api(`/consoles/${relUpdateStoreId}/update`, { method: "POST", body: { version, platform } });
    FenqunAPI.toast("更新任务已下发，等待控制台执行");
    document.getElementById("relUpdateModal").style.display = "none";
    loadConsoles();
    setTimeout(loadConsoles, 5000);
  } catch (e) {
    FenqunAPI.toast(e.message);
  } finally {
    btn.disabled = false;
  }
};
document.getElementById("relUpdateCancel").onclick = function () {
  document.getElementById("relUpdateModal").style.display = "none";
};
document.getElementById("relUpdateModal").onclick = function (e) {
  if (e.target.id === "relUpdateModal") document.getElementById("relUpdateModal").style.display = "none";
};
