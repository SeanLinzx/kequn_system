import { diagnose, loadFunnel } from "./funnel.mjs";
import { getMarginCost } from "./margin-cost.mjs";
import { getTargets } from "./targets.mjs";
import { generateSolutions } from "./ai.mjs";

const FACTOR_TO_CATEGORY = {
  pass: { key: "site", label: "选址与闭店策略", tab: "solutions-hub", cat: "site", reason: "过店人次不足，建议评估选址与商圈渗透" },
  capture: { key: "capture", label: "捕获率提升策略", tab: "solutions-hub", cat: "capture", reason: "进店率偏低，建议借助热点海报与爆品选品提升吸引力" },
  conv: { key: "conversion", label: "转化率提升策略", tab: "solutions-hub", cat: "conversion", reason: "成交率偏低，建议参考人群×品类关联优化陈列与话术" },
  aov: { key: "aov", label: "客单价提升策略", tab: "solutions-hub", cat: "aov", reason: "客单价偏低，建议用购物篮组合 Lift 分析做捆绑陈列" },
};

function lastDataDate(funnel) {
  // funnel.hi 有时滞后于 days 数组的实际最后一条记录，取真实数据日期作为报告锚点
  return funnel.days[funnel.days.length - 1]?.d || funnel.hi;
}

function periodRangeFor(funnel, periodType) {
  const hi = lastDataDate(funnel);
  const hiDate = new Date(hi);
  if (periodType === "day") {
    const prevDate = new Date(hiDate);
    prevDate.setDate(prevDate.getDate() - 1);
    return {
      current: { start: hi, end: hi },
      previous: { start: prevDate.toISOString().slice(0, 10), end: prevDate.toISOString().slice(0, 10) },
    };
  }
  if (periodType === "month") {
    const monthPrefix = hi.slice(0, 7);
    const monthDays = funnel.days.filter((d) => d.d.startsWith(monthPrefix));
    const start = monthDays[0]?.d || hi;
    const prevMonthDate = new Date(start);
    prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
    const prevMonthPrefix = prevMonthDate.toISOString().slice(0, 7);
    const prevDays = funnel.days.filter((d) => d.d.startsWith(prevMonthPrefix));
    return {
      current: { start, end: hi },
      previous: { start: prevDays[0]?.d || prevMonthPrefix + "-01", end: prevDays[prevDays.length - 1]?.d || prevMonthPrefix + "-28" },
    };
  }
  // week (default)
  const start = new Date(hiDate);
  start.setDate(start.getDate() - 6);
  const prevEnd = new Date(start);
  prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd);
  prevStart.setDate(prevStart.getDate() - 6);
  return {
    current: { start: start.toISOString().slice(0, 10), end: hi },
    previous: { start: prevStart.toISOString().slice(0, 10), end: prevEnd.toISOString().slice(0, 10) },
  };
}

function sumRevenue(funnel, range) {
  return funnel.days.filter((d) => d.d >= range.start && d.d <= range.end).reduce((s, d) => s + d.s, 0);
}

function pctChange(cur, prev) {
  if (!prev) return null;
  return +(((cur - prev) / prev) * 100).toFixed(1);
}

function ruleBasedSolutions(diagnosis, marginCost) {
  const items = [];
  const weak = diagnosis.factors.filter((f) => f.pct < 0 && (f.level === "significant" || f.level === "attention"));
  for (const f of weak.slice(0, 2)) {
    const cat = FACTOR_TO_CATEGORY[f.key];
    items.push({
      title: `${f.name}改善方案`,
      owner: "门店店长",
      deadline: "本周内",
      steps: [
        `复核「${f.name}」近期数据，定位偏差最大的时段/门店动线`,
        cat ? `前往「${cat.label}」查看对应工具与执行建议` : "结合门店实际情况制定改善动作",
        "执行后拍照留存，纳入下一次复盘对比",
      ],
      verifyPoints: ["执行照片", "店长确认签字"],
    });
  }
  if (marginCost.grossMargin.level !== "positive" && marginCost.grossMargin.level !== "normal") {
    items.push({
      title: "毛利结构优化方案",
      owner: "门店店长/采购",
      deadline: "本月内",
      steps: ["复核低毛利品类占比，适度精简", "在客单价提升策略中用购物篮组合带动高毛利品类搭售"],
      verifyPoints: ["品类结构调整记录"],
    });
  }
  if (!items.length) {
    items.push({
      title: "维持当前经营策略",
      owner: "门店店长",
      deadline: "持续",
      steps: ["各项指标表现良好，建议维持当前排班、陈列与选品策略", "继续关注周环比变化，防止风险积累"],
      verifyPoints: ["周度复盘记录"],
    });
  }
  return items;
}

async function buildSolutions({ diagnosis, marginCost, userId, storeId }) {
  const weak = diagnosis.factors.filter((f) => f.pct < 0 && (f.level === "significant" || f.level === "attention"));
  if (!weak.length) return ruleBasedSolutions(diagnosis, marginCost);
  try {
    const aiItems = await generateSolutions({ diagnosis, riskFactor: weak[0].key, userId, storeId });
    if (Array.isArray(aiItems) && aiItems.length) return aiItems;
  } catch {
    // AI 不可用时回退规则方案，保证报告始终可生成
  }
  return ruleBasedSolutions(diagnosis, marginCost);
}

function buildStrategyLinks(diagnosis, marginCost) {
  const weak = diagnosis.factors.filter((f) => f.pct < 0 && (f.level === "significant" || f.level === "attention"));
  const links = weak.map((f) => FACTOR_TO_CATEGORY[f.key]).filter(Boolean);
  if (marginCost.grossMargin.level === "significant" || marginCost.grossMargin.level === "attention") {
    links.push({ key: "aov", label: "客单价提升策略", tab: "solutions-hub", cat: "aov", reason: "毛利率偏低，可通过购物篮高毛利组合搭售改善" });
  }
  const seen = new Set();
  return links.filter((l) => {
    if (seen.has(l.key)) return false;
    seen.add(l.key);
    return true;
  });
}

export async function buildDiagnosisReport(storeId, periodType, { userId } = {}) {
  const funnel = loadFunnel(storeId);
  const type = ["day", "week", "month"].includes(periodType) ? periodType : "week";
  const { current, previous } = periodRangeFor(funnel, type);

  const diagnosis = diagnose(storeId, current.start, current.end);
  const marginCost = getMarginCost(storeId, current.start, current.end);
  const targets = getTargets(storeId);
  const target = targets[type];

  const curRevenue = sumRevenue(funnel, current);
  const prevRevenue = sumRevenue(funnel, previous);
  const prevMarginCost = getMarginCost(storeId, previous.start, previous.end);

  const solutions = await buildSolutions({ diagnosis, marginCost, userId, storeId });
  const strategyLinks = buildStrategyLinks(diagnosis, marginCost);

  const review = {
    revenue: {
      current: +curRevenue.toFixed(1),
      previous: +prevRevenue.toFixed(1),
      changePct: pctChange(curRevenue, prevRevenue),
    },
    grossMarginPct: {
      current: marginCost.grossMargin.currentPct,
      previous: prevMarginCost.grossMargin.currentPct,
      changePct: pctChange(marginCost.grossMargin.currentPct, prevMarginCost.grossMargin.currentPct),
    },
    costRatioPct: {
      current: marginCost.cost.currentRatioPct,
      previous: prevMarginCost.cost.currentRatioPct,
      changePct: pctChange(marginCost.cost.currentRatioPct, prevMarginCost.cost.currentRatioPct),
    },
    target: target
      ? { targetValue: target.target, achievedPct: target.achievedPct, status: target.status }
      : null,
  };

  return {
    storeId,
    storeName: funnel.meta?.name,
    periodType: type,
    period: current,
    previousPeriod: previous,
    generatedAt: new Date().toISOString(),
    diagnosis: {
      summary: diagnosis.summary,
      factors: diagnosis.factors,
      grossMargin: marginCost.grossMargin,
      cost: marginCost.cost,
      riskNotes: marginCost.riskNotes,
    },
    solutions,
    strategy: strategyLinks,
    review,
  };
}
