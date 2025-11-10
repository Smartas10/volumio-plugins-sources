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
    
    // GPIO configuration for Raspberry Pi - Pin 8 = GPIO 14 (BCM)
    self.GPIO_PIN = 14;  // Physical Pin 8 on Raspberry Pi = GPIO 14 (BCM)
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
        self.logger.info('FanController: Plugin started for Raspberry Pi - Using GPIO ' + self.GPIO_PIN + ' (Pin 8)');
        self.logger.info('FanController: PWM 50Hz control - Temperature based duty cycle');
        self.checkPWMSupport();
        self.startFanControl();
        self.isInitialized = true;
    }).fail(function(error) {
        self.logger.error('FanController: Error during startup: ' + error);
    });
};

FanController.prototype.onVolumioShutdown = function() {
    var self = this;
    self.stopFanControl();
    self.cleanupGPIO();
    self.logger.info('FanController: Plugin stopped - GPIO cleaned up');
};

FanController.prototype.getConfigurationFiles = function() {
    return ['config.json'];
};

FanController.prototype.loadConfig = function() {
    var self = this;
    
    return libQ.nfcall(fs.readFile, self.configFile, 'utf8')
        .then(function(data) {
            try {
                self.config = new (require('v-conf'))();
                self.config.load(JSON.parse(data));
                self.setupDefaults();
                self.logger.info('FanController: Configuration loaded successfully');
            } catch (e) {
                self.logger.error('FanController: Error loading config, using defaults: ' + e);
                self.setupDefaults();
            }
        })
        .fail(function(err) {
            self.logger.error('FanController: Could not load config file, using defaults: ' + err);
            self.setupDefaults();
            return self.saveConfig();
        });
};

FanController.prototype.saveConfig = function() {
    var self = this;
    var configJson = JSON.stringify(self.config.get(), null, 4);
    
    return libQ.nfcall(fs.writeFile, self.configFile, configJson, 'utf8')
        .then(function() {
            self.logger.debug('FanController: Configuration saved');
        })
        .fail(function(err) {
            self.logger.error('FanController: Could not save config: ' + err);
        });
};

FanController.prototype.setupDefaults = function() {
    var self = this;
    
    var defaults = {
        'enabled': false,
        'gpio_pin': self.GPIO_PIN,  // Fixed to GPIO 14 (Pin 8)
        'min_temp': 20,    // Fan starts at 20°C
        'max_temp': 50,    // Full speed at 50°C
        'check_interval': 10,
        'fan_speed': 0,
        'use_pwm': true    // PWM enabled by default
    };
    
    for (var key in defaults) {
        if (!self.config.has(key)) {
            self.config.set(key, defaults[key]);
        }
    }
};

FanController.prototype.checkPWMSupport = function() {
    var self = this;
    
    exec('gpio -v', function(error) {
        if (!error) {
            self.useHardwarePWM = true;
            self.logger.info('FanController: Hardware PWM support detected (wiringPi)');
        } else {
            self.useHardwarePWM = false;
            self.logger.info('FanController: Using software PWM fallback');
        }
    });
};

FanController.prototype.getUIConfig = function() {
    var self = this;
    var defer = libQ.defer();
    
    var langCode = this.commandRouter.sharedVars.get('language_code');
    
    self.loadI18nStrings(langCode).then(function(i18n) {
        var config = {
            "enabled": self.config.get('enabled'),
            "gpio_pin": self.config.get('gpio_pin'),
            "min_temp": self.config.get('min_temp'),
            "max_temp": self.config.get('max_temp'),
            "check_interval": self.config.get('check_interval'),
            "fan_speed": self.config.get('fan_speed'),
            "use_pwm": self.config.get('use_pwm')
        };
        
        self.commandRouter.i18nJson(__dirname + '/i18n/strings_' + langCode + '.json',
            __dirname + '/UIConfig.json')
        .then(function(uiconf) {
            // Fill UI configuration with current values
            uiconf.sections[0].content[0].value = config.enabled;
            uiconf.sections[0].content[1].value = config.gpio_pin;
            uiconf.sections[0].content[2].value = config.min_temp;
            uiconf.sections[0].content[3].value = config.max_temp;
            uiconf.sections[0].content[4].value = config.check_interval;
            uiconf.sections[0].content[5].value = config.use_pwm;
            uiconf.sections[1].content[0].value = config.fan_speed;
            
            // Update status section with real-time data
            self.updateStatusDisplay(uiconf);
            
            defer.resolve(uiconf);
        })
        .fail(function(error) {
            self.logger.error('FanController: Could not load UI config: ' + error);
            defer.reject(error);
        });
    });
    
    return defer.promise;
};

FanController.prototype.updateStatusDisplay = function(uiconf) {
    var self = this;
    
    // Get current temperature
    self.getSystemTemperature().then(function(temp) {
        uiconf.sections[2].content[0].value = temp.toFixed(1) + '°C';
        uiconf.sections[2].content[1].value = self.config.get('fan_speed') + '% (PWM)';
        uiconf.sections[2].content[2].value = 'GPIO ' + self.GPIO_PIN + ' - Physical Pin 8 (BCM)';
        uiconf.sections[2].content[3].value = 'Fan+: Pin 8, Fan-: Pin 9(GND)';
        uiconf.sections[2].content[4].value = 'PWM 50Hz - ' + (self.useHardwarePWM ? 'Hardware' : 'Software') + ' PWM';
        
        // Add temperature status
        if (temp < 20) {
            uiconf.sections[2].content[0].value += ' (Cool)';
        } else if (temp < 40) {
            uiconf.sections[2].content[0].value += ' (Normal)';
        } else {
            uiconf.sections[2].content[0].value += ' (Hot)';
        }
    }).fail(function() {
        uiconf.sections[2].content[0].value = 'Error reading temperature';
    });
};

FanController.prototype.updateUIConfig = function() {
    var self = this;
    self.commandRouter.broadcastMessage('pushUiConfig', self.getUIConfig());
};

FanController.prototype.setUIConfig = function(data) {
    var self = this;
    
    // Validate input data
    var minTemp = parseInt(data.min_temp);
    var maxTemp = parseInt(data.max_temp);
    var interval = parseInt(data.check_interval);
    
    if (minTemp >= maxTemp) {
        self.logger.error('FanController: min_temp must be less than max_temp');
        return libQ.reject(new Error('Minimum temperature must be less than maximum temperature'));
    }
    
    if (interval < 5 || interval > 60) {
        self.logger.error('FanController: check_interval must be between 5 and 60 seconds');
        return libQ.reject(new Error('Check interval must be between 5 and 60 seconds'));
    }
    
    self.config.set('enabled', data.enabled);
    self.config.set('min_temp', minTemp);
    self.config.set('max_temp', maxTemp);
    self.config.set('check_interval', interval);
    self.config.set('use_pwm', data.use_pwm);
    
    return self.saveConfig().then(function() {
        self.restartFanControl();
        self.updateUIConfig();
        self.logger.info('FanController: Configuration updated - PWM Cooling: ' + minTemp + '°C to ' + maxTemp + '°C');
    });
};

FanController.prototype.setFanSpeed = function(speed) {
    var self = this;
    speed = parseInt(speed);
    
    if (speed < 0 || speed > 100) {
        self.logger.error('FanController: Fan speed must be between 0 and 100');
        return libQ.reject(new Error('Fan speed must be between 0 and 100'));
    }
    
    self.config.set('fan_speed', speed);
    return self.saveConfig().then(function() {
        if (self.config.get('enabled')) {
            self.applyFanSpeed(speed);
        }
        self.updateUIConfig();
        self.logger.info('FanController: Manual fan speed set to ' + speed + '% (PWM)');
    });
};

FanController.prototype.getSystemTemperature = function() {
    var self = this;
    var defer = libQ.defer();
    
    // For Raspberry Pi, prefer vcgencmd for accurate temperature reading
    exec('vcgencmd measure_temp', function(error, stdout) {
        if (!error) {
            var tempMatch = stdout.match(/temp=([0-9.]+)'C/);
            if (tempMatch) {
                defer.resolve(parseFloat(tempMatch[1]));
                return;
            }
        }
        
        // Fallback to thermal zone
        exec('cat /sys/class/thermal/thermal_zone0/temp', function(error2, stdout2) {
            if (!error2) {
                var temp = parseInt(stdout2);
                if (temp > 1000) { // Assume millidegrees
                    temp = temp / 1000;
                }
                if (temp > 0 && temp < 100) { // Reasonable temperature range
                    defer.resolve(temp);
                } else {
                    self.logger.error('FanController: Invalid temperature reading: ' + temp);
                    defer.resolve(0);
                }
            } else {
                self.logger.error('FanController: All temperature sources failed');
                defer.resolve(0);
            }
        });
    });
    
    return defer.promise;
};

FanController.prototype.setupGPIO = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('FanController: Setting up GPIO ' + self.GPIO_PIN + ' for PWM control');
    
    // Cleanup existing GPIO
    exec('echo ' + self.GPIO_PIN + ' > ' + self.GPIO_BASE_PATH + '/unexport', function(error) {
        // Ignore errors - GPIO might not be exported
    });
    
    // Wait before export
    setTimeout(function() {
        // Export GPIO pin
        exec('echo ' + self.GPIO_PIN + ' > ' + self.GPIO_BASE_PATH + '/export', function(error) {
            if (error) {
                self.logger.debug('FanController: GPIO ' + self.GPIO_PIN + ' already exported or busy');
            }
            
            // Wait for GPIO to be available
            setTimeout(function() {
                var gpioPath = self.GPIO_BASE_PATH + '/gpio' + self.GPIO_PIN;
                
                // Set direction to output
                exec('echo out > ' + gpioPath + '/direction', function(error) {
                    if (error) {
                        self.logger.error('FanController: Error setting GPIO direction: ' + error);
                        defer.reject(error);
                    } else {
                        // Initialize fan to off
                        exec('echo 0 > ' + gpioPath + '/value', function(error) {
                            if (error) {
                                self.logger.error('FanController: Error initializing fan state: ' + error);
                                defer.reject(error);
                            } else {
                                // Setup hardware PWM if available and enabled
                                if (self.useHardwarePWM && self.config.get('use_pwm')) {
                                    exec(`gpio -g mode ${self.GPIO_PIN} pwm`, function(error) {
                                        if (!error) {
                                            self.logger.info('FanController: Hardware PWM initialized on GPIO ' + self.GPIO_PIN);
                                        }
                                        defer.resolve();
                                    });
                                } else {
                                    self.logger.info('FanController: GPIO ' + self.GPIO_PIN + ' configured for PWM control');
                                    defer.resolve();
                                }
                            }
                        });
                    }
                });
            }, 500);
        });
    }, 500);
    
    return defer.promise;
};

FanController.prototype.applyFanSpeed = function(speed) {
    var self = this;
    
    if (self.config.get('use_pwm')) {
        // Реализация PWM с частотой 50 Гц
        self.applyPWM(speed);
    } else {
        // Простой ON/OFF режим
        var gpioPath = self.GPIO_BASE_PATH + '/gpio' + self.GPIO_PIN;
        var value = speed > 0 ? 1 : 0;
        
        exec('echo ' + value + ' > ' + gpioPath + '/value', function(error) {
            if (error) {
                self.logger.error('FanController: Error setting fan speed: ' + error);
            } else {
                self.logger.debug('FanController: Fan ' + (value ? 'ON' : 'OFF') + ' (Speed: ' + speed + '%)');
            }
        });
    }
};

FanController.prototype.applyPWM = function(speed) {
    var self = this;
    
    // Clear any existing software PWM
    if (self.pwmInterval) {
        clearInterval(self.pwmInterval);
        self.pwmInterval = null;
    }
    
    // Handle 0% and 100% specially
    if (speed === 0) {
        var gpioPath = self.GPIO_BASE_PATH + '/gpio' + self.GPIO_PIN;
        exec('echo 0 > ' + gpioPath + '/value', function(error) {
            if (!error) {
                self.logger.debug('FanController: PWM 0% - Fan OFF');
            }
        });
        return;
    }
    
    if (speed === 100) {
        var gpioPath = self.GPIO_BASE_PATH + '/gpio' + self.GPIO_PIN;
        exec('echo 1 > ' + gpioPath + '/value', function(error) {
            if (!error) {
                self.logger.debug('FanController: PWM 100% - Fan FULL');
            }
        });
        return;
    }
    
    // Try hardware PWM first if available
    if (self.useHardwarePWM) {
        // For hardware PWM, we need to use wiringPi
        // Note: Raspberry Pi hardware PWM frequency is fixed, we emulate 50Hz with duty cycle
        var pwmValue = Math.round(speed); // 0-100
        
        exec(`gpio -g pwm ${self.GPIO_PIN} ${pwmValue}`, function(error) {
            if (error) {
                self.logger.error('FanController: Hardware PWM failed, using software PWM');
                self.softwarePWM(speed);
            } else {
                self.logger.debug('FanController: Hardware PWM set to ' + speed + '%');
            }
        });
    } else {
        // Use software PWM
        self.softwarePWM(speed);
    }
};

FanController.prototype.softwarePWM = function(speed) {
    var self = this;
    var gpioPath = self.GPIO_BASE_PATH + '/gpio' + self.GPIO_PIN;
    
    // Software PWM с частотой 50 Гц (период 20ms)
    var period = 20; // 20ms для 50 Гц
    var onTime = (speed / 100) * period;
    var offTime = period - onTime;
    
    // Start PWM cycle
    function pwmCycle() {
        // Включить
        exec('echo 1 > ' + gpioPath + '/value', function(error) {
            if (error) {
                self.logger.error('FanController: Error setting GPIO high');
                return;
            }
        });
        
        // Выключить после onTime
        setTimeout(function() {
            exec('echo 0 > ' + gpioPath + '/value', function(error) {
                if (error) {
                    self.logger.error('FanController: Error setting GPIO low');
                }
            });
        }, onTime);
    }
    
    // Start the PWM interval
    self.pwmInterval = setInterval(pwmCycle, period);
    
    self.logger.debug('FanController: Software PWM 50Hz - Duty: ' + speed + '% (ON: ' + onTime.toFixed(1) + 'ms, OFF: ' + offTime.toFixed(1) + 'ms)');
};

FanController.prototype.startFanControl = function() {
    var self = this;
    
    // Clear existing interval
    if (self.fanInterval) {
        clearInterval(self.fanInterval);
        self.fanInterval = null;
    }
    
    // Clear PWM interval
    if (self.pwmInterval) {
        clearInterval(self.pwmInterval);
        self.pwmInterval = null;
    }
    
    if (self.config.get('enabled')) {
        self.logger.info('FanController: Starting PWM fan control (50Hz)');
        self.logger.info('FanController: Temperature range: ' + self.config.get('min_temp') + '°C to ' + self.config.get('max_temp') + '°C');
        
        self.setupGPIO().then(function() {
            // Start temperature monitoring
            self.fanInterval = setInterval(function() {
                self.getSystemTemperature().then(function(temp) {
                    var minTemp = self.config.get('min_temp');
                    var maxTemp = self.config.get('max_temp');
                    var currentSpeed = self.config.get('fan_speed');
                    
                    var newSpeed;
                    if (temp <= minTemp) {
                        newSpeed = 0; // Выключено ниже минимальной температуры
                    } else if (temp >= maxTemp) {
                        newSpeed = 100; // Полная скорость при максимальной температуре
                    } else {
                        // Линейная интерполяция между min и max температурой
                        // 20°C = 0%, 50°C = 100%
                        newSpeed = Math.round(((temp - minTemp) / (maxTemp - minTemp)) * 100);
                        newSpeed = Math.max(0, Math.min(100, newSpeed)); // Ограничение 0-100
                    }
                    
                    // Применяем только если скорость изменилась
                    if (newSpeed !== currentSpeed) {
                        self.applyFanSpeed(newSpeed);
                        self.config.set('fan_speed', newSpeed);
                        self.logger.info('FanController: RPi Temp ' + temp.toFixed(1) + '°C → PWM ' + newSpeed + '%, GPIO ' + self.GPIO_PIN);
                        
                        // Update UI if needed
                        self.updateUIConfig();
                    }
                }).fail(function(error) {
                    self.logger.error('FanController: Error reading temperature: ' + error);
                });
            }, self.config.get('check_interval') * 1000);
            
            self.logger.info('FanController: PWM fan control started - 50Hz, monitoring every ' + self.config.get('check_interval') + 's');
        }).fail(function(error) {
            self.logger.error('FanController: Failed to start fan control - GPIO setup failed: ' + error);
        });
    } else {
        self.logger.info('FanController: Fan control disabled in configuration');
        // Ensure fan is off when disabled
        self.applyFanSpeed(0);
    }
};

FanController.prototype.stopFanControl = function() {
    var self = this;
    
    if (self.fanInterval) {
        clearInterval(self.fanInterval);
        self.fanInterval = null;
        self.logger.info('FanController: Fan control stopped');
    }
    
    if (self.pwmInterval) {
        clearInterval(self.pwmInterval);
        self.pwmInterval = null;
    }
    
    // Turn fan off
    self.applyFanSpeed(0);
};

FanController.prototype.cleanupGPIO = function() {
    var self = this;
    
    // Turn fan off
    self.applyFanSpeed(0);
    
    // Clear intervals
    if (self.pwmInterval) {
        clearInterval(self.pwmInterval);
        self.pwmInterval = null;
    }
    
    // Unexport GPIO
    setTimeout(function() {
        exec('echo ' + self.GPIO_PIN + ' > ' + self.GPIO_BASE_PATH + '/unexport', function(error) {
            if (!error) {
                self.logger.info('FanController: GPIO ' + self.GPIO_PIN + ' unexported');
            }
        });
        
        // Cleanup hardware PWM
        if (self.useHardwarePWM) {
            exec(`gpio unexport ${self.GPIO_PIN}`, function(error) {
                if (!error) {
                    self.logger.info('FanController: Hardware PWM cleaned up');
                }
            });
        }
    }, 1000);
};

FanController.prototype.restartFanControl = function() {
    var self = this;
    self.stopFanControl();
    setTimeout(function() {
        self.startFanControl();
    }, 1000);
};

FanController.prototype.loadI18nStrings = function(langCode) {
    var self = this;
    var defer = libQ.defer();
    
    try {
        var i18nPath = __dirname + '/i18n/strings_' + langCode + '.json';
        if (!fs.existsSync(i18nPath)) {
            i18nPath = __dirname + '/i18n/strings_en.json';
        }
        
        var i18nFile = fs.readFileSync(i18nPath, 'utf8');
        var i18n = JSON.parse(i18nFile);
        defer.resolve(i18n);
    } catch (e) {
        self.logger.error('FanController: Could not load i18n strings: ' + e);
        defer.resolve({});
    }
    
    return defer.promise;
};

// API Routes for Volumio web interface
FanController.prototype.getApiRoutes = function() {
    var self = this;
    
    return [
        {
            path: '/fancontroller/status',
            type: 'get',
            handler: function(req, res) {
                self.getSystemTemperature().then(function(temp) {
                    var response = {
                        status: 'success',
                        data: {
                            enabled: self.config.get('enabled'),
                            current_temperature: temp,
                            current_speed: self.config.get('fan_speed'),
                            gpio_pin: self.GPIO_PIN,
                            use_pwm: self.config.get('use_pwm'),
                            min_temp: self.config.get('min_temp'),
                            max_temp: self.config.get('max_temp'),
                            check_interval: self.config.get('check_interval'),
                            timestamp: new Date().toISOString()
                        }
                    };
                    res.json(response);
                }).fail(function(error) {
                    res.json({
                        status: 'error',
                        message: 'Failed to get status: ' + error
                    });
                });
            }
        },
        {
            path: '/fancontroller/enable',
            type: 'post', 
            handler: function(req, res) {
                self.config.set('enabled', true);
                self.saveConfig().then(function() {
                    self.restartFanControl();
                    res.json({
                        status: 'success',
                        message: 'Fan control enabled',
                        data: { enabled: true }
                    });
                }).fail(function(error) {
                    res.json({
                        status: 'error', 
                        message: 'Failed to enable fan control: ' + error
                    });
                });
            }
        },
        {
            path: '/fancontroller/disable',
            type: 'post',
            handler: function(req, res) {
                self.config.set('enabled', false);
                self.saveConfig().then(function() {
                    self.stopFanControl();
                    res.json({
                        status: 'success',
                        message: 'Fan control disabled', 
                        data: { enabled: false }
                    });
                }).fail(function(error) {
                    res.json({
                        status: 'error',
                        message: 'Failed to disable fan control: ' + error
                    });
                });
            }
        },
        {
            path: '/fancontroller/speed/:speed',
            type: 'post',
            handler: function(req, res) {
                var speed = parseInt(req.params.speed);
                if (speed < 0 || speed > 100) {
                    res.json({
                        status: 'error',
                        message: 'Speed must be between 0 and 100'
                    });
                    return;
                }
                
                self.config.set('fan_speed', speed);
                self.saveConfig().then(function() {
                    if (self.config.get('enabled')) {
                        self.applyFanSpeed(speed);
                    }
                    res.json({
                        status: 'success',
                        message: 'Fan speed set to ' + speed + '%',
                        data: { speed: speed }
                    });
                }).fail(function(error) {
                    res.json({
                        status: 'error',
                        message: 'Failed to set fan speed: ' + error
                    });
                });
            }
        },
        {
            path: '/fancontroller/temperature', 
            type: 'get',
            handler: function(req, res) {
                self.getSystemTemperature().then(function(temp) {
                    res.json({
                        status: 'success',
                        data: {
                            temperature: temp,
                            unit: 'celsius',
                            timestamp: new Date().toISOString()
                        }
                    });
                }).fail(function(error) {
                    res.json({
                        status: 'error',
                        message: 'Failed to read temperature: ' + error
                    });
                });
            }
        },
        {
            path: '/fancontroller/settings',
            type: 'get',
            handler: function(req, res) {
                var settings = {
                    enabled: self.config.get('enabled'),
                    gpio_pin: self.config.get('gpio_pin'),
                    min_temp: self.config.get('min_temp'),
                    max_temp: self.config.get('max_temp'),
                    check_interval: self.config.get('check_interval'),
                    fan_speed: self.config.get('fan_speed'),
                    use_pwm: self.config.get('use_pwm')
                };
                res.json({
                    status: 'success',
                    data: settings
                });
            }
        },
        {
            path: '/fancontroller/settings',
            type: 'post',
            handler: function(req, res) {
                var data = req.body;
                
                // Validation
                if (data.min_temp && data.max_temp) {
                    if (parseInt(data.min_temp) >= parseInt(data.max_temp)) {
                        res.json({
                            status: 'error',
                            message: 'Minimum temperature must be less than maximum temperature'
                        });
                        return;
                    }
                }
                
                if (data.check_interval && (parseInt(data.check_interval) < 5 || parseInt(data.check_interval) > 60)) {
                    res.json({
                        status: 'error', 
                        message: 'Check interval must be between 5 and 60 seconds'
                    });
                    return;
                }
                
                // Update settings
                var updates = {};
                if (data.enabled !== undefined) updates.enabled = data.enabled;
                if (data.min_temp !== undefined) updates.min_temp = parseInt(data.min_temp);
                if (data.max_temp !== undefined) updates.max_temp = parseInt(data.max_temp);
                if (data.check_interval !== undefined) updates.check_interval = parseInt(data.check_interval);
                if (data.use_pwm !== undefined) updates.use_pwm = data.use_pwm;
                
                for (var key in updates) {
                    self.config.set(key, updates[key]);
                }
                
                self.saveConfig().then(function() {
                    self.restartFanControl();
                    res.json({
                        status: 'success',
                        message: 'Settings updated successfully',
                        data: updates
                    });
                }).fail(function(error) {
                    res.json({
                        status: 'error',
                        message: 'Failed to update settings: ' + error
                    });
                });
            }
        }
    ];
};

// Web interface for Volumio
FanController.prototype.getWebInterface = function() {
    return {
        name: 'fancontroller-raspberry-pi',
        title: 'Fan Controller',
        icon: 'fa fa-thermometer-half',
        view: 'web-ui/index.html',
        controller: 'FanControllerCtrl'
    };
};

// Required plugin methods
FanController.prototype.onStop = function() {
    this.stopFanControl();
    this.cleanupGPIO();
    this.logger.info('FanController: Plugin stopped');
};

FanController.prototype.onStart = function() {
    this.onVolumioStart();
};

FanController.prototype.onRestart = function() {
    this.onVolumioStart();
};

FanController.prototype.onInstall = function() {
    this.logger.info('FanController: Plugin installed for Raspberry Pi with PWM support');
    return libQ.resolve();
};

FanController.prototype.onUninstall = function() {
    var self = this;
    self.logger.info('FanController: Uninstalling plugin...');
    
    self.stopFanControl();
    self.cleanupGPIO();
    
    // Additional cleanup
    setTimeout(function() {
        self.logger.info('FanController: Plugin uninstallation complete');
    }, 2000);
    
    return libQ.resolve();
};

FanController.prototype.getConf = function(varName) {
    return this.config.get(varName);
};

FanController.prototype.setConf = function(varName, varValue) {
    this.config.set(varName, varValue);
};