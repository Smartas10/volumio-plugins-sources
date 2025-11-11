#!/bin/bash

echo "================================================"
echo "Fan Controller Uninstallation"
echo "================================================"

echo "Stopping fan control..."
gpio write 0 0 2>/dev/null || true
echo 0 > /sys/class/gpio/gpio17/value 2>/dev/null || true
echo 17 > /sys/class/gpio/unexport 2>/dev/null || true

echo "Removing plugin files..."
rm -rf "/data/plugins/system_controller/fancontroller-rpi3" 2>/dev/null || true
rm -rf "/data/configuration/system_controller/fancontroller-rpi3" 2>/dev/null || true
rm -rf "/var/log/fancontroller" 2>/dev/null || true

echo "Fan Controller uninstalled successfully!"
echo "pluginuninstallend"