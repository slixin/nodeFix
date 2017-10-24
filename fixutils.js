var _ = require('underscore');
var moment = require('moment');
var net = require('net');
var request = require('request');

var SOHCHAR = exports.SOHCHAR = String.fromCharCode(1);

var uuid = exports.uuid = function() {
    function s4() {
        return Math.floor((1 + Math.random()) * 0x10000)
            .toString(16)
            .substring(1);
    }
    return s4() + s4() + '-' + s4() + '-' + s4() + '-' +
        s4() + '-' + s4() + s4() + s4();
}

var randomString = exports.randomString = function(seed, length){
    var text = "";
    var possible = seed == undefined ? "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789" : seed;

    for( var i=0; i < length; i++ )
        text += possible.charAt(Math.floor(Math.random() * possible.length));

    return text;
}

var randomDouble = exports.randomDouble = function(min, max) {
    return Math.random() < 0.5 ? ((1-Math.random()) * (max-min) + min) : (Math.random() * (max-min) + min);
}

var getCurrentUTCTimeStamp = exports.getCurrentUTCTimeStamp = function(format) {
    return getUTCTimeStamp(moment().utc(), format == undefined ?  'YYYYMMDD-HH:mm:ss.SSS' : format);
}

var getUTCTimeStamp = exports.getUTCTimeStamp = function(utcTime, format) {
    return utcTime.format(format);
}

var checksum = exports.checksum = function(str) {
    var chksm = 0;
    for (var i = 0; i < str.length; i++) {
        chksm += str.charCodeAt(i);
    }

    chksm = chksm % 256;

    var checksumstr = '';
    if (chksm < 10) {
        checksumstr = '00' + (chksm + '');
    } else if (chksm >= 10 && chksm < 100) {
        checksumstr = '0' + (chksm + '');
    } else {
        checksumstr = '' + (chksm + '');
    }

    return checksumstr;
}

var normalize = exports.normalize = function(jsonmessage, object) {
    for(key in jsonmessage) {
        if (jsonmessage.hasOwnProperty(key)) {
            var tag_value = jsonmessage[key];
            // if the tag value is an object, that means it is a repeating group.
            if (typeof(tag_value) == "object") {
                tag_value = normalize(tag_value, object);
            } else {
                var nor_value = normalizeValue(tag_value, object);
                if (nor_value == 'null') {
                    delete jsonmessage[key];
                } else {
                    jsonmessage[key] = nor_value;
                }

            }
        }
    }
    return jsonmessage;
}

var normalizeValue = exports.normalizeValue = function(value, object) {
    var re = /%%([^%%]+)%%/g;
    var replace_value = value;
    var match = re.exec(replace_value);
    if (match != undefined) {
        var wildcard = match[1];

        // GUID generator
        if (wildcard == 'guid') {
            replace_value = replace_value.replace(re, uuid());
        }

        // Generate UTC now
        if (wildcard.startsWith('now')) {
            var t = moment.utc();

            if (wildcard.length > 3) { // Not only 'now', but with time difference
                var opt = wildcard[3];
                var diff = parseInt(wildcard.substr(4, wildcard.length-4));

                var unit = wildcard.substr(wildcard.length-1, 1);
                if (opt == '+')
                    t = t.add(diff, unit);
                else
                    t = t.subtract(diff, unit);
            }
            replace_value = replace_value.replace(re, t.format('YYYYMMDD-HH:mm:ss.SSS'));
        }

        if (wildcard.startsWith('timestamp')) {
            replace_value = (((new Date).getTime()) / 1000).toFixed(3).toString();
        }

        if (wildcard.startsWith('randomdouble')) {
            var wildcard_array = wildcard.split(':');

            var min = wildcard_array[1];
            var max = wildcard_array[2];
            var random_double = randomDouble(min, max);
            replace_value = replace_value.replace(re, random_double);
        }

        if (wildcard.startsWith('randomnumber')) {
            var wildcard_array = wildcard.split(':');

            var length = wildcard_array[1];
            var random_num = randomString('0123456789', length);
            replace_value = replace_value.replace(re, random_num);
        }

        if (wildcard.startsWith('randomstring')) {
            var wildcard_array = wildcard.split(':');
            var seed = null;
            var length = wildcard_array[1];

            if (wildcard_array.length > 1)
                seed = wildcard_array[2];
            var random_str = randomString(seed, length);
            replace_value = replace_value.replace(re, random_str);
        }

        if (wildcard.startsWith('@')) {
            var field = wildcard.replace('@', '');
            if (object.hasOwnProperty(field)) {
                replace_value = replace_value.replace(re, object[field]);
            } else {
                replace_value = replace_value.replace(re, null);
            }
        }

        if (wildcard.startsWith('exp')) {
            var exp = wildcard.substr(4, wildcard.length -5);
            for(var key in object) {
                if (object.hasOwnProperty(key)) {
                    exp = exp.replace(new RegExp('@'+key, 'g'), object[key]);
                }
            }
            if (exp.indexOf('@') >= 0){
                replace_value = replace_value.replace(re, null);
            } else{
                replace_value = replace_value.replace(re,  eval(exp));
            }
        }
    }

    return replace_value;
}

var validateMessage = exports.validateMessage = function(dictionary, msg, cb) {
    var msgType = null;
    var errors = [];

    if ('35' in msg) {
        msgType = msg['35'];
        // Get message definition by message type
        msgDef = getMessageDefinition(dictionary, msgType);
        if (msgDef == undefined) {
            cb('Message type '+msgType+' is invalid.');
        } else {
            // Validate all required fields are in message
            if ('field' in msgDef) { errors = errors.concat(validateFields(msgDef.field, msg)); }

            // Validate all required components are in message
            if ('component' in msgDef) { errors = errors.concat(validateComponents(msgDef.component, msg)); }

            if (errors.length > 0) { cb(errors.join(' | '));
            } else { cb(null); }
        }
    } else {
        cb('Tag 35 is not in message');
    }
}

var getMessageDefinition = function(dictionary, msgtype) {
    var msg_defs = dictionary.fix.messages.message.filter(function(o) { return o._msgtype == msgtype});
    if (msg_defs.length > 0) {
        return msg_defs[0];
    }

    return null;
}

var getRequiredFields = function(fields) {
    return fields.filter(function(o) { return o._required == 'Y'} );
}

var getRequiredComponents = function(components) {
    return components.filter(function(o) { return o._required == 'Y'} );
}

// ################# Validate #########################
var validateFields = function(fields, message) {
    var errors = [];

    // Get required fields array if it is an array.
    if (Array.isArray(fields)) {
        var requiredFields = getRequiredFields(fields);
        requiredFields.forEach(function(rfield) {
            if (Array.isArray(message)) {
                message.forEach(function(m) {
                    if (!(rfield._number in m)) {
                        errors.push('Required field '+rfield._number+' is missing in:'+JSON.stringify(m));
                    }
                });
            } else {
                if (!(rfield._number in message)) {
                    errors.push('Required field '+rfield._number+' is missing in:'+JSON.stringify(message));
                }
            }
        });
    } else { // Check the field is required if it is only one field
        if (fields._required == 'Y'){
            if (!(fields._number in message)) {
                errors.push('Required field '+fields._number+' is missing in:'+JSON.stringify(message));
            }
        }
    }

    return errors;
}

var validateComponents = function(components, message) {
    var errors = [];

    // Get required component if the components is an array
    if (Array.isArray(components)) {
        var requiredComponents = getRequiredComponents(components);
        requiredComponents.forEach(function(rcomponent) {
            if ('field' in rcomponent) {
                errors = errors.concat(validateFields(rcomponent.field, message));
            }
            if ('component' in rcomponent) {
                errors = errors.concat(validateComponents(rcomponent.component, message));
            }
            if ('group' in rcomponent) {
                var group_num = rcomponent.group._number;
                var group_message = message[group_num];
                errors = errors.concat(validateGroup(rcomponent.group, group_message));
            }
        });
    } else { // Check the component is required if it is single
        if (components._required == 'Y'){
            if ('field' in components) {
                errors = errors.concat(validateFields(components.field, message));
            }
            if ('component' in components) {
                errors = errors.concat(validateComponents(components.component, message));
            }
            if ('group' in components) {
                var group_num = components.group._number;
                var group_message = message[group_num];
                errors = errors.concat(validateGroup(components.group, group_message));
            }
        }
    }

    return errors;
}

var validateGroup = function(group, message) {
    var errors = [];
    if (group._required == 'Y') {
        if ('field' in group) {
            errors = errors.concat(validateFields(group.field, message));
        }
        if ('component' in group) {
            errors = errors.concat(validateComponents(group.component, message));
        }
        if ('group' in group) {
            var group_num = group.group._number;
            var group_message = message[group_num];
            errors = errors.concat(validateGroup(group.group, group_message));
        }
    }

    return errors;
}
// ################# Validate #########################





