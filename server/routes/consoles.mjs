// 控制台部署列表（管理面板一键跳转门店本地控制台）
import { Router } from "express";
import { pool } from "../db-mysql.mjs";
import { authMiddleware, canAccessStore, requireRole } from "../auth.mjs";
import { probeSsh } from "../services/ssh-tunnel.mjs";
import { getManifest } from "../services/releases.mjs";
import { tunnelDiagnostics } from "../services/tunnel-server.mjs";

const router = Router();
router.use(authMiddleware);

// 隧道诊断（仅超管，排查异地访问用）
router.get("/tunnel-diag", requireRole("super_admin"), (_req, res) => {
  res.json(tunnelDiagnostics());
});

router.get("/", async (req, res) => {
  const { brandId, storeId } = req.query;
  try {
    const isSuperAdmin = req.user.role === "super_admin";
    // 活跃隧道连接（内存态，权威）：port -> {storeId, token}
    const activeTunnels = new Map();
    try {
      const diag = tunnelDiagnostics();
      for (const c of diag.connections) {
        if (c.wsState === 1) activeTunnels.set(Number(c.storeId), { port: c.port, token: c.token });
      }
    } catch {}
    const [rows] = await pool.query(
      `SELECT c.id, c.store_id, c.console_id, c.name, c.ip_address, c.port, c.last_seen_at,
              c.tunnel_port, c.tunnel_token, c.tunnel_last_seen,
              c.ssh_port, c.ssh_last_seen, c.update_task,
              s.name AS store_name, s.code AS store_code, b.name AS brand_name
       FROM console_deployment c
       JOIN store s ON s.id = c.store_id
       LEFT JOIN brand b ON b.id = s.brand_id
       ${storeId ? "WHERE c.store_id = ?" : ""}
       ORDER BY c.last_seen_at DESC`,
      storeId ? [storeId] : [],
    );
    const now = Date.now();
    let consoles = rows;
    if (!isSuperAdmin) {
      const visible = [];
      for (const c of rows) {
        if (await canAccessStore(req.user.id, req.user.role, c.store_id)) visible.push(c);
      }
      consoles = visible;
    }
    if (brandId) consoles = consoles.filter((c) => String(c.brand_id) === String(brandId));
    // 隧道异地访问 URL：
    //   生产（TUNNEL_VIA_NGINX=1）：https://<域名>/tunnel/<port>/t/<token>/  ← nginx 443 统一入口，无需开隧道端口防火墙
    //   本地/直连：http://<host>:<port>/t/<token>/
    const tunnelBase = process.env.TUNNEL_PUBLIC_URL || `http://${req.hostname || "127.0.0.1"}`;
    const tunnelViaNginx = process.env.TUNNEL_VIA_NGINX === "1";
    // SSH 隧道在线探测（仅对有 ssh_port 的行）
    const sshStates = await Promise.all(
      consoles.filter((c) => c.ssh_port != null).map(async (c) => [c.store_id, await probeSsh(c.store_id)]),
    );
    const sshByStore = Object.fromEntries(sshStates);
    res.json({
      consoles: consoles.map((c) => {
        // 用活跃隧道连接的真实端口/token 覆盖 DB 记录（防止重连后漂移）
        const active = activeTunnels.get(Number(c.store_id));
        const activePort = active?.port ?? c.tunnel_port;
        const activeToken = active?.token ?? c.tunnel_token;
        const tunnelOnline = active != null;
        const tunnelUrl =
          activePort && activeToken
            ? tunnelViaNginx
              ? `${tunnelBase}/tunnel/${activePort}/t/${activeToken}/`
              : `${tunnelBase}:${activePort}/t/${activeToken}/`
            : null;
        const ssh = sshByStore[c.store_id] || { online: false, port: c.ssh_port };
        let updateTask = null;
        if (c.update_task) {
          try { updateTask = JSON.parse(c.update_task); } catch {}
        }
        return {
          id: c.id,
          storeId: c.store_id,
          storeName: c.store_name,
          storeCode: c.store_code,
          brandId: c.brand_id,
          brandName: c.brand_name,
          consoleId: c.console_id,
          name: c.name,
          ipAddress: c.ip_address,
          port: c.port,
          url: c.ip_address ? `http://${c.ip_address}:${c.port}` : null,
          tunnelUrl,
          tunnelOnline,
          sshPort: c.ssh_port,
          sshOnline: ssh.online,
          updateTask,
          lastSeenAt: c.last_seen_at,
          online: c.last_seen_at && now - new Date(c.last_seen_at).getTime() < 180000,
        };
      }),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 远程更新控制台（超管/品牌管理员；从发布管理选版本，写入更新任务，门店控制台自动执行）
router.post("/:storeId/update", async (req, res) => {
  const storeId = req.params.storeId;
  if (!["super_admin", "ops_manager"].includes(req.user.role)) {
    return res.status(403).json({ error: "无权限" });
  }
  if (!(await canAccessStore(req.user.id, req.user.role, storeId))) {
    return res.status(403).json({ error: "无权限" });
  }
  const { version, platform } = req.body || {};
  if (!version) return res.status(400).json({ error: "需要 version" });
  const manifest = getManifest(version, platform || "linux-arm64");
  if (!manifest) {
    return res.status(400).json({ error: `版本 ${version}/${platform || "linux-arm64"} 清单不存在，请先在发布管理上传` });
  }
  const task = {
    version,
    platform: manifest.platform,
    url: manifest.url,
    sha256: manifest.sha256,
    status: "pending",
    message: "已下发，等待控制台执行",
    requestedAt: new Date().toISOString(),
  };
  await pool.query("UPDATE console_deployment SET update_task = ? WHERE store_id = ?", [JSON.stringify(task), storeId]);
  res.json({ ok: true, task });
});

// 删除控制台记录（超管/品牌管理员；门店卸载后残留记录的手动清理）
router.delete("/:storeId", async (req, res) => {
  const storeId = req.params.storeId;
  if (!["super_admin", "ops_manager"].includes(req.user.role)) {
    return res.status(403).json({ error: "无权限" });
  }
  if (!(await canAccessStore(req.user.id, req.user.role, storeId))) {
    return res.status(403).json({ error: "无权限" });
  }
  try {
    const [result] = await pool.query("DELETE FROM console_deployment WHERE store_id = ?", [storeId]);
    res.json({ ok: true, removed: result.affectedRows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
