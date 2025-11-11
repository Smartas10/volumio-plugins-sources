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
    
    // GPIO configuration
    self.GPIO_PIN = 14;  // Physical Pin 8 = GPIO 14
    self.GPIO_BASE_PATH = '/sys/class/gpio';
    
    // PWM configuration - FIXED 50Hz
    self.PWM_FREQUENCY = 50;     // 50 Hz fixed frequency
    self.PWM_PERIOD_MS = 20;     // 20ms period (1000/50)
    self.MIN_TEMP = 20;          // Fan starts at 20°C
    self.MAX_TEMP = 80;          // Full speed at 80°C
    
    self.fanInterval = null;
    self.pwmInterval = null;
    self.lastSpeed = 0;
    self.isInitialized = false;
}

FanController.prototype.onVolumioStart = function() {
    var self = this;
    self.configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
    
    return self.loadConfig().then(function() {
        self.logger.info('FanController: Starting 50Hz PWM control - GPIO ' + self.GPIO_PIN);
        self.logger.info('FanController: Temperature range ' + self.MIN_TEMP + '°C to ' + self.MAX_TEMP + '°C');
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
        enabled: true,  // Auto-start by default
        gpio_pin: self.GPIO_PIN,
        min_temp: self.MIN_TEMP,    // 20°C
        max_temp: self.MAX_TEMP,    // 80°C
        check_interval: 10,         // Check every 10 seconds
        fan_speed: 0,
        use_pwm: true               // Always use PWM
    };
    
    Object.keys(defaults).forEach(function(key) {
        if (!self.config.has(key)) {
            self.config.set(key, defaults[key]);
        }
    });
};

// Web Interface Methods
FanController.prototype.getUIConfig = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.getSystemTemperature().then(function(temp) {
        var speed = self.calculateFanSpeed(temp);
        var config = {
            "enabled": self.config.get('enabled'),
            "min_temp": self.MIN_TEMP,
            "max_temp": self.MAX_TEMP,
            "check_interval": self.config.get('check_interval'),
            "fan_speed": speed,
            "use_pwm": true,
            "current_temp": temp.toFixed(1),
            "current_speed": speed,
            "pwm_frequency": "50 Hz",
            "pwm_voltage": "5V",
            "gpio_info": "GPIO 14 (Physical Pin 8)"
        };
        
        defer.resolve(config);
    });
    
    return defer.promise;
};

FanController.prototype.updateUIConfig = function(data) {
    var self = this;
    var defer = libQ.defer();
    
    // Only allow changing enabled state and check interval
    self.config.set('enabled', data.enabled);
    self.config.set('check_interval', parseInt(data.check_interval));
    
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
        return 'Fan control ENABLED - 50Hz PWM 20-80°C';
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
            pwm_frequency: '50 Hz',
            pwm_voltage: '5V',
            temp_range: self.MIN_TEMP + '°C - ' + self.MAX_TEMP + '°C',
            duty_cycle: 'ON: ' + ((speed/100)*self.PWM_PERIOD_MS).toFixed(1) + 'ms, OFF: ' + (self.PWM_PERIOD_MS - (speed/100)*self.PWM_PERIOD_MS).toFixed(1) + 'ms'
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
        
        // Fallback to thermal zone
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
                        defer.resolve();
                    });
                });
            }, 500);
        });
    }, 500);
    
    return defer.promise;
};

FanController.prototype.calculateFanSpeed = function(temp) {
    var self = this;
    // Linear PWM: 20°C = 0%, 80°C = 100%
    if (temp <= self.MIN_TEMP) return 0;
    if (temp >= self.MAX_TEMP) return 100;
    return Math.round(((temp - self.MIN_TEMP) / (self.MAX_TEMP - self.MIN_TEMP)) * 100);
};

FanController.prototype.applyPWM = function(speed) {
    var self = this;
    
    // Clear any existing PWM
    if (self.pwmInterval) {
        clearInterval(self.pwmInterval);
        self.pwmInterval = null;
    }
    
    // Handle 0% and 100% specially
    if (speed === 0) {
        exec('echo 0 > ' + self.GPIO_BASE_PATH + '/gpio' + self.GPIO_PIN + '/value');
        return;
    }
    
    if (speed === 100) {
        exec('echo 1 > ' + self.GPIO_BASE_PATH + '/gpio' + self.GPIO_PIN + '/value');
        return;
    }
    
    // 50Hz PWM with variable duty cycle
    var onTime = (speed / 100) * self.PWM_PERIOD_MS;  // HIGH time
    var offTime = self.PWM_PERIOD_MS - onTime;         // LOW time
    
    self.pwmInterval = setInterval(function() {
        // HIGH period
        exec('echo 1 > ' + self.GPIO_BASE_PATH + '/gpio' + self.GPIO_PIN + '/value');
        
        // LOW period after onTime
        setTimeout(function() {
            exec('echo 0 > ' + self.GPIO_BASE_PATH + '/gpio' + self.GPIO_PIN + '/value');
        }, onTime);
        
    }, self.PWM_PERIOD_MS); // Fixed 20ms period = 50Hz
};

FanController.prototype.startFanControl = function() {
    var self = this;
    
    self.stopFanControl();
    
    if (self.config.get('enabled')) {
        self.setupGPIO().then(function() {
            self.logger.info('FanController: 50Hz PWM started - Temperature range: ' + self.MIN_TEMP + '°C to ' + self.MAX_TEMP + '°C');
            
            self.fanInterval = setInterval(function() {
                self.getSystemTemperature().then(function(temp) {
                    var speed = self.calculateFanSpeed(temp);
                    
                    if (speed !== self.lastSpeed) {
                        self.applyPWM(speed);
                        self.config.set('fan_speed', speed);
                        self.logger.info('FanController: ' + temp.toFixed(1) + '°C → 50Hz PWM ' + speed + '% duty');
                        self.lastSpeed = speed;
                    }
                });
            }, self.config.get('check_interval') * 1000);
        });
    } else {
        self.applyPWM(0);
        self.logger.info('FanController: Fan control disabled - PWM stopped');
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
        exec('echo ' + self.GPIO_PIN + ' > ' + self.GPIO_BASE_PATH + '/unexport');
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
    this.logger.info('FanController: Plugin installed - 50Hz PWM 20-80°C');
    return libQ.resolve();
};

FanController.prototype.onUninstall = function() {
    this.onVolumioShutdown();
    return libQ.resolve();
};