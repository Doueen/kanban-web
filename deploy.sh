#!/bin/bash
# Hermes Kanban Web 一键构建部署
set -e
cd /opt/hermes/kanban-web/web
npm run build
systemctl --user restart hermes-kanban-web.service
sleep 3
systemctl --user is-active hermes-kanban-web.service
echo "✅ 部署完成"
