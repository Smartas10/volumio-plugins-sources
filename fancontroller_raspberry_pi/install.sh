#!/bin/bash

echo "================================================"
echo "Fan Controller for Raspberry Pi 3"
echo "GPIO 14 - PWM 50Hz - 20°C to 80°C"
echo "================================================"

# Проверка Raspberry Pi 3
echo "Checking Raspberry Pi 3..."
if ! grep -q "Raspberry Pi 3" /proc/device-tree/model 2>/dev/null; then
    echo "WARNING: This plugin is optimized for Raspberry Pi 3"
    echo "Detected: $(tr -d '\0' < /proc/device-tree/model)"
fi

# Установка wiringPi для Raspberry Pi 3
echo "Installing wiringPi for Raspberry Pi 3..."
sudo apt-get update
sudo apt-get install -y wiringpi
sudo usermod -a -G gpio volumio
# Проверка установки wiringPi
if ! command -v gpio >/dev/null 2>&1; then
    echo "ERROR: wiringPi installation failed!"
    echo "Please install manually: sudo apt-get install wiringpi"
    exit 1
fi

echo "wiringPi version:"
gpio -v

# Проверка GPIO
echo "Checking GPIO access..."
if [ ! -d "/sys/class/gpio" ]; then
    echo "ERROR: GPIO not available"
    exit 1
fi

# Проверка датчика температуры через thermal zone
echo "Checking temperature sensor..."
if [ -f "/sys/class/thermal/thermal_zone0/temp" ]; then
    echo "✓ Thermal zone temperature sensor available"
    TEMP=$(cat /sys/class/thermal/thermal_zone0/temp)
    echo "Current temperature: $((TEMP/1000))°C"
else
    echo "⚠ Thermal zone not found, using default temperature"
fi

# Создание лог директории
mkdir -p /var/log/fancontroller
chown volumio:volumio /var/log/fancontroller 2>/dev/null || true

# Установка Node.js зависимостей
echo "Installing Node.js dependencies..."
npm install --production

echo ""
echo "================================================"
echo "INSTALLATION COMPLETE"
echo "================================================"
echo "Raspberry Pi 3 Fan Controller installed"
echo "GPIO 14 (Physical Pin 8) - PWM 50Hz"
echo "Temperature range: 20°C to 80°C"
echo "Web interface available in Volumio Settings"

echo "plugininstallend"