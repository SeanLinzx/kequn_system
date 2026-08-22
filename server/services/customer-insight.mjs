// 客群分析聚合服务（MySQL 真实数据）
// 统计口径（D5/D6）：
//   总过店 = 店外设备(OUTSIDE_PASSBY) pass_count 之和
//   总进店 = 门口设备(ENTRANCE_COUNTER) enter_count 之和
//   各人群过店 = 店外设备 human_body（按 human_id+小时 去重）按标签聚合（真实）
//   无店外画像时降级：按店内画像(INSIDE_BODY)占比分摊到总过店（source=estimated）
//   各人群进店 = 门口设备 human_body 按标签聚合（真实；无则 enters=0）
import { pool } from "../db-mysql.mjs";

const PERSONAS = ["家庭主妇", "退休老人", "中青年", "上班族", "学生"];
const FLOW_POSITIONS = ["OUTSIDE_PASSBY", "ENTRANCE_COUNTER"];

/** 日期归一化：Date/字符串 → "YYYY-MM-DD" */
function fmtDate(v) {
  if (!v) return "";
  if (v instanceof Date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  return String(v).slice(0, 10);
}

async function deviceGroups(storeId) {
  const [rows] = await pool.query(
    "SELECT device_index_code, position_type FROM camera_device WHERE store_id = ?",
    [storeId],
  );
  const g = { OUTSIDE_PASSBY: [], ENTRANCE_COUNTER: [], INSIDE_BODY: [] };
  for (const r of rows) {
    if (g[r.position_type]) g[r.position_type].push(r.device_index_code);
  }
  return g;
}

/** 分时客流：{d, h, passers, enters}，过店取店外 pass、进店取门口 enter */
async function flowByHour(storeId, start, end) {
  const [rows] = await pool.query(
    `SELECT DATE(f.stat_time) AS d, HOUR(f.stat_time) AS h,
            SUM(CASE WHEN dev.position_type = 'OUTSIDE_PASSBY' THEN f.pass_count ELSE 0 END) AS passers,
            SUM(CASE WHEN dev.position_type = 'ENTRANCE_COUNTER' THEN f.enter_count ELSE 0 END) AS enters
     FROM camera_people_flow f
     JOIN camera_device dev ON dev.device_index_code = f.device_index_code
     WHERE f.store_id = ? AND f.stat_time >= ? AND f.stat_time <= ?
       AND dev.position_type IN ('OUTSIDE_PASSBY', 'ENTRANCE_COUNTER')
     GROUP BY DATE(f.stat_time), HOUR(f.stat_time)`,
    [storeId, `${start} 00:00:00`, `${end} 23:59:59.999`],
  );
  return rows.map((r) => ({ ...r, d: fmtDate(r.d) }));
}

/**
 * 人群画像分时统计：{h, persona, count}，按 (device, human_id, tag, date, hour) 去重。
 * @param {string[]} devices 设备组
 */
async function personaByHour(storeId, devices, start, end) {
  if (!devices.length) return [];
  const [rows] = await pool.query(
    `SELECT x.h AS h, t.name AS persona, COUNT(*) AS c
     FROM (
       SELECT device_index_code, human_id, human_tag_id,
              DATE(event_time) AS d, HOUR(event_time) AS h
       FROM camera_human_body
       WHERE store_id = ? AND event_time >= ? AND event_time <= ?
       GROUP BY device_index_code, human_id, human_tag_id, DATE(event_time), HOUR(event_time)
     ) x
     JOIN human_tag t ON t.id = x.human_tag_id
     WHERE x.device_index_code IN (${devices.map(() => "?").join(",")})
     GROUP BY x.h, t.name`,
    [storeId, `${start} 00:00:00`, `${end} 23:59:59.999`, ...devices],
  );
  return rows;
}

function emptyPersonaAgg() {
  const agg = {};
  for (const p of PERSONAS) agg[p] = { passers: 0, enters: 0, byHour: Array(24).fill(0) };
  return agg;
}

function buildHourly(flowRows) {
  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, passers: 0, enters: 0 }));
  for (const r of flowRows) {
    hourly[r.h].passers += Number(r.passers || 0);
    hourly[r.h].enters += Number(r.enters || 0);
  }
  return hourly;
}

function buildDaily(flowRows) {
  const map = new Map();
  for (const r of flowRows) {
    if (!map.has(r.d)) map.set(r.d, { d: r.d, passers: 0, enters: 0 });
    const day = map.get(r.d);
    day.passers += Number(r.passers || 0);
    day.enters += Number(r.enters || 0);
  }
  return [...map.values()].sort((a, b) => a.d.localeCompare(b.d));
}

/**
 * 统一聚合：客流 + 人群 + source 判定
 */
export async function aggregateCustomer(storeId, start, end) {
  const groups = await deviceGroups(storeId);
  const flowRows = await flowByHour(storeId, start, end);
  const [outsidePersona, entrancePersona, insidePersona] = await Promise.all([
    personaByHour(storeId, groups.OUTSIDE_PASSBY, start, end),
    personaByHour(storeId, groups.ENTRANCE_COUNTER, start, end),
    personaByHour(storeId, groups.INSIDE_BODY, start, end),
  ]);

  const hourly = buildHourly(flowRows);
  const daily = buildDaily(flowRows);
  const totalPassers = hourly.reduce((s, h) => s + h.passers, 0);
  const totalEnters = hourly.reduce((s, h) => s + h.enters, 0);
  const nDays = Math.max(1, daily.length || new Set(flowRows.map((r) => r.d)).size);

  // source 判定（D5）
  const outsideHasBody = outsidePersona.length > 0;
  const insideHasBody = insidePersona.length > 0;
  let personaSource;
  let personaNote;
  if (outsideHasBody) {
    personaSource = "real";
    personaNote = "各人群过店来自店外摄像头人体画像（真实）";
  } else if (insideHasBody) {
    personaSource = "estimated";
    personaNote = "店外摄像头无人像能力，按店内画像占比推算各人群过店";
  } else {
    personaSource = "none";
    personaNote = "暂无画像数据";
  }

  // 各人群聚合
  const agg = emptyPersonaAgg();
  const fromRows = (rows, key) => {
    for (const r of rows) {
      const a = agg[r.persona];
      if (!a) continue;
      a[key] += Number(r.c || 0);
      a.byHour[r.h] += Number(r.c || 0);
    }
  };
  fromRows(outsidePersona, "passers");
  fromRows(entrancePersona, "enters");

  // 降级：店内画像占比 × 总过店（按小时分摊）
  if (personaSource === "estimated") {
    const insideByHour = Array.from({ length: 24 }, () => {
      const m = {}; for (const p of PERSONAS) m[p] = 0; return m;
    });
    for (const r of insidePersona) {
      if (insideByHour[r.h][r.persona] != null) insideByHour[r.h][r.persona] += Number(r.c || 0);
    }
    const est = emptyPersonaAgg();
    for (let h = 0; h < 24; h++) {
      const hourTotal = insideByHour[h];
      const sum = PERSONAS.reduce((s, p) => s + hourTotal[p], 0);
      if (sum <= 0) continue;
      const hourPassers = hourly[h].passers;
      for (const p of PERSONAS) {
        const share = hourTotal[p] / sum;
        const v = Math.round(hourPassers * share);
        est[p].passers += v;
        est[p].byHour[h] = v;
      }
    }
    for (const p of PERSONAS) {
      agg[p].passers = est[p].passers;
      agg[p].byHour = est[p].byHour;
    }
  }

  const conv = totalPassers > 0 ? totalEnters / totalPassers : 0;
  const peakHour = hourly.reduce((m, h, i) => (h.passers > hourly[m].passers ? i : m), 0);
  const topPersona = PERSONAS.reduce(
    (m, p) => (agg[p].passers > agg[m].passers ? p : m),
    PERSONAS[0],
  );

  return {
    storeId,
    start,
    end,
    nDays,
    hourly,
    daily,
    personaAgg: agg,
    totalPassers,
    totalEnters,
    conv,
    peakHour,
    topPersona,
    source: { persona: personaSource, personaNote, flow: "real" },
  };
}

/** 综合报告 */
export async function getCustomerReport(storeId, start, end) {
  return aggregateCustomer(storeId, start, end);
}

/** 客群矩阵：客流潜力 × 进店贡献 */
export async function getCustomerMatrix(storeId, start, end) {
  const st = await aggregateCustomer(storeId, start, end);
  return {
    storeId,
    start,
    end,
    persons: PERSONAS.map((p) => ({
      name: p,
      passers: st.personaAgg[p].passers,
      conv: st.personaAgg[p].passers > 0 ? st.personaAgg[p].enters / st.personaAgg[p].passers : 0,
    })),
    source: st.source,
  };
}

/** 年龄性别/人群结构（v1 与前端一致：人群结构 + 各人群过店/进店） */
export async function getCustomerAgeSex(storeId, start, end) {
  const st = await aggregateCustomer(storeId, start, end);
  return {
    storeId,
    start,
    end,
    persons: PERSONAS.map((p) => ({
      name: p,
      passers: st.personaAgg[p].passers,
      enters: st.personaAgg[p].enters,
    })),
    source: st.source,
  };
}

/** 时段高峰 */
export async function getCustomerTimePeak(storeId, start, end) {
  const st = await aggregateCustomer(storeId, start, end);
  const personaByHour = {};
  for (const p of PERSONAS) personaByHour[p] = st.personaAgg[p].byHour;
  return {
    storeId,
    start,
    end,
    nDays: st.nDays,
    hourly: st.hourly,
    personaByHour,
    source: st.source,
  };
}

/** 客流趋势 */
export async function getCustomerFlowTrend(storeId, start, end) {
  const st = await aggregateCustomer(storeId, start, end);
  const totalPersona = PERSONAS.reduce((s, p) => s + st.personaAgg[p].passers, 0);
  const personaShare = PERSONAS.map((p) => ({
    name: p,
    pct: totalPersona > 0 ? Math.round((st.personaAgg[p].passers / totalPersona) * 1000) / 10 : 0,
  }));
  return {
    storeId,
    start,
    end,
    daily: st.daily,
    personaShare,
    source: st.source,
  };
}

/** 数据可用范围（日期选择器用）：min/max 事件时间 */
export async function getCustomerRange(storeId) {
  const [[flow], [body]] = await Promise.all([
    pool.query(
      "SELECT MIN(stat_time) AS mn, MAX(stat_time) AS mx FROM camera_people_flow WHERE store_id = ?",
      [storeId],
    ),
    pool.query(
      "SELECT MIN(event_time) AS mn, MAX(event_time) AS mx FROM camera_human_body WHERE store_id = ?",
      [storeId],
    ),
  ]);
  const candidates = [flow[0].mn, flow[0].mx, body[0].mn, body[0].mx].filter(Boolean).map(fmtDate).filter(Boolean);
  if (!candidates.length) return { range: null };
  const min = candidates.reduce((a, b) => (a < b ? a : b));
  const max = candidates.reduce((a, b) => (a > b ? a : b));
  return { range: { lo: min, hi: max } };
}
