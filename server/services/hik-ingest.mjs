// 边缘事件接入：解析 / 落库 / 去重 / 孤儿标记 / 标签计算
// 兼容旧协议（OnEventNotify），字段缺失容忍；原始报文必须全文保存
import { pool } from "../db-mysql.mjs";
import { computeHumanTag } from "./tagging.mjs";

/** 时间归一化："2024-01-16T15:02:19.000+08:00" → "2024-01-16 15:02:19.000" */
function normalizeTime(value) {
  if (value == null || value === "") return null;
  const t = String(value)
    .replace("T", " ")
    .replace(/(\.\d+)?[+-]\d{2}:\d{2}$/, "$1")
    .replace(/Z$/, "");
  return t || null;
}

function pickTime(...values) {
  for (const v of values) {
    const t = normalizeTime(v);
    if (t) return t;
  }
  return null;
}

/** deviceIndexCode 归一化：MAC 去冒号/连字符、小写 */
function compactIndexCode(value) {
  return String(value || "").trim().toLowerCase().replace(/[:\-]/g, "");
}

function nowLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function lookupDevice(conn, deviceIndexCode) {
  const [rows] = await conn.query(
    "SELECT id, store_id FROM camera_device WHERE device_index_code = ?",
    [deviceIndexCode],
  );
  return rows[0] || null;
}

/**
 * 插入原始报文（按 event_id 去重，INSERT IGNORE）。
 * @returns {boolean} true=新插入；false=已处理过（重复报文）
 */
async function insertRaw(conn, { eventId, deviceIndexCode, storeId, eventType, rawJson, happenTime, parseStatus, parseError }) {
  const [result] = await conn.query(
    `INSERT IGNORE INTO camera_raw_event
       (event_id, device_index_code, store_id, event_type, raw_json, happen_time, parse_status, parse_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      eventId ?? null,
      deviceIndexCode,
      storeId ?? null,
      eventType,
      rawJson,
      happenTime,
      parseStatus,
      parseError ?? "",
    ],
  );
  return result.affectedRows === 1;
}

/**
 * 解析可选接入令牌（X-Access-Token header）。
 * @returns {{storeId:number|null, brandId:number|null}} 无效/缺失 → null
 */
async function resolveTokenStore(token) {
  if (!token) return null;
  const [rows] = await pool.query(
    "SELECT brand_id, store_id FROM site_token WHERE token = ? AND enabled = 1",
    [token],
  );
  if (!rows[0]) return null; // 无效令牌：按无令牌处理（兼容）
  return { storeId: rows[0].store_id, brandId: rows[0].brand_id };
}

/**
 * 设备门店归属（token 优先）：
 * - 门店 token → 强制归属该店；未建档设备自动建档（position_type=UNKNOWN）
 * - 品牌 token → 设备已绑且门店属于品牌则沿用；未绑定不自动建档
 * - 无 token → 按设备现有绑定；未知设备不建档（孤儿）
 */
async function resolveAttribution(conn, deviceIndexCode, tokenInfo) {
  const device = await lookupDevice(conn, deviceIndexCode);
  if (tokenInfo?.storeId != null) {
    const storeId = tokenInfo.storeId;
    if (!device) {
      await conn.query(
        "INSERT INTO camera_device (device_index_code, store_id, position_type) VALUES (?, ?, 'UNKNOWN')",
        [deviceIndexCode, storeId],
      );
      return { device: await lookupDevice(conn, deviceIndexCode), storeId };
    }
    if (device.store_id !== storeId) {
      await conn.query("UPDATE camera_device SET store_id = ? WHERE id = ?", [storeId, device.id]);
    }
    return { device, storeId };
  }
  if (tokenInfo?.brandId != null && device?.store_id != null) {
    const [stores] = await conn.query("SELECT brand_id FROM store WHERE id = ?", [device.store_id]);
    if (stores[0] && stores[0].brand_id === tokenInfo.brandId) {
      return { device, storeId: device.store_id };
    }
    return { device, storeId: null };
  }
  return { device, storeId: device?.store_id ?? null };
}

/** 客流统计（ability=event_pdc） */
export async function ingestPeopleCounting(body, rawBody, token) {
  const events = body?.params?.events;
  if (!Array.isArray(events) || events.length === 0) return { inserted: 0 };
  const rawJson = rawBody || JSON.stringify(body);
  const conn = await pool.getConnection();
  let inserted = 0;
  try {
    await conn.beginTransaction();
    const tokenInfo = await resolveTokenStore(token);
    const attrCache = new Map();
    const getAttr = async (code) => {
      if (!attrCache.has(code)) attrCache.set(code, await resolveAttribution(conn, code, tokenInfo));
      return attrCache.get(code);
    };
    for (const ev of events) {
      const data = ev?.data || {};
      const pcs = Array.isArray(data.peopleCounting) ? data.peopleCounting : [];
      if (pcs.length === 0) continue;
      const firstDeviceIndexCode = pcs[0]?.targetAttrs?.deviceIndexCode || "";
      if (!firstDeviceIndexCode) continue;
      const happenTime = pickTime(data.dateTime, ev.happenTime) || nowLocal();
      const firstAttr = await getAttr(firstDeviceIndexCode);
      const rawInserted = await insertRaw(conn, {
        eventId: ev.eventId || null,
        deviceIndexCode: firstDeviceIndexCode,
        storeId: firstAttr.storeId,
        eventType: "people_counting",
        rawJson,
        happenTime,
        parseStatus: firstAttr.storeId != null ? "ok" : "unbound",
      });
      if (!rawInserted) continue; // 重复报文，跳过

      for (const pc of pcs) {
        const method = pc.statisticalMethods || "realTime";
        if (method !== "realTime") continue; // 只处理 realTime
        const deviceIndexCode = pc?.targetAttrs?.deviceIndexCode || firstDeviceIndexCode;
        const attr = await getAttr(deviceIndexCode);
        await conn.query(
          `INSERT INTO camera_people_flow
             (device_index_code, store_id, camera_index_code, stat_time, enter_count, exit_count, pass_count, duplicate_people, statistical_methods)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            deviceIndexCode,
            attr.storeId,
            pc?.targetAttrs?.cameraIndexCode || "",
            happenTime,
            Number(pc.enter || 0),
            Number(pc.exit || 0),
            Number(pc.pass || 0),
            Number(pc.duplicatePeople || 0),
            method,
          ],
        );
        if (attr.device) {
          await conn.query(
            "UPDATE camera_device SET last_report_at = IF(last_report_at IS NULL OR ? > last_report_at, ?, last_report_at) WHERE id = ?",
            [happenTime, happenTime, attr.device.id],
          );
        }
        inserted += 1;
      }
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return { inserted };
}

/** 人体属性/人像（ability=event_body） */
export async function ingestHumanBody(body, rawBody, token) {
  const events = body?.params?.events;
  if (!Array.isArray(events) || events.length === 0) return { inserted: 0 };
  const rawJson = rawBody || JSON.stringify(body);
  const conn = await pool.getConnection();
  let inserted = 0;
  try {
    await conn.beginTransaction();
    const tokenInfo = await resolveTokenStore(token);
    const attrCache = new Map();
    const getAttr = async (code) => {
      if (!attrCache.has(code)) attrCache.set(code, await resolveAttribution(conn, code, tokenInfo));
      return attrCache.get(code);
    };
    for (const ev of events) {
      const data = ev?.data || {};
      const comparisons = Array.isArray(data.HumanBodyComparison) ? data.HumanBodyComparison : [];
      if (comparisons.length === 0) continue;
      const firstDeviceIndexCode = resolveBodyDeviceIndex(comparisons[0], data);
      if (!firstDeviceIndexCode) continue;
      const happenTime = pickTime(data.dateTime, ev.happenTime) || nowLocal();
      const firstAttr = await getAttr(firstDeviceIndexCode);
      const rawInserted = await insertRaw(conn, {
        eventId: ev.eventId || null,
        deviceIndexCode: firstDeviceIndexCode,
        storeId: firstAttr.storeId,
        eventType: "human_body",
        rawJson,
        happenTime,
        parseStatus: firstAttr.storeId != null ? "ok" : "unbound",
      });
      if (!rawInserted) continue; // 重复报文，跳过

      for (const cmp of comparisons) {
        const info = cmp.HumanInfo || {};
        const deviceIndexCode = resolveBodyDeviceIndex(cmp, data);
        const attr = await getAttr(deviceIndexCode);
        const tag = computeHumanTag({
          ageGroup: info.ageGroup,
          gender: info.gender,
          eventTime: happenTime,
          humanId: info.humanID,
        });
        await conn.query(
          `INSERT INTO camera_human_body
             (device_index_code, store_id, camera_index_code, human_id, event_time,
              age_group, gender, stay_time, similarity, mask, hat, things,
              jacket_color, jacket_type, pants_color, pants_type,
              human_tag_id, tag_rule_version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            deviceIndexCode,
            attr.storeId,
            cmp?.targetAttrs?.cameraIndexCode || data?.targetAttrs?.cameraIndexCode || "",
            String(info.humanID ?? ""),
            happenTime,
            String(info.ageGroup || ""),
            String(info.gender || ""),
            Number(info.stayTime || 0),
            Number(info.similarity || 0),
            String(info.mask || ""),
            String(info.hat || ""),
            String(info.things || ""),
            String(info.jacketColor || ""),
            String(info.jacketType || ""),
            String(info.pantsColor || ""),
            String(info.pantsType || ""),
            tag.tagId,
            tag.ruleVersion,
          ],
        );
        if (attr.device) {
          await conn.query(
            `UPDATE camera_device SET
               last_report_at = IF(last_report_at IS NULL OR ? > last_report_at, ?, last_report_at),
               last_body_event_at = IF(last_body_event_at IS NULL OR ? > last_body_event_at, ?, last_body_event_at)
             WHERE id = ?`,
            [happenTime, happenTime, happenTime, happenTime, attr.device.id],
          );
        }
        inserted += 1;
      }
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  return { inserted };
}

/** eventRtbw 设备号解析：comparison.targetAttrs → data.targetAttrs → data.deviceID → 压缩(data.macAddress) */
function resolveBodyDeviceIndex(cmp, data) {
  const target = cmp?.targetAttrs || {};
  const dataTarget = data?.targetAttrs || {};
  return (
    target.deviceIndexCode ||
    dataTarget.deviceIndexCode ||
    data?.deviceID ||
    compactIndexCode(data?.macAddress) ||
    ""
  );
}
