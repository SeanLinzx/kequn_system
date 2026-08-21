import { tables } from "../db.mjs";
import { loadFunnel } from "./funnel.mjs";

const PERIODS = ["day", "week", "month"];

function periodLabel(type) {
  if (type === "day") return "日目标";
  if (type === "week") return "周目标";
  return "月目标";
}

function lastDataDate(funnel) {
  // funnel.hi 有时滞后于 days 数组的实际最后一条记录，取两者中较早/一致的真实数据日期
  return funnel.days[funnel.days.length - 1]?.d || funnel.hi;
}

function periodRange(funnel, type) {
  const hi = lastDataDate(funnel);
  const hiDate = new Date(hi);
  if (type === "day") {
    return { start: hi, end: hi, label: hi };
  }
  if (type === "week") {
    const start = new Date(hiDate);
    start.setDate(start.getDate() - 6);
    const startStr = start.toISOString().slice(0, 10);
    return { start: startStr, end: hi, label: `${startStr} ~ ${hi}` };
  }
  // month: calendar month of latest data date
  const monthPrefix = hi.slice(0, 7);
  const monthDays = funnel.days.filter((d) => d.d.startsWith(monthPrefix));
  const start = monthDays[0]?.d || hi;
  return { start, end: hi, label: `${monthPrefix} 月至今` };
}

function actualRevenue(funnel, range) {
  return funnel.days
    .filter((d) => d.d >= range.start && d.d <= range.end)
    .reduce((s, d) => s + d.s, 0);
}

function getTargetRow(storeId, periodType) {
  return tables.targets.findOne((r) => r.store_id === storeId && r.period_type === periodType);
}

export function getTargets(storeId) {
  const funnel = loadFunnel(storeId);
  const out = {};
  for (const type of PERIODS) {
    const row = getTargetRow(storeId, type);
    const range = periodRange(funnel, type);
    const actual = actualRevenue(funnel, range);
    const targetValue = row?.target_value ?? null;
    const achievedPct = targetValue ? +((actual / targetValue) * 100).toFixed(1) : null;
    out[type] = {
      periodType: type,
      label: periodLabel(type),
      range,
      target: targetValue,
      actual: +actual.toFixed(1),
      achievedPct,
      status: achievedPct == null ? "no-target" : achievedPct >= 100 ? "achieved" : achievedPct >= 80 ? "on-track" : "behind",
    };
  }
  return out;
}

export function setTarget(storeId, periodType, value, userId) {
  if (!PERIODS.includes(periodType)) throw new Error("非法的目标周期类型");
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error("目标值需为非负数字");
  const existing = getTargetRow(storeId, periodType);
  if (existing) {
    tables.targets.update(existing.id, { target_value: numeric, updated_by: userId });
  } else {
    tables.targets.insert({ store_id: storeId, period_type: periodType, target_value: numeric, updated_by: userId });
  }
  return getTargets(storeId);
}
