/** 运营方案枢纽：选址与闭店 / 捕获率提升 / 转化率提升 / 客单价提升 四类策略 */
(function () {
  let solMode = "single"; // single | multi
  let cat = "site"; // site | capture | conversion | aov
  const loadedFrames = {};

  const CAT_META = {
    site: { title: "选址与闭店策略", hint: "过店 · 闭店决策" },
    capture: { title: "捕获率提升策略", hint: "进店" },
    conversion: { title: "转化率提升策略", hint: "成交 · 转型升级" },
    aov: { title: "客单价提升策略", hint: "客单" },
  };

  const MODE_PANELS = {
    site: { single: "solSiteSingle", multi: "solSiteMulti" },
    capture: { single: "solCaptureSingle", multi: "solCaptureMulti" },
    conversion: { single: "solConversionSingle", multi: "solConversionMulti" },
    aov: { single: "solAovSingle", multi: "solAovMulti" },
  };

  function el(id) {
    return document.getElementById(id);
  }

  function syncTopbar() {
    const meta = CAT_META[cat] || CAT_META.site;
    const modeLabel = solMode === "multi" ? " · 多店" : " · 单店";
    window.FenqunTopbar?.setPageTitle?.(meta.title + modeLabel);
  }

  function syncSidebarMode() {
    document.querySelectorAll("#sidebarSolMode button").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.solmode === solMode);
    });
  }

  function loadFrame(frameId, url, name, templateId) {
    const frame = el(frameId);
    if (!frame) return;
    if (loadedFrames[frameId] === url) return;
    loadedFrames[frameId] = url;
    // 旧系统报告库（/fenqun/example1、/fenqun/demo*）不在本项目部署中，显示提示而非死链
    if (String(url).indexOf("/fenqun/") === 0) {
      frame.innerHTML =
        '<div class="warn-box" style="margin:0;padding:24px;text-align:center">' +
        "<h4>完整交互报告库</h4>" +
        '<p class="muted">该报告属于旧版演示报告库（/fenqun/…），当前部署未包含此页面。</p>' +
        '<p class="muted">客群洞察请使用「运营工作台 → 客群基本信息」。</p></div>';
      return;
    }
    if (window.ReportEmbed) {
      ReportEmbed.openReport(frame, url, name, templateId);
    } else {
      frame.src = url + (url.includes("?") ? "&" : "?") + "embed=system";
    }
  }

  function toggleModePanels() {
    Object.keys(MODE_PANELS).forEach(function (key) {
      const panels = MODE_PANELS[key];
      const singleEl = el(panels.single);
      const multiEl = el(panels.multi);
      const isActive = key === cat;
      if (singleEl) singleEl.style.display = isActive && solMode === "single" ? "block" : "none";
      if (multiEl) multiEl.style.display = isActive && solMode === "multi" ? "block" : "none";
    });
  }

  function refreshCapturePosterFrame() {
    if (solMode !== "single" || cat !== "capture" || captureSub !== "poster") return;
    loadFrame("framePoster", "/fenqun/example1/promo-posters.html", "爆品促销活动", "hotspot_poster");
  }

  function refreshFrames() {
    if (solMode !== "single") return;
    if (cat === "site") {
      loadFrame("frameSite", "/fenqun/demo5-trade-area-map/index.html", "商圈地图渗透率", "traffic_boost");
    } else if (cat === "capture") {
      refreshCapturePosterFrame();
    } else if (cat === "conversion") {
      loadFrame("frameConversion", "/fenqun/example1/crowd-sales.html", "人群×标签×品类", "hourly_display");
    } else if (cat === "aov") {
      loadFrame("frameAov", "/fenqun/example1/basket.html", "购物篮组合分析", "basket_bundle");
    }
  }

  function refreshMultiFrames() {
    if (solMode !== "multi") return;
    if (cat === "conversion") {
      loadFrame("frameConversionMulti", "/fenqun/demo7-category-battle-map/index.html", "品类作战地图", "hourly_display");
    } else if (cat === "aov") {
      loadFrame("frameAovMulti", "/fenqun/demo8-product-matrix/index.html", "产品矩阵拓展", "aov_lift");
    }
    window.SolutionsMulti?.load(cat);
  }

  function setMode(next) {
    solMode = next;
    syncSidebarMode();
    syncTopbar();
    toggleModePanels();
    if (next === "multi") {
      refreshMultiFrames();
    } else {
      window.SolutionsMulti?.destroySiteMap?.();
      refreshFrames();
      if (cat === "capture" && captureSub === "agent") window.HotProductAgent?.onPanelShown?.();
      loadStoreSingle();
    }
  }

  function showCategory(next) {
    cat = next;
    syncTopbar();
    ["site", "capture", "conversion", "aov"].forEach(function (key) {
      const panel = el("solCat" + key.charAt(0).toUpperCase() + key.slice(1));
      if (panel) panel.style.display = key === next ? "block" : "none";
    });
    toggleModePanels();
    if (solMode === "multi") {
      refreshMultiFrames();
    } else {
      refreshFrames();
      if (next === "capture" && captureSub === "agent") window.HotProductAgent?.onPanelShown?.();
      loadStoreSingle();
    }
  }

  let captureSub = "poster";

  function setCaptureSub(next) {
    captureSub = next;
    if (el("capturePoster")) el("capturePoster").style.display = next === "poster" ? "block" : "none";
    if (el("captureAgent")) el("captureAgent").style.display = next === "agent" ? "block" : "none";
    document.querySelectorAll("#captureFeatureGrid .sol-feature-card").forEach(function (card) {
      card.classList.toggle("active", card.dataset.feature === next);
    });
    if (next === "poster") refreshCapturePosterFrame();
    else if (next === "agent") window.HotProductAgent?.onPanelShown?.();
  }

  function bindOnce() {
    if (bindOnce.done) return;
    bindOnce.done = true;
    document.querySelectorAll("#sidebarSolMode button").forEach(function (btn) {
      btn.onclick = function () { setMode(btn.dataset.solmode); };
    });
    document.querySelectorAll("#captureFeatureGrid .sol-feature-card").forEach(function (card) {
      card.onclick = function () { setCaptureSub(card.dataset.feature); };
    });
  }

  function init() {
    bindOnce();
    setMode("single");
    showCategory("site");
    setCaptureSub("poster");
    loadStoreSingle();
  }

  function loadStoreSingle() {
    if (solMode !== "single") return;
    const storeId = document.getElementById("globalStore")?.value;
    if (cat === "site" || cat === "conversion") {
      window.SolutionsStore?.loadSingle?.(storeId);
    }
  }

  function onStoreChange() {
    window.SolutionsMulti?.onStoreChange?.();
    if (solMode === "multi") window.SolutionsMulti?.load(cat);
    else loadStoreSingle();
  }

  window.SolutionsHub = {
    init,
    onStoreChange,
    setMode,
    showCategory,
    setCaptureSub,
    getCategory: function () { return cat; },
    getMode: function () { return solMode; },
  };
})();
