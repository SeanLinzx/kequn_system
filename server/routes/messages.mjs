import { Router } from "express";
import { tables } from "../db.mjs";
import { authMiddleware } from "../auth.mjs";

const router = Router();
router.use(authMiddleware);

router.get("/", (req, res) => {
  const messages = tables.messages
    .filter((m) => m.user_id === req.user.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 100);
  const unread = messages.filter((m) => !m.is_read).length;
  res.json({ messages, unread });
});

router.post("/:id/read", (req, res) => {
  const m = tables.messages.get(Number(req.params.id));
  if (m && m.user_id === req.user.id) tables.messages.update(m.id, { is_read: 1 });
  res.json({ ok: true });
});

router.post("/read-all", (req, res) => {
  tables.messages
    .filter((m) => m.user_id === req.user.id && !m.is_read)
    .forEach((m) => tables.messages.update(m.id, { is_read: 1 }));
  res.json({ ok: true });
});

export default router;
