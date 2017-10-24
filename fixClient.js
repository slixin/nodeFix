var util = require('util');
var net = require('net');
var events = require('events');
var fixutils = require('./fixutils.js');
var FixClientSession = require('./fixClientSession.js');
var FixDataProcessor = require('./fixDataProcessor.js');
var Coder = require('./coder/index.js');
var queue = require('queue');
var dict = require('dict');
var _ = require('underscore');

module.exports = FixClient;

/*==================================================*/
/*====================FIXClient====================*/
/*==================================================*/
function FixClient(host, port, fixVersion, dictionary, senderCompID, targetCompID, options) {

    var self = this;

    self.host = host;
    self.port = port;
    self.options = options;
    self.dictionary = dictionary;
    self.socket = null;

    var session = new FixClientSession(fixVersion, senderCompID, targetCompID, options);
    var fixCoder = new Coder(fixVersion, dictionary);

    var extractMsg = function(msg) {
        var fields = [];
        var values = [];
        var msg_tags = msg.split(fixutils.SOHCHAR);

        msg_tags.forEach(function(msg_tag) {
            var tag = msg_tag.trim();
            if (tag.trim().length > 0) {
                var firstequalpos = tag.indexOf('=');
                var tag_name = tag.substr(0, firstequalpos);
                var tag_value = tag.substr(firstequalpos+1, tag.length - firstequalpos);

                fields.push(tag_name);
                values.push(tag_value);
            }
        });

        return { fields: fields, values: values }
    }

    this.destroyConnection = function(){
        if (self.socket != undefined){
            self.socket.exit();
        }
    }

    this.modifyBehavior = function(data) {
        session.modifyBehavior(data);
    }

    // Send Logon message
    this.sendLogon = function(additional_tags) {
        session.sendLogon(additional_tags);
    }

    // Send Logoff message
    this.sendLogoff = function(additional_tags) {
        session.sendLogoff(additional_tags);
    };

    // Send message
    this.sendMsg = function(msg, callback) {
        var fixmsg = null;
        if (typeof msg == "string") {
            fixmsg = fixCoder.decode(msg);
        } else {
            fixmsg = JSON.parse(JSON.stringify(msg));
        }

        var normalized_fixmsg = fixutils.normalize(fixmsg, null);
        session.sendMsg(normalized_fixmsg, function(outmsg) {
            callback(outmsg);
        });
    }

    this.createConnection = function(callback) {
        var socket = net.createConnection(port, host);
        socket.setNoDelay(true);
        self.socket = socket;

        var fixDataProcessor = new FixDataProcessor(fixVersion);

        // Handle Incoming Fix message Event
        fixDataProcessor.on('msg', function(fixmsg) {
            // Decode Fix plain text message to Fix Object
            var fix = fixCoder.decode(fixmsg);
            // Process incoming Fix message in Session
            session.processIncomingMsg(fix);
        });

        // Data process error Event
        fixDataProcessor.on('error', function(error) {
            self.emit('error', error);
        });

        socket.on('connect', function() {
            self.emit('connect');
        });

        socket.on('data', function(data) {
            fixDataProcessor.processData(data);
        });

        socket.on('end', function() {
            if (session != undefined) {
                session.modifyBehavior({ shouldSendHeartbeats: false, shouldExpectHeartbeats: false });
                session.stopHeartBeat();
                session.isLoggedIn = false;
            }

            self.emit('disconnect');
        });

        socket.on("error", function(err) {
            self.emit('error', err);
        });

        // Handle outbound message
        session.on('outmsg', function(msg) {
            var outmsg = fixCoder.encode(msg.message);
            if (self.socket != undefined) {
                self.socket.write(outmsg);
                self.emit('outmsg', msg);
            } else {
                self.emit('error', {error: 'Socket is null.'});
            }
        });

        // Inbound message Event
        session.on('msg', function(msg) {
            self.emit('msg', msg);
        });

        // Session end Event
        session.on('endsession', function() {
            session.stopHeartBeat();
            session.isLoggedIn = false;
            session.modifyBehavior({ shouldSendHeartbeats: false, shouldExpectHeartbeats: false });
            self.emit('endsession');
        });

        // Logon event
        session.on('logon', function(msg) {
            self.emit('logon', msg);
        });

        // Session State event
        session.on('state', function(msg) {
            self.emit('state', msg);
        });

        callback(null, self);

        process.on('uncaughtException', function(err) {
            console.log('Caught exception: ' + err);
            console.log(err.stack);
        });
    }
}

util.inherits(FixClient, events.EventEmitter);
