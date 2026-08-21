import { Router } from "express";
import multer from "multer";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { tables, sendMessage } from "../db.mjs";
import { authMiddleware, requireRole } from "../auth.mjs";
import { siteLink } from "../services/email.mjs";

const router = Router();
router.use(authMiddleware);

const UPLOAD_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "uploads");
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, `task-${Date.now()}${extname(file.originalname) || ".jpg"}`),
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
});

function mapTask(t) {
  return {
    ...t,
    steps: JSON.parse(t.steps_json || "[]"),
    checklist: JSON.parse(t.checklist_json || "[]"),
    photoUrls: JSON.parse(t.photo_urls_json || "[]"),
    attachImages: JSON.parse(t.attach_images_json || "[]"),
    brief: t.brief || "",
    assignee_name: tables.users.get(t.assignee_id)?.name,
  };
}

router.get("/", (req, res) => {
  const { status } = req.query;
  let rows;
  if (req.user.role === "executor") {
    rows = tables.tasks.filter((t) => t.assignee_id === req.user.id);
    if (status) rows = rows.filter((t) => t.status === status);
  } else {
    rows = tables.tasks.all();
    if (req.user.role === "ops_manager") {
      const ids = tables.user_stores.filter((x) => x.user_id === req.user.id).map((x) => x.store_id);
      rows = rows.filter((t) => ids.includes(t.store_id));
    }
    if (status) rows = rows.filter((t) => t.status === status);
  }
  rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.json({ tasks: rows.slice(0, 100).map(mapTask) });
});

router.get("/:id", (req, res) => {
  const t = tables.tasks.get(Number(req.params.id));
  if (!t) return res.status(404).json({ error: "任务不存在" });
  if (req.user.role === "executor" && t.assignee_id !== req.user.id) {
    return res.status(403).json({ error: "无权限" });
  }
  res.json(mapTask(t));
});

router.patch("/:id/checklist", requireRole("executor"), (req, res) => {
  const t = tables.tasks.get(Number(req.params.id));
  if (!t || t.assignee_id !== req.user.id) return res.status(403).json({ error: "无权限" });
  const { checklist } = req.body || {};
  if (!Array.isArray(checklist)) return res.status(400).json({ error: "无效清单" });
  const status = checklist.every((c) => c.done) && t.status !== "done" ? "in_progress" : t.status;
  tables.tasks.update(t.id, { checklist_json: JSON.stringify(checklist), status });
  res.json({ ok: true });
});

router.post("/:id/photo", requireRole("executor"), upload.single("photo"), (req, res) => {
  const t = tables.tasks.get(Number(req.params.id));
  if (!t || t.assignee_id !== req.user.id) return res.status(403).json({ error: "无权限" });
  if (!req.file) return res.status(400).json({ error: "请上传照片" });
  const urls = JSON.parse(t.photo_urls_json || "[]");
  const url = `/kequn/system/uploads/${req.file.filename}`;
  urls.push(url);
  tables.tasks.update(t.id, { photo_urls_json: JSON.stringify(urls) });
  res.json({ ok: true, url, photoUrls: urls });
});

router.post("/:id/complete", requireRole("executor"), (req, res) => {
  const t = tables.tasks.get(Number(req.params.id));
  if (!t || t.assignee_id !== req.user.id) return res.status(403).json({ error: "无权限" });
  const checklist = JSON.parse(t.checklist_json || "[]");
  const photos = JSON.parse(t.photo_urls_json || "[]");
  if (!checklist.every((c) => c.done)) return res.status(400).json({ error: "请先完成所有检查项" });
  if (!photos.length) return res.status(400).json({ error: "请至少上传一张照片" });
  tables.tasks.update(t.id, { status: "done", completed_at: new Date().toISOString() });
  const creator = tables.users.get(t.created_by);
  if (creator) {
    sendMessage({
      userId: creator.id,
      title: `任务已完成：${t.title}`,
      body: `执行者已完成任务，已上传 ${photos.length} 张照片。`,
      link: siteLink(`/ops.html?task=${t.id}#tasks`),
    });
  }
  res.json({ ok: true });
});

export default router;
