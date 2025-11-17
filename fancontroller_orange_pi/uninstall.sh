#!/bin/bash

echo "================================================"
echo "Fan Controller Uninstallation (Orange Pi PC GPIO10)"
echo "================================================"

echo "Stopping fan control..."
# Выключить вентилятор
echo 0 > /sys/class/gpio/gpio10/value 2>/dev/null || true

echo "Cleaning up GPIO..."
echo 10 > /sys/class/gpio/unexport 2>/dev/null || true

echo "Removing plugin files..."
rm -rf "/data/plugins/system_controller/fancontroller_orangepi_gpio10" 2>/dev/null || true
rm -rf "/data/configuration/system_controller/fancontroller_orangepi_gpio10" 2>/dev/null || true
rm -rf "/var/log/fancontroller" 2>/dev/null || true

echo "Fan Controller completely uninstalled!"
echo "pluginuninstallend"