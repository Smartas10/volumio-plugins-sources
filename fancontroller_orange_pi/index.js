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
    
    // Конфигурация для Orange Pi PC - GPIO 10
    self.GPIO_PIN = 10;
    self.PWM_FREQUENCY = 50;    // 50 Hz
    self.PWM_PERIOD_NS = 20000000; // 20ms в наносекундах (50Hz)
    self.MIN_TEMP = 46;
    self.MAX_TEMP = 70;
    
    self.fanInterval = null;
    self.softwarePWMInterval = null;
    self.currentSpeed = 0;
    self.isInitialized = false;
    self.isRunning = false;
}

FanController.prototype.onVolumioStart = function() {
    var self = this;
    self.configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
    
    self.logger.info('FanController: Starting plugin - GPIO 10, 50Hz PWM, 46°C-70°C');
    
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
        }
    } catch (error) {
        self.logger.error('FanController: Failed to register console commands: ' + error);
    }
    
    return self.loadConfig().then(function() {
        self.logger.info('FanController: Configuration loaded');
        
        if (self.config.get('enabled')) {
            return self.startFanControl();
        } else {
            self.logger.info('FanController: Plugin disabled in config');
            return libQ.resolve();
        }
    }).then(function() {
        self.isInitialized = true;
        self.logger.info('FanController: Plugin started successfully');
        self.commandRouter.pushConsoleMessage('FanController: Started - GPIO 10, 50Hz PWM');
    }).fail(function(error) {
        self.logger.error('FanController: Startup failed: ' + error);
        self.commandRouter.pushConsoleMessage('FanController: ERROR - ' + error);
    });
};

FanController.prototype.onVolumioShutdown = function() {
    this.stopFanControl();
    this.cleanupPWM();
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
        min_temp: 46,
        max_temp: 70,
        check_interval: 10,
        fan_speed: 0,
        gpio_pin: 10,
        pwm_frequency: 50
    };
    
    Object.keys(defaults).forEach(function(key) {
        if (!self.config.has(key)) {
            self.config.set(key, defaults[key]);
        }
    });
};

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
            gpio_pin: "GPIO 10 (Physical Pin 35)",
            platform: self.getPlatformInfo(),
            temp_sensor: "thermal_zone0",
            is_running: self.isRunning
        };
        
        defer.resolve(config);
    }).fail(function(error) {
        var fallbackConfig = {
            enabled: self.config.get('enabled'),
            min_temp: self.config.get('min_temp'),
            max_temp: self.config.get('max_temp'),
            check_interval: self.config.get('check_interval'),
            current_temp: "--",
            current_speed: self.currentSpeed,
            pwm_frequency: "50 Hz",
            gpio_pin: "GPIO 10 (Physical Pin 35)",
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

FanController.prototype.getConsoleCommands = function() {
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
    
    self.getSystemTemperature().then(function(temp) {
        var status = {
            enabled: self.config.get('enabled'),
            running: self.isRunning,
            temperature: temp.toFixed(1) + '°C',
            current_speed: self.currentSpeed + '%',
            gpio: 'GPIO 10 (Physical Pin 35)',
            platform: self.getPlatformInfo(),
            pwm: '50Hz Software PWM',
            temp_range: '46°C - 70°C',
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
    
    self.logger.info('FanController: Testing PWM at 50%');
    
    var wasEnabled = self.config.get('enabled');
    var wasRunning = self.isRunning;
    
    self.stopFanControl();
    
    // Тест 50% заполнения
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
            defer.resolve(temp);
        } else {
            fs.readFile('/sys/class/sunxi_thermal/thermal_zone0/temp', 'utf8', function(err2, data2) {
                if (!err2 && data2) {
                    var temp = parseInt(data2) / 1000;
                    defer.resolve(temp);
                } else {
                    // Fallback temperature
                    defer.resolve(45);
                }
            });
        }
    });
    
    return defer.promise;
};

FanController.prototype.getPlatformInfo = function() {
    try {
        var model = fs.readFileSync('/proc/device-tree/model', 'utf8').trim();
        return model || 'Orange Pi PC';
    } catch (e) {
        return 'Orange Pi PC';
    }
};

FanController.prototype.setupGPIO = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('FanController: Setting up GPIO 10 for Software PWM');
    
    var commands = [
        'echo 10 > /sys/class/gpio/export 2>/dev/null || true',
        'sleep 0.5',
        'echo out > /sys/class/gpio/gpio10/direction',
        'echo 0 > /sys/class/gpio/gpio10/value'
    ];
    
    exec(commands.join(' && '), function(error, stdout, stderr) {
        if (error) {
            self.logger.error('FanController: GPIO setup failed: ' + error);
            defer.reject(error);
        } else {
            self.logger.info('FanController: GPIO setup completed');
            defer.resolve();
        }
    });
    
    return defer.promise;
};

FanController.prototype.calculateFanSpeed = function(temp) {
    var self = this;
    var minTemp = self.config.get('min_temp');
    var maxTemp = self.config.get('max_temp');
    
    if (temp < minTemp) return 0;
    if (temp >= maxTemp) return 100;
    
    // Линейное преобразование: 46°C = 1%, 70°C = 100%
    var speed = Math.round(((temp - minTemp) / (maxTemp - minTemp)) * 99) + 1;
    
    // Гарантируем минимум 1% при достижении порога
    if (temp >= minTemp && speed < 1) return 1;
    
    return Math.min(Math.max(speed, 1), 100);
};

FanController.prototype.applyPWM = function(speed) {
    var self = this;
    
    if (speed === self.currentSpeed) return;
    
    self.currentSpeed = speed;
    self.config.set('fan_speed', speed);
    
    self.logger.info('FanController: Setting PWM to ' + speed + '% at 50Hz');
    
    // Запускаем Software PWM
    self.startSoftwarePWM(speed);
};

FanController.prototype.startSoftwarePWM = function(speed) {
    var self = this;
    
    // Останавливаем предыдущий PWM
    if (self.softwarePWMInterval) {
        clearInterval(self.softwarePWMInterval);
        self.softwarePWMInterval = null;
    }
    
    if (speed === 0) {
        exec('echo 0 > /sys/class/gpio/gpio10/value');
        return;
    }
    
    // Реализация Software PWM 50Hz (20ms период)
    var periodMs = 20; // 50Hz = 20ms период
    var onTimeMs = (speed / 100) * periodMs;
    var offTimeMs = periodMs - onTimeMs;
    
    var pwmCycle = function() {
        exec('echo 1 > /sys/class/gpio/gpio10/value');
        setTimeout(function() {
            exec('echo 0 > /sys/class/gpio/gpio10/value');
        }, onTimeMs);
    };
    
    // Запускаем PWM цикл
    pwmCycle();
    self.softwarePWMInterval = setInterval(pwmCycle, periodMs);
};

FanController.prototype.startFanControl = function() {
    var self = this;
    var defer = libQ.defer();
    
    if (self.isRunning) {
        defer.resolve();
        return defer.promise;
    }
    
    self.stopFanControl();
    
    if (!self.config.get('enabled')) {
        defer.resolve();
        return defer.promise;
    }
    
    self.logger.info('FanController: Starting fan control - 50Hz PWM on GPIO 10');
    
    // Настраиваем GPIO
    self.setupGPIO().then(function() {
        self.isRunning = true;
        self.logger.info('FanController: Fan control started');
        
        // Первоначальная установка скорости
        self.getSystemTemperature().then(function(temp) {
            var speed = self.calculateFanSpeed(temp);
            self.applyPWM(speed);
            self.logger.info('FanController: Initial temperature ' + temp.toFixed(1) + '°C → ' + speed + '%');
        }).fail(function(error) {
            self.logger.warn('FanController: Temperature read failed, setting fan to 50%');
            self.applyPWM(50);
        });
        
        // Запускаем интервал контроля температуры
        self.fanInterval = setInterval(function() {
            if (!self.isRunning) return;
            
            self.getSystemTemperature().then(function(temp) {
                var newSpeed = self.calculateFanSpeed(temp);
                
                if (newSpeed !== self.currentSpeed) {
                    self.applyPWM(newSpeed);
                    self.logger.debug('FanController: ' + temp.toFixed(1) + '°C → ' + newSpeed + '%');
                }
            }).fail(function(error) {
                self.logger.error('FanController: Temperature check failed: ' + error);
            });
        }, self.config.get('check_interval') * 1000);
        
        defer.resolve();
    }).fail(function(error) {
        self.logger.error('FanController: Fan control startup failed: ' + error);
        defer.reject(error);
    });
    
    return defer.promise;
};

FanController.prototype.stopFanControl = function() {
    var self = this;
    
    self.isRunning = false;
    
    if (self.fanInterval) {
        clearInterval(self.fanInterval);
        self.fanInterval = null;
    }
    
    if (self.softwarePWMInterval) {
        clearInterval(self.softwarePWMInterval);
        self.softwarePWMInterval = null;
    }
    
    // Выключаем GPIO
    exec('echo 0 > /sys/class/gpio/gpio10/value', function() {});
    
    self.currentSpeed = 0;
    self.logger.info('FanController: Fan control stopped');
};

FanController.prototype.cleanupPWM = function() {
    var self = this;
    
    self.stopFanControl();
    
    setTimeout(function() {
        exec('echo 10 > /sys/class/gpio/unexport', function() {});
    }, 1000);
};

FanController.prototype.restartFanControl = function() {
    var self = this;
    var defer = libQ.defer();
    
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