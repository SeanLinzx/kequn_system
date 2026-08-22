// 登录页：账号密码登录 + 记住账号密码（本地保存，支持下拉选择历史账号）
// 说明：已移除「一键登录」快捷登录逻辑，登录必须输入账号密码
const SAVED_KEY = "fenqun_saved_accounts"; // [{email, password}]
const MAX_SAVED = 10;

const u = FenqunAPI.getUser();
if (u && FenqunAPI.getToken()) location.href = FenqunAPI.roleHome(u.role);

const emailEl = document.getElementById("email");
const pwdEl = document.getElementById("password");
const rememberEl = document.getElementById("rememberPwd");
const clearBtn = document.getElementById("clearSaved");
const errEl = document.getElementById("err");

// ---------- 记住账号密码 ----------
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(SAVED_KEY)) || []; }
  catch { return []; }
}

function saveAccount(email, password) {
  if (!email) return;
  if (!rememberEl.checked || !password) return; // 未勾选记住：本次不保存（保留已有记录）
  const saved = loadSaved().filter((s) => s.email !== email);
  saved.unshift({ email, password });
  localStorage.setItem(SAVED_KEY, JSON.stringify(saved.slice(0, MAX_SAVED)));
  refreshDatalist();
}

function refreshDatalist() {
  const saved = loadSaved();
  const dl = document.getElementById("savedAccounts");
  dl.innerHTML = "";
  for (const s of saved) {
    const opt = document.createElement("option");
    opt.value = s.email;
    dl.appendChild(opt);
  }
  clearBtn.style.display = saved.length ? "inline" : "none";
}

// 从 datalist 选择账号 → 自动填充密码
function fillFromSaved(email) {
  const saved = loadSaved();
  const hit = saved.find((s) => s.email === email);
  if (hit && hit.password) {
    pwdEl.value = hit.password;
    rememberEl.checked = true;
  } else {
    pwdEl.value = "";
  }
}

// datalist 没有 change 事件，用 input 监听（选择项 value 变化时触发）
let lastEmail = "";
emailEl.addEventListener("input", function () {
  const v = emailEl.value;
  if (v && v !== lastEmail) fillFromSaved(v);
  lastEmail = v;
});

clearBtn.onclick = function () {
  localStorage.removeItem(SAVED_KEY);
  refreshDatalist();
  FenqunAPI.toast("已清除记住的账号");
};

// ---------- 登录 ----------
async function doLogin(email, password) {
  errEl.style.display = "none";
  try {
    const data = await FenqunAPI.api("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    saveAccount(email, password);
    FenqunAPI.setSession(data);
    // 首次登录强制修改密码（新建/被重置账号）
    location.href = data.user.must_change_password
      ? "./change-password.html"
      : FenqunAPI.roleHome(data.user.role);
  } catch (ex) {
    errEl.textContent = ex.message;
    errEl.style.display = "block";
  }
}

document.getElementById("loginForm").onsubmit = function (e) {
  e.preventDefault();
  doLogin(emailEl.value.trim(), pwdEl.value);
};

// 初始化：加载已记住的最近账号（填充邮箱，密码留空由用户选择或输入）
refreshDatalist();
const saved = loadSaved();
if (saved.length && !emailEl.value) {
  emailEl.value = saved[0].email;
  if (rememberEl.checked && saved[0].password) {
    pwdEl.value = saved[0].password;
  }
  lastEmail = saved[0].email;
}
