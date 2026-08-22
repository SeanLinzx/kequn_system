// 接入令牌（品牌/门店创建时自动生成，一实体一 token）
// GET：登录用户可见（按角色过滤）；POST/PUT/DELETE：super_admin
import { Router } from "express";
import { randomBytes } from "node:crypto";
import { pool } from "../db-mysql.mjs";
import { authMiddleware, requireRole, getUserBrands, getUserStores } from "../auth.mjs";

const router = Router();
router.use(authMiddleware);

function tokenRow(r) {
  return {
    id: r.id,
    token: r.token,
    name: r.name,
    brandId: r.brand_id,
    brandName: r.brand_name || null,
    storeId: r.store_id,
    storeName: r.store_name || null,
    enabled: r.enabled === 1,
    lastUsedAt: r.last_used_at,
    createdAt: r.created_at,
  };
}

// 令牌列表（按角色过滤：超管全部；品牌管理员=本品牌品牌令牌+本品牌门店令牌；门店管理员=本门店令牌）
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT t.*, b.name AS brand_name, s.name AS store_name
       FROM site_token t
       LEFT JOIN brand b ON b.id = t.brand_id
       LEFT JOIN store s ON s.id = t.store_id
       ORDER BY t.id`,
    );
    let tokens = rows;
    if (req.user.role === "ops_manager") {
      const brands = await getUserBrands(req.user.id, req.user.role);
      const stores = await getUserStores(req.user.id, req.user.role);
      const brandIds = new Set(brands.map((b) => b.id));
      const storeIds = new Set(stores.map((s) => s.id));
      tokens = rows.filter(
        (t) => (t.brand_id != null && brandIds.has(t.brand_id)) || (t.store_id != null && storeIds.has(t.store_id)),
      );
    } else if (req.user.role !== "super_admin") {
      const stores = await getUserStores(req.user.id, req.user.role);
      const storeIds = new Set(stores.map((s) => s.id));
      tokens = rows.filter((t) => t.store_id != null && storeIds.has(t.store_id));
    }
    res.json({ tokens: tokens.map(tokenRow) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 创建令牌（super_admin；一般场景由创建品牌/门店时自动生成）
router.post("/", requireRole("super_admin"), async (req, res) => {
  const { name, brandId, storeId } = req.body || {};
  if (!name) return res.status(400).json({ error: "需要 name（令牌用途说明）" });
  if (brandId != null) {
    const [brands] = await pool.query("SELECT id FROM brand WHERE id = ?", [brandId]);
    if (!brands[0]) return res.status(400).json({ error: "品牌不存在" });
  }
  if (storeId != null) {
    const [stores] = await pool.query("SELECT id FROM store WHERE id = ?", [storeId]);
    if (!stores[0]) return res.status(400).json({ error: "门店不存在" });
  }
  const token = randomBytes(24).toString("hex");
  try {
    const [result] = await pool.query(
      "INSERT INTO site_token (token, name, brand_id, store_id) VALUES (?, ?, ?, ?)",
      [token, name, brandId != null ? brandId : null, storeId != null ? storeId : null],
    );
    const [rows] = await pool.query(
      `SELECT t.*, b.name AS brand_name, s.name AS store_name FROM site_token t
       LEFT JOIN brand b ON b.id = t.brand_id LEFT JOIN store s ON s.id = t.store_id
       WHERE t.id = ?`,
      [result.insertId],
    );
    res.json({ token: tokenRow(rows[0]) });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return res.status(400).json({ error: "该品牌/门店已有令牌" });
    res.status(500).json({ error: e.message });
  }
});

// 启用/禁用 / 改名（super_admin）
router.put("/:id", requireRole("super_admin"), async (req, res) => {
  const b = req.body || {};
  const sets = [];
  const params = [];
  if (b.name !== undefined) { sets.push("name = ?"); params.push(String(b.name)); }
  if (b.enabled !== undefined) { sets.push("enabled = ?"); params.push(b.enabled ? 1 : 0); }
  if (sets.length === 0) return res.status(400).json({ error: "没有可更新的字段" });
  params.push(req.params.id);
  try {
    const [result] = await pool.query(`UPDATE site_token SET ${sets.join(", ")} WHERE id = ?`, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: "令牌不存在" });
    const [rows] = await pool.query(
      `SELECT t.*, b.name AS brand_name, s.name AS store_name FROM site_token t
       LEFT JOIN brand b ON b.id = t.brand_id LEFT JOIN store s ON s.id = t.store_id
       WHERE t.id = ?`,
      [req.params.id],
    );
    res.json({ token: tokenRow(rows[0]) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除令牌（super_admin）
router.delete("/:id", requireRole("super_admin"), async (req, res) => {
  try {
    const [result] = await pool.query("DELETE FROM site_token WHERE id = ?", [req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "令牌不存在" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
