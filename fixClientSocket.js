var util = require('util');
var net = require('net');
var events = require('events');
var fixutils = require('./fixutils.js');

module.exports = FixClientSocket;

function FixClientSocket() {
    var self = this;
    self.socket = null;

    this.connect = function(host, port, dataprocessor) {
        // Create socket connection
        self.socket = net.createConnection(port, host);
        this.socket.setNoDelay(true);

        // Connect event
        self.socket.on('connect', function() {
            self.emit('connect');
        });

        // Receive Data event
        self.socket.on('data', function(data) {
            // Ask FixDataProcessor to process it
            dataprocessor.processData(data);
        });

        // Connection End Event
        self.socket.on('end', function() {
            self.emit('disconnect');
        });

        // Connection Error Event
        self.socket.on("error", function(err) {
            self.emit('err', err);
        });
    }

    // Force disconnect
    this.disconnect = function() {
        if (self.socket != undefined){
            self.socket.end();
        }
    }

    // Positive sending message via Socket
    this.send = function(msg) {
        if (self.socket != undefined) {
            self.socket.write(msg);
        }
    }
}
util.inherits(FixClientSocket, events.EventEmitter);
