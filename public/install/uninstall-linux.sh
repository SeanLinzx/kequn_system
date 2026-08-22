#!/bin/bash
# ============================================================
# camera-local-console · Linux 卸载脚本（全自动，干净卸载）
# 用法（在门店 Linux 服务器上执行，需 root/sudo）：
#   curl -fsSL <数据服务地址>/install/uninstall-linux.sh | sudo bash
# 说明：
#   - 停止并禁用控制台服务 + SSH 反向隧道服务
#   - 删除 systemd 服务文件、安装目录（/opt/camera-local-console）
#   - 可选：清理总部 authorized_keys 中的门店公钥（--clean-gateway）
#   - 保留/删除 data 目录由参数控制（默认删除，--keep-data 保留）
# ============================================================
set -euo pipefail

# 参数
KEEP_DATA=0
CLEAN_GATEWAY=0
for arg in "$@"; do
  case "$arg" in
    --keep-data) KEEP_DATA=1 ;;
    --clean-gateway) CLEAN_GATEWAY=1 ;;
  esac
done

INSTALL_DIR="${INSTALL_DIR:-/opt/camera-local-console}"
CONSOLE_SVC="camera-local-console"
SSH_SVC="camera-local-console-ssh"

echo "==> camera-local-console 卸载"
echo "    安装目录: $INSTALL_DIR  保留数据: $([ "$KEEP_DATA" = 1 ] && echo 是 || echo 否)"

# ---------- 1. 停止并禁用服务 ----------
echo "==> 停止并禁用服务..."
for svc in "$SSH_SVC" "$CONSOLE_SVC"; do
  if systemctl list-unit-files 2>/dev/null | grep -q "^${svc}\.service"; then
    systemctl stop "$svc" 2>/dev/null || true
    systemctl disable "$svc" 2>/dev/null || true
    echo "    已停止/禁用: $svc"
  fi
done
systemctl daemon-reload

# ---------- 2. 删除 systemd 服务文件 ----------
echo "==> 删除 systemd 服务文件..."
rm -f "/etc/systemd/system/${CONSOLE_SVC}.service"
rm -f "/etc/systemd/system/${SSH_SVC}.service"
systemctl daemon-reload 2>/dev/null || true

# ---------- 3. 删除安装目录 ----------
echo "==> 删除安装目录 $INSTALL_DIR ..."
# 先记录门店网关公钥指纹（供总部清理用），再删目录
GATEWAY_FINGERPRINT=""
if [ -f "$INSTALL_DIR/data/tunnel_gateway_key.pub" ]; then
  GATEWAY_FINGERPRINT="$(awk '{print $2}' "$INSTALL_DIR/data/tunnel_gateway_key.pub" 2>/dev/null || echo '')"
fi
if [ "$KEEP_DATA" = 1 ] && [ -d "$INSTALL_DIR/data" ]; then
  # 保留数据：先移出
  mkdir -p /tmp/camera-local-console-data-backup
  cp -r "$INSTALL_DIR/data/." /tmp/camera-local-console-data-backup/ 2>/dev/null || true
  echo "    数据已备份到 /tmp/camera-local-console-data-backup/"
fi
rm -rf "$INSTALL_DIR"
echo "    已删除安装目录"

# ---------- 4. 清理本机 root 的 authorized_keys 中总部公钥（可选） ----------
if [ "$CLEAN_GATEWAY" = "1" ]; then
  echo "==> 清理本机 /root/.ssh/authorized_keys 中的总部公钥..."
  if [ -n "$GATEWAY_FINGERPRINT" ] && [ -f /root/.ssh/authorized_keys ]; then
    sed -i "/${GATEWAY_FINGERPRINT}/d" /root/.ssh/authorized_keys 2>/dev/null || true
    echo "    已移除总部公钥（Web 终端将无法再登录本机）"
  fi
fi

# ---------- 5. 完成 ----------
echo ""
echo "============================================================"
echo " ✅ 卸载完成"
echo "    控制台服务与文件已清除"
echo "    如需重装：重新运行安装脚本即可"
if [ "$KEEP_DATA" = "1" ]; then
  echo "    数据已备份: /tmp/camera-local-console-data-backup/"
fi
echo "    【总部侧】门店反向隧道端口与公钥记录仍在总部库中，"
echo "    可在管理面板「控制台」Tab 查看，或由管理员清理 console_deployment 记录"
echo "============================================================"

exit 0
