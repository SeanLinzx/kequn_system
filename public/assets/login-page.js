const ACCOUNTS = {
  admin: { email: "admin@fenqun.local", pass: "Admin@2026" },
  ops: { email: "ops@fenqun.local", pass: "Ops@2026" },
  store: { email: "store@fenqun.local", pass: "Store@2026" },
  exec: { email: "exec@fenqun.local", pass: "Exec@2026" },
};

const u = FenqunAPI.getUser();
if (u && FenqunAPI.getToken()) location.href = FenqunAPI.roleHome(u.role);

async function doLogin(email, password) {
  const err = document.getElementById("err");
  err.style.display = "none";
  try {
    const data = await FenqunAPI.api("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    FenqunAPI.setSession(data);
    location.href = FenqunAPI.roleHome(data.user.role);
  } catch (ex) {
    err.textContent = ex.message;
    err.style.display = "block";
  }
}

document.getElementById("loginForm").onsubmit = function (e) {
  e.preventDefault();
  doLogin(
    document.getElementById("email").value,
    document.getElementById("password").value,
  );
};

document.querySelectorAll(".demo-btn").forEach(function (btn) {
  btn.onclick = function () {
    const a = ACCOUNTS[btn.dataset.role];
    if (!a) return;
    document.getElementById("email").value = a.email;
    document.getElementById("password").value = a.pass;
    doLogin(a.email, a.pass);
  };
});
