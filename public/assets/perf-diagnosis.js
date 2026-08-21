/** 业绩诊断：业绩概览 / 三维度诊断 / 多店对比 / 报告中心 */
(function () {
  let mode = "overview"; // overview | dim | multi | report
  let dim = "revenue"; // revenue | margin | cost
  let marginCostCache = null;
  let reportProg = null;
  let lastReport = null;

  function el(id) {
    return document.getElementById(id);
  }
  function getStoreId() {
    return window.getStoreId?.();
  }
  function fmtWan(n) {
    return "¥" + (Number(n || 0) / 10000).toFixed(1) + "万";
  }

  function setMode(next) {
    mode = next;
    if (el("diagPanelOverview")) el("diagPanelOverview").style.display = next === "overview" ? "block" : "none";
    if (el("diagPanelDim")) el("diagPanelDim").style.display = next === "dim" ? "block" : "none";
    if (el("diagPanelMulti")) el("diagPanelMulti").style.display = next === "multi" ? "block" : "none";
    if (el("diagPanelReport")) el("diagPanelReport").style.display = next === "report" ? "block" : "none";
    if (next === "overview") loadTargets();
    if (next === "dim") {
      setDim(dim);
      loadTargets();
    }
    if (next === "multi") {
      loadCompare().finally(function () { scheduleCompareMapRefresh(); });
    }
    if (next === "report") {
      loadSubscription();
      loadReportHistory();
      renderReportsCatalogIfNeeded();
    }
  }

  function setDim(next) {
    dim = next;
    document.querySelectorAll("#diagDimNav .step-pill").forEach((p) => p.classList.toggle("active", p.dataset.dim === next));
    if (el("diagRevenueControls")) el("diagRevenueControls").style.display = next === "revenue" ? "flex" : "none";
    if (el("diagDimRevenue")) el("diagDimRevenue").style.display = next === "revenue" ? "block" : "none";
    if (el("diagDimMargin")) el("diagDimMargin").style.display = next === "margin" ? "block" : "none";
    if (el("diagDimCost")) el("diagDimCost").style.display = next === "cost" ? "block" : "none";
    if (next === "margin" || next === "cost") loadMarginCost();
  }

  function riskTagHtml(level, label) {
    const cls = level === "significant" ? "tag-red" : level === "attention" ? "tag-yellow" : level === "positive" ? "tag-green" : "tag-blue";
    return `<span class="tag ${cls}">${label}</span>`;
  }

  function statusFromPct(pct) {
    if (pct == null) return "no-target";
    if (pct >= 100) return "achieved";
    if (pct >= 80) return "on-track";
    return "behind";
  }

  function renderTargets(targets) {
    const box = el("targetPanel");
    if (!box) return;
    const order = ["day", "week", "month"];
    box.innerHTML = `<div class="target-grid">${order
      .map(function (type) {
        const t = targets[type];
        const status = statusFromPct(t.achievedPct);
        const pctLabel = t.achievedPct == null ? "未设定目标" : t.achievedPct + "%";
        const fillWidth = t.achievedPct == null ? 0 : Math.min(100, t.achievedPct);
        return `<div class="target-card">
          <div class="target-card-hd"><strong>${t.label}</strong>${riskTagHtml(status === "achieved" ? "positive" : status === "on-track" ? "normal" : status === "behind" ? "attention" : "normal", status === "achieved" ? "已达成" : status === "on-track" ? "进行中" : status === "behind" ? "需加油" : "未设定")}</div>
          <p class="target-card-range muted">${t.range.label}</p>
          <div class="target-input-row">
            <input type="number" min="0" step="100" placeholder="设定${t.label.replace('目标','')}营业额目标(元)" value="${t.target ?? ""}" data-period="${type}" class="target-input"/>
            <button type="button" class="btn secondary btn-xs btn-save-target" data-period="${type}">保存</button>
          </div>
          <div class="target-progress-track"><div class="target-progress-fill ${status}" style="width:${fillWidth}%"></div></div>
          <div class="target-meta-row">
            <span>实际 ${fmtWan(t.actual)}</span>
            <span class="pct ${status}">${pctLabel}</span>
          </div>
        </div>`;
      })
      .join("")}</div>`;
    box.querySelectorAll(".btn-save-target").forEach(function (btn) {
      btn.onclick = async function () {
        const period = btn.dataset.period;
        const input = box.querySelector(`.target-input[data-period="${period}"]`);
        const value = Number(input.value);
        if (!value || value <= 0) return FenqunAPI.toast("请输入大于 0 的目标值");
        try {
          const data = await FenqunAPI.api("/stores/" + getStoreId() + "/targets", {
            method: "PUT",
            body: { periodType: period, value },
          });
          renderTargets(data.targets);
          FenqunAPI.toast("目标已保存");
        } catch (e) {
          FenqunAPI.toast(e.message);
        }
      };
    });
  }

  async function loadTargets() {
    const box = el("targetPanel");
    if (box) box.innerHTML = "<p class='muted'>加载目标数据…</p>";
    try {
      const data = await FenqunAPI.api("/stores/" + getStoreId() + "/targets");
      renderTargets(data.targets);
    } catch (e) {
      if (box) box.innerHTML = `<div class="warn-box">${e.message}</div>`;
    }
  }

  function renderMargin(mc) {
    const box = el("diagDimMargin");
    if (!box) return;
    const g = mc.grossMargin;
    box.innerHTML = `
      <div class="mc-summary-row">
        <div class="mc-summary-item"><div class="val">${g.currentPct}%</div><div class="lbl">综合毛利率</div></div>
        <div class="mc-summary-item"><div class="val">${g.benchmarkPct}%</div><div class="lbl">行业参考基准</div></div>
        <div class="mc-summary-item"><div class="val">${g.pct >= 0 ? "+" : ""}${g.pct}%</div><div class="lbl">较基准偏差 ${riskTagHtml(g.level, g.levelLabel)}</div></div>
      </div>
      <h4 class="task-detail-hd">品类毛利结构</h4>
      <div class="mc-breakdown-list">${g.byCategory
        .map((c) => `<div class="mc-breakdown-row">
          <span>${c.name}</span>
          <span class="mc-breakdown-bar-track"><span class="mc-breakdown-bar-fill" style="width:${Math.min(100, c.marginPct * 2)}%"></span></span>
          <span>${c.marginPct}%</span>
        </div>`)
        .join("")}</div>
      <div class="grid2" style="margin-top:14px">
        <div class="card"><h3>毛利率趋势</h3><canvas id="marginTrendChart"></canvas></div>
      </div>`;
    if (window.Chart) {
      const canvas = document.getElementById("marginTrendChart");
      if (canvas) {
        if (canvas._chart) canvas._chart.destroy();
        canvas._chart = new Chart(canvas, {
          type: "line",
          data: {
            labels: g.trend.map((t) => t.month),
            datasets: [{ label: "毛利率%", data: g.trend.map((t) => t.marginPct), borderColor: "#7c3aed", backgroundColor: "#7c3aed22", tension: .3 }],
          },
          options: { plugins: { legend: { display: false } } },
        });
      }
    }
  }

  function renderCost(mc) {
    const box = el("diagDimCost");
    if (!box) return;
    const c = mc.cost;
    box.innerHTML = `
      <div class="mc-summary-row">
        <div class="mc-summary-item"><div class="val">${c.currentRatioPct}%</div><div class="lbl">成本占营收比</div></div>
        <div class="mc-summary-item"><div class="val">${c.benchmarkRatioPct}%</div><div class="lbl">行业参考基准</div></div>
        <div class="mc-summary-item"><div class="val">${c.pct >= 0 ? "+" : ""}${c.pct}%</div><div class="lbl">较基准偏差 ${riskTagHtml(c.level, c.levelLabel)}</div></div>
      </div>
      <h4 class="task-detail-hd">成本结构拆解</h4>
      <div class="mc-breakdown-list">${c.breakdown
        .map((b) => `<div class="mc-breakdown-row">
          <span>${b.name}</span>
          <span class="mc-breakdown-bar-track"><span class="mc-breakdown-bar-fill" style="width:${Math.min(100, b.pct * 3)}%;background:linear-gradient(90deg,#ea580c,#fb923c)"></span></span>
          <span>${b.pct}%（${b.amountWan}万）</span>
        </div>`)
        .join("")}</div>
      <div class="grid2" style="margin-top:14px">
        <div class="card"><h3>成本率趋势</h3><canvas id="costTrendChart"></canvas></div>
      </div>
      <ul class="mc-risk-list">${mc.riskNotes.map((r) => `<li>${r}</li>`).join("")}</ul>`;
    if (window.Chart) {
      const canvas = document.getElementById("costTrendChart");
      if (canvas) {
        if (canvas._chart) canvas._chart.destroy();
        canvas._chart = new Chart(canvas, {
          type: "line",
          data: {
            labels: c.trend.map((t) => t.month),
            datasets: [{ label: "成本占比%", data: c.trend.map((t) => t.costRatioPct), borderColor: "#ea580c", backgroundColor: "#ea580c22", tension: .3 }],
          },
          options: { plugins: { legend: { display: false } } },
        });
      }
    }
  }

  async function loadMarginCost(force) {
    if (marginCostCache && !force) {
      renderMargin(marginCostCache);
      renderCost(marginCostCache);
      return;
    }
    try {
      marginCostCache = await FenqunAPI.api("/stores/" + getStoreId() + "/margin-cost");
      renderMargin(marginCostCache);
      renderCost(marginCostCache);
    } catch (e) {
      if (el("diagDimMargin")) el("diagDimMargin").innerHTML = `<div class="warn-box">${e.message}</div>`;
    }
  }

  function healthDot(health) {
    return `<span class="compare-health-dot ${health}"></span>`;
  }

  const QUAD_ORDER = ["标杆门店", "潜力待挖", "稳健经营", "重点关注"];
  const QUAD_COLORS = {
    标杆门店: "#18a058",
    潜力待挖: "#2b6bf3",
    稳健经营: "#e8a23a",
    重点关注: "#d93939",
  };

  let compareState = { rows: [], medians: {}, filter: "全部", pickedId: null };
  let compareMap = null;
  let compareMarkers = {};
  let compareChart = null;
  let compareMapResizeObserver = null;
  let compareMapRefreshTimer = null;

  function jumpToStore(storeId) {
    const storeSel = document.getElementById("globalStore");
    if (storeSel) {
      storeSel.value = storeId;
      storeSel.dispatchEvent(new Event("change"));
    }
    setMode("dim");
    if (window.switchTab) window.switchTab("diagnosis", { diag: "dim" });
  }

  function filteredRows() {
    if (compareState.filter === "全部") return compareState.rows.filter((r) => !r.error);
    return compareState.rows.filter((r) => !r.error && r.quad === compareState.filter);
  }

  function renderCompareKpis(quadSummary) {
    const box = el("compareKpiGrid");
    if (!box) return;
    box.innerHTML = QUAD_ORDER.map(function (q) {
      const n = quadSummary?.[q] || 0;
      return `<div class="compare-kpi-card" style="--quad-color:${QUAD_COLORS[q]}">
        <div class="compare-kpi-val">${n}</div>
        <div class="compare-kpi-lbl">${q}</div>
      </div>`;
    }).join("");
  }

  function renderCompareFilter() {
    const box = el("compareQuadFilter");
    if (!box) return;
    const tabs = ["全部", ...QUAD_ORDER];
    box.innerHTML = tabs.map(function (q) {
      return `<button type="button" class="compare-quad-pill${compareState.filter === q ? " active" : ""}" data-quad="${q}">${q}</button>`;
    }).join("");
    box.querySelectorAll(".compare-quad-pill").forEach(function (btn) {
      btn.onclick = function () {
        compareState.filter = btn.dataset.quad;
        renderCompareFilter();
        renderCompareTable();
        applyCompareMapFilter();
        highlightCompareRows();
      };
    });
  }

  function compareMapRows() {
    return compareState.rows.filter(function (r) {
      const lat = Number(r.lat);
      const lng = Number(r.lng);
      return !r.error && Number.isFinite(lat) && Number.isFinite(lng);
    });
  }

  function compareDotSize(potential) {
    return Math.round(16 + (Number(potential) || 50) / 100 * 14);
  }

  function destroyCompareMap() {
    if (compareMapRefreshTimer) {
      clearTimeout(compareMapRefreshTimer);
      compareMapRefreshTimer = null;
    }
    if (compareMapResizeObserver) {
      compareMapResizeObserver.disconnect();
      compareMapResizeObserver = null;
    }
    if (compareMap) {
      compareMap.remove();
      compareMap = null;
    }
    compareMarkers = {};
    const mapEl = el("compareMap");
    if (mapEl) {
      mapEl.innerHTML = "";
      delete mapEl._leaflet_id;
    }
  }

  function refreshCompareMapView() {
    if (!compareMap) return;
    const rows = compareMapRows();
    if (!rows.length) return;
    compareMap.invalidateSize(true);
    const bounds = L.latLngBounds(rows.map(function (r) {
      return [Number(r.lat), Number(r.lng)];
    }));
    if (bounds.isValid()) {
      compareMap.fitBounds(bounds.pad(rows.length === 1 ? 0.25 : 0.18), {
        animate: false,
        maxZoom: rows.length === 1 ? 14 : 13,
      });
    }
  }

  function scheduleCompareMapRefresh() {
    if (compareMapRefreshTimer) clearTimeout(compareMapRefreshTimer);
    compareMapRefreshTimer = setTimeout(function () {
      compareMapRefreshTimer = null;
      requestAnimationFrame(function () {
        refreshCompareMapView();
        setTimeout(refreshCompareMapView, 200);
      });
    }, 80);
  }

  function bindCompareMapResizeObserver(mapEl) {
    if (compareMapResizeObserver) {
      compareMapResizeObserver.disconnect();
      compareMapResizeObserver = null;
    }
    if (typeof ResizeObserver === "undefined" || !mapEl) return;
    compareMapResizeObserver = new ResizeObserver(function () {
      scheduleCompareMapRefresh();
    });
    compareMapResizeObserver.observe(mapEl);
  }

  function applyCompareMapFilter() {
    if (!compareMap) return;
    const filter = compareState.filter;
    Object.entries(compareMarkers).forEach(function (entry) {
      const row = compareState.rows.find(function (r) { return r.storeId === entry[0]; });
      const marker = entry[1];
      if (!row || row.error) return;
      const active = filter === "全部" || row.quad === filter;
      const color = row.quadColor || QUAD_COLORS[row.quad] || "#94a3b8";
      const dot = marker.getElement()?.querySelector(".compare-map-dot");
      if (dot) {
        dot.style.background = color;
        dot.style.opacity = active ? "1" : "0.35";
      }
      if (active) marker.setZIndexOffset(1200);
      else marker.setZIndexOffset(400);
    });
  }

  function addCompareMapMarker(map, r) {
    const lat = Number(r.lat);
    const lng = Number(r.lng);
    const color = r.quadColor || QUAD_COLORS[r.quad] || "#94a3b8";
    const size = compareDotSize(r.potential);
    const marker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: "compare-map-dot-wrap",
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
        html: `<span class="compare-map-dot" style="width:${size}px;height:${size}px;background:${color}"></span>`,
      }),
      zIndexOffset: 1000,
    }).addTo(map);
    marker.bindPopup(
      `<b>${r.name}</b><br/>象限：<b style="color:${color}">${r.quad || "—"}</b><br/>` +
        `潜力 ${r.potential ?? "—"} / 兑现 ${r.capability ?? "—"}<br/>` +
        `营业额 ¥${r.salesWan}万 · 毛利率 ${r.grossMarginPct}%<br/>` +
        `健康度 ${r.worstFactor || "正常"}`
    );
    marker.on("click", function () {
      compareState.pickedId = r.storeId;
      highlightCompareRows();
      flyToCompareStore(r.storeId);
    });
    compareMarkers[r.storeId] = marker;
    return marker;
  }

  function renderCompareMap() {
    const mapEl = el("compareMap");
    const legendEl = el("compareMapLegend");
    if (!mapEl) return;
    destroyCompareMap();

    const rows = compareMapRows();
    if (!rows.length) {
      mapEl.innerHTML = "<p class='muted' style='padding:20px'>暂无门店坐标数据</p>";
      return;
    }

    if (typeof L === "undefined") {
      mapEl.innerHTML = "<p class='muted' style='padding:20px'>地图组件加载失败，表格对比仍可使用</p>";
      return;
    }

    mapEl.innerHTML = '<div id="compareMapCanvas" class="compare-map-canvas"></div>';
    const center = [
      rows.reduce(function (s, r) { return s + Number(r.lat); }, 0) / rows.length,
      rows.reduce(function (s, r) { return s + Number(r.lng); }, 0) / rows.length,
    ];
    compareMap = L.map("compareMapCanvas", { zoomControl: true, attributionControl: true }).setView(center, 11);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap",
      maxZoom: 19,
    }).addTo(compareMap);

    rows.forEach(function (r) {
      addCompareMapMarker(compareMap, r);
    });

    if (legendEl) {
      legendEl.innerHTML =
        QUAD_ORDER.map(function (q) {
          return `<div><span class="dot" style="background:${QUAD_COLORS[q]}"></span>${q}</div>`;
        }).join("") + '<div class="muted" style="font-size:11px;margin-top:4px">大小 = 客流潜力分</div>';
    }

    applyCompareMapFilter();
    bindCompareMapResizeObserver(mapEl);
    scheduleCompareMapRefresh();
  }

  function renderCompareQuadChart() {
    const chartEl = el("compareQuadChart");
    if (!chartEl || typeof echarts === "undefined") return;

    if (compareChart) {
      compareChart.dispose();
      compareChart = null;
    }

    const rows = compareState.rows.filter((r) => !r.error);
    if (!rows.length) {
      chartEl.innerHTML = "<p class='muted' style='padding:20px'>暂无数据</p>";
      return;
    }

    chartEl.innerHTML = "";
    compareChart = echarts.init(chartEl);
    const medP = compareState.medians.potential ?? 50;
    const medC = compareState.medians.capability ?? 50;

    compareChart.setOption({
      tooltip: {
        trigger: "item",
        formatter: function (p) {
          return `${p.name}<br/>兑现 ${p.value[0]} · 潜力 ${p.value[1]}`;
        },
      },
      grid: { left: 52, right: 24, top: 24, bottom: 44 },
      xAxis: {
        name: "经营兑现分",
        min: 0,
        max: 100,
        splitLine: { lineStyle: { type: "dashed", color: "#e2e8f0" } },
      },
      yAxis: {
        name: "客流潜力分",
        min: 0,
        max: 100,
        splitLine: { lineStyle: { type: "dashed", color: "#e2e8f0" } },
      },
      series: QUAD_ORDER.map(function (q) {
        return {
          name: q,
          type: "scatter",
          symbolSize: 16,
          itemStyle: { color: QUAD_COLORS[q] },
          data: rows.filter((r) => r.quad === q).map((r) => ({
            value: [r.capability, r.potential],
            name: r.name,
            storeId: r.storeId,
          })),
        };
      }),
      markLine: {
        silent: true,
        symbol: "none",
        lineStyle: { color: "#94a3b8", type: "dashed" },
        data: [{ xAxis: medC }, { yAxis: medP }],
      },
    });

    compareChart.on("click", function (params) {
      const sid = params.data?.storeId;
      if (!sid) return;
      compareState.pickedId = sid;
      flyToCompareStore(sid);
      highlightCompareRows();
    });
  }

  function flyToCompareStore(storeId) {
    const row = compareState.rows.find((r) => r.storeId === storeId);
    const marker = compareMarkers[storeId];
    if (!compareMap || !row || !marker) return;
    compareMap.flyTo([Number(row.lat), Number(row.lng)], 13, { duration: 0.7 });
    setTimeout(function () { marker.openPopup(); }, 750);
  }

  function highlightCompareRows() {
    document.querySelectorAll(".compare-row").forEach(function (tr) {
      const active = tr.dataset.store === compareState.pickedId;
      tr.classList.toggle("row-active", active);
    });
    if (compareState.pickedId) flyToCompareStore(compareState.pickedId);
  }

  function renderCompareTable() {
    const box = el("compareTable");
    if (!box) return;
    const rows = filteredRows();
    const allRows = compareState.rows;
    if (!allRows.length) {
      box.innerHTML = "<p class='muted'>当前账号暂无可见门店</p>";
      return;
    }

    box.innerHTML = `<div class="compare-table-wrap"><table class="compare-table">
      <thead><tr>
        <th>门店</th><th>区域</th><th>营业额</th><th>进店率</th><th>成交率</th><th>客单价</th>
        <th>毛利率</th><th>成本占比</th><th>潜力分</th><th>兑现分</th><th>象限</th><th>月目标达成</th><th>健康度</th><th>建议动作</th>
      </tr></thead>
      <tbody>${allRows.map(function (r) {
        if (r.error) return `<tr><td>${r.name}</td><td colspan="13" class="muted">${r.error}</td></tr>`;
        const hidden = compareState.filter !== "全部" && r.quad !== compareState.filter;
        return `<tr class="compare-row${hidden ? " row-hidden" : ""}" data-store="${r.storeId}">
          <td><strong>${r.name}</strong></td>
          <td>${r.district || r.location || "—"}</td>
          <td>¥${r.salesWan}万</td>
          <td>${r.capturePct}%</td>
          <td>${r.convPct}%</td>
          <td>¥${r.aov}</td>
          <td>${r.grossMarginPct}%</td>
          <td>${r.costRatioPct}%</td>
          <td>${r.potential ?? "—"}</td>
          <td>${r.capability ?? "—"}</td>
          <td><span class="compare-quad-tag" style="--quad-color:${r.quadColor || QUAD_COLORS[r.quad]}">${r.quad || "—"}</span></td>
          <td>${r.monthTargetAchievedPct != null ? r.monthTargetAchievedPct + "%" : "未设定"}</td>
          <td>${healthDot(r.health)}${r.worstFactor || "正常"}</td>
          <td class="compare-action-cell">${r.quadAction || "—"}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>
    <p class="muted" style="margin-top:8px">点击行定位地图并查看详情；双击行跳转该门店单店诊断</p>`;

    box.querySelectorAll(".compare-row:not(.row-hidden)").forEach(function (tr) {
      tr.onclick = function () {
        compareState.pickedId = tr.dataset.store;
        highlightCompareRows();
      };
      tr.ondblclick = function () {
        jumpToStore(tr.dataset.store);
      };
    });
    highlightCompareRows();
  }

  async function loadCompare() {
    const box = el("compareTable");
    if (box) box.innerHTML = "<p class='muted'>加载多店对比数据…</p>";
    try {
      const data = await FenqunAPI.api("/stores/compare");
      compareState.rows = data.stores || [];
      compareState.medians = data.medians || {};
      compareState.filter = "全部";
      compareState.pickedId = null;

      renderCompareKpis(data.quadSummary || {});
      renderCompareFilter();
      renderCompareMap();
      renderCompareQuadChart();
      renderCompareTable();
      scheduleCompareMapRefresh();
    } catch (e) {
      if (box) box.innerHTML = `<div class="warn-box">${e.message}</div>`;
    }
  }

  function renderReportsCatalogIfNeeded() {
    if (window.renderReportsTab) window.renderReportsTab();
  }

  function reviewItem(label, cur, prevChangePct, unit) {
    const up = prevChangePct != null && prevChangePct >= 0;
    const changeLabel = prevChangePct == null ? "—" : (up ? "+" : "") + prevChangePct + "%";
    return `<div class="report-review-item">
      <div class="val ${prevChangePct == null ? "" : up ? "up" : "down"}">${unit === "wan" ? fmtWan(cur) : cur + "%"}</div>
      <div class="lbl">${label} · 环比 ${changeLabel}</div>
    </div>`;
  }

  function renderReport(report) {
    lastReport = report;
    const box = el("reportPreview");
    if (!box) return;
    const periodLabel = { day: "日报", week: "周报", month: "月报" }[report.periodType] || "周报";
    box.innerHTML = `<div class="report-doc">
      <div class="report-doc-hd">
        <h3>${report.storeName} · 经营诊断${periodLabel}</h3>
        <p>${report.period.start} ~ ${report.period.end} · 生成时间 ${report.generatedAt.slice(0, 16).replace("T", " ")}</p>
      </div>
      <div class="report-section">
        <div class="report-section-hd"><span class="report-section-num">1</span><h4>诊断</h4></div>
        <p class="muted">${report.diagnosis.summary}</p>
        <ul>${report.diagnosis.factors.map((f) => `<li>${f.name}：${f.display || f.current} · 偏差 ${f.pct >= 0 ? "+" : ""}${Number(f.pct).toFixed(1)}%（${f.levelLabel}）</li>`).join("")}
          <li>毛利率 ${report.diagnosis.grossMargin.currentPct}%（${report.diagnosis.grossMargin.levelLabel}） · 成本占比 ${report.diagnosis.cost.currentRatioPct}%（${report.diagnosis.cost.levelLabel}）</li>
        </ul>
      </div>
      <div class="report-section">
        <div class="report-section-hd"><span class="report-section-num">2</span><h4>方案</h4></div>
        <ul>${report.solutions.map((s) => `<li><b>${s.title}</b>：${(s.steps || []).join("；")}</li>`).join("")}</ul>
      </div>
      <div class="report-section">
        <div class="report-section-hd"><span class="report-section-num">3</span><h4>策略</h4></div>
        <p class="muted">诊断出的问题可前往「运营方案」对应分类查看具体工具与执行动作：</p>
        ${report.strategy.length
          ? report.strategy.map((s) => `<a href="javascript:void(0)" class="report-strategy-link" data-cat="${s.cat}">${s.label} →</a>`).join("")
          : "<p class='muted'>各维度表现平稳，暂无重点策略推荐</p>"}
      </div>
      <div class="report-section">
        <div class="report-section-hd"><span class="report-section-num">4</span><h4>复盘（对比上一周期）</h4></div>
        <div class="report-review-grid">
          ${reviewItem("营业额", report.review.revenue.current, report.review.revenue.changePct, "wan")}
          ${reviewItem("毛利率", report.review.grossMarginPct.current, report.review.grossMarginPct.changePct)}
          ${reviewItem("成本占比", report.review.costRatioPct.current, report.review.costRatioPct.changePct)}
        </div>
        ${report.review.target ? `<p class="muted" style="margin-top:10px">本期目标 ¥${report.review.target.targetValue ? (report.review.target.targetValue / 10000).toFixed(1) : "—"}万 · 达成率 ${report.review.target.achievedPct ?? "—"}%</p>` : ""}
      </div>
    </div>`;
    box.querySelectorAll(".report-strategy-link").forEach(function (a) {
      a.onclick = function () {
        window.switchTab?.("solutions-hub", { cat: a.dataset.cat });
      };
    });
  }

  async function generateReport() {
    const periodType = el("reportPeriodType")?.value || "week";
    reportProg = reportProg || FQ_AI.createProgressController(el("reportProgressHost"));
    try {
      const report = await FQ_AI.runWithProgress(reportProg, "正在组装诊断-方案-策略-复盘报告…", function () {
        return FenqunAPI.api("/stores/" + getStoreId() + "/diagnosis-report", { method: "POST", body: { periodType } });
      });
      renderReport(report);
      loadReportHistory();
      FenqunAPI.toast("报告已生成");
    } catch (e) {
      FenqunAPI.toast(e.message);
    }
  }

  async function loadSubscription() {
    try {
      const data = await FenqunAPI.api("/stores/" + getStoreId() + "/report-subscription");
      const sub = data.subscription;
      if (sub) {
        el("reportEmails").value = sub.emails || "";
        el("reportFreq").value = sub.frequency || "weekly";
        el("subscriptionStatus").textContent = sub.active
          ? `已开启${{ daily: "每日", weekly: "每周", monthly: "每月" }[sub.frequency] || ""}推送${sub.last_sent_at ? "，上次发送 " + sub.last_sent_at.slice(0, 16).replace("T", " ") : ""}`
          : "已保存但未开启";
      } else {
        el("reportEmails").value = "";
        el("subscriptionStatus").textContent = "尚未配置定时推送";
      }
    } catch (e) {
      if (el("subscriptionStatus")) el("subscriptionStatus").textContent = e.message;
    }
  }

  async function saveSubscription() {
    const emails = el("reportEmails")?.value.trim();
    if (!emails) return FenqunAPI.toast("请填写至少一个收件邮箱");
    try {
      await FenqunAPI.api("/stores/" + getStoreId() + "/report-subscription", {
        method: "POST",
        body: { emails, frequency: el("reportFreq").value, active: true },
      });
      FenqunAPI.toast("定时推送已保存");
      loadSubscription();
    } catch (e) {
      FenqunAPI.toast(e.message);
    }
  }

  async function sendNow() {
    const emails = el("reportEmails")?.value.trim();
    try {
      const r = await FenqunAPI.api("/stores/" + getStoreId() + "/report-subscription/send-now", {
        method: "POST",
        body: { periodType: el("reportPeriodType")?.value || "week", emails: emails || undefined },
      });
      FenqunAPI.toast(r.sent ? "已发送（或 SMTP 未配置时已在服务端跳过）" : "发送失败");
      loadSubscription();
    } catch (e) {
      FenqunAPI.toast(e.message);
    }
  }

  async function loadReportHistory() {
    const box = el("reportHistoryList");
    if (!box) return;
    try {
      const data = await FenqunAPI.api("/stores/" + getStoreId() + "/diagnosis-reports");
      const rows = data.reports || [];
      box.innerHTML = rows.length
        ? rows
            .map(
              (r) =>
                `<div class="report-history-item"><span>${r.createdAt.slice(0, 16).replace("T", " ")} · ${{ day: "日报", week: "周报", month: "月报" }[r.periodType] || r.periodType}</span>
                <button type="button" class="btn-link btn-view-report" data-id="${r.id}">查看</button></div>`,
            )
            .join("")
        : "<p class='muted'>暂无历史报告，点击上方「生成诊断报告」创建第一份</p>";
      box.querySelectorAll(".btn-view-report").forEach(function (btn) {
        btn.onclick = function () {
          const row = rows.find((r) => String(r.id) === btn.dataset.id);
          if (row) renderReport(row.report);
        };
      });
    } catch (e) {
      box.innerHTML = `<p class="muted">${e.message}</p>`;
    }
  }

  function bindOnce() {
    if (bindOnce.done) return;
    bindOnce.done = true;
    document.querySelectorAll("#diagDimNav .step-pill").forEach(function (p) {
      p.onclick = function () { setDim(p.dataset.dim); };
    });
    el("btnGenReport")?.addEventListener("click", generateReport);
    el("btnSaveSubscription")?.addEventListener("click", saveSubscription);
    el("btnSendNow")?.addEventListener("click", sendNow);
  }

  function init() {
    bindOnce();
    setMode("overview");
    setDim("revenue");
  }

  function onStoreChange() {
    marginCostCache = null;
    if (mode === "overview" || mode === "dim") loadTargets();
    if (mode === "dim" && dim !== "revenue") loadMarginCost(true);
    if (mode === "multi") loadCompare();
    if (mode === "report") {
      loadSubscription();
      loadReportHistory();
    }
  }

  window.PerfDiagnosis = { init, onStoreChange, setMode, setDim };
})();
