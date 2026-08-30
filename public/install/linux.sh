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

# timeout 兜底：精简系统可能没有 timeout 命令，退化为直接执行
if ! command -v timeout >/dev/null 2>&1; then
  timeout() { "$@"; }
fi

# 步骤计时器：step_begin <n> <名称> / step_done <n> <名称> —— 每步显示耗时，现场可判断是否正常
__STEP_T0=""
step_begin() { # step_begin <编号> <名称>
  __STEP_T0="$(date +%s)"
  echo ""
  echo "━━━ [$1/9] $2 ━━━"
}
step_done() { # step_done <编号> <名称>
  local t1="$(date +%s)"
  local cost=$(( t1 - __STEP_T0 ))
  echo "     ✔ $2 完成（${cost}s）"
}
step_hint() { echo "     ⏳ $*（正常，请等待）"; }

echo "==> camera-local-console Linux 远程安装"
echo "    数据服务: $SERVER_URL  通道: $CHANNEL  安装目录: $INSTALL_DIR"
echo "    全程约 2-5 分钟（含 Node 下载/安装包下载），网络慢时请耐心等待进度条"
echo ""

# ---------- 1. 识别架构 ----------
step_begin 1 "识别架构"
ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64) PLATFORM="linux-arm64" ;;
  x86_64|amd64)  PLATFORM="linux-x64" ;;
  *) echo "❌ 不支持的架构: $ARCH（仅支持 linux-arm64 / linux-x64）"; exit 1 ;;
esac
echo "    架构: $ARCH → 平台包: $PLATFORM"
step_done 1 "识别架构"

# ---------- 2. 检测/安装 Node.js（控制台运行依赖） ----------
step_begin 2 "检测/安装 Node.js"
NODE_BIN="$(command -v node 2>/dev/null || echo '')"
NODE_VER=""
if [ -n "$NODE_BIN" ]; then NODE_VER="$(node -v 2>/dev/null || echo '')"; fi
need_node_install=0
if [ -z "$NODE_VER" ]; then
  need_node_install=1
else
  # 版本号如 v22.14.0 → 主版本 22（控制台隧道客户端需要 Node >= 22 的全局 WebSocket）
  NODE_MAJOR="$(echo "$NODE_VER" | sed 's/^v//;s/\..*//')"
  [ "${NODE_MAJOR:-0}" -lt 22 ] && need_node_install=1
fi

if [ "$need_node_install" = "1" ]; then
  echo "==> 检测到 Node 缺失或版本过低（$NODE_VER），自动安装 Node.js 22（隧道需要 ≥22）..."
  case "$PLATFORM" in
    linux-arm64)
      NODE_TARBALL="node-v22.14.0-linux-arm64"
      ;;
    linux-x64)
      NODE_TARBALL="node-v22.14.0-linux-x64"
      ;;
  esac
  NODE_DIST="/usr/local/lib/nodejs"
  if [ ! -x "$NODE_DIST/$NODE_TARBALL/bin/node" ]; then
    echo "==> 下载 Node.js 22（$PLATFORM，约 30MB）..."
    mkdir -p "$NODE_DIST" /tmp/node-install
    # 依次尝试官方源与国内镜像（--progress-bar 显示进度；--max-time 防无限卡住）
    for base in "https://nodejs.org/dist/v22.14.0" "https://npmmirror.com/mirrors/node/v22.14.0"; do
      echo "    下载源: $base"
      if curl -fsSL --connect-timeout 15 --max-time 600 --progress-bar -o "/tmp/node-install/$NODE_TARBALL.tar.xz" "$base/$NODE_TARBALL.tar.xz"; then
        break
      fi
      echo "    源 $base 失败，换下一个..."
    done
    tar -xJf "/tmp/node-install/$NODE_TARBALL.tar.xz" -C "$NODE_DIST"
  fi
  NODE_BIN="$NODE_DIST/$NODE_TARBALL/bin/node"
  # 软链到 /usr/local/bin（PATH 通常包含）
  ln -sf "$NODE_BIN" /usr/local/bin/node
  ln -sf "$NODE_DIST/$NODE_TARBALL/bin/npm" /usr/local/bin/npm
  ln -sf "$NODE_DIST/$NODE_TARBALL/bin/npx" /usr/local/bin/npx 2>/dev/null || true
  hash -r
  NODE_BIN="/usr/local/bin/node"
  echo "==> Node 安装完成: $(node -v 2>/dev/null || echo "$NODE_BIN")"
fi

echo "    使用 node: $NODE_BIN"
step_done 2 "检测/安装 Node.js"

# ---------- 3. 拉取发布通道 manifest ----------
step_begin 3 "拉取发布清单"
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
step_done 3 "拉取发布清单"

# ---------- 4. 下载 + 校验 + 解压 ----------
step_begin 4 "下载安装包"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PKG_FILE="${TMP}/package.tar.gz"
echo "==> 下载安装包..."
curl -fsSL --max-time 600 --progress-bar -o "$PKG_FILE" "$PACKAGE_URL"
echo "    sha256 校验..."
echo "$PACKAGE_SHA  $PKG_FILE" | sha256sum -c - >/dev/null || { echo "❌ SHA256 校验失败，安装包可能损坏或下载不完整"; exit 1; }
mkdir -p "$INSTALL_DIR"
echo "==> 解压到 $INSTALL_DIR"
tar -xzf "$PKG_FILE" -C "$INSTALL_DIR" --strip-components=1
step_done 4 "下载安装包"

# ---------- 5. 写入配置（serverUrl + token） ----------
step_begin 5 "写入配置"
CONFIG_DIR="$INSTALL_DIR/data"
mkdir -p "$CONFIG_DIR"
if [ -f "$CONFIG_DIR/config.json" ]; then
  # 保留现有配置，仅覆盖 server 相关字段
  cp "$CONFIG_DIR/config.json" "$TMP/config.bak" || true
fi
"$NODE_BIN" -e "
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
step_done 5 "写入配置"

# ---------- 6. 自动绑定门店（用 token 调 bootstrap） ----------
step_begin 6 "自动绑定门店"
echo "==> 调 bootstrap 自动绑定门店..."
BOOTSTRAP="$(curl -fsSL -H "X-Access-Token: $TOKEN" "${SERVER_URL}/api/edge/bootstrap" || echo '')"
# 用 node 解析（grep 取第一个 id 会误取 token.id，而非 store.id）
STORE_ID="$("$NODE_BIN" -e "
try {
  const b = JSON.parse(process.argv[1]);
  // 门店令牌：token.storeId；品牌令牌：取第一家有 bound=false 的门店
  const id = b.token?.storeId != null ? b.token.storeId : (b.stores || []).find(s => s.bound === false)?.id ?? (b.stores || [])[0]?.id ?? null;
  process.stdout.write(String(id ?? ''));
} catch (e) { process.stdout.write(''); }
" "$BOOTSTRAP" 2>/dev/null || true)"
STORE_NAME="$("$NODE_BIN" -e "
try {
  const b = JSON.parse(process.argv[1]);
  const id = b.token?.storeId != null ? b.token.storeId : null;
  const s = (b.stores || []).find(x => x.id === id) || (b.stores || [])[0];
  process.stdout.write(s?.name ?? '');
} catch (e) { process.stdout.write(''); }
" "$BOOTSTRAP" 2>/dev/null || true)"
if [ -n "$STORE_ID" ]; then
  "$NODE_BIN" -e "
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
step_done 6 "自动绑定门店"

# ---------- 7. 注册 systemd 服务 ----------
step_begin 7 "注册 systemd 服务"
# NODE_BIN 已在前面「检测/安装 Node.js」段确定（绝对路径，systemd 需要）
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "❌ 未找到 node，无法启动控制台（前面自动安装失败）"
  exit 1
fi
echo "==> 使用 node: $NODE_BIN"
SERVICE="/etc/systemd/system/camera-local-console.service"
cat > "$SERVICE" <<EOF
[Unit]
Description=Camera Local Console (fenqun)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_BIN src/server.js
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
step_done 7 "注册 systemd 服务"

# ---------- 8. SSH 反向隧道（A 方案：Web 终端运维） ----------
step_begin 8 "配置 SSH 反向隧道"
echo "==> 配置 SSH 反向隧道（Web 终端运维）..."
CONSOLE_ID="$("$NODE_BIN" -e "try{console.log(JSON.parse(require('fs').readFileSync('$CONFIG_DIR/config.json','utf8')).console?.id||'')}catch(e){console.log('')}" 2>/dev/null || echo '')"
SSH_SETUP="$(curl -fsSL -X POST -H "X-Access-Token: $TOKEN" -H "Content-Type: application/json" -d "{\"consoleId\":\"${CONSOLE_ID}\"}" "${SERVER_URL}/api/edge/ssh-setup" || echo '')"
SSH_PORT="$(echo "$SSH_SETUP" | grep -o '"sshPort"[^,]*' | head -1 | sed 's/.*:[[:space:]]*//;s/[^0-9]//g' || true)"
SSH_PUBKEY="$(echo "$SSH_SETUP" | grep -o '"publicKey"[^,]*' | head -1 | sed 's/.*"publicKey"[[:space:]]*:[[:space:]]*"//;s/"$//' | sed 's/\\\\n/\n/g' || true)"
GATEWAY_USER="$(echo "$SSH_SETUP" | grep -o '"gatewayUser"[^,]*' | head -1 | sed 's/.*"gatewayUser"[[:space:]]*:[[:space:]]*"//;s/"$//' || echo 'fenqun-tunnel')"
# 总部主机名：从数据服务地址提取纯 host（SSH 走 22 端口，不能带后端端口）
SERVER_HOST="$(echo "$SERVER_URL" | sed -E 's|^https?://([^/:]+).*|\1|')"

if [ -n "$SSH_PORT" ] && [ -n "$SSH_PUBKEY" ] && [ -n "$SERVER_HOST" ]; then
  # 7.1 安装 autossh（openssh-client 一般自带；超时 + 显示输出，避免 apt 卡死）
  if ! command -v autossh >/dev/null 2>&1; then
    echo "    autossh 未安装，尝试安装（最多 90s）..."
    if command -v apt-get >/dev/null 2>&1; then
      timeout 90 apt-get update -y 2>&1 | tail -2 || echo "    ⚠️ apt update 超时/失败（跳过）"
      timeout 90 apt-get install -y autossh 2>&1 | tail -3 || echo "    ⚠️ autossh 安装失败（可手动安装后重启服务）"
    elif command -v yum >/dev/null 2>&1; then timeout 90 yum install -y autossh 2>&1 | tail -3 || true
    elif command -v apk >/dev/null 2>&1; then timeout 90 apk add autossh 2>&1 | tail -3 || true; fi
  fi
  command -v autossh >/dev/null 2>&1 || echo "    ⚠️ autossh 不可用（SSH 隧道将暂不生效，可手动安装 autossh 后重启 camera-local-console-ssh）"
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
  if [ ! -f "$GATEWAY_KEY" ]; then
    echo "    生成隧道密钥..."
    timeout 30 ssh-keygen -t ed25519 -f "$GATEWAY_KEY" -N "" -C "fenqun-${STORE_ID}" >/dev/null 2>&1 || {
      echo "    ⚠️ 密钥生成失败（跳过 SSH 隧道）"
      SSH_PUBKEY=""
    }
  fi
  # 7.5 上报门店→总部公钥
  GATEWAY_PUB="$(cat "${GATEWAY_KEY}.pub")"
  curl -fsSL -X POST -H "X-Access-Token: $TOKEN" -H "Content-Type: application/json" \
    -d "{\"publicKey\":\"$(echo "$GATEWAY_PUB" | sed 's/"/\\"/g')\"}" "${SERVER_URL}/api/edge/ssh-pubkey" >/dev/null 2>&1 || true
  # 7.6 注册 autossh systemd 服务（断线自动重连；autossh 不可用时跳过，避免坏服务文件）
  AUTOSSH_BIN="$(command -v autossh 2>/dev/null || echo '')"
  if [ -n "$AUTOSSH_BIN" ]; then
    SSH_SERVICE="/etc/systemd/system/camera-local-console-ssh.service"
    cat > "$SSH_SERVICE" <<EOF
[Unit]
Description=Camera Local Console SSH Reverse Tunnel
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=$AUTOSSH_BIN -M 0 -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -R 127.0.0.1:${SSH_PORT}:localhost:22 -i ${GATEWAY_KEY} ${GATEWAY_USER}@${SERVER_HOST}
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
    echo "    ⚠️ autossh 未安装，SSH 隧道服务跳过（不影响控制台/异地访问）"
  fi
else
  echo "    ⚠️ SSH 隧道配置跳过（ssh-setup 未返回有效信息，检查网络/令牌）"
fi
step_done 8 "配置 SSH 反向隧道"

# ---------- 9. 完成 ----------
step_begin 9 "完成"
sleep 3
echo ""
echo "============================================================"
echo " ✅ 安装完成"
echo "    控制台地址: http://$(hostname -I 2>/dev/null | awk '{print $1}') :3000（门店局域网）"
echo "    异地访问:  请到 Web 管理面板「控制台」Tab 点击「异地打开」"
echo "    SSH 运维:   管理面板「控制台」Tab → 「SSH 终端」（反向隧道 $([ -n "$SSH_PORT" ] && echo "已启用 :${SSH_PORT}" || echo "未启用")）"
echo "    门店:      ${STORE_NAME:-（首次进入控制台时确认门店）}"
echo "============================================================"
step_done 9 "安装"

exit 0
