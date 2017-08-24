var util = require('util');
var net = require('net');
var events = require('events');
var fixutils = require('./fixutils.js');
var FixServerSession = require('./fixServerSession.js');
var FixServerSocket = require('./fixServerSocket.js');
var FixDataProcessor = require('./fixDataProcessor.js');
var Coder = require('./coder/index.js');
var queue = require('queue');
var dict = require('dict');
var _ = require('underscore');

module.exports = FixServer;

/*==================================================*/
/*====================FIXServer====================*/
/*==================================================*/
function FixServer(port, fixVersion, dictionary, options, accounts) {
    var self = this;

    self.port = port;
    self.options = options;
    self.dictionary = dictionary;
    self.accounts = accounts;
    self.clients = dict();

    var outMsgQueue = queue();
    outMsgQueue.autostart = true;
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
        if (self.server != undefined){
            self.clients.forEach(function(client, key) {
                console.log('Client:'+key+' is ended');
                client.socket.end();
            });
            self.clients.clear();
            self.server.close();
        }
    }

    this.modifyBehavior = function(account, data) {
        if (self.clients.has(account)) {
            var session = self.clients.get(account).session;
            session.modifyBehavior(data);
        }
    }

    this.getOptions = function(account) {
        var options = null;

        if (self.clients.has(account)) {
            var session = self.clients.get(account).session;
            options = session.options;
        }
        return options;
    }

    // Send message
    this.sendMsg = function(msg, account, object, callback) {
        if (self.clients.has(account)) {
            var session = self.clients.get(account).session;
            var fixmsg = null;
            if (typeof msg == "string") {
                fixmsg = fixCoder.decode(msg);
            } else {
                fixmsg = JSON.parse(JSON.stringify(msg));
            }
            var normalized_fixmsg = fixutils.normalize(fixmsg, object);
            session.sendMsg(normalized_fixmsg, function(outmsg) {
                callback(outmsg);
            });
        }
    }

    this.createServer = function(callback) {
        self.server = net.createServer();

        self.server.on('connection', function(socket) {
            var session = new FixServerSession(fixVersion, _.clone(self.options), self.accounts);
            var fixDataProcessor = new FixDataProcessor(fixVersion);
            var account = null;

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

            socket.on('data', function(data) {
                fixDataProcessor.processData(data);
            });

            socket.on("error", function(err) {
                self.emit('error', err);
            });

            socket.on('close', function() {
                session.modifyBehavior({ shouldSendHeartbeats: false, shouldExpectHeartbeats: false });
                session.stopHeartBeat();
                session.isLoggedIn = false;
                if (session.account != undefined) {
                    var client_name = session.account;
                    if (self.clients.has(client_name)) {
                        self.clients.delete(client_name);
                    }
                }
                self.emit('close');
            });

            // Logon event
            session.on('logon', function(msg) {
                if (msg.account != undefined) {
                    session.account = msg.account;
                    var client_name = session.account;
                    if (!self.clients.has(client_name)) {
                        self.clients.set(client_name, { session: session, socket: socket} );
                    }
                }
                self.emit('logon', msg);
            });

            // Handle outbound message
            session.on('outmsg', function(msg) {
                var out = fixCoder.encode(msg.message);

                outMsgQueue.push(function(cb) {
                    session.options.outgoingSeqNum += 1;
                    var outmsg = fixutils.finalizeMessage(fixVersion, out, session.options.outgoingSeqNum);
                    socket.write(outmsg);
                    self.emit('outmsg', { account: msg.account, message: outmsg });
                });
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
                if (session.account != undefined) {
                    var client_name = session.account;
                    if (self.clients.has(client_name)) {
                        self.clients.delete(client_name);
                    }
                }
                self.emit('endsession');
            });

            // Session State event
            session.on('state', function(msg) {
                self.emit('state', msg);
            });
        });

        self.server.listen(self.port, function() {
            callback(self);
        });

        process.on('uncaughtException', function(err) {
            console.log('Caught exception: ' + err);
            console.log(err.stack);
        });
    };
}
util.inherits(FixServer, events.EventEmitter);
