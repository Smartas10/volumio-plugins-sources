'use strict';

var libQ = require('kew');
var fs = require('fs');
var exec = require('child_process').exec;

module.exports = FanController;

function FanController(context) {
    var self = this;
    self.context = context;
    self.commandRouter = self.context.coreCommand;
    self.logger = self.context.logger;
    
    // Fixed configuration - NO SETTINGS
    self.GPIO_PIN = 14;           // GPIO 14 - Physical Pin 8
    self.PWM_FREQUENCY = 50;      // 50 Hz fixed
    self.PWM_PERIOD_MS = 20;      // 20ms period
    self.MIN_TEMP = 20;           // Start at 20°C
    self.MAX_TEMP = 80;           // Full speed at 80°C
    self.CHECK_INTERVAL = 10;     // Check every 10 seconds
    
    self.fanInterval = null;
    self.pwmInterval = null;
    self.currentSpeed = 0;
    self.isEnabled = true;        // Always enabled
}

FanController.prototype.onVolumioStart = function() {
    var self = this;
    self.logger.info('FanController: Starting 50Hz PWM on GPIO 14');
    self.logger.info('FanController: Temperature range: ' + self.MIN_TEMP + '°C to ' + self.MAX_TEMP + '°C');
    self.startFanControl();
    return libQ.resolve();
};

FanController.prototype.onVolumioShutdown = function() {
    this.stopFanControl();
    this.cleanupGPIO();
    this.logger.info('FanController: Stopped');
};

FanController.prototype.getConfigurationFiles = function() {
    return []; // No config file needed
};

// Simple web interface - STATUS ONLY
FanController.prototype.getUIConfig = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.getSystemTemperature().then(function(temp) {
        var speed = self.calculateFanSpeed(temp);
        var config = {
            "current_temp": temp.toFixed(1) + '°C',
            "current_speed": speed + '%',
            "pwm_status": "ACTIVE - 50Hz",
            "gpio_pin": "GPIO 14 (Pin 8)",
            "temp_range": self.MIN_TEMP + '°C - ' + self.MAX_TEMP + '°C',
            "control_mode": "Automatic PWM"
        };
        defer.resolve(config);
    });
    
    return defer.promise;
};

// No settings to update - always automatic
FanController.prototype.updateUIConfig = function(data) {
    return libQ.resolve(); // Do nothing
};

// Console commands for testing
FanController.prototype.getConsoleCommands = function() {
    var self = this;
    
    return [
        {
            command: 'fancontroller-status',
            description: 'Get fan controller status',
            executable: true,
            handler: self.getStatus.bind(self)
        },
        {
            command: 'fancontroller-test',
            description: 'Test PWM at 50% for 10 seconds',
            executable: true,
            handler: self.testPWM.bind(self)
        }
    ];
};

FanController.prototype.getStatus = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.getSystemTemperature().then(function(temp) {
        var speed = self.calculateFanSpeed(temp);
        var status = '=== FAN CONTROLLER STATUS ===\n' +
                    'Enabled: YES (Always)\n' +
                    'Temperature: ' + temp.toFixed(1) + '°C\n' +
                    'Fan Speed: ' + speed + '%\n' +
                    'GPIO: 14 (Physical Pin 8)\n' +
                    'PWM: 50Hz Active\n' +
                    'Range: ' + self.MIN_TEMP + '°C - ' + self.MAX_TEMP + '°C\n' +
                    'Check: Every ' + self.CHECK_INTERVAL + ' seconds';
        defer.resolve(status);
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
    
    // Try vcgencmd first (Raspberry Pi)
    exec('vcgencmd measure_temp', function(error, stdout) {
        if (!error && stdout) {
            var tempMatch = stdout.match(/temp=([0-9.]+)'C/);
            if (tempMatch) {
                defer.resolve(parseFloat(tempMatch[1]));
                return;
            }
        }
        
        // Fallback to thermal zone
        fs.readFile('/sys/class/thermal/thermal_zone0/temp', 'utf8', function(err, data) {
            if (!err && data) {
                defer.resolve(parseInt(data) / 1000);
            } else {
                defer.resolve(35); // Safe default
            }
        });
    });
    
    return defer.promise;
};

FanController.prototype.setupGPIO = function() {
    var self = this;
    var defer = libQ.defer();
    
    self.logger.info('FanController: Setting up GPIO 14 for PWM');
    
    // Cleanup any existing GPIO
    exec('echo ' + self.GPIO_PIN + ' > /sys/class/gpio/unexport 2>/dev/null', function() {
        // Wait and export
        setTimeout(function() {
            exec('echo ' + self.GPIO_PIN + ' > /sys/class/gpio/export', function(error) {
                if (error) {
                    self.logger.debug('FanController: GPIO 14 already exported');
                }
                
                // Set as output
                setTimeout(function() {
                    exec('echo out > /sys/class/gpio/gpio14/direction', function() {
                        // Ensure fan is off initially
                        exec('echo 0 > /sys/class/gpio/gpio14/value', function() {
                            defer.resolve();
                        });
                    });
                }, 500);
            });
        }, 500);
    });
    
    return defer.promise;
};

FanController.prototype.calculateFanSpeed = function(temp) {
    var self = this;
    
    if (temp <= self.MIN_TEMP) return 0;
    if (temp >= self.MAX_TEMP) return 100;
    
    // Linear calculation: 20°C=0%, 80°C=100%
    var speed = Math.round(((temp - self.MIN_TEMP) / (self.MAX_TEMP - self.MIN_TEMP)) * 100);
    return Math.max(0, Math.min(100, speed));
};

FanController.prototype.applyPWM = function(speed) {
    var self = this;
    
    // Clear previous PWM
    if (self.pwmInterval) {
        clearInterval(self.pwmInterval);
        self.pwmInterval = null;
    }
    
    self.currentSpeed = speed;
    
    // Handle 0% and 100% as constant signals
    if (speed === 0) {
        exec('echo 0 > /sys/class/gpio/gpio14/value', function(error) {
            if (error) {
                self.logger.error('FanController: Failed to set GPIO LOW');
            }
        });
        return;
    }
    
    if (speed === 100) {
        exec('echo 1 > /sys/class/gpio/gpio14/value', function(error) {
            if (error) {
                self.logger.error('FanController: Failed to set GPIO HIGH');
            }
        });
        return;
    }
    
    // 50Hz PWM with variable duty cycle
    var onTime = (speed / 100) * self.PWM_PERIOD_MS;
    
    self.pwmInterval = setInterval(function() {
        // Set HIGH
        exec('echo 1 > /sys/class/gpio/gpio14/value');
        
        // Set LOW after onTime
        setTimeout(function() {
            exec('echo 0 > /sys/class/gpio/gpio14/value');
        }, onTime);
        
    }, self.PWM_PERIOD_MS);
    
    self.logger.debug('FanController: 50Hz PWM - ' + speed + '% duty (ON: ' + onTime.toFixed(1) + 'ms)');
};

FanController.prototype.startFanControl = function() {
    var self = this;
    
    self.stopFanControl();
    
    self.setupGPIO().then(function() {
        self.logger.info('FanController: PWM control started successfully');
        
        // Start temperature monitoring
        self.fanInterval = setInterval(function() {
            self.getSystemTemperature().then(function(temp) {
                var newSpeed = self.calculateFanSpeed(temp);
                
                if (newSpeed !== self.currentSpeed) {
                    self.applyPWM(newSpeed);
                    self.logger.info('FanController: ' + temp.toFixed(1) + '°C → ' + newSpeed + '% PWM');
                }
            }).fail(function(error) {
                self.logger.error('FanController: Temperature read error: ' + error);
            });
        }, self.CHECK_INTERVAL * 1000);
        
    }).fail(function(error) {
        self.logger.error('FanController: Failed to start - ' + error);
    });
};

FanController.prototype.stopFanControl = function() {
    var self = this;
    
    // Stop temperature monitoring
    if (self.fanInterval) {
        clearInterval(self.fanInterval);
        self.fanInterval = null;
    }
    
    // Stop PWM
    if (self.pwmInterval) {
        clearInterval(self.pwmInterval);
        self.pwmInterval = null;
    }
    
    // Turn fan off
    exec('echo 0 > /sys/class/gpio/gpio14/value 2>/dev/null');
};

FanController.prototype.cleanupGPIO = function() {
    var self = this;
    
    self.stopFanControl();
    
    setTimeout(function() {
        exec('echo ' + self.GPIO_PIN + ' > /sys/class/gpio/unexport 2>/dev/null');
    }, 1000);
};

FanController.prototype.restartFanControl = function() {
    this.stopFanControl();
    setTimeout(this.startFanControl.bind(this), 2000);
};

// Plugin lifecycle - SIMPLIFIED
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
    this.logger.info('FanController: Installed - Automatic 50Hz PWM Control');
    return libQ.resolve();
};

FanController.prototype.onUninstall = function() {
    this.onVolumioShutdown();
    return libQ.resolve();
};