(function () {
  let salesChart = null;
  let gapChart = null;
  let bucketChart = null;

  function destroyCharts() {
    [salesChart, gapChart, bucketChart].forEach(function (c) {
      if (c) c.destroy();
    });
    salesChart = gapChart = bucketChart = null;
  }

  function renderDashboardCore(container, data) {
    destroyCharts();
    const k = data.kpis;
    container.innerHTML = `
      <div class="card hero-lite">
        <h2>${data.meta?.name || data.storeId}</h2>
        <p class="sub">${data.range.lo} ~ ${data.range.hi} · ${data.meta?.isReal ? "长沙标杆店" : "演示模拟店"}</p>
        ${FunnelViz.renderHeroPanel({
          pass: k.pass,
          capturePct: k.capturePct,
          convPct: k.convPct,
          aov: k.aov,
          salesWan: k.salesWan,
        }, data.insights, null, data.tradeArea)}
      </div>
      <div class="kpi-grid">
        <div class="kpi"><div class="val">¥${k.salesWan}万</div><div class="lbl">期间销售</div></div>
        <div class="kpi"><div class="val">${(k.pass / 10000).toFixed(0)}万</div><div class="lbl">过店人次</div></div>
        <div class="kpi"><div class="val">${k.capturePct}%</div><div class="lbl">进店率</div></div>
        <div class="kpi"><div class="val">${k.convPct}%</div><div class="lbl">成交率</div></div>
        <div class="kpi"><div class="val">¥${k.aov}</div><div class="lbl">客单价</div></div>
        <div class="kpi"><div class="val">${k.alertDays}</div><div class="lbl">进店异常天</div></div>
      </div>
      <div class="grid2">
        <div class="card"><h3>月度销售走势</h3><canvas id="dashSalesChart"></canvas></div>
        <div class="card"><h3>分小时剪刀差（过店 vs 销售）</h3><canvas id="dashBucketChart"></canvas></div>
      </div>`;

    if (data.monthly?.length && window.Chart) {
      salesChart = new Chart(document.getElementById("dashSalesChart"), {
        type: "bar",
        data: {
          labels: data.monthly.map((m) => m.month),
          datasets: [{ label: "销售(万)", data: data.monthly.map((m) => m.salesWan), backgroundColor: "#2563eb99" }],
        },
        options: { plugins: { legend: { display: false } } },
      });
    }
    if (data.hourlyGaps?.length && window.Chart) {
      bucketChart = new Chart(document.getElementById("dashBucketChart"), {
        type: "bar",
        data: {
          labels: data.hourlyGaps.map((h) => h.label),
          datasets: [{
            label: "剪刀差(pp)",
            data: data.hourlyGaps.map((h) => h.gapPp),
            backgroundColor: data.hourlyGaps.map((h) => (h.gapPp > 0 ? "#dc262699" : "#05966999")),
          }],
        },
        options: {
          plugins: { legend: { display: false } },
          scales: {
            x: {
              ticks: { maxRotation: 45, minRotation: 45, autoSkip: false, font: { size: 10 } },
            },
            y: { title: { display: true, text: "pp" } },
          },
        },
      });
    }
  }

  function renderDemoCard(d) {
    return `<button type="button" class="demo-card report-open" data-url="${d.path}" data-name="${d.name}" data-template="${d.templateId || ""}">
      <div class="num">${d.num}</div><h4>${d.name}</h4><p>${d.desc}</p>
      <div class="meta">${(d.tags || []).map((t) => `<span class="tag tag-blue">${t}</span>`).join(" ")}</div>
    </button>`;
  }

  function renderReportLanes(data) {
    if (!window.REPORT_CATALOG) return "";
    const base = data.reportBase;
    let html = `<div class="card"><h3>决策报告库 · 按数据来源</h3>
      <p class="muted">点击下方卡片在内嵌窗口查看完整 Demo 报告（与 example1 决策看板一致）</p>`;
    if (!base) {
      html += `<div class="warn-box">当前为模拟门店，完整 20+ 报告请切换至 <b>长沙望城银杉路零食店</b> 查看。</div>`;
    }
    html += '<div class="cat-lanes">';
    for (const lane of REPORT_CATALOG.store) {
      html += `<div class="cat-lane" data-cat="${lane.cat}">
        <div class="cat-lane-hd"><span class="icon">${lane.icon}</span>
          <div class="meta"><h4>${lane.title}</h4><p class="cat-sub">${lane.sub}</p></div></div>
        <div class="cat-lane-body">${lane.items
          .map(
            (it) =>
              `<button type="button" class="cat-lane-item report-open" data-url="${base ? base + it.path : ""}" data-name="${it.name}" data-template="${it.templateId || ""}" ${base ? "" : "disabled"}>
                <h4>${it.name}</h4><p>${it.desc}</p></button>`,
          )
          .join("")}</div></div>`;
    }
    html += "</div></div>";

    html += `<div class="card" id="valueDemoCatalog"><h3>客群价值 Demo 目录</h3>
      <p class="muted">8 大业务场景 + 真实门店深度案例，与 demo 门户目录一致（5 + 3 + 案例）</p>`;
    for (const sec of REPORT_CATALOG.valueDemoSections) {
      html += `<div class="demo-section">
        <div class="demo-section-hd"><h4>${sec.title}</h4><span>${sec.sub}</span></div>
        <div class="demo-grid">${sec.items.map(renderDemoCard).join("")}</div></div>`;
    }
    html += "</div>";
    return html;
  }

  function renderReportViewer(url, name, templateId) {
    const panel = document.getElementById("reportViewer");
    if (!panel) return;
    const frame = document.getElementById("reportFrame");
    document.getElementById("reportTitle").textContent = name;
    const openUrl = window.ReportEmbed
      ? ReportEmbed.buildEmbedUrl(url, name, templateId).href
      : url + (url.includes("?") ? "&" : "?") + "embed=system";
    document.getElementById("reportOpenNew").href = openUrl;
    panel.style.display = "flex";
    if (window.ReportEmbed && frame) {
      ReportEmbed.openReport(frame, url, name, templateId);
    } else if (frame) {
      frame.src = openUrl;
    }
  }

  function renderDashboard(container, data) {
    renderDashboardCore(container, data);
    container.insertAdjacentHTML("beforeend", renderReportLanes(data));
  }

  window.DashboardUI = { renderDashboard, renderDashboardCore, renderReportLanes, renderReportViewer, destroyCharts };
})();
