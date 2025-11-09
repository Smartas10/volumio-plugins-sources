#!/bin/bash

echo "================================================"
echo "FanController installation for Raspberry Pi"
echo "GPIO 14 - Physical Pin 8 (BCM numbering)"
echo "Starts cooling at 20°C"
echo "================================================"

# Проверка системы
echo "Checking Raspberry Pi compatibility..."
if [ ! -f /proc/device-tree/model ]; then
    echo "WARNING: This plugin is designed for Raspberry Pi systems"
else
    MODEL=$(tr -d '\0' < /proc/device-tree/model)
    echo "Detected: $MODEL"
fi

# Проверка архитектуры
ARCH=$(uname -m)
echo "Architecture: $ARCH"
if [[ "$ARCH" != "armv7l" ]] && [[ "$ARCH" != "aarch64" ]]; then
    echo "WARNING: This plugin is designed for ARM systems"
fi

# Проверка поддержки GPIO
echo "Checking GPIO support..."
if [ ! -d "/sys/class/gpio" ]; then
    echo "ERROR: GPIO interface not found. This system may not support GPIO."
    exit 1
else
    echo "GPIO interface: OK"
fi

# Проверка доступности thermal zone
echo "Checking temperature sensors..."
if command -v vcgencmd >/dev/null 2>&1; then
    echo "Temperature sensor: vcgencmd (Raspberry Pi)"
    # Test temperature reading
    vcgencmd measure_temp
elif [ -f "/sys/class/thermal/thermal_zone0/temp" ]; then
    echo "Temperature sensor: /sys/class/thermal/thermal_zone0/temp"
    # Test temperature reading
    TEMP=$(cat /sys/class/thermal/thermal_zone0/temp)
    echo "Current temperature: $((TEMP/1000))°C"
else
    echo "WARNING: No temperature sensors found. Plugin will not work properly."
fi

# Проверка занятости GPIO 14
echo "Checking GPIO 14 availability..."
if [ -d "/sys/class/gpio/gpio14" ]; then
    echo "WARNING: GPIO 14 is already exported. Checking if it's in use..."
    if [ -f "/sys/class/gpio/gpio14/direction" ]; then
        DIRECTION=$(cat /sys/class/gpio/gpio14/direction 2>/dev/null || echo "unknown")
        echo "GPIO 14 direction: $DIRECTION"
        if [ "$DIRECTION" == "in" ] || [ "$DIRECTION" == "out" ]; then
            echo "WARNING: GPIO 14 appears to be in use. There may be conflicts."
        fi
    fi
else
    echo "GPIO 14: Available"
fi

# Проверка конфликтов с другими плагинами
echo "Checking for conflicting plugins..."
CONFLICTING_PLUGINS=0

# Проверка GPIO Control плагина
if [ -d "/data/plugins/system_controller/gpio_control" ]; then
    echo "WARNING: gpio_control plugin found - potential conflict"
    CONFLICTING_PLUGINS=1
fi

# Проверка других fan controller плагинов
if [ -d "/data/plugins/system_controller/fancontroller" ] || \
   [ -d "/data/plugins/system_hardware/fancontroller" ]; then
    echo "WARNING: Other fan controller plugins found - potential conflict"
    CONFLICTING_PLUGINS=1
fi

if [ $CONFLICTING_PLUGINS -eq 0 ]; then
    echo "No conflicting plugins detected"
fi

# Создание лог файла
echo "Creating log directory..."
mkdir -p /var/log/fancontroller
chown volumio:volumio /var/log/fancontroller 2>/dev/null || true

echo ""
echo "================================================"
echo "SYSTEM CHECK COMPLETE"
echo "================================================"
echo "INSTALLING PLUGIN..."

# Установка Node.js зависимостей
echo "Installing Node.js dependencies..."
npm install --production

echo ""
echo "================================================"
echo "INSTALLATION COMPLETE"
echo "================================================"
echo "CONNECTION GUIDE for Raspberry Pi:"
echo "  Fan (+) → Physical Pin 8 (GPIO 14 - BCM)"
echo "  Fan (-) → Physical Pin 9 (GND)"
echo ""
echo "RASPBERRY PI PINOUT (BCM numbering):"
echo "  Pin 8  = GPIO 14 (TXD)"
echo "  Pin 9  = GND"
echo "  Pin 10 = GPIO 15 (RXD)"
echo ""
echo "COOLING STRATEGY:"
echo "  • Fan starts at 20°C for proactive cooling"
echo "  • Linear speed increase from 20°C to 50°C"
echo "  • Full speed at 50°C for maximum cooling"
echo "  • Optimized for Raspberry Pi thermal management"
echo ""
echo "IMPORTANT:"
echo "  • Uses BCM GPIO numbering (GPIO 14)"
echo "  • Safe pin - no conflict with essential functions"
echo "  • Compatible with all Raspberry Pi models"
echo "================================================"

echo "plugininstallend"