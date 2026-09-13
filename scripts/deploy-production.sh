#!/usr/bin/env bash
# На сервере Timeweb: bash scripts/deploy-production.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== 1. Код с GitHub ==="
git fetch origin main
git reset --hard origin/main
git log -1 --oneline

echo ""
echo "=== 2. Сборка ==="
npm install
rm -rf .output
npm run build

echo ""
echo "=== 3. Проверка, что новый код попал в сборку ==="
if grep -rq "Курсы (4 недели)" .output 2>/dev/null; then
  echo "OK: блок курсов найден в сборке"
else
  echo "ОШИБКА: в сборке нет «Курсы (4 недели)» — деплой неполный"
  exit 1
fi
if grep -rq "Сборка " .output 2>/dev/null; then
  echo "OK: метка версии сборки найдена"
else
  echo "ПРЕДУПРЕЖДЕНИЕ: метка версии не найдена"
fi

echo ""
echo "=== 4. Перезапуск PM2 ==="
pm2 restart panovapro || pm2 start ecosystem.config.cjs
pm2 save
pm2 status

SHA=$(git rev-parse --short HEAD)
echo ""
echo "Готово. В админке слева внизу должно быть: Сборка ${SHA}"
echo "Если видите старую версию — обновите страницу Ctrl+F5."
