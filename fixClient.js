var util = require('util');
var net = require('net');
var events = require('events');
var fixutils = require('./fixutils.js');
var FixClientSession = require('./fixClientSession.js');
var FixClientSocket = require('./fixClientSocket.js');
var FixDataProcessor = require('./fixDataProcessor.js');
var Coder = require('./coder/index.js');
var queue = require('queue');

module.exports = FixClient;

/*==================================================*/
/*====================FIXClient====================*/
/*==================================================*/
function FixClient(host, port, fixVersion, dictionary, senderCompID, targetCompID, options) {

    var self = this;

    self.host = host;
    self.port = port;

    var session = new FixClientSession(fixVersion, senderCompID, targetCompID, options);
    var fixSocket = new FixClientSocket();
    var outMsgQueue = queue();
    outMsgQueue.autostart = true;

    var fixCoder = null;

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

    // Send Logon message
    this.sendLogon = function(additional_tags) {
        session.sendLogon(additional_tags);
    }

    // Send Logoff message
    this.sendLogoff = function(additional_tags) {
        session.sendLogoff(additional_tags);
    };

    // Force disconnect
    this.destroyConnection = function(){
        if (self.socket != undefined){
            self.socket.end();
            self.cc.exit();
        }
    }

    // Send message
    this.sendMsg = function(msg, callback) {
        var fixmsg = fixCoder.decode(msg);
        var normalized_fixmsg = fixutils.normalize(fixmsg, null);
        session.sendMsg(normalized_fixmsg, function(outmsg) {
            callback(outmsg);
        });
    }

    this.createConnection = function(callback) {
        fixCoder = new Coder(fixVersion, dictionary);
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

        // Build socket connection to Fix Server
        fixSocket.connect(self.host, self.port, fixDataProcessor);

        // Connected Event
        fixSocket.on('connect', function() {
            self.emit('connect');
        });

        // Disconnected Event
        fixSocket.on('disconnect', function() {
            session.modifyBehavior({ shouldSendHeartbeats: false, shouldExpectHeartbeats: false });
            self.emit('disconnect');
        });

        // Error Event
        fixSocket.on('err', function(err) {
            self.emit('err', err);
        });

        // Handle outbound message
        session.on('outmsg', function(msg) {
            var out = fixCoder.encode(msg);

            outMsgQueue.push(function(cb) {
                session.options.outgoingSeqNum += 1;
                var outmsg = fixutils.finalizeMessage(fixVersion, out, session.options.outgoingSeqNum);
                fixSocket.send(outmsg);
                self.emit('outmsg', outmsg);
            })
        });

        // Inbound message Event
        session.on('msg', function(msg) {
            self.emit('msg', msg);
        });

        // Session end Event
        session.on('endsession', function() {
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
    }
}
util.inherits(FixClient, events.EventEmitter);
