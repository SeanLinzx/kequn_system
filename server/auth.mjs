import jwt from "jsonwebtoken";
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

export function canAccessStoreSync(userId, role, storeId) {
  if (role === "super_admin") return true;
  return !!tables.user_stores.findOne((x) => x.user_id === userId && x.store_id === storeId);
}

export function getUserStores(userId, role) {
  if (role === "super_admin") {
    return tables.stores.all().sort((a, b) => b.is_real - a.is_real || a.name.localeCompare(b.name));
  }
  const ids = tables.user_stores.filter((x) => x.user_id === userId).map((x) => x.store_id);
  return tables.stores.filter((s) => ids.includes(s.id));
}
