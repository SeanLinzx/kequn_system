import { loadFunnel } from "./funnel.mjs";

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h || 1;
}
function makeRng(seed) {
  let s = hashSeed(String(seed));
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/** 客群矩阵：客流潜力 × 消费贡献 四象限（确定性演示） */
export function getCustomerMatrix(storeId) {
  const rng = makeRng(storeId + ":matrix");
  const segs = [
    ["家庭采购客群", "高", "高"],
    ["白领通勤客群", "高", "中"],
    ["学生潮流客群", "中", "高"],
    ["银发休闲客群", "中", "低"],
    ["散客/过路客", "低", "低"],
  ];
  return segs.map((s) => {
    const potential = 40 + Math.round(rng() * 55);
    const contribution = 40 + Math.round(rng() * 55);
    return {
      name: s[0],
      potential,
      contribution,
      share: Math.round((rng() * 100 + 5) * 10) / 10,
      quadrant: potential >= 50 && contribution >= 50 ? "明星客群"
        : potential >= 50 ? "潜力客群"
        : contribution >= 50 ? "高贡献客群" : "低价值客群",
    };
  });
}

/** 年龄性别：性别占比 + 年龄段分布（确定性演示） */
export function getAgeSex(storeId) {
  const rng = makeRng(storeId + ":agesex");
  const total = 5000 + Math.round(rng() * 8000);
  const male = Math.round(total * (0.42 + rng() * 0.16));
  const labels = ["18 岁以下", "18-25 岁", "26-35 岁", "36-45 岁", "46-55 岁", "55 岁以上"];
  const base = [8, 22, 30, 22, 12, 6];
  const ageBuckets = labels.map((label, i) => ({
    label,
    count: Math.round(base[i] * (0.8 + rng() * 0.5) * (total / 100)),
  }));
  return { gender: { male, female: total - male }, ageBuckets, total };
}

/** 时段高峰：分时过店/进店（来自真实 dayhours） */
export function getTimePeak(storeId, start, end) {
  const funnel = loadFunnel(storeId);
  const hours = (funnel.dayhours || []).filter((h) => !start || !end || (h.d >= start && h.d <= end));
  const map = {};
  for (const h of hours) {
    if (!map[h.h]) map[h.h] = { h: h.h, passby: 0, enter: 0 };
    map[h.h].passby += h.p || 0;
    map[h.h].enter += h.e || 0;
  }
  return Array.from({ length: 24 }, (_, hour) => map[hour] || { h: hour, passby: 0, enter: 0 });
}

/** 客流趋势：每日过店/进店（来自真实 days） */
export function getFlowTrend(storeId, start, end) {
  const funnel = loadFunnel(storeId);
  return (funnel.days || [])
    .filter((d) => !start || !end || (d.d >= start && d.d <= end))
    .map((d) => ({ d: d.d, passby: d.p || 0, enter: d.e || 0 }));
}
