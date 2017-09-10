var util = require('util');
var net = require('net');
var events = require('events');
var fixutils = require('./fixutils.js');
var FixServerSession = require('./fixServerSession.js');
var FixDataProcessor = require('./fixDataProcessor.js');
var Coder = require('./coder/index.js');
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

    var fixCoder = new Coder(fixVersion, dictionary);

    accounts.forEach(function(account) {
        var session = new FixServerSession(fixVersion, _.clone(self.options), account);
        // Logon event
        session.on('logon', function(msg) {
            var account = msg.account;
            self.emit('logon', msg);
        });

        // Handle outbound message
        session.on('outmsg', function(msg) {
            var account = msg.account;
            var outmsg = fixCoder.encode(msg.message);
            if (self.clients.has(account)) {
                var client = self.clients.get(account);
                if (client.socket != undefined) {
                    client.socket.write(outmsg);
                    self.emit('outmsg', msg);
                } else {
                    self.emit('error', {error: 'Socket is null.', account: account });
                }
            }
        });

        // Inbound message Event
        session.on('msg', function(msg) {
            self.emit('msg', msg);
        });

        // Session end Event
        session.on('endsession', function(account) {
            session.stopHeartBeat();
            session.isLoggedIn = false;
            session.modifyBehavior({ shouldSendHeartbeats: false, shouldExpectHeartbeats: false });
            if (self.clients.has(account)) {
                var sock = self.clients.get(account).socket
                sock.end();
                sock = null;
            }
            self.emit('endsession');
        });

        // Session State event
        session.on('state', function(msg) {
            self.emit('state', msg);
        });

        var client = {
            session: session,
            socket: null
        }

        self.clients.set(account.targetID, client);
    })

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

    this.modifyBehavior = function(client, data) {
        if (self.clients.has(client)) {
            var session = self.clients.get(client).session;
            session.modifyBehavior(data);
        }
    }

    this.getOptions = function(client) {
        var options = null;

        if (self.clients.has(client)) {
            var session = self.clients.get(client).session;
            options = session.options;
        }
        return options;
    }

    // Send message
    this.sendMsg = function(msg, client, object, callback) {
        if (self.clients.has(client)) {
            var session = self.clients.get(client).session;
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
            socket.id = Math.floor(Math.random() * 1000);
            var fixDataProcessor = new FixDataProcessor(fixVersion);

            // Handle Incoming Fix message Event
            fixDataProcessor.on('msg', function(fixmsg) {
                // Decode Fix plain text message to Fix Object
                var fix = fixCoder.decode(fixmsg);
                var account = fix['49'];

                if (account != undefined) {
                    if (self.clients.has(account)) {
                        var client = self.clients.get(account);
                        var session = client.session
                        client.socket = socket;
                        // Process incoming Fix message in Session
                        session.processIncomingMsg(fix);
                    }
                }
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
                var session = null;
                var account = null;
                self.clients.forEach(function(value, key) {
                    var client = value;
                    if (client.socket != undefined) {
                        if (client.socket.id == socket.id) {
                            session = client.session;
                            account = key;
                            client.socket = null;
                            return;
                        }
                    }
                });

                if (session != undefined) {
                    session.modifyBehavior({ shouldSendHeartbeats: false, shouldExpectHeartbeats: false });
                    session.stopHeartBeat();
                    session.isLoggedIn = false;
                }
                self.emit('close', { account: account });
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
