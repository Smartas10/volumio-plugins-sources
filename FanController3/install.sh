#!/bin/bash

echo "================================================"
echo "FanController installation for Orange Pi PC"
echo "GPIO 71 - Physical Pin 12 (No conflict)"
echo "================================================"

# Установка зависимостей Node.js
echo "Installing Node.js dependencies..."
npm install

# Создание необходимых директорий
echo "Creating directories..."
mkdir -p /data/fancontroller

# Настройка прав доступа
echo "Setting permissions..."
chmod 755 /data/plugins/system_hardware/fancontroller/*.sh

# Проверка поддержки GPIO на Orange Pi
echo "Checking GPIO support..."
if [ ! -d "/sys/class/gpio" ]; then
    echo "WARNING: GPIO interface not found. Plugin may not work properly."
else
    echo "GPIO interface: OK"
fi

# Проверка доступности thermal zone для температуры
echo "Checking temperature sensors..."
if [ -f "/sys/class/thermal/thermal_zone0/temp" ]; then
    echo "Temperature sensor: /sys/class/thermal/thermal_zone0/temp"
elif [ -f "/sys/devices/virtual/thermal/thermal_zone0/temp" ]; then
    echo "Temperature sensor: /sys/devices/virtual/thermal/thermal_zone0/temp"
else
    echo "WARNING: Thermal interface not found. Temperature reading may not work."
fi

echo ""
echo "================================================"
echo "INSTALLATION COMPLETE"
echo "================================================"
echo "CONNECTION GUIDE:"
echo "  Fan (+) → Physical Pin 12 (GPIO 71)"
echo "  Fan (-) → Physical Pin 14 (GND)"
echo ""
echo "GPIO 71 is SAFE - no conflict with buttons on Pins 7,8,9"
echo "================================================"

echo "plugininstallend"