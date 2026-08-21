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
  const stores = [
    { id: "dadao-yintan", name: "长沙望城银杉路零食店", location: "长沙市望城区银杉路", is_real: 1, brand: "大道合" },
    { id: "mock-xiangjiang", name: "长沙湘江路零食店（模拟）", location: "长沙市天心区湘江中路", is_real: 0, brand: "大道合" },
    { id: "mock-meixi", name: "长沙梅溪湖零食店（模拟·待评估）", location: "长沙市岳麓区梅溪湖路", is_real: 0, brand: "大道合" },
    { id: "mock-lingdu-wuyi", name: "长沙五一广场零食店（模拟）", location: "长沙市五一广场", is_real: 0, brand: "零度严选" },
    { id: "mock-lingdu-nanzhan", name: "长沙高铁南站零食店（模拟）", location: "长沙市高铁南站", is_real: 0, brand: "零度严选" },
    { id: "mock-guomeijia-daxue", name: "长沙岳麓大学城零食店（模拟）", location: "长沙市岳麓大学城", is_real: 0, brand: "果美佳" },
  ];
  const defaultPrinter = process.env.YLY_DEFAULT_MACHINE_CODE || "4004904861";
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
  if (userIds["ops@fenqun.local"]) {
    bind(userIds["ops@fenqun.local"], "dadao-yintan");
    bind(userIds["ops@fenqun.local"], "mock-xiangjiang");
    bind(userIds["ops@fenqun.local"], "mock-meixi");
  }
  if (userIds["store@fenqun.local"]) {
    bind(userIds["store@fenqun.local"], "dadao-yintan");
  }
  if (userIds["exec@fenqun.local"]) {
    bind(userIds["exec@fenqun.local"], "dadao-yintan");
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
