// 发布管理 API（合并自 release-admin，接入主系统 JWT + super_admin 权限）
import { Router } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { authMiddleware, requireRole } from "../auth.mjs";
import {
  ensureLayout, state, importPackage, promoteChannel, rollbackChannel, revokeChannel, deletePackage, releaseRoot,
} from "../services/releases.mjs";

const router = Router();
router.use(authMiddleware);
router.use(requireRole("super_admin"));

// 上传临时目录（发布目录下 uploads）
const uploadDir = path.join(releaseRoot(), "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, `${Date.now()}-${String(file.originalname || "package").replace(/[^a-zA-Z0-9._-]/g, "-")}`),
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

// 发布状态（包列表 / 通道 / 历史 / 建议版本）
router.get("/state", (_req, res) => {
  try {
    res.json({ ok: true, ...state() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 上传安装包（multipart: packageFile + version + platform + notes）
router.post("/packages/upload", upload.single("packageFile"), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "请选择要上传的安装包" });
    const manifest = importPackage({
      sourcePath: req.file.path,
      version: req.body.version,
      platform: req.body.platform,
      notes: req.body.notes,
    });
    res.json({ ok: true, manifest, ...state() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 从服务器路径导入（已存在的包文件）
router.post("/packages/import", (req, res) => {
  try {
    const manifest = importPackage(req.body || {});
    res.json({ ok: true, manifest, ...state() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 删除包（已发布需先撤回）
router.post("/packages/delete", (req, res) => {
  try {
    const result = deletePackage(req.body || {});
    res.json({ ok: true, ...result, ...state() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 发布到通道
router.post("/channels/promote", (req, res) => {
  try {
    const manifest = promoteChannel(req.body || {});
    res.json({ ok: true, manifest, ...state() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/channels/rollback", (req, res) => {
  try {
    const manifest = rollbackChannel(req.body || {});
    res.json({ ok: true, manifest, ...state() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 撤回通道
router.post("/channels/revoke", (req, res) => {
  try {
    const result = revokeChannel(req.body || {});
    res.json({ ok: true, ...result, ...state() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

export default router;
