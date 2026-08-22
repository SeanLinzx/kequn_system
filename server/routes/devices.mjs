// 设备管理（camera_device CRUD / 状态 / 未绑定设备）
import { Router } from "express";
import { pool } from "../db-mysql.mjs";
import { authMiddleware, requireRole, getUserStores } from "../auth.mjs";

const router = Router();
router.use(authMiddleware);

const POSITION_TYPES = ["OUTSIDE_PASSBY", "ENTRANCE_COUNTER", "INSIDE_BODY", "UNKNOWN"];
const POSITION_LABELS = {
  OUTSIDE_PASSBY: "店外过店",
  ENTRANCE_COUNTER: "门口进出",
  INSIDE_BODY: "店内人体",
  UNKNOWN: "未配置",
};

function deviceRow(r) {
  return {
    id: r.id,
    deviceIndexCode: r.device_index_code,
    cameraIndexCode: r.camera_index_code,
    macAddress: r.mac_address,
    storeId: r.store_id,
    storeName: r.store_name || null,
    brandId: r.brand_id,
    brandName: r.brand_name || null,
    deviceName: r.device_name,
    ipAddress: r.ip_address,
    positionType: r.position_type,
    positionTypeLabel: POSITION_LABELS[r.position_type] || r.position_type,
    bodyCapable: r.last_body_event_at != null,
    lastReportAt: r.last_report_at,
    lastBodyEventAt: r.last_body_event_at,
    status: r.status,
    createdAt: r.created_at,
  };
}

const DEVICE_SELECT = `
  SELECT d.*, s.name AS store_name, s.brand_id, b.name AS brand_name
  FROM camera_device d
  LEFT JOIN store s ON s.id = d.store_id
  LEFT JOIN brand b ON b.id = s.brand_id`;

// 设备列表（?storeId=&brandId=&positionType=&status=；非超管仅可见可访问门店的设备）
router.get("/", async (req, res) => {
  const { storeId, brandId, positionType, status } = req.query;
  const conds = [];
  const params = [];
  // 角色范围
  if (req.user.role !== "super_admin") {
    const stores = await getUserStores(req.user.id, req.user.role);
    const ids = stores.map((s) => s.id);
    if (!ids.length) return res.json({ devices: [] });
    conds.push(`d.store_id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
  if (storeId) { conds.push("d.store_id = ?"); params.push(storeId); }
  if (brandId) { conds.push("s.brand_id = ?"); params.push(brandId); }
  if (positionType) { conds.push("d.position_type = ?"); params.push(positionType); }
  if (status != null) { conds.push("d.status = ?"); params.push(status); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  try {
    const [rows] = await pool.query(`${DEVICE_SELECT} ${where} ORDER BY d.id`, params);
    res.json({ devices: rows.map(deviceRow) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 未绑定门店的设备（孤儿设备，收到过事件但未注册/未绑门店）
router.get("/unbound", async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT d.*, NULL AS store_name, NULL AS brand_id, NULL AS brand_name
       FROM camera_device d
       WHERE d.store_id IS NULL
       ORDER BY d.created_at DESC`,
    );
    res.json({ devices: rows.map(deviceRow) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 设备详情
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await pool.query(`${DEVICE_SELECT} WHERE d.id = ?`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "设备不存在" });
    res.json({ device: deviceRow(rows[0]) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 设备状态：最后上报 / 今日接收量 / 今日异常量 / body_capable
router.get("/:id/status", async (req, res) => {
  try {
    const [devices] = await pool.query("SELECT * FROM camera_device WHERE id = ?", [req.params.id]);
    if (!devices[0]) return res.status(404).json({ error: "设备不存在" });
    const device = devices[0];
    const today = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const todayStart = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())} 00:00:00`;
    const [[countRows], [errorRows]] = await Promise.all([
      pool.query(
        "SELECT COUNT(*) AS c FROM camera_raw_event WHERE device_index_code = ? AND receive_time >= ?",
        [device.device_index_code, todayStart],
      ),
      pool.query(
        "SELECT COUNT(*) AS c FROM camera_raw_event WHERE device_index_code = ? AND parse_status = 'error'",
        [device.device_index_code],
      ),
    ]);
    res.json({
      deviceId: device.id,
      deviceIndexCode: device.device_index_code,
      lastReportAt: device.last_report_at,
      lastBodyEventAt: device.last_body_event_at,
      bodyCapable: device.last_body_event_at != null,
      todayReceived: countRows[0].c,
      errorCount: errorRows[0].c,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 添加设备（Web 端注册入口）
router.post("/", requireRole("super_admin", "ops_manager"), async (req, res) => {
  const b = req.body || {};
  const deviceIndexCode = String(b.deviceIndexCode || "").trim();
  if (!deviceIndexCode) return res.status(400).json({ error: "需要 deviceIndexCode" });
  const positionType = POSITION_TYPES.includes(b.positionType) ? b.positionType : "UNKNOWN";
  if (b.positionType && !POSITION_TYPES.includes(b.positionType)) {
    return res.status(400).json({ error: `positionType 必须是 ${POSITION_TYPES.join("/")}` });
  }
  try {
    const [result] = await pool.query(
      `INSERT INTO camera_device
         (device_index_code, camera_index_code, mac_address, store_id, device_name, ip_address, position_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        deviceIndexCode,
        String(b.cameraIndexCode || ""),
        String(b.macAddress || ""),
        b.storeId != null ? b.storeId : null,
        String(b.deviceName || ""),
        String(b.ipAddress || ""),
        positionType,
      ],
    );
    const [rows] = await pool.query(`${DEVICE_SELECT} WHERE d.id = ?`, [result.insertId]);
    res.json({ device: deviceRow(rows[0]) });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return res.status(400).json({ error: "设备编号已存在" });
    res.status(500).json({ error: e.message });
  }
});

// 编辑设备（改门店/类型/名称等）
router.put("/:id", requireRole("super_admin", "ops_manager"), async (req, res) => {
  const b = req.body || {};
  const sets = [];
  const params = [];
  const fields = {
    deviceIndexCode: "device_index_code",
    cameraIndexCode: "camera_index_code",
    macAddress: "mac_address",
    deviceName: "device_name",
    ipAddress: "ip_address",
  };
  for (const [key, col] of Object.entries(fields)) {
    if (b[key] !== undefined) { sets.push(`${col} = ?`); params.push(String(b[key])); }
  }
  if (b.storeId !== undefined) { sets.push("store_id = ?"); params.push(b.storeId != null ? b.storeId : null); }
  if (b.positionType !== undefined) {
    if (!POSITION_TYPES.includes(b.positionType)) {
      return res.status(400).json({ error: `positionType 必须是 ${POSITION_TYPES.join("/")}` });
    }
    sets.push("position_type = ?");
    params.push(b.positionType);
  }
  if (b.status !== undefined) { sets.push("status = ?"); params.push(b.status ? 1 : 0); }
  if (sets.length === 0) return res.status(400).json({ error: "没有可更新的字段" });
  params.push(req.params.id);
  try {
    const [result] = await pool.query(`UPDATE camera_device SET ${sets.join(", ")} WHERE id = ?`, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: "设备不存在" });
    const [rows] = await pool.query(`${DEVICE_SELECT} WHERE d.id = ?`, [req.params.id]);
    res.json({ device: deviceRow(rows[0]) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除设备
router.delete("/:id", requireRole("super_admin", "ops_manager"), async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM camera_device WHERE id = ?", [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "设备不存在" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
