var _ = require('underscore');
var moment = require('moment');
var SOHCHAR = exports.SOHCHAR = String.fromCharCode(1);

function byteCount(s) {
    return encodeURI(s).split(/%..|./).length - 1;
}

var convertToFix = exports.convertToFix = function(fixVersion, msgraw, spec) {
    var msg = {};
    var timeStamp = msgraw[52];
    var senderCompID = msgraw[49];
    var targetCompID = msgraw[56];
    var outgoingSeqNum = msgraw[34];

    for (var tag in msgraw) {
        if (msgraw.hasOwnProperty(tag))
            msg[tag] = msgraw[tag];
    }

    delete msg['9']; //bodylength
    delete msg['10']; //checksum

    var headermsg = encodeMsgHeader(msg[35], timeStamp, senderCompID, targetCompID, outgoingSeqNum);
    var bodymsg = encodeMsgBody(spec, msg);

    var outmsg = "8="+fixVersion+SOHCHAR;
    outmsg += "9="+(byteCount(headermsg) + byteCount(bodymsg)).toString()+SOHCHAR;
    outmsg += headermsg;
    outmsg += bodymsg;

    outmsg += '10=' + checksum(outmsg) + SOHCHAR;

    return outmsg;
}

var getMessageDefinition = function(dictionary, msgtype) {
    var msg_defs = dictionary.fix.messages.message.filter(function(o) { return o._msgtype == msgtype});
    if (msg_defs.length > 0) {
        return msg_defs[0];
    }

    return null;
}

var checksum = function(str) {
    var chksm = 0;
    var strBuffer = Buffer.from(str, 'utf8');
    for (var i = 0; i < strBuffer.length; i++) {
        chksm += strBuffer[i];
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

var deepCopy = function(obj) {
    if (Object.prototype.toString.call(obj) === '[object Array]') {
        var out = [], i = 0, len = obj.length;
        for ( ; i < len; i++ ) {
            out[i] = arguments.callee(obj[i]);
        }
        return out;
    }
    if (typeof obj === 'object') {
        var out = {}, i;
        for ( i in obj ) {
            out[i] = arguments.callee(obj[i]);
        }
        return out;
    }
    return obj;
}

// ################# Encode #########################
var encodeMsgHeader = function(msgType, timeStamp, senderCompID, targetCompID, outgoingSeqNum) {
    var headermsgarr = [];
    headermsgarr.push('35=' + msgType, SOHCHAR);
    if (_.isNumber(timeStamp)) {
        headermsgarr.push('52=' + getUTCTimeStamp(new Date(timeStamp)), SOHCHAR);
    } else {
        headermsgarr.push('52=' + timeStamp, SOHCHAR);
    }
    headermsgarr.push('49=' + senderCompID, SOHCHAR);
    headermsgarr.push('56=' + targetCompID, SOHCHAR);
    headermsgarr.push('34=' + outgoingSeqNum, SOHCHAR);

    var headermsg = headermsgarr.join('');

    return headermsg;
}

var encodeMsgBody = function(spec, msg) {
    var bodymsgarr = [];
    var msgtype = msg[35];
    var msg_def = null;
    var msgraw = deepCopy(msg);
    var admin_msg_types = ['0','1','2','3','4','5','A'];
    var system_tags = ['8','9','10','34','35','49','52','56'];

    // Get message definition by type
    msgDef = getMessageDefinition(spec, msgtype);

    // Remove all header / trailer tags
    for (key in system_tags) {
        var tag = system_tags[key];
        delete msgraw[tag];
    }

    // if it is admin message
    if (admin_msg_types.indexOf(msgtype) >= 0) {
        for (var tag in msgraw) {
            if (msgraw.hasOwnProperty(tag)) {
                bodymsgarr.push(tag, '=', msgraw[tag], SOHCHAR);
            }
        }
    } else { // if it is not admin message
        // First, build message fields
        var msgfieldsarr = encodeFields(msgDef.field, msgraw);
        bodymsgarr = bodymsgarr.concat(msgfieldsarr);

        // Second, build message components
        if (msgDef.component != undefined) {
            var componentsarr = encodeComponents(msgDef.component, msgraw);
            bodymsgarr = bodymsgarr.concat(componentsarr);
        }

        // Third, build message group
        if (msgDef.group != undefined) {
            var grouparr = encodeGroup(msgDef.group, msgraw);
            bodymsgarr = bodymsgarr.concat(grouparr);
        }
    }

    var bodymsg = bodymsgarr.join('');

    return bodymsg;
}

var encodeFields = function(fields, msgraw) {
    var fieldsarr = [];
    var message_fields = [];

    // Handling when there is only one field.
    if (Array.isArray(fields)) {
        message_fields = fields;
    } else {
        message_fields.push(fields);
    }

    message_fields.forEach(function(field) {
        if (field._number in msgraw){
            fieldsarr.push(field._number, '=', msgraw[field._number], SOHCHAR);
            delete msgraw[field._number];
        }
    });

    // All tags which not be defined in spec, will be appended.
    for(key in msgraw) {
        if (msgraw.hasOwnProperty(key)) {
            if (typeof(msgraw[key]) != "object"){
                fieldsarr.push(key, '=', msgraw[key], SOHCHAR);
                delete msgraw[key];
            }
        }
    }

    return fieldsarr;
}

var encodeComponents = function(components, msgraw) {
    var componentsarr = [];
    var message_components = [];

    // Handling when there is only one component.
    if (Array.isArray(components)) {
        message_components = components;
    } else {
        message_components.push(components);
    }

    message_components.forEach(function(component) {
        var componentarr = [];

        // handle field in component if exists
        if ('field' in component) {
            var arr = encodeFields(component.field, msgraw);
            componentarr = componentarr.concat(arr);
        }

        // handle sub-component in component if exists
        if ('component' in component) {
            var arr = encodeComponents(component.component, msgraw);
            componentarr = componentarr.concat(arr);
        }

        // handle repeating-group in component if exists
        if ('group' in component) {
            var arr = encodeGroup(component.group, msgraw);
            componentarr = componentarr.concat(arr);
        }

        componentsarr = componentsarr.concat(componentarr);
    });

    return componentsarr;
}

var encodeGroup = function(group, msgraw) {
    var grouparr = [];

    var message_groups = [];

    // Handling when there is only one group.
    if (Array.isArray(group)) {
        message_groups = group;
    } else {
        message_groups.push(group);
    }

    message_groups.forEach(function(gp) {
        if (gp._number in msgraw) {
            var group_message = msgraw[gp._number];
            // Set repeating group tag with sub tags length
            grouparr.push(gp._number, '=', group_message.length, SOHCHAR);

            group_message.forEach(function(gm) {
                // handle fields in group if exists
                if ('field' in gp) {
                    var arr = encodeFields(gp.field, gm);
                    grouparr = grouparr.concat(arr);
                }
                // handle sub-component in group if exists
                if ('component' in gp) {
                    var arr = encodeComponents(gp.component, gm);
                    grouparr = grouparr.concat(arr);
                }
                // handle sub-group in group if exists
                if ('group' in gp) {
                    var arr = encodeGroup(gp.group, gm);
                    grouparr = grouparr.concat(arr);
                }

                if (!isEmpty(gm)) {
                    // All groups which not be defined in spec, will be appended.
                    grouparr = grouparr.concat(encodeUndefinedGroup(gm));
                }
            });

            // remove handled group object in msgraw
            delete msgraw[gp._number];
        }

    });
    return grouparr;
}

var isEmpty = function isEmpty(obj) {
    for(var key in obj) {
        if(obj.hasOwnProperty(key))
            return false;
    }
    return true;
}

var encodeUndefinedGroup = function(msgraw) {
    var grouparr = [];
    for(key in msgraw) {
        if (msgraw.hasOwnProperty(key)) {
            if (typeof(msgraw[key]) == "object"){
                grouparr.push(key, '=', msgraw[key].length, SOHCHAR);
                grouparr = grouparr.concat(encodeUndefinedGroup(msgraw[key]));
            } else {
                grouparr.push(key, '=', msgraw[key], SOHCHAR);
            }
        }
    }

    return grouparr;
}
// ################# Encode #########################
