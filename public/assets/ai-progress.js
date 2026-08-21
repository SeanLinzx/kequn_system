/** 分群系统 — AI / 异步任务进度条（与 demo 一致） */
(function () {
  function createProgressController(anchorEl) {
    if (!anchorEl) {
      return {
        start() {}, tickFromContent() {}, complete() {}, fail() {}, hide() {}, el: null,
      };
    }
    let wrap = anchorEl.querySelector(":scope > .ai-progress-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.className = "ai-progress-wrap";
      wrap.hidden = true;
      wrap.innerHTML =
        '<div class="ai-progress-head">' +
        '<span class="spinner"></span>' +
        '<span class="ai-progress-text">处理中…</span>' +
        '<span class="ai-progress-pct">0%</span>' +
        "</div>" +
        '<div class="ai-progress-track"><div class="ai-progress-bar"></div></div>';
      anchorEl.appendChild(wrap);
    }
    const bar = wrap.querySelector(".ai-progress-bar");
    const pctEl = wrap.querySelector(".ai-progress-pct");
    const textEl = wrap.querySelector(".ai-progress-text");
    let timer = null;
    let value = 0;

    function set(v, text) {
      value = Math.max(0, Math.min(100, v));
      bar.style.width = value + "%";
      pctEl.textContent = Math.round(value) + "%";
      if (text) textEl.textContent = text;
      wrap.classList.toggle("is-done", value >= 100);
    }

    return {
      start(label) {
        wrap.hidden = false;
        wrap.classList.remove("is-done", "is-error");
        set(8, label || "处理中…");
        clearInterval(timer);
        timer = setInterval(function () {
          if (value < 88) set(value + Math.random() * 2.5 + 0.8);
        }, 450);
      },
      tickFromContent(len) {
        const est = Math.min(96, 22 + (typeof len === "number" ? len : 0) / 10);
        if (est > value) set(est);
      },
      complete(label) {
        clearInterval(timer);
        set(100, label || "完成");
        setTimeout(function () {
          wrap.hidden = true;
          wrap.classList.remove("is-done", "is-error");
          set(0);
        }, 900);
      },
      fail(msg) {
        clearInterval(timer);
        wrap.classList.add("is-error");
        textEl.textContent = msg || "失败";
        bar.style.width = "100%";
        pctEl.textContent = "!";
      },
      hide() {
        clearInterval(timer);
        wrap.hidden = true;
        wrap.classList.remove("is-done", "is-error");
        set(0);
      },
      el: wrap,
    };
  }

  /** 包装非流式 AI 请求：自动 start / complete / fail */
  async function runWithProgress(prog, label, fn) {
    prog.start(label || "AI 处理中…");
    try {
      const result = await fn(function (hint) {
        if (typeof hint === "number") prog.tickFromContent(hint);
        else if (typeof hint === "string") prog.tickFromContent(hint.length);
      });
      prog.complete("完成");
      return result;
    } catch (err) {
      prog.fail(err?.message || "失败");
      throw err;
    }
  }

  window.FQ_AI = { createProgressController, runWithProgress };
})();
