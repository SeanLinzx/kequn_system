#!/usr/bin/env bash
# ============================================================
# 客群数据系统 · 服务器一键部署脚本（Ubuntu 22.04 / Debian 12）
# 用法（root 或 sudo）：
#   sudo bash install-server.sh [域名] [Git仓库地址] [分支]
# 示例：
#   sudo bash install-server.sh kequn.fenqunshuju.com https://github.com/SeanLinzx/kequn_system.git main
# 说明：
#   1. 安装 Docker + Compose 插件 + nginx + Node 22
#   2. 拉取代码到 /opt/fenqun/kequn_system，生成 .env（强密码）
#   3. 启动 MySQL(Docker) → 安装依赖 → 注册 systemd 服务（后端 3011）
#   4. 创建 fenqun-tunnel 隧道网关用户 + sshd 配置（Web SSH 终端用）
#   5. 生成 nginx 配置（80→443 跳转 + 443 反代 + WS + 隧道端口 TLS 转发）
#   证书放置与 nginx 启用由你手动完成（见脚本末尾提示）
# ============================================================
set -euo pipefail

DOMAIN="${1:-kequn.fenqunshuju.com}"
GIT_URL="${2:-https://github.com/SeanLinzx/kequn_system.git}"
BRANCH="${3:-main}"
APP_DIR=/opt/fenqun/kequn_system
SSL_DIR=/etc/nginx/ssl

log()  { echo -e "\033[1;32m==>\033[0m $*"; }
warn() { echo -e "\033[1;33m!!>\033[0m $*"; }
die()  { echo -e "\033[1;31m[错误]\033[0m $*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "请用 root 或 sudo 运行：sudo bash install-server.sh"

log "开始部署：域名=$DOMAIN  仓库=$GIT_URL  分支=$BRANCH"

# ---------- 0. 识别包管理器（支持 Debian/Ubuntu 与 RHEL/CentOS/Rocky/Alibaba 等） ----------
if command -v apt-get >/dev/null 2>&1; then
  PM=apt
elif command -v dnf >/dev/null 2>&1; then
  PM=dnf
elif command -v yum >/dev/null 2>&1; then
  PM=yum
else
  die "未识别包管理器（需要 apt-get / dnf / yum 之一）"
fi
log "包管理器: $PM"

pm_install() { # pm_install <pkg...>
  case "$PM" in
    apt) DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" ;;
    dnf) dnf install -y "$@" ;;
    yum) yum install -y "$@" ;;
  esac
}

# ---------- 1. 系统依赖 ----------
if ! command -v curl >/dev/null 2>&1; then
  log "安装 curl"
  pm_install curl
fi
if ! command -v git >/dev/null 2>&1; then
  log "安装 git"
  pm_install git
fi
if ! command -v openssl >/dev/null 2>&1; then
  log "安装 openssl"
  pm_install openssl
fi

# ---------- Docker：真 Docker CE + compose 插件 ----------
# 注意：Alibaba Linux / CentOS 预装的是 podman（docker 命令被模拟），compose 是 podman-compose，
# 与 docker-compose.yml 的 healthcheck 等语法不兼容，必须装真正的 Docker CE。
NEED_DOCKER=0
if ! command -v docker >/dev/null 2>&1; then
  NEED_DOCKER=1
elif docker --version 2>/dev/null | grep -qi "podman"; then
  log "检测到 docker 命令由 podman 模拟，将安装真正的 Docker CE"
  NEED_DOCKER=1
elif ! docker compose version >/dev/null 2>&1; then
  log "docker compose 插件不可用，将安装 Docker CE + compose 插件"
  NEED_DOCKER=1
fi

if [ "$NEED_DOCKER" = "1" ]; then
  case "$PM" in
    apt)
      log "安装 Docker + Compose 插件（官方脚本）"
      curl -fsSL https://get.docker.com | sh
      ;;
    dnf|yum)
      log "安装 Docker CE + compose 插件（阿里云镜像源）"
      "$PM" install -y yum-utils
      # alinux/centos 兼容源：阿里云国内快，失败回退官方
      if ! "$PM" config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo 2>/dev/null \
         && ! yum-config-manager --add-repo https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo 2>/dev/null; then
        "$PM" config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
      fi
      # alinux $releasever 不是 centos 版本号，强制用 8（alinux3 兼容 el8）
      sed -i 's|\$releasever|8|g' /etc/yum.repos.d/docker-ce.repo 2>/dev/null || true
      "$PM" install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
      ;;
  esac
  systemctl enable --now docker
  sleep 2
fi
docker compose version >/dev/null 2>&1 || die "docker compose 插件不可用，请手动安装 docker-compose-plugin 后重试"

if ! command -v nginx >/dev/null 2>&1; then
  log "安装 nginx"
  case "$PM" in
    apt) pm_install nginx ;;
    dnf) dnf install -y nginx 2>/dev/null || { dnf install -y epel-release && dnf install -y nginx; } ;;
    yum) yum install -y epel-release && yum install -y nginx ;;
  esac
fi

# Node ≥ 20 即可（后端用 ws 库 + ESM；全局 WebSocket 仅门店控制台需要，服务器不跑）
if ! command -v node >/dev/null 2>&1 || [ "$(node -v 2>/dev/null | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  log "安装 Node.js 22（NodeSource）"
  case "$PM" in
    apt)
      curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
      pm_install nodejs
      ;;
    dnf|yum)
      curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
      "$PM" install -y nodejs
      ;;
  esac
fi
log "Node: $(node -v)  npm: $(npm -v)"

# ---------- 2. 拉取代码 ----------
mkdir -p /opt/fenqun
if [ ! -d "$APP_DIR/.git" ]; then
  log "克隆仓库到 $APP_DIR"
  git clone --branch "$BRANCH" "$GIT_URL" "$APP_DIR"
else
  log "更新已有仓库（分支 $BRANCH）"
  cd "$APP_DIR"
  git fetch origin
  git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" origin/"$BRANCH"
  git pull --ff-only origin "$BRANCH"
fi
cd "$APP_DIR"

# ---------- 3. 生成 .env（存在则保留） ----------
if [ ! -f "$APP_DIR/.env" ]; then
  log "生成 .env（强密码）"
  JWT=$(openssl rand -hex 32)
  MYSQL_PWD=$(openssl rand -hex 16)
  MYSQL_ROOT=$(openssl rand -hex 16)
  cp .env.example .env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT}|" .env
  sed -i "s|^MYSQL_PASSWORD=.*|MYSQL_PASSWORD=${MYSQL_PWD}|" .env
  sed -i "s|^MYSQL_ROOT_PASSWORD=.*|MYSQL_ROOT_PASSWORD=${MYSQL_ROOT}|" .env
  sed -i "s|^TUNNEL_PUBLIC_URL=.*|TUNNEL_PUBLIC_URL=https://${DOMAIN}|" .env
else
  log ".env 已存在，跳过生成（如需重置请删除 $APP_DIR/.env 后重跑）"
fi

# ---------- 4. 启动 MySQL（Docker） ----------
log "启动 MySQL 容器（首次拉镜像可能需要几分钟）"
docker compose up -d
for i in $(seq 1 60); do
  if docker compose ps mysql 2>/dev/null | grep -q healthy; then
    log "MySQL healthy"; break
  fi
  [ "$i" = "60" ] && die "MySQL 60s 内未就绪，请 docker compose logs mysql 排查"
  sleep 2
done

# ---------- 5. 安装后端依赖 ----------
log "安装后端依赖（npm install --omit=dev）"
cd "$APP_DIR/server"
npm install --omit=dev --no-audit --no-fund

# ---------- 6. 注册 systemd 服务 ----------
log "注册 systemd 服务 fenqun-system"
cat > /etc/systemd/system/fenqun-system.service <<EOF
[Unit]
Description=Fenqun Customer System Backend
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${APP_DIR}/server
ExecStart=$(command -v node) index.mjs
Restart=always
RestartSec=5
EnvironmentFile=${APP_DIR}/.env

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now fenqun-system
sleep 3
systemctl is-active fenqun-system >/dev/null || die "fenqun-system 启动失败，journalctl -u fenqun-system -n 50 排查"

log "后端健康检查：$(curl -s http://127.0.0.1:3011/api/health)"

# ---------- 7. SSH 隧道网关用户（Web SSH 终端） ----------
if ! id fenqun-tunnel >/dev/null 2>&1; then
  log "创建 fenqun-tunnel 隧道网关用户"
  useradd -m -s /bin/bash fenqun-tunnel
  mkdir -p /home/fenqun-tunnel/.ssh
  touch /home/fenqun-tunnel/.ssh/authorized_keys
  chown -R fenqun-tunnel:fenqun-tunnel /home/fenqun-tunnel/.ssh
  chmod 700 /home/fenqun-tunnel/.ssh
  chmod 600 /home/fenqun-tunnel/.ssh/authorized_keys
  passwd -l fenqun-tunnel
fi
if ! grep -q "Match User fenqun-tunnel" /etc/ssh/sshd_config; then
  log "配置 sshd（fenqun-tunnel 仅密钥端口转发）"
  cat >> /etc/ssh/sshd_config <<'EOF'
# fenqun 隧道网关（autossh -N 纯端口转发，仅密钥认证）
Match User fenqun-tunnel
    AllowTcpForwarding yes
    GatewayPorts no
    PermitTTY no
    X11Forwarding no
    PasswordAuthentication no
EOF
  # Ubuntu 服务名 ssh，RHEL 系服务名 sshd
  if systemctl list-unit-files 2>/dev/null | grep -q '^ssh\.service'; then
    systemctl restart ssh
  else
    systemctl restart sshd
  fi
fi

# ---------- 8. 生成 nginx 配置（证书放置与启用见提示） ----------
log "生成 nginx 配置 /etc/nginx/conf.d/${DOMAIN}.conf"
mkdir -p "$SSL_DIR"
if [ -f "$APP_DIR/deploy/nginx-kequn.fenqunshuju.com.conf" ]; then
  cp "$APP_DIR/deploy/nginx-kequn.fenqunshuju.com.conf" "/etc/nginx/conf.d/${DOMAIN}.conf"
  sed -i "s/kequn\.fenqunshuju\.com/${DOMAIN}/g" "/etc/nginx/conf.d/${DOMAIN}.conf"
else
  warn "未找到 nginx 配置模板，请参考 docs/部署指南.md 手动编写"
fi

# ---------- 完成 ----------
log "================ 部署完成 ================"
echo ""
echo "  网站地址:    https://${DOMAIN}"
echo "  后端健康:    http://127.0.0.1:3011/api/health"
echo "  后端目录:    ${APP_DIR}"
echo "  .env 文件:   ${APP_DIR}/.env（内含 MySQL 密码，请妥善保存）"
echo ""
echo "  默认账号（首次登录后请修改密码）："
echo "    超级管理员  admin@fenqun.local / Admin@2026"
echo "    品牌管理员  ops@fenqun.local   / Ops@2026"
echo "    门店管理员  store@fenqun.local / Store@2026"
echo "    门店执行者  exec@fenqun.local  / Exec@2026"
echo ""
echo "  剩余手动步骤（SSL 证书 + nginx 启用）："
echo "  1) 将证书 zip 解压出的 .pem/.key 放到 ${SSL_DIR}/"
echo "     cp ${DOMAIN}.pem ${SSL_DIR}/ && cp ${DOMAIN}.key ${SSL_DIR}/ && chmod 600 ${SSL_DIR}/${DOMAIN}.key"
echo "  2) 校验并启用 nginx："
echo "     nginx -t && systemctl reload nginx"
echo "  3) 放行防火墙：22、80、443、31000-31999"
echo ""
echo "  门店 Linux 一键安装命令（用管理面板中的门店令牌替换 <门店token>）："
echo "    curl -fsSL https://${DOMAIN}/install/linux.sh | sudo bash -s -- <门店token> https://${DOMAIN}"
echo ""
