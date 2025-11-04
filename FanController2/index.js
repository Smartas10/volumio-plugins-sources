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
}

FanController.prototype.onVolumioStart = function() {
    var self = this;
    self.configFile = self.commandRouter.pluginManager.getConfigurationFile(self.context, 'config.json');
    
    return self.loadConfig().then(function() {
        self.logger.info('FanController: Plugin started');
        self.startFanControl();
    });
};

FanController.prototype.onVolumioShutdown = function() {
    var self = this;
    self.stopFanControl();
    self.logger.info('FanController: Plugin stopped');
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
            } catch (e) {
                self.logger.error('FanController: Error loading config: ' + e);
                self.setupDefaults();
            }
        })
        .fail(function(err) {
            self.logger.error('FanController: Could not load config, using defaults: ' + err);
            self.setupDefaults();
        });
};

FanController.prototype.saveConfig = function() {
    var self = this;
    var configJson = JSON.stringify(self.config.get(), null, 4);
    
    return libQ.nfcall(fs.writeFile, self.configFile, configJson, 'utf8')
        .then(function() {
            self.logger.info('FanController: Configuration saved');
        })
        .fail(function(err) {
            self.logger.error('FanController: Could not save config: ' + err);
        });
};

FanController.prototype.setupDefaults = function() {
    var self = this;
    
    if (!self.config.has('enabled')) {
        self.config.set('enabled', false);
    }
    if (!self.config.has('gpio_pin')) {
        self.config.set('gpio_pin', 18);
    }
    if (!self.config.has('min_temp')) {
        self.config.set('min_temp', 40);
    }
    if (!self.config.has('max_temp')) {
        self.config.set('max_temp', 60);
    }
    if (!self.config.has('check_interval')) {
        self.config.set('check_interval', 10);
    }
    if (!self.config.has('fan_speed')) {
        self.config.set('fan_speed', 0);
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
            "fan_speed": self.config.get('fan_speed')
        };
        
        self.commandRouter.i18nJson(__dirname + '/i18n/strings_' + langCode + '.json',
            __dirname + '/UIConfig.json')
        .then(function(uiconf) {
            // Заполняем значения в UI конфиге
            uiconf.sections[0].content[0].value = config.enabled;
            uiconf.sections[0].content[1].value = config.gpio_pin;
            uiconf.sections[0].content[2].value = config.min_temp;
            uiconf.sections[0].content[3].value = config.max_temp;
            uiconf.sections[0].content[4].value = config.check_interval;
            uiconf.sections[1].content[0].value = config.fan_speed;
            
            defer.resolve(uiconf);
        })
        .fail(function(error) {
            self.logger.error('FanController: Could not load UI config: ' + error);
            defer.reject(error);
        });
    });
    
    return defer.promise;
};

FanController.prototype.updateUIConfig = function() {
    var self = this;
    self.commandRouter.broadcastMessage('pushUiConfig', self.getUIConfig());
};

FanController.prototype.setUIConfig = function(data) {
    var self = this;
    
    self.config.set('enabled', data.enabled);
    self.config.set('gpio_pin', parseInt(data.gpio_pin));
    self.config.set('min_temp', parseInt(data.min_temp));
    self.config.set('max_temp', parseInt(data.max_temp));
    self.config.set('check_interval', parseInt(data.check_interval));
    
    return self.saveConfig().then(function() {
        self.restartFanControl();
        self.updateUIConfig();
    });
};

FanController.prototype.setFanSpeed = function(speed) {
    var self = this;
    
    self.config.set('fan_speed', parseInt(speed));
    return self.saveConfig().then(function() {
        if (self.config.get('enabled')) {
            self.applyFanSpeed(speed);
        }
        self.updateUIConfig();
    });
};

FanController.prototype.getSystemTemperature = function() {
    var self = this;
    var defer = libQ.defer();
    
    exec('/opt/vc/bin/vcgencmd measure_temp', function(error, stdout, stderr) {
        if (error) {
            self.logger.error('FanController: Error reading temperature: ' + error);
            defer.resolve(0);
        } else {
            var tempMatch = stdout.match(/temp=([0-9.]+)'C/);
            if (tempMatch && tempMatch[1]) {
                defer.resolve(parseFloat(tempMatch[1]));
            } else {
                defer.resolve(0);
            }
        }
    });
    
    return defer.promise;
};

FanController.prototype.setupGPIO = function() {
    var self = this;
    var gpioPin = self.config.get('gpio_pin');
    
    // Экспорт GPIO пина
    exec('echo ' + gpioPin + ' > /sys/class/gpio/export', function(error) {
        if (error) {
            self.logger.debug('FanController: GPIO ' + gpioPin + ' already exported or not available');
        }
        
        // Установка направления
        setTimeout(function() {
            exec('echo out > /sys/class/gpio/gpio' + gpioPin + '/direction', function(error) {
                if (error) {
                    self.logger.error('FanController: Error setting GPIO direction: ' + error);
                }
            });
        }, 100);
    });
};

FanController.prototype.applyFanSpeed = function(speed) {
    var self = this;
    var gpioPin = self.config.get('gpio_pin');
    
    // Для простоты используем ШИМ через sysfs (если доступно)
    // Или просто включаем/выключаем вентилятор
    if (speed > 0) {
        exec('echo 1 > /sys/class/gpio/gpio' + gpioPin + '/value', function(error) {
            if (error) {
                self.logger.error('FanController: Error turning fan ON: ' + error);
            }
        });
    } else {
        exec('echo 0 > /sys/class/gpio/gpio' + gpioPin + '/value', function(error) {
            if (error) {
                self.logger.error('FanController: Error turning fan OFF: ' + error);
            }
        });
    }
};

FanController.prototype.startFanControl = function() {
    var self = this;
    
    if (self.fanInterval) {
        clearInterval(self.fanInterval);
    }
    
    if (self.config.get('enabled')) {
        self.setupGPIO();
        
        self.fanInterval = setInterval(function() {
            self.getSystemTemperature().then(function(temp) {
                var minTemp = self.config.get('min_temp');
                var maxTemp = self.config.get('max_temp');
                
                if (temp >= maxTemp) {
                    // Максимальная температура - включаем вентилятор
                    self.applyFanSpeed(100);
                    self.config.set('fan_speed', 100);
                } else if (temp >= minTemp) {
                    // Промежуточная температура - линейная интерполяция
                    var speed = Math.round(((temp - minTemp) / (maxTemp - minTemp)) * 100);
                    self.applyFanSpeed(speed);
                    self.config.set('fan_speed', speed);
                } else {
                    // Температура ниже минимальной - выключаем
                    self.applyFanSpeed(0);
                    self.config.set('fan_speed', 0);
                }
                
                self.logger.debug('FanController: Temp: ' + temp + '°C, Speed: ' + self.config.get('fan_speed') + '%');
            });
        }, self.config.get('check_interval') * 1000);
        
        self.logger.info('FanController: Fan control started');
    }
};

FanController.prototype.stopFanControl = function() {
    var self = this;
    
    if (self.fanInterval) {
        clearInterval(self.fanInterval);
        self.fanInterval = null;
    }
    
    // Выключаем вентилятор
    self.applyFanSpeed(0);
    self.logger.info('FanController: Fan control stopped');
};

FanController.prototype.restartFanControl = function() {
    var self = this;
    self.stopFanControl();
    self.startFanControl();
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

// Обязательные методы плагина
FanController.prototype.onStop = function() {
    this.stopFanControl();
};

FanController.prototype.onStart = function() {
    this.onVolumioStart();
};

FanController.prototype.onRestart = function() {
    this.onVolumioStart();
};

FanController.prototype.onInstall = function() {
    // Дополнительные действия при установке
};

FanController.prototype.onUninstall = function() {
    // Дополнительные действия при удалении
};

FanController.prototype.getConf = function(varName) {
    return this.config.get(varName);
};

FanController.prototype.setConf = function(varName, varValue) {
    this.config.set(varName, varValue);
};