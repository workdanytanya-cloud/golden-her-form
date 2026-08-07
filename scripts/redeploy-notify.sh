#!/usr/bin/env bash
# На сервере: bash scripts/redeploy-notify.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== git ==="
git fetch origin
git reset --hard origin/main
git log -1 --oneline

echo "=== source marker ==="
grep -n "NOTIFY_ENV_CHECK" src/lib/leads.functions.ts || {
  echo "ERROR: новый код не на диске"; exit 1;
}

echo "=== clean build ==="
rm -rf .output
npm install
npm run build

echo "=== built marker ==="
if grep -R "NOTIFY_ENV_CHECK" .output >/tmp/leads-marker.txt 2>/dev/null; then
  head -3 /tmp/leads-marker.txt
else
  echo "ERROR: маркер не попал в .output — сборка старая/битая"
  exit 1
fi

echo "=== env check ==="
node --env-file=.env scripts/check-notify-env.mjs

echo "=== pm2 ==="
pm2 flush || true
pm2 delete panovapro || true
pm2 start ecosystem.config.cjs
pm2 save

echo ""
echo "Готово. Отправьте тестовую заявку на сайте."
echo "Потом: pm2 logs panovapro --lines 40"
echo "Должна появиться строка: [leads] NOTIFY_ENV_CHECK v9ed24a9"
