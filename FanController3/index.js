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
    
    // GPIO configuration for Orange Pi PC - Pin 8
    self.GPIO_PIN = 228;  // Physical Pin 8 on Orange Pi PC
    self.GPIO_BASE_PATH = '/sys/class/gpio';
    
    self.fanInterval = null;
    self.isInitialized = false;
}

FanController.prototype.onVolumioStart = function() {
    var self = this;
    self.configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
    
    return self.loadConfig().then(function() {
        self.logger.info('FanController: Plugin started for Orange Pi PC - Using GPIO ' + self.GPIO_PIN + ' (Pin 8)');
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
        'gpio_pin': self.GPIO_PIN,  // Fixed to GPIO 228 (Pin 8)
        'min_temp': 45,
        'max_temp': 65,
        'check_interval': 10,
        'fan_speed': 0,
        'use_pwm': false
    };
    
    for (var key in defaults) {
        if (!self.config.has(key)) {
            self.config.set(key, defaults[key]);
        }
    }
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
        uiconf.sections[2].content[1].value = self.config.get('fan_speed') + '%';
        uiconf.sections[2].content[2].value = 'GPIO ' + self.GPIO_PIN + ' - Physical Pin 8 (SAFE)';
        uiconf.sections[2].content[3].value = 'Fan+: Pin 8, Fan-: Pin 9(GND)';
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
        self.logger.info('FanController: Configuration updated');
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
        self.logger.info('FanController: Manual fan speed set to ' + speed + '%');
    });
};

FanController.prototype.getSystemTemperature = function() {
    var self = this;
    var defer = libQ.defer();
    
    // Try multiple temperature sources for Orange Pi compatibility
    var tempSources = [
        '/sys/class/thermal/thermal_zone0/temp',
        '/sys/devices/virtual/thermal/thermal_zone0/temp',
        '/sys/class/sunxi_temperture/temperture'
    ];
    
    var tryNextSource = function(index) {
        if (index >= tempSources.length) {
            // All sources failed, try vcgencmd as last resort
            exec('vcgencmd measure_temp', function(error, stdout) {
                if (error) {
                    self.logger.error('FanController: All temperature sources failed');
                    defer.resolve(0);
                } else {
                    var tempMatch = stdout.match(/temp=([0-9.]+)'C/);
                    if (tempMatch) {
                        defer.resolve(parseFloat(tempMatch[1]));
                    } else {
                        defer.resolve(0);
                    }
                }
            });
            return;
        }
        
        var source = tempSources[index];
        exec('cat ' + source, function(error, stdout) {
            if (error) {
                tryNextSource(index + 1);
            } else {
                var temp = parseInt(stdout);
                if (temp > 1000) { // Assume millidegrees
                    temp = temp / 1000;
                }
                if (temp > 0 && temp < 100) { // Reasonable temperature range
                    defer.resolve(temp);
                } else {
                    tryNextSource(index + 1);
                }
            }
        });
    };
    
    tryNextSource(0);
    
    return defer.promise;
};

FanController.prototype.setupGPIO = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('FanController: Setting up GPIO ' + self.GPIO_PIN + ' (Physical Pin 8)');
    
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
                                self.logger.info('FanController: GPIO ' + self.GPIO_PIN + ' (Pin 8) configured successfully');
                                defer.resolve();
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
    var gpioPath = self.GPIO_BASE_PATH + '/gpio' + self.GPIO_PIN;
    
    // For simple on/off control (PWM not implemented in this version)
    var value = speed > 0 ? 1 : 0;
    
    exec('echo ' + value + ' > ' + gpioPath + '/value', function(error) {
        if (error) {
            self.logger.error('FanController: Error setting fan speed: ' + error);
        } else {
            self.logger.debug('FanController: Fan ' + (value ? 'ON' : 'OFF') + ' (Speed: ' + speed + '%) - GPIO ' + self.GPIO_PIN);
        }
    });
};

FanController.prototype.startFanControl = function() {
    var self = this;
    
    // Clear existing interval
    if (self.fanInterval) {
        clearInterval(self.fanInterval);
        self.fanInterval = null;
    }
    
    if (self.config.get('enabled')) {
        self.logger.info('FanController: Starting fan control for Orange Pi PC');
        
        self.setupGPIO().then(function() {
            // Start temperature monitoring
            self.fanInterval = setInterval(function() {
                self.getSystemTemperature().then(function(temp) {
                    var minTemp = self.config.get('min_temp');
                    var maxTemp = self.config.get('max_temp');
                    var currentSpeed = self.config.get('fan_speed');
                    
                    var newSpeed;
                    if (temp >= maxTemp) {
                        newSpeed = 100; // Full speed at max temp
                    } else if (temp >= minTemp) {
                        // Linear interpolation between min and max temp
                        newSpeed = Math.round(((temp - minTemp) / (maxTemp - minTemp)) * 100);
                        newSpeed = Math.max(0, Math.min(100, newSpeed)); // Clamp to 0-100
                    } else {
                        newSpeed = 0; // Off below min temp
                    }
                    
                    // Only apply if speed changed
                    if (newSpeed !== currentSpeed) {
                        self.applyFanSpeed(newSpeed);
                        self.config.set('fan_speed', newSpeed);
                        self.logger.info('FanController: Temp ' + temp.toFixed(1) + '°C → Speed ' + newSpeed + '%, GPIO ' + self.GPIO_PIN);
                    }
                }).fail(function(error) {
                    self.logger.error('FanController: Error reading temperature: ' + error);
                });
            }, self.config.get('check_interval') * 1000);
            
            self.logger.info('FanController: Fan control started - Monitoring every ' + self.config.get('check_interval') + 's');
        }).fail(function(error) {
            self.logger.error('FanController: Failed to start fan control - GPIO setup failed: ' + error);
        });
    } else {
        self.logger.info('FanController: Fan control disabled in configuration');
    }
};

FanController.prototype.stopFanControl = function() {
    var self = this;
    
    if (self.fanInterval) {
        clearInterval(self.fanInterval);
        self.fanInterval = null;
        self.logger.info('FanController: Fan control stopped');
    }
    
    // Turn fan off
    self.applyFanSpeed(0);
};

FanController.prototype.cleanupGPIO = function() {
    var self = this;
    
    // Turn fan off
    self.applyFanSpeed(0);
    
    // Unexport GPIO
    setTimeout(function() {
        exec('echo ' + self.GPIO_PIN + ' > ' + self.GPIO_BASE_PATH + '/unexport', function(error) {
            if (!error) {
                self.logger.info('FanController: GPIO ' + self.GPIO_PIN + ' unexported');
            }
        });
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
    this.logger.info('FanController: Plugin installed');
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