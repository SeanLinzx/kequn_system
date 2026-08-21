/**
 * 连锁零食店转型升级 & 闭店决策评估（demo 级别）
 *
 * 面向量贩零食连锁的门店调改场景：
 * - 70% 门店 → 量贩多品类零食店（散称休闲 / 进口网红 / 低卡健康 / 潮玩联名 / 试吃体验）
 * - 30% 门店 → 社区便民零食店（家庭常备 / 高复购标品 / 学生平价区）
 * - 闭店处置：复盘亏损门店 → 商圈搬迁/合并/业态转型 → 多轮无效才关停
 */
import { tables } from "../db.mjs";
import { getMarginCost } from "./margin-cost.mjs";
import { getTargets } from "./targets.mjs";
import { storeHealth } from "./funnel.mjs";
import { getTradeArea } from "./trade-area.mjs";
import { makeRng } from "../lib/seeded-rng.mjs";

const STORE_TYPES = {
  panHealth: {
    key: "panHealth",
    label: "量贩多品类零食店",
    desc: "散称休闲 + 进口网红 + 低卡健康 + 潮玩联名，承接年轻/上班族/学生客群的冲动消费",
  },
  professional: {
    key: "professional",
    label: "社区便民零食店",
    desc: "聚焦家庭常备、高复购标品与收银台搭售，承接家庭主妇与退休客群日常补货",
  },
  hold: {
    key: "hold",
    label: "维持标准零食店，观察下一调改周期",
    desc: "客群结构均衡、转型信号不明显，建议先完成品类优化试点再评估",
  },
};

const PAN_HEALTH_CATEGORY_POOL = [
  { name: "散称休闲零食区（坚果/肉脯/膨化）", tag: "强烈推荐", marginPct: 38, aovLiftPct: 12, note: "高毛利+高连带，适合年轻客群占比高的门店" },
  { name: "进口 / 网红爆款专区", tag: "强烈推荐", marginPct: 42, aovLiftPct: 15, note: "借势热词与小红书种草，提升进店转化" },
  { name: "低卡健康零食（轻食小包装）", tag: "建议试点", marginPct: 35, aovLiftPct: 8, note: "承接上班族与健康意识客群，差异化于传统量贩" },
  { name: "节令礼盒组合（春节/中秋/露营）", tag: "建议试点", marginPct: 32, aovLiftPct: 10, note: "节庆动线陈列，带动客单价与礼品场景" },
  { name: "门口试吃 + 冰柜饮品体验区", tag: "建议试点", marginPct: 28, aovLiftPct: 18, note: "提升捕获率，把过店流量转化为进店" },
  { name: "潮玩 / IP 联名（谨慎试水）", tag: "谨慎试水", marginPct: 45, aovLiftPct: 6, note: "学生/年轻客群密集门店小范围测试" },
];

const PROFESSIONAL_CATEGORY_POOL = [
  { name: "家庭常备粮油零食组合", tag: "强烈推荐", marginPct: 22, aovLiftPct: 14, note: "家庭主妇客群复购稳定，适合社区型门店" },
  { name: "收银台高毛利小包装", tag: "强烈推荐", marginPct: 40, aovLiftPct: 9, note: "提升成交率与客单价，低决策成本" },
  { name: "学生党 9.9 平价专区", tag: "建议试点", marginPct: 25, aovLiftPct: 11, note: "学校/大学城商圈优先铺货" },
  { name: "社区团购自提点", tag: "建议试点", marginPct: 18, aovLiftPct: 7, note: "提升到店频次与周边渗透" },
];

const REGION_POOL = ["长沙（核心市场）", "长沙（拓展区域）", "华中示范区"];
const DENSITY_POOL = ["低", "中", "高"];

const STORE_PROFILE_OVERRIDES = {
  "dadao-yintan": {
    areaSqm: 145,
    region: "长沙（核心市场）",
    chronicBias: 0.58,
    consecutiveLossMonths: 1,
    renovationRounds: 0,
    nearbyCompetitorDensity: "中",
    memberRepurchasePct: 44,
  },
  "mock-xiangjiang": {
    areaSqm: 228,
    region: "长沙（核心市场）",
    chronicBias: 0.22,
    consecutiveLossMonths: 0,
    renovationRounds: 0,
    nearbyCompetitorDensity: "低",
    memberRepurchasePct: 26,
  },
  "mock-meixi": {
    areaSqm: 92,
    region: "长沙（拓展区域）",
    chronicBias: 0.72,
    consecutiveLossMonths: 6,
    renovationRounds: 2,
    nearbyCompetitorDensity: "高",
    memberRepurchasePct: 38,
  },
};

function storeProfile(storeId) {
  const override = STORE_PROFILE_OVERRIDES[storeId];
  if (override) return { ...override };
  const rng = makeRng(storeId + ":transform-profile-v1");
  const areaSqm = Math.round(90 + rng() * 170);
  const region = REGION_POOL[Math.floor(rng() * REGION_POOL.length)];
  const chronicBias = rng();
  const consecutiveLossMonths = Math.round(rng() * 8);
  const renovationRounds = Math.round(rng() * 3);
  const nearbyCompetitorDensity = DENSITY_POOL[Math.floor(rng() * DENSITY_POOL.length)];
  const memberRepurchasePct = Math.round(30 + rng() * 40);
  return { areaSqm, region, chronicBias, consecutiveLossMonths, renovationRounds, nearbyCompetitorDensity, memberRepurchasePct };
}

function personaByName(personas, name) {
  return personas.find((p) => p.name === name) || { popSharePct: 0, passSharePct: 0, convPct: 0 };
}

export function getTransformationAdvice(storeId) {
  const store = tables.stores.get(storeId);
  if (!store) throw new Error("门店不存在");

  const trade = getTradeArea(storeId);
  const marginCost = getMarginCost(storeId);
  const profile = storeProfile(storeId);
  const personas = trade.available ? trade.personas : [];

  const retiree = personaByName(personas, "退休老人");
  const family = personaByName(personas, "家庭主妇");
  const worker = personaByName(personas, "上班族");
  const young = personaByName(personas, "中青年");
  const student = personaByName(personas, "学生");

  const familySignal =
    (family.passSharePct * 0.4 + retiree.passSharePct * 0.3) * 0.5 +
    (family.convPct * 0.4 + retiree.convPct * 0.3) * 0.5;
  const trendSignal =
    ((worker.passSharePct + young.passSharePct + student.passSharePct) / 3) * 0.5 +
    ((worker.convPct + young.convPct + student.convPct) / 3) * 0.5;

  const chronicIndex = Math.round(Math.min(100, familySignal * 0.35 + profile.chronicBias * 100 * 0.65));
  const panHealthIndex = Math.round(Math.min(100, trendSignal * 0.35 + (1 - profile.chronicBias) * 100 * 0.65));

  let recommendedType;
  if (chronicIndex > panHealthIndex * 1.15) recommendedType = STORE_TYPES.professional;
  else if (panHealthIndex > chronicIndex * 1.15) recommendedType = STORE_TYPES.panHealth;
  else recommendedType = STORE_TYPES.hold;

  const storeTierLabel =
    profile.areaSqm >= 200
      ? "旗舰量贩店（叠加试吃体验区 + 冰柜饮品）"
      : profile.areaSqm >= 130
        ? "标准量贩店"
        : "小型社区店，暂不适用旗舰分级";

  const categoryPool = recommendedType.key === "professional" ? PROFESSIONAL_CATEGORY_POOL : PAN_HEALTH_CATEGORY_POOL;

  const reasoning = [];
  if (trade.available) {
    reasoning.push(
      `商圈客群：家庭主妇+退休老人合计过店占比 ${(family.passSharePct + retiree.passSharePct).toFixed(1)}%；上班族+中青年+学生合计 ${(worker.passSharePct + young.passSharePct + student.passSharePct).toFixed(1)}%`,
    );
  }
  reasoning.push(`门店经营：毛利率 ${marginCost.grossMargin.currentPct}%（行业基准 ${marginCost.grossMargin.benchmarkPct}%），成本占比 ${marginCost.cost.currentRatioPct}%`);
  reasoning.push(`门店面积约 ${profile.areaSqm}㎡，会员复购占比约 ${profile.memberRepurchasePct}%，周边同业密度：${profile.nearbyCompetitorDensity}`);

  return {
    storeId,
    name: store.name,
    region: profile.region,
    areaSqm: profile.areaSqm,
    memberRepurchasePct: profile.memberRepurchasePct,
    nearbyCompetitorDensity: profile.nearbyCompetitorDensity,
    chronicIndex,
    panHealthIndex,
    recommendedType: recommendedType.label,
    recommendedTypeKey: recommendedType.key,
    recommendedTypeDesc: recommendedType.desc,
    storeTierLabel,
    categoryPlan: categoryPool,
    reasoning,
    personaAvailable: trade.available,
  };
}

export function compareTransformation(storeIds) {
  const rows = storeIds.map((id) => {
    try {
      return getTransformationAdvice(id);
    } catch (e) {
      const store = tables.stores.get(id);
      return { storeId: id, name: store?.name || id, error: e.message };
    }
  });
  const valid = rows.filter((r) => !r.error);
  valid.forEach((r) => {
    r.priorityScore = Math.round(
      Math.abs(r.chronicIndex - r.panHealthIndex) * 0.6 + (r.areaSqm >= 150 ? 30 : 10) + (r.recommendedTypeKey !== "hold" ? 10 : 0),
    );
  });
  valid.sort((a, b) => b.priorityScore - a.priorityScore);
  return { stores: [...valid, ...rows.filter((r) => r.error)] };
}

const CLOSURE_ACTIONS = {
  close: { key: "close", label: "建议启动闭店评估", tone: "red" },
  relocate: { key: "relocate", label: "建议商圈搬迁", tone: "red" },
  merge: { key: "merge", label: "建议与周边门店合并", tone: "yellow" },
  transform: { key: "transform", label: "建议业态转型（品类调改）", tone: "yellow" },
  healthy: { key: "healthy", label: "经营健康，无需处置", tone: "green" },
};

const CLOSURE_POLICY_NOTE =
  "参考连锁零食行业通行的门店处置原则：以提质增效为核心，逐个复盘亏损门店，通过商圈搬迁、周边门店合并、品类调改、门头焕新等方式优化，仅经多轮调整仍无法扭亏的门店才关停。";

export function getClosureAssessment(storeId) {
  const store = tables.stores.get(storeId);
  if (!store) throw new Error("门店不存在");

  const health = storeHealth(storeId);
  const targets = getTargets(storeId);
  const marginCost = getMarginCost(storeId);
  const profile = storeProfile(storeId);

  let score = 0;
  const reasoning = [];

  if (health.health === "red") {
    score += 40;
    reasoning.push(`近 7 天诊断显著风险：${health.worstFactor || "综合表现"}偏弱`);
  } else if (health.health === "yellow") {
    score += 20;
    reasoning.push(`近 7 天诊断存在需关注因子：${health.worstFactor || "综合表现"}`);
  } else {
    reasoning.push("近 7 天经营诊断整体健康");
  }

  score += Math.min(30, profile.consecutiveLossMonths * 4);
  if (profile.consecutiveLossMonths > 0) {
    reasoning.push(`模拟经营台账：连续 ${profile.consecutiveLossMonths} 个月未达成月度目标`);
  }

  if (targets.month.achievedPct != null && targets.month.achievedPct < 80) {
    score += 10;
    reasoning.push(`本月目标达成率 ${targets.month.achievedPct}%，低于 80% 健康线`);
  }

  if (marginCost.grossMargin.level === "significant") {
    score += 10;
    reasoning.push(`毛利率 ${marginCost.grossMargin.currentPct}% 显著低于基准 ${marginCost.grossMargin.benchmarkPct}%`);
  }

  if (profile.renovationRounds >= 2 && score >= 50) {
    score += 15;
    reasoning.push(`已完成 ${profile.renovationRounds} 轮调改仍未扭亏，按处置原则进入关停评估序列`);
  } else if (profile.renovationRounds >= 1) {
    reasoning.push(`已尝试 ${profile.renovationRounds} 轮调改（商圈搬迁/品类优化等），效果待观察`);
  }

  score = Math.min(100, score);

  let action;
  if (score >= 70 && profile.renovationRounds >= 2) action = CLOSURE_ACTIONS.close;
  else if (score >= 70) action = CLOSURE_ACTIONS.relocate;
  else if (score >= 45 && profile.nearbyCompetitorDensity === "高") action = CLOSURE_ACTIONS.merge;
  else if (score >= 45) action = CLOSURE_ACTIONS.transform;
  else action = CLOSURE_ACTIONS.healthy;

  return {
    storeId,
    name: store.name,
    region: profile.region,
    closureRiskScore: score,
    closureRiskLevel: score >= 70 ? "red" : score >= 45 ? "yellow" : "green",
    consecutiveLossMonths: profile.consecutiveLossMonths,
    renovationRounds: profile.renovationRounds,
    monthTargetAchievedPct: targets.month.achievedPct,
    worstFactor: health.worstFactor,
    nearbyCompetitorDensity: profile.nearbyCompetitorDensity,
    suggestedAction: action.label,
    suggestedActionKey: action.key,
    suggestedActionTone: action.tone,
    reasoning,
    policyNote: CLOSURE_POLICY_NOTE,
  };
}

export function compareClosure(storeIds) {
  const rows = storeIds.map((id) => {
    try {
      return getClosureAssessment(id);
    } catch (e) {
      const store = tables.stores.get(id);
      return { storeId: id, name: store?.name || id, error: e.message };
    }
  });
  const valid = rows.filter((r) => !r.error);
  valid.sort((a, b) => b.closureRiskScore - a.closureRiskScore);
  return { stores: [...valid, ...rows.filter((r) => r.error)], policyNote: CLOSURE_POLICY_NOTE };
}
