// 品牌管理（D10：品牌 → 门店 两级体系；创建时自动生成品牌 token）
import { Router } from "express";
import { randomBytes } from "node:crypto";
import { pool } from "../db-mysql.mjs";
import { authMiddleware, requireRole, getUserBrands } from "../auth.mjs";

const router = Router();
router.use(authMiddleware);

// 品牌列表（登录用户可看；超管全部，品牌管理员看自己品牌；含品牌 token）
router.get("/", async (req, res) => {
  try {
    const brands = await getUserBrands(req.user.id, req.user.role);
    if (!brands.length) return res.json({ brands: [] });
    const ids = brands.map((b) => b.id);
    const [rows] = await pool.query(
      `SELECT b.id, b.code, b.name, b.created_at,
              (SELECT COUNT(*) FROM store s WHERE s.brand_id = b.id) AS store_count,
              t.token AS token, t.enabled AS token_enabled
       FROM brand b
       LEFT JOIN site_token t ON t.brand_id = b.id
       WHERE b.id IN (${ids.map(() => "?").join(",")})
       ORDER BY b.id`,
      ids,
    );
    res.json({ brands: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 创建品牌（super_admin；自动生成品牌 token）
router.post("/", requireRole("super_admin"), async (req, res) => {
  const { code, name } = req.body || {};
  if (!code || !name) return res.status(400).json({ error: "需要 code 和 name" });
  try {
    const [result] = await pool.query("INSERT INTO brand (code, name) VALUES (?, ?)", [code, name]);
    const token = randomBytes(24).toString("hex");
    await pool.query("INSERT INTO site_token (token, name, brand_id) VALUES (?, ?, ?)", [
      token, `${name}品牌令牌`, result.insertId,
    ]);
    const [rows] = await pool.query(
      `SELECT b.id, b.code, b.name, b.created_at, t.token AS token, t.enabled AS token_enabled
       FROM brand b LEFT JOIN site_token t ON t.brand_id = b.id WHERE b.id = ?`,
      [result.insertId],
    );
    res.json({ brand: rows[0] });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") return res.status(400).json({ error: "品牌编码已存在" });
    res.status(500).json({ error: e.message });
  }
});

// 编辑品牌（super_admin）
router.put("/:id", requireRole("super_admin"), async (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "需要 name" });
  try {
    const [result] = await pool.query("UPDATE brand SET name = ? WHERE id = ?", [name, req.params.id]);
    if (result.affectedRows === 0) return res.status(404).json({ error: "品牌不存在" });
    const [rows] = await pool.query("SELECT id, code, name, created_at FROM brand WHERE id = ?", [req.params.id]);
    res.json({ brand: rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除品牌（super_admin；有门店则拒绝；同步删除品牌 token）
router.delete("/:id", requireRole("super_admin"), async (req, res) => {
  try {
    const [stores] = await pool.query("SELECT COUNT(*) AS c FROM store WHERE brand_id = ?", [req.params.id]);
    if (stores[0].c > 0) return res.status(400).json({ error: `该品牌下还有 ${stores[0].c} 家门店，无法删除` });
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query("DELETE FROM site_token WHERE brand_id = ?", [req.params.id]);
      const [result] = await conn.query("DELETE FROM brand WHERE id = ?", [req.params.id]);
      await conn.commit();
      if (result.affectedRows === 0) return res.status(404).json({ error: "品牌不存在" });
    } finally {
      conn.release();
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
