/* 客群基本信息：综合报告 / 客群矩阵 / 年龄性别 / 时段高峰 / 客流趋势
   数据源：crowd-report/data 下的 CSV；支持时段选择（昨日/近7日/近30日）。
   图表用 ECharts；客流趋势带次日预测。 */
(function () {
  const TITLES = { report: "综合报告", matrix: "客群矩阵", "age-sex": "年龄性别", "time-peak": "时段高峰", "flow-trend": "客流趋势" };
  const PERSONAS = ["家庭主妇", "退休老人", "中青年", "学生", "上班族"];
  const PERSONA_COLORS = ["#5b8ff9", "#5ad8a6", "#f6bd16", "#e8684a", "#6dc8ec"];

  let trafficRows = [], crowdRows = [], loaded = false;
  let currentPeriod = "week";
  const charts = {};

  function panelEl() { return document.getElementById("customerInsightPanel"); }
  function fmt(n) { return Number(n || 0).toLocaleString("zh-CN"); }
  function pct(x) { return (x * 100).toFixed(1) + "%"; }

  function parseCSV(text) {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
    const header = lines[0].split(",");
    return lines.slice(1).map((line) => {
      const cells = line.split(",");
      const row = {};
      header.forEach((h, i) => { row[h] = cells[i]; });
      return row;
    });
  }

  async function ensureLoaded() {
    if (loaded) return;
    const [tText, cText] = await Promise.all([
      fetch("crowd-report/data/hourly_traffic.csv").then((r) => { if (!r.ok) throw new Error("traffic.csv " + r.status); return r.text(); }),
      fetch("crowd-report/data/hourly_crowd.csv").then((r) => { if (!r.ok) throw new Error("crowd.csv " + r.status); return r.text(); }),
    ]);
    trafficRows = parseCSV(tText).filter((r) => (r.store || "").startsWith("零食店"));
    crowdRows = parseCSV(cText).filter((r) => (r.store || "").startsWith("零食店"));
    loaded = true;
    initDateRange();
  }

  function getChart(id) {
    const el = document.getElementById(id);
    if (!el || typeof echarts === "undefined") return null;
    let c = charts[id] || echarts.init(el);
    charts[id] = c;
    return c;
  }
  function chartDiv(id, h) { return `<div id="${id}" style="width:100%;height:${h || 340}px"></div>`; }
  function section(title, html) { return `<div class="ci-section"><h4 class="ci-section-title">${title}</h4>${html}</div>`; }

  // ---------- 时段（支持自由选择起止日期） ----------
  function getPeriodDates() {
    const dates = [...new Set(trafficRows.map((r) => r.date))].sort();
    if (!dates.length) return [];
    const s = document.getElementById("customerStartDate")?.value || "";
    const e = document.getElementById("customerEndDate")?.value || "";
    return dates.filter((d) => (!s || d >= s) && (!e || d <= e));
  }
  function initDateRange() {
    const dates = [...new Set(trafficRows.map((r) => r.date))].sort();
    if (!dates.length) return;
    const min = dates[0], max = dates[dates.length - 1];
    const sEl = document.getElementById("customerStartDate");
    const eEl = document.getElementById("customerEndDate");
    if (!sEl || !eEl) return;
    sEl.min = min; sEl.max = max; eEl.min = min; eEl.max = max;
    if (!sEl.value && !eEl.value) {
      const d7 = new Date(max + "T00:00:00"); d7.setDate(d7.getDate() - 6);
      sEl.value = d7.toISOString().slice(0, 10);
      eEl.value = max;
    }
  }
  function filterRows(rows, dates) {
    const set = new Set(dates);
    return rows.filter((r) => set.has(r.date));
  }
  // 分人群 × 分时段过店矩阵（24 小时 × 5 人群）
  function aggHourPersona(dates) {
    const cRows = filterRows(crowdRows, dates);
    const matrix = Array.from({ length: 24 }, () => {
      const m = {}; PERSONAS.forEach((p) => { m[p] = 0; }); return m;
    });
    cRows.forEach((r) => { if (matrix[+r.hour] && matrix[+r.hour][r.persona] != null) matrix[+r.hour][r.persona] += +r.passers || 0; });
    return matrix;
  }

  function computeStats() {
    const dates = getPeriodDates();
    const tRows = filterRows(trafficRows, dates);
    const cRows = filterRows(crowdRows, dates);
    const nDays = Math.max(1, dates.length);

    const hourly = Array.from({ length: 24 }, () => ({ passers: 0, enters: 0 }));
    tRows.forEach((r) => { hourly[+r.hour].passers += +r.passers || 0; hourly[+r.hour].enters += +r.enters || 0; });
    hourly.forEach((h) => { h.passers = Math.round(h.passers / nDays); h.enters = Math.round(h.enters / nDays); });

    const dailyMap = {}; dates.forEach((d) => { dailyMap[d] = { passers: 0, enters: 0 }; });
    tRows.forEach((r) => { if (dailyMap[r.date]) { dailyMap[r.date].passers += +r.passers || 0; dailyMap[r.date].enters += +r.enters || 0; } });
    const daily = dates.map((d) => ({ d, ...dailyMap[d] }));

    const personaAgg = {}; PERSONAS.forEach((p) => { personaAgg[p] = { passers: 0, enters: 0, byHour: Array(24).fill(0) }; });
    cRows.forEach((r) => { const a = personaAgg[r.persona]; if (!a) return; a.passers += +r.passers || 0; a.enters += +r.enters || 0; a.byHour[+r.hour] += +r.passers || 0; });

    const totalPassers = tRows.reduce((s, r) => s + (+r.passers || 0), 0);
    const totalEnters = tRows.reduce((s, r) => s + (+r.enters || 0), 0);
    const conv = totalPassers > 0 ? totalEnters / totalPassers : 0;
    const peakHour = hourly.reduce((m, h, i) => (h.passers > hourly[m].passers ? i : m), 0);
    const topPersona = PERSONAS.reduce((m, p) => (personaAgg[p].passers > personaAgg[m].passers ? p : m), PERSONAS[0]);

    return { dates, nDays, hourly, daily, personaAgg, totalPassers, totalEnters, conv, peakHour, topPersona };
  }

  // ---------- 预测 ----------
  function linearPredict(values) {
    const n = values.length;
    if (n === 0) return 0;
    if (n === 1) return values[0];
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (i - xMean) * (values[i] - yMean); den += (i - xMean) * (i - xMean); }
    const slope = den ? num / den : 0;
    return Math.max(0, Math.round(yMean - slope * xMean + slope * n));
  }
  function predictNext(st) {
    const recent = st.daily.slice(-14).map((d) => d.passers);
    const total = linearPredict(recent);
    const totalPersona = PERSONAS.reduce((s, p) => s + st.personaAgg[p].passers, 0) || 1;
    const byPersona = PERSONAS
      .map((p) => ({ name: p, count: Math.round(total * (st.personaAgg[p].passers / totalPersona)), pct: Math.round((st.personaAgg[p].passers / totalPersona) * 1000) / 10 }))
      .sort((a, b) => b.count - a.count);
    return { total, byPersona };
  }

  // ---------- 综合报告 ----------
  async function renderReport() {
    await ensureLoaded();
    const st = computeStats();
    const pred = predictNext(st);
    const nextDate = nextDateOf(st.dates[st.dates.length - 1]);
    const isDay = st.dates.length === 1;
    const isWeek = st.dates.length <= 7;

    // KPI
    const kpis = [
      { label: "总过店人数", value: fmt(st.totalPassers), note: isDay ? "昨日路过总人次" : `日均 ${fmt(Math.round(st.totalPassers / st.nDays))} 人` },
      { label: "总进店人数", value: fmt(st.totalEnters), note: isDay ? "昨日进店总人次" : `日均 ${fmt(Math.round(st.totalEnters / st.nDays))} 人` },
      { label: "进店转化率", value: pct(st.conv), note: "进店 / 过店" },
      { label: "峰值时段", value: `${st.peakHour}:00`, note: `时均过店 ${fmt(st.hourly[st.peakHour].passers)} 人` },
      { label: "客流最高人群", value: st.topPersona, note: "按过店人数计" },
    ];
    const kpiHtml = kpis.map((k) => `<div class="ci-kpi"><div class="lbl">${k.label}</div><div class="val">${k.value}</div><div class="note">${k.note}</div></div>`).join("");

    // 洞察
    const insights = buildInsights(st);

    // 排班
    const shifts = buildShifts(st);

    // 人群
    const personaPie = PERSONAS.map((p, i) => ({ name: p, value: st.personaAgg[p].passers, itemStyle: { color: PERSONA_COLORS[i] } }));

    panelEl().innerHTML =
      `<div class="kpi-grid" style="margin-bottom:14px">${kpiHtml}</div>` +
      section("关键洞察", `${insights.map((it) => `<div class="ci-insight ${it.cls === "warn" ? "warn" : it.cls === "good" ? "good" : ""}">${it.html}</div>`).join("")}`) +
      section("错峰排班建议", `<div class="table-wrap"><table class="exec-table">
        <thead><tr><th>时段</th><th>客流等级</th><th>时均过店</th><th>建议在岗人数</th><th>建议动作</th></tr></thead><tbody>${shifts}</tbody></table></div>`) +
      section("分时段客流与转化", chartDiv("repHourly", 360)) +
      `<div class="ci-grid-2">
        <div>${section("人群结构占比（按过店）", chartDiv("repPie", 320))}</div>
        <div>${section("各人群分时段过店分布", chartDiv("repPersonaHour", 320))}</div>
      </div>` +
      section("按日趋势 + 次日预测", chartDiv("repDaily", 360) + `<div class="ci-prediction" style="margin-top:10px">
        <div class="pd-title">次日预测（${nextDate}）</div>
        <div class="pd-total">预计过店 <b>${fmt(pred.total)}</b> 人</div>
        <div class="note">${pred.byPersona.map((p) => `${p.name} ${fmt(p.count)}(${p.pct}%)`).join(" · ")}</div>
      </div>`);

    renderChart("repHourly", {
      tooltip: { trigger: "axis" }, legend: { data: ["过店", "进店"] },
      grid: { left: 56, right: 30, top: 40, bottom: 30 },
      xAxis: { type: "category", data: Array.from({ length: 24 }, (_, i) => i + "时") }, yAxis: { type: "value" },
      series: [
        { name: "过店", type: "bar", data: st.hourly.map((h) => h.passers), itemStyle: { color: "#2563eb" } },
        { name: "进店", type: "line", smooth: true, data: st.hourly.map((h) => h.enters), itemStyle: { color: "#18a058" } },
      ],
    });
    renderChart("repPie", { tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" }, legend: { bottom: 0 }, series: [{ type: "pie", radius: ["40%", "66%"], center: ["50%", "44%"], label: { formatter: "{b}\n{d}%" }, data: personaPie }] });
    renderChart("repPersonaHour", {
      tooltip: { trigger: "axis" }, legend: { bottom: 0, itemWidth: 12 }, color: PERSONA_COLORS,
      grid: { left: 56, right: 16, top: 24, bottom: 54 },
      xAxis: { type: "category", data: Array.from({ length: 24 }, (_, i) => i + "时") }, yAxis: { type: "value" },
      series: PERSONAS.map((p) => ({ name: p, type: "bar", stack: "total", data: st.personaAgg[p].byHour.map((v) => Math.round(v / st.nDays)) })),
    });
    const predDates = st.daily.map((d) => d.d).concat([nextDate + "※"]);
    const predPassers = st.daily.map((d) => d.passers).concat([pred.total]);
    const predEnters = st.daily.map((d) => d.enters).concat([null]);
    const predLine = st.daily.map(() => null).concat([pred.total]);
    if (predLine.length >= 2) predLine[predLine.length - 2] = st.daily[st.daily.length - 1].passers;
    renderChart("repDaily", {
      tooltip: { trigger: "axis" }, legend: { data: ["过店", "进店", "次日预测"] },
      grid: { left: 56, right: 30, top: 40, bottom: 50 },
      xAxis: { type: "category", data: predDates, axisLabel: { rotate: 45 } }, yAxis: { type: "value" },
      series: [
        { name: "过店", type: "line", smooth: true, data: predPassers, itemStyle: { color: "#2563eb" }, areaStyle: { opacity: 0.08 } },
        { name: "进店", type: "line", smooth: true, data: predEnters, itemStyle: { color: "#18a058" } },
        { name: "次日预测", type: "line", data: predLine, itemStyle: { color: "#e8a23a" }, lineStyle: { type: "dashed" }, symbol: "diamond", symbolSize: 8 },
      ],
    });
  }

  function buildInsights(st) {
    const out = [];
    const hh = (h) => `${h}:00-${h + 1}:00`;
    const avg = st.hourly.reduce((s, h) => s + h.passers, 0) / 24;
    out.push({ cls: "", html: `客流峰值：过店峰值出现在 <b>${hh(st.peakHour)}</b>（时均 <b>${fmt(st.hourly[st.peakHour].passers)}</b> 人）。` });
    const valid = st.hourly.map((h, i) => ({ ...h, i })).filter((h) => h.passers >= avg * 0.3);
    if (valid.length >= 2) {
      const best = valid.reduce((m, h) => (h.passers > 0 ? h.enters / h.passers : 0) > (m.passers > 0 ? m.enters / m.passers : 0) ? h : m);
      const worst = valid.reduce((m, h) => (h.passers > 0 ? h.enters / h.passers : 0) < (m.passers > 0 ? m.enters / m.passers : 1) ? h : m);
      out.push({ cls: "good", html: `转化表现：进店转化率最高时段 <b>${hh(best.i)}</b>（${pct(best.passers > 0 ? best.enters / best.passers : 0)}），最低 <b>${hh(worst.i)}</b>（${pct(worst.passers > 0 ? worst.enters / worst.passers : 0)}）。` });
    }
    const tp = st.personaAgg[st.topPersona];
    const totalP = PERSONAS.reduce((s, p) => s + st.personaAgg[p].passers, 0) || 1;
    const tpShare = tp.passers / totalP;
    const tpPeak = tp.byHour.reduce((m, v, i) => (v > tp.byHour[m] ? i : m), 0);
    out.push({ cls: "", html: `人群结构：占比最高 <b>${st.topPersona}</b>（<b>${pct(tpShare)}</b>），活跃高峰 <b>${hh(tpPeak)}</b>。` });
    return out;
  }

  function buildShifts(st) {
    const ps = st.hourly.map((h) => h.passers);
    const sorted = [...ps].sort((a, b) => a - b);
    const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const p75 = q(0.75), p40 = q(0.4);
    const lv = (v) => (v >= p75 ? 2 : v >= p40 ? 1 : 0);
    const META = [
      { name: "低谷", cls: "low", staff: "1 人", action: "保洁、盘点、处理线上订单与会员回访" },
      { name: "平峰", cls: "flat", staff: "2-3 人", action: "补货理货、检查陈列与价签" },
      { name: "高峰", cls: "peak", staff: "4 人", action: "全员接待、门口促销迎宾/试吃、加开收银" },
    ];
    const segs = [];
    for (let h = 0; h < 24; h++) {
      const l = lv(ps[h]);
      const last = segs[segs.length - 1];
      if (last && last.lv === l) { last.end = h; last.sum += ps[h]; last.n++; }
      else segs.push({ start: h, end: h, lv: l, sum: ps[h], n: 1 });
    }
    return segs.map((s) => { const m = META[s.lv]; return `<tr><td>${s.start}:00 - ${s.end + 1}:00</td><td><span class="ci-badge ${m.cls}">${m.name}</span></td><td>${fmt(Math.round(s.sum / s.n))} 人</td><td>${m.staff}</td><td>${m.action}</td></tr>`; }).join("");
  }

  // ---------- 客群矩阵 ----------
  async function renderMatrix() {
    await ensureLoaded();
    const st = computeStats();
    const persons = PERSONAS.map((p) => ({ name: p, passers: st.personaAgg[p].passers, conv: st.personaAgg[p].passers > 0 ? st.personaAgg[p].enters / st.personaAgg[p].passers : 0 }));
    const maxP = Math.max.apply(null, persons.map((p) => p.passers).concat([1]));
    const maxC = Math.max.apply(null, persons.map((p) => p.conv).concat([0.01]));
    const rows = persons.map((p) => {
      const potential = Math.round((p.passers / maxP) * 100);
      const contribution = Math.round((p.conv / maxC) * 100);
      const quadrant = potential >= 60 && contribution >= 60 ? "明星客群" : potential >= 60 ? "潜力客群" : contribution >= 60 ? "高贡献客群" : "一般客群";
      const c = quadrant === "明星客群" ? "#166534" : quadrant === "潜力客群" ? "#1e40af" : quadrant === "高贡献客群" ? "#9a3412" : "#475569";
      return `<tr><td><strong>${p.name}</strong></td><td style="text-align:right">${potential}</td><td style="text-align:right">${contribution}</td><td><span class="tag" style="background:#eef2ff;color:${c}">${quadrant}</span></td></tr>`;
    }).join("");
    panelEl().innerHTML = section("客流潜力 × 消费贡献（按人群）", chartDiv("cusMatrixChart", 380) +
      `<div class="table-wrap" style="margin-top:10px"><table class="exec-table"><thead><tr><th>人群</th><th>潜力分</th><th>贡献分</th><th>象限</th></tr></thead><tbody>${rows}</tbody></table></div>`);
    renderChart("cusMatrixChart", {
      tooltip: { formatter: (p) => `${p.data[3]}<br/>潜力 ${p.data[0]} · 贡献 ${p.data[1]}` },
      grid: { left: 50, right: 30, top: 30, bottom: 50 },
      xAxis: { name: "客流潜力", max: 100, min: 0, splitLine: { lineStyle: { type: "dashed" } } },
      yAxis: { name: "消费贡献", max: 100, min: 0, splitLine: { lineStyle: { type: "dashed" } } },
      series: [{ type: "scatter", symbolSize: (v) => 18 + v[2] * 2, data: persons.map((p) => [Math.round((p.passers / maxP) * 100), Math.round((p.conv / maxC) * 100), p.passers, p.name]), label: { show: true, formatter: (p) => p.data[3], position: "top" }, itemStyle: { color: "#2563eb", opacity: 0.85 } }],
    });
  }

  // ---------- 年龄性别/人群结构 ----------
  async function renderAgeSex() {
    await ensureLoaded();
    const st = computeStats();
    const persons = PERSONAS.map((p, i) => ({ name: p, value: st.personaAgg[p].passers, color: PERSONA_COLORS[i], enters: st.personaAgg[p].enters }));
    panelEl().innerHTML = `<div class="ci-grid-2">
      <div>${section("人群结构占比（按过店）", chartDiv("cusPie", 330))}</div>
      <div>${section("各人群过店 / 进店", chartDiv("cusBar", 330))}</div></div>`;
    renderChart("cusPie", { tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" }, legend: { bottom: 0 }, series: [{ type: "pie", radius: ["40%", "66%"], center: ["50%", "44%"], label: { formatter: "{b}\n{d}%" }, data: persons.map((p) => ({ name: p.name, value: p.value, itemStyle: { color: p.color } })) }] });
    renderChart("cusBar", { tooltip: { trigger: "axis" }, legend: { data: ["过店", "进店"] }, grid: { left: 56, right: 20, top: 40, bottom: 30 }, xAxis: { type: "category", data: persons.map((p) => p.name) }, yAxis: { type: "value" }, series: [{ name: "过店", type: "bar", data: persons.map((p) => p.value), itemStyle: { color: "#2563eb" } }, { name: "进店", type: "bar", data: persons.map((p) => p.enters), itemStyle: { color: "#18a058" } }] });
  }

  // ---------- 时段高峰：分人群 × 分时段 ----------
  async function renderTimePeak() {
    await ensureLoaded();
    const st = computeStats();
    const nDays = st.nDays;
    const matrix = aggHourPersona(st.dates);
    const hours = Array.from({ length: 24 }, (_, i) => i + "时");

    // 分人群分时段堆叠柱状图
    panelEl().innerHTML = section("各人群分时段过店分布（时均，人）", chartDiv("cusHourPersona", 380)) +
      section("分时总过店 / 进店（时均）", chartDiv("cusTimeChart", 300)) +
      section("分时段 × 分人群过店明细", heatmapTable(matrix, nDays));

    renderChart("cusHourPersona", {
      tooltip: { trigger: "axis" }, legend: { bottom: 0, itemWidth: 12 }, color: PERSONA_COLORS,
      grid: { left: 56, right: 16, top: 24, bottom: 54 },
      xAxis: { type: "category", data: hours }, yAxis: { type: "value" },
      series: PERSONAS.map((p) => ({ name: p, type: "bar", stack: "total", data: matrix.map((m) => Math.round(m[p] / nDays)) })),
    });
    renderChart("cusTimeChart", {
      tooltip: { trigger: "axis" }, legend: { data: ["过店", "进店"] },
      grid: { left: 56, right: 20, top: 40, bottom: 30 },
      xAxis: { type: "category", data: hours }, yAxis: { type: "value" },
      series: [
        { name: "过店", type: "bar", data: st.hourly.map((h) => h.passers), itemStyle: { color: "#2563eb" } },
        { name: "进店", type: "line", smooth: true, data: st.hourly.map((h) => h.enters), itemStyle: { color: "#18a058" } },
      ],
    });
  }

  function heatmapTable(matrix, nDays) {
    const max = Math.max.apply(null, matrix.map((m) => Math.max.apply(null, PERSONAS.map((p) => m[p]))).concat([1]));
    const head = `<tr><th>时段</th>${PERSONAS.map((p) => `<th>${p}</th>`).join("")}</tr>`;
    const body = matrix.map((m, h) => {
      const cells = PERSONAS.map((p) => {
        const v = Math.round(m[p] / nDays);
        const alpha = max > 0 ? Math.round((v / max) * 100) : 0;
        return `<td style="text-align:right;background:${v > 0 ? `rgba(37,99,235,${0.05 + alpha * 0.006})` : "transparent"};font-variant-numeric:tabular-nums">${v || ""}</td>`;
      }).join("");
      return `<tr><td>${h}:00</td>${cells}</tr>`;
    }).join("");
    return `<div class="table-wrap ci-heat"><table class="exec-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      <p class="muted" style="margin-top:6px">单元格为时均过店人数（按所选日期范围折算），颜色越深过店越多。</p>`;
  }

  // ---------- 客流趋势 + 预测 ----------
  async function renderFlowTrend() {
    await ensureLoaded();
    const st = computeStats();
    const pred = predictNext(st);
    const nextDate = nextDateOf(st.dates[st.dates.length - 1]);
    const cards = pred.byPersona.map((p) => `<div class="ci-kpi"><div class="lbl">${p.name}</div><div class="val">${fmt(p.count)}</div><div class="note">约 ${p.pct}%</div></div>`).join("");
    panelEl().innerHTML = section("每日过店 / 进店趋势 + 次日预测", chartDiv("cusTrendChart", 380) +
      `<div class="ci-prediction" style="margin-top:10px">
        <div class="pd-title">次日预测（${nextDate}）</div>
        <div class="pd-total">预计过店 <b>${fmt(pred.total)}</b> 人</div>
        <div class="kpi-grid">${cards}</div>
        <div class="pd-note">预测方法：近 14 日过店线性回归外推 + 各人群历史占比分摊，仅供参考。</div></div>`);
    const dates = st.daily.map((d) => d.d).concat([nextDate + "※"]);
    const passers = st.daily.map((d) => d.passers).concat([pred.total]);
    const enters = st.daily.map((d) => d.enters).concat([null]);
    const predLine = st.daily.map(() => null).concat([pred.total]);
    if (predLine.length >= 2) predLine[predLine.length - 2] = st.daily[st.daily.length - 1].passers;
    renderChart("cusTrendChart", { tooltip: { trigger: "axis" }, legend: { data: ["过店", "进店", "次日预测"] }, grid: { left: 56, right: 30, top: 40, bottom: 50 }, xAxis: { type: "category", data: dates, axisLabel: { rotate: 45 } }, yAxis: { type: "value" }, series: [{ name: "过店", type: "line", smooth: true, data: passers, itemStyle: { color: "#2563eb" }, areaStyle: { opacity: 0.08 } }, { name: "进店", type: "line", smooth: true, data: enters, itemStyle: { color: "#18a058" } }, { name: "次日预测", type: "line", data: predLine, itemStyle: { color: "#e8a23a" }, lineStyle: { type: "dashed" }, symbol: "diamond", symbolSize: 8 }] });
  }

  function renderChart(id, opt) {
    const c = getChart(id);
    if (c) { c.setOption(opt, true); c.resize(); }
  }

  function nextDateOf(d) {
    if (!d) return "明日";
    const dt = new Date(d + "T00:00:00");
    dt.setDate(dt.getDate() + 1);
    return dt.toISOString().slice(0, 10);
  }

  const RENDERERS = { report: renderReport, matrix: renderMatrix, "age-sex": renderAgeSex, "time-peak": renderTimePeak, "flow-trend": renderFlowTrend };

  async function showCategory(cat) {
    const el = panelEl();
    if (!el) return;
    el.innerHTML = `<p class="muted">加载${TITLES[cat] || "客群"}数据…</p>`;
    try {
      await (RENDERERS[cat] || renderReport)();
    } catch (e) {
      el.innerHTML = `<div class="warn-box">加载失败：${e.message}（数据源 crowd-report/data/*.csv）</div>`;
    }
  }

  function onStoreChange() {
    const sec = document.getElementById("tab-customer");
    if (sec && sec.style.display !== "none") showCategory(currentCustomerCat || "report");
  }

  function onPeriodChange() {
    const sec = document.getElementById("tab-customer");
    if (sec && sec.style.display !== "none") showCategory(currentCustomerCat || "report");
  }

  // 绑定起止日期选择器
  const sEl = document.getElementById("customerStartDate");
  const eEl = document.getElementById("customerEndDate");
  if (sEl) sEl.addEventListener("change", onPeriodChange);
  if (eEl) eEl.addEventListener("change", onPeriodChange);

  window.addEventListener("resize", () => Object.values(charts).forEach((c) => c && c.resize()));

  window.CustomerInsight = { showCategory, onStoreChange };
})();
