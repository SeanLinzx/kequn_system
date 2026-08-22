import { loadFunnel } from "./funnel.mjs";
import { getTradeArea } from "./trade-area.mjs";

function aggregate(days) {
  const p = days.reduce((s, d) => s + d.p, 0);
  const e = days.reduce((s, d) => s + d.e, 0);
  const o = days.reduce((s, d) => s + d.o, 0);
  const sales = days.reduce((s, d) => s + d.s, 0);
  return {
    p,
    e,
    o,
    sales,
    capture: p ? e / p : 0,
    conv: e ? o / e : 0,
    aov: o ? sales / o : 0,
  };
}

function hourlyGaps(funnel) {
  const hourMap = {};
  for (const h of funnel.dayhours || []) {
    if (!hourMap[h.h]) hourMap[h.h] = { p: 0, s: 0 };
    hourMap[h.h].p += h.p;
    hourMap[h.h].s += h.s;
  }
  const days = funnel.days || [];
  const core = aggregate(days);
  const totalP = core.p || 1;
  const totalS = core.sales || 1;
  return Array.from({ length: 24 }, (_, hour) => {
    const v = hourMap[hour] || { p: 0, s: 0 };
    const passShare = v.p / totalP;
    const salesShare = v.s / totalS;
    return {
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      pass: v.p,
      sales: v.s,
      passShare: passShare * 100,
      salesShare: salesShare * 100,
      gapPp: (passShare - salesShare) * 100,
    };
  });
}

function worstHourGap(hourly) {
  return hourly.reduce((best, h) => (h.gapPp > (best?.gapPp ?? -Infinity) ? h : best), null);
}

function countAlertDays(days, baseCapture) {
  const threshold = baseCapture * 0.85;
  return days.filter((d) => d.p > 50 && d.e / d.p < threshold).length;
}

function monthlyTrend(days) {
  const map = {};
  for (const d of days) {
    const m = d.d.slice(0, 7);
    if (!map[m]) map[m] = { month: m, p: 0, e: 0, s: 0, o: 0, days: 0 };
    map[m].p += d.p;
    map[m].e += d.e;
    map[m].s += d.s;
    map[m].o += d.o;
    map[m].days += 1;
  }
  return Object.values(map)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({
      month: m.month,
      sales: Math.round(m.s),
      salesWan: +(m.s / 10000).toFixed(2),
      pass: m.p,
      capture: m.p ? m.e / m.p : 0,
      aov: m.o ? m.s / m.o : 0,
    }));
}

export function getStoreDashboard(storeId) {
  const funnel = loadFunnel(storeId);
  const days = funnel.days || [];
  const core = aggregate(days);
  const base = funnel.base;
  const alertDays = countAlertDays(days, base.capture);
  const hourly = hourlyGaps(funnel);
  const worstHour = worstHourGap(hourly);
  const months = monthlyTrend(days);

  const insights = [
    `营业额 = 过店 × 进店率 × 成交率 × 客单价，全期约 ¥${(core.sales / 10000).toFixed(0)}万（${funnel.lo} ~ ${funnel.hi}）。`,
    `全期进店率 ${(core.capture * 100).toFixed(2)}%，检出 ${alertDays} 天进店率异常（低于基准15%）。`,
    worstHour && worstHour.gapPp > 0
      ? `最大浪费小时：${worstHour.label}（剪刀差 +${worstHour.gapPp.toFixed(1)}pp）。`
      : "各小时流量与销售分布较均衡。",
    `四因子基准：进店率 ${(base.capture * 100).toFixed(2)}% · 成交率 ${(base.conv * 100).toFixed(1)}% · 客单价 ¥${base.aov.toFixed(1)}。`,
    storeId === "dadao-yintan"
      ? "标杆门店已接入完整决策看板（人群×品类、购物篮、洞察实验室等 20+ 报告）。"
      : "模拟门店数据基于标杆店缩放生成，完整报告库请切换至长沙望城银杉路零食店查看。",
  ];

  const actions = [
    ["捕获率异常天", `查 ${alertDays} 天异常清单，优先排查门头/竞品/天气`, "门店"],
    [
      worstHour && worstHour.gapPp > 0 ? worstHour.label : "高峰时段",
      "门口主推高关联品类 + 快速收银",
      "门店+选品",
    ],
    ["排班", "按分时段客流预测安排人力", "店长"],
    ["爆品补货", "对照网络热词 × 店内 SKU，缺货及时补", "供应链"],
    ["钱漏诊断", "用系统漏斗诊断锁定四因子风险并下发执行", "运营"],
  ];

  return {
    storeId,
    meta: funnel.meta,
    range: { lo: funnel.lo, hi: funnel.hi },
    kpis: {
      salesWan: +(core.sales / 10000).toFixed(1),
      pass: core.p,
      capturePct: +(core.capture * 100).toFixed(2),
      convPct: +(core.conv * 100).toFixed(1),
      aov: +core.aov.toFixed(1),
      alertDays,
      revPerPass: +base.rev_per_pass.toFixed(2),
    },
    insights,
    actions,
    monthly: months,
    hourlyGaps: hourly,
    hasFullReports: false,
    // 完整报告库（旧系统 /fenqun/example1 静态报告页）不在本项目部署中，置空
    reportBase: null,
    tradeArea: getTradeArea(storeId),
  };
}
