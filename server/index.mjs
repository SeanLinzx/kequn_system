import "./load-env.mjs";
import express from "express";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

import { initDb, seedDb } from "./db.mjs";
import { proxyArkImage } from "./services/ai.mjs";
import authRoutes from "./routes/auth.mjs";
import storeRoutes from "./routes/stores.mjs";
import solutionRoutes from "./routes/solutions.mjs";
import taskRoutes from "./routes/tasks.mjs";
import messageRoutes from "./routes/messages.mjs";
import posterRoutes from "./routes/posters.mjs";
import adminRoutes from "./routes/admin.mjs";
import executorRoutes from "./routes/executors.mjs";
import customerInsightRoutes from "./routes/customer-insight.mjs";
const PUBLIC_DIR = join(__dirname, "..", "public");
const UPLOAD_DIR = join(PUBLIC_DIR, "uploads");

const PORT = Number(process.env.PORT || 3011);

initDb();
seedDb();

const app = express();
app.use(express.json({ limit: "10mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "fenqun-system", port: PORT });
});

app.use("/api/auth", authRoutes);
app.use("/api/stores", storeRoutes);
app.use("/api/solutions", solutionRoutes);
app.use("/api/tasks", taskRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/posters", posterRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/executors", executorRoutes);
app.use("/api/customer", customerInsightRoutes);

// Ark image proxy for poster generation
app.use("/api/v3", (req, res) => {
  proxyArkImage(req, res);
});

// static uploads
if (existsSync(UPLOAD_DIR)) {
  app.use("/uploads", express.static(UPLOAD_DIR));
}

app.listen(PORT, () => {
  console.log(`fenqun-system API: http://localhost:${PORT}/api/health`);
});
