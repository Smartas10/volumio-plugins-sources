'use strict';

const exec = require('child_process').exec;
const fs = require('fs');
const path = require('path');

let fanPlugin = {
    name: 'fanControl',
    context: null,
    config: null,
    isEnabled: false,
    fanPin: 5,
    frequency: 50,
    tempMin: 40,
    tempMax: 70,
    currentDuty: 0,

    init: function(context) {
        this.context = context;
        this.config = this.context.config;
        
        // Загрузка конфигурации
        this.loadConfig();
        
        // Инициализация GPIO
        this.initGPIO();
        
        // Запуск мониторинга температуры
        this.startMonitoring();
        
        this.context.logger.info('Fan Control plugin initialized');
    },

    loadConfig: function() {
        try {
            let configFile = '/data/configuration/system_controller/fanControl/config.json';
            if (fs.existsSync(configFile)) {
                let config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
                this.fanPin = config.fanPin || 18;
                this.frequency = config.frequency || 50;
                this.tempMin = config.tempMin || 40;
                this.tempMax = config.tempMax || 70;
                this.isEnabled = config.enabled || false;
            }
        } catch (e) {
            this.context.logger.error('Error loading config: ' + e);
        }
    },

    initGPIO: function() {
        // Экспорт GPIO пина
        exec(`echo ${this.fanPin} > /sys/class/gpio/export`, (err) => {
            if (err) this.context.logger.debug('GPIO already exported');
        });
        
        // Установка направления
        exec(`echo out > /sys/class/gpio/gpio${this.fanPin}/direction`);
        
        // Включение PWM
        exec(`echo 0 > /sys/class/gpio/gpio${this.fanPin}/value`);
    },

    getCPUTemperature: function(callback) {
        exec('cat /sys/class/thermal/thermal_zone0/temp', (err, stdout) => {
            if (err) {
                callback(50); // default
                return;
            }
            let temp = parseInt(stdout.trim()) / 1000;
            callback(temp);
        });
    },

    calculateDutyCycle: function(temp) {
        if (temp <= this.tempMin) return 0;
        if (temp >= this.tempMax) return 1;
        
        return (temp - this.tempMin) / (this.tempMax - this.tempMin);
    },

    setPWM: function(dutyCycle) {
        if (!this.isEnabled) return;
        
        dutyCycle = Math.max(0, Math.min(1, dutyCycle));
        this.currentDuty = dutyCycle;
        
        // Используем sysfs для PWM управления
        let period = 1000000 / this.frequency; // период в наносекундах
        let duty = Math.round(period * dutyCycle);
        
        let commands = [
            `echo ${this.fanPin} > /sys/class/gpio/export`,
            `echo out > /sys/class/gpio/gpio${this.fanPin}/direction`,
            `echo ${period} > /sys/class/gpio/gpio${this.fanPin}/period`,
            `echo ${duty} > /sys/class/gpio/gpio${this.fanPin}/duty_cycle`,
            `echo 1 > /sys/class/gpio/gpio${this.fanPin}/enable`
        ];
        
        commands.forEach(cmd => {
            exec(cmd, (err) => {
                if (err) this.context.logger.debug('PWM command error: ' + err);
            });
        });
    },

    startMonitoring: function() {
        setInterval(() => {
            this.getCPUTemperature((temp) => {
                if (this.isEnabled) {
                    let duty = this.calculateDutyCycle(temp);
                    this.setPWM(duty);
                    
                    // Логирование (редко чтобы не засорять логи)
                    if (Date.now() % 60000 < 1000) {
                        this.context.logger.debug(`CPU: ${temp}°C, Fan: ${duty*100}%`);
                    }
                }
            });
        }, 5000); // Проверка каждые 5 секунд
    },

    onVolumioStart: function() {
        this.loadConfig();
        this.initGPIO();
    },

    onStop: function() {
        // Плавное выключение вентилятора
        this.setPWM(0);
        exec(`echo 0 > /sys/class/gpio/gpio${this.fanPin}/value`);
        this.context.logger.info('Fan Control plugin stopped');
    },

    getConfiguration: function() {
        return {
            enabled: this.isEnabled,
            fanPin: this.fanPin,
            frequency: this.frequency,
            tempMin: this.tempMin,
            tempMax: this.tempMax,
            currentDuty: this.currentDuty
        };
    },

    setConfiguration: function(config) {
        this.isEnabled = config.enabled;
        this.fanPin = config.fanPin;
        this.frequency = config.frequency;
        this.tempMin = config.tempMin;
        this.tempMax = config.tempMax;
        
        this.saveConfig();
        this.initGPIO();
    },

    saveConfig: function() {
        let config = {
            enabled: this.isEnabled,
            fanPin: this.fanPin,
            frequency: this.frequency,
            tempMin: this.tempMin,
            tempMax: this.tempMax
        };
        
        let configDir = '/data/configuration/system_controller/fanControl';
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        
        fs.writeFileSync(configDir + '/config.json', JSON.stringify(config, null, 2));
    }
};

module.exports = fanPlugin;