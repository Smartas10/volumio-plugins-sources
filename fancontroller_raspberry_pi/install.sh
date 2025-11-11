#!/bin/bash

echo "================================================"
echo "Raspberry Pi Fan Controller Installation"
echo "GPIO 14 - PWM 50Hz - Automatic 20°C-80°C"
echo "================================================"

# Check if Raspberry Pi
if [ ! -f /proc/device-tree/model ]; then
    echo "WARNING: This plugin is for Raspberry Pi"
else
    echo "System: $(tr -d '\0' < /proc/device-tree/model)"
fi

# Check GPIO
if [ ! -d "/sys/class/gpio" ]; then
    echo "ERROR: GPIO not available"
    exit 1
fi

echo "GPIO: OK"

# Check temperature sensor
if command -v vcgencmd >/dev/null 2>&1; then
    echo "Temperature: vcgencmd available"
else
    echo "Temperature: Using thermal zone"
fi

# Install dependencies
echo "Installing dependencies..."
npm install --production

echo ""
echo "================================================"
echo "INSTALLATION COMPLETE"
echo "================================================"
echo "Fan control will start automatically"
echo "GPIO 14 (Pin 8) - PWM 50Hz"
echo "Temperature range: 20°C-80°C"

echo "plugininstallend"