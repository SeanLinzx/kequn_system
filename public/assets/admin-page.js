const user = FenqunAPI.requireRole(["super_admin"]);
if (!user) throw new Error("auth");
FenqunTopbar.init({ pageTitle: "系统管理" });
document.getElementById("userName").textContent = user.name;
FenqunAPI.bindLogout();

document.querySelectorAll(".sidebar nav a[data-tab]").forEach(function (a) {
  a.onclick = function (e) {
    e.preventDefault();
    document.querySelectorAll(".sidebar nav a").forEach((x) => x.classList.remove("active"));
    a.classList.add("active");
    ["dashboard", "stores", "users"].forEach(function (t) {
      document.getElementById("tab-" + t).style.display = t === a.dataset.tab ? "block" : "none";
    });
    if (a.dataset.tab === "users") loadExecutorsAdmin();
  };
});

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
    .map((r) => `<tr><td>${r.action}</td><td>${r.count}</td><td>${r.tokens || 0}</td></tr>`)
    .join("") || "<tr><td colspan='3'>暂无数据</td></tr>";

  document.getElementById("storeHealth").innerHTML = (data.stores || [])
    .map(function (s) {
      const h = s.health?.health || "gray";
      const tag =
        h === "red"
          ? '<span class="tag tag-red">风险</span>'
          : h === "yellow"
            ? '<span class="tag tag-yellow">关注</span>'
            : '<span class="tag tag-green">健康</span>';
      return `<div class="solution-item">
        <h4>${s.name} ${s.is_real ? "" : "（模拟）"} ${tag}</h4>
        <p class="muted">${s.health?.summary || ""}</p>
        <p>主要风险：${s.health?.worstFactor || "—"}</p>
      </div>`;
    })
    .join("");
}

async function loadBrandDashboard() {
  const data = await FenqunAPI.api("/admin/brand-dashboard");
  const html = (data.brands || []).map(function (b) {
    const cards = (b.stores || []).map(function (s) {
      const h = s.health?.health || "gray";
      const tag =
        h === "red" ? '<span class="tag tag-red">风险</span>'
        : h === "yellow" ? '<span class="tag tag-yellow">关注</span>'
        : h === "green" ? '<span class="tag tag-green">健康</span>'
        : '<span class="tag tag-gray">无数据</span>';
      return `<div class="solution-item">
        <h4>${s.name} ${s.isReal ? "（真实）" : "（模拟）"} ${tag}</h4>
        <p class="muted">${s.health?.summary || "—"}</p>
      </div>`;
    }).join("");
    return `<div style="margin-bottom:16px">
      <h4 style="margin:0 0 8px"><span class="tag tag-blue">${b.brand}</span> <span class="muted">${b.storeCount} 家门店</span></h4>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px">${cards}</div>
    </div>`;
  }).join("");
  document.getElementById("brandDashboard").innerHTML = html || "<p class='muted'>暂无品牌数据</p>";
}

async function loadExecutorsAdmin() {
  const data = await FenqunAPI.api("/executors");
  const rows = (data.executors || []).map(function (ex) {
    const bound = (ex.bindings || []).map((b) => `<span class="tag tag-green">${b.storeName}</span>`).join(" ") || "<span class='muted'>未绑定</span>";
    return `<tr class="executor-row" data-id="${ex.id}">
      <td><strong>${ex.name}</strong></td>
      <td>${ex.email}</td>
      <td>${bound}</td>
      <td>待办 ${ex.taskStats?.pending || 0} · 完成 ${ex.taskStats?.done || 0}</td>
      <td class="exec-actions">
        <button type="button" class="btn secondary btn-xs adm-ex-edit" data-id="${ex.id}">编辑</button>
        <button type="button" class="btn warn btn-xs adm-ex-del" data-id="${ex.id}">删除</button>
      </td>
    </tr>`;
  }).join("");
  document.getElementById("admExecutorList").innerHTML = rows
    ? `<div class="table-wrap"><table class="exec-table">
        <thead><tr><th>姓名</th><th>邮箱</th><th>绑定门店</th><th>任务</th><th>操作</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`
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

async function loadUsers() {
  const data = await FenqunAPI.api("/admin/users");
  document.getElementById("userList").innerHTML = data.users
    .map(function (u) {
      const stores = data.bindings
        .filter((b) => b.user_id === u.id)
        .map((b) => b.store_id)
        .join(", ");
      return `<div class="solution-item"><h4>${u.name}</h4>
        <p>${u.email} · <span class="tag tag-blue">${u.role}</span></p>
        <p class="muted">门店：${stores || "全部"}</p></div>`;
    })
    .join("");
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

loadStats();
loadBrandDashboard();
loadUsers();
loadExecutorsAdmin();
