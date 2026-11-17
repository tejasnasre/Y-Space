#!/usr/bin/env bash
# Run from your laptop, in BackEnd/:  ./deploy/deploy.sh
set -euo pipefail
HOST="${HOST:-ubuntu@130.210.11.134}"
KEY="${KEY:-../ssh-key-2026-11-17.key}"
SSH="ssh -i $KEY -o IdentitiesOnly=yes"

rsync -az --delete -e "$SSH" \
  --include='package.json' --include='bun.lock' --include='tsconfig.json' --include='index.ts' \
  --include='src/***' --include='scripts/***' --include='drizzle/***' --include='deploy/***' \
  --exclude='*' ./ "$HOST:/tmp/yspace-release/"

$SSH "$HOST" '
  set -e
  sudo rsync -a --delete --exclude=.bun --exclude=node_modules /tmp/yspace-release/ /opt/yspace/
  sudo chown -R yspace:yspace /opt/yspace
  cd /opt/yspace
  sudo -u yspace env BUN_INSTALL=/opt/yspace/.bun /opt/yspace/.bun/bin/bun install --frozen-lockfile --production
  sudo systemctl restart yspace-api
  for i in $(seq 1 20); do curl -fsS http://127.0.0.1:3000/health && echo && exit 0; sleep 1; done
  echo "API did not become healthy: sudo journalctl -u yspace-api -n 50"; exit 1
'
