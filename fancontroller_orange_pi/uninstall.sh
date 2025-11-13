#!/bin/bash

echo "================================================"
echo "Fan Controller Uninstallation (Orange Pi PC GPIO10)"
echo "================================================"

echo "Stopping fan control..."
# Выключить вентилятор
echo 0 > /sys/class/gpio/gpio10/value 2>/dev/null || true

# Очистка PWM
echo "Cleaning up PWM..."
for chip in /sys/class/pwm/pwmchip*; do
    if [ -d "$chip" ]; then
        for pwm in "$chip"/pwm*; do
            if [ -d "$pwm" ]; then
                echo 0 > "$pwm/enable" 2>/dev/null || true
                CHIP_NUM=$(basename "$chip" | sed 's/pwmchip//')
                PWM_NUM=$(basename "$pwm" | sed 's/pwm//')
                echo "$PWM_NUM" > "/sys/class/pwm/pwmchip$CHIP_NUM/unexport" 2>/dev/null || true
            fi
        done
    fi
done

echo "Removing plugin files..."
rm -rf "/data/plugins/system_controller/fancontroller_orangepi_gpio10" 2>/dev/null || true
rm -rf "/data/plugins/system_controller/fancontroller_orangepi" 2>/dev/null || true

rm -rf "/data/configuration/system_controller/fancontroller_orangepi_gpio10" 2>/dev/null || true
rm -rf "/data/configuration/system_controller/fancontroller_orangepi" 2>/dev/null || true

rm -rf "/var/log/fancontroller" 2>/dev/null || true
rm -f "/tmp/99-gpio.rules" 2>/dev/null || true

echo "Cleaning up GPIO..."
for gpio in /sys/class/gpio/gpio*; do
    if [ -d "$gpio" ]; then
        GPIO_NUM=$(basename "$gpio" | sed 's/gpio//')
        echo "$GPIO_NUM" > /sys/class/gpio/unexport 2>/dev/null || true
    fi
done

echo "Fan Controller completely uninstalled!"
echo "pluginuninstallend"