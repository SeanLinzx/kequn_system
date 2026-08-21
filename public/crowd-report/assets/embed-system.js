/** 运营系统报告库嵌入（客群价值 Demo 通用） */
(function () {
  if (!/[?&]embed=system/.test(location.search)) return;

  const params = new URLSearchParams(location.search);
  const reportName = params.get("reportName") || document.title || "数据报告";

  const DEMO_TEMPLATE = {
    "demo1-crowd-report": "hourly_display",
    "demo2-hourly-promo": "hourly_display",
    "demo3-hot-products": "traffic_boost",
    "demo4-cross-industry": "traffic_boost",
    "demo5-trade-area-map": "traffic_boost",
    "demo6-premium-stores-map": "hourly_display",
    "demo7-category-battle-map": "hourly_display",
    "demo8-product-matrix": "aov_lift",
  };

  function resolveTemplate() {
    const path = location.pathname;
    for (const [key, id] of Object.entries(DEMO_TEMPLATE)) {
      if (path.includes(key)) return id;
    }
    return params.get("templateId") || null;
  }

  function init() {
    document.documentElement.classList.add("fenqun-embed-system");
    if (!document.getElementById("fenqunEmbedStyle")) {
      const style = document.createElement("style");
      style.id = "fenqunEmbedStyle";
      style.textContent = `
        html.fenqun-embed-system .site-header .back-link { display:none!important }
        html.fenqun-embed-system .fenqun-push-cta { margin:24px 0 12px;padding:18px 20px;background:linear-gradient(135deg,#eff6ff,#f0f9ff);border:1px solid #93c5fd;border-radius:12px;text-align:center }
        html.fenqun-embed-system .fenqun-push-btn { padding:12px 22px;background:#2563eb;color:#fff;border:none;border-radius:10px;font-size:.92rem;font-weight:700;cursor:pointer;font-family:inherit }
        html.fenqun-embed-system .fenqun-push-hint { margin:8px 0 0;font-size:.78rem;color:#64748b }
      `;
      document.head.appendChild(style);
    }

    const host = document.querySelector(".page-wrap") || document.querySelector("main") || document.body;
    if (!host || document.getElementById("fenqunPushCta")) return;

    const cta = document.createElement("div");
    cta.id = "fenqunPushCta";
    cta.className = "fenqun-push-cta";
    cta.innerHTML =
      '<button type="button" class="fenqun-push-btn">基于该策略生成 AI 执行方案并推送</button>' +
      '<p class="fenqun-push-hint">将跳转至运营工作台 · 策略推送，结合近 7 天数据生成可执行方案</p>';
    host.appendChild(cta);

    cta.querySelector("button").addEventListener("click", function () {
      window.parent.postMessage(
        { type: "fenqun:push-from-report", name: reportName, url: location.href, templateId: resolveTemplate() },
        "*",
      );
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
