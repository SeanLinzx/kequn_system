// 演示数据生成（M4）：为「演示品牌（demo）」的门店生成设备 + 30 天客流/人体数据
// 数据走真实聚合链路（camera_people_flow / camera_human_body），前端演示门店有内容可看；
// 同时生成旧版业绩诊断用的 data/stores/<code>/funnel.json（demo 品牌门店专属，test/真实品牌不生成）
// 用法：node scripts/seed-demo-data.mjs [--force]
import "../load-env.mjs";
import { pool } from "../db-mysql.mjs";
import { computeHumanTag } from "../services/tagging.mjs";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORES_DATA_DIR = join(__dirname, "..", "..", "data", "stores");

const DAYS = 30;
const FORCE = process.argv.includes("--force");

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

const HOUR_PATTERN = [
  0.02, 0.01, 0.01, 0.01, 0.01, 0.02, 0.05, 0.1, 0.14, 0.1,
  0.08, 0.11, 0.13, 0.09, 0.07, 0.08, 0.11, 0.16, 0.22, 0.18,
  0.12, 0.09, 0.06, 0.03,
];

// 年龄/性别分布（加权）：prime/female、prime/male、young、middle、old、kid、teenager 等
const BODY_PROFILE = [
  ["prime", "female", 22], ["prime", "male", 20], ["young", "female", 12],
  ["young", "male", 10], ["middle", "female", 8], ["middle", "male", 7],
  ["middleAged", "female", 6], ["middleAged", "male", 5], ["old", "female", 4],
  ["old", "male", 3], ["kid", "unknown", 2], ["teenager", "unknown", 1],
];

function pickProfile(rng) {
  const total = BODY_PROFILE.reduce((s, p) => s + p[2], 0);
  let r = rng() * total;
  for (const [age, gender, w] of BODY_PROFILE) {
    r -= w;
    if (r <= 0) return { ageGroup: age, gender };
  }
  return { ageGroup: "prime", gender: "female" };
}

function pad(n) { return String(n).padStart(2, "0"); }
function dateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function timeStr(d, h) { return `${dateStr(d)} ${pad(h)}:00:00`; }

async function main() {
  if (FORCE) {
    const [demoDevices] = await pool.query(
      "SELECT device_index_code FROM camera_device WHERE device_index_code LIKE 'demo-%'",
    );
    if (demoDevices.length) {
      const codes = demoDevices.map((r) => r.device_index_code);
      await pool.query(`DELETE FROM camera_people_flow WHERE device_index_code IN (${codes.map(() => "?").join(",")})`, codes);
      await pool.query(`DELETE FROM camera_human_body WHERE device_index_code IN (${codes.map(() => "?").join(",")})`, codes);
      await pool.query(`DELETE FROM camera_device WHERE device_index_code LIKE 'demo-%'`);
      console.log(`force: cleaned ${codes.length} demo devices and their data`);
    }
  }

  const [existing] = await pool.query("SELECT COUNT(*) AS c FROM camera_device WHERE device_index_code LIKE 'demo-%'");
  if (existing[0].c > 0) {
    console.log("demo data already exists, skip (use --force to regenerate)");
    // 数据已存在时也补生成业绩诊断 funnel.json（幂等）
    const [stores] = await pool.query(
      `SELECT s.id, s.code, s.name FROM store s
       JOIN brand b ON b.id = s.brand_id
       WHERE b.code = 'demo'`,
    );
    await writeFunnelFiles(stores);
    await pool.end();
    return;
  }

  // 只给「演示品牌（demo）」的门店生成假数据；test 及未来真实品牌保持干净
  const [stores] = await pool.query(
    `SELECT s.id, s.code, s.name FROM store s
     JOIN brand b ON b.id = s.brand_id
     WHERE b.code = 'demo'`,
  );
  console.log(`generating demo data for ${stores.length} stores (brand=demo), ${DAYS} days`);

  const now = new Date();
  const flowInsert = [];
  const bodyInsert = [];
  const deviceUpdates = [];

  for (const store of stores) {
    const rng = makeRng(store.code + ":demo");
    const base = 600 + Math.round(rng() * 2000); // 日均过店基数
    const capture = 0.08 + rng() * 0.1; // 进店率 8%-18%
    const outside = `demo-${store.code}-outside`;
    const entrance = `demo-${store.code}-entrance`;
    const inside = `demo-${store.code}-inside`;

    // 设备（幂等创建）
    await pool.query(
      `INSERT IGNORE INTO camera_device (device_index_code, camera_index_code, mac_address, store_id, device_name, ip_address, position_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [outside, `cam-${store.code}-out`, `02:${hex2(rng)}:${hex2(rng)}:${hex2(rng)}:${hex2(rng)}:${hex2(rng)}`, store.id, `${store.name}·店外过店`, "10.0.0.1", "OUTSIDE_PASSBY"],
    );
    await pool.query(
      `INSERT IGNORE INTO camera_device (device_index_code, camera_index_code, mac_address, store_id, device_name, ip_address, position_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [entrance, `cam-${store.code}-in`, `02:${hex2(rng)}:${hex2(rng)}:${hex2(rng)}:${hex2(rng)}:${hex2(rng)}`, store.id, `${store.name}·门口计数`, "10.0.0.2", "ENTRANCE_COUNTER"],
    );
    await pool.query(
      `INSERT IGNORE INTO camera_device (device_index_code, camera_index_code, mac_address, store_id, device_name, ip_address, position_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [inside, `cam-${store.code}-in2`, `02:${hex2(rng)}:${hex2(rng)}:${hex2(rng)}:${hex2(rng)}:${hex2(rng)}`, store.id, `${store.name}·店内人体`, "10.0.0.3", "INSIDE_BODY"],
    );

    let lastReport = "";

    for (let day = DAYS - 1; day >= 0; day--) {
      const d = new Date(now);
      d.setDate(d.getDate() - day);
      const weekday = d.getDay();
      const isWeekend = weekday === 0 || weekday === 6;
      const dayFactor = isWeekend ? 1.15 : weekday >= 5 ? 1.05 : 0.95;

      for (let h = 0; h < 24; h++) {
        const passers = Math.round(base * dayFactor * HOUR_PATTERN[h] * (0.85 + rng() * 0.3));
        if (passers <= 0) continue;
        const enters = Math.max(0, Math.round(passers * capture * (0.8 + rng() * 0.4)));
        const exits = Math.round(enters * 0.95);
        const ts = timeStr(d, h);

        flowInsert.push([outside, store.id, `cam-${store.code}-out`, ts, 0, 0, passers, 0, "realTime"]);
        flowInsert.push([entrance, store.id, `cam-${store.code}-in`, ts, enters, exits, 0, 0, "realTime"]);
        lastReport = ts;

        // 人体画像：店外(过店人群)、门口(进店人群)、店内(店内画像)
        const humansOutside = Math.max(0, Math.round(passers / 30 + rng() * 4));
        const humansEntrance = Math.max(0, Math.round(enters / 10 + rng() * 2));
        const humansInside = Math.max(0, Math.round(enters / 6 + rng() * 2));
        let humanSeq = 0;
        const humanBase = `${store.code}-${dateStr(d)}-${h}-`;
        for (const [dev, n] of [[outside, humansOutside], [entrance, humansEntrance], [inside, humansInside]]) {
          for (let i = 0; i < n; i++) {
            const { ageGroup, gender } = pickProfile(rng);
            const humanId = `${humanBase}${dev.slice(-3)}-${humanSeq++}`;
            const tag = computeHumanTag({ ageGroup, gender, eventTime: ts, humanId });
            const minute = Math.floor(rng() * 60);
            const evt = `${dateStr(d)} ${pad(h)}:${pad(minute)}:00`;
            bodyInsert.push([
              dev, store.id, `cam-${store.code}-out`, humanId, evt, ageGroup, gender,
              Math.floor(rng() * 60), Math.floor(40 + rng() * 55),
              rng() > 0.7 ? "yes" : "no", rng() > 0.85 ? "yes" : "no", "no",
              ["black", "blue", "white", "red", "gray"][Math.floor(rng() * 5)],
              ["shortSleeve", "longSleeve", "jacket"][Math.floor(rng() * 3)],
              ["blue", "black", "gray", "white"][Math.floor(rng() * 4)],
              ["trousers", "shorts", "skirt"][Math.floor(rng() * 3)],
              tag.tagId, tag.ruleVersion,
            ]);
          }
        }
      }
    }

    deviceUpdates.push([lastReport, lastReport, outside]);
    deviceUpdates.push([lastReport, lastReport, entrance]);
    deviceUpdates.push([lastReport, lastReport, inside]);
  }

  // 批量插入（每批 1000 行）
  const FLOW_COLS = "(device_index_code, store_id, camera_index_code, stat_time, enter_count, exit_count, pass_count, duplicate_people, statistical_methods)";
  const BODY_COLS = "(device_index_code, store_id, camera_index_code, human_id, event_time, age_group, gender, stay_time, similarity, mask, hat, things, jacket_color, jacket_type, pants_color, pants_type, human_tag_id, tag_rule_version)";
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (let i = 0; i < flowInsert.length; i += 1000) {
      const batch = flowInsert.slice(i, i + 1000);
      await conn.query(`INSERT INTO camera_people_flow ${FLOW_COLS} VALUES ${batch.map(() => "(?,?,?,?,?,?,?,?,?)").join(",")}`, batch.flat());
    }
    for (let i = 0; i < bodyInsert.length; i += 1000) {
      const batch = bodyInsert.slice(i, i + 1000);
      await conn.query(`INSERT INTO camera_human_body ${BODY_COLS} VALUES ${batch.map(() => "(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").join(",")}`, batch.flat());
    }
    for (const [reportAt, bodyAt, code] of deviceUpdates) {
      await conn.query(
        "UPDATE camera_device SET last_report_at = ?, last_body_event_at = ? WHERE device_index_code = ?",
        [reportAt, bodyAt, code],
      );
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  // 旧版业绩诊断 JSON 漏斗文件（demo 品牌门店专属；test/真实品牌不生成）
  await writeFunnelFiles(stores);

  console.log(`done: flow=${flowInsert.length} rows, human_body=${bodyInsert.length} rows`);
  await pool.end();
}

/** 从 MySQL 客流数据聚合生成业绩诊断用的 data/stores/<code>/funnel.json（幂等） */
async function writeFunnelFiles(stores) {
  for (const store of stores) {
    const [rows] = await pool.query(
      `SELECT DATE(f.stat_time) AS d, DAYOFWEEK(MIN(f.stat_time)) AS wd, SUM(f.pass_count) AS p, SUM(f.enter_count) AS e
       FROM camera_people_flow f
       JOIN camera_device dev ON dev.device_index_code = f.device_index_code
       WHERE f.store_id = ? AND dev.position_type = 'OUTSIDE_PASSBY'
       GROUP BY DATE(f.stat_time)`,
      [store.id],
    );
    if (!rows.length) continue;
    const days = rows
      .sort((a, b) => (a.d > b.d ? 1 : -1))
      .map((r) => {
        const e = Number(r.e || 0);
        const o = Math.round(e * 0.62);
        return {
          d: r.d instanceof Date ? r.d.toISOString().slice(0, 10) : String(r.d).slice(0, 10),
          wd: (Number(r.wd) + 6) % 7, // MySQL DAYOFWEEK(1=周日) → JS(0=周日)
          we: Number(r.wd) === 1 || Number(r.wd) === 7 ? 1 : 0,
          w: "晴",
          p: Number(r.p || 0),
          e,
          o,
          s: +(o * 19).toFixed(1),
        };
      });
    const sumP = days.reduce((s, d) => s + d.p, 0);
    const sumE = days.reduce((s, d) => s + d.e, 0);
    const sumO = days.reduce((s, d) => s + d.o, 0);
    const sumS = days.reduce((s, d) => s + d.s, 0);
    const funnel = {
      meta: { id: store.code, name: store.name, isReal: false, location: "演示门店地址" },
      base: {
        capture: sumP ? sumE / sumP : 0,
        conv: sumE ? sumO / sumE : 0,
        aov: sumO ? sumS / sumO : 0,
        rev_per_pass: sumP ? sumS / sumP : 0,
      },
      days,
      daybuckets: [],
      dayhours: [],
      lo: days[0]?.d,
      hi: days[days.length - 1]?.d,
    };
    const dir = join(STORES_DATA_DIR, store.code);
    const funnelPath = join(dir, "funnel.json");
    if (FORCE || !existsSync(funnelPath)) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(funnelPath, JSON.stringify(funnel, null, 2), "utf8");
      console.log(`funnel.json 生成: ${store.code}（${days.length} 天，业绩诊断可看）`);
    } else {
      console.log(`funnel.json 已存在（跳过）: ${store.code}`);
    }
  }
}

function hex2(rng) {
  return Math.floor(rng() * 256).toString(16).padStart(2, "0");
}

main().catch((e) => {
  console.error("seed demo data failed:", e.message);
  process.exitCode = 1;
});
