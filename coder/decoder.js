var _ = require('underscore');
var moment = require('moment');

var SOHCHAR = exports.SOHCHAR = String.fromCharCode(1);

var convertFromFix = exports.convertFromFix = function(fixVersion, fixtxt, spec) {
    var map = {};
    var tags = [];
    var values = [];
    var msgtags = fixtxt.replace('\n','').split(SOHCHAR).filter(function(el) {return el.length != 0});

    msgtags.forEach(function(msgtag) {
        if (msgtag.length > 0) {
            tags.push(msgtag.split('=')[0]);
            values.push(msgtag.split('=')[1]);
        }
    });
    var tag_msgtype_index = tags.findIndex(x => x == '35');
    var msgtype = values[tag_msgtype_index];
    if (msgtype != undefined) {
        _.extend(map, decodeMsgBody(spec, msgtype, tags, values));
    }

    return map;
}

var getMessageDefinition = function(dictionary, msgtype) {
    var msg_defs = dictionary.fix.messages.message.filter(function(o) { return o._msgtype == msgtype});
    if (msg_defs.length > 0) {
        return msg_defs[0];
    }

    return null;
}

// ################# Decode #########################
var decodeMsgBody = function(dictionary, msgtype, tags, values) {
    var map = {};

    // Get message definition by type
    msgDef = getMessageDefinition(dictionary, msgtype);

    // First, handling all group tags for incoming message.
    if ('group' in msgDef) {
        _.extend(map, decodeGroup(msgDef.group, tags, values));
    }
    // Second, handling all groups inside of components for incoming message.
    if ('component' in msgDef) {
        _.extend(map, decodeComponentGroups(msgDef.component, tags, values));
    }
    // Third, go through all fields in message definition
    if ('field' in msgDef) {
        _.extend(map, decodeFields(msgDef.field, tags, values, false));
    }
    // Fourth, handling all fields in component of definiton, not includes group
    if ('component' in msgDef) {
        _.extend(map, decodeComponentFields(msgDef.component, tags, values));
    }
    // Fifth, appending all missing tags
    var customizedtags = tags.filter(function(o) { return o != undefined});
    var customizedvalues = values.filter(function(o) { return o != undefined});
    if (customizedtags.length > 0) {
        for(key in customizedtags) {
            map[customizedtags[key]] = customizedvalues[key];
        }
    }
    return map;
}

var decodeGroup = function(group, tags, values) {
    var map = {};
    var deGroups = [];

    if (Array.isArray(group)) {
        deGroups = group;
    } else {
        deGroups.push(group);
    }

    deGroups.forEach(function(gp) {
        // Check the incoming message includes group number
        var group_num = gp._number;
        var group_tag_index = tags.findIndex(x => x == group_num);
        // If group exists
        if (group_tag_index >= 0) {
            // Get repeating times for group
            var group_repeat_times = values[group_tag_index];
            // Initial group node in map
            map[group_num] = [];
            for(var i=0; i< group_repeat_times; i++) {
                var group_item = {};

                // If there are sub-group in group, repeating handling
                if ('group' in gp) {
                    _.extend(group_item, decodeGroup(gp.group, tags, values));
                }

                // If there are sub-components in group, repeating handling
                if ('component' in gp) {
                    _.extend(group_item, decodeComponentGroups(gp.component, tags, values));
                }

                // handling fields in group
                _.extend(group_item, decodeFields(gp.field, tags, values, true));

                // Push the sub-item into group
                map[group_num].push(group_item);
            }
            // Remove the mapped group tag in tags and values array
            var tag_index = tags.findIndex(x => x == group_num);
            delete tags[tag_index];
            delete values[tag_index];
        }
    });

    return map;
}

var decodeComponentGroups = function(component, tags, values) {
    var map = {};
    var deComponents = [];

    if (Array.isArray(component)) {
        deComponents = component;
    } else {
        deComponents.push(component);
    }

    // Go through all components which with Group in definition
    deComponents.forEach(function(comp) {
        // If component has a group, handle it
        if ('group' in comp) {
            _.extend(map, decodeGroup(comp.group, tags, values));
        }
        // If component has sub-component, handle all groups in sub-component
        if ('component' in comp) {
            _.extend(map, decodeComponentGroups(comp.component, tags, values));
        }

        // handling fields in group
        if ('field' in comp) {
            _.extend(map, decodeFields(comp.field, tags, values, false));
        }
    });

    return map;
}

var decodeFields = function(fields, tags, values, isgroup) {
    var map = {}
    if (!isgroup) {
        // Go through all fields definition
        if (Array.isArray(fields)) {
            var index = 0;
            fields.forEach(function(field) {
                // Find out the field which exists in incoming message and convert to map.
                var field_num = field._number;
                var field_tag_index = tags.findIndex(x => x == field_num);
                if (field_tag_index >= 0) {
                    map[field_num] = values[field_tag_index];
                    // Remove the mapped field in tags and values array
                    delete tags[field_tag_index];
                    delete values[field_tag_index];
                }

                index++;
            });
        } else {
            var field_num = fields._number;
            var field_tag_index = tags.findIndex(x => x == field_num);
            if (field_tag_index >= 0) {
                map[field_num] = values[field_tag_index];
                // Remove the mapped field in tags and values array
                delete tags[field_tag_index];
                delete values[field_tag_index];
            }
        }
    } else {
        // Go through all fields definition
        var field_count = fields.length;
        if (Array.isArray(fields)) {
            var index = 0;
            var first_tag_index = 0;
            fields.forEach(function(field) {
                // Find out the field which exists in incoming message and convert to map.
                var field_num = field._number;
                var field_tag_index = tags.findIndex(x => x == field_num);
                if (index == 0)
                    first_tag_index = field_tag_index;

                if (field_tag_index >= 0 && field_tag_index < first_tag_index + field_count) {
                    map[field_num] = values[field_tag_index];
                    // Remove the mapped field in tags and values array
                    delete tags[field_tag_index];
                    delete values[field_tag_index];
                }

                index++;
            });
        } else {
            var field_num = fields._number;
            var field_tag_index = tags.findIndex(x => x == field_num);
            if (field_tag_index >= 0) {
                map[field_num] = values[field_tag_index];
                // Remove the mapped field in tags and values array
                delete tags[field_tag_index];
                delete values[field_tag_index];
            }
        }
    }


    return map;
}

var decodeComponentFields = function(component, tags, values) {
    var map = {};
    var deComponents = [];

    if (Array.isArray(component)) {
        deComponents = component;
    } else {
        deComponents.push(component);
    }

    // Go through all components which with Group in definition
    deComponents.forEach(function(comp) {
        if ('field' in comp) {
            _.extend(map, decodeFields(comp.field, tags, values, false));
        }

        if ('component' in comp) {
            _.extend(map, decodeComponentFields(comp.component, tags, values));
        }
    });

    return map;
}
// ################# Decode #########################
