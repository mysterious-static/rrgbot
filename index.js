/*jslint es6*/
const Discord = require('discord.js');
const { Permissions, ActionRowBuilder, ButtonBuilder, TextInputComponent, StringSelectMenuBuilder, TextInputStyle, Modal, PermissionFlagsBits, GatewayIntentBits, SlashCommandBuilder, ButtonStyle } = require('discord.js')
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

var locationvisibility = new SlashCommandBuilder().setName('locationvisibility')
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
            .setRequired(true))
    .addStringOption(option =>
        option.setName('player_name')
            .setDescription('The player name.')
            .setRequired(true))
    .addBooleanOption(option =>
        option.setName('create_character')
            .setDescription('Create a character? If false, be sure to assign this player a character using /assigncharacter.')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);


var charactercreate = new SlashCommandBuilder().setName('charactercreate')
    .setDescription('Create a new character.')
    .addStringOption(option =>
        option.setName('name')
            .setDescription('The character name.')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('description')
            .setDescription('The character description.')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

var assigncharacter = new SlashCommandBuilder().setName('assigncharacter')
    .setDescription('Assign a character or characters to a player.')
    .addUserOption(option =>
        option.setName('user')
            .setDescription('The user with an active player entry.')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

var characterlocation = new SlashCommandBuilder().setName('characterlocation')
    .setDescription('Move a character to a specific location.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

var addcharacterarchetype = new SlashCommandBuilder().setName('addcharacterarchetype')
    .setDescription('Add a character-assignable archetype (think "class"). Characters can have multiple archetypes.')
    .addStringOption(option =>
        option.setName('archetype')
            .setDescription('The name of the archetype')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('description')
            .setDescription('The archetype description.')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

var assignarchetype = new SlashCommandBuilder().setName('assignarchetype')
    .setDescription('Assign an archetype to a character or characters.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator); // Dropdowns.

var addstat = new SlashCommandBuilder().setName('addstat')
    .setDescription('Add a stat for all characters for view in character sheet.')
    .addStringOption(option =>
        option.setName('stat')
            .setDescription('The name of the stat (e.g., Strength, Intelligence, HP)')
            .setRequired(true))
    .addIntegerOption(option =>
        option.setName('defaultvalue')
            .setDescription('The default value of the stat')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

var addarchetypestat = new SlashCommandBuilder().setName('addarchetypestat')
    .setDescription('Add an archetype-specific stat for view in character sheet.')
    .addStringOption(option =>
        option.setName('stat')
            .setDescription('The name of the stat (e.g., Performance, Studiousness, MP)')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('description')
            .setDescription('What this stat means or does.')
            .setRequired(true))
    .addIntegerOption(option =>
        option.setName('defaultvalue')
            .setDescription('The default value of the stat.')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator); // Will give you a dropdown to select the archetype or archetypes to assign to.

var addskill = new SlashCommandBuilder().setName('addskill')
    .setDescription('Add a character/archetype-assignable skill for view in character sheet.')
    .addStringOption(option =>
        option.setName('name')
            .setDescription('The name of the skill (e.g. Vorpal Slash, 1000 Needles, Gigaton Hammer)')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('description')
            .setDescription('The description or flavor text of the skill.')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

var additem = new SlashCommandBuilder().setName('additem')
    .setDescription('Add an item for display on character sheet. Items can be assigned to one character.')
    .addStringOption(option =>
        option.setName('itemname')
            .setDescription('The name of the item')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('description')
            .setDescription('What this item is.')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

var addworldstat = new SlashCommandBuilder().setName('addworldstat')
    .setDescription('Add a world stat for view in character sheet. World stats visibility can be assigned.')
    .addStringOption(option =>
        option.setName('name')
            .setDescription('The name of the stat')
            .setRequired(true))
    .addIntegerOption(option =>
        option.setName('value')
            .setDescription('The value of the stat')
            .setRequired(true))
    .addStringOption(option =>
        option.setName('description')
            .setDescription('What this stat means or does.')
            .setRequired(true))
    .addBooleanOption(option =>
        option.setName('globallyvisible')
            .setDescription('Whether this is globally visible or needs to be targeted.')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

var setstat = new SlashCommandBuilder().setName('setstat')
    .setDescription('Set a stat for a character.')
    .addIntegerOption(option =>
        option.setName('value')
            .setDescription('The value to which the stat will be set.')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

var setarchetypestat = new SlashCommandBuilder().setName('setarchetypestat')
    .setDescription('Set an archetype stat for a character.')
    .addIntegerOption(option =>
        option.setName('value')
            .setDescription('The value to which the archetype stat will be set.')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

var assignskill = new SlashCommandBuilder().setName('assignskill')
    .setDescription('Assign a skill to a character or archetype')
    .addBooleanOption(option =>
        option.setName('to_character')
            .setDescription('Set to true if you\'re assigning to a character, false if assigning to an archetype.')
            .setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

var assignitem = new SlashCommandBuilder().setName('assignitem')
    .setDescription('Assign a skill to a character or archetype')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

// TODO: Items will be REWORKED ENTIRELY later, with a fully-functional system where instances of items can be created versus having all items unique.

var modsheet = new SlashCommandBuilder().setName('modsheet')
    .setDescription('Show a character sheet.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

var addquest = new SlashCommandBuilder().setName('addquest')
    .setDescription('NYI: Add a quest for display on character sheet.');

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

var sheet = new SlashCommandBuilder().setName('sheet')
    .setDescription('Show your character sheet.');

var skill = new SlashCommandBuilder().setName('skill')
    .setDescription('Posts a skill in the current chat channel.');

var item = new SlashCommandBuilder().setName('item')
    .setDescription('Posts an item in the current chat channel.');

var give = new SlashCommandBuilder().setName('give')
    .setDescription('Gives an item to another character in your location.');



//PRE-PROCESSING FUNCTIONS

async function isPlayer(userid, guildid) {
    var player_exists = await connection.promise().query('select * from players where user_id = ?', [userid, guildid]);
    if (player_exists[0].length > 0) {
        return true;
    }
    return false;
}



client.on('ready', async () => {
    await client.application.commands.set([
        allowmovement.toJSON(),
        locationannouncements.toJSON(),
        addlocation.toJSON(),
        locationvisibility.toJSON(),
        resetlocationvis.toJSON(),
        playercreate.toJSON(),
        characterlocation.toJSON(),
        rps.toJSON(),
        move.toJSON(),
        sheet.toJSON(),
        assigncharacter.toJSON(),
        charactercreate.toJSON(),
        addcharacterarchetype.toJSON(),
        assignarchetype.toJSON(),
        addstat.toJSON(),
        addarchetypestat.toJSON(),
        addskill.toJSON(),
        additem.toJSON(),
        addworldstat.toJSON(),
        setstat.toJSON(),
        setarchetypestat.toJSON(),
        assignskill.toJSON(),
        skill.toJSON(),
        assignitem.toJSON(),
        item.toJSON(),
        modsheet.toJSON()
    ]);
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
        } else if (interaction.commandName == 'locationvisibility') {
            var thisChannel = await interaction.options.getChannel('location');
            console.log(thisChannel);
            var channelexists = await connection.promise().query('select * from movement_locations where guild_id = ? and channel_id = ?', [interaction.guildId, thisChannel.id]);
            if (channelexists[0].length > 0) {
                var enabled = interaction.options.getBoolean('enabled');
                await connection.promise().query('update movement_locations set global_read = ? where channel_id = ?', [thisChannel.id, enabled]);
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
                if (interaction.options.getBoolean('create_character')) {
                    var inserted_character = await connection.promise().query('insert into characters (name, guild_id) values (?, ?)', [playerName, interaction.guildId]); // This table also has "location", because all characters are in a location.
                    await connection.promise().query('insert into players_characters (player_id, character_id, active) values (?, ?, ?)', [inserted_player[0].insertId, inserted_character[0].insertId, 1]); // Futureproofing for "multiple players can own a character".
                    interaction.reply({ content: 'Added the player and character!', ephemeral: true });
                } else {
                    interaction.reply({ content: 'Added the player!', ephemeral: true });
                }


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
                                var character = await connection.promise().query('select * from characters where id = ?', [characterSelected]);
                                var locations = await connection.promise().query('select * from movement_locations where id in (?, ?)', [character[0][0].location_id, locationSelected]);
                                await connection.promise().query('update characters set location_id = ? where id = ?', [locationSelected, characterSelected]);
                                var new_announcements;
                                var new_name;
                                var old_announcements;
                                var old_name;
                                var character_name = character[0][0].name;
                                console.log(locations[0]);
                                for (const location of locations[0]) {
                                    console.log(location.id);
                                    var channel = await client.channels.cache.get(location.channel_id);
                                    if (location.id == locationSelected) {
                                        console.log('match')
                                        console.log(location);
                                        await channel.permissionOverwrites.edit(interaction.member, { ViewChannel: true, SendMessages: true });
                                        if (location.announcements_channel) {
                                            new_announcements = await client.channels.cache.get(location.announcements_channel);
                                            new_name = location.friendly_name;
                                        }
                                    } else {
                                        if (location.global_read == 0) {
                                            await channel.permissionOverwrites.edit(interaction.member, { ViewChannel: false });
                                        }
                                        await channel.permissionOverwrites.edit(interaction.member, { SendMessages: false });
                                        if (location.announcements_channel) {
                                            old_announcements = await client.channels.cache.get(location.announcements_channel);
                                            old_name = location.friendly_name;
                                        }
                                    }
                                }
                                if (old_announcements) {
                                    await old_announcements.send('*' + character_name + ' moves to ' + new_name + '.*');
                                }
                                if (new_announcements && old_name) {
                                    await new_announcements.send('*' + character_name + ' arrives from ' + old_name + '.*');
                                }
                                await interaction_second.update({ content: 'Successfully moved character.', components: [] });
                                await collector.stop();
                            } else {
                                await interaction_second.deferUpdate();
                            }
                        } else {
                            await interaction_second.deferUpdate();
                        }
                    });
                    collector.on('end', async (collected) => {
                        // How do we clean the message up?
                    });
                } else {
                    interaction.reply({ content: 'You haven\'t created any characters yet. Try creating a character first.', ephemeral: true });
                }
            } else {
                interaction.reply({ content: 'You haven\'t created any locations yet. Try creating a location first.', ephemeral: true });
            }
        } else if (interaction.commandName == 'charactercreate') {
            var characterName = interaction.options.getString('name');
            var description = interaction.options.getString('description');
            var character = await connection.promise().query('select * from characters where name = ? and guild_id = ?', [characterName, interaction.guildId]);
            if (character[0].length == 0) {
                var inserted_character = await connection.promise().query('insert into characters (name, guild_id, description) values (?, ?, ?)', [characterName, interaction.guildId, description]);
                interaction.reply({ content: 'Created character!', ephemeral: true })
            } else {
                interaction.reply({ content: 'A character with this name for this game already exists.', ephemeral: true });
            }
        } else if (interaction.commandName == 'assigncharacter') {
            var user = interaction.options.getUser('user');
            var player = await connection.promise().query('select * from players where user_id = ?', [user.id]);
            if (player[0].length > 0) {
                console.log(interaction.guildId);
                var owned_characters = await connection.promise().query('select distinct c.id from characters c join players_characters pc on c.id = pc.character_id join players p on pc.player_id = p.id where c.guild_id = ? and p.user_id = ?', [interaction.guildId, user.id]);
                var owned = [];
                if (owned_characters[0].length > 0) {
                    for (const thisCharacter of owned_characters[0]) {
                        owned.push(thisCharacter.id);
                    }
                    var characters = await connection.promise().query('select * from characters where guild_id = ? and id not in (?)', [interaction.guildId, owned]);
                } else {
                    var characters = await connection.promise().query('select * from characters where guild_id = ?', [interaction.guildId]);
                }
                console.log(characters);
                if (characters[0].length > 0) {
                    var charactersKeyValues = [];
                    for (const character of characters[0]) {
                        charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                    }
                }
                const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('CharacterAssignmentSelector').setMinValues(1).setMaxValues(characters[0].length);
                var characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                var message = await interaction.reply({ content: 'Select a character or characters to assign to this player:', components: [characterSelectRow], ephemeral: true });
                const collector = message.createMessageComponentCollector({ time: 35000 });
                collector.on('collect', async (interaction_second) => {
                    console.log(interaction_second.values); // Is this an array of all selected or is it an array of arrays
                    for (const thisId of interaction_second.values) {
                        await connection.promise().query('insert into players_characters (player_id, character_id, active) values (?, ?, ?)', [player[0][0].id, thisId, 0]);
                    }
                    interaction_second.update({ content: 'Successfully updated character-player relationships.', components: [] });
                });
            } else {
                await interaction.reply({ content: 'The user that you selected isn\'t a valid player.', ephemeral: true });
            }
        } else if (interaction.commandName == 'addcharacterarchetype') {
            var archetype = interaction.options.getString('archetype');
            var description = interaction.options.getString('description');
            var archetypeExists = await connection.promise().query('select * from archetypes where guild_id = ? and name = ?', [interaction.guildId, archetype]);
            if (archetypeExists[0].length == 0) {
                await connection.promise().query('insert into archetypes (name, guild_id, description) values (?, ?, ?)', [archetype, interaction.guildId, description]);
                interaction.reply({ content: 'Archetype added!', ephemeral: true });
            } else {
                interaction.reply({ content: 'Archetype already exists for this game.', ephemeral: true });
            }
        } else if (interaction.commandName == 'assignarchetype') {
            var archetypes = await connection.promise().query('select * from archetypes where guild_id = ?', [interaction.guildId]);
            if (archetypes[0].length > 0) {
                var archetypesKeyValues = [];
                for (const archetype of archetypes[0]) {
                    archetypesKeyValues.push({ label: archetype.name, value: archetype.id.toString() });
                }
                const archetypeSelectComponent = new StringSelectMenuBuilder().setOptions(archetypesKeyValues).setCustomId('ArchetypeAssignmentSelector').setMinValues(1).setMaxValues(1);
                var archetypeSelectRow = new ActionRowBuilder().addComponents(archetypeSelectComponent);
                var message = await interaction.reply({ content: 'Select an archetype to manage assignments:', components: [archetypeSelectRow], ephemeral: true });
                var collector = message.createMessageComponentCollector({ time: 35000 });
                var selectedArchetype;
                collector.on('collect', async (interaction_second) => {
                    if (interaction_second.customId == 'ArchetypeAssignmentSelector') {
                        selectedArchetype = interaction_second.values[0];
                        var characters = await connection.promise().query('select distinct characters.* from characters left outer join characters_archetypes ca on characters.id = ca.character_id where guild_id = ? and (ca.archetype_id <> ? or ca.archetype_id is null)', [interaction.guildId, selectedArchetype]);
                        if (characters[0].length > 0) {
                            console.log(characters[0]);
                            var charactersKeyValues = [];
                            for (const character of characters[0]) {
                                charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                            }
                            const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('CharacterAssignmentSelector').setMinValues(1).setMaxValues(characters[0].length);
                            var characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                            await interaction_second.update({ content: 'Select a character or characters to assign to this archetype:', components: [characterSelectRow] });
                        } else {
                            await interaction_second.update({ content: 'No characters are valid to assign to this archetype.', components: [] });
                            await collector.stop();
                        }
                    } else if (interaction_second.customId == 'CharacterAssignmentSelector') {
                        for (const thisId of interaction_second.values) {
                            await connection.promise().query('insert into characters_archetypes (character_id, archetype_id) values (?, ?)', [thisId, selectedArchetype]);
                        }
                        await interaction_second.update({ content: 'Successfully assigned characters to archetype.', components: [] });
                        await collector.stop();
                    }
                })


            } else {
                interaction.reply({ content: 'No archetype exists.', ephemeral: true })
            }
        } else if (interaction.commandName == 'addstat') {
            var name = interaction.options.getString('stat')
            var defaultValue = interaction.options.getInteger('defaultvalue');
            var exists = await connection.promise().query('select * from stats where guild_id = ? and name = ?', [interaction.guildId, name]);
            if (exists[0].length == 0) {
                await connection.promise().query('insert into stats (name, default_value, guild_id) values (?, ?, ?)', [name, defaultValue, interaction.guildId]);
                interaction.reply({ content: 'Stat added!', ephemeral: true });
            } else {
                interaction.reply({ content: 'Stat with this name already exists!', ephemeral: true });
            }
        } else if (interaction.commandName == 'addarchetypestat') {
            // stat, description, defaultvalue
            var name = interaction.options.getString('stat');
            var description = interaction.options.getString('description');
            var defaultValue = interaction.options.getInteger('defaultvalue');
            var exists = await connection.promise().query('select * from archetypestats where guild_id = ? and name = ?', [interaction.guildId, name]);
            if (exists[0].length == 0) {
                var archetypes = await connection.promise().query('select * from archetypes where guild_id = ?', [interaction.guildId]);
                if (archetypes[0].length > 0) {
                    var addedStat = await connection.promise().query('insert into archetypestats (name, description, default_value, guild_id) values (?, ?, ?, ?)', [name, description, defaultValue, interaction.guildId]);
                    var archetypesKeyValues = [];
                    for (const archetype of archetypes[0]) {
                        archetypesKeyValues.push({ label: archetype.name, value: archetype.id.toString() });
                    }
                    const archetypeSelectComponent = new StringSelectMenuBuilder().setOptions(archetypesKeyValues).setCustomId('ArchetypeAssignmentSelector').setMinValues(1).setMaxValues(archetypes[0].length);
                    var archetypeSelectRow = new ActionRowBuilder().addComponents(archetypeSelectComponent);
                    var message = await interaction.reply({ content: 'Archetype stat added! Select archetype(s):', components: [archetypeSelectRow], ephemeral: true });
                    var collector = message.createMessageComponentCollector({ time: 35000 });
                    collector.on('collect', async (interaction_second) => {
                        if (interaction_second.customId == 'ArchetypeAssignmentSelector') {
                            for (const thisArchetype of interaction_second.values) {
                                await connection.promise().query('insert into archetypes_archetypestats (archetype_id, archetypestat_id) values (?, ?)', [thisArchetype, addedStat[0].insertId]);
                            }
                            await interaction_second.update({ content: 'Successfully assigned stat to archetype(s).', components: [] });
                        }
                    });
                } else {
                    interaction.reply({ content: 'No archetypes exist! Please create an archetype first.', ephemeral: true });
                }
            } else {
                interaction.reply({ content: 'Stat with this name already exists!', ephemeral: true });
            }
        } else if (interaction.commandName == 'addskill') {
            var name = interaction.options.getString('name')
            var description = interaction.options.getString('description');
            var exists = await connection.promise().query('select * from skills where guild_id = ? and name = ?', [interaction.guildId, name]);
            if (exists[0].length == 0) {
                await connection.promise().query('insert into skills (name, description, guild_id) values (?, ?, ?)', [name, description, interaction.guildId]);
                interaction.reply({ content: 'Skill added!', ephemeral: true });
            } else {
                interaction.reply({ content: 'Skill with this name already exists!', ephemeral: true });
            }
        } else if (interaction.commandName == 'additem') {
            var name = interaction.options.getString('itemname')
            var description = interaction.options.getString('description');
            // var exists = await connection.promise().query('select * from items where guild_id = ? and name = ?', [interaction.guildId, name]);
            // if (exists[0].length == 0) {
            await connection.promise().query('insert into items (name, description, guild_id) values (?, ?, ?)', [name, description, interaction.guildId]);
            interaction.reply({ content: 'Item added!', ephemeral: true });
            // } else {
            // interaction.reply({ content: 'Skill with this name already exists!', ephemeral: true });
            // }
        } else if (interaction.commandName == 'addworldstat') {
            var name = interaction.options.getString('name');
            var description = interaction.options.getString('description');
            var globallyvisible = interaction.options.getBoolean('globally_visible');
            var value = interaction.options.getInteger('value')
            var exists = await connection.promise().query('select * from worldstats where guild_id = ? and name = ?', [interaction.guildId, name]);
            if (exists[0].length == 0) {
                await connection.promise().query('insert into worldstats (name, description, globally_visible, value, guild_id) values (?, ?, ?, ?, ?)', [name, description, globallyvisible, value, interaction.guildId]);
                interaction.reply({ content: 'World stat added!', ephemeral: true });
            } else {
                interaction.reply({ content: 'Skill with this name already exists!', ephemeral: true });
            }
        } else if (interaction.commandName == 'setstat') {
            var value = interaction.options.getInteger('value');
            // Create two dropdowns. For character and stat. See characterlocation for details.
            var stats = await connection.promise().query('select * from stats where guild_id = ?', [interaction.guildId]);
            if (stats[0].length > 0) {
                var statsKeyValues = [{ label: 'Select a stat', value: '0' }];
                for (const stat of stats[0]) {
                    var thisStatKeyValue = { label: stat.name, value: stat.id.toString() };
                    statsKeyValues.push(thisStatKeyValue);
                }
                const statSelectComponent = new StringSelectMenuBuilder().setOptions(statsKeyValues).setCustomId('StatAssignmentStatSelector').setMinValues(1).setMaxValues(1);
                var statSelectRow = new ActionRowBuilder().addComponents(statSelectComponent);
                var characters = await connection.promise().query('select * from characters where guild_id = ?', [interaction.guildId]);
                if (characters[0].length > 0) {
                    var charactersKeyValues = [{ label: 'Select a character', value: '0' }];
                    for (const character of characters[0]) {
                        var thisCharacterKeyValue = { label: character.name, value: character.id.toString() };
                        charactersKeyValues.push(thisCharacterKeyValue);
                    }
                    const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('StatAssignmentCharacterSelector').setMinValues(1).setMaxValues(1);
                    var characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                    var message = await interaction.reply({ content: '', components: [statSelectRow, characterSelectRow], ephemeral: true });
                    const collector = message.createMessageComponentCollector({ time: 35000 });
                    var statSelected;
                    var characterSelected;
                    collector.on('collect', async (interaction_second) => {
                        if (interaction_second.values[0]) {
                            if (interaction_second.customId == 'StatAssignmentStatSelector') {
                                statSelected = interaction_second.values[0];
                            } else {
                                characterSelected = interaction_second.values[0];
                            }
                            if (statSelected && characterSelected) {
                                var exists = connection.promise().query('select * from characters_stats where stat_id = ? and character_id = ?', [statSelected, characterSelected]);
                                if (exists[0].length > 0) {
                                    await connection.promise().query('update characters_stats set stat_id = ? where character_id = ?', [statSelected, characterSelected]);
                                } else {
                                    await connection.promise().query('insert into characters_stats (character_id, stat_id, override_value) values (?, ?, ?)', [characterSelected, statSelected, value]);
                                }
                                await interaction.update({ content: 'Successfully updated character stat value.', components: [] });
                                await collector.stop();
                            } else {
                                await interaction_second.deferUpdate();
                            }
                        } else {
                            await interaction_second.deferUpdate();
                        }
                    });
                    collector.on('end', async (collected) => {
                        console.log(collected);
                        // How do we clean the message up?
                    });
                } else {
                    interaction.reply({ content: 'You haven\'t created any stats yet. Try creating a stat first.', ephemeral: true });
                }
            } else {
                interaction.reply({ content: 'You haven\'t created any characters yet. Try creating a character first.', ephemeral: true });
            }
        } else if (interaction.commandName == 'setarchetypestat') {
            var value = interaction.options.getInteger('value');
            // Create two dropdowns. For character and stat. See characterlocation for details.
            var stats = await connection.promise().query('select * from archetypestats where guild_id = ?', [interaction.guildId]);
            if (stats[0].length > 0) {
                var statsKeyValues = [{ label: 'Select a stat', value: '0' }];
                for (const stat of stats[0]) {
                    var thisStatKeyValue = { label: stat.name, value: stat.id.toString() };
                    statsKeyValues.push(thisStatKeyValue);
                }
                const statSelectComponent = new StringSelectMenuBuilder().setOptions(statsKeyValues).setCustomId('ArchetypeStatAssignmentStatSelector').setMinValues(1).setMaxValues(1);
                var statSelectRow = new ActionRowBuilder().addComponents(statSelectComponent);

                var message = await interaction.reply({ content: '', components: [statSelectRow], ephemeral: true });
                const collector = message.createMessageComponentCollector({ time: 35000 });
                var archetypeStatSelected;
                var characterSelected;
                collector.on('collect', async (interaction_second) => {
                    if (interaction_second.values[0]) {
                        if (interaction_second.customId == 'ArchetypeStatAssignmentStatSelector') {
                            archetypeStatSelected = interaction_second.values[0];
                            var archetype = await connection.promise().query('select archetype_id from archetypes_archetypestats where archetypestat_id = ?', [archetypeStatSelected]);
                            var characters = await connection.promise().query('select c.* from characters c join characters_archetypes ca on c.id = ca.character_id where guild_id = ? and ca.archetype_id = ?', [interaction.guildId, archetype[0][0].archetype_id]);
                            if (characters[0].length > 0) {
                                var charactersKeyValues = [{ label: 'Select a character', value: '0' }];
                                for (const character of characters[0]) {
                                    var thisCharacterKeyValue = { label: character.name, value: character.id.toString() };
                                    charactersKeyValues.push(thisCharacterKeyValue);
                                }
                                const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('ArchetypeStatAssignmentCharacterSelector').setMinValues(1).setMaxValues(1);
                                var characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                                await interaction_second.update({ content: 'Select a character, please.', components: [characterSelectRow] }); //interaction_second.editReply()
                            } else {
                                await interaction_second.update({ content: 'Couldn\'t find any valid characters for this archetype stat.', components: [] });
                                await collector.stop();
                            }
                        } else {
                            characterSelected = interaction_second.values[0];
                        }
                        if (archetypeStatSelected && characterSelected) {
                            var exists = await connection.promise().query('select * from characters_archetypestats where stat_id = ? and character_id = ?', [archetypeStatSelected, characterSelected]);
                            if (exists[0].length > 0) {
                                await connection.promise().query('update characters_archetypestats set stat_id = ? where character_id = ?', [archetypeStatSelected, characterSelected]);
                            } else {
                                await connection.promise().query('insert into characters_archetypestats (character_id, stat_id, override_value) values (?, ?, ?)', [characterSelected, archetypeStatSelected, value]);
                            }
                            await interaction_second.update({ content: 'Successfully updated character archetype stat value.', components: [] });
                            await collector.stop();
                        } else if (!archetypeStatSelected) {
                            await interaction_second.deferUpdate();
                        }
                    } else {
                        await interaction_second.deferUpdate();
                    }
                });
                collector.on('end', async (collected) => {
                    console.log(collected);
                    // How do we clean the message up?
                });
            } else {
                interaction.reply({ content: 'You haven\'t created any characters yet. Try creating a character first.', ephemeral: true });
            }
        } else if (interaction.commandName == 'assignskill') {
            var to_character = interaction.options.getBoolean('to_character');
            var skills = await connection.promise().query('select * from skills where guild_id = ?', [interaction.guildId]);
            var skillsAlphabetical;
            var skillSelectComponent;
            if (skills[0].length > 0) {
                if (skills[0].length <= 25) {
                    skillsAlphabetical = false;
                    var skillsKeyValues = [{ label: 'Select a skill', value: '0' }];
                    for (const skill of skills[0]) {
                        var thisSkillKeyValue = { label: skill.name, value: skill.id.toString() };
                        skillsKeyValues.push(thisSkillKeyValue);
                    }
                    skillSelectComponent = new StringSelectMenuBuilder().setOptions(skillsKeyValues).setCustomId('SkillAssignmentSkillSelector').setMinValues(1).setMaxValues(1);
                } else {
                    skillsAlphabetical = true;
                    var skills = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                    var skillsKeyValues = [];
                    for (const skill of skills) {
                        var thisSkillKeyValue = { label: skill, value: skill }
                        skillsKeyValues.push(thisSkillKeyValue);
                    }
                    skillSelectComponent = new StringSelectMenuBuilder().setOptions(skillsKeyValues).setCustomId('SkillAssignmentAlphabetSelector').setMinValues(1).setMaxValues(1);
                }
                var skillSelectRow = new ActionRowBuilder().addComponents(skillSelectComponent);
                if (to_character) {
                    var characters = await connection.promise().query('select * from characters where guild_id = ?', [interaction.guildId]);
                    if (characters[0].length > 0) {
                        var charactersKeyValues = [{ label: 'Select a character', value: '0' }];
                        for (const character of characters[0]) {
                            var thisCharacterKeyValue = { label: character.name, value: character.id.toString() };
                            charactersKeyValues.push(thisCharacterKeyValue);
                        }
                        const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('SkillAssignmentCharacterSelector').setMinValues(1).setMaxValues(charactersKeyValues.length);
                        var characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                    }
                } else {
                    var archetypes = await connection.promise().query('select * from archetypes where guild_id = ?', [interaction.guildId]);
                    if (archetypes[0].length > 0) {
                        var archetypesKeyValues = [{ label: 'Select a archetype', value: '0' }];
                        for (const archetype of archetypes[0]) {
                            var thisArchetypeKeyValue = { label: archetype.name, value: archetype.id.toString() };
                            archetypesKeyValues.push(thisArchetypeKeyValue);
                        }
                        const archetypeSelectComponent = new StringSelectMenuBuilder().setOptions(archetypesKeyValues).setCustomId('SkillAssignmentArchetypeSelector').setMinValues(1).setMaxValues(archetypesKeyValues.length);
                        var archetypeSelectRow = new ActionRowBuilder().addComponents(archetypeSelectComponent);
                    }
                }
                if ((to_character && characters[0].length > 0) || (!to_character && archetypes[0].length > 0)) {
                    if (to_character) {
                        var message = await interaction.reply({ content: 'Please select the following options:', components: [skillSelectRow, characterSelectRow], ephemeral: true });
                    } else {
                        var message = await interaction.reply({ content: 'Please select the following options:', components: [skillSelectRow, archetypeSelectRow], ephemeral: true });
                    }
                    var collector = message.createMessageComponentCollector();
                    var charactersSelected;
                    var archetypesSelected;
                    var skillSelected;
                    collector.on('collect', async (interaction_second) => {
                        console.log('Collected!');
                        console.log(interaction_second.customId);
                        console.log(interaction_second.values);
                        if (interaction_second.values[0]) {
                            if (interaction_second.customId == 'SkillAssignmentSkillSelector') {
                                skillSelected = interaction_second.values[0];
                            } else if (interaction_second.customId == 'SkillAssignmentAlphabetSelector') {
                                alphabetSelected = interaction_second.values[0];
                            } else if (interaction_second.customId == 'SkillAssignmentCharacterSelector') {
                                charactersSelected = interaction_second.values;
                            } else {
                                archetypesSelected = interaction_second.values;
                            }
                            if (alphabetSelected && !skillSelected) {
                                if (alphabetSelected.length == 1) {
                                    var skills = await connection.promise().query('select * from skills where guild_id = ? and name like ?', [interaction_second.guildId, alphabetSelected + '%']);
                                } else {
                                    // hmm something is wrong, bail out
                                }
                                var skillsKeyValues = [{ label: 'Select a skill', value: '0' }];
                                for (const skill of skills[0]) {
                                    var thisSkillKeyValue = { label: skill.name, value: skill.id.toString() };
                                    skillsKeyValues.push(thisSkillKeyValue);
                                }
                                var skillSelectComponent = new StringSelectMenuBuilder().setOptions(skillsKeyValues).setCustomId('SkillAssignmentSkillSelector').setMinValues(1).setMaxValues(1);
                                var skillSelectRow = new ActionRowBuilder().addComponents(skillSelectComponent);
                                if (to_character) {
                                    await interaction_second.update({ content: 'Please select the following options:', components: [skillSelectRow, characterSelectRow] });
                                } else {
                                    await interaction_second.update({ content: 'Please select the following options:', components: [skillSelectRow, archetypeSelectRow] });
                                }
                            } else if (skillSelected && (charactersSelected || archetypesSelected)) {
                                if (charactersSelected) {
                                    console.log(charactersSelected);
                                    for (const character_id of charactersSelected) {
                                        await connection.promise().query('insert ignore into skills_characters (character_id, skill_id) values (?, ?)', [character_id, skillSelected]);
                                    }
                                } else {
                                    for (const archetype_id of archetypesSelected) {
                                        await connection.promise().query('insert ignore into skills_archetypes (archetype_id, skill_id) values (?, ?)', [archetype_id, skillSelected]);
                                    }
                                }
                                await interaction_second.update({ content: 'Successfully assigned skill to characters or archetypes. I\'d tell you which but Alli is lazy.', components: [] });
                                await collector.stop();
                            } else {
                                await interaction_second.deferUpdate();
                            }
                        } else {
                            await interaction_second.deferUpdate();
                        }
                    });
                    collector.on('end', async (collected) => {
                        console.log(collected);
                        // How do we clean the message up?
                    });
                } else {
                    interaction.reply({ content: 'Couldn\'t find any characters. Or archetypes, if you wanted to assign archetypes. I can\'t be sure because Alli is lazy.', ephemeral: true });
                }
            } else {
                interaction.reply({ content: 'Please create at least one skill first. <3', ephemeral: true });
            }
        } else if (interaction.commandName == 'assignitem') {
            var items = await connection.promise().query('select i.*, c.name as character_name from items i left outer join characters_items ci on i.id = ci.item_id left outer join characters c on ci.character_id = c.id where i.guild_id = ?', [interaction.guildId]);
            var itemsAlphabetical;
            if (items[0].length > 0) {
                if (items[0].length <= 25) {
                    itemsAlphabetical = false;
                    var itemsKeyValues = [];
                    for (const item of items[0]) {
                        if (!item.character_name) {
                            item.character_name = 'Unassigned';
                        }
                        var thisItemKeyValue = { label: `${item.name} (${item.character_name})`, value: item.id.toString() };
                        itemsKeyValues.push(thisItemKeyValue);
                    }
                    const itemSelectComponent = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('ItemAssignmentItemSelector').setMinValues(1).setMaxValues(1);
                } else {
                    itemsAlphabetical = true;
                    var items = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                    var itemsKeyValues = [];
                    for (const item of items) {
                        var thisItemKeyValue = { label: item, value: item }
                        itemsKeyValues.push(thisItemKeyValue);
                    }
                    itemSelectComponent = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('ItemAssignmentAlphabetSelector').setMinValues(1).setMaxValues(1);
                }
                var itemSelectRow = new ActionRowBuilder().addComponents(itemSelectComponent);
                var characters = await connection.promise().query('select * from characters where guild_id = ?', [interaction.guildId]);
                if (characters[0].length > 0) {
                    var charactersKeyValues = [{ label: 'Select a character', value: '0' }];
                    for (const character of characters[0]) {
                        var thisCharacterKeyValue = { label: character.name, value: character.id.toString() };
                        charactersKeyValues.push(thisCharacterKeyValue);
                    }
                    const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('ItemAssignmentCharacterSelector').setMinValues(1).setMaxValues(1);
                    var characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                    var message = await interaction.reply({ content: 'Please select the following options:', components: [itemSelectRow, characterSelectRow], ephemeral: true });
                    var collector = message.createMessageComponentCollector();
                    var characterSelected;
                    var itemSelected;
                    var alphabetSelected;
                    collector.on('collect', async (interaction_second) => {
                        if (interaction_second.values[0]) {
                            if (interaction_second.customId == 'ItemAssignmentItemSelector') {
                                itemSelected = interaction_second.values[0];
                            } else if (interaction_second.customId == 'ItemAssignmentAlphabetSelector') {
                                alphabetSelected = interaction_second.values[0];
                            } else if (interaction_second.customId == 'ItemAssignmentCharacterSelector') {
                                characterSelected = interaction_second.values[0];
                            }
                            if (alphabetSelected && !itemSelected) {
                                if (alphabetSelected.length == 1) {
                                    var items = await connection.promise().query('select i.*, c.name as character_name from items i left outer join characters_items ci on i.id = ci.item_id left outer join characters c on ci.character_id = c.id where i.guild_id = ? and i.name like ?', [interaction_second.guildId, alphabetSelected + '%']);
                                } else {
                                    await interaction_second.update({ content: 'Something has gone really horribly wrong, can you ask Alli maybe?', components: [] });
                                    await collector.stop();
                                }
                                var itemsKeyValues = [];
                                for (const item of items[0]) {
                                    if (!item.character_name) {
                                        item.character_name = 'Unassigned';
                                    }
                                    var thisItemKeyValue = { label: `${item.name} (${item.character_name})`, value: item.id.toString() };
                                    itemsKeyValues.push(thisItemKeyValue);
                                }
                                const itemSelectComponent = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('ItemAssignmentItemSelector').setMinValues(1).setMaxValues(1);
                                var itemSelectRow = new ActionRowBuilder().addComponents(itemSelectComponent);
                                await interaction_second.update({ content: 'Please select the following options:', components: [itemSelectRow, characterSelectRow] });
                            } else if (itemSelected && characterSelected) {
                                await connection.promise().query('replace into characters_items (character_id, item_id) values (?, ?)', [characterSelected, itemSelected]);
                                await interaction_second.update({ content: 'Successfully assigned item to charactercharaljter.', components: [] });
                                await collector.stop();
                            } else {
                                await interaction_second.deferUpdate();
                            }
                        } else {
                            await interaction_second.deferUpdate();
                        }
                    });
                    collector.on('end', async (collected) => {
                        console.log(collected);
                        // How do we clean the message up?
                    });
                } else {
                    interaction.reply({ content: 'Couldn\'t find any characters, which is a bit odd. Try creating one, or yell at Alli if you shouldn\'t be getting this.', ephemeral: true });
                }
            } else {
                interaction.reply({ content: 'Please create at least one ~~skill~~ item first. <3', ephemeral: true });
            }
        } else if (interaction.commandName == 'modsheet') {
            //dropdown for characters
            //then generate character sheet ephemeral using the sheet code EXACTLY
            interaction.reply({ content: 'nyi, sorry', ephemeral: true });
        }


        // PLAYER COMMANDS
        else if (isPlayer(interaction.user.id, interaction.guildId) || interaction.member.hasPermission("ADMINISTRATOR")) {
            if (interaction.commandName == 'move') {
                var is_enabled = await connection.promise().query('select ml.movement_allowed, ml.id from players join players_characters pc on players.id = pc.player_id join characters c on pc.character_id = c.id join movement_locations ml on ml.id = c.location_id where players.user_id = ? and players.guild_id = ? and pc.active = 1', [interaction.user.id, interaction.guildId]);
                if (is_enabled[0].length > 0) {
                    var locations = await connection.promise().query('select * from movement_locations where guild_id = ? and movement_allowed = 1 and id <> ?', [interaction.guildId, is_enabled[0][0].id])
                    if (locations[0].length > 0) {
                        var locationsKeyValues = [];
                        for (const location of locations[0]) {
                            var thisLocationKeyValue = { label: location.friendly_name, value: location.id.toString() };
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
            } else if (interaction.commandName == 'sheet') {
                var current_character = await connection.promise().query('select character_id from players_characters join players p on p.id = players_characters.player_id where p.user_id = ? and players_characters.active = 1', [interaction.user.id]);
                if (current_character[0].length > 0) {
                    var character_information = await connection.promise().query('select * from characters where id = ?', [current_character[0][0].character_id]);
                    var character_archetypes = await connection.promise().query('select * from archetypes a join characters_archetypes ca on ca.archetype_id = a.id where ca.character_id = ?', [current_character[0][0].character_id]);
                    var character_stats = await connection.promise().query('select s.*, cs.override_value from stats s left outer join characters_stats cs on cs.stat_id = s.id and cs.character_id = ? where guild_id = ?', [current_character[0][0].character_id, interaction.guildId]);
                    var archetype_stats = await connection.promise().query('select ars.*, ca2.override_value from archetypestats ars join archetypes_archetypestats aa on ars.id = aa.archetypestat_id join characters_archetypes ca on aa.archetype_id = ca.archetype_id and ca.character_id = ? left outer join characters_archetypestats ca2 on ca2.stat_id = ars.id and ca2.character_id = ?', [current_character[0][0].character_id, current_character[0][0].character_id]);
                    var world_stats = [[]]; //TODO
                    var msg = `**${character_information[0][0].name}** - ${character_information[0][0].description}\n`
                    if (character_archetypes[0].length > 0) {
                        msg = msg.concat(`\n__Archetypes__\n`);
                        for (const thisArchetype of character_archetypes[0]) {
                            msg = msg.concat(`**${thisArchetype.name}** - ${thisArchetype.description}\n`);
                        }
                    }
                    if (character_stats[0].length > 0 || archetype_stats[0].length > 0 || world_stats[0].length > 0) {
                        msg = msg.concat(`\n__Stats__\n`);
                    }
                    if (character_stats[0].length > 0) {
                        for (const thisStat of character_stats[0]) {
                            if (thisStat.override_value) {
                                msg = msg.concat(`**${thisStat.name}** - ${thisStat.override_value}\n`);
                            } else { // TODO else if thisStat has an ARCHETYPE override value
                                msg = msg.concat(`**${thisStat.name}** - ${thisStat.default_value}\n`);
                            }

                        }
                    }
                    if (archetype_stats[0].length > 0) {
                        for (const thisStat of archetype_stats[0]) {
                            if (thisStat.override_value) {
                                msg = msg.concat(`**${thisStat.name}** - ${thisStat.override_value}\n`);
                            } else { // TODO else if thisStat has an ARCHETYPE override value
                                msg = msg.concat(`**${thisStat.name}** - ${thisStat.default_value}\n`);
                            }
                        }
                    }
                    if (world_stats[0].length > 0) {
                        // TODO
                    }
                    const buttonActionRow = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder().setCustomId(`skills-${current_character[0][0].character_id}`).setLabel('Skills').setStyle(ButtonStyle.Primary),
                            new ButtonBuilder().setCustomId(`inventory-${current_character[0][0].character_id}`).setLabel('Inventory').setStyle(ButtonStyle.Primary)
                        );
                    await interaction.reply({ content: msg, components: [buttonActionRow], ephemeral: true });
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
                                await interaction.reply({ content: '<@' + interaction.user + '> has challenged me to a duel!', components: [rpsRow] });
                            });
                        }
                    });
                }
            } else if (interaction.commandName == 'skill') { //TODO: Futureproof with alphabet selector.
                var current_character = await connection.promise().query('select players_characters.character_id, c.name from players_characters join players p on p.id = players_characters.player_id join characters c on c.id = players_characters.character_id where p.user_id = ? and players_characters.active = 1', [interaction.user.id]);
                if (current_character[0].length > 0) {
                    var archetypeskills = await connection.promise().query('select s.* from skills s join skills_archetypes sa on sa.skill_id = s.id join characters_archetypes ca on sa.archetype_id = ca.archetype_id where ca.character_id = ?', [current_character[0][0].character_id]);
                    var characterskills = await connection.promise().query('select s.* from skills s join skills_characters sc on sc.skill_id = s.id where sc.character_id = ?', [current_character[0][0].character_id]);
                    var skills;

                    if (archetypeskills[0].length > 0) {
                        console.log(archetypeskills[0]);
                        var skillids = new Set(archetypeskills[0].map(d => d.id));
                        if (characterskills[0].length > 0) {
                            console.log(characterskills[0]);
                            skills = [...archetypeskills[0], ...characterskills[0].filter(d => !skillids.has(d.id))];
                        } else {
                            skills = archetypeskills[0];
                        }
                    } else if (characterskills[0].length > 0) {
                        console.log(characterskills[0]);
                        skills = characterskills[0];
                    }
                    if (skills) {
                        var skillsKeyValues = [];
                        for (const skill of skills) {
                            var thisSkillKeyValue = { label: skill.name, value: skill.id.toString() };
                            skillsKeyValues.push(thisSkillKeyValue);
                        }
                        const skillSelectComponent = new StringSelectMenuBuilder().setOptions(skillsKeyValues).setCustomId('SkillSelector' + interaction.member.id).setMinValues(1).setMaxValues(1);
                        var skillSelectRow = new ActionRowBuilder().addComponents(skillSelectComponent);
                        var message = await interaction.reply({ content: 'Select a skill to share with the channel:', components: [skillSelectRow], ephemeral: true });
                        var collector = message.createMessageComponentCollector();
                        collector.on('collect', async (interaction_second) => {
                            if (interaction_second.values[0]) {
                                skillSelected = interaction_second.values[0];
                                var skill = skills.find(s => s.id == skillSelected);
                                await interaction_second.reply({ content: `${current_character[0][0].name}'s **${skill.name}**: ${skill.description}` });
                                await collector.stop();
                            }

                        });
                        collector.on('end', async (collected) => {
                            console.log(collected);
                            // How do we clean the message up?
                        });
                    } else {
                        interaction.reply({ content: 'You don\'t seem to have any skills. Sorry about that.', ephemeral: true });
                    }
                } else {
                    interaction.reply({ content: 'You don\'t seem to have an active character. Check in with the mods on this, please.', ephemeral: true });
                }
                //dropdown
                // put dropdown in thingy
            } else if (interaction.commandName == 'item') {
                var current_character = await connection.promise().query('select pc.character_id, c.name from players_characters pc join players p on p.id = pc.player_id join characters c on c.id = pc.character_id where p.user_id = ? and pc.active = 1', [interaction.user.id]);
                if (current_character[0].length > 0) {
                    var items = await connection.promise().query('select i.* from items i join characters_items ci on ci.item_id = i.id where ci.character_id = ?', [current_character[0][0].character_id]);
                    if (items[0].length > 0) {
                        var itemsKeyValues = [];
                        for (const item of items[0]) {
                            var thisItemKeyValue = { label: item.name, value: item.id.toString() };
                            itemsKeyValues.push(thisItemKeyValue);
                        }
                        const itemSelectComponent = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('ItemSelector' + interaction.member.id).setMinValues(1).setMaxValues(1);
                        var itemSelectRow = new ActionRowBuilder().addComponents(itemSelectComponent);
                        var message = await interaction.reply({ content: 'Select a item to share with the channel:', components: [itemSelectRow], ephemeral: true });
                        var collector = message.createMessageComponentCollector();
                        collector.on('collect', async (interaction_second) => {
                            if (interaction_second.values[0]) {
                                itemSelected = interaction_second.values[0];
                                var item = items[0].find(i => i.id == itemSelected);
                                await interaction_second.reply({ content: `${current_character[0][0].name}'s **${item.name}**: ${item.description}` });
                                await collector.stop();
                            }

                        });
                        collector.on('end', async (collected) => {
                            console.log(collected);
                            // How do we clean the message up?
                        });
                    } else {
                        interaction.reply({ content: 'You don\'t seem to have any items. Sorry about that.', ephemeral: true });
                    }
                } else {
                    interaction.reply({ content: 'You don\'t seem to have an active character. Check in with the mods on this, please.', ephemeral: true });
                }
                //dropdown
                // put dropdown in thingy
            } else if (interaction.commandName == 'give') { //TODO: Futureproof this with the alphabet selector.
                var current_character = await connection.promise().query('select c.location, pc.character_id, c.name from players_characters pc join characters c on c.id = pc.character_id join players p on p.id = players_characters.player_id where p.user_id = ? and players_characters.active = 1', [interaction.user.id]);
                if (current_character[0].length > 0) {
                    var items = await connection.promise().query('select i.* from items i join characters_items ci on ci.item_id = i.id where ci.character_id = ?', [current_character[0][0].id]);
                    if (items[0].length > 0) {
                        var itemsKeyValues = [];
                        for (const item of items[0]) {
                            var thisItemKeyValue = { label: item.name, value: item.id.toString() };
                            itemsKeyValues.push(thisItemKeyValue);
                        }
                        const itemSelectComponent = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('GiveItemSelector' + interaction.member.id).setMinValues(1).setMaxValues(1);
                        var itemSelectRow = new ActionRowBuilder().addComponents(itemSelectComponent);

                        var characters = await connection.promise().query('select * from characters where guild_id = ? and id != ? and location = ?', [interaction.guildId, current_character[0][0].id, current_character[0][0].location]);
                        if (characters[0].length > 0) {
                            var charactersKeyValues = [];
                            for (const character of characters[0]) {
                                charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                            }
                            const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('GiveCharacterSelector').setMinValues(1).setMaxValues(characters[0].length);
                            var characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);

                            var message = await interaction.reply({ content: 'Select an item and a character to give it to:', components: [itemSelectRow, characterSelectRow], ephemeral: true });
                            var collector = message.createMessageComponentCollector();
                            var itemSelected;
                            var characterSelected;
                            collector.on('collect', async (interaction_second) => {
                                if (interaction_second.values[0]) {
                                    if (interaction_second.customId == 'GiveItemSelector') {
                                        itemSelected = interaction_second.values[0];
                                    } else {
                                        characterSelected = interaction_second.values[0];
                                    }
                                    if (itemSelected && characterSelected) {
                                        await connection.promise().query('update characters_items set character_id = ? where item_id = ?', [characterSelected, itemSelected]);
                                        var item = items[0].find(i => i.id == itemSelected);
                                        var character_destination = characters[0].find(c => c.id == characterSelected);
                                        await interaction_second.reply({ content: `${current_character[0][0].name} gives ${character_destination.name} their **${item.name}**!` });
                                        await collector.stop();
                                    } else {
                                        await interaction_second.deferUpdate();
                                    }
                                } else {
                                    await interaction_second.deferUpdate();
                                }
                            })
                            //okay now set up the message

                            // and the collector

                            // and then process the give inside the collector (update item owner in characters_items)
                        } else {
                            interaction.reply({ content: 'There don\'t seem to be any other characters in this game. You may want to double check on this.', ephemeral: true });
                        }
                    } else {
                        interaction.reply({ content: 'You don\'t seem to have any items. Sorry about that.', ephemeral: true });
                    }
                } else {
                    interaction.reply({ content: 'You don\'t seem to have an active character. If you weren\'t expecting to see this message, check in with the mods.', ephemeral: true });
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
                                        await interaction.followUp('The RPS round between <@' + res2[1][0].challenger + '> and <@' + res2[1][0].challenged + '> has ended in a draw. (' + res2[1][0].challenged_throw + ' = ' + res2[1][0].challenger_throw + ')');
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
                                            await interaction.followUp('The RPS round between <@' + res2[1][0].challenger + '> and <@' + res2[1][0].challenged + '> has ended in a draw. (' + res2[1][0].challenger_throw + ' = ' + res2[1][0].challenger_throw + ')');
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
        } else if (interaction.customId.startsWith('sheet-')) {
            var character_id = interaction.customId.split('-')[1];
            var character_information = await connection.promise().query('select * from characters where id = ?', [character_id]);
            var character_archetypes = await connection.promise().query('select * from archetypes a join characters_archetypes ca on ca.archetype_id = a.id where ca.character_id = ?', [character_id]);
            var character_stats = await connection.promise().query('select s.*, cs.override_value from stats s left outer join characters_stats cs on cs.stat_id = s.id and cs.character_id = ? where guild_id = ?', [character_id, interaction.guildId]);
            var archetype_stats = await connection.promise().query('select ars.*, ca2.override_value from archetypestats ars join archetypes_archetypestats aa on ars.id = aa.archetypestat_id join characters_archetypes ca on aa.archetype_id = ca.archetype_id and ca.character_id = ? left outer join characters_archetypestats ca2 on ca2.stat_id = ars.id and ca2.character_id = ?', [character_id, character_id]);
            var world_stats = [[]]; //TODO
            var msg = `**${character_information[0][0].name}** - ${character_information[0][0].description}\n`
            if (character_archetypes[0].length > 0) {
                msg = msg.concat(`\n__Archetypes__\n`);
                for (const thisArchetype of character_archetypes[0]) {
                    msg = msg.concat(`**${thisArchetype.name}** - ${thisArchetype.description}\n`);
                }
            }
            if (character_stats[0].length > 0 || archetype_stats[0].length > 0 || world_stats[0].length > 0) {
                msg = msg.concat(`\n__Stats__\n`);
            }
            if (character_stats[0].length > 0) {
                for (const thisStat of character_stats[0]) {
                    if (thisStat.override_value) {
                        msg = msg.concat(`**${thisStat.name}** - ${thisStat.override_value}\n`);
                    } else { // TODO else if thisStat has an ARCHETYPE override value
                        msg = msg.concat(`**${thisStat.name}** - ${thisStat.default_value}\n`);
                    }

                }
            }
            if (archetype_stats[0].length > 0) {
                for (const thisStat of archetype_stats[0]) {
                    if (thisStat.override_value) {
                        msg = msg.concat(`**${thisStat.name}** - ${thisStat.override_value}\n`);
                    } else { // TODO else if thisStat has an ARCHETYPE override value
                        msg = msg.concat(`**${thisStat.name}** - ${thisStat.default_value}\n`);
                    }
                }
            }
            if (world_stats[0].length > 0) {
                // TODO
            }
            const buttonActionRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId(`skills-${character_id}`).setLabel('Skills').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`inventory-${character_id}`).setLabel('Inventory').setStyle(ButtonStyle.Primary)
                );
            await interaction.update({ content: msg, components: [buttonActionRow] });
        } else if (interaction.customId.startsWith('skills-')) {
            var character_id = interaction.customId.split('-')[1];
            var character_skills = await connection.promise().query('select s.* from skills s join skills_characters sc on s.id = sc.skill_id where sc.character_id = ?', [character_id]);
            var archetype_skills = await connection.promise().query('select s.* from skills s join skills_archetypes sa on s.id = sa.skill_id join characters_archetypes ca on sa.archetype_id = ca.archetype_id and ca.character_id = ?', [character_id]);
            if (character_skills[0].length > 0 || archetype_skills[0].length > 0) {
                var msg = `__Skills__\n`;
                if (character_skills[0].length > 0) {
                    for (const thisSkill of character_skills[0]) {
                        msg = msg.concat(`**${thisSkill.name}**: ${thisSkill.description}\n`);
                    }
                }
                if (archetype_skills[0].length > 0) {
                    for (const thisSkill of archetype_skills[0]) {
                        msg = msg.concat(`**${thisSkill.name}**: ${thisSkill.description}\n`);
                    }
                }
            } else {
                var msg = `You don't have any skills! Hmm. Maybe check with an Orchestrator if you weren't expecting this.`;
            }
            const buttonActionRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId(`sheet-${character_id}`).setLabel('Sheet').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`inventory-${character_id}`).setLabel('Inventory').setStyle(ButtonStyle.Primary)
                );
            await interaction.update({ content: msg, components: [buttonActionRow] });
        } else if (interaction.customId.startsWith('inventory-')) {
            var character_id = interaction.customId.split('-')[1];
            var character_items = await connection.promise().query('select i.* from items i join characters_items ci on i.id = ci.item_id where ci.character_id = ?', [character_id]);

            if (character_items[0].length > 0) {
                var msg = '__Items__\n';
                for (const thisItem of character_items[0]) {
                    msg = msg.concat(`**${thisItem.name}**: ${thisItem.description}\n`);
                }
            } else {
                var msg = `Your inventory is empty. If you believe you have received this message in error, please contact an Orchestrator.`;
            }

            const buttonActionRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId(`sheet-${character_id}`).setLabel('Sheet').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`skills-${character_id}`).setLabel('Skills').setStyle(ButtonStyle.Primary)
                );
            await interaction.update({ content: msg, components: [buttonActionRow] });
        }
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'LocationMovementSelector' + interaction.member.id) {
            var dest_id = interaction.values[0]
            var locations = await connection.promise().query('select ml.*, c.name as character_name from players p join players_characters pc on p.id = pc.player_id left outer join characters c on pc.character_id = c.id join movement_locations ml on c.location_id = ml.id where ((p.user_id = ? and pc.active = 1) or c.location_id = ?) and ml.movement_allowed = 1 and ml.guild_id = ?', [interaction.user.id, dest_id, interaction.guild_id]);
            if (locations[0].length == 2) {
                await interaction.update({ content: 'Location selected for movement!', components: [] });
                // Source and dest are both valid.
                var new_announcements;
                var new_name;
                var old_announcements;
                var old_name;
                var character_name = locations[0][0].character_name;
                for (const location of locations[0]) {
                    var channel = await client.channels.cache.get(location.channel_id);
                    if (location.id == dest_id) {
                        await channel.permissionOverwrites.edit(interaction.member, { ViewChannel: true, SendMessages: true });
                        if (location.announcements_id) {
                            new_announcements = await client.channels.cache.get(location.announcements_id);
                            new_name = location.friendly_name;
                        }
                    } else {
                        if (location.global_read == 0) {
                            await channel.permissionOverwrites.edit(interaction.member, { ViewChannel: false });
                        }
                        await channel.permissionOverwrites.edit(interaction.member, { SendMessages: false });
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
                interaction.update({ content: 'Sorry, either your current location or your destination was locked for traveling between the time you started your move and the time you submitted it. Please contact an Orchestrator. :purple_heart:', components: [] });

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