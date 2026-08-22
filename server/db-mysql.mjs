// MySQL 连接池 + schema 初始化
// 配置来自环境变量（.env）：MYSQL_HOST/PORT/DATABASE/USER/PASSWORD
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { seedIfEmpty } from "./sql/seed.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const config = {
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3307),
  user: process.env.MYSQL_USER || "fenqun",
  password: process.env.MYSQL_PASSWORD || "fenqun-dev-2026",
  database: process.env.MYSQL_DATABASE || "fenqun",
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4",
  timezone: "+08:00",
};

export const pool = mysql.createPool(config);

/** 执行 schema.sql（幂等建表；多条语句需 multipleStatements 的独立连接） */
export async function runSchema() {
  const schema = readFileSync(join(__dirname, "sql", "schema.sql"), "utf8");
  const mysql2 = await import("mysql2/promise");
  const raw = await mysql2.createConnection({ ...config, multipleStatements: true });
  try {
    await raw.query("SET NAMES utf8mb4");
    await raw.query(schema);
  } finally {
    await raw.end();
  }
}

/** 启动初始化：建表 + seed（幂等） */
export async function initMysql() {
  await runSchema();
  const conn = await pool.getConnection();
  try {
    await seedIfEmpty(conn);
  } finally {
    conn.release();
  }
}

/** 连接探测（供 /api/health 使用） */
export async function pingMysql() {
  const conn = await pool.getConnection();
  try {
    await conn.query("SELECT 1");
  } finally {
    conn.release();
  }
}
