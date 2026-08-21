const user = FenqunAPI.requireRole(["executor"]);
if (!user) throw new Error("auth");
document.getElementById("userName").textContent = user.name;
FenqunAPI.bindLogout();

function highlightTaskCard(taskId) {
  const card = document.getElementById("task-" + taskId);
  if (!card) return false;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.style.border = "2px solid #2563eb";
  return true;
}

async function handleOpenMessage(msg) {
  const taskId = FenqunAPI.parseTaskIdFromLink(msg.link);
  if (taskId && highlightTaskCard(taskId)) return;
  FenqunAPI.toast(msg.body || msg.title || "暂无更多详情");
}

FenqunTopbar.init({ pageTitle: "执行者任务台", onOpenMessage: handleOpenMessage });

async function loadTasks() {
  const data = await FenqunAPI.api("/tasks?status=pending");
  const data2 = await FenqunAPI.api("/tasks?status=in_progress");
  const tasks = [...data.tasks, ...data2.tasks];
  const focusId = new URLSearchParams(location.search).get("task");

  document.getElementById("taskContainer").innerHTML = tasks.length
    ? tasks
        .map(function (t) {
          const open = focusId && String(t.id) === focusId;
          return `<div class="card task-card" id="task-${t.id}" ${open ? 'style="border:2px solid #2563eb"' : ""}>
          <h3>${t.title}</h3>
          ${t.brief ? `<p class="task-brief">${t.brief}</p>` : ""}
          <p class="muted">截止：${t.deadline || "尽快"} · 创建：${t.created_at}</p>
          ${(t.attachImages || []).length ? `<div class="task-ref-images"><p class="muted">参考图/海报：</p>${t.attachImages.map((u) => `<a href="${u}" target="_blank"><img src="${u}" class="photo-preview" style="max-width:200px"/></a>`).join("")}</div>` : ""}
          <div class="checklist">
            ${t.checklist
              .map(
                (c, i) =>
                  `<label><input type="checkbox" data-task="${t.id}" data-idx="${i}" ${c.done ? "checked" : ""}/> ${c.text}</label>`,
              )
              .join("")}
          </div>
          <div style="margin:12px 0">
            <input type="file" accept="image/*" data-upload="${t.id}"/>
            <div class="photos" id="photos-${t.id}">
              ${(t.photoUrls || []).map((u) => `<img src="${u}" class="photo-preview"/>`).join("")}
            </div>
          </div>
          <button class="btn" data-complete="${t.id}">提交完成</button>
        </div>`;
        })
        .join("")
    : "<div class='card'><p class='muted'>暂无待办任务</p></div>";

  document.querySelectorAll('input[type="checkbox"][data-task]').forEach(function (cb) {
    cb.onchange = async function () {
      const taskId = cb.dataset.task;
      const card = document.getElementById("task-" + taskId);
      const checklist = Array.from(card.querySelectorAll('input[type="checkbox"]')).map(
        function (c) {
          return { text: c.parentElement.textContent.trim(), done: c.checked };
        },
      );
      await FenqunAPI.api("/tasks/" + taskId + "/checklist", {
        method: "PATCH",
        body: { checklist },
      });
    };
  });

  document.querySelectorAll("input[data-upload]").forEach(function (inp) {
    inp.onchange = async function () {
      if (!inp.files[0]) return;
      const fd = new FormData();
      fd.append("photo", inp.files[0]);
      const token = FenqunAPI.getToken();
      const resp = await fetch(FenqunAPI.API_BASE + "/tasks/" + inp.dataset.upload + "/photo", {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: fd,
      });
      const data = await resp.json();
      if (!resp.ok) return FenqunAPI.toast(data.error || "上传失败");
      document.getElementById("photos-" + inp.dataset.upload).innerHTML = data.photoUrls
        .map((u) => `<img src="${u}" class="photo-preview"/>`)
        .join("");
      FenqunAPI.toast("照片已上传");
    };
  });

  document.querySelectorAll("[data-complete]").forEach(function (btn) {
    btn.onclick = async function () {
      try {
        await FenqunAPI.api("/tasks/" + btn.dataset.complete + "/complete", { method: "POST" });
        FenqunAPI.toast("任务已完成！");
        loadTasks();
      } catch (e) {
        FenqunAPI.toast(e.message);
      }
    };
  });
}

loadTasks();
