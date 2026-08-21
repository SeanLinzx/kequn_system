/** 爆品选品工作台：模拟 Agent 定位门店 → 扫描小红书 → 输出爆品推荐（demo 模拟数据，非真实爬虫） */
(function () {
  let running = false;
  let doneForStore = null;
  let agentProg = null;

  function el(id) {
    return document.getElementById(id);
  }
  function getStoreId() {
    return window.getStoreId?.();
  }

  function setStepState(n, state) {
    const card = el("agentStep" + n);
    if (!card) return;
    card.classList.toggle("active", state === "active");
    card.classList.toggle("done", state === "done");
  }

  function appendLog(text) {
    const log = el("agentLog");
    if (!log) return;
    log.style.display = "block";
    const line = document.createElement("div");
    line.className = "agent-log-line";
    const t = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    line.innerHTML = `<span class="t">[${t}]</span>${text}`;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function renderPicks(data) {
    const box = el("agentPicksGrid");
    if (!box) return;
    box.innerHTML = `<p class="muted" style="margin-bottom:8px">共扫描 ${data.notesScanned} 篇相关笔记 · 检索关键词：${data.keywords.join("、")}</p>
      <div class="agent-pick-grid">${data.picks
        .map(
          (p, idx) => `<div class="agent-pick-card">
        <div class="agent-pick-hd"><strong>${p.name}</strong><span class="agent-heat">🔥 热度 ${p.heatIndex}</span></div>
        <p class="agent-pick-meta">${p.category} · ${p.noteCount} 篇笔记 · ${p.likeCount.toLocaleString("zh-CN")} 点赞收藏 · 预计提升进店率 +${p.expectedCaptureLiftPct}%</p>
        <p class="agent-pick-reason">${p.reason}</p>
        <p class="agent-pick-action">建议动作：${p.action}</p>
        <button type="button" class="btn secondary btn-xs btn-push-pick" data-idx="${idx}" style="margin-top:8px">推送执行者</button>
      </div>`,
        )
        .join("")}</div>`;
    box.querySelectorAll(".btn-push-pick").forEach(function (btn) {
      btn.onclick = function () {
        pushPick(data.picks[Number(btn.dataset.idx)]);
      };
    });
  }

  function pushPick(pick) {
    if (window.PushStrategy?.applyTemplate) {
      window.PushStrategy.applyTemplate("hotspot_poster");
    }
    const titleInput = el("pushTitle");
    if (titleInput && !titleInput.value) titleInput.value = `爆品上新推荐：${pick.name}`;
    const extraInput = el("pushExtra");
    if (extraInput) {
      extraInput.value = `小红书爆品选品工作台推荐：${pick.reason}。建议动作：${pick.action}（预计提升进店率 +${pick.expectedCaptureLiftPct}%）`;
    }
    window.showPushSub?.("send");
    window.switchTab?.("push");
    FenqunAPI.toast("已加入策略推送草稿，可继续完善后推送执行者");
  }

  async function runAgent() {
    if (running) return;
    running = true;
    const storeId = getStoreId();
    const btn = el("btnStartAgent");
    if (btn) btn.disabled = true;
    [1, 2, 3].forEach((n) => setStepState(n, ""));
    if (el("agentLog")) el("agentLog").innerHTML = "";
    if (el("agentPicksGrid")) el("agentPicksGrid").innerHTML = "";

    try {
      // Step 1 定位门店
      setStepState(1, "active");
      const stores = FenqunAPI.getStores?.() || [];
      const store = stores.find((s) => s.id === storeId);
      if (el("agentLocationText")) {
        el("agentLocationText").textContent = `已定位门店：${store?.name || storeId}（${store?.location || "位置获取中"}）`;
      }
      await sleep(500);
      setStepState(1, "done");

      // Step 2 启动 Agent 扫描小红书（模拟日志 + 真实请求并行）
      setStepState(2, "active");
      agentProg = agentProg || FQ_AI.createProgressController(el("agentProgressHost"));
      agentProg.start("Agent 启动中…");
      appendLog(`Agent 启动，目标门店：${store?.name || storeId}`);
      const fetchPromise = FenqunAPI.api("/posters/xiaohongshu-picks?storeId=" + storeId);
      await sleep(500);
      appendLog("正在检索小红书『零食探店』『办公室零食』等相关话题…");
      await sleep(700);
      appendLog("定位门店周边商圈笔记特征，匹配本地生活话题…");
      await sleep(700);
      appendLog("抓取笔记内容与互动数据（点赞/收藏/评论）…");
      await sleep(600);
      appendLog("提取高频关键词与商品实体，计算热度指数…");
      const data = await fetchPromise;
      await sleep(400);
      appendLog(`扫描完成，共 ${data.notesScanned} 篇笔记，识别出 ${data.picks.length} 个高潜爆品`);
      agentProg.complete("扫描完成");
      setStepState(2, "done");

      // Step 3 输出结果
      setStepState(3, "active");
      renderPicks(data);
      await sleep(200);
      setStepState(3, "done");
      doneForStore = storeId;
      FenqunAPI.toast("爆品选品完成，可一键推送执行者");
    } catch (e) {
      agentProg?.fail(e.message);
      appendLog(`出错：${e.message}`);
      FenqunAPI.toast(e.message);
    } finally {
      running = false;
      if (btn) btn.disabled = false;
    }
  }

  function onPanelShown() {
    // 面板展示时不自动运行，保留交互式"启动 Agent"按钮，模拟真实操作感
  }

  function onStoreChange() {
    doneForStore = null;
    [1, 2, 3].forEach((n) => setStepState(n, ""));
    if (el("agentLog")) { el("agentLog").innerHTML = ""; el("agentLog").style.display = "none"; }
    if (el("agentPicksGrid")) el("agentPicksGrid").innerHTML = "";
    if (el("agentLocationText")) el("agentLocationText").textContent = "点击下方按钮开始";
  }

  function init() {
    if (init.done) return;
    init.done = true;
    el("btnStartAgent")?.addEventListener("click", runAgent);
  }

  window.HotProductAgent = { init, onStoreChange, onPanelShown };
})();
