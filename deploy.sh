#!/usr/bin/env bash
# Hermes Kanban Web 一键构建部署（M1-6 E11：构建后校验产物存在再 restart，防陈旧产物上线）
set -e
cd /opt/hermes/kanban-web/web
echo "==> npm run build"
npm run build
echo "==> 校验构建产物"
if [ ! -f dist/index.html ]; then
  echo "❌ dist/index.html 不存在，中止部署" >&2
  exit 1
fi
if ! ls dist/assets/index-*.js >/dev/null 2>&1 || ! ls dist/assets/index-*.css >/dev/null 2>&1; then
  echo "❌ dist/assets 缺少 JS/CSS 产物，中止部署" >&2
  exit 1
fi
echo "   产物：$(ls dist/assets/index-*.js dist/assets/index-*.css | wc -l) 个文件"
echo "==> systemctl --user restart hermes-kanban-web.service"
systemctl --user restart hermes-kanban-web.service
sleep 3
systemctl --user is-active hermes-kanban-web.service
echo "✅ 部署完成"
