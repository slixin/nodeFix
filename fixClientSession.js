var net = require('net');
var util = require('util');
var events = require('events');
var fixutils = require('./fixutils.js');
var _ = require('underscore');

module.exports = FixClientSession;

/*==================================================*/
/*====================FIXSession====================*/
/*==================================================*/
function FixClientSession(fixVersion, senderCompID, targetCompID, opt) {
    var self = this;

    this.fixVersion = fixVersion;
    this.senderCompID = senderCompID;
    this.targetCompID = targetCompID;
    this.options = opt == undefined ? {} : opt;

    _.defaults(self.options, {
        shouldValidate: true,
        shouldSendHeartbeats: false,
        shouldExpectHeartbeats: true,
        shouldRespondToLogon: false,
        defaultHeartbeatSeconds: 15,
        incomingSeqNum: 0,
        outgoingSeqNum: 0,
        responseLogonExtensionTags: {},
        responseLogoutExtensionTags: {},
    });

    this.heartbeatIntervalID = "";

    this.isLoggedIn = false;
    this.timeOfLastIncoming = new Date().getTime();
    this.timeOfLastOutgoing = new Date().getTime();
    this.testRequestID = 1;
    this.isResendRequested = false;
    this.isLogoutRequested = false;

    this.standardMessage = {
        "Logoff": { 35: "5" },
        "Logon": { 35: "A", 98: '0' },
        "Heartbeat": { 35: '0' },
        "TestRequest": { 35: '1'},
        "SequenceReset": { 35: '4'},
        "ResendRequest": { 35: '2'}
    }

    //[PUBLIC] get unique ID of this session
    this.getID = function() {
        var serverName = self.fixVersion + "-" + self.senderCompID + "-" + self.targetCompID;
        return serverName;
    }

    //[PUBLIC] Sends FIX json to counter party
    this.sendMsg = function(msg, callback) {
        var header = self.buildHeader();
        var outmsg = _.extend({}, msg, header);
        self.emit('outmsg', outmsg);
        callback(outmsg);
    }

    this.buildHeader = function() {
        self.options.timeOfLastOutgoing = new Date().getTime();
        var header = {
            8: fixVersion,
            49: senderCompID,
            56: targetCompID,
            52: fixutils.getCurrentUTCTimeStamp()
        };

        return header
    }

    //[PUBLIC] Sends logon FIX json to counter party
    this.sendLogon = function(additional_tags) {
        var msgLogon = _.extend({}, self.standardMessage.Logon, additional_tags);
        if (additional_tags != undefined) {
            if ('141' in additional_tags) {
                if (additional_tags['141'] == 'Y')
                    self.options.outgoingSeqNum = 0;
            }
        }
        self.sendMsg(msgLogon, function(msg) {});
    }

    //[PUBLIC] Sends logoff FIX json to counter party
    this.sendLogoff = function(cb) {
        self.isLogoutRequested = true;
        self.sendMsg(self.standardMessage.Logoff, function(msg) {});
    }

    this.modifyBehavior = function(data) {
        for (var idx in data) {
            switch(idx) {
                case "shouldSendHeartbeats":
                    self.options.shouldSendHeartbeats = data[idx];
                    break;
                case "shouldExpectHeartbeats":
                    self.options.shouldExpectHeartbeats = data[idx];
                    break;
                case "shouldRespondToLogon":
                    self.options.shouldRespondToLogon = data[idx];
                    break;
                case "incomingSeqNum":
                    self.options.incomingSeqNum = data[idx];
                    break;
                case "outgoingSeqNum":
                    self.options.outgoingSeqNum = data[idx];
                    break;
                case "shouldValidate":
                    self.options.shouldValidate = data[idx];
                    break;
            }
        }

        if (self.options.shouldSendHeartbeats === false && self.options.shouldExpectHeartbeats === false) {
            clearInterval(self.heartbeatIntervalID);
        }

        self._sendState(data);
    }

    this.stopHeartBeat = function() {
        clearInterval(self.heartbeatIntervalID);
    }

    //[PUBLIC] process incoming messages
    this.processIncomingMsg = function(fix) {
        var heartbeatInMilliSeconds = self.options.defaultHeartbeatSeconds * 1000;
        self.timeOfLastIncoming = new Date().getTime();
        self._sendState({ timeOfLastIncoming: self.timeOfLastIncoming });

        // ########### Private Methods ###########
        var heartbeat = function() {
            var currentTime = new Date().getTime();

            //==send heartbeats
            if (currentTime - self.timeOfLastOutgoing > heartbeatInMilliSeconds && self.options.shouldSendHeartbeats) {
                self.sendMsg(self.standardMessage.Heartbeat, function(msg) {});
            }

            //==ask counter party to wake up
            if (currentTime - self.timeOfLastIncoming > (heartbeatInMilliSeconds * 1.5) && self.options.shouldExpectHeartbeats) {
                self._sendState({ testRequestID: self.testRequestID });
                // Send Test Request to counter party
                var msgTestRequest = _.extend({}, self.standardMessage.TestRequest, { '112': self.testRequestID++ });
                self.sendMsg(msgTestRequest, function(msg) {});
            }

            //==counter party might be dead, kill connection
            if (currentTime - self.timeOfLastIncoming > heartbeatInMilliSeconds * 2 && self.options.shouldExpectHeartbeats) {
                var errorMsg = 'No heartbeat from counter party in milliseconds ' + heartbeatInMilliSeconds * 1.5;
                self._sendError('FATAL', errorMsg);
                self.isLoggedIn = false;
                return;
            }
        }

        var logon =  function(fix) {
            var msgSeqNumStr = fix['34'];
            var msgLogon = _.extend({}, self.standardMessage.Logon);
            if (isTagExists(fix, 108, 'Heartbeat message missing from logon, will use default')){
                heartbeatInMilliSeconds = parseInt(fix[108], 10) * 1000;
            } else {
                return false;
            }

            if (self.options.shouldRespondToLogon === true) {
                if ('141' in fix){
                    if (fix['141'] == 'Y') {
                        self.options.incomingSeqNum = 0;
                        self.options.outgoingSeqNum = 0;
                        _.extend(msgLogon, { '141': 'Y' });
                    }
                }
                _.extend(msgLogon, { '108': fix[108] }, self.options.responseLogonExtensionTags);
                if (self.options.outgoingSeqNum == 0) {
                    _.extend(msgLogon, { '141': 'Y' });
                }
                self.sendMsg(msgLogon, function(msg) {});
            }

            return true;
        }

        var checkSequenceNumber = function(fix) {
            var msgType = fix['35'];
            if (!_.include(['A', '2', '1'], msgType)) {
                var msgSeqNumStr = fix['34'];
                var msgSeqNum = parseInt(msgSeqNumStr, 10);
                // Incoming SeqNum is match
                if (msgSeqNum == parseInt(self.options.incomingSeqNum) + 1) {
                    self.options.incomingSeqNum++;
                    self.isResendRequested = false;
                    self._sendState({ incomingSeqNum: msgSeqNum, sessionIncomingSeqNum: self.options.incomingSeqNum, isResendRequested: self.isResendRequested });
                    return true;
                } else if (msgSeqNum < self.options.incomingSeqNum) { // SeqNum is LOWER
                    if (fix['43'] == 'Y') {
                        return true; // if it is possible a duplicate message, we just ignore it.
                    } else {
                        var error = 'Incoming sequence number (' + msgSeqNum + ') lower than expected (' + self.options.incomingSeqNum + ') : ' + JSON.stringify(fix);
                        self._sendError('FATAL', error);
                        return false;
                    }
                } else { // SeqNum is HIGHER
                    if (self.isResendRequested === false) {
                        self.isResendRequested = true;

                        self._sendState({ incomingSeqNum: msgSeqNum, sessionIncomingSeqNum: self.options.incomingSeqNum, isResendRequested: self.isResendRequested });
                        var msgResend = _.extend({}, self.standardMessage.ResendRequest, { '7': self.options.incomingSeqNum.toString(), '16': '0' });
                        self.sendMsg(msgResend, function(msg) {});
                        return false;
                    }
                    return true;
                }
            }
            return true;
        }

        var isTagExists = function(fix, tag, error) {
            if (!_.has(fix, 35)) {
                if (error != undefined) {
                    var errorMsg = error + JSON.stringify(fix);
                    self._sendError(null, errorMsg);
                }
                return false;
            }

            return true;
        }
        // ####################################

        //==Confirm message contains required fields
        if (!isTagExists(fix, 35, 'Message contains no tag 35, unable to continue:')) return;
        if (!isTagExists(fix, 34, 'Message contains no tag 34, unable to continue:')) return;
        if (!isTagExists(fix, 49, 'Message contains no tag 49, unable to continue:')) return;
        if (!isTagExists(fix, 56, 'Message contains no tag 56, unable to continue:')) return;
        if (!isTagExists(fix, 52, 'Message contains no tag 52, unable to continue:')) return;


        var msgType = fix['35'];
        if (self.isLoggedIn === false) {
            // The first message must be A
            if (msgType !== 'A') {
                var errorMsg = 'First message must be logon:' + JSON.stringify(fix);
                self._sendError('FATAL', errorMsg);
                self.isLoggedIn = false;
                self._endSession();
                return;
            }

            var senderID = fix['49'];
            var targetID = fix['56'];

            if (senderID != targetCompID || targetID != senderCompID) {
                var errorMsg = 'Session sender / target ID is not match:' + JSON.stringify(fix);
                self._sendError('FATAL', errorMsg);
                return;
            }

            self.isLoggedIn = logon(fix);
            if (!self.isLoggedIn) return;
            self.emit('logon', fix);
            self._sendState({ isLoggedIn: self.isLoggedIn });
            self.options.incomingSeqNum = fix['34']
            self._sendState({ incomingSeqNum: self.options.incomingSeqNum });

            self.heartbeatIntervalID = setInterval(heartbeat, heartbeatInMilliSeconds);
        }

        var result = checkSequenceNumber(fix);
        if (result) {
            switch(msgType) {
                case '4': // SequenceReset message
                    if (_.isUndefined(fix['123']) || fix['123'] === 'N') {
                        var resetseqnostr = fix['36'];
                        if (_.isUndefined(resetseqnostr)) {
                            var error = 'No new sequence number: ' + JSON.stringify(fix);
                            self._sendError(null, error);
                            return;
                        } else {
                            var resetseqno = parseInt(resetseqnostr, 10);
                            if (resetseqno >= self.options.incomingSeqNum) {
                                self.options.incomingSeqNum = resetseqno;
                                self._sendState({ incomingSeqNum: self.options.incomingSeqNum });
                            } else {
                                var error = 'Seq-reset may not decrement sequence numbers: ' + JSON.stringify(fix);
                                self._sendError(null, error);
                                return;
                            }
                        }
                    } else {
                        var newSeqNoStr = fix['36'];
                        var newSeqNo = parseInt(newSeqNoStr, 10);

                        if (newSeqNo >= self.options.incomingSeqNum) {
                            self.options.incomingSeqNum = newSeqNo;
                            self._sendState({ incomingSeqNum: self.options.incomingSeqNum });
                        } else {
                            var error = 'Seq-reset may not decrement sequence numbers: ' + JSON.stringify(fix);
                            self._sendError(null, error);
                            return;
                        }
                    }
                    break;
                case '1': // TestRequest Message
                    self.options.incomingSeqNum = fix['34']
                    self._sendState({ incomingSeqNum: self.options.incomingSeqNum });

                    var msgHeartbeat = _.extend({}, self.standardMessage.Heartbeat, {'112': fix['112'] });
                    self.sendMsg(msgHeartbeat, function(msg) {});
                    break;
                case '2': //send seq-reset with gap-fill Y
                    self.options.incomingSeqNum = fix['34']
                    self._sendState({ incomingSeqNum: self.options.incomingSeqNum });

                    var msgSequenceReset = _.extend({}, self.standardMessage.SequenceReset, { '123': 'N','36': self.options.outgoingSeqNum+2 });
                    self.sendMsg(msgSequenceReset, function(msg) {});

                    // ResendRequest message
                    // if (self.store != undefined) {
                    //     self.store.each(function(json) {
                    //         var _msgType = json[35];
                    //         var _seqNo = json[34];
                    //         if (_.include(['A', '5', '2', '0', '1', '4'], _msgType)) {
                    //             //send seq-reset with gap-fill Y
                    //             var msgSequenceReset = _.extend({}, self.standardMessage.msgSequenceReset, { '123': 'Y','36': _seqNo });
                    //             self.sendMsg(msgSequenceReset,  function(err, msg) {});
                    //         } else {
                    //             // Send possible duplicate message
                    //             var msgDuplicated = _.extend({}, json, { '43': 'Y' });
                    //             self.sendMsg(msgDuplicated,  function(err, msg) {});
                    //         }
                    //     });
                    // }
                    break;
                case '5': // Logout Message
                    self.options.incomingSeqNum = fix['34']
                    self._sendState({ incomingSeqNum: self.options.incomingSeqNum });

                    var msgLogout = _.extend({}, fix, self.options.responseLogoutExtensionTags);
                    if (!self.isLogoutRequested) { self.sendMsg(msgLogout, function(msg) {})};

                    self._endSession();
                    break;
                default:
                    self.emit('msg', fix);
                    break;
            }
        }
    }

    //internal methods (non-public)
    this._sendError = function(type, msg) {
        self.emit('error', msg);
        if (type === 'FATAL') {
            self._endSession();
        }
    }

    //internal methods (non-public)
    this._sendState = function(msg) {
        self.emit('state', msg);
    }

    this._endSession = function() {
        clearInterval(self.heartbeatIntervalID);
        self.emit('endsession');
    }
}
util.inherits(FixClientSession, events.EventEmitter);
