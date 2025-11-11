#!/bin/bash

echo "================================================"
echo "FanController installation for Raspberry Pi"
echo "GPIO 14 - Physical Pin 8 (BCM numbering)"
echo "PWM 50Hz - Temperature controlled duty cycle"
echo "================================================"

# System check
echo "Checking Raspberry Pi compatibility..."
if [ ! -f /proc/device-tree/model ]; then
    echo "WARNING: This plugin is designed for Raspberry Pi systems"
else
    MODEL=$(tr -d '\0' < /proc/device-tree/model)
    echo "Detected: $MODEL"
fi

# Architecture check
ARCH=$(uname -m)
echo "Architecture: $ARCH"
if [[ "$ARCH" != "armv7l" ]] && [[ "$ARCH" != "aarch64" ]]; then
    echo "WARNING: This plugin is designed for ARM systems"
fi

# GPIO support check
echo "Checking GPIO support..."
if [ ! -d "/sys/class/gpio" ]; then
    echo "ERROR: GPIO interface not found"
    exit 1
else
    echo "GPIO interface: OK"
fi

# Temperature sensor check
echo "Checking temperature sensors..."
if command -v vcgencmd >/dev/null 2>&1; then
    echo "Temperature sensor: vcgencmd (Raspberry Pi)"
elif [ -f "/sys/class/thermal/thermal_zone0/temp" ]; then
    echo "Temperature sensor: /sys/class/thermal/thermal_zone0/temp"
else
    echo "WARNING: No temperature sensors found"
fi

# Install wiringPi for PWM
echo "Installing PWM dependencies..."
if ! command -v gpio >/dev/null 2>&1; then
    echo "Installing wiringPi..."
    apt-get update && apt-get install -y wiringpi
fi

# Create log directory
mkdir -p /var/log/fancontroller
chown volumio:volumio /var/log/fancontroller 2>/dev/null || true

# Install Node.js dependencies
echo "Installing Node.js dependencies..."
npm install --production

echo ""
echo "================================================"
echo "INSTALLATION COMPLETE"
echo "================================================"
echo "Web interface available in Volumio Settings"
echo "GPIO 14 (Pin 8) - PWM 50Hz control"

echo "plugininstallend"