// M1 验收脚本：建表 + seed 检查
// 用法：node scripts/check-mysql.mjs（需 MySQL 容器已启动）
import "../load-env.mjs";
import { initMysql, pool } from "../db-mysql.mjs";

const TABLES = [
  "sys_user", "sys_user_store", "brand", "store", "site_token",
  "camera_device", "camera_raw_event", "camera_people_flow",
  "camera_human_body", "human_tag",
];

try {
  await initMysql();
  const [tables] = await pool.query("SHOW TABLES");
  const names = tables.map((r) => Object.values(r)[0]);
  console.log("== tables ==");
  for (const t of TABLES) {
    console.log(`  ${names.includes(t) ? "OK " : "MISSING"} ${t}`);
  }
  console.log("== seed counts ==");
  for (const t of ["brand", "store", "human_tag", "sys_user", "sys_user_store"]) {
    const [rows] = await pool.query(`SELECT COUNT(*) AS c FROM ${t}`);
    console.log(`  ${t}: ${rows[0].c}`);
  }
  const [users] = await pool.query("SELECT email, name, role FROM sys_user ORDER BY id");
  for (const u of users) console.log(`  user: ${u.email} (${u.name}, ${u.role})`);
  const [stores] = await pool.query(
    "SELECT s.code, s.name, b.name AS brand FROM store s LEFT JOIN brand b ON b.id = s.brand_id ORDER BY s.id",
  );
  for (const s of stores) console.log(`  store: ${s.code} | ${s.name} | ${s.brand || "-"}`);
  console.log("== M1 OK ==");
} catch (e) {
  console.error("M1 check failed:", e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
