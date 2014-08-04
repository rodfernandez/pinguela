var _ = require('lodash');
var assert = require('assert');
var DataStore = require('nedb');
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

var HttpServer = http.Server;
var HttpsServer = https.Server;

// Constants

var PROXY_URL_REGEX = /^\/pinguela\/proxy\/(.+)$/;

// Constructor

var Pinguela = function (options) {
    assert(options, 'Missing options argument.');

    assert(options.server instanceof HttpServer || options.server instanceof HttpsServer,
        'The given server object is not an HTTP/HTTPS Server instance.');

    this._server = options.server;

    this._initProxy();
    this._initPeer();
};

// Private attributes

Pinguela.prototype._db = {
    clients: new DataStore(),
    services: new DataStore()
};

Pinguela.prototype._initIo = function () {
    this._io = io.listen(this._server, { log: false }).sockets.on('connection', this._onSocketConnect.bind(this));
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
    var onDeviceConfig = function (error, response, body) {
        if (error) {
            return;
        }

        device.on('disappear', this._onDeviceDisappear.bind(this));

        var services = _.map(device.services, function (service) {
            return {
                config: pd.xmlmin(body),
                id: service.USN + service.serviceId,
                name: service.serviceId,
                type: 'upnp:' + service.serviceType,
                url: '/pinguela/proxy/' + encodeURIComponent(service.controlURL)
            };
        });

        var onServicesInserted = function (error, inserted) {
            if (error) {
                return console.error('Error while inserting services into db.', arguments);
            }

            this._onServicesAvailable(inserted);
        };

        this._db.services.insert(services, onServicesInserted.bind(this));
    };

    request(device.descriptionUrl, onDeviceConfig.bind(this));
};

Pinguela.prototype._onDeviceDisappear = function (device) {
    var $where = function () {
        return this.id.indexOf(device.UDN) !== -1;
    };

    var onFound = function (error, found) {
        var onRemove = function (error, count) {
            if (error) {
                return console.error('Error while removing services from db.', arguments);
            }

            this._onServicesUnavailable(found);
        };

        this._db.services.remove({$where: $where}, { multi: true }, onRemove.bind(this));
    };

    this._db.services.find({$where: $where}, onFound.bind(this));
};

Pinguela.prototype._onGetNetworkServices = function (socket) {
    return function (types) {
        var $where = function () {
            return _.contains(types, this.type);
        };

        var onFound = function (error, services) {
            var onUpdate = function (error, count) {
                if (error) {
                    return console.error('Error while updating clients db.', arguments);
                }

                socket.emit('pinguela:networkServices', services);
            };

            this._db.clients.update({id: socket.id}, {$set: {services: services, types: types}}, onUpdate);
        };

        this._db.services.find({$where: $where}, onFound.bind(this));
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

Pinguela.prototype._onServerRequest = function (req, res) {
    if (req.url.indexOf('/pinguela/pinguela.js') === 0) {
        return this._proxyFile(req, res, '../node_modules/pinguela-client/dist/pinguela-client.js');
    }

    if (req.url.indexOf('/pinguela/pinguela-dev.js') === 0) {
        return this._proxyFile(req, res, '../node_modules/pinguela-client/dist/pinguela-client-dev.js');
    }

    if (PROXY_URL_REGEX.test(req.url)) {
        return this._proxyRequest(req, res, req.url);
    }

    _.each(this._serverRequestListeners, function (listener) {
        listener.call(this._server, req, res);
    });
};

Pinguela.prototype._onServicesAvailable = function (services) {
    console.log('_onServicesAvailable');
    console.dir(arguments);
};

Pinguela.prototype._onServicesUnavailable = function (services) {
    var types = _.map(services, function (service) {
        return service.type;
    });

    var $where = function () {
        return !!_.intersection(types, this.types).length;
    };

    var onFound = function (error, clients) {
        _.each(clients, function (client) {
                this._io.sockets[client.id].emit('pinguela:serviceDisappeared', services);
        }.bind(this));
    };

    this._db.clients.find({$where: $where}, onFound.bind(this));
};

Pinguela.prototype._onSocketConnect = function (socket) {
    socket.on('disconnect', this._onSocketDisconnect(socket).bind(this));
    socket.on('pinguela:getNetworkServices', this._onGetNetworkServices(socket).bind(this));

    var client = {
        id: socket.id,
        services: [],
        types: []
    };

    var onInsert = function (error, inserted) {
        if (error) {
            console.error('Error while inserting client into db.', arguments);
        }
    };

    this._db.clients.insert(client, onInsert);
};

Pinguela.prototype._onSocketDisconnect = function (socket) {
    return function () {
        var $where = function () {
            return this.id === socket.id;
        };

        var onRemove = function (error, count) {
            if (error) {
                console.error('Error while removing client from db.', arguments);
            }
        };

        this._db.clients.remove({$where: $where}, { multi: true }, onRemove);
    };
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
