#!/bin/bash

echo "================================================"
echo "Fan Controller Uninstallation"
echo "================================================"

echo "Stopping fan control..."
gpio write 0 0 2>/dev/null || true
echo 0 > /sys/class/gpio/gpio17/value 2>/dev/null || true
echo 17 > /sys/class/gpio/unexport 2>/dev/null || true

echo "Removing plugin files..."
# Удаляем все возможные пути установки плагина
rm -rf "/data/plugins/system_controller/fancontroller_beta" 2>/dev/null || true
rm -rf "/data/plugins/system_controller/fancontroller" 2>/dev/null || true
rm -rf "/data/plugins/system_controller/fan_controller" 2>/dev/null || true

# Удаляем конфигурации
rm -rf "/data/configuration/system_controller/fancontroller_beta" 2>/dev/null || true
rm -rf "/data/configuration/system_controller/fancontroller" 2>/dev/null || true
rm -rf "/data/configuration/system_controller/fan_controller" 2>/dev/null || true

# Удаляем логи
rm -rf "/var/log/fancontroller" 2>/dev/null || true

# Удаляем временные файлы
rm -f "/tmp/99-gpio.rules" 2>/dev/null || true

echo "Cleaning up GPIO..."
gpio unexportall 2>/dev/null || true

echo "Fan Controller completely uninstalled!"
echo "pluginuninstallend"