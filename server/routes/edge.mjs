// 边缘控制台注册接口（X-Access-Token 鉴权）
// 门店 token → 自动归属该门店；品牌 token → 品牌下门店列表（可新建/选择）
// bootstrap：首次配置拉门店（门店 token 直接返回该店；品牌 token 返回品牌门店列表）
import { Router } from "express";
import { pool } from "../db-mysql.mjs";
import { setupSsh, registerSshPubkey } from "../services/ssh-tunnel.mjs";

const router = Router();

const POSITION_TYPES = ["OUTSIDE_PASSBY", "ENTRANCE_COUNTER", "INSIDE_BODY", "UNKNOWN"];

/** X-Access-Token 鉴权：查 site_token（enabled=1），记录 last_used_at */
async function tokenAuth(req, res, next) {
  const token = String(req.headers["x-access-token"] || "").trim();
  if (!token) return res.status(401).json({ error: "缺少 X-Access-Token" });
  try {
    const [rows] = await pool.query(
      "SELECT * FROM site_token WHERE token = ? AND enabled = 1",
      [token],
    );
    if (!rows[0]) return res.status(401).json({ error: "接入令牌无效或已禁用" });
    req.siteToken = rows[0];
    await pool.query("UPDATE site_token SET last_used_at = NOW(3) WHERE id = ?", [rows[0].id]);
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

router.use(tokenAuth);

// 首次配置：门店 token → 该门店；品牌 token → 品牌门店列表（含绑定标记）
router.get("/bootstrap", async (req, res) => {
  try {
    const siteToken = req.siteToken;
    const isStoreToken = siteToken.store_id != null;
    let stores = [];
    if (isStoreToken) {
      const [rows] = await pool.query(
        `SELECT s.id, s.code, s.name, s.brand_id, b.name AS brand_name, s.location, s.business_hours,
                s.bound_at IS NOT NULL AS bound
         FROM store s LEFT JOIN brand b ON b.id = s.brand_id
         WHERE s.id = ?`,
        [siteToken.store_id],
      );
      stores = rows;
    } else {
      const scope = siteToken.brand_id ? [siteToken.brand_id] : null;
      const [rows] = await pool.query(
        `SELECT s.id, s.code, s.name, s.brand_id, b.name AS brand_name, s.location, s.business_hours,
                s.bound_at IS NOT NULL AS bound
         FROM store s LEFT JOIN brand b ON b.id = s.brand_id
         ${scope ? "WHERE s.brand_id = ?" : ""}
         ORDER BY s.bound_at IS NOT NULL, s.id`,
        scope || [],
      );
      stores = rows;
    }
    const [brands] = await pool.query(
      siteToken.brand_id
        ? "SELECT id, code, name FROM brand WHERE id = ?"
        : "SELECT id, code, name FROM brand ORDER BY id",
      siteToken.brand_id ? [siteToken.brand_id] : [],
    );
    const [devices] = await pool.query(
      `SELECT d.device_index_code, d.camera_index_code, d.mac_address, d.store_id, d.device_name,
              d.ip_address, d.position_type, d.last_report_at, s.code AS store_code
       FROM camera_device d LEFT JOIN store s ON s.id = d.store_id`,
    );
    const macs = String(req.query.macs || "")
      .split(",")
      .map((m) => m.trim().toLowerCase())
      .filter(Boolean);
    const matchedDevices = macs.length
      ? devices.filter((d) => {
          const devMac = String(d.mac_address || "").toLowerCase();
          const devCode = String(d.device_index_code || "").toLowerCase();
          return macs.includes(devMac) || macs.includes(devCode);
        })
      : devices;
    res.json({
      token: {
        id: siteToken.id,
        name: siteToken.name,
        brandId: siteToken.brand_id,
        storeId: siteToken.store_id,
        type: isStoreToken ? "store" : "brand",
      },
      brands: brands.map((b) => ({ id: b.id, code: b.code, name: b.name })),
      stores: stores.map((s) => ({
        id: s.id, code: s.code, name: s.name, brandId: s.brand_id, brandName: s.brand_name,
        location: s.location, businessHours: s.business_hours, bound: s.bound === 1 || s.bound === true,
      })),
      devices: matchedDevices.map((d) => ({
        deviceIndexCode: d.device_index_code,
        cameraIndexCode: d.camera_index_code,
        macAddress: d.mac_address,
        storeId: d.store_id,
        storeCode: d.store_code,
        deviceName: d.device_name,
        ipAddress: d.ip_address,
        positionType: d.position_type,
        lastReportAt: d.last_report_at,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 新建门店（品牌 token 现场建店；门店 token 无需建店）
router.post("/stores", async (req, res) => {
  const b = req.body || {};
  const siteToken = req.siteToken;
  if (siteToken.store_id != null) {
    return res.status(403).json({ error: "门店令牌已绑定门店，无需创建门店" });
  }
  const name = String(b.name || "").trim();
  if (!name) return res.status(400).json({ error: "需要 name" });
  const brandId = b.brandId != null ? b.brandId : siteToken.brand_id;
  if (brandId != null) {
    const [brands] = await pool.query("SELECT id FROM brand WHERE id = ?", [brandId]);
    if (!brands[0]) return res.status(400).json({ error: "品牌不存在" });
    if (siteToken.brand_id && brandId !== siteToken.brand_id) {
      return res.status(403).json({ error: "门店品牌超出令牌范围" });
    }
  }
  const code = b.code ? String(b.code).trim() : `st-${Date.now().toString(36)}`;
  try {
    const [result] = await pool.query(
      `INSERT INTO store (code, name, brand_id, location, business_hours, is_demo)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [code, name, brandId ?? null, String(b.location || ""), String(b.businessHours || "")],
    );
    // 现场建店后自动生成门店 token（管理面板门店详情也可查看）
    const token = (await import("node:crypto")).randomBytes(24).toString("hex");
    await pool.query("INSERT INTO site_token (token, name, store_id) VALUES (?, ?, ?)", [
      token, `${name}门店令牌`, result.insertId,
    ]);
    const [rows] = await pool.query(
      "SELECT id, code, name, brand_id, location, business_hours FROM store WHERE id = ?",
      [result.insertId],
    );
    res.json({ ok: true, store: rows[0], token });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return res.status(400).json({ error: "门店编码已存在" });
    res.status(500).json({ error: e.message });
  }
});

// 注册/更新设备（按 device_index_code upsert；门店 token 强制归属该店）
router.post("/devices", async (req, res) => {
  const b = req.body || {};
  const siteToken = req.siteToken;
  const deviceIndexCode = String(b.deviceIndexCode || "").trim().toLowerCase().replace(/[:\-]/g, "");
  if (!deviceIndexCode) return res.status(400).json({ error: "需要 deviceIndexCode" });
  if (b.positionType && !POSITION_TYPES.includes(b.positionType)) {
    return res.status(400).json({ error: `positionType 必须是 ${POSITION_TYPES.join("/")}` });
  }
  try {
    // 门店归属：门店 token 强制；品牌 token 校验 body 门店属于品牌
    let storeId = siteToken.store_id != null ? siteToken.store_id : b.storeId != null ? b.storeId : null;
    if (storeId != null) {
      const [stores] = await pool.query("SELECT * FROM store WHERE id = ?", [storeId]);
      if (!stores[0]) return res.status(400).json({ error: "门店不存在" });
      if (!siteToken.store_id && siteToken.brand_id && stores[0].brand_id !== siteToken.brand_id) {
        return res.status(403).json({ error: "门店超出令牌品牌范围" });
      }
    }
    const positionType = b.positionType || "UNKNOWN";
    const [existing] = await pool.query(
      "SELECT id FROM camera_device WHERE device_index_code = ?",
      [deviceIndexCode],
    );
    let deviceId;
    if (existing[0]) {
      deviceId = existing[0].id;
      await pool.query(
        `UPDATE camera_device SET
           camera_index_code = ?, mac_address = ?, store_id = ?, device_name = ?, ip_address = ?, position_type = ?
         WHERE id = ?`,
        [
          String(b.cameraIndexCode || ""),
          String(b.macAddress || ""),
          storeId,
          String(b.deviceName || ""),
          String(b.ipAddress || ""),
          positionType,
          deviceId,
        ],
      );
    } else {
      const [result] = await pool.query(
        `INSERT INTO camera_device
           (device_index_code, camera_index_code, mac_address, store_id, device_name, ip_address, position_type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          deviceIndexCode,
          String(b.cameraIndexCode || ""),
          String(b.macAddress || ""),
          storeId,
          String(b.deviceName || ""),
          String(b.ipAddress || ""),
          positionType,
        ],
      );
      deviceId = result.insertId;
    }
    // 绑定完成 → 标记门店已被部署绑定
    if (storeId != null) {
      await pool.query("UPDATE store SET bound_at = NOW(3) WHERE id = ? AND bound_at IS NULL", [storeId]);
    }
    res.json({
      ok: true,
      device: {
        id: deviceId,
        deviceIndexCode,
        storeId,
        positionType,
        bound: storeId != null,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 注册/更新控制台部署信息（门店员工局域网访问入口；Web 端可一键跳转）
router.post("/console", async (req, res) => {
  const b = req.body || {};
  const siteToken = req.siteToken;
  const storeId = b.storeId != null ? b.storeId : siteToken.store_id;
  if (storeId == null) {
    return res.status(400).json({ error: "需要 storeId（请先选择/确认门店）" });
  }
  try {
    const [stores] = await pool.query("SELECT * FROM store WHERE id = ?", [storeId]);
    if (!stores[0]) return res.status(400).json({ error: "门店不存在" });
    if (!siteToken.store_id && siteToken.brand_id && stores[0].brand_id !== siteToken.brand_id) {
      return res.status(403).json({ error: "门店超出令牌品牌范围" });
    }
    await pool.query(
      `INSERT INTO console_deployment (store_id, console_id, name, ip_address, port, last_seen_at,
        tunnel_port, tunnel_token)
       VALUES (?, ?, ?, ?, ?, NOW(3), ?, ?)
       ON DUPLICATE KEY UPDATE
         console_id = VALUES(console_id), name = VALUES(name),
         ip_address = VALUES(ip_address), port = VALUES(port), last_seen_at = NOW(3),
         tunnel_port = COALESCE(VALUES(tunnel_port), tunnel_port),
         tunnel_token = COALESCE(VALUES(tunnel_token), tunnel_token)`,
      [storeId, String(b.id || ""), String(b.name || ""), String(b.ip || ""), Number(b.port || 3000),
       b.tunnelPort != null ? Number(b.tunnelPort) : null, b.tunnelToken || null],
    );
    res.json({ ok: true, storeId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SSH 隧道准备（安装脚本调用）：分配端口 + 生成总部→门店密钥，返回公钥/端口/网关用户
router.post("/ssh-setup", async (req, res) => {
  const siteToken = req.siteToken;
  if (siteToken.store_id == null) {
    return res.status(400).json({ error: "需要门店令牌（SSH 隧道按门店分配）" });
  }
  try {
    const result = await setupSsh(siteToken.store_id, req.body?.consoleId || String(siteToken.id));
    res.json({ ok: true, ...result, host: req.headers.host || "" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 门店→总部 SSH 公钥登记（安装脚本生成密钥后上报，加入总部网关用户 authorized_keys）
router.post("/ssh-pubkey", async (req, res) => {
  const siteToken = req.siteToken;
  if (siteToken.store_id == null) {
    return res.status(400).json({ error: "需要门店令牌" });
  }
  try {
    const result = await registerSshPubkey(siteToken.store_id, req.body?.publicKey);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 远程更新任务轮询（控制台每 30s 调用；pending 才返回）
router.get("/update-task", async (req, res) => {
  const siteToken = req.siteToken;
  if (siteToken.store_id == null) return res.json({ task: null });
  try {
    const [rows] = await pool.query("SELECT update_task FROM console_deployment WHERE store_id = ?", [siteToken.store_id]);
    let task = null;
    if (rows[0]?.update_task) {
      const parsed = JSON.parse(rows[0].update_task);
      if (parsed?.status === "pending") task = parsed;
    }
    res.json({ task });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 更新结果上报（控制台执行完成后调用）
router.post("/update-result", async (req, res) => {
  const siteToken = req.siteToken;
  const b = req.body || {};
  if (siteToken.store_id == null) return res.status(400).json({ error: "需要门店令牌" });
  try {
    const [rows] = await pool.query("SELECT update_task FROM console_deployment WHERE store_id = ?", [siteToken.store_id]);
    const cur = rows[0]?.update_task ? JSON.parse(rows[0].update_task) : null;
    if (cur && cur.status === "pending") {
      cur.status = b.ok ? "done" : "error";
      cur.message = String(b.message || (b.ok ? "更新成功" : "更新失败"));
      cur.finishedAt = new Date().toISOString();
      await pool.query("UPDATE console_deployment SET update_task = ? WHERE store_id = ?", [JSON.stringify(cur), siteToken.store_id]);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 门店卸载清理：删除该门店的 console_deployment 记录（控制台卸载时调用）
router.post("/uninstall", async (req, res) => {
  const siteToken = req.siteToken;
  if (siteToken.store_id == null) return res.status(400).json({ error: "需要门店令牌" });
  try {
    const [result] = await pool.query("DELETE FROM console_deployment WHERE store_id = ?", [siteToken.store_id]);
    // 顺带清理该门店令牌的安装短码（避免复用）
    await pool.query("UPDATE site_token SET install_code = NULL, install_code_expires_at = NULL WHERE store_id = ?", [siteToken.store_id]);
    res.json({ ok: true, removed: result.affectedRows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
