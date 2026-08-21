/** 分群数据 demo — AI 流式生成进度条 */
(function () {
  const MODEL = "deepseek-v4-flash";

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
        '<span class="ai-progress-text">AI 正在生成…</span>' +
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
        set(8, label || "AI 正在生成…");
        clearInterval(timer);
        timer = setInterval(function () {
          if (value < 85) set(value + Math.random() * 2.5 + 0.8);
        }, 450);
      },
      tickFromContent(len) {
        const est = Math.min(96, 22 + len / 10);
        if (est > value) set(est);
      },
      complete() {
        clearInterval(timer);
        set(100, "生成完成");
        setTimeout(function () {
          wrap.hidden = true;
          wrap.classList.remove("is-done", "is-error");
          set(0);
        }, 900);
      },
      fail(msg) {
        clearInterval(timer);
        wrap.classList.add("is-error");
        textEl.textContent = msg || "生成失败";
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

  async function callAIStream(systemPrompt, userPrompt, onUpdate, progressCtrl) {
    progressCtrl && progressCtrl.start();
    try {
      const resp = await fetch("/api/v3/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          stream: true,
          temperature: 0.4,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
        }),
      });
      if (!resp.ok) throw new Error("AI 接口错误 HTTP " + resp.status);
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let full = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop();
        for (let i = 0; i < lines.length; i++) {
          const t = lines[i].trim();
          if (!t.startsWith("data:")) continue;
          const payload = t.slice(5).trim();
          if (payload === "[DONE]") continue;
          try {
            const delta = JSON.parse(payload).choices?.[0]?.delta?.content || "";
            if (delta) {
              full += delta;
              progressCtrl && progressCtrl.tickFromContent(full.length);
              onUpdate(full);
            }
          } catch (e) { /* skip malformed chunk */ }
        }
      }
      progressCtrl && progressCtrl.complete();
      return full;
    } catch (err) {
      progressCtrl && progressCtrl.fail("生成失败，请重试");
      throw err;
    }
  }

  window.FQ_AI = {
    MODEL: MODEL,
    callAIStream: callAIStream,
    createProgressController: createProgressController,
  };
})();
