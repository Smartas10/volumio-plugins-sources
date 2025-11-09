#!/bin/bash

echo "================================================"
echo "FanController uninstallation for Orange Pi PC"
echo "================================================"

# Остановка службы, если запущена
echo "Stopping fancontrol service..."
systemctl stop fancontroller 2>/dev/null || true

# Удаление службы
echo "Removing service..."
rm -f /etc/systemd/system/fancontroller.service

# Удаление конфигурационных файлов
echo "Removing configuration..."
rm -rf /data/fancontroller

# Перезагрузка systemd
echo "Reloading systemd..."
systemctl daemon-reload

echo ""
echo "================================================"
echo "UNINSTALLATION COMPLETE"
echo "================================================"
echo "Fan controller using GPIO 71 (Pin 12) removed"
echo "================================================"

echo "pluginuninstallend"