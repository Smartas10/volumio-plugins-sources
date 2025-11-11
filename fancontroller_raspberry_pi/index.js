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
    
    self.GPIO_PIN = 14;
    self.GPIO_BASE_PATH = '/sys/class/gpio';
    
    self.fanInterval = null;
    self.pwmInterval = null;
    self.isInitialized = false;
    self.useHardwarePWM = false;
}

FanController.prototype.onVolumioStart = function() {
    var self = this;
    self.configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
    
    return self.loadConfig().then(function() {
        self.logger.info('FanController: Starting plugin - GPIO ' + self.GPIO_PIN);
        self.checkPWMSupport();
        self.startFanControl();
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
        enabled: false,
        gpio_pin: self.GPIO_PIN,
        min_temp: 20,
        max_temp: 50,
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

FanController.prototype.checkPWMSupport = function() {
    var self = this;
    
    exec('gpio -v', function(error) {
        self.useHardwarePWM = !error;
        self.logger.info('FanController: ' + (self.useHardwarePWM ? 'Hardware' : 'Software') + ' PWM');
    });
};

// Web Interface Methods
FanController.prototype.getUIConfig = function() {
    var self = this;
    var defer = libQ.defer();
    
    var langCode = this.commandRouter.sharedVars.get('language_code');
    
    self.getSystemTemperature().then(function(temp) {
        var config = {
            "enabled": self.config.get('enabled'),
            "min_temp": self.config.get('min_temp'),
            "max_temp": self.config.get('max_temp'), 
            "check_interval": self.config.get('check_interval'),
            "fan_speed": self.config.get('fan_speed'),
            "use_pwm": self.config.get('use_pwm'),
            "current_temp": temp.toFixed(1),
            "current_speed": self.config.get('fan_speed')
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
    self.config.set('fan_speed', parseInt(data.fan_speed));
    self.config.set('use_pwm', data.use_pwm);
    
    self.saveConfig().then(function() {
        self.restartFanControl();
        defer.resolve();
    });
    
    return defer.promise;
};

// Console Commands
FanController.prototype.getConsoleCommands = function() {
    var self = this;
    
    return [
        {
            command: 'fancontroller-enable',
            description: 'Enable automatic fan control',
            executable: true,
            handler: self.enableFanControl.bind(self)
        },
        {
            command: 'fancontroller-disable', 
            description: 'Disable automatic fan control',
            executable: true,
            handler: self.disableFanControl.bind(self)
        },
        {
            command: 'fancontroller-setSpeed',
            description: 'Set manual fan speed (0-100)',
            executable: true,
            parameters: [{ name: 'speed', type: 'integer', min: 0, max: 100 }],
            handler: self.setFanSpeedCommand.bind(self)
        },
        {
            command: 'fancontroller-status',
            description: 'Get current status',
            executable: true,
            handler: self.getStatus.bind(self)
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

FanController.prototype.setFanSpeedCommand = function(speed) {
    var self = this;
    speed = Math.max(0, Math.min(100, parseInt(speed)));
    self.config.set('fan_speed', speed);
    return self.saveConfig().then(function() {
        if (self.config.get('enabled')) {
            self.applyFanSpeed(speed);
        }
        return 'Fan speed: ' + speed + '%';
    });
};

FanController.prototype.getStatus = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.getSystemTemperature().then(function(temp) {
        var status = {
            enabled: self.config.get('enabled'),
            temperature: temp.toFixed(1),
            speed: self.config.get('fan_speed'),
            gpio: 'GPIO ' + self.GPIO_PIN,
            min_temp: self.config.get('min_temp'),
            max_temp: self.config.get('max_temp'),
            pwm_mode: self.useHardwarePWM ? 'Hardware' : 'Software'
        };
        defer.resolve(JSON.stringify(status, null, 2));
    });
    
    return defer.promise;
};

FanController.prototype.getSystemTemperature = function() {
    var self = this;
    var defer = libQ.defer();
    
    exec('vcgencmd measure_temp', function(error, stdout) {
        if (!error) {
            var tempMatch = stdout.match(/temp=([0-9.]+)'C/);
            if (tempMatch) {
                defer.resolve(parseFloat(tempMatch[1]));
                return;
            }
        }
        
        // Fallback
        fs.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8', function(err, data) {
            if (!err) {
                defer.resolve(parseInt(data) / 1000);
            } else {
                defer.resolve(25); // Default temperature
            }
        });
    });
    
    return defer.promise;
};

FanController.prototype.setupGPIO = function() {
    var self = this;
    var defer = libQ.defer();
    
    // Cleanup first
    exec('echo ' + self.GPIO_PIN + ' > ' + self.GPIO_BASE_PATH + '/unexport', function() {});
    
    setTimeout(function() {
        exec('echo ' + self.GPIO_PIN + ' > ' + self.GPIO_BASE_PATH + '/export', function(error) {
            setTimeout(function() {
                var gpioPath = self.GPIO_BASE_PATH + '/gpio' + self.GPIO_PIN;
                exec('echo out > ' + gpioPath + '/direction', function() {
                    exec('echo 0 > ' + gpioPath + '/value', function() {
                        if (self.useHardwarePWM && self.config.get('use_pwm')) {
                            exec('gpio -g mode ' + self.GPIO_PIN + ' pwm', function() {
                                defer.resolve();
                            });
                        } else {
                            defer.resolve();
                        }
                    });
                });
            }, 500);
        });
    }, 500);
    
    return defer.promise;
};

FanController.prototype.applyFanSpeed = function(speed) {
    var self = this;
    
    if (self.pwmInterval) {
        clearInterval(self.pwmInterval);
        self.pwmInterval = null;
    }
    
    if (!self.config.get('use_pwm') || speed === 0 || speed === 100) {
        var value = speed > 0 ? 1 : 0;
        exec('echo ' + value + ' > ' + self.GPIO_BASE_PATH + '/gpio' + self.GPIO_PIN + '/value');
        return;
    }
    
    if (self.useHardwarePWM) {
        exec('gpio -g pwm ' + self.GPIO_PIN + ' ' + Math.round(speed));
    } else {
        self.softwarePWM(speed);
    }
};

FanController.prototype.softwarePWM = function(speed) {
    var self = this;
    var gpioPath = self.GPIO_BASE_PATH + '/gpio' + self.GPIO_PIN;
    var period = 20; // 50Hz
    var onTime = (speed / 100) * period;
    
    self.pwmInterval = setInterval(function() {
        exec('echo 1 > ' + gpioPath + '/value');
        setTimeout(function() {
            exec('echo 0 > ' + gpioPath + '/value');
        }, onTime);
    }, period);
};

FanController.prototype.startFanControl = function() {
    var self = this;
    
    self.stopFanControl();
    
    if (self.config.get('enabled')) {
        self.setupGPIO().then(function() {
            self.fanInterval = setInterval(function() {
                self.getSystemTemperature().then(function(temp) {
                    var minTemp = self.config.get('min_temp');
                    var maxTemp = self.config.get('max_temp');
                    var currentSpeed = self.config.get('fan_speed');
                    
                    var newSpeed;
                    if (temp <= minTemp) {
                        newSpeed = 0;
                    } else if (temp >= maxTemp) {
                        newSpeed = 100;
                    } else {
                        newSpeed = Math.round(((temp - minTemp) / (maxTemp - minTemp)) * 100);
                        newSpeed = Math.max(0, Math.min(100, newSpeed));
                    }
                    
                    if (newSpeed !== currentSpeed) {
                        self.applyFanSpeed(newSpeed);
                        self.config.set('fan_speed', newSpeed);
                        self.logger.info('FanController: ' + temp.toFixed(1) + '°C → ' + newSpeed + '%');
                    }
                });
            }, self.config.get('check_interval') * 1000);
        });
    } else {
        self.applyFanSpeed(0);
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
    
    self.applyFanSpeed(0);
};

FanController.prototype.cleanupGPIO = function() {
    var self = this;
    
    self.stopFanControl();
    
    setTimeout(function() {
        exec('echo ' + self.GPIO_PIN + ' > ' + self.GPIO_BASE_PATH + '/unexport');
        if (self.useHardwarePWM) {
            exec('gpio unexport ' + self.GPIO_PIN);
        }
    }, 1000);
};

FanController.prototype.restartFanControl = function() {
    this.stopFanControl();
    setTimeout(this.startFanControl.bind(this), 1000);
};

// Plugin lifecycle
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
    this.logger.info('FanController: Plugin installed');
    return libQ.resolve();
};

FanController.prototype.onUninstall = function() {
    this.onVolumioShutdown();
    return libQ.resolve();
};