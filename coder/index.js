var Encoder = require('./encoder.js');
var Decoder = require('./decoder.js');

module.exports = Coder;

function Coder(version, dictionary) {
    var self = this;

    self.version = version;
    self.spec = dictionary;

    this.encode = function(msg) {
        if (self.spec != undefined)
            return Encoder.convertToFix(self.version, msg, self.spec);
        else
            return null;
    }

    this.decode = function(msg) {
        if (self.spec != undefined)
            return Decoder.convertFromFix(self.version, msg, self.spec);
        else
            return null;
    }
}
