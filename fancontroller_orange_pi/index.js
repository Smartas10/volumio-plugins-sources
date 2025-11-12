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
    
    // Конфигурация для Orange Pi PC - GPIO 13
    self.GPIO_PIN = 13; // Orange Pi PC GPIO 13
    self.GPIO_PIN_SYSFS = 13; // Для sysfs
    self.PWM_FREQUENCY = 50;
    self.PWM_PERIOD_MS = 20; // 50Hz = 20ms period
    self.MIN_TEMP = 40;
    self.MAX_TEMP = 70;
    
    self.fanInterval = null;
    self.pwmInterval = null;
    self.currentSpeed = 0;
    self.isInitialized = false;
    self.isRunning = false;
    self.pwmEnabled = false;
}

FanController.prototype.onVolumioStart = function() {
    var self = this;
    self.configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
    
    self.logger.info('FanController: Starting plugin initialization - Orange Pi PC GPIO 13');
    
    // РЕГИСТРАЦИЯ КОНСОЛЬНЫХ КОМАНД - С ЗАЩИТОЙ ОТ ОШИБОК
    try {
        if (self.commandRouter.consoleCommandService) {
            self.commandRouter.consoleCommandService.registerCommand(
                'fancontroller-enable',
                this.enableFanControl.bind(this),
                'Enable fan control'
            );
            
            self.commandRouter.consoleCommandService.registerCommand(
                'fancontroller-disable',
                this.disableFanControl.bind(this),
                'Disable fan control'
            );
            
            self.commandRouter.consoleCommandService.registerCommand(
                'fancontroller-status',
                this.getStatus.bind(this),
                'Get fan controller status'
            );
            
            self.commandRouter.consoleCommandService.registerCommand(
                'fancontroller-test',
                this.testPWM.bind(this),
                'Test PWM at 50% for 10 seconds'
            );
            
            self.logger.info('FanController: Console commands registered');
        } else {
            self.logger.warn('FanController: consoleCommandService not available, skipping console commands');
        }
    } catch (error) {
        self.logger.error('FanController: Failed to register console commands: ' + error);
    }
    
    return self.loadConfig().then(function() {
        self.logger.info('FanController: Configuration loaded');
        
        // Авто-включаем если enabled в конфиге
        if (self.config.get('enabled')) {
            return self.startFanControl();
        } else {
            self.logger.info('FanController: Plugin disabled in config');
            return libQ.resolve();
        }
    }).then(function() {
        self.isInitialized = true;
        self.logger.info('FanController: Plugin started successfully on ' + self.getPlatformInfo());
        self.commandRouter.pushConsoleMessage('FanController: Started successfully - Orange Pi PC GPIO 13');
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
    var configData = self.config.get();
    var configJson = JSON.stringify(configData, null, 4);
    
    return libQ.nfcall(fs.writeFile, self.configFile, configJson, 'utf8')
        .then(function() {
            self.logger.info('FanController: Config saved');
        })
        .fail(function(err) {
            self.logger.error('FanController: Config save failed: ' + err);
            return libQ.resolve();
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
        gpio_pin: 13, // Orange Pi PC GPIO 13
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
        var config = {
            enabled: self.config.get('enabled'),
            min_temp: self.config.get('min_temp'),
            max_temp: self.config.get('max_temp'),
            check_interval: self.config.get('check_interval'),
            current_temp: temp.toFixed(1),
            current_speed: self.currentSpeed,
            pwm_frequency: "50 Hz",
            gpio_pin: "GPIO 13 (Physical Pin 8)",
            platform: self.getPlatformInfo(),
            temp_sensor: "thermal_zone0",
            is_running: self.isRunning
        };
        
        defer.resolve(config);
    }).fail(function(error) {
        self.logger.error('FanController: UI config error: ' + error);
        
        var fallbackConfig = {
            enabled: self.config.get('enabled'),
            min_temp: self.config.get('min_temp'),
            max_temp: self.config.get('max_temp'),
            check_interval: self.config.get('check_interval'),
            current_temp: "--",
            current_speed: self.currentSpeed,
            pwm_frequency: "50 Hz",
            gpio_pin: "GPIO 13 (Physical Pin 8)",
            platform: self.getPlatformInfo(),
            temp_sensor: "thermal_zone0",
            is_running: self.isRunning
        };
        defer.resolve(fallbackConfig);
    });
    
    return defer.promise;
};

FanController.prototype.updateUIConfig = function(data) {
    var self = this;
    var defer = libQ.defer();
    
    var wasEnabled = self.config.get('enabled');
    
    self.config.set('enabled', data.enabled);
    self.config.set('min_temp', parseInt(data.min_temp));
    self.config.set('max_temp', parseInt(data.max_temp));
    self.config.set('check_interval', parseInt(data.check_interval));
    
    self.saveConfig().then(function() {
        if (data.enabled && !wasEnabled) {
            return self.startFanControl();
        } else if (!data.enabled && wasEnabled) {
            self.stopFanControl();
        } else if (data.enabled && wasEnabled) {
            return self.restartFanControl();
        }
    }).then(function() {
        defer.resolve({success: true, message: 'Settings updated'});
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
            executable: true
        },
        {
            command: 'fancontroller-disable',
            description: 'Disable fan control',
            executable: true
        },
        {
            command: 'fancontroller-status',
            description: 'Get fan controller status',
            executable: true
        },
        {
            command: 'fancontroller-test',
            description: 'Test PWM at 50% for 10 seconds',
            executable: true
        }
    ];
};

FanController.prototype.enableFanControl = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('FanController: Enabling fan control via console command');
    self.config.set('enabled', true);
    
    self.saveConfig().then(function() {
        return self.startFanControl();
    }).then(function() {
        defer.resolve('Fan control ENABLED successfully');
    }).fail(function(error) {
        defer.reject('Failed to enable fan control: ' + error);
    });
    
    return defer.promise;
};

FanController.prototype.disableFanControl = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('FanController: Disabling fan control via console command');
    self.config.set('enabled', false);
    
    self.saveConfig().then(function() {
        self.stopFanControl();
        defer.resolve('Fan control DISABLED successfully');
    }).fail(function(error) {
        defer.reject('Failed to disable fan control: ' + error);
    });
    
    return defer.promise;
};

FanController.prototype.getStatus = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('FanController: Getting status via console command');
    
    self.getSystemTemperature().then(function(temp) {
        var status = {
            enabled: self.config.get('enabled'),
            running: self.isRunning,
            temperature: temp.toFixed(1) + '°C',
            current_speed: self.currentSpeed + '%',
            gpio: 'GPIO 13 (Physical Pin 8)',
            platform: self.getPlatformInfo(),
            pwm: '50Hz',
            temp_range: self.config.get('min_temp') + '°C - ' + self.config.get('max_temp') + '°C',
            temp_sensor: 'thermal_zone0',
            initialized: self.isInitialized
        };
        defer.resolve(JSON.stringify(status, null, 2));
    }).fail(function(error) {
        var errorStatus = {
            error: 'Failed to get status: ' + error,
            enabled: self.config.get('enabled'),
            running: self.isRunning,
            platform: self.getPlatformInfo(),
            initialized: self.isInitialized
        };
        defer.resolve(JSON.stringify(errorStatus, null, 2));
    });
    
    return defer.promise;
};

FanController.prototype.testPWM = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('FanController: Testing PWM at 50% via console command');
    
    var wasEnabled = self.config.get('enabled');
    var wasRunning = self.isRunning;
    
    self.stopFanControl();
    
    self.applyPWM(50);
    
    setTimeout(function() {
        if (wasEnabled && wasRunning) {
            self.startFanControl();
        } else {
            self.applyPWM(0);
        }
        defer.resolve('PWM test completed - ran at 50% for 10 seconds');
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
            // Для Orange Pi может быть другой путь к датчику температуры
            fs.readFile('/sys/class/sunxi_thermal/thermal_zone0/temp', 'utf8', function(err2, data2) {
                if (!err2 && data2) {
                    var temp = parseInt(data2) / 1000;
                    self.logger.debug('FanController: Temperature (sunxi): ' + temp + '°C');
                    defer.resolve(temp);
                } else {
                    self.logger.warn('FanController: Using default temperature 45°C');
                    defer.resolve(45);
                }
            });
        }
    });
    
    return defer.promise;
};

FanController.prototype.getPlatformInfo = function() {
    try {
        var model = require('fs').readFileSync('/proc/device-tree/model', 'utf8').trim();
        return model || 'Orange Pi PC';
    } catch (e) {
        return 'Orange Pi PC';
    }
};

FanController.prototype.setupGPIO = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('FanController: Setting up Orange Pi PC GPIO 13');
    
    // Для Orange Pi используем sysfs
    exec('echo ' + self.GPIO_PIN_SYSFS + ' > /sys/class/gpio/export 2>/dev/null', function() {
        setTimeout(function() {
            exec('echo out > /sys/class/gpio/gpio' + self.GPIO_PIN_SYSFS + '/direction 2>/dev/null', function() {
                exec('echo 0 > /sys/class/gpio/gpio' + self.GPIO_PIN_SYSFS + '/value 2>/dev/null', function() {
                    self.logger.info('FanController: Orange Pi PC GPIO 13 setup with sysfs');
                    defer.resolve();
                });
            });
        }, 100);
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
    
    if (speed === self.currentSpeed) {
        return;
    }
    
    self.currentSpeed = speed;
    self.config.set('fan_speed', speed);
    
    self.logger.info('FanController: Applying PWM ' + speed + '%');
    
    if (self.pwmInterval) {
        clearInterval(self.pwmInterval);
        self.pwmInterval = null;
    }
    
    if (speed === 0) {
        exec('echo 0 > /sys/class/gpio/gpio' + self.GPIO_PIN_SYSFS + '/value 2>/dev/null', function() {});
        return;
    }
    
    if (speed === 100) {
        exec('echo 1 > /sys/class/gpio/gpio' + self.GPIO_PIN_SYSFS + '/value 2>/dev/null', function() {});
        return;
    }
    
    var onTime = (speed / 100) * self.PWM_PERIOD_MS;
    
    function pwmCycle() {
        exec('echo 1 > /sys/class/gpio/gpio' + self.GPIO_PIN_SYSFS + '/value 2>/dev/null', function() {});
        
        setTimeout(function() {
            exec('echo 0 > /sys/class/gpio/gpio' + self.GPIO_PIN_SYSFS + '/value 2>/dev/null', function() {});
        }, onTime);
    }
    
    self.pwmInterval = setInterval(pwmCycle, self.PWM_PERIOD_MS);
};

FanController.prototype.startFanControl = function() {
    var self = this;
    var defer = libQ.defer();
    
    if (self.isRunning) {
        self.logger.info('FanController: Already running');
        defer.resolve();
        return defer.promise;
    }
    
    self.stopFanControl();
    
    if (!self.config.get('enabled')) {
        self.logger.info('FanController: Plugin disabled, not starting');
        defer.resolve();
        return defer.promise;
    }
    
    self.setupGPIO().then(function() {
        self.logger.info('FanController: Starting fan control');
        self.isRunning = true;
        
        self.getSystemTemperature().then(function(temp) {
            var speed = self.calculateFanSpeed(temp);
            self.applyPWM(speed);
            self.logger.info('FanController: Initial temperature ' + temp.toFixed(1) + '°C → ' + speed + '%');
        });
        
        self.fanInterval = setInterval(function() {
            if (!self.isRunning) return;
            
            self.getSystemTemperature().then(function(temp) {
                var newSpeed = self.calculateFanSpeed(temp);
                
                if (Math.abs(newSpeed - self.currentSpeed) > 5) {
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
    
    self.logger.info('FanController: Stopping fan control');
    self.isRunning = false;
    
    if (self.fanInterval) {
        clearInterval(self.fanInterval);
        self.fanInterval = null;
    }
    
    if (self.pwmInterval) {
        clearInterval(self.pwmInterval);
        self.pwmInterval = null;
    }
    
    exec('echo 0 > /sys/class/gpio/gpio' + self.GPIO_PIN_SYSFS + '/value 2>/dev/null', function() {});
    self.currentSpeed = 0;
};

FanController.prototype.cleanupGPIO = function() {
    var self = this;
    
    self.stopFanControl();
    
    self.logger.info('FanController: Cleaning up GPIO');
    
    setTimeout(function() {
        exec('echo 0 > /sys/class/gpio/gpio' + self.GPIO_PIN_SYSFS + '/value 2>/dev/null', function() {});
        exec('echo ' + self.GPIO_PIN_SYSFS + ' > /sys/class/gpio/unexport 2>/dev/null', function() {});
    }, 1000);
};

FanController.prototype.restartFanControl = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('FanController: Restarting fan control');
    
    self.stopFanControl();
    
    setTimeout(function() {
        self.startFanControl().then(function() {
            defer.resolve();
        }).fail(function(error) {
            defer.reject(error);
        });
    }, 1000);
    
    return defer.promise;
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

FanController.prototype.pushState = function(state) {
    this.commandRouter.servicePushState(state, 'fancontroller');
};