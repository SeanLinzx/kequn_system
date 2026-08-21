(function () {
  const ROLE_LABELS = {
    super_admin: "超级管理员",
    ops_manager: "运营决策者",
    executor: "执行者",
  };

  let panelOpen = false;
  let notifOpen = false;
  let lastOpts = {};
  let eventsBound = false;
  let notifData = { messages: [], unread: 0 };
  let notifTimer = null;

  function avatarLetter(name) {
    return (name || "?").trim().charAt(0) || "?";
  }

  function closePanel() {
    panelOpen = false;
    const panel = document.getElementById("userMenuPanel");
    const trigger = document.getElementById("userMenuTrigger");
    if (panel) panel.classList.remove("open");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  }

  function openPanel() {
    panelOpen = true;
    const panel = document.getElementById("userMenuPanel");
    const trigger = document.getElementById("userMenuTrigger");
    if (panel) panel.classList.add("open");
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    fillProfileForm();
  }

  function togglePanel() {
    if (panelOpen) closePanel();
    else openPanel();
  }

  function closeNotif() {
    notifOpen = false;
    const panel = document.getElementById("notifPanel");
    const trigger = document.getElementById("notifTrigger");
    if (panel) panel.classList.remove("open");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  }

  function openNotif() {
    notifOpen = true;
    const panel = document.getElementById("notifPanel");
    const trigger = document.getElementById("notifTrigger");
    if (panel) panel.classList.add("open");
    if (trigger) trigger.setAttribute("aria-expanded", "true");
    refreshNotif();
  }

  function toggleNotif() {
    if (notifOpen) closeNotif();
    else openNotif();
  }

  function timeAgo(iso) {
    if (!iso) return "";
    return String(iso).slice(0, 16).replace("T", " ");
  }

  function renderNotifPanel() {
    const list = document.getElementById("notifList");
    const badge = document.getElementById("notifBadge");
    if (badge) {
      if (notifData.unread > 0) {
        badge.textContent = notifData.unread > 99 ? "99+" : notifData.unread;
        badge.style.display = "inline-flex";
      } else {
        badge.style.display = "none";
      }
    }
    if (!list) return;
    const messages = (notifData.messages || []).slice(0, 20);
    if (!messages.length) {
      list.innerHTML = '<p class="notif-empty muted">暂无消息通知</p>';
      return;
    }
    list.innerHTML = messages
      .map(function (m) {
        const unread = !m.is_read ? " notif-item--unread" : "";
        return `<button type="button" class="notif-item${unread}" data-id="${m.id}">
          <span class="notif-item-hd"><strong>${m.title}</strong><span class="muted notif-item-time">${timeAgo(m.created_at)}</span></span>
          <span class="notif-item-body">${m.body || ""}</span>
        </button>`;
      })
      .join("");
    list.querySelectorAll(".notif-item").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        const msg = messages.find((m) => String(m.id) === btn.dataset.id);
        if (!msg) return;
        closeNotif();
        if (lastOpts.onOpenMessage) {
          await lastOpts.onOpenMessage(msg);
          refreshNotif();
        } else {
          try {
            await FenqunAPI.api("/messages/" + msg.id + "/read", { method: "POST" });
          } catch (_) { /* ignore */ }
          refreshNotif();
        }
      });
    });
  }

  async function refreshNotif() {
    try {
      notifData = await FenqunAPI.api("/messages");
    } catch (_) {
      notifData = { messages: [], unread: 0 };
    }
    renderNotifPanel();
  }

  async function markAllNotifRead() {
    try {
      await FenqunAPI.api("/messages/read-all", { method: "POST" });
    } catch (_) { /* ignore */ }
    refreshNotif();
  }

  function startNotifPolling() {
    refreshNotif();
    clearInterval(notifTimer);
    notifTimer = setInterval(refreshNotif, 45000);
  }

  function fillProfileForm() {
    const user = FenqunAPI.getUser();
    if (!user) return;
    const nameEl = document.getElementById("profileName");
    const emailEl = document.getElementById("profileEmail");
    const roleEl = document.getElementById("profileRole");
    const curPwd = document.getElementById("profileCurPwd");
    const newPwd = document.getElementById("profileNewPwd");
    if (nameEl) nameEl.value = user.name || "";
    if (emailEl) emailEl.value = user.email || "";
    if (roleEl) roleEl.textContent = ROLE_LABELS[user.role] || user.role;
    if (curPwd) curPwd.value = "";
    if (newPwd) newPwd.value = "";
  }

  async function saveProfile(e) {
    e.preventDefault();
    const body = {
      name: document.getElementById("profileName").value.trim(),
      email: document.getElementById("profileEmail").value.trim(),
    };
    const cur = document.getElementById("profileCurPwd").value;
    const neu = document.getElementById("profileNewPwd").value;
    if (neu) {
      body.currentPassword = cur;
      body.newPassword = neu;
    }
    try {
      const data = await FenqunAPI.api("/auth/me", { method: "PUT", body });
      FenqunAPI.updateSession(data);
      FenqunAPI.toast("资料已保存");
      const sidebarName = document.getElementById("userName");
      if (sidebarName) sidebarName.textContent = data.user.name;
      init(lastOpts);
      closePanel();
    } catch (err) {
      FenqunAPI.toast(err.message);
    }
  }

  function bindPanelEvents() {
    if (eventsBound) return;
    eventsBound = true;
    document.addEventListener("click", function (e) {
      if (e.target.closest("#notifTrigger")) {
        e.stopPropagation();
        toggleNotif();
        return;
      }
      if (e.target.closest("#notifMarkAllRead")) {
        e.stopPropagation();
        markAllNotifRead();
        return;
      }
      if (e.target.closest("#userMenuTrigger")) {
        e.stopPropagation();
        togglePanel();
        return;
      }
      if (e.target.closest("#profileLogout")) {
        FenqunAPI.clearSession();
        location.href = "/kequn/system/";
        return;
      }
      if (e.target.closest("#profileCancel")) {
        closePanel();
        return;
      }
      const wrap = document.getElementById("userMenuWrap");
      if (panelOpen && wrap && !wrap.contains(e.target)) closePanel();
      const notifWrap = document.getElementById("notifWrap");
      if (notifOpen && notifWrap && !notifWrap.contains(e.target)) closeNotif();
    });
    document.addEventListener("submit", function (e) {
      if (e.target.id === "profileForm") saveProfile(e);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closePanel();
        closeNotif();
      }
    });
  }

  function init(opts) {
    opts = opts || {};
    lastOpts = opts;
    const user = FenqunAPI.getUser();
    if (!user) return;

    let bar = document.getElementById("appTopbar");
    if (!bar) {
      bar = document.createElement("header");
      bar.id = "appTopbar";
      bar.className = "topbar";
      const area = document.querySelector(".main-area");
      if (area) area.insertBefore(bar, area.firstChild);
      else {
        const main = document.querySelector(".main");
        if (main?.parentElement) {
          const wrap = document.createElement("div");
          wrap.className = "main-area";
          main.parentElement.insertBefore(wrap, main);
          wrap.appendChild(bar);
          wrap.appendChild(main);
        }
      }
    }

    const roleLabel = ROLE_LABELS[user.role] || user.role;
    const workspaceName = opts.pageTitle || document.title.split("·")[0].trim();
    const homeHref = FenqunAPI.roleHome(user.role);

    bar.innerHTML = `
      <div class="topbar-left">
        <a href="${homeHref}" class="topbar-brand"><img src="assets/logo-icon.png" alt="分群数据" class="brand-logo icon"/></a>
        <span class="topbar-sep">/</span>
        <span class="topbar-crumb-home">${workspaceName}</span>
        <span class="topbar-crumb-chevron" id="topbarCrumbChevron" style="display:none">›</span>
        <span class="topbar-crumb-current" id="topbarCrumbCurrent"></span>
      </div>
      <div class="topbar-right">
        <div class="notif-wrap" id="notifWrap">
          <button type="button" class="notif-trigger" id="notifTrigger" aria-haspopup="true" aria-expanded="false" title="消息通知">
            <span class="notif-bell">🔔</span>
            <span class="notif-badge" id="notifBadge" style="display:none">0</span>
          </button>
          <div class="notif-panel" id="notifPanel">
            <div class="notif-panel-hd">
              <strong>消息通知</strong>
              <button type="button" class="btn-link" id="notifMarkAllRead">全部已读</button>
            </div>
            <div class="notif-list" id="notifList"><p class="muted notif-empty">加载中…</p></div>
          </div>
        </div>
        <div class="user-menu-wrap" id="userMenuWrap">
          <button type="button" class="user-menu-trigger" id="userMenuTrigger" aria-haspopup="true" aria-expanded="false">
            <span class="user-avatar">${avatarLetter(user.name)}</span>
            <span class="user-menu-info">
              <span class="topbar-name">${user.name}</span>
              <span class="topbar-email-sm">${user.email}</span>
            </span>
            <span class="user-menu-chevron">▾</span>
          </button>
          <div class="user-menu-panel" id="userMenuPanel">
            <div class="user-menu-hd">
              <strong>个人中心</strong>
              <span class="tag tag-blue">${roleLabel}</span>
            </div>
            <form id="profileForm" class="profile-form">
              <div class="field"><label>姓名</label><input type="text" id="profileName" required/></div>
              <div class="field"><label>邮箱</label><input type="email" id="profileEmail" required/></div>
              <div class="field"><label>角色</label><span id="profileRole" class="profile-readonly"></span></div>
              <div class="field"><label>修改密码（选填）</label>
                <input type="password" id="profileCurPwd" placeholder="当前密码" autocomplete="current-password"/>
                <input type="password" id="profileNewPwd" placeholder="新密码（至少6位）" style="margin-top:6px" autocomplete="new-password"/>
              </div>
              <div class="profile-actions">
                <button type="submit" class="btn">保存资料</button>
                <button type="button" class="btn secondary" id="profileCancel">取消</button>
              </div>
            </form>
            <div class="user-menu-foot">
              <button type="button" class="btn warn user-logout-btn" id="profileLogout">退出登录</button>
            </div>
          </div>
        </div>
      </div>`;

    bindPanelEvents();
    fillProfileForm();
    startNotifPolling();
    document.getElementById("userMenuOverlay")?.remove();
  }

  function setPageTitle(title) {
    const currentEl = document.getElementById("topbarCrumbCurrent");
    const chevronEl = document.getElementById("topbarCrumbChevron");
    if (!currentEl) return;
    if (title) {
      currentEl.textContent = title;
      currentEl.style.display = "inline-flex";
      if (chevronEl) chevronEl.style.display = "inline-block";
    } else {
      currentEl.textContent = "";
      currentEl.style.display = "none";
      if (chevronEl) chevronEl.style.display = "none";
    }
  }

  window.FenqunTopbar = { init, ROLE_LABELS, closePanel, closeNotif, refreshNotif, setPageTitle };
})();
