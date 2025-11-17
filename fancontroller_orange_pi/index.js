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
    self.TURN_ON_TEMP = 55;
    self.TURN_OFF_TEMP = 45;
    
    self.fanInterval = null;
    self.currentState = false; // false = выключен, true = включен
    self.isInitialized = false;
    self.isRunning = false;
}

FanController.prototype.onVolumioStart = function() {
    var self = this;
    self.configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
    
    self.logger.info('FanController: Starting plugin - GPIO 10, ON at 55°C, OFF at 45°C');
    
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
                this.testFan.bind(this),
                'Test fan for 5 seconds'
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
        self.commandRouter.pushConsoleMessage('FanController: Started - GPIO 10, ON at 55°C, OFF at 45°C');
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
        turn_on_temp: 55,
        turn_off_temp: 45,
        check_interval: 10,
        gpio_pin: 10
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
            turn_on_temp: self.config.get('turn_on_temp'),
            turn_off_temp: self.config.get('turn_off_temp'),
            check_interval: self.config.get('check_interval'),
            current_temp: temp.toFixed(1),
            current_state: self.currentState ? 'ON' : 'OFF',
            gpio_pin: "GPIO 10 (Physical Pin 35)",
            platform: self.getPlatformInfo(),
            temp_sensor: "thermal_zone0",
            is_running: self.isRunning
        };
        
        defer.resolve(config);
    }).fail(function(error) {
        var fallbackConfig = {
            enabled: self.config.get('enabled'),
            turn_on_temp: self.config.get('turn_on_temp'),
            turn_off_temp: self.config.get('turn_off_temp'),
            check_interval: self.config.get('check_interval'),
            current_temp: "--",
            current_state: self.currentState ? 'ON' : 'OFF',
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
    self.config.set('turn_on_temp', parseInt(data.turn_on_temp));
    self.config.set('turn_off_temp', parseInt(data.turn_off_temp));
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
            description: 'Test fan for 5 seconds',
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
            current_state: self.currentState ? 'ON' : 'OFF',
            gpio: 'GPIO 10 (Physical Pin 35)',
            platform: self.getPlatformInfo(),
            turn_on_temp: self.config.get('turn_on_temp') + '°C',
            turn_off_temp: self.config.get('turn_off_temp') + '°C',
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

FanController.prototype.testFan = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('FanController: Testing fan');
    
    var wasEnabled = self.config.get('enabled');
    var wasRunning = self.isRunning;
    
    self.stopFanControl();
    
    // Включаем вентилятор на 5 секунд
    self.setFanState(true);
    
    setTimeout(function() {
        self.setFanState(false);
        if (wasEnabled && wasRunning) {
            self.startFanControl();
        }
        defer.resolve('Fan test completed - ran for 5 seconds');
    }, 5000);
    
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
                    defer.resolve(40);
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
    
    self.logger.info('FanController: Setting up GPIO 10');
    
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

FanController.prototype.shouldTurnOnFan = function(temp) {
    var self = this;
    var turnOnTemp = self.config.get('turn_on_temp');
    var turnOffTemp = self.config.get('turn_off_temp');
    
    // Если вентилятор выключен и температура достигла порога включения
    if (!self.currentState && temp >= turnOnTemp) {
        return true;
    }
    
    // Если вентилятор включен и температура упала ниже порога выключения
    if (self.currentState && temp <= turnOffTemp) {
        return false;
    }
    
    // Состояние не меняется
    return self.currentState;
};

FanController.prototype.setFanState = function(state) {
    var self = this;
    
    if (state === self.currentState) return;
    
    self.currentState = state;
    var value = state ? 1 : 0;
    
    self.logger.info('FanController: Setting fan ' + (state ? 'ON' : 'OFF'));
    
    exec('echo ' + value + ' > /sys/class/gpio/gpio10/value', function(error) {
        if (error) {
            self.logger.error('FanController: Failed to set fan state: ' + error);
        } else {
            self.logger.info('FanController: Fan turned ' + (state ? 'ON' : 'OFF'));
        }
    });
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
    
    self.logger.info('FanController: Starting fan control - GPIO 10');
    
    // Настраиваем GPIO
    self.setupGPIO().then(function() {
        self.isRunning = true;
        self.logger.info('FanController: Fan control started');
        
        // Первоначальная установка состояния
        self.getSystemTemperature().then(function(temp) {
            var shouldBeOn = self.shouldTurnOnFan(temp);
            self.setFanState(shouldBeOn);
            self.logger.info('FanController: Initial temperature ' + temp.toFixed(1) + '°C → ' + (shouldBeOn ? 'ON' : 'OFF'));
        }).fail(function(error) {
            self.logger.warn('FanController: Temperature read failed, turning fan OFF');
            self.setFanState(false);
        });
        
        // Запускаем интервал контроля температуры
        self.fanInterval = setInterval(function() {
            if (!self.isRunning) return;
            
            self.getSystemTemperature().then(function(temp) {
                var newState = self.shouldTurnOnFan(temp);
                
                if (newState !== self.currentState) {
                    self.setFanState(newState);
                    self.logger.info('FanController: ' + temp.toFixed(1) + '°C → ' + (newState ? 'ON' : 'OFF'));
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
    
    // Выключаем вентилятор
    self.setFanState(false);
    
    self.logger.info('FanController: Fan control stopped');
};

FanController.prototype.cleanupGPIO = function() {
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