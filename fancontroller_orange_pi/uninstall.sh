#!/bin/bash

echo "================================================"
echo "Fan Controller Uninstallation (Orange Pi PC GPIO10)"
echo "================================================"

echo "Stopping fan control..."
echo 0 > /sys/class/gpio/gpio10/value 2>/dev/null || true
echo 10 > /sys/class/gpio/unexport 2>/dev/null || true

# Очистка PWM
echo "Cleaning up PWM..."
echo 0 > /sys/class/pwm/pwmchip0/pwm0/enable 2>/dev/null || true
echo 0 > /sys/class/pwm/pwmchip0/pwm0/duty_cycle 2>/dev/null || true
echo 0 > /sys/class/pwm/pwmchip0/unexport 2>/dev/null || true

echo "Removing plugin files..."
rm -rf "/data/plugins/system_controller/fancontroller_orangepi_gpio10" 2>/dev/null || true
rm -rf "/data/plugins/system_controller/fancontroller_orangepi" 2>/dev/null || true
rm -rf "/data/plugins/system_controller/fancontroller_beta" 2>/dev/null || true

rm -rf "/data/configuration/system_controller/fancontroller_orangepi_gpio10" 2>/dev/null || true
rm -rf "/data/configuration/system_controller/fancontroller_orangepi" 2>/dev/null || true
rm -rf "/data/configuration/system_controller/fancontroller_beta" 2>/dev/null || true

rm -rf "/var/log/fancontroller" 2>/dev/null || true
rm -f "/tmp/99-gpio.rules" 2>/dev/null || true

echo "Cleaning up GPIO..."
for gpio in /sys/class/gpio/gpio*; do
    if [ -d "$gpio" ]; then
        echo $(basename $gpio | sed 's/gpio//') > /sys/class/gpio/unexport 2>/dev/null || true
    fi
done

echo "Fan Controller completely uninstalled!"
echo "pluginuninstallend"