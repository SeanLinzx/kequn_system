import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORES_ROOT = join(__dirname, "..", "..", "data", "stores");

const FACTOR_LABELS = {
  pass: "过店人次",
  capture: "进店率",
  conv: "成交率",
  aov: "客单价",
};

export function loadFunnel(storeId) {
  const p = join(STORES_ROOT, storeId, "funnel.json");
  if (!existsSync(p)) throw new Error("门店数据不存在");
  return JSON.parse(readFileSync(p, "utf8"));
}

function filterDays(days, start, end) {
  return days.filter((d) => d.d >= start && d.d <= end);
}

function aggregate(days) {
  const p = days.reduce((s, d) => s + d.p, 0);
  const e = days.reduce((s, d) => s + d.e, 0);
  const o = days.reduce((s, d) => s + d.o, 0);
  const sales = days.reduce((s, d) => s + d.s, 0);
  const capture = p ? e / p : 0;
  const conv = e ? o / e : 0;
  const aov = o ? sales / o : 0;
  return { p, e, o, sales, capture, conv, aov, rev_per_pass: p ? sales / p : 0 };
}

function evaluateFactor(pct) {
  // 四因子均为「越高越好」：正偏差=优于基准，负偏差=风险
  if (pct >= 10) return { level: "positive", levelLabel: "优于基准" };
  if (pct >= 0) return { level: "normal", levelLabel: "正常" };
  if (pct > -5) return { level: "normal", levelLabel: "正常" };
  if (pct > -10) return { level: "attention", levelLabel: "需关注" };
  return { level: "significant", levelLabel: "显著风险" };
}

function riskLabel(level) {
  if (level === "significant") return "显著风险";
  if (level === "attention") return "需关注";
  if (level === "positive") return "优于基准";
  return "正常";
}

export function diagnose(storeId, start, end) {
  const funnel = loadFunnel(storeId);
  const allDays = funnel.days;
  const periodDays = filterDays(allDays, start, end);
  if (!periodDays.length) {
    throw new Error("所选时间段无数据");
  }

  const base = funnel.base;
  const cur = aggregate(periodDays);
  const baseAgg = aggregate(allDays);

  const factors = [
    {
      key: "pass",
      name: FACTOR_LABELS.pass,
      current: cur.p,
      baseline: baseAgg.p / allDays.length * periodDays.length,
      unit: "人",
      pct: ((cur.p / (baseAgg.p / allDays.length * periodDays.length || 1)) - 1) * 100,
    },
    {
      key: "capture",
      name: FACTOR_LABELS.capture,
      current: cur.capture,
      baseline: base.capture,
      unit: "%",
      pct: ((cur.capture / base.capture - 1) * 100) || 0,
      display: (cur.capture * 100).toFixed(2) + "%",
      baseDisplay: (base.capture * 100).toFixed(2) + "%",
    },
    {
      key: "conv",
      name: FACTOR_LABELS.conv,
      current: cur.conv,
      baseline: base.conv,
      unit: "%",
      pct: ((cur.conv / base.conv - 1) * 100) || 0,
      display: (cur.conv * 100).toFixed(1) + "%",
      baseDisplay: (base.conv * 100).toFixed(1) + "%",
    },
    {
      key: "aov",
      name: FACTOR_LABELS.aov,
      current: cur.aov,
      baseline: base.aov,
      unit: "元",
      pct: ((cur.aov / base.aov - 1) * 100) || 0,
      display: "¥" + cur.aov.toFixed(2),
      baseDisplay: "¥" + base.aov.toFixed(2),
    },
  ];

  for (const f of factors) {
    const ev = evaluateFactor(f.pct);
    f.level = ev.level;
    f.levelLabel = ev.levelLabel;
  }

  factors.sort((a, b) => {
    if (a.pct < 0 && b.pct >= 0) return -1;
    if (a.pct >= 0 && b.pct < 0) return 1;
    return Math.abs(b.pct) - Math.abs(a.pct);
  });

  const formula = {
    pass: cur.p,
    capture: cur.capture,
    conv: cur.conv,
    aov: cur.aov,
    revenue: cur.sales,
    expected: cur.p * cur.capture * cur.conv * cur.aov,
  };

  // hourly gaps for period
  const dayhours = (funnel.dayhours || []).filter(
    (h) => h.d >= start && h.d <= end,
  );
  const hourMap = {};
  for (const h of dayhours) {
    if (!hourMap[h.h]) hourMap[h.h] = { p: 0, e: 0, o: 0, s: 0 };
    hourMap[h.h].p += h.p;
    hourMap[h.h].e += h.e;
    hourMap[h.h].o += h.o;
    hourMap[h.h].s += h.s;
  }
  const totalP = cur.p || 1;
  const totalS = cur.sales || 1;
  const hourlyGaps = Array.from({ length: 24 }, (_, hour) => {
    const v = hourMap[hour] || { p: 0, e: 0, o: 0, s: 0 };
    const passShare = v.p / totalP;
    const salesShare = v.s / totalS;
    const gap = (passShare - salesShare) * 100;
    const cap = v.p ? v.e / v.p : 0;
    return {
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      pass: v.p,
      enter: v.e,
      orders: v.o,
      sales: v.s,
      passShare: passShare * 100,
      salesShare: salesShare * 100,
      gapPp: gap,
      capture: cap,
    };
  });

  const riskFactors = factors.filter((f) => f.pct < 0 && (f.level === "significant" || f.level === "attention"));
  const positiveFactors = factors.filter((f) => f.pct >= 10);
  const summary =
    riskFactors.length > 0
      ? `在 ${start} 至 ${end} 期间，${riskFactors.map((f) => `${f.name}低于基准${f.pct.toFixed(1)}%`).join("、")}，需优先关注。`
      : positiveFactors.length > 0
        ? `在 ${start} 至 ${end} 期间，整体优于基准，${positiveFactors.map((f) => `${f.name}+${f.pct.toFixed(1)}%`).join("、")}表现突出。`
        : `在 ${start} 至 ${end} 期间，四因子整体平稳，无明显风险。`;

  return {
    storeId,
    meta: funnel.meta,
    period: { start, end, days: periodDays.length },
    formula,
    factors,
    significantRisks: riskFactors.filter((f) => f.level === "significant").map((f) => f.key),
    summary,
    hourlyGaps,
    dataRange: { lo: funnel.lo, hi: funnel.hi },
  };
}

export function storeHealth(storeId) {
  const funnel = loadFunnel(storeId);
  const end = funnel.hi;
  const startDate = new Date(end);
  startDate.setDate(startDate.getDate() - 6);
  const start = startDate.toISOString().slice(0, 10);
  try {
    const d = diagnose(storeId, start, end);
    const worst =
      d.factors.find((f) => f.pct < 0 && f.level === "significant") ||
      d.factors.find((f) => f.pct < 0 && f.level === "attention") ||
      d.factors.find((f) => f.pct < 0);
    return {
      storeId,
      health: worst?.level === "significant" ? "red" : worst?.level === "attention" ? "yellow" : "green",
      worstFactor: worst?.name,
      summary: d.summary,
    };
  } catch {
    return { storeId, health: "gray", worstFactor: null, summary: "无数据" };
  }
}

export function loadPromoContext(storeId) {
  const p = join(STORES_ROOT, storeId, "promo-context.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}
