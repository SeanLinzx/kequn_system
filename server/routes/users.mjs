// 用户管理（MySQL sys_user 主库）
// 权限：super_admin 全部；ops_manager 仅本品牌门店的 store_manager / executor
// 默认密码：新建/重置统一为 DEFAULT_USER_PASSWORD，标记 must_change_password=1，首次登录强制改密
import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db-mysql.mjs";
import { authMiddleware, requireRole, getUserBrands, getUserStores } from "../auth.mjs";

const router = Router();
router.use(authMiddleware);
router.use(requireRole("super_admin", "ops_manager"));

const DEFAULT_PASSWORD = process.env.USER_DEFAULT_PASSWORD || "Fenqun@123";
const CREATABLE_ROLES = ["store_manager", "executor"]; // 品牌管理员可创建的角色
const ALL_ROLES = ["super_admin", "ops_manager", "store_manager", "executor"];

/** 当前用户可管理的品牌（null=全部，仅超管） */
async function manageableBrandIds(req) {
  if (req.user.role === "super_admin") return null;
  return (await getUserBrands(req.user.id, req.user.role)).map((b) => b.id);
}

/** 校验 storeIds 是否在当前用户可管理范围内；返回清洗后的数组或抛错 */
async function sanitizeStoreIds(req, storeIds) {
  const ids = Array.isArray(storeIds) ? storeIds.map(Number).filter((n) => n > 0) : [];
  if (!ids.length) return [];
  const allowedBrands = await manageableBrandIds(req);
  if (allowedBrands === null) return ids; // 超管任意
  if (!allowedBrands.length) return [];   // 品牌管理员无品牌 → 不可绑定
  const [rows] = await pool.query(
    `SELECT id FROM store WHERE id IN (${ids.map(() => "?").join(",")}) AND brand_id IN (${allowedBrands.map(() => "?").join(",")})`,
    [...ids, ...allowedBrands],
  );
  return rows.map((r) => r.id);
}

/** 组装用户行（含门店绑定与品牌） */
async function mapUser(row) {
  const [bindings] = await pool.query(
    `SELECT us.store_id, s.code AS store_code, s.name AS store_name, b.code AS brand_code, b.name AS brand_name
     FROM sys_user_store us
     JOIN store s ON s.id = us.store_id
     LEFT JOIN brand b ON b.id = s.brand_id
     WHERE us.user_id = ?`,
    [row.id],
  );
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    must_change_password: row.must_change_password === 1,
    created_at: row.created_at,
    bindings: bindings.map((b) => ({
      storeId: b.store_id,
      storeCode: b.store_code,
      storeName: b.store_name,
      brandCode: b.brand_code,
      brandName: b.brand_name,
    })),
  };
}

// 列表：超管全部；品牌管理员仅本品牌门店绑定用户
router.get("/", async (req, res) => {
  try {
    const allowedBrands = await manageableBrandIds(req);
    let rows;
    if (allowedBrands === null) {
      [rows] = await pool.query("SELECT * FROM sys_user ORDER BY id");
    } else {
      if (!allowedBrands.length) return res.json({ users: [] });
      [rows] = await pool.query(
        `SELECT DISTINCT u.* FROM sys_user u
         JOIN sys_user_store us ON us.user_id = u.id
         JOIN store s ON s.id = us.store_id
         WHERE s.brand_id IN (${allowedBrands.map(() => "?").join(",")})
         ORDER BY u.id`,
        allowedBrands,
      );
    }
    res.json({ users: await Promise.all(rows.map(mapUser)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 创建用户：品牌管理员仅 store_manager/executor，且仅本品牌门店
router.post("/", async (req, res) => {
  try {
    const { name, email, role, storeIds } = req.body || {};
    if (!name?.trim() || !email?.trim() || !role) {
      return res.status(400).json({ error: "需要姓名、邮箱和角色" });
    }
    if (req.user.role !== "super_admin" && !CREATABLE_ROLES.includes(role)) {
      return res.status(403).json({ error: "品牌管理员仅可创建门店管理员/执行者" });
    }
    if (!ALL_ROLES.includes(role)) return res.status(400).json({ error: "无效的角色" });

    const emailNorm = email.trim().toLowerCase();
    const [dup] = await pool.query("SELECT id FROM sys_user WHERE email = ?", [emailNorm]);
    if (dup[0]) return res.status(400).json({ error: "邮箱已存在" });

    const allowedStoreIds = await sanitizeStoreIds(req, storeIds);
    const [result] = await pool.query(
      `INSERT INTO sys_user (email, password_hash, name, role, must_change_password)
       VALUES (?, ?, ?, ?, 1)`,
      [emailNorm, bcrypt.hashSync(DEFAULT_PASSWORD, 10), name.trim(), role],
    );
    const userId = result.insertId;
    for (const storeId of allowedStoreIds) {
      await pool.query("INSERT IGNORE INTO sys_user_store (user_id, store_id) VALUES (?, ?)", [userId, storeId]);
    }

    const [rows] = await pool.query("SELECT * FROM sys_user WHERE id = ?", [userId]);
    res.json({ ok: true, user: await mapUser(rows[0]), defaultPassword: DEFAULT_PASSWORD });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 编辑：姓名/角色/门店绑定（品牌管理员限本品牌门店）
router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.query("SELECT * FROM sys_user WHERE id = ?", [id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "用户不存在" });

    const { name, role, storeIds } = req.body || {};
    if (req.user.role !== "super_admin") {
      // 品牌管理员不可改超管/其他品牌管理员，且不可提升角色
      if (user.role === "super_admin" || user.role === "ops_manager") {
        return res.status(403).json({ error: "无权限操作该用户" });
      }
      if (role && !CREATABLE_ROLES.includes(role)) {
        return res.status(403).json({ error: "品牌管理员仅可管理门店管理员/执行者" });
      }
    }
    if (role && !ALL_ROLES.includes(role)) return res.status(400).json({ error: "无效的角色" });

    const sets = [];
    const params = [];
    if (name?.trim()) { sets.push("name = ?"); params.push(name.trim()); }
    if (role && role !== user.role) { sets.push("role = ?"); params.push(role); }
    if (sets.length) {
      params.push(id);
      await pool.query(`UPDATE sys_user SET ${sets.join(", ")} WHERE id = ?`, params);
    }

    if (Array.isArray(storeIds)) {
      const allowed = await sanitizeStoreIds(req, storeIds);
      await pool.query("DELETE FROM sys_user_store WHERE user_id = ?", [id]);
      for (const storeId of allowed) {
        await pool.query("INSERT IGNORE INTO sys_user_store (user_id, store_id) VALUES (?, ?)", [id, storeId]);
      }
    }

    const [updated] = await pool.query("SELECT * FROM sys_user WHERE id = ?", [id]);
    res.json({ ok: true, user: await mapUser(updated[0]) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 重置密码：统一默认密码 + 强制改密标记
router.post("/:id/reset-password", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [rows] = await pool.query("SELECT * FROM sys_user WHERE id = ?", [id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "用户不存在" });
    if (req.user.role !== "super_admin") {
      if (user.role === "super_admin" || user.role === "ops_manager") {
        return res.status(403).json({ error: "无权限操作该用户" });
      }
    }
    await pool.query(
      "UPDATE sys_user SET password_hash = ?, must_change_password = 1 WHERE id = ?",
      [bcrypt.hashSync(DEFAULT_PASSWORD, 10), id],
    );
    res.json({ ok: true, defaultPassword: DEFAULT_PASSWORD, email: user.email });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 删除：不可删除自己；品牌管理员仅本品牌门店用户
router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: "不能删除自己" });
    const [rows] = await pool.query("SELECT * FROM sys_user WHERE id = ?", [id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: "用户不存在" });
    if (req.user.role !== "super_admin") {
      if (user.role === "super_admin" || user.role === "ops_manager") {
        return res.status(403).json({ error: "无权限操作该用户" });
      }
    }
    await pool.query("DELETE FROM sys_user_store WHERE user_id = ?", [id]);
    await pool.query("DELETE FROM sys_user WHERE id = ?", [id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 可创建角色（前端表单用）
router.get("/meta/roles", (req, res) => {
  res.json({ roles: req.user.role === "super_admin" ? ALL_ROLES : CREATABLE_ROLES });
});

export default router;
