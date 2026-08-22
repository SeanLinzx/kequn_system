import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db-mysql.mjs";
import { signToken, getUserStores, verifyToken, authMiddleware } from "../auth.mjs";

const router = Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: "请输入邮箱和密码" });
  const [users] = await pool.query("SELECT * FROM sys_user WHERE email = ?", [email]);
  const user = users[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "邮箱或密码错误" });
  }
  const stores = await getUserStores(user.id, user.role);
  res.json({
    token: signToken(user),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      must_change_password: user.must_change_password === 1,
    },
    stores,
  });
});

router.get("/me", async (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "未登录" });
  try {
    const payload = verifyToken(token);
    const [users] = await pool.query("SELECT * FROM sys_user WHERE id = ?", [payload.id]);
    const user = users[0];
    if (!user) return res.status(401).json({ error: "用户不存在" });
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        must_change_password: user.must_change_password === 1,
        created_at: user.created_at,
      },
      stores: await getUserStores(user.id, user.role),
    });
  } catch {
    res.status(401).json({ error: "登录已过期" });
  }
});

router.put("/me", authMiddleware, async (req, res) => {
  const [users] = await pool.query("SELECT * FROM sys_user WHERE id = ?", [req.user.id]);
  const user = users[0];
  if (!user) return res.status(404).json({ error: "用户不存在" });

  const { name, email, currentPassword, newPassword } = req.body || {};
  const sets = [];
  const params = [];

  if (name?.trim()) { sets.push("name = ?"); params.push(name.trim()); }
  if (email?.trim()) {
    const nextEmail = email.trim();
    if (nextEmail !== user.email) {
      const [dup] = await pool.query("SELECT id FROM sys_user WHERE email = ? AND id <> ?", [nextEmail, user.id]);
      if (dup[0]) return res.status(400).json({ error: "邮箱已被占用" });
      sets.push("email = ?");
      params.push(nextEmail);
    }
  }
  if (newPassword) {
    if (!currentPassword || !bcrypt.compareSync(currentPassword, user.password_hash)) {
      return res.status(400).json({ error: "当前密码不正确" });
    }
    if (newPassword.length < 6) return res.status(400).json({ error: "新密码至少 6 位" });
    sets.push("password_hash = ?");
    params.push(bcrypt.hashSync(newPassword, 10));
  }
  if (!sets.length) return res.status(400).json({ error: "没有可更新的内容" });

  params.push(user.id);
  await pool.query(`UPDATE sys_user SET ${sets.join(", ")} WHERE id = ?`, params);

  const [updatedRows] = await pool.query("SELECT * FROM sys_user WHERE id = ?", [user.id]);
  const updated = updatedRows[0];
  // 修改密码成功后清除强制改密标记
  if (newPassword && updated.must_change_password === 1) {
    await pool.query("UPDATE sys_user SET must_change_password = 0 WHERE id = ?", [user.id]);
    updated.must_change_password = 0;
  }
  res.json({
    token: signToken(updated),
    user: {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      role: updated.role,
      must_change_password: updated.must_change_password === 1,
    },
    stores: await getUserStores(updated.id, updated.role),
  });
});

export default router;
