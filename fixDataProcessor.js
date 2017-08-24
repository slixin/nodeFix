var util = require('util');
var events = require('events');
var fixutils = require('./fixutils.js');
var _ = require('underscore');

module.exports = FixDataProcessor;

// This module is used to extract the socket data to Normal Fix text message
function FixDataProcessor(fixVersion) {
  var ENDOFTAG8 = fixVersion.length+3;
  var STARTOFTAG9VAL = ENDOFTAG8 + 2;
  var SIZEOFTAG10 = 8;

  this.buffer = '';
  var self = this;

  this.processData = function(data) {
    self.buffer = self.buffer + data;
    while (self.buffer.length > 0) {
      if (self.buffer.length <= ENDOFTAG8) {
          return;
      }
      var _idxOfEndOfTag9Str = self.buffer.substring(ENDOFTAG8).indexOf(fixutils.SOHCHAR);
      var idxOfEndOfTag9 = parseInt(_idxOfEndOfTag9Str, 10) + ENDOFTAG8;

      if (isNaN(idxOfEndOfTag9)) {
        var error = '[ERROR] Unable to find the location of the end of tag 9. Message probably malformed: ' + self.buffer.toString();
        self.emit('error', error);
        return;
      }

      if (idxOfEndOfTag9 < 0 && self.buffer.length > 100) {
          var error = '[ERROR] Over 100 character received but body length still not extractable.  Message malformed: ' + self.buffer.toString();
          self.emit('error', error);
          return;
      }

      if (idxOfEndOfTag9 < 0) {
          return;
      }
      var _bodyLengthStr = self.buffer.substring(STARTOFTAG9VAL, idxOfEndOfTag9);
      var bodyLength = parseInt(_bodyLengthStr, 10);
      if (isNaN(bodyLength)) {
          var error = "[ERROR] Unable to parse bodyLength field. Message probably malformed: bodyLength='" + _bodyLengthStr + "', msg:" + self.buffer.toString()
          self.emit('error', error);
          return;
      }

      var msgLength = bodyLength + idxOfEndOfTag9 + SIZEOFTAG10;
      if (self.buffer.length < msgLength) {
          return;
      }

      var msg = self.buffer.substring(0, msgLength);
      if (msgLength == self.buffer.length) {
          self.buffer = '';
      } else {
          var remainingBuffer = self.buffer.substring(msgLength);
          self.buffer = remainingBuffer;
      }

      var calculatedChecksum = fixutils.checksum(msg.substr(0, msg.length - 7));
      var extractedChecksum = msg.substr(msg.length - 4, 3);

      if (calculatedChecksum !== extractedChecksum) {
          var error = '[WARNING] Discarding message because body length or checksum are wrong (expected checksum: ' + calculatedChecksum + ', received checksum: ' + extractedChecksum + '): [' + msg + ']'
          self.emit('error', error);
          return;
      }

      self.emit('msg', msg);
    }
  }
}
util.inherits(FixDataProcessor, events.EventEmitter);
