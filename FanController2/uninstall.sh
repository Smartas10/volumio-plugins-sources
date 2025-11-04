#!/bin/bash

echo "FanController plugin uninstallation started"

# Остановка службы, если запущена
systemctl stop fancontroller 2>/dev/null || true

# Удаление службы
rm -f /etc/systemd/system/fancontroller.service

# Удаление конфигурационных файлов
rm -rf /data/fancontroller

# Перезагрузка systemd
systemctl daemon-reload

echo "FanController plugin uninstalled successfully"
echo "pluginuninstallend"