var _ = require('lodash');
var assert = require('assert');
var DataStore = require('nedb');
var events = require('events');
var fs = require('fs');
var http = require('http');
var https = require('https');
var io = require('socket.io');
var path = require('path');
var pd = require('pretty-data').pd;
var request = require('request');
var response = require('response');
var upnp = require('peer-upnp');
var util = require('util');

// Short hands

var EventEmitter = events.EventEmitter;
var HttpServer = http.Server;
var HttpsServer = https.Server;

// Constants

var PROXY_URL_REGEX = /^\/pinguela\/proxy\/(.+)$/;

// Constructor

var Pinguela = function (options) {
    EventEmitter(this);

    assert(options, 'Missing options argument.');
    assert(options.server instanceof HttpServer || options.server instanceof HttpsServer,
        'The given server object is not an HTTP/HTTPS Server instance.');

    this._server = options.server;

    this._initProxy();
    this._initPeer();
};

// Extend EventEmitter

util.inherits(Pinguela, EventEmitter);

// Private attributes

Pinguela.prototype._db = {
    devices: new DataStore(),
    clients: new DataStore(),
    services: new DataStore()
};

Pinguela.prototype._initIo = function () {
    this._io = io.listen(this._server).sockets.on('connection', this._onSocketConnect.bind(this));
};

Pinguela.prototype._initPeer = function () {
    this._peer = upnp.createPeer({
        prefix: '/upnp',
        server: this._server
    });

    this._peer.on('ready', this._onPeerReady.bind(this));
    this._peer.on('close', this._onPeerClose.bind(this));

    this._peer.start();
};

Pinguela.prototype._initProxy = function () {
    this._serverRequestListeners = this._server.listeners('request').splice(0);
    this._server.removeAllListeners('request');
    this._server.on('request', this._onServerRequest.bind(this));
};

Pinguela.prototype._io = null;

Pinguela.prototype._serverRequestListeners = null;

Pinguela.prototype._onDevice = function (device) {
    device.on('disappear', this._onDeviceDisappear.bind(this));
    request(device.descriptionUrl, this._onDeviceConfig(device).bind(this));
};

Pinguela.prototype._onDeviceConfig = function (device) {
    return function (error, response, body) {
        if (error) {
            return;
        }

        var services = _.map(device.services, function (service) {
            return {
                config: pd.xmlmin(body),
                id: service.USN + service.serviceId,
                name: service.serviceId,
                type: 'upnp:' + service.serviceType,
                url: '/pinguela/proxy/' + encodeURIComponent(service.controlURL)
            };
        });

        this._db.services.insert(services, function () {
            console.dir(arguments);
        });
    };
};

Pinguela.prototype._onDeviceDisappear = function (device) {
    console.log('_onDeviceDisappear');
    console.dir(device);
};

Pinguela.prototype._onGetNetworkServices = function (socket) {
    return function (types) {
        this._db.services.find({$where: function () {
            return _.contains(types, this.type);
        }}, function (error, result) {
            socket.emit('pinguela:networkServices', result);
        });
    };
};

Pinguela.prototype._onPeerClose = function () {
    console.log('_onPeerClose');
    console.dir(arguments);
};

Pinguela.prototype._onPeerReady = function () {
    this._peer.on('upnp:rootdevice', this._onDevice.bind(this));
    this._initIo();
};

Pinguela.prototype._onServices = function (socket, types, services) {
    console.log('_onServices');
    console.dir(arguments);
    console.log(util.inspect(services, { showHidden: true, depth: null }));

    this._db.clients.insert({services: services, socket: socket, types: types});
    socket.emit('pinguela:networkServices', {services: [], types: types});
};

Pinguela.prototype._onServerRequest = function (req, res) {
    if (req.url === '/pinguela/pinguela.js') {
        return this._proxyFile(req, res, '../node_modules/pinguela-client/dist/pinguela-client.js');
    }

    if (req.url === '/pinguela/pinguela-dev.js') {
        return this._proxyFile(req, res, '../node_modules/pinguela-client/dist/pinguela-client-dev.js');
    }

    if (PROXY_URL_REGEX.test(req.url)) {
        return this._proxyRequest(req, res, req.url);
    }

    _.each(this._serverRequestListeners, function (listener) {
        listener.call(this._server, req, res);
    });
};

Pinguela.prototype._onSocketConnect = function (socket) {
    socket.on('disconnect', this._onSocketDisconnect.bind(this));
    socket.on('pinguela:getNetworkServices', this._onGetNetworkServices(socket).bind(this));
};

Pinguela.prototype._onSocketDisconnect = function () {
    console.log('_onSocketDisconnect');
    console.dir(arguments);
};

Pinguela.prototype._peer = null;

Pinguela.prototype._proxyFile = function (req, res, filePath) {
    var readStream = fs.createReadStream(path.resolve(__dirname, filePath));
    var responseOptions = {
        compress: req
    };

    return readStream.pipe(response(responseOptions)).pipe(res);
};

Pinguela.prototype._proxyRequest = function (req, res, path) {
    var match = PROXY_URL_REGEX.exec(path);
    var target = decodeURIComponent(match && match[1]);

    try {
        return req.pipe(request(target)).pipe(res);
    } catch (error) {
        res.writeHead(500);
        res.write(util.inspect(error));
        res.end();
    }
};

Pinguela.prototype._server = null;

// Public Attributes

Pinguela.prototype.create = function (options) {
    return new Pinguela(options);
};

// Export constructor

module.exports = Pinguela;
