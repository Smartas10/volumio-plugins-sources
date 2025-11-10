'use strict';

var libQ = require('kew');
var fs = require('fs');
var exec = require('child_process').exec;
var http = require('http');

module.exports = VolumioControl;

function VolumioControl(context) {
    var self = this;
    self.context = context;
    self.commandRouter = self.context.coreCommand;
    self.logger = self.context.logger;
    
    self.GPIO_PIN = 14;
    self.baseUrl = 'http://localhost:3000';
}

// API методы для управления через Volumio web interface
VolumioControl.prototype.getApiRoutes = function() {
    var self = this;
    
    return [
        {
            path: '/fancontroller/status',
            type: 'get',
            handler: self.getStatus.bind(self)
        },
        {
            path: '/fancontroller/enable',
            type: 'post', 
            handler: self.enableFanControl.bind(self)
        },
        {
            path: '/fancontroller/disable',
            type: 'post',
            handler: self.disableFanControl.bind(self)
        },
        {
            path: '/fancontroller/speed/:speed',
            type: 'post',
            handler: self.setFanSpeed.bind(self)
        },
        {
            path: '/fancontroller/temperature',
            type: 'get',
            handler: self.getTemperature.bind(self)
        },
        {
            path: '/fancontroller/settings',
            type: 'get',
            handler: self.getSettings.bind(self)
        },
        {
            path: '/fancontroller/settings',
            type: 'post',
            handler: self.updateSettings.bind(self)
        }
    ];
};

// Получить статус вентилятора
VolumioControl.prototype.getStatus = function(req, res) {
    var self = this;
    
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
};

// Включить управление вентилятором
VolumioControl.prototype.enableFanControl = function(req, res) {
    var self = this;
    
    self.config.set('enabled', true);
    self.saveConfig().then(function() {
        self.restartFanControl();
        
        res.json({
            status: 'success',
            message: 'Fan control enabled',
            data: {
                enabled: true
            }
        });
    }).fail(function(error) {
        res.json({
            status: 'error', 
            message: 'Failed to enable fan control: ' + error
        });
    });
};

// Выключить управление вентилятором
VolumioControl.prototype.disableFanControl = function(req, res) {
    var self = this;
    
    self.config.set('enabled', false);
    self.saveConfig().then(function() {
        self.stopFanControl();
        
        res.json({
            status: 'success',
            message: 'Fan control disabled',
            data: {
                enabled: false
            }
        });
    }).fail(function(error) {
        res.json({
            status: 'error',
            message: 'Failed to disable fan control: ' + error
        });
    });
};

// Установить скорость вентилятора
VolumioControl.prototype.setFanSpeed = function(req, res) {
    var self = this;
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
            data: {
                speed: speed
            }
        });
    }).fail(function(error) {
        res.json({
            status: 'error',
            message: 'Failed to set fan speed: ' + error
        });
    });
};

// Получить текущую температуру
VolumioControl.prototype.getTemperature = function(req, res) {
    var self = this;
    
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
};

// Получить настройки
VolumioControl.prototype.getSettings = function(req, res) {
    var self = this;
    
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
};

// Обновить настройки
VolumioControl.prototype.updateSettings = function(req, res) {
    var self = this;
    var data = req.body;
    
    // Валидация
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
    
    // Обновление настроек
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
};

// Отправка команд через Volumio API
VolumioControl.prototype.sendVolumioCommand = function(command, data) {
    var self = this;
    var defer = libQ.defer();
    
    var options = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/v1/' + command,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    };
    
    var req = http.request(options, function(res) {
        var responseData = '';
        
        res.on('data', function(chunk) {
            responseData += chunk;
        });
        
        res.on('end', function() {
            try {
                var jsonResponse = JSON.parse(responseData);
                defer.resolve(jsonResponse);
            } catch (e) {
                defer.reject(e);
            }
        });
    });
    
    req.on('error', function(error) {
        defer.reject(error);
    });
    
    if (data) {
        req.write(JSON.stringify(data));
    }
    
    req.end();
    
    return defer.promise;
};

// Веб-интерфейс для управления
VolumioControl.prototype.getWebInterface = function() {
    var self = this;
    
    return {
        name: 'fancontroller',
        title: 'Fan Controller',
        icon: 'fa fa-thermometer-half',
        view: 'index.html',
        controller: 'FanControllerCtrl'
    };
};

module.exports = VolumioControl;