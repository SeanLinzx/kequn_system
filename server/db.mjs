import bcrypt from "bcryptjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");

class JsonTable {
  constructor(name) {
    this.path = join(DATA_DIR, `${name}.json`);
    this.name = name;
    this.rows = [];
    this._seq = 0;
    this.load();
  }

  load() {
    if (existsSync(this.path)) {
      const raw = JSON.parse(readFileSync(this.path, "utf8"));
      this.rows = raw.rows || [];
      this._seq = raw.seq || 0;
    }
  }

  save() {
    writeFileSync(this.path, JSON.stringify({ seq: this._seq, rows: this.rows }, null, 2), "utf8");
  }

  all() {
    return [...this.rows];
  }

  get(id) {
    return this.rows.find((r) => r.id === id) || null;
  }

  findOne(pred) {
    return this.rows.find(pred) || null;
  }

  filter(pred) {
    return this.rows.filter(pred);
  }

  insert(row) {
    this._seq += 1;
    const rec = {
      id: row.id != null ? row.id : this._seq,
      created_at: new Date().toISOString(),
      ...row,
    };
    if (typeof rec.id === "number" && rec.id > this._seq) this._seq = rec.id;
    this.rows.push(rec);
    this.save();
    return { lastInsertRowid: rec.id, record: rec };
  }

  update(id, patch) {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.rows[idx] = { ...this.rows[idx], ...patch, updated_at: new Date().toISOString() };
    this.save();
    return true;
  }

  remove(id) {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx === -1) return false;
    this.rows.splice(idx, 1);
    this.save();
    return true;
  }

  upsertUnique(key, row) {
    const existing = this.rows.find((r) => r[key] === row[key]);
    if (existing) return existing;
    return this.insert(row).record;
  }
}

export const tables = {
  users: new JsonTable("users"),
  stores: new JsonTable("stores"),
  user_stores: new JsonTable("user_stores"),
  solutions: new JsonTable("solutions"),
  tasks: new JsonTable("tasks"),
  messages: new JsonTable("messages"),
  posters: new JsonTable("posters"),
  ai_usage_logs: new JsonTable("ai_usage_logs"),
  hotspot_pushes: new JsonTable("hotspot_pushes"),
  targets: new JsonTable("targets"),
  report_subscriptions: new JsonTable("report_subscriptions"),
  diagnosis_reports: new JsonTable("diagnosis_reports"),
};

export function initDb() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

export function seedDb() {
  // 与 MySQL seed（sql/seed.mjs）保持一致：生产只有 demo + test 两个品牌/门店
  const stores = [
    { id: "demo-store", name: "演示门店", location: "演示地址", is_real: 1, brand: "演示品牌" },
    { id: "test-store", name: "测试门店", location: "测试地址", is_real: 1, brand: "测试品牌" },
  ];
  const defaultPrinter = process.env.YLY_DEFAULT_MACHINE_CODE || "4004904861";
  const seedIds = new Set(stores.map((s) => s.id));
  // 清理不在 seed 列表中的历史门店（旧 mock 数据）
  for (const existing of tables.stores.all()) {
    if (!seedIds.has(existing.id)) tables.stores.remove(existing.id);
  }
  for (const s of stores) {
    const existing = tables.stores.all().find((x) => x.id === s.id);
    if (!existing) {
      tables.stores.insert({ ...s, printer_machine_code: defaultPrinter });
    } else {
      tables.stores.update(s.id, {
        name: s.name,
        location: s.location,
        is_real: s.is_real,
        brand: s.brand,
        printer_machine_code: existing.printer_machine_code || defaultPrinter,
      });
    }
  }

  const users = [
    { email: "admin@fenqun.local", pass: "Admin@2026", name: "超级管理员", role: "super_admin" },
    { email: "ops@fenqun.local", pass: "Ops@2026", name: "品牌管理员", role: "ops_manager" },
    { email: "store@fenqun.local", pass: "Store@2026", name: "门店管理员", role: "store_manager" },
    { email: "exec@fenqun.local", pass: "Exec@2026", name: "门店执行者", role: "executor" },
  ];
  const userIds = {};
  for (const u of users) {
    let row = tables.users.findOne((x) => x.email === u.email);
    if (!row) {
      row = tables.users
        .insert({
          email: u.email,
          password_hash: bcrypt.hashSync(u.pass, 10),
          name: u.name,
          role: u.role,
        }).record;
    }
    userIds[u.email] = row.id;
  }

  function bind(userId, storeId) {
    if (!tables.user_stores.findOne((x) => x.user_id === userId && x.store_id === storeId)) {
      tables.user_stores.insert({ user_id: userId, store_id: storeId });
    }
  }
  // 清理指向已删除门店的历史绑定
  for (const b of tables.user_stores.all()) {
    if (!tables.stores.get(b.store_id)) tables.user_stores.remove(b.id);
  }
  if (userIds["ops@fenqun.local"]) {
    bind(userIds["ops@fenqun.local"], "demo-store");
    bind(userIds["ops@fenqun.local"], "test-store");
  }
  if (userIds["store@fenqun.local"]) {
    bind(userIds["store@fenqun.local"], "demo-store");
  }
  if (userIds["exec@fenqun.local"]) {
    bind(userIds["exec@fenqun.local"], "demo-store");
  }
}

export function logAiUsage({ userId, storeId, action, model, tokensEst = 0 }) {
  tables.ai_usage_logs.insert({
    user_id: userId ?? null,
    store_id: storeId ?? null,
    action,
    model: model ?? null,
    tokens_est: tokensEst,
  });
}

export function sendMessage({ userId, title, body, link }) {
  tables.messages.insert({
    user_id: userId,
    title,
    body,
    link: link ?? null,
    is_read: 0,
  });
}

// compatibility alias
export const db = tables;
