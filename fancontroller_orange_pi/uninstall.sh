#!/bin/bash

echo "================================================"
echo "Fan Controller Uninstallation (Orange Pi PC GPIO13)"
echo "================================================"

echo "Stopping fan control..."
echo 0 > /sys/class/gpio/gpio13/value 2>/dev/null || true
echo 13 > /sys/class/gpio/unexport 2>/dev/null || true

echo "Removing plugin files..."
# Удаляем плагин
rm -rf "/data/plugins/system_controller/fancontroller_orangepi_gpio13" 2>/dev/null || true
rm -rf "/data/plugins/system_controller/fancontroller_orangepi" 2>/dev/null || true
rm -rf "/data/plugins/system_controller/fancontroller_beta" 2>/dev/null || true

# Удаляем конфигурации
rm -rf "/data/configuration/system_controller/fancontroller_orangepi_gpio13" 2>/dev/null || true
rm -rf "/data/configuration/system_controller/fancontroller_orangepi" 2>/dev/null || true
rm -rf "/data/configuration/system_controller/fancontroller_beta" 2>/dev/null || true

# Удаляем логи
rm -rf "/var/log/fancontroller" 2>/dev/null || true

# Удаляем временные файлы
rm -f "/tmp/99-gpio.rules" 2>/dev/null || true

echo "Cleaning up GPIO..."
# Отключаем все экспортированные GPIO
for gpio in /sys/class/gpio/gpio*; do
    if [ -d "$gpio" ]; then
        echo $(basename $gpio | sed 's/gpio//') > /sys/class/gpio/unexport 2>/dev/null || true
    fi
done

echo "Fan Controller completely uninstalled!"
echo "pluginuninstallend"