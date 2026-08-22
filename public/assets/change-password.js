// 强制修改密码页：登录后 must_change_password=1 时进入，改密成功后清除标记并进入系统
const user = FenqunAPI.getUser();
if (!user || !FenqunAPI.getToken()) {
  location.href = "./index.html";
} else if (!user.must_change_password) {
  location.href = FenqunAPI.roleHome(user.role); // 已完成改密，直接进入
}

const errEl = document.getElementById("err");

document.getElementById("pwdForm").onsubmit = async function (e) {
  e.preventDefault();
  errEl.style.display = "none";
  const cur = document.getElementById("curPwd").value;
  const neu = document.getElementById("newPwd").value;
  const confirm = document.getElementById("confirmPwd").value;
  if (neu.length < 6) {
    errEl.textContent = "新密码至少 6 位";
    errEl.style.display = "block";
    return;
  }
  if (neu !== confirm) {
    errEl.textContent = "两次输入的新密码不一致";
    errEl.style.display = "block";
    return;
  }
  if (neu === cur) {
    errEl.textContent = "新密码不能与当前密码相同";
    errEl.style.display = "block";
    return;
  }
  try {
    const data = await FenqunAPI.api("/auth/me", {
      method: "PUT",
      body: {
        name: user.name,
        email: user.email,
        currentPassword: cur,
        newPassword: neu,
      },
    });
    FenqunAPI.updateSession(data); // 后端已清除 must_change_password
    // 同步更新登录页记住的密码（原保存的是默认密码，已过期）
    try {
      const SAVED_KEY = "fenqun_saved_accounts";
      const saved = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]");
      const idx = saved.findIndex((s) => s.email === data.user.email);
      if (idx >= 0) {
        saved[idx].password = neu;
        localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
      }
    } catch {}
    location.href = FenqunAPI.roleHome(data.user.role);
  } catch (ex) {
    errEl.textContent = ex.message;
    errEl.style.display = "block";
  }
};
