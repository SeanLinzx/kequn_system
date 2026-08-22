(function () {
  const API_BASE =
    location.hostname === "localhost" || location.hostname === "127.0.0.1"
      ? "http://localhost:3011/api"
      : "/kequn/system/api";

  function getToken() {
    return localStorage.getItem("fenqun_token");
  }

  function setSession(data) {
    localStorage.setItem("fenqun_token", data.token);
    localStorage.setItem("fenqun_user", JSON.stringify(data.user));
    localStorage.setItem("fenqun_stores", JSON.stringify(data.stores || []));
  }

  function clearSession() {
    localStorage.removeItem("fenqun_token");
    localStorage.removeItem("fenqun_user");
    localStorage.removeItem("fenqun_stores");
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem("fenqun_user"));
    } catch {
      return null;
    }
  }

  function getStores() {
    try {
      return JSON.parse(localStorage.getItem("fenqun_stores")) || [];
    } catch {
      return [];
    }
  }

  async function api(path, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    const token = getToken();
    if (token) headers.Authorization = "Bearer " + token;
    if (opts.body && !(opts.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(opts.body);
    }
    const resp = await fetch(API_BASE + path, Object.assign({}, opts, { headers }));
    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
    if (!resp.ok) throw new Error(data.error || "HTTP " + resp.status);
    return data;
  }

  function requireRole(roles, redirect) {
    const user = getUser();
    if (!user || !getToken()) {
      location.href = "./index.html";
      return null;
    }
    if (roles && !roles.includes(user.role)) {
      location.href = redirect || roleHome(user.role);
      return null;
    }
    if (user.must_change_password) {
      location.href = "./change-password.html";
      return null;
    }
    return user;
  }

  function roleHome(role) {
    if (role === "super_admin") return "./admin.html";
    if (role === "ops_manager") return "./ops.html";
    if (role === "store_manager") return "./ops.html";
    return "./executor.html";
  }

  function toast(msg) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("show");
    setTimeout(function () {
      el.classList.remove("show");
    }, 3000);
  }

  function fmtDate(d) {
    return d.toISOString().slice(0, 10);
  }

  function daysAgo(n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return fmtDate(d);
  }

  function updateSession(data) {
    if (data.token) localStorage.setItem("fenqun_token", data.token);
    if (data.user) localStorage.setItem("fenqun_user", JSON.stringify(data.user));
    if (data.stores) localStorage.setItem("fenqun_stores", JSON.stringify(data.stores));
  }

  async function refreshSession() {
    const data = await api("/auth/me");
    updateSession(data);
    return data;
  }

  function parseTaskIdFromLink(link) {
    if (!link) return null;
    const m = String(link).match(/[?&]task=(\d+)/);
    return m ? Number(m[1]) : null;
  }

  function isTrustedOrigin(origin) {
    if (!origin || origin === "null") return false;
    if (origin === location.origin) return true;
    try {
      return new URL(origin).hostname === location.hostname;
    } catch {
      return false;
    }
  }

  function bindLogout(btnId) {
    const btn = document.getElementById(btnId || "logoutBtn");
    if (btn) {
      btn.onclick = function () {
        clearSession();
        location.href = "./index.html";
      };
    }
  }

  window.FenqunAPI = {
    API_BASE,
    api,
    getToken,
    setSession,
    updateSession,
    refreshSession,
    clearSession,
    getUser,
    getStores,
    requireRole,
    roleHome,
    toast,
    fmtDate,
    daysAgo,
    parseTaskIdFromLink,
    isTrustedOrigin,
    bindLogout,
  };
})();
