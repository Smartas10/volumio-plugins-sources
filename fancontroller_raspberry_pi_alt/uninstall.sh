#!/bin/bash

echo "================================================"
echo "FanController uninstallation for Raspberry Pi"
echo "================================================"

PLUGIN_NAME="fancontroller-raspberry-pi"

echo "Stopping fancontroller service..."
curl -s -X POST "http://localhost:3000/api/v1/commands/?cmd=stopPlugin&name=$PLUGIN_NAME" > /dev/null 2>&1 || true

sleep 2

echo "Cleaning up GPIO 14..."
echo "0" > /sys/class/gpio/gpio14/value 2>/dev/null || true
echo "14" > /sys/class/gpio/unexport 2>/dev/null || true
gpio unexport 14 2>/dev/null || true

echo "Removing plugin files..."
rm -rf "/data/plugins/system_controller/$PLUGIN_NAME"
rm -rf "/data/configuration/system_controller/$PLUGIN_NAME"
rm -rf "/var/log/fancontroller"

echo "Restarting Volumio UI..."
curl -s -X GET "http://localhost:3000/api/v1/commands/?cmd=restartUi" > /dev/null 2>&1 || true

echo ""
echo "================================================"
echo "UNINSTALLATION COMPLETE"
echo "================================================"

echo "pluginuninstallend"