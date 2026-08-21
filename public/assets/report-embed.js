/** 数据报告库 iframe 嵌入：隐藏侧边栏 + 底部推送 CTA */
(function () {
  const PATH_TEMPLATE = {
    "crowd-only.html": "hourly_display",
    "alert.html": "funnel_capture",
    "flow-forecast.html": "hourly_display",
    "basket.html": "basket_bundle",
    "basket-aov.html": "aov_lift",
    "funnel.html": "conversion_fix",
    "crowd-sales.html": "hourly_display",
    "trends.html": "traffic_boost",
    "promo-posters.html": "hotspot_poster",
    "money-leak.html": "conversion_fix",
    "weather-weekday-aov.html": "aov_lift",
    "sku-persona-basket.html": "basket_bundle",
    "premium-map.html": "hourly_display",
    "demo1-crowd-report": "hourly_display",
    "demo2-hourly-promo": "hourly_display",
    "demo3-hot-products": "traffic_boost",
    "demo4-cross-industry": "traffic_boost",
    "demo5-trade-area-map": "traffic_boost",
    "demo6-premium-stores-map": "hourly_display",
    "demo7-category-battle-map": "hourly_display",
    "demo8-product-matrix": "aov_lift",
    "index.html": "hourly_display",
  };

  function resolveTemplate(url, explicitId) {
    if (explicitId) return explicitId;
    for (const [key, id] of Object.entries(PATH_TEMPLATE)) {
      if (url.includes(key)) return id;
    }
    return null;
  }

  function embedStyles() {
    return `
      html.fenqun-embed-system .sidebar,
      html.fenqun-embed-system #sidebar { display: none !important; width: 0 !important; }
      html.fenqun-embed-system .top-bar { display: none !important; }
      html.fenqun-embed-system .app-shell { display: block !important; }
      html.fenqun-embed-system .main-area { width: 100% !important; max-width: 100% !important; flex: 1 !important; }
      html.fenqun-embed-system .main-inner { max-width: 100% !important; }
      html.fenqun-embed-system .site-header .back-link { display: none !important; }
      html.fenqun-embed-system .fenqun-push-cta {
        margin: 24px 0 12px; padding: 18px 20px;
        background: linear-gradient(135deg, #eff6ff, #f0f9ff);
        border: 1px solid #93c5fd; border-radius: 12px; text-align: center;
      }
      html.fenqun-embed-system .fenqun-push-btn {
        display: inline-flex; align-items: center; justify-content: center; gap: 8px;
        padding: 12px 22px; background: #2563eb; color: #fff; border: none; border-radius: 10px;
        font-size: .92rem; font-weight: 700; cursor: pointer; font-family: inherit;
      }
      html.fenqun-embed-system .fenqun-push-btn:hover { background: #1d4ed8; }
      html.fenqun-embed-system .fenqun-push-hint { margin: 8px 0 0; font-size: .78rem; color: #64748b; }
    `;
  }

  function injectCta(doc, meta) {
    const host =
      doc.querySelector(".main-inner") ||
      doc.querySelector(".page-wrap") ||
      doc.querySelector("main") ||
      doc.body;
    if (!host || doc.getElementById("fenqunPushCta")) return;

    const cta = doc.createElement("div");
    cta.id = "fenqunPushCta";
    cta.className = "fenqun-push-cta";
    cta.innerHTML =
      '<button type="button" class="fenqun-push-btn">基于该策略生成 AI 执行方案并推送</button>' +
      '<p class="fenqun-push-hint">将跳转至运营工作台 · 策略推送，结合近 7 天数据生成可执行方案</p>';
    const footer = host.querySelector(".footer");
    if (footer) host.insertBefore(cta, footer);
    else host.appendChild(cta);

    cta.querySelector("button").addEventListener("click", function () {
      const target = doc.defaultView || window;
      let parentOrigin = window.location.origin;
      try {
        if (window.parent && window.parent.location.origin) {
          parentOrigin = window.parent.location.origin;
        }
      } catch (_) { /* 跨域 iframe 时使用当前 origin */ }
      target.parent.postMessage(
        {
          type: "fenqun:push-from-report",
          name: meta.name,
          url: meta.url,
          templateId: meta.templateId,
        },
        parentOrigin,
      );
    });
  }

  function applyToDocument(doc, meta) {
    if (!doc || doc.getElementById("fenqunEmbedStyle")) return false;
    doc.documentElement.classList.add("fenqun-embed-system");
    const style = doc.createElement("style");
    style.id = "fenqunEmbedStyle";
    style.textContent = embedStyles();
    doc.head.appendChild(style);

    const shell = doc.getElementById("appShell");
    if (shell) shell.classList.add("collapsed");

    injectCta(doc, meta);
    return true;
  }

  function withEmbedParam(url) {
    if (!url || url.includes("embed=system")) return url;
    return url + (url.includes("?") ? "&" : "?") + "embed=system";
  }

  function buildEmbedUrl(url, name, templateId) {
    const base = withEmbedParam(url);
    const resolved = resolveTemplate(base, templateId);
    try {
      const u = new URL(base, window.location.origin);
      u.searchParams.set("embed", "system");
      if (name) u.searchParams.set("reportName", name);
      if (resolved) u.searchParams.set("templateId", resolved);
      return { href: u.pathname + u.search, templateId: resolved };
    } catch (e) {
      let href = base;
      const parts = [];
      if (name && !href.includes("reportName=")) parts.push("reportName=" + encodeURIComponent(name));
      if (resolved && !href.includes("templateId=")) parts.push("templateId=" + encodeURIComponent(resolved));
      if (parts.length) href += (href.includes("?") ? "&" : "?") + parts.join("&");
      return { href, templateId: resolved };
    }
  }

  function openReport(frame, url, name, templateId) {
    const built = buildEmbedUrl(url, name, templateId);
    const meta = {
      name: name || "数据报告",
      url: built.href,
      templateId: built.templateId,
    };

    function tryApply() {
      try {
        const doc = frame.contentDocument;
        if (doc && (doc.readyState === "complete" || doc.readyState === "interactive")) {
          applyToDocument(doc, meta);
        }
      } catch (err) {
        /* 跨域时由页面内 embed-system.js 处理 */
      }
    }

    frame.onload = function () {
      tryApply();
      setTimeout(tryApply, 300);
      setTimeout(tryApply, 900);
    };
    frame.src = meta.url;
    return meta;
  }

  window.ReportEmbed = { openReport, resolveTemplate, applyToDocument, withEmbedParam, buildEmbedUrl };
})();
