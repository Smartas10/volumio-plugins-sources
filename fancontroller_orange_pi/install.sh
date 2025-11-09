#!/bin/bash

echo "================================================"
echo "FanController installation for Orange Pi PC"
echo "GPIO 102 - Physical Pin 8 (CORRECT GPIO)"
echo "================================================"

# Проверка системы
echo "Checking Orange Pi PC compatibility..."
if [ ! -f "/etc/orangepi-release" ] && [ ! -f "/etc/armbian-release" ]; then
    echo "WARNING: This plugin is designed for Orange Pi/Armbian systems"
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
if [ -f "/sys/class/thermal/thermal_zone0/temp" ]; then
    echo "Temperature sensor: /sys/class/thermal/thermal_zone0/temp"
elif [ -f "/sys/devices/virtual/thermal/thermal_zone0/temp" ]; then
    echo "Temperature sensor: /sys/devices/virtual/thermal/thermal_zone0/temp"
else
    echo "WARNING: Thermal interface not found. Temperature reading may not work."
    echo "Trying alternative temperature sources..."
    
    # Проверка альтернативных источников температуры
    if command -v vcgencmd >/dev/null 2>&1; then
        echo "Alternative: vcgencmd found (Raspberry Pi compatible)"
    elif [ -f "/sys/class/sunxi_temperture/temperture" ]; then
        echo "Alternative: sunxi_temperture found"
    else
        echo "WARNING: No temperature sensors found. Plugin will not work properly."
    fi
fi

# Проверка занятости GPIO 102
echo "Checking GPIO 102 availability..."
if [ -d "/sys/class/gpio/gpio102" ]; then
    echo "WARNING: GPIO 102 is already exported. Checking if it's in use..."
    if [ -f "/sys/class/gpio/gpio102/direction" ]; then
        DIRECTION=$(cat /sys/class/gpio/gpio102/direction 2>/dev/null || echo "unknown")
        echo "GPIO 102 direction: $DIRECTION"
        if [ "$DIRECTION" == "in" ] || [ "$DIRECTION" == "out" ]; then
            echo "WARNING: GPIO 102 appears to be in use. There may be conflicts."
        fi
    fi
else
    echo "GPIO 102: Available"
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
echo "CONNECTION GUIDE for Orange Pi PC:"
echo "  Fan (+) → Physical Pin 8 (GPIO 102)"
echo "  Fan (-) → Physical Pin 9 (GND)"
echo ""
echo "IMPORTANT:"
echo "  • GPIO 102 (Pin 8) is correct for Orange Pi PC"
echo "  • Plugin type: system_controller (no hardware conflicts)"
echo "  • Compatible with Orange Pi PC"
echo "================================================"

echo "plugininstallend"