# pinguela

This library intends to provide an interface compatible with the [W3C Network Service Discovery Working Draft 20 February 2014](http://www.w3.org/TR/2014/WD-discovery-api-20140220/) that could be used with current and past browsers.

The idea is to leverage WebSockets and web proxying to bridge the network and protocol gaps and enable web applications to browse and control UPnP devices and services in a private network as suggested in [this presentation](http://www.slideshare.net/RodrigoFernandez33/javascript-powering-the-dream-of-the-connected-home).

## Setup and usage

### Server-side

```javascript
var http = require('http');
var Pinguela = require('pinguela');

var server = http.createServer(function (req, res) {
    // request handler code
});

var pinguela = new Pinguela({
    server: server
});

server.listen(80);
```

#### Using with a framework

##### [hapi](https://github.com/spumko/hapi)

```javascript
var hapi = require('hapi');
var Pinguela = require('pinguela');

var server = new Hapi.Server(8000);

server.route({
    method: 'GET',
    path: '/',
    handler: function (request, reply) {
        // request handler code
    }
});

server.start(function () {
    var pinguela = new Pinguela({
        server: server.listener // pass the hapi server listener attribute
    });
});
```

##### [express](https://github.com/visionmedia/express)

```javascript
var express = require('express');
var Pinguela = require('pinguela');

var server = express.createServer();

server.get('/', function (req, res) {
    // request handler code
});

var pinguela = new Pinguela({
    server: server
});

server.listen(80);
```

### Client-side

```javascript
<script src="/pinguela/pinguela.js" type="application/javascript"></script>

<script type="application/javascript">
    window.onload = function () {
        var types = [
            'upnp:urn:schemas-upnp-org:service:AVTransport:1',
            'upnp:urn:schemas-upnp-org:service:ConnectionManager:1',
            'upnp:urn:schemas-upnp-org:service:ContentDirectory:1',
            'upnp:urn:schemas-upnp-org:service:RenderingControl:1'
        ];

        navigator.getNetworkServices(

                types,

                function (services) {
                    console.log('Found %d services', services.length);

                    for (var i = 0; i < services.length; i++) {
                        console.log(services[i].id);
                        console.log(services[i].name);
                        console.log(services[i].type);
                        console.log(services[i].url);
                    }
                },

                function (error) {
                    console.error(error);
                }

        );
    };
</script>
```

## License

MIT
