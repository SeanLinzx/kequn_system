#!/bin/bash
# ============================================================
# camera-local-console · Linux 远程安装脚本（全自动）
# 用法（在门店 Linux 服务器上执行，需联网 + root/sudo）：
#   curl -fsSL <数据服务地址>/install/linux.sh | sudo bash -s -- <门店令牌> [数据服务地址]
# 示例：
#   curl -fsSL https://kequn.fenqunshuju.com/install/linux.sh | sudo bash -s -- abc123...
# 说明：
#   - 从数据服务地址的发布通道拉取最新 Linux 安装包（按架构 arm64/x64）
#   - 自动写入 serverUrl + token → 调 bootstrap 自动绑定门店 → 注册 systemd 自启
#   - 安装完成后控制台自动连后端，隧道自动上线，运维可从 Web 进入控制台
# ============================================================
set -euo pipefail

TOKEN="${1:-}"
SERVER_URL="${2:-https://kequn.fenqunshuju.com}"
SERVER_URL="${SERVER_URL%/}"

if [ -z "$TOKEN" ]; then
  echo "❌ 缺少门店令牌参数"
  echo "   用法: curl -fsSL ${SERVER_URL}/install/linux.sh | sudo bash -s -- <门店令牌> [数据服务地址]"
  echo "   门店令牌在 Web 管理面板「门店管理」或「品牌管理」中查看复制"
  exit 1
fi

INSTALL_DIR="${INSTALL_DIR:-/opt/camera-local-console}"
CHANNEL="${CHANNEL:-stable}"

echo "==> camera-local-console Linux 远程安装"
echo "    数据服务: $SERVER_URL  通道: $CHANNEL  安装目录: $INSTALL_DIR"

# ---------- 1. 识别架构 ----------
ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64) PLATFORM="linux-arm64" ;;
  x86_64|amd64)  PLATFORM="linux-x64" ;;
  *) echo "❌ 不支持的架构: $ARCH（仅支持 linux-arm64 / linux-x64）"; exit 1 ;;
esac
echo "    架构: $ARCH → 平台包: $PLATFORM"

# ---------- 2. 拉取发布通道 manifest ----------
MANIFEST_URL="${SERVER_URL}/releases/camera-local-console/channels/${CHANNEL}.json"
echo "==> 拉取发布清单: $MANIFEST_URL"
MANIFEST="$(curl -fsSL "$MANIFEST_URL")"
PACKAGE_URL="$(echo "$MANIFEST" | grep -o '"url"[^,]*' | head -1 | sed 's/.*"url"[[:space:]]*:[[:space:]]*"//;s/"$//')"
PACKAGE_SHA="$(echo "$MANIFEST" | grep -o '"sha256"[^,]*' | head -1 | sed 's/.*"sha256"[[:space:]]*:[[:space:]]*"//;s/"$//')"
# manifest.url 可能是相对路径（未配置 TUNNEL_PUBLIC_URL 时），拼接 SERVER_URL
case "$PACKAGE_URL" in
  http://*|https://*) ;;
  /*) PACKAGE_URL="${SERVER_URL}${PACKAGE_URL}" ;;
  *) PACKAGE_URL="${SERVER_URL}/releases/camera-local-console/packages/${PLATFORM}/$(basename "$PACKAGE_URL")" ;;
esac
VERSION="$(echo "$MANIFEST" | grep -o '"version"[^,]*' | head -1 | sed 's/.*"version"[[:space:]]*:[[:space:]]*"//;s/"$//')"
if [ -z "$PACKAGE_URL" ] || [ -z "$PACKAGE_SHA" ]; then
  echo "❌ 发布清单不完整（url/sha256 缺失），请先在发布管理台上传 ${PLATFORM} 安装包"
  exit 1
fi
echo "    版本: ${VERSION:-?}  包: $PACKAGE_URL"

# ---------- 3. 下载 + 校验 + 解压 ----------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PKG_FILE="${TMP}/package.tar.gz"
echo "==> 下载安装包..."
curl -fsSL -o "$PKG_FILE" "$PACKAGE_URL"
echo "    sha256 校验..."
echo "$PACKAGE_SHA  $PKG_FILE" | sha256sum -c - >/dev/null || { echo "❌ SHA256 校验失败，安装包可能损坏或下载不完整"; exit 1; }
mkdir -p "$INSTALL_DIR"
echo "==> 解压到 $INSTALL_DIR"
tar -xzf "$PKG_FILE" -C "$INSTALL_DIR" --strip-components=1

# ---------- 4. 写入配置（serverUrl + token） ----------
CONFIG_DIR="$INSTALL_DIR/data"
mkdir -p "$CONFIG_DIR"
if [ -f "$CONFIG_DIR/config.json" ]; then
  # 保留现有配置，仅覆盖 server 相关字段
  cp "$CONFIG_DIR/config.json" "$TMP/config.bak" || true
fi
node -e "
const fs = require('fs');
const p = process.argv[1];
const url = process.argv[2];
const token = process.argv[3];
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) {}
cfg.server = cfg.server || {};
cfg.server.serverUrl = url;
cfg.server.siteToken = token;
fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
" "$CONFIG_DIR/config.json" "$SERVER_URL" "$TOKEN" || {
  # node 不可用时用 shell 兜底（JSON 手工拼接）
  printf '{\n  "server": {\n    "serverUrl": "%s",\n    "siteToken": "%s"\n  }\n}\n' "$SERVER_URL" "$TOKEN" > "$CONFIG_DIR/config.json"
}
echo "==> 已写入 serverUrl + token"

# ---------- 5. 自动绑定门店（用 token 调 bootstrap） ----------
echo "==> 调 bootstrap 自动绑定门店..."
BOOTSTRAP="$(curl -fsSL -H "X-Access-Token: $TOKEN" "${SERVER_URL}/api/edge/bootstrap" || echo '')"
STORE_ID="$(echo "$BOOTSTRAP" | grep -o '"id"[[:space:]]*:[[:space:]]*[0-9]*' | head -1 | sed 's/.*:[[:space:]]*//' || true)"
STORE_NAME="$(echo "$BOOTSTRAP" | grep -o '"name"[^,]*' | head -1 | sed 's/.*"name"[[:space:]]*:[[:space:]]*"//;s/"$//' || true)"
if [ -n "$STORE_ID" ]; then
  node -e "
const fs = require('fs');
const p = process.argv[1]; const id = process.argv[2]; const name = process.argv[3];
const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
cfg.shop = { shopId: id, shopName: name };
fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
" "$CONFIG_DIR/config.json" "$STORE_ID" "$STORE_NAME" 2>/dev/null || true
  echo "    ✅ 已绑定门店: ${STORE_NAME:-$STORE_ID}"
else
  echo "    ⚠️ 未能自动绑定门店（品牌令牌需在控制台首次进入时选择门店）"
fi

# ---------- 6. 注册 systemd 服务 ----------
SERVICE="/etc/systemd/system/camera-local-console.service"
cat > "$SERVICE" <<EOF
[Unit]
Description=Camera Local Console (fenqun)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$(command -v node) src/server.js
Restart=always
RestartSec=5
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable camera-local-console
systemctl restart camera-local-console
echo "==> systemd 服务已注册并启动: camera-local-console"

# ---------- 7. SSH 反向隧道（A 方案：Web 终端运维） ----------
echo "==> 配置 SSH 反向隧道（Web 终端运维）..."
CONSOLE_ID="$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$CONFIG_DIR/config.json','utf8')).console?.id||'')}catch(e){console.log('')}" 2>/dev/null || echo '')"
SSH_SETUP="$(curl -fsSL -X POST -H "X-Access-Token: $TOKEN" -H "Content-Type: application/json" -d "{\"consoleId\":\"${CONSOLE_ID}\"}" "${SERVER_URL}/api/edge/ssh-setup" || echo '')"
SSH_PORT="$(echo "$SSH_SETUP" | grep -o '"sshPort"[^,]*' | head -1 | sed 's/.*:[[:space:]]*//;s/[^0-9]//g' || true)"
SSH_PUBKEY="$(echo "$SSH_SETUP" | grep -o '"publicKey"[^,]*' | head -1 | sed 's/.*"publicKey"[[:space:]]*:[[:space:]]*"//;s/"$//' | sed 's/\\\\n/\n/g' || true)"
GATEWAY_USER="$(echo "$SSH_SETUP" | grep -o '"gatewayUser"[^,]*' | head -1 | sed 's/.*"gatewayUser"[[:space:]]*:[[:space:]]*"//;s/"$//' || echo 'fenqun-tunnel')"
# 总部主机名：从数据服务地址提取纯 host（SSH 走 22 端口，不能带后端端口）
SERVER_HOST="$(echo "$SERVER_URL" | sed -E 's|^https?://([^/:]+).*|\1|')"

if [ -n "$SSH_PORT" ] && [ -n "$SSH_PUBKEY" ] && [ -n "$SERVER_HOST" ]; then
  # 7.1 安装 autossh（openssh-client 一般自带）
  if ! command -v autossh >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1; then apt-get update -y >/dev/null 2>&1; apt-get install -y autossh >/dev/null 2>&1 || true
    elif command -v yum >/dev/null 2>&1; then yum install -y autossh >/dev/null 2>&1 || true
    elif command -v apk >/dev/null 2>&1; then apk add autossh >/dev/null 2>&1 || true; fi
  fi
  command -v autossh >/dev/null 2>&1 || echo "    ⚠️ autossh 安装失败（可手动安装后重启服务）"
  # 7.2 总部→门店公钥加入 root 的 authorized_keys（Web 终端登录用）
  mkdir -p /root/.ssh && chmod 700 /root/.ssh
  if ! grep -qF "$(echo "$SSH_PUBKEY" | awk '{print $2}')" /root/.ssh/authorized_keys 2>/dev/null; then
    echo "$SSH_PUBKEY" >> /root/.ssh/authorized_keys
    chmod 600 /root/.ssh/authorized_keys
  fi
  # 7.3 sshd 允许 root 密钥登录（禁止密码，保证安全）
  if [ -f /etc/ssh/sshd_config ]; then
    sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
    grep -q '^PermitRootLogin' /etc/ssh/sshd_config || echo 'PermitRootLogin prohibit-password' >> /etc/ssh/sshd_config
    (systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || service ssh restart 2>/dev/null) || true
  fi
  # 7.4 生成门店→总部密钥（autossh 登录总部网关用户）
  GATEWAY_KEY="$INSTALL_DIR/data/tunnel_gateway_key"
  [ -f "$GATEWAY_KEY" ] || ssh-keygen -t ed25519 -f "$GATEWAY_KEY" -N "" -C "fenqun-${STORE_ID}" >/dev/null
  # 7.5 上报门店→总部公钥
  GATEWAY_PUB="$(cat "${GATEWAY_KEY}.pub")"
  curl -fsSL -X POST -H "X-Access-Token: $TOKEN" -H "Content-Type: application/json" \
    -d "{\"publicKey\":\"$(echo "$GATEWAY_PUB" | sed 's/"/\\"/g')\"}" "${SERVER_URL}/api/edge/ssh-pubkey" >/dev/null 2>&1 || true
  # 7.6 注册 autossh systemd 服务（断线自动重连）
  SSH_SERVICE="/etc/systemd/system/camera-local-console-ssh.service"
  cat > "$SSH_SERVICE" <<EOF
[Unit]
Description=Camera Local Console SSH Reverse Tunnel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$(command -v autossh) -M 0 -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -R 127.0.0.1:${SSH_PORT}:localhost:22 -i ${GATEWAY_KEY} ${GATEWAY_USER}@${SERVER_HOST}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable camera-local-console-ssh
  systemctl restart camera-local-console-ssh
  echo "    ✅ SSH 隧道已配置: ${GATEWAY_USER}@${SERVER_HOST} → 127.0.0.1:${SSH_PORT}（Web 终端使用）"
else
  echo "    ⚠️ SSH 隧道配置跳过（ssh-setup 未返回有效信息，检查网络/令牌）"
fi

# ---------- 8. 完成 ----------
sleep 3
echo ""
echo "============================================================"
echo " ✅ 安装完成"
echo "    控制台地址: http://$(hostname -I 2>/dev/null | awk '{print $1}') :3000（门店局域网）"
echo "    异地访问:  请到 Web 管理面板「控制台」Tab 点击「异地打开」"
echo "    SSH 运维:   管理面板「控制台」Tab → 「SSH 终端」（反向隧道 $([ -n "$SSH_PORT" ] && echo "已启用 :${SSH_PORT}" || echo "未启用")）"
echo "    门店:      ${STORE_NAME:-（首次进入控制台时确认门店）}"
echo "============================================================"
