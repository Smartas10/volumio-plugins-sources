#!/bin/bash

echo "================================================"
echo "Fan Controller for Orange Pi PC"
echo "GPIO 13 (Physical Pin 8) - PWM 50Hz - 40°C to 70°C"
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

# Инициализация GPIO 13
echo "Initializing GPIO 13 (Physical Pin 8)..."
# Экспортируем GPIO через sysfs
echo 13 > /sys/class/gpio/export 2>/dev/null || true
sleep 1
echo out > /sys/class/gpio/gpio13/direction 2>/dev/null || true
echo 0 > /sys/class/gpio/gpio13/value 2>/dev/null || true

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
echo "GPIO 13 (Physical Pin 8) - PWM 50Hz"
echo "Temperature range: 40°C to 70°C"
echo "Plugin will auto-start on boot"
echo ""
echo "Wiring:"
echo "  - Fan VCC to 5V Pin"
echo "  - Fan GND to GND Pin" 
echo "  - Fan PWM/Signal to Physical Pin 8 (GPIO 13)"

echo "plugininstallend"