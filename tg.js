var Telegram = require('node-telegram-bot-api');
var fs = require('fs');
var irc = require('./irc');

// tries to read chat ids from a file
var readChatIds = function(arr) {
    console.log('\n');
    console.log('NOTE!');
    console.log('=====');

    var idMissing = false;
    try {
        var json = JSON.parse(fs.readFileSync(process.env.HOME + '/.teleirc/chat_ids'));
        for (var i = 0; i < arr.length; i++) {
            var key = arr[i].tgGroup;
            if (key in json) {
                arr[i].tgChatId = json[key];
                console.log('id found for:', key, ':', json[key]);
            } else {
                console.log('id not found:', key);
                idMissing = true;
            }
        }
    } catch (e) {
        console.log('~/.teleirc/chat_ids file not found!');
        idMissing = true;
    }

    if (idMissing) {
        console.log(
            '\nPlease add your Telegram bot to a Telegram group and have' +
            '\nsomeone send a message to that group.' +
            '\nteleirc will then automatically store your group chat_id.');
    }

    console.log('\n');
};

var writeChatIds = function(config) {
    var json = {};
    for (var i = 0; i < config.channels.length; i++) {
        if (config.channels[i].tgChatId) {
            json[config.channels[i].tgGroup] = config.channels[i].tgChatId;
        }
    }
    json = JSON.stringify(json);
    fs.writeFile(process.env.HOME + '/.teleirc/chat_ids', json, function(err) {
        if (err) {
            console.log('error while storing chat ID:');
            console.log(err);
        } else {
            console.log('successfully stored chat ID in ~/.teleirc/chat_ids');
        }
    });
};

var getName = function(user) {
    var name = '';

    if (config.ircTgShowName == 1) {
        // first_name
        return user.first_name ? user.first_name + '' : '';
    } else {
        if (config.ircTgShowName == 2) {
            // first_name last_name
            name = user.first_name ? user.first_name + ' ' : '';
            return name + user.last_name ? user.last_name : '';
        } else {
            if (config.ircTgShowName == 3) {
                // first_name last_name @username
                name = user.first_name ? user.first_name + ' ' : '';
                name += user.last_name ? user.last_name : '';
                return name + user.username ? '(@' + user.username + ')' : '(No username)';
            } else {
                // @username
                if (user.username === undefined) {
                    return user.first_name + ' ' + user.last_name;
                } else {
                    return '@' + user.username;
                }
            }
        }
    }
};

module.exports = function(config, sendTo) {
    var tg = new Telegram(config.tgToken,{polling: true});

    readChatIds(config.channels);

    tg.on('message', function(msg) {
        var channel = config.channels.filter(function(channel) {
            return channel.tgGroup === msg.chat.title;
        })[0];

        if (!channel) {
            return;
        }

        if (!channel.tgChatId) {
            console.log('storing chat ID: ' + msg.chat.id);
            channel.tgChatId = msg.chat.id;
            writeChatIds(config);
        }

        var name = getName(msg.from);

        // skip posts containing media if it's configured off
        if ((msg.audio || msg.document || msg.photo || msg.sticker || msg.video ||
            msg.voice || msg.contact || msg.location) && !config.showMedia) {
            return;
        }

        var text;

        if (msg.reply_to_message && msg.text) {
            text = '@' + msg.reply_to_message.from.username + ', ' + msg.text;
        } else if (msg.audio) {
            text = '(Audio)';
        } else if (msg.document) {
            text = '(Document)';
        } else if (msg.photo) {
            var fileid = msg.photo[msg.photo.length - 1].file_id;
            var promise = tg.getFileLink(fileid);
            promise.then(function(path) {
                console.log(path);
                sendTo.irc(channel.ircChan, '<' + name + '>: ' + path);
                return path;
            });
            return;

        } else if (msg.sticker) {
            text = '(Sticker)';
        } else if (msg.video) {
            text = '(Video, ' + msg.video.duration + 's)';
        } else if (msg.voice) {
            text = '(Voice, ' + msg.audio.duration + 's)';
        } else if (msg.contact) {
            text = '(Contact, ' + '"' + msg.contact.first_name + ' ' +
                                        msg.contact.last_name + '", ' +
                                        msg.contact.phone_number + ')';
        } else if (msg.location) {
            text = '(Location, lon: ' + msg.location.longitude +
                            ', lat: ' + msg.location.latitude + ')';
        } else if (msg.new_chat_participant) {
            text = '(Added: ' + msg.new_chat_participant.first_name + ')';
        } else if (msg.left_chat_participant) {
            text = '(Removed: ' + msg.left_chat_participant.first_name + ')';
        } else {
            text = msg.text;
        }

        sendTo.irc(channel.ircChan, '<' + name + '>: ' + text);
    });

    sendTo.tg = function(channel, msg) {
        console.log('  >> relaying to TG: ' + msg);

        if (!channel.tgChatId) {
            var err = 'ERROR: No chat_id set! Add me to a Telegram group ' +
                      'and say hi so I can find your group\'s chat_id!';
            sendTo.irc(channel.ircChan, err);
            console.error(err);
            return;
        }

        tg.sendMessage(channel.tgChatId, msg);
    };
};
