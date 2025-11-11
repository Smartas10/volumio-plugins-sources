'use strict';

var libQ = require('kew');
var fs = require('fs');
var exec = require('child_process').exec;
var config = new (require('v-conf'))();

module.exports = FanController;

function FanController(context) {
    var self = this;
    self.context = context;
    self.commandRouter = self.context.coreCommand;
    self.logger = self.context.logger;
    self.configManager = self.context.configManager;
    
    // Конфигурация для Raspberry Pi
    self.GPIO_PIN = 14;
    self.PWM_FREQUENCY = 50;
    self.PWM_PERIOD_MS = 20;
    self.MIN_TEMP = 20;
    self.MAX_TEMP = 80;
    
    self.fanInterval = null;
    self.pwmInterval = null;
    self.currentSpeed = 0;
    self.isInitialized = false;
}

FanController.prototype.onVolumioStart = function() {
    var self = this;
    self.configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
    
    self.logger.info('FanController: Starting plugin initialization');
    
    return self.loadConfig().then(function() {
        // АВТОМАТИЧЕСКОЕ ВКЛЮЧЕНИЕ
        if (!self.config.get('enabled')) {
            self.logger.info('FanController: Auto-enabling plugin');
            self.config.set('enabled', true);
            return self.saveConfig();
        }
    }).then(function() {
        self.logger.info('FanController: Configuration loaded');
        return self.startFanControl();
    }).then(function() {
        self.isInitialized = true;
        self.logger.info('FanController: Plugin started successfully on ' + self.getPlatformInfo());
        self.commandRouter.pushConsoleMessage('FanController: Started successfully');
    }).fail(function(error) {
        self.logger.error('FanController: Startup failed: ' + error);
        self.commandRouter.pushConsoleMessage('FanController: ERROR - ' + error);
    });
};

FanController.prototype.onVolumioShutdown = function() {
    this.stopFanControl();
    this.cleanupGPIO();
    this.logger.info('FanController: Plugin stopped');
};

FanController.prototype.getConfigurationFiles = function() {
    return ['config.json'];
};

FanController.prototype.loadConfig = function() {
    var self = this;
    
    return libQ.nfcall(fs.readFile, self.configFile, 'utf8')
        .then(function(data) {
            self.config = new (require('v-conf'))();
            self.config.load(JSON.parse(data));
            self.setupDefaults();
            self.logger.info('FanController: Config loaded successfully');
        })
        .fail(function(err) {
            self.logger.warn('FanController: No config file, creating default');
            self.config = new (require('v-conf'))();
            self.setupDefaults();
            return self.saveConfig();
        });
};

FanController.prototype.saveConfig = function() {
    var self = this;
    var configJson = JSON.stringify(self.config.get(), null, 4);
    
    return libQ.nfcall(fs.writeFile, self.configFile, configJson, 'utf8')
        .then(function() {
            self.logger.info('FanController: Config saved');
        })
        .fail(function(err) {
            self.logger.error('FanController: Config save failed: ' + err);
        });
};

FanController.prototype.setupDefaults = function() {
    var self = this;
    
    var defaults = {
        enabled: true,
        min_temp: self.MIN_TEMP,
        max_temp: self.MAX_TEMP,
        check_interval: 10,
        fan_speed: 0,
        use_pwm: true,
        gpio_pin: 14,
        pwm_frequency: 50
    };
    
    Object.keys(defaults).forEach(function(key) {
        if (!self.config.has(key)) {
            self.config.set(key, defaults[key]);
        }
    });
};

// Веб-интерфейс
FanController.prototype.getUIConfig = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.getSystemTemperature().then(function(temp) {
        var speed = self.calculateFanSpeed(temp);
        var config = {
            enabled: self.config.get('enabled'),
            min_temp: self.config.get('min_temp'),
            max_temp: self.config.get('max_temp'),
            check_interval: self.config.get('check_interval'),
            current_temp: temp.toFixed(1),
            current_speed: speed,
            pwm_frequency: "50 Hz",
            gpio_pin: "GPIO 14 (Pin 8)",
            platform: self.getPlatformInfo(),
            temp_sensor: "thermal_zone0"
        };
        
        defer.resolve(config);
    }).fail(function(error) {
        self.logger.error('FanController: UI config error: ' + error);
        defer.reject(error);
    });
    
    return defer.promise;
};

FanController.prototype.updateUIConfig = function(data) {
    var self = this;
    var defer = libQ.defer();
    
    self.config.set('enabled', data.enabled);
    self.config.set('min_temp', parseInt(data.min_temp));
    self.config.set('max_temp', parseInt(data.max_temp));
    self.config.set('check_interval', parseInt(data.check_interval));
    
    self.saveConfig().then(function() {
        self.restartFanControl();
        defer.resolve();
    }).fail(function(error) {
        defer.reject(error);
    });
    
    return defer.promise;
};

// Консольные команды
FanController.prototype.getConsoleCommands = function() {
    var self = this;
    
    return [
        {
            command: 'fancontroller-enable',
            description: 'Enable fan control',
            executable: true,
            handler: self.enableFanControl.bind(self)
        },
        {
            command: 'fancontroller-disable',
            description: 'Disable fan control',
            executable: true,
            handler: self.disableFanControl.bind(self)
        },
        {
            command: 'fancontroller-status',
            description: 'Get status',
            executable: true,
            handler: self.getStatus.bind(self)
        },
        {
            command: 'fancontroller-test',
            description: 'Test PWM at 50%',
            executable: true,
            handler: self.testPWM.bind(self)
        }
    ];
};

FanController.prototype.enableFanControl = function() {
    var self = this;
    self.config.set('enabled', true);
    return self.saveConfig().then(function() {
        self.restartFanControl();
        return 'Fan control ENABLED';
    });
};

FanController.prototype.disableFanControl = function() {
    var self = this;
    self.config.set('enabled', false);
    return self.saveConfig().then(function() {
        self.stopFanControl();
        return 'Fan control DISABLED';
    });
};

FanController.prototype.getStatus = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.getSystemTemperature().then(function(temp) {
        var speed = self.calculateFanSpeed(temp);
        var status = {
            enabled: self.config.get('enabled'),
            temperature: temp.toFixed(1) + '°C',
            speed: speed + '%',
            gpio: 'GPIO 14 (Pin 8)',
            platform: self.getPlatformInfo(),
            pwm: '50Hz',
            temp_range: self.config.get('min_temp') + '°C - ' + self.config.get('max_temp') + '°C',
            temp_sensor: 'thermal_zone0'
        };
        defer.resolve(JSON.stringify(status, null, 2));
    }).fail(function(error) {
        defer.reject(error);
    });
    
    return defer.promise;
};

FanController.prototype.testPWM = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('FanController: Testing PWM at 50%');
    self.applyPWM(50);
    
    setTimeout(function() {
        self.restartFanControl();
        defer.resolve('PWM test completed - returned to automatic mode');
    }, 10000);
    
    return defer.promise;
};

FanController.prototype.getSystemTemperature = function() {
    var self = this;
    var defer = libQ.defer();
    
    fs.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8', function(err, data) {
        if (!err && data) {
            var temp = parseInt(data) / 1000;
            self.logger.debug('FanController: Temperature: ' + temp + '°C');
            defer.resolve(temp);
        } else {
            self.logger.warn('FanController: Using default temperature 35°C');
            defer.resolve(35);
        }
    });
    
    return defer.promise;
};

FanController.prototype.getPlatformInfo = function() {
    try {
        return require('fs').readFileSync('/proc/device-tree/model', 'utf8').trim();
    } catch (e) {
        return 'Raspberry Pi';
    }
};

FanController.prototype.setupGPIO = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('FanController: Setting up GPIO 14');
    
    exec('gpio mode ' + self.GPIO_PIN + ' out', function(error) {
        if (error) {
            self.logger.warn('FanController: wiringPi failed, using sysfs');
            exec('echo ' + self.GPIO_PIN + ' > /sys/class/gpio/export 2>/dev/null', function() {
                setTimeout(function() {
                    exec('echo out > /sys/class/gpio/gpio14/direction 2>/dev/null', function() {
                        exec('echo 0 > /sys/class/gpio/gpio14/value 2>/dev/null', function() {
                            defer.resolve();
                        });
                    });
                }, 100);
            });
        } else {
            exec('gpio write ' + self.GPIO_PIN + ' 0', function() {
                self.logger.info('FanController: GPIO 14 setup completed');
                defer.resolve();
            });
        }
    });
    
    return defer.promise;
};

FanController.prototype.calculateFanSpeed = function(temp) {
    var self = this;
    var minTemp = self.config.get('min_temp');
    var maxTemp = self.config.get('max_temp');
    
    if (temp <= minTemp) return 0;
    if (temp >= maxTemp) return 100;
    
    return Math.round(((temp - minTemp) / (maxTemp - minTemp)) * 100);
};

FanController.prototype.applyPWM = function(speed) {
    var self = this;
    
    if (self.pwmInterval) {
        clearInterval(self.pwmInterval);
        self.pwmInterval = null;
    }
    
    // Игнорируем небольшие изменения
    if (Math.abs(speed - self.currentSpeed) < 5 && speed !== 0 && speed !== 100) {
        return;
    }
    
    self.currentSpeed = speed;
    self.config.set('fan_speed', speed);
    
    if (speed === 0) {
        exec('gpio write ' + self.GPIO_PIN + ' 0 2>/dev/null', function() {
            exec('echo 0 > /sys/class/gpio/gpio14/value 2>/dev/null', function() {});
        });
        return;
    }
    
    if (speed === 100) {
        exec('gpio write ' + self.GPIO_PIN + ' 1 2>/dev/null', function() {
            exec('echo 1 > /sys/class/gpio/gpio14/value 2>/dev/null', function() {});
        });
        return;
    }
    
    // 50Hz PWM
    var onTime = (speed / 100) * self.PWM_PERIOD_MS;
    
    self.pwmInterval = setInterval(function() {
        exec('gpio write ' + self.GPIO_PIN + ' 1 2>/dev/null', function() {
            exec('echo 1 > /sys/class/gpio/gpio14/value 2>/dev/null', function() {});
        });
        
        setTimeout(function() {
            exec('gpio write ' + self.GPIO_PIN + ' 0 2>/dev/null', function() {
                exec('echo 0 > /sys/class/gpio/gpio14/value 2>/dev/null', function() {});
            });
        }, onTime);
        
    }, self.PWM_PERIOD_MS);
    
    self.logger.debug('FanController: PWM set to ' + speed + '%');
};

FanController.prototype.startFanControl = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.stopFanControl();
    
    if (!self.config.get('enabled')) {
        self.logger.info('FanController: Plugin disabled, stopping');
        self.applyPWM(0);
        defer.resolve();
        return defer.promise;
    }
    
    self.setupGPIO().then(function() {
        self.logger.info('FanController: Starting fan control');
        
        // Первоначальная настройка
        self.getSystemTemperature().then(function(temp) {
            var speed = self.calculateFanSpeed(temp);
            self.applyPWM(speed);
            self.logger.info('FanController: Initial temperature ' + temp.toFixed(1) + '°C → ' + speed + '%');
        });
        
        // Интервал проверки
        self.fanInterval = setInterval(function() {
            self.getSystemTemperature().then(function(temp) {
                var newSpeed = self.calculateFanSpeed(temp);
                
                if (newSpeed !== self.currentSpeed) {
                    self.applyPWM(newSpeed);
                    self.logger.info('FanController: ' + temp.toFixed(1) + '°C → ' + newSpeed + '%');
                }
            }).fail(function(error) {
                self.logger.error('FanController: Temperature read failed: ' + error);
            });
        }, self.config.get('check_interval') * 1000);
        
        defer.resolve();
    }).fail(function(error) {
        self.logger.error('FanController: Failed to start: ' + error);
        defer.reject(error);
    });
    
    return defer.promise;
};

FanController.prototype.stopFanControl = function() {
    var self = this;
    
    if (self.fanInterval) {
        clearInterval(self.fanInterval);
        self.fanInterval = null;
    }
    
    if (self.pwmInterval) {
        clearInterval(self.pwmInterval);
        self.pwmInterval = null;
    }
    
    self.applyPWM(0);
    self.logger.info('FanController: Fan control stopped');
};

FanController.prototype.cleanupGPIO = function() {
    var self = this;
    
    self.stopFanControl();
    
    setTimeout(function() {
        exec('gpio write ' + self.GPIO_PIN + ' 0 2>/dev/null', function() {});
        exec('echo 0 > /sys/class/gpio/gpio14/value 2>/dev/null', function() {});
        exec('echo ' + self.GPIO_PIN + ' > /sys/class/gpio/unexport 2>/dev/null', function() {});
    }, 1000);
};

FanController.prototype.restartFanControl = function() {
    this.stopFanControl();
    setTimeout(this.startFanControl.bind(this), 1000);
};

// Жизненный цикл плагина
FanController.prototype.onStart = function() {
    return this.onVolumioStart();
};

FanController.prototype.onStop = function() {
    this.onVolumioShutdown();
    return libQ.resolve();
};

FanController.prototype.onRestart = function() {
    this.onVolumioShutdown();
    setTimeout(this.onVolumioStart.bind(this), 5000);
    return libQ.resolve();
};

FanController.prototype.onInstall = function() {
    this.logger.info('FanController: Plugin installed');
    return libQ.resolve();
};

FanController.prototype.onUninstall = function() {
    this.onVolumioShutdown();
    return libQ.resolve();
};