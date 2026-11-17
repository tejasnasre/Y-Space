#!/usr/bin/env bash
# One-time (idempotent) VM setup. Run ON the VM:  sudo bash setup-vm.sh
# Result: Bun + systemd service "yspace-api" + Caddy TLS. No Docker, no local Postgres (DATABASE_URL points at Neon).
set -euo pipefail

BUN_VERSION="${BUN_VERSION:-1.4.2}"
APP_DIR=/opt/yspace

[ "$(id -u)" = 0 ] || { echo "run with sudo"; exit 1; }

apt-get update -y
apt-get install -y --no-install-recommends unzip curl ca-certificates rsync

# Docker is not needed (the API is one Bun process; mediasoup is a worker inside it). Free its RAM.
if systemctl cat docker.service >/dev/null 2>&1; then
  systemctl disable --now docker.service docker.socket containerd.service 2>/dev/null || true
fi

id yspace >/dev/null 2>&1 || useradd --system --create-home --home-dir "$APP_DIR" --shell /usr/sbin/nologin yspace
mkdir -p "$APP_DIR"
chown yspace:yspace "$APP_DIR"

if [ ! -x "$APP_DIR/.bun/bin/bun" ]; then
  sudo -u yspace env BUN_INSTALL="$APP_DIR/.bun" bash -c "curl -fsSL https://bun.sh/install | bash -s bun-v${BUN_VERSION}"
fi

install -m 644 "$(dirname "$0")/yspace-api.service" /etc/systemd/system/yspace-api.service
install -m 644 "$(dirname "$0")/Caddyfile" /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable yspace-api
systemctl reload caddy || systemctl restart caddy

if [ ! -f /etc/yspace.env ]; then
  echo "Create /etc/yspace.env (root:yspace 640) from .env.example, then: sudo systemctl restart yspace-api"
fi
echo "ok"
