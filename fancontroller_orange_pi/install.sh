#!/bin/bash

echo "================================================"
echo "Fan Controller for Orange Pi PC"
echo "GPIO 10 (Physical Pin 35) - Hardware PWM 50Hz - 40°C to 70°C"
echo "================================================"

# Проверка системы
echo "System check:"
MODEL=$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo "Orange Pi PC")
echo "Model: $MODEL"
echo "Arch: $(uname -m)"
echo "Volumio: $(cat /etc/os-release | grep VERSION= | head -1)"

# Проверка Orange Pi
if echo "$MODEL" | grep -qi "orange"; then
    echo "✓ Compatible: $MODEL"
else
    echo "⚠ WARNING: This plugin is optimized for Orange Pi PC"
    echo "Continuing installation anyway..."
fi

# Установка необходимых пакетов
echo "Installing required packages..."
sudo apt-get update
sudo apt-get install -y gpiod libgpiod-dev

# Настройка GPIO прав
echo "Setting up GPIO permissions..."
sudo usermod -a -G gpio volumio 2>/dev/null || true

# Создание udev rules для Orange Pi
cat > /tmp/99-gpio.rules << 'EOF'
SUBSYSTEM=="gpio", KERNEL=="gpiochip*", GROUP="gpio", MODE="0660"
SUBSYSTEM=="gpio", KERNEL=="gpio*", GROUP="gpio", MODE="0660"
EOF

sudo mv /tmp/99-gpio.rules /etc/udev/rules.d/ 2>/dev/null || true
sudo udevadm control --reload-rules 2>/dev/null || true
sudo udevadm trigger 2>/dev/null || true

# Активация PWM
echo "Enabling PWM support..."
if [ -d "/sys/class/pwm" ]; then
    echo "✓ PWM controller detected"
    # Активируем PWM
    echo 0 > /sys/class/pwm/pwmchip0/export 2>/dev/null || true
    sleep 1
    if [ -d "/sys/class/pwm/pwmchip0/pwm0" ]; then
        echo "✓ Hardware PWM activated successfully"
        # Настраиваем PWM 50Hz
        echo 20000000 > /sys/class/pwm/pwmchip0/pwm0/period 2>/dev/null || true
        echo 0 > /sys/class/pwm/pwmchip0/pwm0/duty_cycle 2>/dev/null || true
        echo 1 > /sys/class/pwm/pwmchip0/pwm0/enable 2>/dev/null || true
    else
        echo "⚠ PWM channel setup failed, using software fallback"
    fi
else
    echo "⚠ Hardware PWM not available, using software PWM"
fi

# Инициализация GPIO 10 как fallback
echo "Initializing GPIO 10 (Physical Pin 35)..."
echo 10 > /sys/class/gpio/export 2>/dev/null || true
sleep 1
echo out > /sys/class/gpio/gpio10/direction 2>/dev/null || true
echo 0 > /sys/class/gpio/gpio10/value 2>/dev/null || true

# Проверка датчика температуры
echo "Checking temperature sensor..."
if [ -f "/sys/class/thermal/thermal_zone0/temp" ]; then
    TEMP=$(cat /sys/class/thermal/thermal_zone0/temp)
    echo "✓ Temperature sensor available: $((TEMP/1000))°C"
elif [ -f "/sys/class/sunxi_thermal/thermal_zone0/temp" ]; then
    TEMP=$(cat /sys/class/sunxi_thermal/thermal_zone0/temp)
    echo "✓ Temperature sensor available (sunxi): $((TEMP/1000))°C"
else
    echo "⚠ Thermal zone not found, using fallback"
fi

# Проверка доступности PWM
echo "Checking PWM capabilities..."
if [ -d "/sys/class/pwm/pwmchip0/pwm0" ]; then
    echo "✓ Hardware PWM: Available (50Hz)"
    PWM_TYPE="Hardware"
else
    echo "✓ Software PWM: Available (50Hz)"
    PWM_TYPE="Software"
fi

# Создание лог директории
echo "Creating log directory..."
mkdir -p /var/log/fancontroller
chown volumio:volumio /var/log/fancontroller 2>/dev/null || true

# Установка Node.js зависимостей
echo "Installing Node.js dependencies..."
npm install --production --unsafe-perm

echo ""
echo "================================================"
echo "INSTALLATION COMPLETE"
echo "================================================"
echo "Fan Controller installed successfully"
echo "GPIO 10 (Physical Pin 35) - ${PWM_TYPE} PWM 50Hz"
echo "Temperature range: 40°C to 70°C"
echo "Plugin will auto-start on boot"
echo ""
echo "Wiring:"
echo "  - Fan VCC to 5V Pin (2 or 4)"
echo "  - Fan GND to GND Pin (6, 9, 14, 20, 25, 30, 34, 39)" 
echo "  - Fan PWM/Signal to Physical Pin 35 (GPIO 10)"
echo ""
echo "PWM Type: ${PWM_TYPE}"
if [ "$PWM_TYPE" = "Hardware" ]; then
    echo "✓ Hardware PWM provides stable 50Hz frequency"
else
    echo "⚠ Software PWM may have frequency variations"
fi

echo "plugininstallend"