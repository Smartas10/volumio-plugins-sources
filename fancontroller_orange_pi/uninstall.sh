#!/bin/bash

echo "================================================"
echo "FanController uninstallation for Orange Pi PC"
echo "================================================"

# Получаем путь к директории плагина
PLUGIN_DIR="/data/plugins/system_controller/fancontroller-orange-pi-pc"
PLUGIN_NAME="fancontroller-orange-pi-pc"

echo "Stopping fancontroller service..."

# Способ 1: Остановка через Volumio API
curl -s -X POST "http://localhost:3000/api/v1/commands/?cmd=stopPlugin&name=$PLUGIN_NAME" > /dev/null 2>&1 || true

# Способ 2: Остановка через systemd (если используется)
systemctl stop fancontroller-orange-pi > /dev/null 2>&1 || true

# Ждем остановки
echo "Waiting for plugin to stop..."
sleep 5

# Очистка GPIO 228
echo "Cleaning up GPIO 228..."
if [ -d "/sys/class/gpio/gpio228" ]; then
    echo "0" > /sys/class/gpio/gpio228/value 2>/dev/null || true
    sleep 1
    echo "228" > /sys/class/gpio/unexport 2>/dev/null || true
    echo "GPIO 228 cleaned up"
else
    echo "GPIO 228 not active"
fi

# Удаление директории плагина
echo "Removing plugin directory..."
if [ -d "$PLUGIN_DIR" ]; then
    rm -rf "$PLUGIN_DIR"
    echo "Plugin directory removed: $PLUGIN_DIR"
else
    echo "Plugin directory not found: $PLUGIN_DIR"
fi

# Удаление конфигурационных файлов
echo "Removing configuration files..."
CONFIG_DIR="/data/configuration/system_controller/$PLUGIN_NAME"
if [ -d "$CONFIG_DIR" ]; then
    rm -rf "$CONFIG_DIR"
    echo "Configuration removed: $CONFIG_DIR"
fi

# Удаление логов
echo "Cleaning up log files..."
if [ -d "/var/log/fancontroller" ]; then
    rm -rf /var/log/fancontroller
    echo "Log directory removed"
fi

# Перезагрузка systemd
echo "Reloading systemd..."
systemctl daemon-reload > /dev/null 2>&1 || true

# Перезапуск Volumio UI
echo "Restarting Volumio UI..."
curl -s -X GET "http://localhost:3000/api/v1/commands/?cmd=restartUi" > /dev/null 2>&1 || true

echo ""
echo "================================================"
echo "UNINSTALLATION COMPLETE"
echo "================================================"
echo "Fan controller using GPIO 228 (Pin 8) completely removed"
echo "All configuration files and logs have been cleaned up"
echo "================================================"

echo "pluginuninstallend"