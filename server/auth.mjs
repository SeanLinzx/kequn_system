import jwt from "jsonwebtoken";
import { pool } from "./db-mysql.mjs";
import { tables } from "./db.mjs";

const JWT_SECRET = process.env.JWT_SECRET || "fenqun-dev-secret-change-me";

export function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: "24h" },
  );
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "未登录" });
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "登录已过期" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "无权限" });
    }
    next();
  };
}

// ============ MySQL 真实链路（M4 起） ============

/** 用户可访问的品牌集合（ops_manager = 绑定门店所属品牌；其他角色按门店绑定） */
async function userBrandIds(userId, role) {
  if (role === "super_admin") return null; // null = 全部品牌
  const [rows] = await pool.query(
    `SELECT DISTINCT s.brand_id FROM sys_user_store us
     JOIN store s ON s.id = us.store_id
     WHERE us.user_id = ? AND s.brand_id IS NOT NULL`,
    [userId],
  );
  return rows.map((r) => r.brand_id);
}

/** MySQL 门店权限校验（async）：超管全部；品牌管理员=绑定门店所属品牌全部门店；其他=绑定门店 */
export async function canAccessStore(userId, role, storeId) {
  if (role === "super_admin") return true;
  if (role === "ops_manager") {
    const brands = await userBrandIds(userId, role);
    if (!brands.length) return false;
    const [rows] = await pool.query(
      `SELECT 1 FROM store WHERE id = ? AND brand_id IN (${brands.map(() => "?").join(",")})`,
      [storeId, ...brands],
    );
    return rows.length > 0;
  }
  const [rows] = await pool.query(
    "SELECT 1 FROM sys_user_store WHERE user_id = ? AND store_id = ?",
    [userId, storeId],
  );
  return rows.length > 0;
}

/** 用户可访问的品牌列表（ops_manager 按其绑定门店的品牌） */
export async function getUserBrands(userId, role) {
  let rows;
  if (role === "super_admin") {
    [rows] = await pool.query("SELECT * FROM brand ORDER BY id");
  } else {
    const brands = await userBrandIds(userId, role);
    if (!brands.length) return [];
    [rows] = await pool.query(
      `SELECT * FROM brand WHERE id IN (${brands.map(() => "?").join(",")}) ORDER BY id`,
      brands,
    );
  }
  return rows;
}

/** MySQL 用户可见门店（async）；行含 is_real 兼容字段（is_real = !is_demo） */
export async function getUserStores(userId, role) {
  let rows;
  if (role === "super_admin") {
    [rows] = await pool.query("SELECT * FROM store WHERE status = 1 ORDER BY is_demo DESC, id");
  } else if (role === "ops_manager") {
    const brands = await userBrandIds(userId, role);
    if (!brands.length) return [];
    [rows] = await pool.query(
      `SELECT * FROM store WHERE status = 1 AND brand_id IN (${brands.map(() => "?").join(",")}) ORDER BY is_demo DESC, id`,
      brands,
    );
  } else {
    [rows] = await pool.query(
      `SELECT s.* FROM store s JOIN sys_user_store us ON us.store_id = s.id
       WHERE us.user_id = ? AND s.status = 1 ORDER BY s.id`,
      [userId],
    );
  }
  return rows.map((s) => ({ ...s, is_real: s.is_demo ? 0 : 1 }));
}

// ============ JsonTable 演示链路（D9：posters/solutions/executors 等演示模块沿用） ============

/** 同步权限校验（JsonTable，仅演示模块用） */
export function canAccessStoreSync(userId, role, storeId) {
  if (role === "super_admin") return true;
  return !!tables.user_stores.findOne((x) => x.user_id === userId && x.store_id === storeId);
}

/** 同步用户门店（JsonTable，仅演示模块用） */
export function getUserStoresLegacy(userId, role) {
  if (role === "super_admin") {
    return tables.stores.all().sort((a, b) => b.is_real - a.is_real || a.name.localeCompare(b.name));
  }
  const ids = tables.user_stores.filter((x) => x.user_id === userId).map((x) => x.store_id);
  return tables.stores.filter((s) => ids.includes(s.id));
}
