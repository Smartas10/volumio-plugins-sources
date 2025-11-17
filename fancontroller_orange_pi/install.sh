#!/bin/bash

echo "================================================"
echo "Fan Controller for Orange Pi PC"
echo "GPIO 10 (Physical Pin 35) - ON at 55°C, OFF at 45°C"
echo "================================================"

# Проверка системы
echo "System check:"
MODEL=$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo "Orange Pi PC")
echo "Model: $MODEL"
echo "Arch: $(uname -m)"

# Проверка Orange Pi
if echo "$MODEL" | grep -qi "orange"; then
    echo "✓ Compatible: $MODEL"
else
    echo "⚠ WARNING: This plugin is optimized for Orange Pi PC"
fi

# Инициализация GPIO 10
echo "Initializing GPIO 10 (Physical Pin 35)..."
echo 10 > /sys/class/gpio/export 2>/dev/null || true
sleep 1
echo out > /sys/class/gpio/gpio10/direction 2>/dev/null || true
echo 0 > /sys/class/gpio/gpio10/value 2>/dev/null || true

# Создание лог директории
echo "Creating log directory..."
mkdir -p /var/log/fancontroller
chown volumio:volumio /var/log/fancontroller 2>/dev/null || true

# Установка Node.js зависимостей
echo "Installing Node.js dependencies..."
npm install --production --unsafe-perm

echo ""
echo "================================================"
echo "INSTALLATION COMPLETE"
echo "================================================"
echo "Fan Controller installed successfully"
echo "GPIO 10 (Physical Pin 35) - Simple ON/OFF control"
echo "Turns ON at 55°C, OFF at 45°C"
echo "Plugin will auto-start on boot"

echo "plugininstallend"