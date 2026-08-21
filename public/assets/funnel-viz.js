/** 营业额四因子 — 公式条 + 漏斗可视化 */
(function () {
  function fmtNum(n) {
    return Number(n || 0).toLocaleString("zh-CN");
  }

  function factorStatus(f) {
    if (!f) return "normal";
    if (f.level) return f.level;
    const pct = Number(f.pct) || 0;
    if (pct >= 10) return "positive";
    if (pct >= 0) return "normal";
    if (pct > -5) return "normal";
    if (pct > -10) return "attention";
    return "significant";
  }

  function statusMod(status, prefix) {
    if (status === "positive") return `${prefix}--positive`;
    if (status === "attention") return `${prefix}--attention`;
    if (status === "significant") return `${prefix}--risk`;
    return "";
  }

  function buildFactorMap(factors) {
    const map = {};
    if (!Array.isArray(factors)) return map;
    for (const f of factors) {
      if (f.key) map[f.key] = f;
    }
    return map;
  }

  function devTitle(f) {
    if (!f || f.pct == null || factorStatus(f) === "normal") return "";
    const sign = f.pct >= 0 ? "+" : "";
    const label = f.levelLabel || (f.pct >= 0 ? "优于基准" : "低于基准");
    return ` title="${label} ${sign}${Number(f.pct).toFixed(1)}%"`;
  }

  function renderRevenueFunnel(opts, factorMap) {
    const fm = factorMap || {};
    const pass = Number(opts.pass) || 0;
    const capture = opts.capturePct != null
      ? opts.capturePct / 100
      : Number(opts.capture) || 0;
    const conv = opts.convPct != null
      ? opts.convPct / 100
      : Number(opts.conv) || 0;
    const aov = Number(opts.aov) || 0;
    const enter = Math.round(pass * capture);
    const orders = Math.round(enter * conv);
    const revenue = opts.revenue != null
      ? Number(opts.revenue)
      : opts.salesWan != null
        ? Number(opts.salesWan) * 10000
        : orders * aov;
    const salesWan = opts.salesWan != null
      ? Number(opts.salesWan)
      : +(revenue / 10000).toFixed(1);
    const captureLabel = opts.capturePct != null
      ? opts.capturePct + "%"
      : (capture * 100).toFixed(2) + "%";
    const convLabel = opts.convPct != null
      ? opts.convPct + "%"
      : (conv * 100).toFixed(1) + "%";
    const aovLabel = aov >= 100 ? aov.toFixed(0) : aov.toFixed(2);

    function stageCls(base, key) {
      const mod = statusMod(factorStatus(fm[key]), base);
      return mod ? `${base} ${mod}` : base;
    }
    function pill(label, key) {
      const mod = statusMod(factorStatus(fm[key]), "funnel-rate-pill");
      return `<span class="funnel-rate-pill${mod ? " " + mod : ""}"${devTitle(fm[key])}>${label}</span>`;
    }

    return `<div class="revenue-funnel" aria-label="营业额转化漏斗">
      <div class="funnel-stage" style="--w:100%">
        <div class="funnel-trap ${stageCls("stage-pass", "pass")}"${devTitle(fm.pass)}>
          <span class="funnel-stage-label">过店</span>
          <strong class="funnel-stage-val">${fmtNum(pass)}</strong>
        </div>
      </div>
      <div class="funnel-connector">${pill(`进店率 ${captureLabel}`, "capture")}</div>
      <div class="funnel-stage" style="--w:82%">
        <div class="funnel-trap ${stageCls("stage-enter", "capture")}"${devTitle(fm.capture)}>
          <span class="funnel-stage-label">进店</span>
          <strong class="funnel-stage-val">${fmtNum(enter)}</strong>
        </div>
      </div>
      <div class="funnel-connector">${pill(`成交率 ${convLabel}`, "conv")}</div>
      <div class="funnel-stage" style="--w:64%">
        <div class="funnel-trap ${stageCls("stage-order", "conv")}"${devTitle(fm.conv)}>
          <span class="funnel-stage-label">成交</span>
          <strong class="funnel-stage-val">${fmtNum(orders)}</strong>
        </div>
      </div>
      <div class="funnel-connector">${pill(`客单价 ¥${aovLabel}`, "aov")}</div>
      <div class="funnel-stage" style="--w:46%">
        <div class="funnel-trap ${stageCls("stage-sales", "aov")}"${devTitle(fm.aov)}>
          <span class="funnel-stage-label">营业额</span>
          <strong class="funnel-stage-val">¥${salesWan}万</strong>
        </div>
      </div>
    </div>`;
  }

  function renderFormulaBar(opts, factorMap) {
    const fm = factorMap || {};
    const pass = Number(opts.pass) || 0;
    const captureLabel = opts.capturePct != null
      ? opts.capturePct + "%"
      : (Number(opts.capture) * 100).toFixed(2) + "%";
    const convLabel = opts.convPct != null
      ? opts.convPct + "%"
      : (Number(opts.conv) * 100).toFixed(1) + "%";
    const aov = Number(opts.aov) || 0;
    const aovLabel = aov >= 100 ? aov.toFixed(0) : aov.toFixed(2);
    const salesWan = opts.salesWan != null
      ? opts.salesWan
      : +((Number(opts.revenue) || 0) / 10000).toFixed(1);

    function chip(label, key) {
      const mod = statusMod(factorStatus(fm[key]), "chip");
      return `<span class="chip${mod ? " " + mod : ""}"${devTitle(fm[key])}>${label}</span>`;
    }

    return `<div class="formula-bar">
      ${chip(`过店 ${fmtNum(pass)}`, "pass")}<span class="op">×</span>
      ${chip(`进店率 ${captureLabel}`, "capture")}<span class="op">×</span>
      ${chip(`成交率 ${convLabel}`, "conv")}<span class="op">×</span>
      ${chip(`客单价 ¥${aovLabel}`, "aov")}
      <span class="op">≈</span><span class="chip">¥${salesWan}万</span>
    </div>`;
  }

  function renderTradeAreaBlock(ta) {
    if (!ta?.available) {
      return `<div class="hero-trade-box hero-trade-box--empty">
        <h4 class="hero-trade-title">📍 商圈数据</h4>
        <p class="muted">${ta?.reason || "暂无商圈渗透数据，切换至长沙望城银杉路零食店可查看完整分析。"}</p>
      </div>`;
    }
    const s = ta.stats || {};
    const personas = (ta.personas || []).slice(0, 5);
    const maxPen = Math.max(...personas.map((p) => p.penetrationPct || 0), 1);
    const reportLink = ta.mapReportUrl
      ? `<a class="hero-trade-link" href="${ta.mapReportUrl}" target="_blank" rel="noopener">完整商圈地图 →</a>`
      : "";

    return `<div class="hero-trade-box">
      <div class="hero-trade-hd">
        <h4 class="hero-trade-title">📍 商圈数据</h4>
        <span class="hero-trade-tag">${ta.district || ""}</span>
      </div>
      <p class="hero-trade-loc muted">${ta.location || ""} · ${ta.storeType || "零售门店"}${ta.isMock ? " · 模拟缩放" : ""}</p>
      <div class="hero-trade-kpis">
        <div class="htk"><span class="htk-val">${fmtNum(s.totalPop)}</span><span class="htk-lbl">1km 商圈人口</span></div>
        <div class="htk"><span class="htk-val">${fmtNum(s.dailyPassers)}</span><span class="htk-lbl">日均过店</span></div>
        <div class="htk"><span class="htk-val">${s.penetrationPct}%</span><span class="htk-lbl">过店渗透率</span></div>
        <div class="htk"><span class="htk-val">${s.convPct}%</span><span class="htk-lbl">进店转化率</span></div>
      </div>
      <div class="hero-trade-personas">
        ${personas.map(function (p) {
          const barW = Math.max(8, Math.round((p.penetrationPct / maxPen) * 100));
          return `<div class="ta-row ta-row--${p.status}">
            <div class="ta-row-hd">
              <span class="ta-name">${p.name}</span>
              <span class="ta-pen">${p.penetrationPct}%</span>
              <span class="ta-badge ta-badge--${p.status}">${p.statusLabel}</span>
            </div>
            <div class="ta-bar"><span class="ta-bar-fill ta-bar-fill--${p.status}" style="width:${barW}%"></span></div>
            <span class="ta-meta muted">商圈 ${p.popSharePct}% · 日均过店 ${fmtNum(p.avgPassers)}</span>
          </div>`;
        }).join("")}
      </div>
      ${ta.highlights?.length ? `<ul class="ki-list ki-list--compact hero-trade-insights">${ta.highlights.map((x) => `<li>${x}</li>`).join("")}</ul>` : ""}
      ${reportLink}
    </div>`;
  }

  function renderHeroPanel(opts, insights, factors, tradeArea) {
    const fm = buildFactorMap(factors);
    const list = Array.isArray(insights) ? insights : [];
    return `<div class="hero-formula-funnel">
      <div class="hero-formula-left">
        ${renderFormulaBar(opts, fm)}
        ${renderTradeAreaBlock(tradeArea)}
        ${list.length ? `<div class="hero-insights-box">
          <h4 class="hero-insights-title">🔑 关键洞察</h4>
          <ul class="ki-list ki-list--compact">${list.map((x) => `<li>${x}</li>`).join("")}</ul>
        </div>` : ""}
      </div>
      <div class="hero-funnel-right">${renderRevenueFunnel(opts, fm)}</div>
    </div>`;
  }

  function renderFormulaBlock(opts, config) {
    const layout = config?.layout || "row";
    const fm = buildFactorMap(config?.factors);
    const rowClass = layout === "stack" ? "formula-funnel-row formula-funnel-row--stack" : "formula-funnel-row";

    return `<div class="${rowClass}">
      ${renderFormulaBar(opts, fm)}
      <div class="funnel-viz-panel">
        ${layout === "stack" ? '<p class="funnel-viz-title">转化漏斗</p>' : ""}
        ${renderRevenueFunnel(opts, fm)}
      </div>
    </div>`;
  }

  function kpiStatusClass(f) {
    const mod = statusMod(factorStatus(f), "kpi");
    return mod ? ` ${mod}` : "";
  }

  window.FunnelViz = {
    renderRevenueFunnel,
    renderFormulaBar,
    renderHeroPanel,
    renderTradeAreaBlock,
    renderFormulaBlock,
    factorStatus,
    buildFactorMap,
    kpiStatusClass,
  };
})();
