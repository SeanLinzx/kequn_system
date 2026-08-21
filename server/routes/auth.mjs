import { Router } from "express";
import bcrypt from "bcryptjs";
import { tables } from "../db.mjs";
import { signToken, getUserStores, verifyToken, authMiddleware } from "../auth.mjs";

const router = Router();

router.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "请输入邮箱和密码" });
  const user = tables.users.findOne((u) => u.email === email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "邮箱或密码错误" });
  }
  const stores = getUserStores(user.id, user.role);
  res.json({
    token: signToken(user),
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
    stores,
  });
});

router.get("/me", (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "未登录" });
  try {
    const payload = verifyToken(token);
    const user = tables.users.get(payload.id);
    if (!user) return res.status(401).json({ error: "用户不存在" });
    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, created_at: user.created_at },
      stores: getUserStores(user.id, user.role),
    });
  } catch {
    res.status(401).json({ error: "登录已过期" });
  }
});

router.put("/me", authMiddleware, (req, res) => {
  const user = tables.users.get(req.user.id);
  if (!user) return res.status(404).json({ error: "用户不存在" });

  const { name, email, currentPassword, newPassword } = req.body || {};
  const patch = {};

  if (name?.trim()) patch.name = name.trim();
  if (email?.trim()) {
    const nextEmail = email.trim();
    if (nextEmail !== user.email) {
      if (tables.users.findOne((u) => u.email === nextEmail && u.id !== user.id)) {
        return res.status(400).json({ error: "邮箱已被占用" });
      }
      patch.email = nextEmail;
    }
  }
  if (newPassword) {
    if (!currentPassword || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(400).json({ error: "当前密码不正确" });
    }
    if (newPassword.length < 6) return res.status(400).json({ error: "新密码至少 6 位" });
    patch.password_hash = bcrypt.hashSync(newPassword, 10);
  }
  if (!Object.keys(patch).length) return res.status(400).json({ error: "没有可更新的内容" });

  tables.users.update(user.id, patch);
  const updated = tables.users.get(user.id);
  res.json({
    token: signToken(updated),
    user: { id: updated.id, email: updated.email, name: updated.name, role: updated.role },
    stores: getUserStores(updated.id, updated.role),
  });
});

export default router;
