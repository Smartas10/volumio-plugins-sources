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
    
    // Конфигурация для Raspberry Pi 3
    self.GPIO_PIN = 14;           // GPIO 14 = Physical Pin 8
    self.PWM_FREQUENCY = 50;      // 50 Hz
    self.PWM_PERIOD_MS = 20;      // 20ms период
    self.MIN_TEMP = 20;           // Вентилятор включается с 20°C
    self.MAX_TEMP = 80;           // Полная скорость с 80°C
    
    self.fanInterval = null;
    self.pwmInterval = null;
    self.currentSpeed = 0;
    self.isInitialized = false;
}

FanController.prototype.onVolumioStart = function() {
    var self = this;
    self.configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
    
    return self.loadConfig().then(function() {
        self.logger.info('FanController: Starting on Raspberry Pi 3 - GPIO ' + self.GPIO_PIN);
        self.startFanControl();
        self.isInitialized = true;
    }).fail(function(error) {
        self.logger.error('FanController: Startup error: ' + error);
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
        })
        .fail(function() {
            self.setupDefaults();
            return self.saveConfig();
        });
};

FanController.prototype.saveConfig = function() {
    var self = this;
    var configJson = JSON.stringify(self.config.get(), null, 4);
    
    return libQ.nfcall(fs.writeFile, self.configFile, configJson, 'utf8')
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
        use_pwm: true
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
            platform: "Raspberry Pi 3"
        };
        
        defer.resolve(config);
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
        return 'Fan control ENABLED on Raspberry Pi 3';
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
            platform: 'Raspberry Pi 3',
            pwm: '50Hz',
            temp_range: self.MIN_TEMP + '°C - ' + self.MAX_TEMP + '°C'
        };
        defer.resolve(JSON.stringify(status, null, 2));
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
    
    // Используем vcgencmd для Raspberry Pi
    exec('vcgencmd measure_temp', function(error, stdout) {
        if (!error && stdout) {
            var tempMatch = stdout.match(/temp=([0-9.]+)'C/);
            if (tempMatch) {
                defer.resolve(parseFloat(tempMatch[1]));
                return;
            }
        }
        
        self.logger.error('FanController: vcgencmd failed, using thermal zone');
        fs.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8', function(err, data) {
            if (!err && data) {
                defer.resolve(parseInt(data) / 1000);
            } else {
                defer.resolve(35);
            }
        });
    });
    
    return defer.promise;
};

FanController.prototype.setupGPIO = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('FanController: Setting up GPIO 14 on Raspberry Pi 3');
    
    // Используем wiringPi для Raspberry Pi
    exec('gpio mode ' + self.GPIO_PIN + ' out', function(error) {
        if (error) {
            self.logger.error('FanController: wiringPi failed, using sysfs');
            // Fallback to sysfs
            exec('echo ' + self.GPIO_PIN + ' > /sys/class/gpio/unexport 2>/dev/null', function() {
                setTimeout(function() {
                    exec('echo ' + self.GPIO_PIN + ' > /sys/class/gpio/export', function() {
                        setTimeout(function() {
                            exec('echo out > /sys/class/gpio/gpio14/direction', function() {
                                exec('echo 0 > /sys/class/gpio/gpio14/value', function() {
                                    defer.resolve();
                                });
                            });
                        }, 500);
                    });
                }, 500);
            });
        } else {
            exec('gpio write ' + self.GPIO_PIN + ' 0', function() {
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
    
    self.currentSpeed = speed;
    
    if (speed === 0) {
        exec('gpio write ' + self.GPIO_PIN + ' 0', function(error) {
            if (error) {
                exec('echo 0 > /sys/class/gpio/gpio14/value', function() {});
            }
        });
        return;
    }
    
    if (speed === 100) {
        exec('gpio write ' + self.GPIO_PIN + ' 1', function(error) {
            if (error) {
                exec('echo 1 > /sys/class/gpio/gpio14/value', function() {});
            }
        });
        return;
    }
    
    // 50Hz PWM
    var onTime = (speed / 100) * self.PWM_PERIOD_MS;
    
    self.pwmInterval = setInterval(function() {
        exec('gpio write ' + self.GPIO_PIN + ' 1', function(error) {
            if (error) {
                exec('echo 1 > /sys/class/gpio/gpio14/value', function() {});
            }
        });
        
        setTimeout(function() {
            exec('gpio write ' + self.GPIO_PIN + ' 0', function(error) {
                if (error) {
                    exec('echo 0 > /sys/class/gpio/gpio14/value', function() {});
                }
            });
        }, onTime);
        
    }, self.PWM_PERIOD_MS);
};

FanController.prototype.startFanControl = function() {
    var self = this;
    
    self.stopFanControl();
    
    if (self.config.get('enabled')) {
        self.setupGPIO().then(function() {
            self.logger.info('FanController: 50Hz PWM control started on RPi3');
            
            self.fanInterval = setInterval(function() {
                self.getSystemTemperature().then(function(temp) {
                    var newSpeed = self.calculateFanSpeed(temp);
                    
                    if (newSpeed !== self.currentSpeed) {
                        self.applyPWM(newSpeed);
                        self.config.set('fan_speed', newSpeed);
                        self.logger.info('FanController RPi3: ' + temp.toFixed(1) + '°C → ' + newSpeed + '% PWM');
                    }
                });
            }, self.config.get('check_interval') * 1000);
            
        }).fail(function(error) {
            self.logger.error('FanController: Failed to start - ' + error);
        });
    } else {
        self.applyPWM(0);
    }
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
};

FanController.prototype.cleanupGPIO = function() {
    var self = this;
    
    self.stopFanControl();
    
    setTimeout(function() {
        exec('gpio write ' + self.GPIO_PIN + ' 0', function() {});
        exec('echo ' + self.GPIO_PIN + ' > /sys/class/gpio/unexport 2>/dev/null', function() {});
    }, 1000);
};

FanController.prototype.restartFanControl = function() {
    this.stopFanControl();
    setTimeout(this.startFanControl.bind(this), 2000);
};

// Жизненный цикл плагина
FanController.prototype.onStart = function() {
    this.onVolumioStart();
};

FanController.prototype.onStop = function() {
    this.onVolumioShutdown();
};

FanController.prototype.onRestart = function() {
    this.onVolumioStart();
};

FanController.prototype.onInstall = function() {
    this.logger.info('FanController: Installed on Raspberry Pi 3');
    return libQ.resolve();
};

FanController.prototype.onUninstall = function() {
    this.onVolumioShutdown();
    return libQ.resolve();
};