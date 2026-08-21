(function () {
  let factorChart = null;
  let hourlyChart = null;

  function riskTag(level, pct) {
    if (pct >= 10) return '<span class="tag tag-green">优于基准</span>';
    if (pct >= 0) return '<span class="tag tag-green">正常</span>';
    if (level === "significant") return '<span class="tag tag-red">显著风险</span>';
    if (level === "attention") return '<span class="tag tag-yellow">需关注</span>';
    return '<span class="tag tag-green">正常</span>';
  }

  function factorBarColor(pct) {
    return pct >= 0 ? "#059669aa" : pct > -5 ? "#f59e0baa" : "#dc2626aa";
  }

  function destroyCharts() {
    if (factorChart) factorChart.destroy();
    if (hourlyChart) hourlyChart.destroy();
    factorChart = hourlyChart = null;
  }

  function renderDiagnosis(container, data) {
    destroyCharts();
    const f = data.formula;
    const factors = data.factors || [];
    const byKey = Object.fromEntries(factors.map((x) => [x.key, x]));
    const kpiCls = (key) => (window.FunnelViz?.kpiStatusClass ? FunnelViz.kpiStatusClass(byKey[key]) : "");
    container.innerHTML = `
      <div class="card ki-card">
        <h3>🔍 诊断摘要</h3>
        <p>${data.summary}</p>
        <p class="muted">${data.period.start} ~ ${data.period.end}（${data.period.days} 天）</p>
      </div>
      <div class="card">
        <h3>四因子恒等式</h3>
        <p class="muted formula-legend">绿=优于基准 · 蓝=正常 · 黄=需关注 · 红=显著低于基准（悬停查看偏差）</p>
        ${window.FunnelViz ? FunnelViz.renderFormulaBlock({
          pass: f.pass,
          capture: f.capture,
          conv: f.conv,
          aov: f.aov,
          revenue: f.revenue,
        }, { layout: "stack", factors }) : ""}
        <div class="kpi-grid" style="margin-top:14px">
          <div class="kpi${kpiCls("pass")}"><div class="val">${f.pass.toLocaleString()}</div><div class="lbl">过店人次</div></div>
          <div class="kpi${kpiCls("capture")}"><div class="val">${(f.capture * 100).toFixed(2)}%</div><div class="lbl">进店率</div></div>
          <div class="kpi${kpiCls("conv")}"><div class="val">${(f.conv * 100).toFixed(1)}%</div><div class="lbl">成交率</div></div>
          <div class="kpi${kpiCls("aov")}"><div class="val">¥${f.aov.toFixed(2)}</div><div class="lbl">客单价</div></div>
          <div class="kpi"><div class="val">¥${(f.revenue / 10000).toFixed(1)}万</div><div class="lbl">营业额</div></div>
        </div>
      </div>
      <div class="grid2">
        <div class="card"><h3>因子偏差对比</h3><canvas id="factorChart"></canvas></div>
        <div class="card"><h3>分小时剪刀差</h3><canvas id="hourlyGapChart"></canvas></div>
      </div>
      <div class="card">
        <h3>因子偏差排序</h3>
        <p class="muted">绿=优于基准，红=低于基准（四因子均为越高越好）</p>
        <table>
          <thead><tr><th>因子</th><th>当前</th><th>基准</th><th>偏差</th><th>风险</th><th>操作</th></tr></thead>
          <tbody>
            ${data.factors.map((x) => `<tr>
              <td><b>${x.name}</b></td>
              <td>${x.display || x.current?.toLocaleString?.() || x.current}</td>
              <td>${x.baseDisplay || x.baseline}</td>
              <td style="color:${x.pct < 0 ? "#dc2626" : "#059669"}">${x.pct >= 0 ? "+" : ""}${x.pct.toFixed(1)}%</td>
              <td>${riskTag(x.level, x.pct)}</td>
              <td>${x.pct < 0 ? `<button class="btn secondary btn-go-solution" data-factor="${x.key}">运营方案 →</button>` : '<span class="muted">—</span>'}
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="card">
        <h3>分小时剪刀差明细 TOP 8</h3>
        <table>
          <thead><tr><th>时段</th><th>过店</th><th>过店份额</th><th>销售份额</th><th>剪刀差(pp)</th><th>捕获率</th></tr></thead>
          <tbody>
            ${[...(data.hourlyGaps || [])].sort((a, b) => b.gapPp - a.gapPp).slice(0, 8).map((h) => `<tr>
              <td>${h.label}</td><td>${h.pass.toLocaleString()}</td>
              <td>${h.passShare.toFixed(1)}%</td><td>${h.salesShare.toFixed(1)}%</td>
              <td style="font-weight:600;color:${h.gapPp > 0 ? "#dc2626" : "#059669"}">${h.gapPp >= 0 ? "+" : ""}${h.gapPp.toFixed(1)}</td>
              <td>${(h.capture * 100).toFixed(1)}%</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>`;

    if (window.Chart && data.factors?.length) {
      factorChart = new Chart(document.getElementById("factorChart"), {
        type: "bar",
        data: {
          labels: data.factors.map((x) => x.name),
          datasets: [{
            label: "偏差%",
            data: data.factors.map((x) => x.pct),
            backgroundColor: data.factors.map((x) => factorBarColor(x.pct)),
          }],
        },
        options: { plugins: { legend: { display: false } } },
      });
    }
    const gaps = data.hourlyGaps || [];
    if (window.Chart && gaps.length) {
      hourlyChart = new Chart(document.getElementById("hourlyGapChart"), {
        type: "bar",
        data: {
          labels: gaps.map((h) => h.label),
          datasets: [{
            label: "剪刀差(pp)",
            data: gaps.map((h) => h.gapPp),
            backgroundColor: gaps.map((h) => (h.gapPp > 0 ? "#dc262699" : "#05966999")),
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

  window.FunnelUI = { renderDiagnosis, riskTag, destroyCharts };
})();
