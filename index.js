/*jslint es6*/
const Discord = require('discord.js');
const { Permissions, ActionRowBuilder, ButtonBuilder, TextInputComponent, StringSelectMenuBuilder, TextInputStyle, Modal, PermissionFlagsBits, GatewayIntentBits, SlashCommandBuilder } = require('discord.js')
const client = new Discord.Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildWebhooks, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildEmojisAndStickers, GatewayIntentBits.GuildMembers] });
var mysql = require('mysql2');
var connection = mysql.createConnection({
    host: process.env.db_host,
    user: process.env.db_user,
    password: process.env.db_pass,
    database: process.env.db,
    supportBigNumbers: true,
    bigNumberStrings: true,
    multipleStatements: true
});
connection.connect();
console.log(process.env.app_token);
client.login(process.env.app_token);



/* COMNMAND STRUCTURE */
var allowmovement = new SlashCommandBuilder().setName('allowmovement')
    .setDescription('Lock or unlock movement globally or from a single location.')
    .addBooleanOption(option =>
        option.setName('enabled')
            .setDescription('Enabled or disabled.')
            .setRequired(true)
    ).addChannelOption(option =>
        option.setName('channel')
            .setDescription('The channel you wish to lock or unlock')
    ).setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

var addlocation = new SlashCommandBuilder().setName('addlocation')
    .setDescription('Allow movement to and from a location.')
    .addChannelOption(option =>
        option.setName('channel')
            .setDescription('The channel you wish to designate as movement-enabled/-disabled. New locations default this to ON.')
            .setRequired(true)
    ).addStringOption(option =>
        option.setName('friendly_name')
            .setDescription('What you\'d like this location to be called in announcements (if you set an announcements channel).')
            .setRequired(true)
    ).addBooleanOption(option =>
        option.setName('enabled')
            .setDescription('Simple true/false toggle')
            .setRequired(true)
    ).setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

var locationannouncements = new SlashCommandBuilder().setName('locationannouncements')
    .setDescription('Enable an announcements channel for a location.')
    .addChannelOption(option =>
        option.setName('location_channel')
            .setDescription('The location channel.')
            .setRequired(true)
    ).addChannelOption(option =>
        option.setName('announcements_channel')
            .setDescription('The announcements channel. Leave unset to remove. Can be set to location channel.')
    ).setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

var movementvisibility = new SlashCommandBuilder().setName('locationvisibility')
    .setDescription('Enable or disable the ability for players to view a location after they leave ("global read" mode)')
    .addChannelOption(option =>
        option.setName('location')
            .setDescription('Channel to designate as "visible when not present / global read". New locations default this to OFF.')
            .setRequired(true)
    ).addBooleanOption(option =>
        option.setName('enabled')
            .setDescription('Simple true/false toggle')
            .setRequired(true)
    ).setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

var resetlocationvis = new SlashCommandBuilder().setName('resetlocationvis')
    .setDescription('Re-run location visibility permissions for all locations for all players.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

//Create Players
var playercreate = new SlashCommandBuilder().setName('playercreate')
    .setDescription('Create a player based on a mentioned user.')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('The user to associate')
    )
    .addStringOption(option =>
        option.setName('player_name')
            .setDescription('The player name.')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

var characterlocation = new SlashCommandBuilder().setName('characterlocation')
    .setDescription('Move a character to a specific location.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// Characters Per Player (switching system // bot echoes) - TODO
// For now, playercreate should create a default character automatically in a separate table with the specified player_name.


var rps = new SlashCommandBuilder().setName('rps')
    .setDescription('Enter battle, either against another player or versus the robot.')
    .addUserOption(option =>
        option.setName('challengee')
            .setDescription('The player you wish to challenge (optional)')
    );

var move = new SlashCommandBuilder().setName('move')
    .setDescription('Move to a new location.');

var me = new SlashCommandBuilder().setName('me')
    .setDescription('Show your character sheet.')



//PRE-PROCESSING FUNCTIONS

async function isPlayer(userid, guildid) {
    var player_exists = await connection.promise().query('select * from players where user_id = ?', [userid, guildid]);
    if (player_exists[0].length > 0) {
        return true;
    }
    return false;
}



client.on('ready', async () => {
    await client.application.commands.set([allowmovement.toJSON(), locationannouncements.toJSON(), addlocation.toJSON(), movementvisibility.toJSON(), resetlocationvis.toJSON(), playercreate.toJSON(), characterlocation.toJSON(), rps.toJSON(), move.toJSON(), me.toJSON()]);
    client.user.setActivity("Infinite Magic Glories: Revolutionary Redux");
});

client.on('guildCreate', async (guild) => {
    guilds = await connection.promise().query('select * from games where guild_id = ?', [guild.id]);
    if (guilds[0].length == 0) {
        await connection.promise().query('insert into games (guild_id, active) values (?, ?)', [guild.id, 1]);
    } else {
        await connection.promise().query('update games set active = 1 where guild_id = ?', [guild.id]);
    }
});

client.on('guildDelete', async (guild) => {
    await connection.promise().query('update games set active = 0 where guild_id = ?', [guild.id]);
});


/* SLASH COMMAND PROCESSING */
client.on('interactionCreate', async (interaction) => {
    if (interaction.isCommand()) { // TODO: && command_enabled(interaction, guild_id)
        // ADMIN COMMANDS

        //REMEMBER - Every entity we create needs to be ABLE to be tied to a Guild ID
        // TOP LEVEL ENTITIES ALWAYS
        if (interaction.commandName == 'addlocation') {
            var thisChannel = interaction.options.getChannel('channel');
            var channelexists = await connection.promise().query('select * from movement_locations where guild_id = ? and channel_id = ?', [interaction.guildId, thisChannel.id]);
            if (channelexists[0].length > 0) {
                interaction.reply({ content: 'Looks like this channel is already set up as a location. :revolving_hearts:', ephemeral: true });
            } else {
                await connection.promise().query('insert into movement_locations (channel_id, guild_id, movement_allowed, global_read, friendly_name) values (?, ?, ?, ?, ?)', [thisChannel.id, interaction.guildId, 1, 0, interaction.options.getString('friendly_name')]);
                interaction.reply({ content: 'Location added; please use `/locationannouncements` to set the announcements channel for this location.', ephemeral: true });
            }

        } else if (interaction.commandName == 'locationannouncements') {
            // Channel 1 must be a location, channel 2 can be any channel not a category. This is where the movement announcements will happen for that location. If channel 2 is unset then unset it in DB.
            var thisChannel = interaction.options.getChannel('location_channel');
            var channelexists = await connection.promise().query('select * from movement_locations where guild_id = ? and channel_id = ?', [interaction.guildId, thisChannel.id]);
            if (channelexists[0].length > 0) {
                if (interaction.options.getChannel('announcements_channel')) {
                    var announcements_channel = interaction.options.getChannel('announcements_channel');
                    await connection.promise().query('update movement_locations set announcements_channel = ? where channel_id = ?', [announcements_channel.id, thisChannel.id]);
                } else {
                    await connection.promise().query('update movement_locations set announcements_channel = NULL where channel_id = ?', [thisChannel.id]);
                }
                interaction.reply({ content: 'Should be all set! (changed announcements channel value of ' + thisChannel.toString() + ' to ' + announcements_channel.toString() + ')', ephemeral: true });
            } else {
                interaction.reply({ content: 'Looks like this channel isn\'t a valid location. Try adding it via `/addlocation`. :revolving_hearts:', ephemeral: true });
            }
        } else if (interaction.commandName == 'allowmovement') {
            if (interaction.options.getChannel('channel')) {
                var thisChannel = interaction.options.getChannel('channel');
                var channelexists = await connection.promise().query('select * from movement_locations where guild_id = ? and channel_id = ?', [interaction.guildId, thisChannel.id]);
                if (channelexists[0].length > 0) {
                    var enabled = interaction.options.getBoolean('enabled');
                    await connection.promise().query('update movement_locations set movement_allowed = ? where channel_id = ?', [enabled, thisChannel.id]);
                    interaction.reply({ content: 'Should be all set! (changed movement allowed value of ' + thisChannel.toString() + ' to ' + enabled + ')', ephemeral: true });
                } else {
                    interaction.reply({ content: 'Looks like this channel isn\'t a valid location. Try adding it via `/addlocation`. :revolving_hearts:', ephemeral: true });
                }
            } else {
                var enabled = interaction.options.getBoolean('enabled');
                await connection.promise().query('update movement_locations set movement_allowed = ? where guild_id = ? ', [interaction.guildId, enabled]);
                interaction.reply({ content: 'Should be all set! (changed movement allowed value of ALL locations to ' + enabled + ')', ephemeral: true });
            }
        } else if (interaction.commandName == 'movementvisibility') {
            var thisChannel = interaction.options.getChannel('channel');
            var channelexists = await connection.promise().query('select * from movement_locations where guild_id = ? and channel_id = ?', [interaction.guildId, thisChannel.id]);
            if (channelexists[0].length > 0) {
                var enabled = interaction.options.getBoolean('enabled');
                await connection.promise().query('update movement_locations where channel_id = ? set global_read = ?', [thisChannel.id, enabled]);
                interaction.reply({ content: 'Should be all set! (changed global read value of ' + thisChannel.toString() + ' to ' + enabled + ')', ephemeral: true });
            } else {
                interaction.reply({ content: 'Looks like this channel isn\'t a valid location. Try adding it via `/addlocation`. :revolving_hearts:', ephemeral: true });
            }
        } else if (interaction.commandName == 'playercreate') {
            var user = interaction.options.getUser('user');
            var playerName = interaction.options.getString('player_name');
            var playerexists = await connection.promise().query('select * from players where user_id = ? and guild_id = ?', [user.id, interaction.guildId]); // Not using member id because it's a pain to get, and this way we could eventually let users look at all their characters in a web view maybe
            if (playerexists[0].length > 0) {
                interaction.reply({ content: 'A player entry for this user/server combo already exists! Sorry about that. :purple_heart:', ephemeral: true })
            } else {
                var inserted_player = await connection.promise().query('insert into players (user_id, guild_id, name) values (?, ?, ?)', [user.id, interaction.guildId, playerName]);
                var inserted_character = await connection.promise().query('insert into characters (name) values (?)', [playerName]); // This table also has "location", because all characters are in a location.
                await connection.promise().query('insert into players_characters (player_id, character_id, active) values (?, ?, ?)', [inserted_player[0].insertId, inserted_character[0].insertId, 1]); // Futureproofing for "multiple players can own a character".
                interaction.reply({ content: 'Added the player and character!', ephemeral: true });

            }
        } else if (interaction.commandName == 'characterlocation') {
            // Two dropdowns! Ah, ah, ah!

            var locations = await connection.promise().query('select * from movement_locations where guild_id = ?', [interaction.guildId]);
            if (locations[0].length > 0) {
                var locationsKeyValues = [{ label: 'Select a location', value: '0' }];
                for (const location of locations[0]) {
                    var thisLocationKeyValue = { label: location.friendly_name, value: location.id.toString() };
                    locationsKeyValues.push(thisLocationKeyValue);
                }
                const locationSelectComponent = new StringSelectMenuBuilder().setOptions(locationsKeyValues).setCustomId('LocationMovementSelector').setMinValues(1).setMaxValues(1);
                var locationSelectRow = new ActionRowBuilder().addComponents(locationSelectComponent);
                var characters = await connection.promise().query('select distinct c.* from characters c join players_characters pc on pc.character_id = c.id join players p on pc.player_id = p.id where p.guild_id = ? and pc.active = 1', [interaction.guildId]);
                if (characters[0].length > 0) {
                    var charactersKeyValues = [{ label: 'Select a character', value: '0' }];
                    for (const character of characters[0]) {
                        var thisCharacterKeyValue = { label: character.name, value: character.id.toString() };
                        charactersKeyValues.push(thisCharacterKeyValue);
                    }
                    const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('CharacterMovementSelector').setMinValues(1).setMaxValues(1);
                    var characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                    var message = await interaction.reply({ content: '', components: [locationSelectRow, characterSelectRow], ephemeral: true });
                    const collector = message.createMessageComponentCollector({ time: 35000 });
                    var locationSelected;
                    var characterSelected;
                    collector.on('collect', async (interaction_second) => {
                        if (interaction_second.values[0]) {
                            if (interaction_second.customId == 'LocationMovementSelector') {
                                locationSelected = interaction_second.values[0];
                            } else {
                                characterSelected = interaction_second.values[0];
                            }
                            if (locationSelected && characterSelected) {
                                await connection.promise().query('update characters set location_id = ? where id = ?', [interaction_second.values[0], interaction_second.values[1]]);
                                await message.edit({ content: 'Successfully moved character.', components: [] });
                            } else {
                                await interaction_second.deferUpdate();
                            }
                        } else {
                            await interaction_second.deferUpdate();
                        }
                    });
                    collector.on('end', async (collected) => {
                        console.log(collected);
                    });
                } else {
                    interaction.reply({ content: 'You haven\'t created any characters yet. Try creating a character first.', ephemeral: true });
                }
            } else {
                interaction.reply({ content: 'You haven\'t created any locations yet. Try creating a location first.', ephemeral: true });
            }
        }

        // TODO set CHARACTER LOCATION


        // PLAYER COMMANDS
        else if (isPlayer(interaction.user.id, interaction.guildId) || interaction.member.hasPermission("ADMINISTRATOR")) {
            if (interaction.commandName == 'move') {
                var is_enabled = await connection.promise().query('select ml.movement_allowed, ml.id from players join players_characters pc on players.id = pc.player_id join characters c on pc.character_id = c.id join movement_locations ml on ml.id = c.location_id where players.user_id = ? and players.guild_id = ? and pc.active = 1', [interaction.user.id, interaction.guildId]);
                if (is_enabled[0].length > 0) {
                    var locations = await connection.promise().query('select * from movement_locations where guild_id = ? and movement_allowed = 1 and id <> ?', [interaction.guildId, is_enabled[0][0].id])
                    if (locations[0].length > 0) {
                        var locationsKeyValues = [];
                        for (const location of locations[0]) {
                            var thisLocationKeyValue = { label: location.friendly_name, value: location.id };
                            locationsKeyValues.push(thisLocationKeyValue);
                        }
                        const locationSelectComponent = new StringSelectMenuBuilder().setOptions(locationsKeyValues).setCustomId('LocationMovementSelector' + interaction.member.id).setMinValues(1).setMaxValues(1);
                        var locationSelectRow = new ActionRowBuilder().addComponents(locationSelectComponent);
                        interaction.reply({ content: 'Select a location to move to:', components: [locationSelectRow], ephemeral: true });
                    } else {
                        interaction.reply({ content: 'Sorry, but I can\'t find any other locations for you to move to. Try again another time, or contact the Orchestrators. :purple_heart:', ephemeral: true });
                    }
                    // retrieve any other movement-enabled locations.
                    // Create a DROPDOWN to select movement.
                } else {
                    interaction.reply({ content: 'Sorry, but you don\'t seem to be in a location that allows movement right now. Try again another time, or contact the Orchestrators. :purple_heart:', ephemeral: true });
                }
            } else if (interaction.commandName == 'me') {
                var current_character = await connection.promise().query('select character_id from players_characters join players p on p.id = players_characters.player_id where p.user_id = ? and players_characters.active = 1', [interaction.user.id]);
                if (current_character[0].length > 0) {

                } else {
                    interaction.reply({ content: 'Somehow, you don\'t have an active character! If you\'re a player, this means something has gone HORRIBLY WRONG. Please let an Orchestrator know.', ephemeral: true });
                }
                // If number of characters for player is 1, return one sheet. Otherwise, return a dropdown (not relevant for this game, thank god! So this is a Future Improvement).
                // TODO: Separate command for administrators.

            } else if (interaction.commandName === 'rps') {
                if (interaction.options.getUser('challengee')) {
                    var challenged = interaction.options.getUser('challengee');
                    var queryData = [interaction.user.id, interaction.user.id, challenged.id, challenged.id];
                    connection.query('select * from rps where (challenger = ? or challenged = ? or challenger = ? or challenged = ?) and (challenger_throw is null or challenged_throw is null);', queryData, function (err, res, fields) {
                        if (err) {
                            console.log(err);
                        } else if (res.length > 0) {
                            interaction.reply({ content: 'Sorry, it looks like either you or your target is already in a duel!', ephemeral: true });
                        } else {
                            var queryData = [interaction.user.id, challenged.id, interaction.channel.id];
                            connection.query('insert into rps (challenger, challenged, channel) values (?, ?, ?)', queryData, async function (err2, res2, fields2) {
                                //Create buttons, tag both users.
                                var rpsButtonR = new ButtonBuilder().setCustomId('rpsButtonR').setLabel('Rapid').setStyle('Primary'); // TODO ButtonBuilder doesn't exist in Discord.js v14
                                var rpsButtonP = new ButtonBuilder().setCustomId('rpsButtonP').setLabel('Precision').setStyle('Primary');
                                var rpsButtonS = new ButtonBuilder().setCustomId('rpsButtonS').setLabel('Sweeping').setStyle('Primary');
                                const rpsRow = new ActionRowBuilder().addComponents(rpsButtonR, rpsButtonP, rpsButtonS);
                                await interaction.reply({ content: '<@' + interaction.user.id + '> has challenged <@' + challenged.id + '> to a duel!', components: [rpsRow] });
                            });
                        }
                    });
                    //also make sure they're on the same Age.
                } else {
                    var queryData = [interaction.user.id, interaction.user.id];
                    connection.query('select * from rps where (challenger = ? or challenged = ?) and (challenger_throw is null or challenged_throw is null)', queryData, function (err, res, fields) {
                        if (err) {
                            console.log(err);
                        } else if (res.length > 0) {
                            interaction.reply({ content: 'Sorry, it looks like you\'re already in a duel!', ephemeral: true });
                        } else {
                            var queryData = [interaction.user.id, client.user.id, interaction.channel.id];
                            connection.query('insert into rps (challenger, challenged, channel) values (?, ?, ?)', queryData, async function (err2, res2, fields2) {
                                var rpsButtonR = new ButtonBuilder().setCustomId('rpsButtonR').setLabel('Rapid').setStyle('Primary');
                                var rpsButtonP = new ButtonBuilder().setCustomId('rpsButtonP').setLabel('Precision').setStyle('Primary');
                                var rpsButtonS = new ButtonBuilder().setCustomId('rpsButtonS').setLabel('Sweeping').setStyle('Primary');
                                const rpsRow = new ActionRowBuilder().addComponents(rpsButtonR, rpsButtonP, rpsButtonS);
                                await interaction.reply({ content: 'You have challenged me to a duel!', components: [rpsRow], ephemeral: true });
                            });
                        }
                    });
                }
            }
        }
    }



    if (interaction.isButton()) {
        if (interaction.customId === 'rpsButtonR' || interaction.customId === 'rpsButtonP' || interaction.customId === 'rpsButtonS') {
            console.log(interaction);
            var rpsthrow = interaction.customId.slice(-1);
            var throwfull = '';
            switch (rpsthrow) {
                case 'R':
                    throwfull = 'Rapid';
                    break;
                case 'P':
                    throwfull = 'Precision';
                    break;
                case 'S':
                    throwfull = 'Sweeping';
                    break;
            }
            var queryData = [interaction.user.id, interaction.user.id];
            connection.query('select * from rps where (challenger = ? or challenged = ?) and (challenger_throw IS NULL OR challenged_throw IS NULL)', queryData, async function (err, res, fields) {
                if (err) {
                    console.log(err);
                } else if (res.length > 0 && (rpsthrow == "R" || rpsthrow == "P" || rpsthrow == "S")) {
                    var valid = 1;
                    if (res[0].challenged == interaction.user.id && !res[0].challenged_throw) {
                        var queryData = ['challenged_throw', rpsthrow, res[0].id, res[0].id];
                    } else if (res[0].challenger == interaction.user.id && !res[0].challenger_throw) {
                        var queryData = ['challenger_throw', rpsthrow, res[0].id, res[0].id];
                    } else {
                        if (interaction.replied) {
                            await interaction.followUp({ content: 'You\'ve already thrown, sorry!`.', ephemeral: true });
                        } else {
                            await interaction.reply({ content: 'You\'ve already thrown, sorry!`.', ephemeral: true });
                        }
                        valid = 0;
                    }
                    if (valid) {
                        connection.query('update rps set ?? = ? where id = ?; select * from rps where id = ?', queryData, async function (err2, res2, fields2) {
                            if (err2) {
                                console.log(err2);
                            } else {
                                if (res2[1][0].challenged_throw && res2[1][0].challenger_throw) {
                                    if (interaction.replied) {
                                        await interaction.followUp({ content: 'You threw ' + throwfull + '.', ephemeral: true });
                                    } else {
                                        await interaction.reply({ content: 'You threw ' + throwfull + '.', ephemeral: true });
                                    }
                                    if ((res2[1][0].challenged_throw == 'R' && res2[1][0].challenger_throw == 'P') || (res2[1][0].challenged_throw == 'P' && res2[1][0].challenger_throw == 'S') || (res2[1][0].challenged_throw == 'S' && res2[1][0].challenger_throw == 'R')) {
                                        await interaction.followUp('<@' + res2[1][0].challenger + '> has won the RPS match! (' + res2[1][0].challenger_throw + ' > ' + res2[1][0].challenged_throw + ')');
                                    } else if ((res2[1][0].challenger_throw == 'R' && res2[1][0].challenged_throw == 'P') || (res2[1][0].challenger_throw == 'P' && res2[1][0].challenged_throw == 'S') || (res2[1][0].challenger_throw == 'S' && res2[1][0].challenged_throw == 'R')) {
                                        await interaction.followUp('<@' + res2[1][0].challenged + '> has won the RPS match! (' + res2[1][0].challenged_throw + ' > ' + res2[1][0].challenger_throw + ')');
                                    } else {
                                        await interaction.followUp('The RPS round between <@' + res2[1][0].challenger + '> and <@' + res2[1][0].challenged + '> has ended in a draw.');
                                    }
                                    await interaction.message.edit({ content: '<@' + res2[1][0].challenger + '> has challenged <@' + res2[1][0].challenged + '> to a duel!', components: [] });
                                } else if (res2[1][0].challenged == client.user.id) {
                                    await interaction.reply({ content: 'You threw ' + throwfull + '.', ephemeral: true });
                                    var options = ['R', 'P', 'S'];
                                    var selection = options[Math.floor(Math.random() * options.length)];
                                    var queryData = [selection, res[0].id];
                                    connection.query('update rps set challenged_throw = ? where id = ?;', queryData, async function (err3, res3, fields3) {
                                        if ((selection == 'R' && res2[1][0].challenger_throw == 'P') || (selection == 'P' && res2[1][0].challenger_throw == 'S') || (selection == 'S' && res2[1][0].challenger_throw == 'R')) {
                                            await interaction.followUp('<@' + res2[1][0].challenger + '> has won the RPS match! (' + res2[1][0].challenger_throw + ' > ' + selection + ')');
                                        } else if ((res2[1][0].challenger_throw == 'R' && selection == 'P') || (res2[1][0].challenger_throw == 'P' && selection == 'S') || (res2[1][0].challenger_throw == 'S' && selection == 'R')) {
                                            await interaction.followUp('<@' + res2[1][0].challenged + '> has won the RPS match! (' + selection + ' > ' + res2[1][0].challenger_throw + ')');
                                        } else {
                                            await interaction.followUp('The RPS round between <@' + res2[1][0].challenger + '> and <@' + res2[1][0].challenged + '> has ended in a draw.');
                                        }
                                    });
                                    await interaction.message.edit({ content: '<@' + res2[1][0].challenger + '> has challenged <@' + res2[1][0].challenged + '> to a duel!', components: [] });
                                } else {
                                    if (interaction.replied) {
                                        await interaction.followUp({ content: 'You threw ' + throwfull + '.', ephemeral: true });
                                    } else {
                                        await interaction.reply({ content: 'You threw ' + throwfull + '.', ephemeral: true });
                                    }
                                }
                            }
                        });
                    }
                }
            });
        }
    }

    if (interaction.isSelectMenu()) {
        if (interaction.customId === 'LocationMovementSelector' + interaction.member.id) {
            var dest_id = interaction.values[0]
            var locations = await connection.promise().query('select ml.*, c.name as character_name from players p join players_characters pc on p.id = pc.player_id join characters c on pc.character_id = c.id join movement_locations ml on c.location_id = ml.id where ((p.user_id = ? and pc.active = 1) or c.location_id = ?) and ml.movement_allowed = 1 and ml.guild_id = ?', [interaction.user.id, dest_id, interaction.guild_id]);
            if (locations[0].length == 2) {
                await interaction.message.edit({ content: 'Location selected for movement!', components: [] });
                // Source and dest are both valid.
                var new_announcements;
                var new_name;
                var old_announcements;
                var old_name;
                var character_name = locations[0][0].character_name;
                for (const location of locations[0]) {
                    var channel = await client.channels.cache.get(location.channel_id);
                    if (location.id == dest_id) {
                        await channel.permissionOverwrites.edit(interaction.member, { VIEW_CHANNEL: true, SEND_MESSAGES: true });
                        if (location.announcements_id) {
                            new_announcements = await client.channels.cache.get(location.announcements_id);
                            new_name = location.friendly_name;
                        }
                    } else {
                        if (location.global_read == 0) {
                            await channel.permissionOverwrites.edit(interaction.member, { VIEW_CHANNEL: false });
                        }
                        await channel.permissionOverwrites.edit(interaction.member, { SEND_MESSAGES: false });
                        if (location.announcements_id) {
                            old_announcements = await client.channels.cache.get(location.announcements_id);
                            old_name = location.friendly_name;
                        }
                    }
                }
                if (old_announcements) {
                    await old_announcements.send('*' + character_name + ' moves to ' + new_name + '.*');
                }
                if (new_announcements) {
                    await new_announcements.send('*' + character_name + ' arrives from ' + old_name + '.*');
                }
            } else {
                interaction.message.edit({ content: 'Sorry, either your current location or your destination was locked for traveling between the time you started your move and the time you submitted it. Please contact an Orchestrator. :purple_heart:', components: [] });

            }// Validate that the movement stuff is still valid and hasn't been locked in the meantime.
            // Process the move! Run permissions where appropriate.

            // For location of locations
            // if location.id != player.location_id
            // if location.global_read = 0
            // remove post permission
            // else
            // add read permission, add post permission
        }
    }
});