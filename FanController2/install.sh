#!/bin/bash

echo "FanController plugin installation started"

# Установка зависимостей Node.js
npm install

# Создание необходимых директорий
mkdir -p /data/fancontroller

# Настройка прав доступа
chmod 755 /data/plugins/system_hardware/fancontroller/*.sh

# Проверка поддержки GPIO
if [ ! -d "/sys/class/gpio" ]; then
    echo "Warning: GPIO interface not found. Plugin may not work properly."
fi

echo "FanController plugin installed successfully"
echo "plugininstallend"