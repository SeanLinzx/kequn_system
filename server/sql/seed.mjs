// 客群数据系统 · 演示数据 seed（幂等：各表为空时才插入）
// 用法：由 db-mysql.mjs 的 initMysql() 在启动时调用 seedIfEmpty(conn)
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

function newToken() {
  return randomBytes(24).toString("hex");
}

// 生产 seed：仅保留 demo（演示）与 test（测试）两个品牌，不生成伪造客流/人体数据
// （伪造演示数据由 scripts/seed-demo-data.mjs 生成，仅本地演示使用，生产环境不要执行）
const DEMO_BRANDS = [
  { code: "demo", name: "演示品牌" },
  { code: "test", name: "测试品牌" },
];

const DEMO_STORES = [
  { code: "demo-store", name: "演示门店", brand: "demo", location: "演示地址", hours: "08:00-22:00" },
  { code: "test-store", name: "测试门店", brand: "test", location: "测试地址", hours: "08:00-22:00" },
];

const DEMO_USERS = [
  { email: "admin@fenqun.local", pass: "Admin@2026", name: "超级管理员", role: "super_admin", stores: [] },
  { email: "ops@fenqun.local", pass: "Ops@2026", name: "品牌管理员", role: "ops_manager", stores: ["demo-store", "test-store"] },
  { email: "store@fenqun.local", pass: "Store@2026", name: "门店管理员", role: "store_manager", stores: ["demo-store"] },
  { email: "exec@fenqun.local", pass: "Exec@2026", name: "门店执行者", role: "executor", stores: ["demo-store"] },
];

const HUMAN_TAGS = [
  { id: 1, code: "housewife", name: "家庭主妇", ruleVersion: 1 },
  { id: 2, code: "retired", name: "退休老人", ruleVersion: 1 },
  { id: 3, code: "young_mid", name: "中青年", ruleVersion: 1 },
  { id: 4, code: "office", name: "上班族", ruleVersion: 1 },
  { id: 5, code: "student", name: "学生", ruleVersion: 1 },
];

export async function seedIfEmpty(conn) {
  const [brandRows] = await conn.query("SELECT COUNT(*) AS c FROM brand");
  if (brandRows[0].c === 0) {
    for (const b of DEMO_BRANDS) {
      const [result] = await conn.query("INSERT INTO brand (code, name) VALUES (?, ?)", [b.code, b.name]);
      await conn.query("INSERT INTO site_token (token, name, brand_id) VALUES (?, ?, ?)", [
        newToken(), `${b.name}品牌令牌`, result.insertId,
      ]);
    }
  }

  const [storeRows] = await conn.query("SELECT COUNT(*) AS c FROM store");
  if (storeRows[0].c === 0) {
    const [brands] = await conn.query("SELECT id, code FROM brand");
    const brandIdByCode = Object.fromEntries(brands.map((b) => [b.code, b.id]));
    for (const s of DEMO_STORES) {
      const [result] = await conn.query(
        "INSERT INTO store (code, name, brand_id, location, business_hours, is_demo) VALUES (?, ?, ?, ?, ?, 1)",
        [s.code, s.name, brandIdByCode[s.brand] ?? null, s.location, s.hours],
      );
      await conn.query("INSERT INTO site_token (token, name, store_id) VALUES (?, ?, ?)", [
        newToken(), `${s.name}门店令牌`, result.insertId,
      ]);
    }
  }

  const [tagRows] = await conn.query("SELECT COUNT(*) AS c FROM human_tag");
  if (tagRows[0].c === 0) {
    for (const t of HUMAN_TAGS) {
      await conn.query("INSERT INTO human_tag (id, code, name, rule_version) VALUES (?, ?, ?, ?)", [
        t.id, t.code, t.name, t.ruleVersion,
      ]);
    }
  }

  const [userRows] = await conn.query("SELECT COUNT(*) AS c FROM sys_user");
  if (userRows[0].c === 0) {
    const [stores] = await conn.query("SELECT id, code FROM store");
    const codeById = Object.fromEntries(stores.map((s) => [s.code, s.id]));
    for (const u of DEMO_USERS) {
      const passwordHash = bcrypt.hashSync(u.pass, 10);
      const [result] = await conn.query(
        "INSERT INTO sys_user (email, password_hash, name, role) VALUES (?, ?, ?, ?)",
        [u.email, passwordHash, u.name, u.role],
      );
      const userId = result.insertId;
      for (const storeCode of u.stores) {
        const storeId = codeById[storeCode];
        if (storeId != null) {
          await conn.query("INSERT IGNORE INTO sys_user_store (user_id, store_id) VALUES (?, ?)", [userId, storeId]);
        }
      }
    }
  }
}
