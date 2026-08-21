import { tables } from "../db.mjs";
import { getStoreDashboard } from "./dashboard.mjs";
import { getMarginCost } from "./margin-cost.mjs";
import { getTargets } from "./targets.mjs";
import { storeHealth, loadFunnel } from "./funnel.mjs";
import { getStoreLocation } from "./store-locations.mjs";
import { getTradeArea } from "./trade-area.mjs";

const QUADS = {
  标杆门店: { color: "#18a058", action: "复制成功经验，作为区域标杆案例推广" },
  潜力待挖: { color: "#2b6bf3", action: "客流基础好但经营兑现不足，重点提升转化与客单价" },
  稳健经营: { color: "#e8a23a", action: "经营能力稳健，拓展客流捕获与进店率" },
  重点关注: { color: "#d93939", action: "客流与经营双弱，优先介入诊断并下发策略" },
};

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function normalizer(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return (v) => (max === min ? 0.5 : (v - min) / (max - min));
}

function scoreStores(rows) {
  if (!rows.length) return { stores: [], medP: 50, medC: 50, quadSummary: {} };

  const nPass = normalizer(rows.map((r) => r.dailyPassers));
  const nCapture = normalizer(rows.map((r) => r.capturePct));
  const nConv = normalizer(rows.map((r) => r.convPct));
  const nSales = normalizer(rows.map((r) => r.salesWan));
  const nMargin = normalizer(rows.map((r) => r.grossMarginPct));
  const nTarget = normalizer(rows.map((r) => r.monthTargetAchievedPct ?? 50));

  const scored = rows.map((r) => {
    const potential = Math.round((0.4 * nPass(r.dailyPassers) + 0.35 * nCapture(r.capturePct) + 0.25 * nConv(r.convPct)) * 100);
    const capability = Math.round((0.4 * nSales(r.salesWan) + 0.35 * nMargin(r.grossMarginPct) + 0.25 * nTarget(r.monthTargetAchievedPct ?? 50)) * 100);
    return { ...r, potential, capability };
  });

  const medP = median(scored.map((s) => s.potential));
  const medC = median(scored.map((s) => s.capability));

  const stores = scored.map((s) => {
    const quad =
      s.potential >= medP
        ? s.capability >= medC
          ? "标杆门店"
          : "潜力待挖"
        : s.capability >= medC
          ? "稳健经营"
          : "重点关注";
    return {
      ...s,
      quad,
      quadColor: QUADS[quad].color,
      quadAction: QUADS[quad].action,
    };
  });

  const quadSummary = {};
  for (const q of Object.keys(QUADS)) quadSummary[q] = stores.filter((s) => s.quad === q).length;

  return { stores, medP, medC, quadSummary };
}

export function buildStoreCompareRows(storeIds) {
  const baseRows = storeIds.map((storeId) => {
    const store = tables.stores.get(storeId);
    if (!store) return { storeId, name: storeId, error: "门店不存在" };

    try {
      const dashboard = getStoreDashboard(storeId);
      const marginCost = getMarginCost(storeId);
      const targets = getTargets(storeId);
      const health = storeHealth(storeId);
      const geo = getStoreLocation(storeId, store.location);
      const funnel = loadFunnel(storeId);
      const dayCount = Math.max(1, (funnel.days || []).length);
      const dailyPassers = Math.round(dashboard.kpis.pass / dayCount);
      const tradeArea = getTradeArea(storeId);
      const penetrationPct = tradeArea.available && tradeArea.stats?.totalPop
        ? +((tradeArea.stats.dailyPassers / tradeArea.stats.totalPop) * 100).toFixed(1)
        : null;

      return {
        storeId,
        name: store.name,
        location: store.location,
        district: geo.district,
        districtType: tradeArea.district || geo.district,
        address: geo.address,
        lat: geo.lat,
        lng: geo.lng,
        isReal: !!store.is_real,
        salesWan: dashboard.kpis.salesWan,
        dailyPassers,
        capturePct: dashboard.kpis.capturePct,
        convPct: dashboard.kpis.convPct,
        aov: dashboard.kpis.aov,
        alertDays: dashboard.kpis.alertDays,
        revPerPass: dashboard.kpis.revPerPass,
        grossMarginPct: marginCost.grossMargin.currentPct,
        costRatioPct: marginCost.cost.currentRatioPct,
        monthTargetAchievedPct: targets.month.achievedPct,
        penetrationPct,
        health: health.health,
        worstFactor: health.worstFactor,
        hasTradeAreaMap: !!tradeArea.available,
      };
    } catch (e) {
      return { storeId, name: store.name, error: e.message };
    }
  });

  const valid = baseRows.filter((r) => !r.error);
  const scored = scoreStores(valid);
  const errorRows = baseRows.filter((r) => r.error);

  return {
    stores: [...scored.stores, ...errorRows],
    medians: { potential: scored.medP, capability: scored.medC },
    quadSummary: scored.quadSummary,
    quadMeta: QUADS,
  };
}
