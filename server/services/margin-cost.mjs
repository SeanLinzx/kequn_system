import { loadFunnel } from "./funnel.mjs";

// demo 级别：毛利率/成本数据基于门店真实销售规模做确定性伪随机推算，
// 不接入真实财务系统；同一门店多次请求结果保持稳定。

const MARGIN_BENCHMARK_PCT = 30; // 零食连锁行业参考毛利率
const COST_RATIO_BENCHMARK_PCT = 64; // 参考成本占营收比

const CATEGORY_POOL = [
  { name: "网红零食/膨化辣条", baseShare: 0.28, baseMargin: 26 },
  { name: "饮料饮品", baseShare: 0.22, baseMargin: 32 },
  { name: "卤味鲜食", baseShare: 0.18, baseMargin: 38 },
  { name: "酒饮烟草", baseShare: 0.12, baseMargin: 14 },
  { name: "日用百货", baseShare: 0.1, baseMargin: 24 },
  { name: "其他/散装称重", baseShare: 0.1, baseMargin: 34 },
];

const COST_POOL = [
  { name: "房租", baseShare: 0.24 },
  { name: "人力成本", baseShare: 0.22 },
  { name: "水电杂费", baseShare: 0.06 },
  { name: "损耗", baseShare: 0.05 },
  { name: "其他运营成本", baseShare: 0.07 },
];

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h || 1;
}

function makeRng(seed) {
  let state = hashSeed(String(seed));
  return function rng() {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

function evaluate(pctDeviation) {
  if (pctDeviation >= 8) return { level: "positive", levelLabel: "优于基准" };
  if (pctDeviation >= 0) return { level: "normal", levelLabel: "正常" };
  if (pctDeviation > -6) return { level: "normal", levelLabel: "正常" };
  if (pctDeviation > -14) return { level: "attention", levelLabel: "需关注" };
  return { level: "significant", levelLabel: "显著风险" };
}

function monthlyTrend(days) {
  const map = {};
  for (const d of days) {
    const m = d.d.slice(0, 7);
    if (!map[m]) map[m] = { month: m, sales: 0 };
    map[m].sales += d.s;
  }
  return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
}

function filterDays(days, start, end) {
  if (!start || !end) return days;
  return days.filter((d) => d.d >= start && d.d <= end);
}

export function getMarginCost(storeId, start, end) {
  const funnel = loadFunnel(storeId);
  const rng = makeRng(storeId);
  const periodDays = filterDays(funnel.days, start, end);
  const periodSales = periodDays.reduce((s, d) => s + d.s, 0) || 1;
  const months = monthlyTrend(funnel.days);

  // 门店级毛利率基准（在行业基准上做 ±4pp 的门店差异化，保持稳定）
  const storeMarginOffset = (rng() - 0.5) * 8;
  const categories = CATEGORY_POOL.map((c) => {
    const shareJitter = (rng() - 0.5) * 0.04;
    const marginJitter = (rng() - 0.5) * 4;
    return {
      name: c.name,
      sharePct: +Math.max(2, (c.baseShare + shareJitter) * 100).toFixed(1),
      marginPct: +Math.max(5, c.baseMargin + marginJitter + storeMarginOffset * 0.5).toFixed(1),
    };
  });
  const shareSum = categories.reduce((s, c) => s + c.sharePct, 0) || 100;
  categories.forEach((c) => {
    c.sharePct = +((c.sharePct / shareSum) * 100).toFixed(1);
  });
  const blendedMargin = categories.reduce((s, c) => s + (c.sharePct / 100) * c.marginPct, 0);
  const currentMarginPct = +(blendedMargin + Math.sin(periodSales) * 0.01).toFixed(1);
  const marginPct = ((currentMarginPct - MARGIN_BENCHMARK_PCT) / MARGIN_BENCHMARK_PCT) * 100;
  const marginEval = evaluate(marginPct);

  const marginTrend = months.map((m, i) => {
    const wobble = Math.sin(i * 1.7 + hashSeed(storeId + m.month) % 10) * 2.2;
    return { month: m.month, marginPct: +(currentMarginPct + wobble).toFixed(1) };
  });

  // 成本结构
  const storeCostOffset = (rng() - 0.5) * 6;
  const costs = COST_POOL.map((c) => {
    const jitter = (rng() - 0.5) * 0.02;
    const pct = Math.max(2, (c.baseShare + jitter) * 100 + storeCostOffset * 0.3);
    return { name: c.name, pct: +pct.toFixed(1), amountWan: +((pct / 100) * (periodSales / 10000)).toFixed(1) };
  });
  const currentCostRatioPct = +costs.reduce((s, c) => s + c.pct, 0).toFixed(1);
  const costPctDeviation = ((COST_RATIO_BENCHMARK_PCT - currentCostRatioPct) / COST_RATIO_BENCHMARK_PCT) * 100; // 成本越低越好
  const costEval = evaluate(costPctDeviation);

  const costTrend = months.map((m, i) => {
    const wobble = Math.cos(i * 1.3 + hashSeed(storeId + m.month + "cost") % 10) * 2.5;
    return { month: m.month, costRatioPct: +(currentCostRatioPct + wobble).toFixed(1) };
  });

  const netMarginEstimatePct = +(currentMarginPct - (currentCostRatioPct - 100 + currentMarginPct)).toFixed(1);
  // 简化净利估算：毛利率 - (成本占营收比 - (100-毛利率对应的成本))，避免过度复杂，使用保守估算
  const simpleNetMarginPct = +(currentMarginPct - (100 - currentCostRatioPct >= 0 ? 100 - currentCostRatioPct : 0)).toFixed(1);

  const riskNotes = [];
  if (marginEval.level === "significant" || marginEval.level === "attention") {
    riskNotes.push(`综合毛利率 ${currentMarginPct}% 低于行业参考 ${MARGIN_BENCHMARK_PCT}%，建议优化商品结构、提升高毛利品类占比`);
  }
  if (costEval.level === "significant" || costEval.level === "attention") {
    riskNotes.push(`成本占营收比 ${currentCostRatioPct}% 高于参考 ${COST_RATIO_BENCHMARK_PCT}%，建议关注房租/人力/损耗结构`);
  }
  if (!riskNotes.length) riskNotes.push("毛利率与成本结构整体健康，维持当前经营策略");

  return {
    storeId,
    period: { start: start || funnel.lo, end: end || funnel.hi },
    grossMargin: {
      currentPct: currentMarginPct,
      benchmarkPct: MARGIN_BENCHMARK_PCT,
      pct: +marginPct.toFixed(1),
      level: marginEval.level,
      levelLabel: marginEval.levelLabel,
      byCategory: categories,
      trend: marginTrend,
    },
    cost: {
      currentRatioPct: currentCostRatioPct,
      benchmarkRatioPct: COST_RATIO_BENCHMARK_PCT,
      pct: +costPctDeviation.toFixed(1),
      level: costEval.level,
      levelLabel: costEval.levelLabel,
      breakdown: costs,
      trend: costTrend,
    },
    netMarginEstimatePct: simpleNetMarginPct,
    riskNotes,
  };
}

export function compareStoresMarginCost(storeIds) {
  return storeIds.map((id) => {
    try {
      return { storeId: id, ...getMarginCost(id) };
    } catch {
      return null;
    }
  }).filter(Boolean);
}
