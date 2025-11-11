#!/bin/bash

echo "================================================"
echo "Fan Controller Uninstallation - Raspberry Pi 3"
echo "================================================"

echo "Stopping fan control..."
gpio write 14 0 2>/dev/null || true
echo 0 > /sys/class/gpio/gpio14/value 2>/dev/null || true
echo 14 > /sys/class/gpio/unexport 2>/dev/null || true

echo "Removing plugin files..."
rm -rf "/data/plugins/system_controller/fancontroller-rpi3"
rm -rf "/data/configuration/system_controller/fancontroller-rpi3"
rm -rf "/var/log/fancontroller"

echo "Raspberry Pi 3 Fan Controller uninstalled!"
echo "pluginuninstallend"