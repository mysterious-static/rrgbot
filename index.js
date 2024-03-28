/*jslint es6*/
const Discord = require('discord.js');
const { ChannelType, ModalBuilder, TextInputBuilder, ActionRowBuilder, ButtonBuilder, EmbedBuilder, TextInputComponent, StringSelectMenuBuilder, RoleSelectMenuBuilder, TextInputStyle, PermissionFlagsBits, PermissionsBitField, GatewayIntentBits, SlashCommandBuilder, ButtonStyle } = require('discord.js')
const client = new Discord.Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildWebhooks, GatewayIntentBits.GuildMessageReactions, GatewayIntentBits.GuildEmojisAndStickers, GatewayIntentBits.GuildMembers] });
const mysql = require('mysql2');
const connection = mysql.createConnection({
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

/* Functions */

async function process_effect(character, effect, source, guildId, channel, target = null) {
    console.log('process effect ' + effect.id);
    //TODO: care about charges!
    let message;
    if (source == 'skill') {
        let skill = await connection.promise().query('select s.name from effects e join skills_effects se on e.id = se.effect_id join skills s on s.id = se.skill_id where e.id = ?', [effect.id]);
        message = `**${character.name}'s ${skill[0][0].name}**:`
    } else if (source == 'item') {
        let item = await connection.promise().query('select i.name from effects e join items_effects ie on e.id = ie.effect_id join items i on i.id = ie.item_id where e.id = ?', [effect.id]);
        message = `**${character.name}'s ${item[0][0].name}**:`;
    } else if (source == 'reputationtier') {
        let reputation = await connection.promise().query('select rt.threshold_name as tiername, r.name as repname from effects e join reputations_tiers_effects rte on e.id = rte.effect_id join reputations_tiers rt on rte.reputationtier_id = rt.id join reputations r on rt.reputation_id = r.id where e.id = ?', [effect.id]);
        message = `**${reputation[0][0].repname} reaches ${reputation[0][0].tiername}:**`
    }
    if (target && effect.target == 'target') {
        character = target;
    }

    // Eligibility check
    let prereqs = await connection.promise().query('select * from effects_prereqs where effect_id = ?', [effect.id]);
    let process = false;
    let and_groups = [];
    if (prereqs[0].length > 0) {
        for (const prereq of prereqs[0]) {
            let check = new Array();
            switch (prereq.prereq_type) {
                case 'wflag_gt':
                    check = await connection.promise().query('select * from worldflags where id = ? and value > ?', [prereq.prereq_id, prereq.prereq_value]);
                    break;
                case 'wflag_eq':
                    res = await connection.promise().query('select * from worldflags where id = ? and value = ?', [prereq.prereq_id, prereq.prereq_value]);
                    check[0] = new Array();
                    if (res[0].length > 0 && !prereq.not || (res[0].length == 0 && prereq.not)) {
                        check[0].push(true);
                    }
                    break;
                case 'wflag_lt':
                    check = await connection.promise().query('select * from worldflags where id = ? and value < ?', [prereq.prereq_id, prereq.prereq_value]);
                    break;
                case 'cflag_gt':
                    check = await connection.promise().query('select * from characters_characterflags where character_id = ? and characterflag_id = ? and value > ?', [character.id, prereq.prereq_id, prereq.prereq_value]);
                    break;
                case 'cflag_eq':
                    res = await connection.promise().query('select * from characters_characterflags where character_id = ? and characterflag_id = ? and value = ?', [character.id, prereq.prereq_id, prereq.prereq_value]);
                    check[0] = new Array();
                    if (res[0].length > 0 && !prereq.not || (res[0].length == 0 && prereq.not)) {
                        check[0].push(true);
                    }
                    break;
                case 'cflag_lt':
                    check = await connection.promise().query('select * from characters_characterflags where character_id = ? and characterflag_id = ? and value < ?', [character.id, prereq.prereq_id, prereq.prereq_value]);
                    break;
                case 'archetype':
                    res = await connection.promise().query('select * from characters_archetypes where character_id = ? and archetype_id = ?', [character.id, prereq.prereq_id]);
                    check[0] = new Array();
                    if (res[0].length > 0 && !prereq.not || (res[0].length == 0 && prereq.not)) {
                        check[0].push(true);
                    }
                    break;
                case 'character':
                    check[0] = new Array();
                    if (character.id == prereq.prereq_id) {
                        if (!prereq.not) {
                            check[0].push(true);
                        }
                    } else if (prereq.not) {
                        check[0].push(true);
                    }
                    break;
            }
            if (check[0] && check[0].length > 0) {
                if (and_groups[prereq.logical_and_group] === undefined) {
                    and_groups[prereq.logical_and_group] = true;
                }
            } else {
                and_groups[prereq.logical_and_group] = false;
            }
        }
        for (const thisAndGroup of and_groups) {
            if (thisAndGroup == true) {
                process = true;
            }
        }
    }

    if (process || prereqs[0].length == 0) {
        let adjusted;
        if (effect.type_qty && effect.type_qty > 0) {
            adjusted = 'increased';
        } else {
            adjusted = 'decreased';
        }
        switch (effect.type) {
            case 'item':
                {
                    let item_exists = await connection.promise().query('select * from characters_items where character_id = ? and item_id = ?', [character.id, effect.type_id]);
                    if (item_exists[0].length == 1) {
                        await connection.promise().query('update characters_items set quantity = quantity + ? where character_id = ? and item_id = ?', [effect.type_qty, character.id, effect.type_id]);
                    } else {
                        await connection.promise().query('insert into characters_items (character_id, item_id, quantity) values (?, ?, ?)', [character.id, effect.type_id, effect.type_qty]);
                    }
                    let item = await connection.promise().query('select * from items where id = ?', effect.type_id);
                    if (effect.type_qty > 0) {
                        adjusted = 'awarded';
                    } else {
                        adjusted = 'removed';
                    }
                    message += ` ${adjusted} ${item[0][0].name} x${Math.abs(effect.type_qty)} to ${character.name}`;
                } break;
            case 'wflag_inc':
                {
                    await connection.promise().query('update worldflags set value = value + ? where id = ?', [effect.type_qty, effect.type_id]);
                    let wflag = await connection.promise().query('select * from worldflags where id = ?', effect.type_id);
                    message += ` ${adjusted} the *${wflag[0][0].name}* world flag by ${Math.abs(effect.type_qty)}`;
                } break;
            case 'wflag_set':
                {
                    await connection.promise().query('update worldflags set value = ? where id = ?', [effect.type_qty, effect.type_id]);
                    let wflag = await connection.promise().query('select * from worldflags where id = ?', effect.type_id);
                    message += ` set the *${wflag[0][0].name}* world flag to ${effect.type_qty}`;
                } break;
            case 'cflag_inc':
                {
                    let cflag_exists = await connection.promise().query('select * from characters_characterflags where character_id = ? and characterflag_id = ?', [character.id, effect.type_id]);
                    if (cflag_exists[0].length == 1) {
                        await connection.promise().query('update characters_characterflags set value = value + ? where character_id = ? and characterflag_id = ?', [effect.type_qty, character.id, effect.type_id]);
                    } else {
                        await connection.promise().query('insert into characters_characterflags (value, character_id, characterflag_id) values (?, ?, ?)', [effect.type_qty, character.id, effect.type_id]);
                    }
                    let cflag = await connection.promise().query('select * from characterflags where id = ?', effect.type_id);
                    message += ` ${adjusted} ${character.name}'s *${cflag[0][0].name}* character flag by ${Math.abs(effect.type_qty)}`;
                } break;
            case 'cflag_set':
                {
                    await connection.promise().query('replace into characters_characterflags (value, character_id, characterflag_id) values (?, ?, ?)', [effect.type_qty, character.id, effect.type_id]);
                    let cflag = await connection.promise().query('select * from characterflags where id = ?', effect.type_id);
                    message += ` set ${character.name}'s *${cflag[0][0].name}* character flag to ${effect.type_qty}`;
                } break;
            case 'skill':
                {
                    let skill = await connection.promise().query('select s.*, sc.character_id from skills s left outer join skills_characters sc on sc.skill_id = s.id and sc.character_id = ? where id = ?', [character.id, effect.type_id]);
                    message += ` added *${skill[0][0].name}* to ${character.name}`;
                    if (skill[0][0].character_id != null) {
                        message += ` **(Skill already assigned!)**`;
                    }
                    await connection.promise().query('insert ignore into skills_characters (character_id, skill_id) values (?, ?)', [character.id, effect.type_id]);
                } break;
            case 'archetype':
                {
                    await connection.promise().query('insert ignore into characters_archetypes (character_id, archetype_id) values (?, ?)', [character.id, effect.type_id]);
                    let archetype = await connection.promise().query('select * from archetypes where id = ?', effect.type_id);
                    message += ` gave ${character.name} the *${archetype[0][0].name}* archetype`;
                } break;
            case 'reputation_inc':
                {
                    let old_value;
                    let reputation_exists = await connection.promise().query('select * from characters_reputations where character_id = ? and reputation_id = ?', [character.id, effect.type_id]);
                    if (reputation_exists[0].length == 1) {
                        await connection.promise().query('update characters_reputations set max_value = greatest(max_value, (value + ?)), value = value + ?  where character_id = ? and reputation_id = ?', [effect.type_qty, effect.type_qty, character.id, effect.type_id]);
                        old_value = reputation_exists[0][0].max_value;
                    } else {
                        await connection.promise().query('insert into characters_reputations (character_id, reputation_id, value) values (?, ?, ?)', [character.id, effect.type_id, effect.type_qty]);
                        old_value = 0;
                    }
                    let reputation = await connection.promise().query('select * from reputations where id = ?', effect.type_id);
                    message += ` ${adjusted} ${character.name}'s standing with *${reputation[0][0].name}* by ${Math.abs(effect.type_qty)}`;
                    let effects;
                    if (reputation_exists[0].length == 1) {
                        effects = await connection.promise().query('select e.* from effects e join reputations_tiers_effects rte on e.id = rte.effect_id join reputations_tiers rt on rt.id = rte.reputationtier_id where rt.value > ? and rt.value <= ? and rt.reputation_id = ?', [old_value, reputation_exists[0][0].value + effect.type_qty, effect.type_id]);
                    } else {
                        effects = await connection.promise().query('select e.* from effects e join reputations_tiers_effects rte on e.id = rte.effect_id join reputations_tiers rt on rt.id = rte.reputationtier_id where rt.value > ? and rt.value <= ? and rt.reputation_id = ?', [old_value, effect.type_qty, effect.type_id]);
                    }
                    if (effects[0].length > 0) {
                        for (const thisEffect of effects[0]) {
                            await process_effect(character, thisEffect, 'reputationtier', guildId, channel);
                        }
                    }
                } break;
            case 'reputation_set': {
                let old_value;
                let reputation_exists = await connection.promise().query('select * from characters_reputations where character_id = ? and reputation_id = ?', [character.id, effect.type_id]);
                if (reputation_exists[0].length == 1) {
                    old_value = reputation_exists[0][0].max_value;
                } else {
                    old_value = 0;
                }
                await connection.promise().query('replace into characters_reputations (character_id, reputation_id, value, max_value) values (?, ?, ?, greatest(max_value, ?))', [character.id, effect.type_id, effect.type_qty, effect.type_qty]);
                let reputation = await connection.promise().query('select * from reputations where id = ?', effect.type_id);
                message += ` set ${character.name}'s standing with *${reputation[0][0].name}* to ${effect.type_qty}`;
                let effects;
                if (reputation_exists[0].length == 1) {
                    effects = await connection.promise().query('select e.* from effects e join reputations_tiers_effects rte on e.id = rte.effect_id join reputations_tiers rt on rt.id = rte.reputationtier_id where rt.value > ? and rt.value <= ? and rt.reputation_id = ?', [old_value, reputation_exists[0][0].value + effect.type_qty, effect.type_id]);
                } else {
                    effects = await connection.promise().query('select e.* from effects e join reputations_tiers_effects rte on e.id = rte.effect_id join reputations_tiers rt on rt.id = rte.reputationtier_id where rt.value > ? and rt.value <= ? and rt.reputation_id = ?', [old_value, effect.type_qty, effect.type_id]);
                }
                if (effects[0].length > 0) {
                    for (const thisEffect of effects[0]) {
                        await process_effect(character, thisEffect, 'reputationtier', guildId, channel);
                    }
                }
            } break;
            case 'stat_inc':
                {
                    let stat_exists = await connection.promise().query('select * from characters_stats where character_id = ? and stat_id = ?', [character.id, effect.type_id]);
                    if (stat_exists[0].length == 1) {
                        await connection.promise().query('update characters_stats set override_value = override_value + ? where character_id = ? and stat_id = ?', [effect.type_qty, character.id, effect.type_id]);
                    } else {
                        let statdata = await connection.promise().query('select * from stats where id = ?', [effect.type_id]);
                        await connection.promise().query('insert into characters_stats (character_id, stat_id, override_value) values (?, ?, ?)', [character.id, effect.type_id, statdata[0][0].default_value + effect.type_qty]);
                        // When stats have archetype overrides, we will need t  check those first too
                    }
                    let stat = await connection.promise().query('select * from stats where id = ?', effect.type_id);
                    message += ` ${adjusted} ${character.name}'s ${stat[0][0].name} stat by ${Math.abs(effect.type_qty)}`;
                } break;
            case 'stat_set':
                {
                    await connection.promise().query('replace into characters_stats (character_id, stat_id, override_value) values (?, ?, ?)', [character.id, effect.type_id, effect.type_qty]);
                    let stat = await connection.promise().query('select * from stats where id = ?', effect.type_id);
                    message += ` set ${character.name}'s ${stat[0][0].name} stat to ${effect.type_qty}`;
                } break;
            case 'message':
                {
                    message += ` *Special Message:* ${effect.typedata}`;
                } break;
        }

        if (effect.visible) {
            let players = await connection.promise().query('select p.notification_channel from characters c join players_characters pc on c.id = pc.character_id join players p on p.id = pc.player_id where c.id = ? and p.notification_channel is not null', [character.id]);
            if (players[0].length > 0) {
                for (const thisPlayer of players[0]) {
                    let channel = await client.channels.cache.get(thisPlayer.notification_channel);
                    await channel.send({ content: message });
                }
            }
        }
        let settingvalue = await connection.promise().query('select * from game_settings where guild_id = ? and setting_name = ?', [guildId, 'audit_channel']);
        if (settingvalue[0].length > 0) {
            let audit_channel = await client.channels.cache.get(settingvalue[0][0].setting_value);
            let embed = new EmbedBuilder()
                .setTitle('Effect processed!')
                .setDescription(message)
                .setAuthor({ name: character.name })
                .addFields(
                    {
                        name: 'Source',
                        value: source,
                        inline: true
                    }
                )
                .setTimestamp();
            audit_channel.send({ embeds: [embed] });
        }
    } else {
        let settingvalue = await connection.promise().query('select * from game_settings where guild_id = ? and setting_name = ?', [guildId, 'audit_channel']);
        if (settingvalue[0].length > 0) {
            let audit_channel = await client.channels.cache.get(settingvalue[0][0].setting_value);
            let embed = new EmbedBuilder()
                .setTitle('Effect NOT processed!')
                .setDescription(`**PREREQ NOT MET**: ${message}`)
                .setAuthor({ name: character.name })
                .addFields(
                    {
                        name: 'Source',
                        value: source,
                        inline: true
                    }
                )
                .setTimestamp();
            audit_channel.send({ embeds: [embed] });
        }
    }
}

//PRE-PROCESSING FUNCTIONS

async function isPlayer(userid, guildid) {
    let player_exists = await connection.promise().query('select * from players where user_id = ?', [userid, guildid]);
    if (player_exists[0].length > 0) {
        return true;
    }
    return false;
}



client.on('ready', async () => {

    /* COMMAND STRUCTURE */

    let allowmovement = new SlashCommandBuilder().setName('allowmovement')
        .setDescription('Lock or unlock movement to/from locations globally or from a single location.')
        .addBooleanOption(option =>
            option.setName('enabled')
                .setDescription('Enabled or disabled.')
                .setRequired(true)
        ).addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel you wish to lock or unlock')
        ).setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    let player = new SlashCommandBuilder().setName('player')
        .setDescription('Player management.')
        .addSubcommand(subcommand =>
            subcommand.setName('create')
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
                        .setDescription('Create a character? If false, be sure to assign this player a character using /character assign.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('notifchannel')
                .setDescription('Specify notification channel.')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('The channel to assign')
                        .setRequired(true))
                .addUserOption(option =>
                    option.setName('player')
                        .setDescription('The player to set this for')
                        .setRequired(true)))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    let addlocation = new SlashCommandBuilder().setName('addlocation')
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

    let locationannouncements = new SlashCommandBuilder().setName('locationannouncements')
        .setDescription('Enable an announcements channel for a location.')
        .addChannelOption(option =>
            option.setName('location_channel')
                .setDescription('The location channel.')
                .setRequired(true)
        ).addChannelOption(option =>
            option.setName('announcements_channel')
                .setDescription('The announcements channel. Leave unset to remove. Can be set to location channel.')
        ).setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    let locationvisibility = new SlashCommandBuilder().setName('locationvisibility')
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

    let locationglobalwrite = new SlashCommandBuilder().setName('locationglobalwrite')
        .setDescription('Enable or disable the ability to send messages when not in a location ("global write" mode)')
        .addChannelOption(option =>
            option.setName('location')
                .setDescription('Channel to designate as "writable when not present / global write". New locations default to OFF.')
                .setRequired(true)
        ).addBooleanOption(option =>
            option.setName('enabled')
                .setDescription('Simple true/false toggle')
                .setRequired(true)
        ).setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    let resetlocationvis = new SlashCommandBuilder().setName('resetlocationvis')
        .setDescription('Re-run location visibility permissions for all locations for all players.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    let restrictmovement = new SlashCommandBuilder().setName('restrictmovement')
        .setDescription('Sets a global movement restriction for all players.')
        .addStringOption(option =>
            option.setName('restriction_type')
                .setDescription('either "disabled", "enabled", or "player_whitelists"')
                .setRequired(true)
        ).setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    let archetype = new SlashCommandBuilder().setName('archetype')
        .setDescription('Archetype administration.')
        .addSubcommand(subcommand =>
            subcommand.setName('add')
                .setDescription('Add a character-assignable archetype (think "class"). Characters can have multiple archetypes.')
                .addStringOption(option =>
                    option.setName('archetype')
                        .setDescription('The name of the archetype')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('description')
                        .setDescription('The archetype description.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('assign')
                .setDescription('Assign an archetype to a character or characters.'))
        .addSubcommand(subcommand =>
            subcommand.setName('unassign')
                .setDescription('Unassign an archetype from a character.'))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    let stat = new SlashCommandBuilder().setName('stat')
        .setDescription('Stat administration.')
        .addSubcommand(subcommand =>
            subcommand.setName('add')
                .setDescription('Add a stat for all characters for view in character sheet.')
                .addStringOption(option =>
                    option.setName('stat')
                        .setDescription('The name of the stat (e.g., Strength, Intelligence, HP)')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('defaultvalue')
                        .setDescription('The default value of the stat')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('set')
                .setDescription('Set a stat for a character.')
                .addIntegerOption(option =>
                    option.setName('value')
                        .setDescription('The value to which the stat will be set.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('adjust')
                .setDescription('Adjust a stat for a character.')
                .addIntegerOption(option =>
                    option.setName('value')
                        .setDescription('The value by which the stat will be adjusted.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('charactersummary')
                .setDescription('List character levels on a given stat.')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('The stat for which to list values. (autocompletes)')
                        .setRequired(true)))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);


    let addarchetypestat = new SlashCommandBuilder().setName('addarchetypestat')
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

    let skilladmin = new SlashCommandBuilder().setName('skilladmin')
        .setDescription('Add a character/archetype-assignable skill for view in character sheet.')
        .addSubcommand(subcommand =>
            subcommand.setName('add')
                .setDescription('Add a character/archetype-assignable skill for view in character sheet.')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('The name of the skill (e.g. Vorpal Slash, 1000 Needles, Gigaton Hammer)')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('description')
                        .setDescription('The description or flavor text of the skill.')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('The type of skill')
                        .setRequired(true)
                        .addChoices(
                            { name: 'combat', value: 'combat' },
                            { name: 'noncombat', value: 'noncombat' },
                            { name: 'innate', value: 'innate' },
                            { name: 'profession', value: 'profession' }))
                .addBooleanOption(option =>
                    option.setName('other_targetable')
                        .setDescription('Whether skill can be used to target other characters (has effects)')
                        .setRequired(true))
                .addBooleanOption(option =>
                    option.setName('self_targetable')
                        .setDescription('Whether skill can be used on the casting character.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('assign')
                .setDescription('Assign a skill to a character or archetype')
                .addBooleanOption(option =>
                    option.setName('to_character')
                        .setDescription('Set to true if you\'re assigning to a character, false if assigning to an archetype.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('unassign')
                .setDescription('Unassign a skill from a character or archetype')
                .addBooleanOption(option =>
                    option.setName('to_character')
                        .setDescription('Set to true if you\'re unassigning from a character, false if from an archetype.')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('skill_name')
                        .setDescription('Optional typeahead for the skill name, if you know it.')))
        .addSubcommand(subcommand =>
            subcommand.setName('edit')
                .setDescription('Edit a text field on a skill.')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('The name of the skill (partial okay)')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('vieweffects')
                .setDescription('View effects on a skill.')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('The name of the skill.')
                        .setRequired(true)))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);


    let itemadmin = new SlashCommandBuilder().setName('itemadmin')
        .setDescription('Item administration tools.')
        .addSubcommand(subcommand =>
            subcommand.setName('add')
                .setDescription('Add an item for display on character sheet.')
                .addStringOption(option =>
                    option.setName('itemname')
                        .setDescription('The name of the item')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('description')
                        .setDescription('What this item is.')
                        .setRequired(true))
                .addBooleanOption(option =>
                    option.setName('other_targetable')
                        .setDescription('Whether item can be used to target other characters (has effects)')
                        .setRequired(true))
                .addBooleanOption(option =>
                    option.setName('self_targetable')
                        .setDescription('Whether item can be used on the casting character.')
                        .setRequired(true))
                .addBooleanOption(option =>
                    option.setName('consumable')
                        .setDescription('Whether item is consumed on use.')
                        .setRequired(true))
                .addBooleanOption(option =>
                    option.setName('equippable')
                        .setDescription('Wehther the item is equippable.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('assign')
                .setDescription('Assign an item to a character')
                .addIntegerOption(option =>
                    option.setName('quantity')
                        .setDescription('The quantity of item you want to assign')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('transfer')
                .setDescription('Transfer a item from a character to another character')
                .addIntegerOption(option =>
                    option.setName('quantity')
                        .setDescription('The quantity of the item to transfer')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('vieweffects')
                .setDescription('View effects on an item.')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('The name of the item.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('edit')
                .setDescription('Edit a text field on an item.')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('The name of the item (partial okay)')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('slotadd')
                .setDescription('Add an equipment slot.')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('The name of the equipment slot.')
                        .setRequired(true)))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    let setarchetypestat = new SlashCommandBuilder().setName('setarchetypestat')
        .setDescription('Set an archetype stat for a character.')
        .addIntegerOption(option =>
            option.setName('value')
                .setDescription('The value to which the archetype stat will be set.')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    let modsheet = new SlashCommandBuilder().setName('modsheet')
        .setDescription('Show a character sheet.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    let assignspecialstat = new SlashCommandBuilder().setName('assignspecialstat')
        .setDescription('Assign a stat to a special function.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
    // movement, health, etc.

    let quest = new SlashCommandBuilder().setName('quest')
        .setDescription('Quest management.')
        .addSubcommand(subcommand =>
            subcommand.setName('add')
                .setDescription('NYI: Add a quest for display on character sheet.'))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    let whispercategory = new SlashCommandBuilder().setName('whispercategory')
        .setDescription('Set a category for whisper creation.')
        .addChannelOption(option =>
            option.setName('category')
                .setDescription('The whisper category: players shouldn\'t be able to view by default')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    let whisper = new SlashCommandBuilder().setName('whisper')
        .setDescription('Whisper management.')
        .addSubcommand(subcommand =>
            subcommand.setName('add')
                .setDescription('Add a whisper.')
                .addIntegerOption(option =>
                    option.setName('duration')
                        .setDescription('How long, in hours, the whisper should last.')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('What the whisper should be named.')))
        .addSubcommand(subcommand =>
            subcommand.setName('populate')
                .setDescription('Add a character to a whisper.')
                .addChannelOption(option =>
                    option.setName('whisperchannel')
                        .setDescription('The channel where the whisper is assigned.')
                        .setRequired(true))
                .addBooleanOption(option =>
                    option.setName('ping')
                        .setDescription('Whether to ping this character\'s players.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('close')
                .setDescription('Close the whisper in the current channel.'))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);


    let characterflag = new SlashCommandBuilder().setName('characterflag')
        .setDescription('Character flag management.')
        .addSubcommand(subcommand =>
            subcommand.setName('add')
                .setDescription('Add a character flag.')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('A searchable name for this flag.')
                        .setRequired(true)))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    let worldflag = new SlashCommandBuilder().setName('worldflag')
        .setDescription('World flag management.')
        .addSubcommand(subcommand =>
            subcommand.setName('add')
                .setDescription('Add a world flag with starting value 0.')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('A searchable name for this flag.')
                        .setRequired(true))
                .addBooleanOption(option =>
                    option.setName('visible')
                        .setDescription('Visibility on player sheets (default false)')))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    let reputation = new SlashCommandBuilder().setName('reputation')
        .setDescription('Reputation management tools')
        .addSubcommand(subcommand =>
            subcommand.setName('enable')
                .setDescription('Enable the reputation system (default OFF)')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('True to enable the reputation system.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('add')
                .setDescription('Add a reputation')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('The name of the reputation')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('description')
                        .setDescription('A short description of the reputation')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('visibility')
                        .setDescription('If this reputation should be visible to players before encountering') // Or should this be set by archetype and character?
                        .setRequired(true)
                        .addChoices(
                            { name: 'Always On', value: 'always' },
                            { name: 'Character Flag', value: 'cflag' },
                            { name: 'World Flag', value: 'wflag' },
                            { name: 'Never', value: 'never' }
                        ))
                .addIntegerOption(option =>
                    option.setName('maximum')
                        .setDescription('Maximum reputation value for this reputation.')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('icon')
                        .setDescription('(optional) A faction icon\'s emoji ID')))
        .addSubcommand(subcommand =>
            subcommand.setName('tieradd')
                .setDescription('Add a tier to a reputation.')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('The name of the reputation tier (Neutral, Exalted, etc.)')
                        .setRequired(true))
                .addIntegerOption(option =>
                    option.setName('value')
                        .setDescription('The threshold minimum for this reputation tier.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('vieweffects')
                .setDescription('List effects on a given reputation tier.')
                .addStringOption(option =>
                    option.setName('reputation')
                        .setDescription('The reputation which contains the tier. (autocompletes)')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('charactersummary')
                .setDescription('List character standings on a given reputation.')
                .addStringOption(option =>
                    option.setName('reputation_name')
                        .setDescription('The reputation for which to list standings. (autocompletes)')
                        .setRequired(true)))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    let effect = new SlashCommandBuilder().setName('effect')
        .setDescription('Commands to manage effects.')
        .addSubcommand(subcommand =>
            subcommand.setName('add')
                .setDescription('Add an effect.')
                .addStringOption(option =>
                    option.setName('type')
                        .setDescription('The type of effect.')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Skill', value: 'skill' },
                            { name: 'Item', value: 'item' },
                            { name: 'Reputation Tier', value: 'reputationtier' }
                        ))
                .addStringOption(option =>
                    option.setName('typeahead')
                        .setDescription('Name of the skill/item/reputation to attach to. Partial ok.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('addprereq')
                .setDescription('Add a prerequisite to an effect')) // Prompt for what type of reward it is - quest, reputation tier, dialog, skill, etc
        .addSubcommand(subcommand =>
            subcommand.setName('listprereqs')
                .setDescription('List prerequisites for an effect'))
        .addSubcommand(subcommand =>
            subcommand.setName('remove')
                .setDescription('Remove an effect.'))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);
    //Prompt for archetype/character, reputation, tier, item/skill/reputation/archetype/pflag/qflag/message, prompt for whatever's chosen - should have quantity of reward available (-1 for unlimited) if archetype
    let sendas = new SlashCommandBuilder().setName('sendas')
        .setDescription('Send message as a character.')
        .addStringOption(option =>
            option.setName('message')
                .setDescription('The message you wish to send.')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('character')
                .setDescription('The character you wish to send as (optional, autocompletes)'))
        .addAttachmentOption(option =>
            option.setName('attachment')
                .setDescription('Optional image to attach to the message.')
        )

    let character = new SlashCommandBuilder().setName('character')
        .setDescription('Character admin.')
        .addSubcommand(subcommand =>
            subcommand.setName('unassign')
                .setDescription('Unassign a character from a player.')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user with an active player entry.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('assign')
                .setDescription('Assign a character or characters to a player.')
                .addUserOption(option =>
                    option.setName('user')
                        .setDescription('The user with an active player entry.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('create')
                .setDescription('Create a new character.')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('The character name.')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('description')
                        .setDescription('The character description.')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('avatar_url')
                        .setDescription('The URL to the character avatar, must be accessible by the bot')))
        .addSubcommand(subcommand =>
            subcommand.setName('avatar')
                .setDescription('Set a character avatar URL.')
                .addStringOption(option =>
                    option.setName('avatar_url')
                        .setDescription('The URL to the character avatar, must be accessible by the bot')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('move')
                .setDescription('Move a character to a specific location.'))
        .addSubcommand(subcommand =>
            subcommand.setName('edit')
                .setDescription('Edit a text field on an character.')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('The name of the character (partial okay)')
                        .setRequired(true)))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    // Characters Per Player (switching system // bot echoes) - TODO
    // For now, playercreate should create a default character automatically in a separate table with the specified player_name.


    let rps = new SlashCommandBuilder().setName('rps')
        .setDescription('Enter battle, either against another player or versus the robot.')
        .addUserOption(option =>
            option.setName('challengee')
                .setDescription('The player you wish to challenge (optional)')
        );

    let rpsmulti = new SlashCommandBuilder().setName('rpsmulti')
        .setDescription('Enter a multiplayer RPS battle, with you as the opponent.');

    let move = new SlashCommandBuilder().setName('move')
        .setDescription('Move to a new location.');

    let sheet = new SlashCommandBuilder().setName('sheet')
        .setDescription('Show your character sheet.');

    let skill = new SlashCommandBuilder().setName('skill')
        .setDescription('Activities to perform with skills.')
        .addSubcommand(subcommand =>
            subcommand.setName('display')
                .setDescription('Posts a skill in the current chat channel.'))
        .addSubcommand(subcommand =>
            subcommand.setName('use')
                .setDescription('Use a targetable skill.'));

    let item = new SlashCommandBuilder().setName('item')
        .setDescription('Item commands for players.')
        .addSubcommand(subcommand =>
            subcommand.setName('display')
                .setDescription('Posts an item in the current chat channel.'))
        .addSubcommand(subcommand =>
            subcommand.setName('give')
                .setDescription('Gives an item to another character.')
                .addIntegerOption(option =>
                    option.setName('quantity')
                        .setDescription('The quantity of item you are giving.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('use')
                .setDescription('Use an item.'));

    let duel = new SlashCommandBuilder().setName('duel')
        .setDescription('Duels another player.')
        .addUserOption(option =>
            option.setName('target')
                .setDescription('The player you wish to challenge.')
                .setRequired(true));
    let active = new SlashCommandBuilder().setName('active')
        .setDescription('Changes your active character.');

    let deck = new SlashCommandBuilder().setName('deck')
        .setDescription('Displays your Tiles deck.');

    let roll = new SlashCommandBuilder().setName('roll')
        .setDescription('Roll a set of dice.')
        .addIntegerOption(option =>
            option.setName('dice')
                .setDescription('The number of dice to roll.')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('sides')
                .setDescription('The number of sides per die.')
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('public')
                .setDescription('Whether or not the roll shoudl be shown publicly.')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('fixed_add')
                .setDescription('Additional +/- modifier to your roll (optional).'));

    let auditchannel = new SlashCommandBuilder().setName('auditchannel')
        .setDescription('Where the audit messages / notifications for opening and closing tickets will be.')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('Channel where you want audit messages')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);


    let ticket = new SlashCommandBuilder().setName('ticket')
        .setDescription('Ticket management')
        .addSubcommand(subcommand =>
            subcommand.setName('categorygroup') //setcategorygroup
                .setDescription('Set a role to be notified when a ticket opens in a category')
        )
        .addSubcommand(subcommand =>
            subcommand.setName('channel') //ticketchannel
                .setDescription('Where the dropdown for opening tickets will live')
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel where you want the dropdown')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('addcategory') //addticketcategory
                .setDescription('Add a ticket category to the dropdown menu.')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('Name of category.')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('close') //closeticket
                .setDescription('Closes the current ticket thread.')
                .addStringOption(option =>
                    option.setName('reason')
                        .setDescription('Quick summary of ticket closure notes')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('removecategory')
                .setDescription('Removes a ticket category (nyi)'))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);


    let locationawareness = new SlashCommandBuilder().setName('locationawareness')
        .setDescription('Location awareness for individual systems. Defaults to ENABLED.')
        .addSubcommand(subcommand =>
            subcommand.setName('trading')
                .setDescription('Sets the location requirement for item transfers between characters.')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('True/false')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('skilltarget')
                .setDescription('Sets the location requirement for skill targeting.')
                .addBooleanOption(option =>
                    option.setName('enabled')
                        .setDescription('true/false')
                        .setRequired(true)))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

    await client.application.commands.set([
        character.toJSON(),
        allowmovement.toJSON(),
        locationannouncements.toJSON(),
        addlocation.toJSON(),
        locationvisibility.toJSON(),
        locationglobalwrite.toJSON(),
        resetlocationvis.toJSON(),
        restrictmovement.toJSON(),
        player.toJSON(),
        rps.toJSON(),
        move.toJSON(),
        sheet.toJSON(),
        archetype.toJSON(),
        stat.toJSON(),
        addarchetypestat.toJSON(),
        skilladmin.toJSON(),
        itemadmin.toJSON(),
        setarchetypestat.toJSON(),
        skill.toJSON(),
        item.toJSON(),
        modsheet.toJSON(),
        duel.toJSON(),
        assignspecialstat.toJSON(),
        deck.toJSON(),
        rpsmulti.toJSON(),
        active.toJSON(),
        whispercategory.toJSON(),
        whisper.toJSON(),
        auditchannel.toJSON(),
        ticket.toJSON(),
        sendas.toJSON(),
        roll.toJSON(),
        locationawareness.toJSON(),
        reputation.toJSON(),
        effect.toJSON(),
        characterflag.toJSON(),
        worldflag.toJSON()
    ]);
    client.user.setActivity("Reality Roleplaying Games");
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
        if (interaction.commandName === 'addlocation') {
            let thisChannel = interaction.options.getChannel('channel');
            let channelexists = await connection.promise().query('select * from movement_locations where guild_id = ? and channel_id = ?', [interaction.guildId, thisChannel.id]);
            if (channelexists[0].length > 0) {
                interaction.reply({ content: 'Looks like this channel is already set up as a location. :revolving_hearts:', ephemeral: true });
            } else {
                await connection.promise().query('insert into movement_locations (channel_id, guild_id, movement_allowed, global_read, friendly_name) values (?, ?, ?, ?, ?)', [thisChannel.id, interaction.guildId, 1, 0, interaction.options.getString('friendly_name')]);
                interaction.reply({ content: 'Location added; please use `/locationannouncements` to set the announcements channel for this location.', ephemeral: true });
            }

        } else if (interaction.commandName === 'locationannouncements') {
            // Channel 1 must be a location, channel 2 can be any channel not a category. This is where the movement announcements will happen for that location. If channel 2 is unset then unset it in DB.
            let thisChannel = interaction.options.getChannel('location_channel');
            let channelexists = await connection.promise().query('select * from movement_locations where guild_id = ? and channel_id = ?', [interaction.guildId, thisChannel.id]);
            if (channelexists[0].length > 0) {
                if (interaction.options.getChannel('announcements_channel')) {
                    let announcements_channel = interaction.options.getChannel('announcements_channel');
                    await connection.promise().query('update movement_locations set announcements_channel = ? where channel_id = ?', [announcements_channel.id, thisChannel.id]);
                    interaction.reply({ content: 'Should be all set! (changed announcements channel value of ' + thisChannel.toString() + ' to ' + announcements_channel.toString() + ')', ephemeral: true });
                } else {
                    await connection.promise().query('update movement_locations set announcements_channel = NULL where channel_id = ?', [thisChannel.id]);
                    interaction.reply({ content: 'Should be all set! (removed announcements for ' + thisChannel.toString() + ')', ephemeral: true });
                }
            } else {
                interaction.reply({ content: 'Looks like this channel isn\'t a valid location. Try adding it via `/addlocation`. :revolving_hearts:', ephemeral: true });
            }
        } else if (interaction.commandName === 'allowmovement') {
            if (interaction.options.getChannel('channel')) {
                let thisChannel = interaction.options.getChannel('channel');
                let channelexists = await connection.promise().query('select * from movement_locations where guild_id = ? and channel_id = ?', [interaction.guildId, thisChannel.id]);
                if (channelexists[0].length > 0) {
                    let enabled = interaction.options.getBoolean('enabled');
                    await connection.promise().query('update movement_locations set movement_allowed = ? where channel_id = ?', [enabled, thisChannel.id]);
                    interaction.reply({ content: 'Should be all set! (changed movement allowed value of ' + thisChannel.toString() + ' to ' + enabled + ')', ephemeral: true });
                } else {
                    interaction.reply({ content: 'Looks like this channel isn\'t a valid location. Try adding it via `/addlocation`. :revolving_hearts:', ephemeral: true });
                }
            } else {
                let enabled = interaction.options.getBoolean('enabled');
                await connection.promise().query('update movement_locations set movement_allowed = ? where guild_id = ? ', [enabled, interaction.guildId]);
                interaction.reply({ content: 'Should be all set! (changed movement allowed value of ALL locations to ' + enabled + ')', ephemeral: true });
            }
        } else if (interaction.commandName === 'restrictmovement') {
            let setting_value = interaction.options.getString('restriction_type');
            if (setting_value == 'disabled' || setting_value == 'enabled' || setting_value == 'player_whitelist') {
                await connection.promise().query('replace into game_settings (setting_name, setting_value, guild_id) values (?, ?, ?)', ['restrictmovement', setting_value, interaction.guildId]);
                interaction.reply({ content: "Movement restriction set.", ephemeral: true });
            } else {
                interaction.reply({ content: 'Please select a valid movement restriction type.', ephemeral: true });
            }
            //add to whitelist
        } else if (interaction.commandName === 'locationawareness') {
            if (interaction.options.getSubcommand() === 'trading') {
                let setting_value = interaction.options.getBoolean('enabled');
                await connection.promise().query('replace into game_settings (setting_name, setting_value, guild_id) values (?, ?, ?)', ['locationawaretrading', (setting_value ? 1 : 0), interaction.guildId]);
                interaction.reply({ content: 'Location aware trading set.', ephemeral: true });
            } else if (interaction.options.getSubcommand() === 'skilltarget') {
                let setting_value = interaction.options.getBoolean('enabled');
                await connection.promise().query('replace into game_settings (setting_name, setting_value, guild_id) values (?, ?, ?)', ['locationawareskills', (setting_value ? 1 : 0), interaction.guildId]);
                interaction.reply({ content: 'Location aware skills set.', ephemeral: true });
            }
        } else if (interaction.commandName === 'addlocationwhitelist') {
            let characters = await connection.promise().query('select * from characters c where guild_id = ?', [interaction.guildId]);
            if (characters[0].length > 0) {

            } else {
                interaction.reply({ content: 'No valid characters were found in this server.', ephemeral: true });
            }

        } else if (interaction.commandName === 'removelocationwhitelist') {
            let characters = await connection.promise().query('select * from characters c where guild_id = ?', [interaction.guildId]);
            if (characters[0].length > 0) {

            } else {
                interaction.reply({ content: 'No valid characters were found in this server.', ephemeral: true });
            }

        } else if (interaction.commandName === 'resetlocationvis') {
            let locations = await connection.promise().query('select * from movement_locations where guild_id = ?', [interaction.guildId]);
            let players = await connection.promise().query('select p.user_id, c.location_id from players p join players_characters pc on p.id = pc.player_id join characters c on c.id = pc.character_id where pc.active = 1');
            if (locations[0].length > 0) {
                interaction.deferUpdate();
                for (const thisLocation of locations[0]) {
                    let channel = await client.channels.cache.get(thisLocation.channel_id);
                    if (thisLocation.global_read == true) {
                        for (const thisPlayer of players[0]) {
                            console.log(thisPlayer);
                            let user = await client.users.fetch(thisPlayer.user_id);
                            await channel.permissionOverwrites.edit(user, { ViewChannel: true });
                            if (thisPlayer.location_id == thisLocation.id || thisLocation.global_write == true) {
                                await channel.permissionOverwrites.edit(user, { SendMessages: true });
                            } else {
                                await channel.permissionOverwrites.edit(user, { SendMessages: false });
                            }
                        }
                    } else {
                        for (const thisPlayer of players[0]) {
                            console.log(thisPlayer);
                            let user = await client.users.fetch(thisPlayer.user_id);
                            if (thisPlayer.location_id == thisLocation.id) {
                                await channel.permissionOverwrites.edit(user, { ViewChannel: true, SendMessages: true });
                            } else {
                                await channel.permissionOverwrites.edit(user, { ViewChannel: false, SendMessages: false });
                            }
                        }
                    }
                }
                interaction.reply({ content: 'Reset done.', ephemeral: true });
            }
        } else if (interaction.commandName === 'locationvisibility') {
            let thisChannel = await interaction.options.getChannel('location');
            let channelexists = await connection.promise().query('select * from movement_locations where guild_id = ? and channel_id = ?', [interaction.guildId, thisChannel.id]);
            if (channelexists[0].length > 0) {
                let enabled = interaction.options.getBoolean('enabled');
                await connection.promise().query('update movement_locations set global_read = ? where channel_id = ?', [enabled, thisChannel.id]);
                interaction.reply({ content: 'Should be all set! (changed global read value of ' + thisChannel.toString() + ' to ' + enabled + ')', ephemeral: true });
            } else {
                interaction.reply({ content: 'Looks like this channel isn\'t a valid location. Try adding it via `/addlocation`. :revolving_hearts:', ephemeral: true });
            }
        } else if (interaction.commandName === 'locationglobalwrite') {
            let thisChannel = await interaction.options.getChannel('location');
            let channelexists = await connection.promise().query('select * from movement_locations where guild_id = ? and channel_id = ?', [interaction.guildId, thisChannel.id]);
            if (channelexists[0].length > 0) {
                let enabled = interaction.options.getBoolean('enabled');
                await connection.promise().query('update movement_locations set global_write = ? where channel_id = ?', [enabled, thisChannel.id]);
                interaction.reply({ content: 'Should be all set! (changed global write value of ' + thisChannel.toString() + ' to ' + enabled + ')', ephemeral: true });
            } else {
                interaction.reply({ content: 'Looks like this channel isn\'t a valid location. Try adding it via `/addlocation`. :revolving_hearts:', ephemeral: true });
            }
        } else if (interaction.commandName === 'whispercategory') {
            let channel = interaction.options.getChannel('category');
            if (channel.type === ChannelType.GuildCategory) {
                await connection.promise().query('replace into game_settings (setting_name, setting_value, guild_id) values (?, ?, ?)', ['whisper_category', channel.id, interaction.guildId]);
                interaction.reply({ content: "Set the whisper category for this game.", ephemeral: true });
            } else {
                interaction.reply({ content: 'please make sure you selected a category and not a channel', ephemeral: true });
            }

        } else if (interaction.commandName === 'whisper') {
            if (interaction.options.getSubcommand() === 'add') {
                let whisper_category = await connection.promise().query('select setting_value from game_settings where guild_id = ? and setting_name = ?', [interaction.guildId, 'whisper_category']);
                if (whisper_category[0].length > 0) {
                    let timest = Math.floor(Date.now() / 1000);
                    let name = timest;
                    if (interaction.options.getString('name')) {
                        name = interaction.options.getString('name');
                    }

                    let whisper_channel = await interaction.guild.channels.create({
                        name: `whisper-${name}`,
                        type: ChannelType.GuildText,
                        parent: whisper_category[0][0].setting_value
                    });
                    whisper_channel.send('Whisper created! Expires <t:' + (interaction.options.getInteger('duration') * 3600 + timest) + ':R>');
                    await connection.promise().query('insert into whispers (guild_id, channel_id, expiration) values (?, ?, ?)', [interaction.guildId, whisper_channel.id, timest + (interaction.options.getInteger('duration') * 3600)]);
                    interaction.reply({ content: `Whisper created: ${whisper_channel}. Add characters using \`/populatewhisper\`.`, ephemeral: true });
                } else {
                    interaction.reply({ content: "Create a whisper category first using `/whispercategory`.", ephemeral: true });
                }
            } else if (interaction.options.getSubcommand() === 'close') {
                let whisper_data = await connection.promise().query('select * from whispers where channel_id = ?', [interaction.channel.id]);
                if (whisper_data[0].length > 0) {
                    await interaction.reply('Whisper closed!');
                    let thisWhisper = whisper_data[0][0];
                    //await channel.lockPermissions(); // Sync permissions with category
                    let users = await connection.promise().query('select p.user_id from whispers_characters wc join players_characters pc on wc.character_id = pc.character_id join players p on pc.player_id = p.id where whisper_id = ?', [thisWhisper.id]);
                    let characters = await connection.promise().query('select distinct c.name from whispers_characters wc join characters c on wc.character_id = c.id where whisper_id = ?', [thisWhisper.id]);
                    if (users[0].length > 0) {
                        for (const thisUser of users[0]) {
                            let user = await client.users.fetch(thisUser.user_id);
                            interaction.channel.permissionOverwrites.edit(user, { SendMessages: false });
                        }
                    }
                    await connection.promise().query('update whispers set locked = 1 where channel_id = ?', thisWhisper.channel_id);
                    let settingvalue = await connection.promise().query('select * from game_settings where guild_id = ? and setting_name = ?', [interaction.guildId, 'audit_channel']);
                    if (settingvalue[0].length > 0) {
                        let audit_channel = await client.channels.cache.get(settingvalue[0][0].setting_value);
                        let embed = new EmbedBuilder()
                            .setTitle('Whisper closed!')
                            .setDescription('MANUAL close notification for whisper ID ' + thisWhisper.id)
                            .addFields(
                                {
                                    name: 'Channel link',
                                    value: interaction.channel.toString(),
                                    inline: true
                                },
                                {
                                    name: 'Whisper members',
                                    value: (characters[0].length > 0 ? characters[0].map(a => a.name).join('\n') : '*none*'),
                                    inline: true
                                },
                                {
                                    name: 'Closing user',
                                    value: interaction.member.displayName,
                                    inline: true
                                }
                            )
                            .setTimestamp();
                        audit_channel.send({ embeds: [embed] });
                    }

                } else {
                    interaction.reply({ content: 'This channel isn\'t a whisper.', ephemeral: true });
                }
            } else if (interaction.options.getSubcommand() === 'populate') {
                let channel = interaction.options.getChannel('whisperchannel');
                let whisper = await connection.promise().query('select * from whispers where channel_id = ?', [channel.id]);
                if (whisper[0].length > 0) {
                    let existing_whisper_characters = await connection.promise().query('select * from whispers_characters where whisper_id = ?', [whisper[0][0].id]);
                    let characters;
                    if (existing_whisper_characters[0].length > 0) {
                        let character_ids = [];
                        for (const thisCharacter of existing_whisper_characters[0]) {
                            character_ids.push(thisCharacter.character_id);
                        }
                        console.log(character_ids);
                        characters = await connection.promise().query('select * from characters where guild_id = ? and id not in (?)', [interaction.guildId, character_ids.join(',')]);
                    } else {
                        characters = await connection.promise().query('select * from characters where guild_id = ?', [interaction.guildId]);
                    }
                    if (characters[0].length > 0) {
                        let characterSelectComponent;
                        if (characters[0].length <= 25) {
                            let charactersKeyValues = [];
                            for (const character of characters[0]) {
                                charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                            }
                            characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('WhisperPopCharacterSelector').setMinValues(1).setMaxValues(1);
                        } else {
                            let characters = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                            let charactersKeyValues = [];
                            for (const character of characters) {
                                charactersKeyValues.push({ label: character, value: character });
                            }
                            characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('WhisperPopAlphabetSelector').setMinValues(1).setMaxValues(1);
                        }
                        let characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                        let message = await interaction.reply({ content: 'Please select a character to add:', components: [characterSelectRow], ephemeral: true });
                        let collector = message.createMessageComponentCollector();
                        collector.on('collect', async (interaction_second) => {
                            if (interaction_second.member.id === interaction.member.id) {
                                let characterSelected = interaction_second.values[0];
                                if (interaction_second.customId === 'WhisperPopAlphabetSelector') {
                                    let characters = await connection.promise().query('select * from characters where guild_id = ? and upper(name) like ?', [interaction.guildId, characterSelected + '%']);
                                    if (characters[0].length > 0) {
                                        let charactersKeyValues = [];
                                        for (const character of characters[0]) {
                                            charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                                        }
                                        let characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('WhisperPopCharacterSelector').setMinValues(1).setMaxValues(1);
                                        let characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                                        interaction.update({ components: [characterSelectRow] });
                                    } else {
                                        interaction.update({ content: 'No characters with this first letter', components: [] });
                                    }
                                } else {
                                    let character_information = await connection.promise().query('select * from characters where id = ?', [characterSelected]);
                                    let players = await connection.promise().query('select pc.*, p.user_id from players_characters pc join players p on pc.player_id = p.id where pc.character_id = ?', [characterSelected]);
                                    let names = '';
                                    for (const player of players[0]) {
                                        let user = await client.users.fetch(player.user_id);
                                        names += user.toString();
                                        if (whisper.locked == 1) {
                                            channel.permissionOverwrites.create(user, { ViewChannel: true });
                                        } else {
                                            channel.permissionOverwrites.create(user, { ViewChannel: true, SendMessages: true });
                                        }
                                    }
                                    channel.send(`${character_information[0][0].name} has joined the whisper!${(interaction.options.getBoolean('ping') ? ' (' + names + ')' : '')}`);
                                    await connection.promise().query('insert into whispers_characters (whisper_id, character_id) values (?, ?)', [whisper[0][0].id, characterSelected]);
                                    interaction.editReply({ content: 'Character added to whisper.', components: [] });
                                    await collector.stop();
                                }
                            }
                        });
                    } else {
                        await interaction.reply({ content: 'There don\'t seem to be any characters, have you made any?', ephemeral: true });
                    }
                } else {
                    await interaction.reply({ content: 'This channel doesn\'t seem to be a registered whisper.', ephemeral: true });
                }
            }
        } else if (interaction.commandName === 'populatewhisper') {
        } else if (interaction.commandName === 'player') {
            if (interaction.options.getSubcommand() === 'notifchannel') {
                let channel = interaction.options.getChannel('channel');
                let user = interaction.options.getUser('player');
                let player = await connection.promise().query('select * from players where guild_id = ? and user_id = ?', [interaction.guildId, user.id]);
                if (player[0].length == 1) {
                    await connection.promise().query('update players set notification_channel = ? where guild_id = ? and user_id = ?', [channel.id, interaction.guildId, user.id]);
                    interaction.reply({ content: 'Notification channel set.', ephemeral: true })
                } else {
                    interaction.reply({ content: 'Please make sure you\'re tagging a player in this game. If you need to, set them up with `/player create` first.', ephemeral: true });
                }
            } else if (interaction.options.getSubcommand() === 'create') {
                let user = interaction.options.getUser('user');
                let playerName = interaction.options.getString('player_name');
                let playerexists = await connection.promise().query('select * from players where user_id = ? and guild_id = ?', [user.id, interaction.guildId]); // Not using member id because it's a pain to get, and this way we could eventually let users look at all their characters in a web view maybe
                if (playerexists[0].length > 0) {
                    interaction.reply({ content: 'A player entry for this user/server combo already exists! Sorry about that. :purple_heart:', ephemeral: true })
                } else {
                    let inserted_player = await connection.promise().query('insert into players (user_id, guild_id, name) values (?, ?, ?)', [user.id, interaction.guildId, playerName]);
                    if (interaction.options.getBoolean('create_character')) {
                        let inserted_character = await connection.promise().query('insert into characters (name, guild_id, description) values (?, ?, ?)', [playerName, interaction.guildId, '']); // This table also has "location", because all characters are in a location.
                        await connection.promise().query('insert into players_characters (player_id, character_id, active) values (?, ?, ?)', [inserted_player[0].insertId, inserted_character[0].insertId, 1]); // Futureproofing for "multiple players can own a character".
                        interaction.reply({ content: 'Added the player and character!', ephemeral: true });
                    } else {
                        interaction.reply({ content: 'Added the player!', ephemeral: true });
                    }


                }
            }
        } else if (interaction.commandName === 'character') {
            if (interaction.options.getSubcommand() === 'edit') {
                let character_name = interaction.options.getString('name');
                let character_id;
                let column_name;
                let process = true;
                let columns = await connection.promise().query('show columns from characters where Type = "text"');
                let message;
                let character = await connection.promise().query('select * from characters where name like ? and guild_id = ?', ['%' + character_name + '%', interaction.guildId]);
                if (character[0].length > 0) { // CLEAN THIS MESS UP
                    if (character[0].length == 1) {
                        let keyValues = [];
                        character_id = character[0][0].id;
                        for (const column of columns[0]) {
                            keyValues.push({ label: column.Field, value: column.Field });
                        }
                        const selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('characterEditColumnSelector' + interaction.member.id).setMinValues(1).setMaxValues(1);
                        let selectRow = new ActionRowBuilder().addComponents(selectComponent);
                        message = await interaction.reply({ content: 'Please select a property from the dropdown to edit.', components: [selectRow], ephemeral: true });

                        //show dropdown for column to edit, then show modal
                    } else if (character[0].length > 25) {
                        await interaction.reply({ content: 'Your string match returned more than 25 characters. Please try again with a more specific string match.', ephemeral: true });
                        process = false;
                    } else if (character[0].length > 1) {
                        let keyValues = [];
                        for (const thischaracter of character[0]) {
                            keyValues.push({ label: thischaracter.name, value: thischaracter.id.toString() });
                        }
                        const selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('characterEditcharacterSelector' + interaction.member.id).setMinValues(1).setMaxValues(1);
                        let selectRow = new ActionRowBuilder().addComponents(selectComponent);
                        message = await interaction.reply({ content: 'Please select an character from the dropdown to edit.', components: [selectRow], ephemeral: true });
                        //show dropdown for character, then show dropdown for column, then show modal
                    } else {
                        await interaction.reply({ content: 'Your string match didn\'t return any results, try again please', ephemeral: true });
                        process = false;
                    }
                    if (process) {
                        let collector = message.createMessageComponentCollector();
                        collector.on('collect', async (interaction_second) => {
                            if (interaction_second.customId === 'characterEditcharacterSelector' + interaction_second.member.id) {
                                character_id = interaction_second.values[0];
                                let keyValues = [];
                                character_id = character[0][0].id;
                                for (const column of columns[0]) {
                                    keyValues.push({ label: column.Field, value: column.Field });
                                }
                                const selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('characterEditColumnSelector' + interaction_second.member.id).setMinValues(1).setMaxValues(1);
                                let selectRow = new ActionRowBuilder().addComponents(selectComponent);
                                await interaction_second.update({ content: 'Please select a property from the dropdown to edit.', components: [selectRow] });
                            } else if (interaction_second.customId === 'characterEditColumnSelector' + interaction_second.member.id) {
                                column_name = interaction_second.values[0];
                                let now = Date.now();
                                let modal = new ModalBuilder()
                                    .setCustomId('characterEditModal' + now);
                                modal.setTitle(`character Update - ${column_name}`);
                                let currentValue = await connection.promise().query(`select ?? as current_value from characters where id = ?`, [column_name, character_id]);
                                let newValueInput = new TextInputBuilder()
                                    .setCustomId('newValue')
                                    .setLabel('New value for this field')
                                    .setPlaceholder(currentValue[0][0].current_value.substring(0, 100))
                                    .setStyle(TextInputStyle.Paragraph);
                                let valueActionRow = new ActionRowBuilder().addComponents(newValueInput);
                                modal.addComponents(valueActionRow);
                                await interaction_second.showModal(modal);
                                let submittedModal = await interaction_second.awaitModalSubmit({ time: 60000 });
                                if (submittedModal) {
                                    if (submittedModal.customId === ('characterEditModal' + now) && submittedModal.member.id == interaction.member.id) {
                                        const newValue = submittedModal.fields.getTextInputValue('newValue');
                                        await connection.promise().query('update characters set ?? = ? where id = ?', [column_name, newValue, character_id]);
                                        submittedModal.update({ content: 'Successfully updated this character entry.', components: [] });
                                        collector.stop();
                                    }
                                }
                            }
                        });
                    }
                } else {
                    await interaction.reply({ content: 'No characters found matching your entry. Please double check and try again.', ephemeral: true });
                }

            }
            if (interaction.options.getSubcommand() === 'unassign') {
                let user = interaction.options.getUser('user');
                let player = await connection.promise().query('select * from players where user_id = ? and guild_id = ?', [user.id, interaction.guildId]);
                if (player[0].length > 0) {
                    let owned_characters = await connection.promise().query('select distinct c.* from characters c join players_characters pc on c.id = pc.character_id join players p on pc.player_id = p.id where c.guild_id = ? and p.user_id = ?', [interaction.guildId, user.id]);
                    let owned = [];
                    if (owned_characters[0].length > 0) {
                        for (const thisCharacter of owned_characters[0]) {
                            console.log(thisCharacter);
                            owned.push({ label: thisCharacter.name, value: thisCharacter.id.toString() });
                        }
                        console.log(owned);
                        const characterSelectComponent = new StringSelectMenuBuilder().setOptions(owned).setCustomId('CharacterUnassignmentSelector').setMinValues(1).setMaxValues(owned_characters[0].length);
                        let characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                        let message = await interaction.reply({ content: 'Select a character or characters to unassign from this player:', components: [characterSelectRow], ephemeral: true });
                        const collector = message.createMessageComponentCollector({ time: 35000 });
                        collector.on('collect', async (interaction_second) => {
                            if (interaction_second.customId === 'CharacterUnassignmentSelector' && interaction_second.member.id === interaction.member.id) {
                                for (const thisId of interaction_second.values) {
                                    await connection.promise().query('delete from players_characters where player_id = ? and character_id = ?', [player[0][0].id, thisId]);
                                }
                                interaction_second.update({ content: 'Successfully updated character-player relationships.', components: [] });
                                collector.stop();
                            }
                        });
                    } else {
                        await interaction.reply({ content: 'This player doesn\'t have any owned characters.', ephemeral: true });
                    }

                } else {
                    await interaction.reply({ content: 'The user that you selected isn\'t a valid player.', ephemeral: true });
                }
            } else if (interaction.options.getSubcommand() === 'assign') {
                let user = interaction.options.getUser('user');
                let player = await connection.promise().query('select * from players where user_id = ? and guild_id = ?', [user.id, interaction.guildId]);
                if (player[0].length > 0) {
                    let owned_characters = await connection.promise().query('select distinct c.id from characters c join players_characters pc on c.id = pc.character_id join players p on pc.player_id = p.id where c.guild_id = ? and p.user_id = ?', [interaction.guildId, user.id]);
                    let owned = [];
                    let characters;
                    if (owned_characters[0].length > 0) {
                        for (const thisCharacter of owned_characters[0]) {
                            owned.push(thisCharacter.id);
                        }
                        characters = await connection.promise().query('select * from characters where guild_id = ? and id not in (?)', [interaction.guildId, owned]);
                    } else {
                        characters = await connection.promise().query('select * from characters where guild_id = ?', [interaction.guildId]);
                    }
                    if (characters[0].length > 0) {
                        let characterSelectComponent;
                        if (characters[0].length <= 25) {
                            charactersKeyValues = [];
                            for (const character of characters[0]) {
                                let thisCharacterKeyValue = { label: character.name, value: character.id.toString() };
                                charactersKeyValues.push(thisCharacterKeyValue);
                            }
                            characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('CharacterAssignmentSelector').setMinValues(1).setMaxValues(1);
                        } else {
                            let characters = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                            let charactersKeyValues = [];
                            for (const character of characters) {
                                let thisCharacterKeyValue = { label: character, value: character }
                                charactersKeyValues.push(thisCharacterKeyValue);
                            }
                            characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('CharacterAlphabetSelector').setMinValues(1).setMaxValues(1);
                        }
                        let characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                        let message = await interaction.reply({ content: 'Select a character or characters to assign to this player:', components: [characterSelectRow], ephemeral: true });
                        const collector = message.createMessageComponentCollector({ time: 35000 });
                        collector.on('collect', async (interaction_second) => {

                            if (interaction_second.customId === 'CharacterAssignmentSelector' && interaction.member.id == interaction_second.member.id) {
                                for (const thisId of interaction_second.values) {
                                    await connection.promise().query('insert into players_characters (player_id, character_id, active) values (?, ?, ?)', [player[0][0].id, thisId, 0]);
                                }
                                interaction_second.update({ content: 'Successfully updated character-player relationships.', components: [] });
                                collector.stop();
                            } else if (interaction_second.customId === 'CharacterAlphabetSelector' && interaction.member.id == interaction_second.member.id) {
                                let characters;
                                if (owned.length > 0) {
                                    characters = await connection.promise().query('select * from characters where guild_id = ? and id not in (?) and name like ?', [interaction_second.guildId, owned, interaction_second.values[0] + '%']);
                                }
                                else {
                                    characters = await connection.promise().query('select * from characters where guild_id = ? and name like ?', [interaction_second.guildId, interaction_second.values[0] + '%']);
                                }
                                let charactersKeyValues = [];
                                if (characters[0].length > 0) {
                                    for (const character of characters[0]) {
                                        let thisCharacterKeyValue = { label: character.name, value: character.id.toString() };
                                        charactersKeyValues.push(thisCharacterKeyValue);
                                    }
                                    let characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('CharacterAssignmentSelector').setMinValues(1).setMaxValues(1);
                                    let characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                                    interaction_second.update({ content: 'Select a character', components: [characterSelectRow] });
                                } else {
                                    interaction_second.update({ content: 'no characters found starting with that letter', components: [] });
                                    collector.stop();
                                }
                            }
                        });
                    } else {
                        await interaction.update('not enough cahracters.');
                    }
                } else {
                    await interaction.reply({ content: 'The user that you selected isn\'t a valid player.', ephemeral: true });
                }
            } else if (interaction.options.getSubcommand() === 'create') {
                let characterName = interaction.options.getString('name');
                let description = interaction.options.getString('description');
                let character = await connection.promise().query('select * from characters where name = ? and guild_id = ?', [characterName, interaction.guildId]);
                if (character[0].length == 0) {
                    if (interaction.options.getString('avatar_url')) {
                        await connection.promise().query('insert into characters (name, guild_id, description, avatar_url) values (?, ?, ?, ?)', [characterName, interaction.guildId, description, interaction.options.getString('avatar_url')]);
                    } else {
                        await connection.promise().query('insert into characters (name, guild_id, description) values (?, ?, ?)', [characterName, interaction.guildId, description]);
                    }
                    interaction.reply({ content: 'Created character!', ephemeral: true })
                } else {
                    interaction.reply({ content: 'A character with this name for this game already exists.', ephemeral: true });
                }
            } else if (interaction.options.getSubcommand() === 'avatar') {
                let characters;
                if (interaction.member.permissions.has('ADMINISTRATOR')) {
                    characters = await connection.promise().query('select * from characters where guild_id = ?', [interaction.guildId]);
                } else {
                    characters = await connection.promise().query('select c.* from players p join players_characters pc on p.id = pc.player_id join charactesr c on pc.character_id = c.id where p.user_id = ? and p.guild_id = ?', [interaction.user.id, interaction.guildId]);
                }
                if (characters[0].length > 0) {
                    let characterSelectComponent;
                    if (characters[0].length <= 25) {
                        let charactersKeyValues = [];
                        for (const character of characters[0]) {
                            let thisCharacterKeyValue = { label: character.name, value: character.id.toString() };
                            charactersKeyValues.push(thisCharacterKeyValue);
                        }
                        characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('CharAvCharacterSelector').setMinValues(1).setMaxValues(1);
                    } else {
                        let characters = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                        let charactersKeyValues = [];
                        for (const character of characters) {
                            let thisCharacterKeyValue = { label: character, value: character }
                            charactersKeyValues.push(thisCharacterKeyValue);
                        }
                        characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('CharAvAlphabetSelector').setMinValues(1).setMaxValues(1);
                    }

                    let characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                    let message = await interaction.reply({ content: 'Please select the character:', components: [characterSelectRow], ephemeral: true });
                    let collector = message.createMessageComponentCollector();
                    collector.on('collect', async (interaction_second) => {
                        if (interaction.member.id === interaction_second.member.id) {
                            let characterSelected = interaction_second.values[0];
                            if (interaction_second.customId === 'CharAvAlphabetSelector') {
                                let characters;
                                if (interaction.member.permissions.has('ADMINISTRATOR')) {
                                    characters = await connection.promise().query('select * from characters where guild_id = ? and upper(name) like ?', [interaction.guildId, characterSelected + '%']);
                                } else {
                                    characters = await connection.promise().query('select c.* from players p join players_characters pc on p.id = pc.player_id join charactesr c on pc.character_id = c.id where p.user_id = ? and p.guild_id = ? and upper(c.character_name) like ?', [interaction.user.id, interaction.guildId, characterSelected + '%']);
                                }
                                if (characters[0].length > 0) {
                                    let charactersKeyValues = [];
                                    for (const character of characters[0]) {
                                        charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                                    }
                                    let characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('CharAvCharacterSelector').setMinValues(1).setMaxValues(1);
                                    let characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                                    interaction.update({ components: [characterSelectRow] });
                                } else {
                                    interaction.update({ content: 'No characters with this first letter', components: [] });
                                    await collector.stop();
                                }
                            } else {
                                let character_information = await connection.promise().query('select * from characters where id = ?', [characterSelected]);
                                await connection.promise().query('update characters set avatar_url = ? where id = ?', [interaction.options.getString('avatar_url'), character_information[0][0].id]);
                                await interaction.editReply({ content: 'Character avatar url updated.', components: [] });
                                await collector.stop();
                            }
                        }
                    });
                } else {
                    interaction.reply({ content: 'no characters found!', ephemeral: true });
                }
            } else if (interaction.options.getSubcommand() === 'move') {
                let locations = await connection.promise().query('select * from movement_locations where guild_id = ?', [interaction.guildId]);
                let locationsKeyValues = [];
                if (locations[0].length > 0) {
                    for (const location of locations[0]) {
                        locationsKeyValues.push({ label: location.friendly_name, value: location.id.toString() });
                    }
                    const locationSelectComponent = new StringSelectMenuBuilder().setOptions(locationsKeyValues).setCustomId('LocationMovementSelector').setMinValues(1).setMaxValues(1);
                    let locationSelectRow = new ActionRowBuilder().addComponents(locationSelectComponent);
                    let characters = await connection.promise().query('select distinct c.* from characters c join players_characters pc on pc.character_id = c.id join players p on pc.player_id = p.id where p.guild_id = ? and pc.active = 1', [interaction.guildId]);
                    let charactersKeyValues = [];
                    if (characters[0].length > 0) {
                        for (const character of characters[0]) {
                            charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                        }
                        const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('CharacterMovementSelector').setMinValues(1).setMaxValues(1);
                        let characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                        let message = await interaction.reply({ content: 'Select a location and a character', components: [locationSelectRow, characterSelectRow], ephemeral: true });
                        const collector = message.createMessageComponentCollector({ time: 35000 });
                        let locationSelected;
                        let characterSelected;
                        collector.on('collect', async (interaction_second) => {
                            if (interaction_second.member.id === interaction.member.id) {
                                if (interaction_second.values[0]) {
                                    if (interaction_second.customId === 'LocationMovementSelector') {
                                        locationSelected = interaction_second.values[0];
                                    } else {
                                        characterSelected = interaction_second.values[0];
                                    }
                                    if (locationSelected && characterSelected) {
                                        let character = await connection.promise().query('select c.*, p.user_id from characters c join players_characters pc on c.id = pc.character_id join players p on p.id = pc.player_id where c.id = ? ', [characterSelected]);
                                        let locations = await connection.promise().query('select * from movement_locations where id in (?, ?)', [character[0][0].location_id, locationSelected]);
                                        await connection.promise().query('update characters set location_id = ? where id = ?', [locationSelected, characterSelected]);
                                        let new_announcements;
                                        let new_name;
                                        let old_announcements;
                                        let old_name;
                                        let character_name = character[0][0].name;
                                        let user = await client.users.fetch(character[0][0].user_id);
                                        for (const location of locations[0]) {
                                            let channel = await client.channels.cache.get(location.channel_id);
                                            if (location.id == locationSelected) {
                                                await channel.permissionOverwrites.edit(user, { ViewChannel: true, SendMessages: true });
                                                if (location.announcements_channel) {
                                                    new_announcements = await client.channels.cache.get(location.announcements_channel);
                                                    new_name = location.friendly_name;
                                                }
                                            } else {
                                                if (location.global_read == 0) {
                                                    await channel.permissionOverwrites.edit(user, { ViewChannel: false });
                                                }
                                                if (location.global_write == 0) {
                                                    await channel.permissionOverwrites.edit(user, { SendMessages: false });
                                                }
                                                if (location.announcements_channel) {
                                                    old_announcements = await client.channels.cache.get(location.announcements_channel);
                                                    old_name = location.friendly_name;
                                                }
                                            }
                                        }
                                        if (old_announcements && new_name) {
                                            await old_announcements.send('*' + character_name + ' moves to ' + new_name + '.*');
                                        } else if (old_announcements) {
                                            await old_announcements.send('*' + character_name + ' leaves for parts unknown.*');
                                        }
                                        if (new_announcements && old_name) {
                                            await new_announcements.send('*' + character_name + ' arrives from ' + old_name + '.*');
                                        } else if (new_announcements) {
                                            await new_announcements.send('*' + character_name + ' arrives!*');
                                        }
                                        await interaction_second.update({ content: 'Successfully moved character.', components: [] });
                                        await collector.stop();
                                    } else {
                                        await interaction_second.deferUpdate();
                                    }
                                } else {
                                    await interaction_second.deferUpdate();
                                }
                            }
                        });
                    } else {
                        interaction.reply({ content: 'You haven\'t created any characters yet. Try creating a character first.', ephemeral: true });
                    }
                } else {
                    interaction.reply({ content: 'You haven\'t created any locations yet. Try creating a location first.', ephemeral: true });
                }
            }
        } else if (interaction.commandName === 'active') {
            let characters = await connection.promise().query('select c.* from characters c join players_characters pc on pc.character_id = c.id join players p on p.id = pc.player_id where p.user_id = ? and p.guild_id = ? and pc.active = 0', [interaction.user.id, interaction.guildId]);
            let player = await connection.promise().query('select * from players where user_id = ? and guild_id = ?', [interaction.user.id, interaction.guildId]);
            let charactersKeyValues = [];
            if (characters[0].length > 0) {
                for (const character of characters[0]) {
                    charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                }
                const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('CharacterAssignmentSelector').setMinValues(1).setMaxValues(1);
                let characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                let message = await interaction.reply({ content: 'Select a character', components: [characterSelectRow], ephemeral: true });
                const collector = message.createMessageComponentCollector();
                collector.on('collect', async (interaction_second) => {
                    if (interaction_second.member.id == interaction.member.id) {
                        await connection.promise().query('update players_characters set active = 0 where player_id = ?; update players_characters set active = 1 where player_id = ? and character_id = ?', [player[0][0].id, player[0][0].id, interaction_second.values[0]]);
                        await interaction_second.update({ content: "Active character updated.", components: [] });
                        collector.stop();
                    }
                });
            } else {
                interaction.reply({ content: "You don't have any inactive characters.", ephemeral: true });
            }
        } else if (interaction.commandName === 'archetype') {
            if (interaction.options.getSubcommand() === 'add') {
                let archetype = interaction.options.getString('archetype');
                let description = interaction.options.getString('description');
                let archetypeExists = await connection.promise().query('select * from archetypes where guild_id = ? and name = ?', [interaction.guildId, archetype]);
                if (archetypeExists[0].length == 0) {
                    await connection.promise().query('insert into archetypes (name, guild_id, description) values (?, ?, ?)', [archetype, interaction.guildId, description]);
                    interaction.reply({ content: 'Archetype added!', ephemeral: true });
                } else {
                    interaction.reply({ content: 'Archetype already exists for this game.', ephemeral: true });
                }
            } else if (interaction.options.getSubcommand() === 'assign') {
                let archetypes = await connection.promise().query('select * from archetypes where guild_id = ?', [interaction.guildId]);
                let archetypesKeyValues = [];
                if (archetypes[0].length > 0) {
                    for (const archetype of archetypes[0]) {
                        archetypesKeyValues.push({ label: archetype.name, value: archetype.id.toString() });
                    }
                    const archetypeSelectComponent = new StringSelectMenuBuilder().setOptions(archetypesKeyValues).setCustomId('ArchetypeAssignmentSelector').setMinValues(1).setMaxValues(1);
                    let archetypeSelectRow = new ActionRowBuilder().addComponents(archetypeSelectComponent);
                    let message = await interaction.reply({ content: 'Select an archetype to manage assignments:', components: [archetypeSelectRow], ephemeral: true });
                    let collector = message.createMessageComponentCollector({ time: 35000 });
                    let selectedArchetype;
                    collector.on('collect', async (interaction_second) => {
                        if (interaction_second.member.id === interaction.member.id) {
                            if (interaction_second.customId === 'ArchetypeAssignmentSelector') {
                                selectedArchetype = interaction_second.values[0];
                                let characters = await connection.promise().query('select distinct characters.* from characters left outer join characters_archetypes ca on characters.id = ca.character_id where guild_id = ? and (ca.archetype_id <> ? or ca.archetype_id is null)', [interaction.guildId, selectedArchetype]);
                                let charactersKeyValues = [];
                                if (characters[0].length > 0) {
                                    for (const character of characters[0]) {
                                        charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                                    }
                                    const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('CharacterAssignmentSelector').setMinValues(1).setMaxValues(characters[0].length);
                                    let characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                                    await interaction_second.update({ content: 'Select a character or characters to assign to this archetype:', components: [characterSelectRow] });
                                } else {
                                    await interaction_second.update({ content: 'No characters are valid to assign to this archetype.', components: [] });
                                    await collector.stop();
                                }
                            } else if (interaction_second.customId === 'CharacterAssignmentSelector') {
                                for (const thisId of interaction_second.values) {
                                    await connection.promise().query('insert into characters_archetypes (character_id, archetype_id) values (?, ?)', [thisId, selectedArchetype]);
                                }
                                await interaction_second.update({ content: 'Successfully assigned characters to archetype.', components: [] });
                                await collector.stop();
                            }
                        }
                    })


                } else {
                    interaction.reply({ content: 'No archetypes exist.', ephemeral: true })
                }
            } else if (interaction.options.getSubcommand() === 'unassign') {
                let archetypes = await connection.promise().query('select * from archetypes where guild_id = ?', [interaction.guildId]);
                let archetypesKeyValues = [];
                if (archetypes[0].length > 0) {
                    for (const archetype of archetypes[0]) {
                        archetypesKeyValues.push({ label: archetype.name, value: archetype.id.toString() });
                    }
                    const archetypeSelectComponent = new StringSelectMenuBuilder().setOptions(archetypesKeyValues).setCustomId('ArchetypeAssignmentSelector').setMinValues(1).setMaxValues(1);
                    let archetypeSelectRow = new ActionRowBuilder().addComponents(archetypeSelectComponent);
                    let message = await interaction.reply({ content: 'Select an archetype to manage assignments:', components: [archetypeSelectRow], ephemeral: true });
                    let collector = message.createMessageComponentCollector({ time: 35000 });
                    let selectedArchetype;
                    collector.on('collect', async (interaction_second) => {
                        if (interaction_second.member.id === interaction.member.id) {
                            if (interaction_second.customId === 'ArchetypeAssignmentSelector') {
                                selectedArchetype = interaction_second.values[0];
                                let characters = await connection.promise().query('select distinct characters.* from characters left outer join characters_archetypes ca on characters.id = ca.character_id where guild_id = ? and (ca.archetype_id = ?)', [interaction.guildId, selectedArchetype]);
                                let charactersKeyValues = [];
                                if (characters[0].length > 0) {
                                    for (const character of characters[0]) {
                                        charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                                    }
                                    const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('CharacterUnassignmentSelector').setMinValues(1).setMaxValues(characters[0].length);
                                    let characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                                    await interaction_second.update({ content: 'Select a character or characters to unassign to this archetype:', components: [characterSelectRow] });
                                } else {
                                    await interaction_second.update({ content: 'No characters are valid to assign to this archetype.', components: [] });
                                    await collector.stop();
                                }
                            } else if (interaction_second.customId === 'CharacterUnassignmentSelector') {
                                for (const thisId of interaction_second.values) {
                                    await connection.promise().query('delete from characters_archetypes where character_id = ? and archetype_id = ?', [thisId, selectedArchetype]);
                                }
                                await interaction_second.update({ content: 'Successfully unassigned characters from archetype.', components: [] });
                                await collector.stop();
                            }
                        }
                    })


                } else {
                    interaction.reply({ content: 'No archetypes exist.', ephemeral: true })
                }
            }
        } else if (interaction.commandName === 'stat') {
            if (interaction.options.getSubcommand() === 'charactersummary') {
                let stats = await connection.promise().query('select * from stats where guild_id = ? and name like ?', [interaction.guildId, '%' + interaction.options.getString('name') + '%']);
                if (stats[0].length > 0) {
                    if (stats[0].length == 1) {
                        let names = '';
                        let values = '';
                        let stats_characters = await connection.promise().query('SELECT c.name, coalesce(cs.override_value, s.default_value) as value from characters c left outer join characters_stats cs on c.id = cs.character_id and cs.stat_id = ? join stats s on s.id = ? where c.guild_id = ? order by c.name asc', [stats[0][0].id, stats[0][0].id, interaction.guildId]);
                        let embed = new EmbedBuilder();
                        embed.setTitle(`Stat Summary for ${stats[0][0].name}`);
                        for (const characterDisplay of stats_characters[0]) {
                            names = names.concat(characterDisplay.name + '\n');
                            values = values.concat(characterDisplay.value + '\n');
                            //message = message.concat(characterDisplay.name + ' - ' + characterDisplay.value + '\n');
                        }
                        //await interaction.reply({ content: message });
                        //embed.setDescription(message);
                        embed.addFields({ name: 'Character Names', value: names, inline: true }, { name: 'Stat Values', value: values, inline: true });
                        await interaction.reply({ content: '', embeds: [embed], ephemeral: true });
                    } else {
                        await interaction.reply({ content: 'More than one stat was found matching your query. Try again, please.', ephemeral: true });
                    }
                } else {
                    await interaction.reply({ content: 'No stats found matching your query.', ephemeral: true });
                }
            } else if (interaction.options.getSubcommand() === 'add') {
                let name = interaction.options.getString('stat')
                let defaultValue = interaction.options.getInteger('defaultvalue');
                let exists = await connection.promise().query('select * from stats where guild_id = ? and name = ?', [interaction.guildId, name]);
                if (exists[0].length == 0) {
                    await connection.promise().query('insert into stats (name, default_value, guild_id) values (?, ?, ?)', [name, defaultValue, interaction.guildId]);
                    interaction.reply({ content: 'Stat added!', ephemeral: true });
                } else {
                    interaction.reply({ content: 'Stat with this name already exists!', ephemeral: true });
                }
            } else if (interaction.options.getSubcommand() === 'set') {
                let value = interaction.options.getInteger('value');
                // Create two dropdowns. For character and stat. See characterlocation for details.
                let stats = await connection.promise().query('select * from stats where guild_id = ?', [interaction.guildId]);
                let statsKeyValues = [{ label: 'Select a stat', value: '0' }];
                if (stats[0].length > 0) {
                    for (const stat of stats[0]) {
                        statsKeyValues.push({ label: stat.name, value: stat.id.toString() });
                    }
                    const statSelectComponent = new StringSelectMenuBuilder().setOptions(statsKeyValues).setCustomId('StatAssignmentStatSelector').setMinValues(1).setMaxValues(1);
                    let statSelectRow = new ActionRowBuilder().addComponents(statSelectComponent);
                    let characters = await connection.promise().query('select * from characters where guild_id = ?', [interaction.guildId]);
                    if (characters[0].length > 0) {
                        let charactersKeyValues = [{ label: 'Select a character', value: '0' }];
                        for (const character of characters[0]) {
                            charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                        }
                        const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('StatAssignmentCharacterSelector').setMinValues(1).setMaxValues(1);
                        let characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                        let message = await interaction.reply({ content: '', components: [statSelectRow, characterSelectRow], ephemeral: true });
                        const collector = message.createMessageComponentCollector({ time: 35000 });
                        let statSelected;
                        let characterSelected;
                        collector.on('collect', async (interaction_second) => {
                            if (interaction_second.member.id === interaction.member.id) {
                                if (interaction_second.values[0]) {
                                    if (interaction_second.customId === 'StatAssignmentStatSelector') {
                                        statSelected = interaction_second.values[0];
                                    } else {
                                        characterSelected = interaction_second.values[0];
                                    }
                                    if (statSelected && characterSelected) {
                                        let exists = await connection.promise().query('select * from characters_stats where stat_id = ? and character_id = ?', [statSelected, characterSelected]);
                                        if (exists[0] && exists[0].length > 0) {
                                            console.log('exists');
                                            await connection.promise().query('update characters_stats set override_value = ? where character_id = ? and stat_id = ?', [value, characterSelected, statSelected]);
                                        } else {
                                            await connection.promise().query('insert into characters_stats (character_id, stat_id, override_value) values (?, ?, ?)', [characterSelected, statSelected, value]);
                                        }
                                        await interaction.editReply({ content: 'Successfully updated character stat value.', components: [] });
                                        await collector.stop();
                                    } else {
                                        await interaction_second.deferUpdate();
                                    }
                                } else {
                                    await interaction_second.deferUpdate();
                                }
                            }
                        });
                    } else {
                        interaction.reply({ content: 'You haven\'t created any stats yet. Try creating a stat first.', ephemeral: true });
                    }
                } else {
                    interaction.reply({ content: 'You haven\'t created any characters yet. Try creating a character first.', ephemeral: true });
                }
            } else if (interaction.options.getSubcommand() === 'adjust') {
                let value = interaction.options.getInteger('value');
                // Create two dropdowns. For character and stat. See characterlocation for details.
                let stats = await connection.promise().query('select * from stats where guild_id = ?', [interaction.guildId]);
                if (stats[0].length > 0) {
                    let statsKeyValues = [{ label: 'Select a stat', value: '0' }];
                    for (const stat of stats[0]) {
                        statsKeyValues.push({ label: stat.name, value: stat.id.toString() });
                    }
                    const statSelectComponent = new StringSelectMenuBuilder().setOptions(statsKeyValues).setCustomId('StatAssignmentStatSelector').setMinValues(1).setMaxValues(1);
                    let statSelectRow = new ActionRowBuilder().addComponents(statSelectComponent);
                    let characters = await connection.promise().query('select * from characters where guild_id = ?', [interaction.guildId]);
                    if (characters[0].length > 0) {
                        let charactersKeyValues = [{ label: 'Select a character', value: '0' }];
                        for (const character of characters[0]) {
                            charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                        }
                        const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('StatAssignmentCharacterSelector').setMinValues(1).setMaxValues(1);
                        let characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                        let message = await interaction.reply({ content: '', components: [statSelectRow, characterSelectRow], ephemeral: true });
                        const collector = message.createMessageComponentCollector({ time: 35000 });
                        let statSelected;
                        let characterSelected;
                        collector.on('collect', async (interaction_second) => {
                            if (interaction.member.id === interaction_second.member.id) {
                                if (interaction_second.values[0]) {
                                    if (interaction_second.customId === 'StatAssignmentStatSelector') {
                                        statSelected = interaction_second.values[0];
                                    } else {
                                        characterSelected = interaction_second.values[0];
                                    }
                                    if (statSelected && characterSelected) {
                                        let exists = await connection.promise().query('select * from characters_stats where stat_id = ? and character_id = ?', [statSelected, characterSelected]);
                                        if (exists[0] && exists[0].length > 0) {
                                            await connection.promise().query('update characters_stats set override_value = ? where character_id = ? and stat_id = ?', [exists[0][0].override_value + value, characterSelected, statSelected]);
                                        } else {
                                            let stat = await connection.promise().query('select * from stats where id = ?', [statSelected]);
                                            await connection.promise().query('insert into characters_stats (character_id, stat_id, override_value) values (?, ?, ?)', [characterSelected, statSelected, stat[0][0].default_value + value]);
                                        }
                                        await interaction.editReply({ content: 'Successfully updated character stat value.', components: [] });
                                        await collector.stop();
                                    } else {
                                        await interaction_second.deferUpdate();
                                    }
                                } else {
                                    await interaction_second.deferUpdate();
                                }
                            }
                        });
                    } else {
                        interaction.reply({ content: 'You haven\'t created any stats yet. Try creating a stat first.', ephemeral: true });
                    }
                } else {
                    interaction.reply({ content: 'You haven\'t created any characters yet. Try creating a character first.', ephemeral: true });
                }
            }
        } else if (interaction.commandName === 'addarchetypestat') {
            // stat, description, defaultvalue
            let name = interaction.options.getString('stat');
            let description = interaction.options.getString('description');
            let defaultValue = interaction.options.getInteger('defaultvalue');
            let exists = await connection.promise().query('select * from archetypestats where guild_id = ? and name = ?', [interaction.guildId, name]);
            if (exists[0].length == 0) {
                let archetypes = await connection.promise().query('select * from archetypes where guild_id = ?', [interaction.guildId]);
                if (archetypes[0].length > 0) {
                    let addedStat = await connection.promise().query('insert into archetypestats (name, description, default_value, guild_id) values (?, ?, ?, ?)', [name, description, defaultValue, interaction.guildId]);
                    let archetypesKeyValues = [];
                    for (const archetype of archetypes[0]) {
                        archetypesKeyValues.push({ label: archetype.name, value: archetype.id.toString() });
                    }
                    const archetypeSelectComponent = new StringSelectMenuBuilder().setOptions(archetypesKeyValues).setCustomId('ArchetypeStatAssignmentSelector').setMinValues(1).setMaxValues(archetypes[0].length);
                    let archetypeSelectRow = new ActionRowBuilder().addComponents(archetypeSelectComponent);
                    let message = await interaction.reply({ content: 'Archetype stat added! Select archetype(s):', components: [archetypeSelectRow], ephemeral: true });
                    let collector = message.createMessageComponentCollector({ time: 35000 });
                    collector.on('collect', async (interaction_second) => {
                        if (interaction_second.customId === 'ArchetypeStatAssignmentSelector' && interaction.member.id === interaction_second.member.id) {
                            for (const thisArchetype of interaction_second.values) {
                                await connection.promise().query('insert into archetypes_archetypestats (archetype_id, archetypestat_id) values (?, ?)', [thisArchetype, addedStat[0].insertId]);
                            }
                            await interaction_second.update({ content: 'Successfully assigned stat to archetype(s).', components: [] });
                            collector.stop();
                        }
                    });
                } else {
                    interaction.reply({ content: 'No archetypes exist! Please create an archetype first.', ephemeral: true });
                }
            } else {
                interaction.reply({ content: 'Stat with this name already exists!', ephemeral: true });
            }
        } else if (interaction.commandName === 'skilladmin') {
            if (interaction.options.getSubcommand() === 'edit') {
                let skill_name = interaction.options.getString('name');
                let skill_id;
                let column_name;
                let process = true;
                let columns = await connection.promise().query('show columns from skills where Type = "text"');
                let message;
                let skill = await connection.promise().query('select * from skills where name like ? and guild_id = ?', ['%' + skill_name + '%', interaction.guildId]);
                if (skill[0].length > 0) { // CLEAN THIS MESS UP
                    if (skill[0].length == 1) {
                        let keyValues = [];
                        skill_id = skill[0][0].id;
                        for (const column of columns[0]) {
                            keyValues.push({ label: column.Field, value: column.Field });
                        }
                        const selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('SkillEditColumnSelector' + interaction.member.id).setMinValues(1).setMaxValues(1);
                        let selectRow = new ActionRowBuilder().addComponents(selectComponent);
                        message = await interaction.reply({ content: 'Please select a property from the dropdown to edit.', components: [selectRow], ephemeral: true });

                        //show dropdown for column to edit, then show modal
                    } else if (skill[0].length > 25) {
                        await interaction.reply({ content: 'Your string match returned more than 25 skills. Please try again with a more specific string match.', ephemeral: true });
                        process = false;
                    } else if (skill[0].length > 1) {
                        let keyValues = [];
                        for (const thisSkill of skill[0]) {
                            keyValues.push({ label: thisSkill.name, value: thisSkill.id.toString() });
                        }
                        const selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('SkillEditSkillSelector' + interaction.member.id).setMinValues(1).setMaxValues(1);
                        let selectRow = new ActionRowBuilder().addComponents(selectComponent);
                        message = await interaction.reply({ content: 'Please select a skill from the dropdown to edit.', components: [selectRow], ephemeral: true });
                        //show dropdown for skill, then show dropdown for column, then show modal
                    } else {
                        await interaction.reply({ content: 'Your string match didn\'t return any results, try again please', ephemeral: true });
                        process = false;
                    }
                    if (process) {
                        let collector = message.createMessageComponentCollector();
                        collector.on('collect', async (interaction_second) => {
                            if (interaction_second.customId === 'SkillEditSkillSelector' + interaction_second.member.id) {
                                skill_id = interaction_second.values[0];
                                let keyValues = [];
                                skill_id = skill[0][0].id;
                                for (const column of columns[0]) {
                                    keyValues.push({ label: column.Field, value: column.Field });
                                }
                                const selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('SkillEditColumnSelector' + interaction_second.member.id).setMinValues(1).setMaxValues(1);
                                let selectRow = new ActionRowBuilder().addComponents(selectComponent);
                                await interaction_second.update({ content: 'Please select a property from the dropdown to edit.', components: [selectRow] });
                            } else if (interaction_second.customId === 'SkillEditColumnSelector' + interaction_second.member.id) {
                                column_name = interaction_second.values[0];
                                let now = Date.now();
                                let modal = new ModalBuilder()
                                    .setCustomId('SkillEditModal' + now);
                                modal.setTitle(`Skill Update - ${column_name}`);
                                let currentValue = await connection.promise().query(`select ?? as current_value from skills where id = ?`, [column_name, skill_id]);
                                let newValueInput = new TextInputBuilder()
                                    .setCustomId('newValue')
                                    .setLabel('New value for this field')
                                    .setPlaceholder(currentValue[0][0].current_value.substring(0, 100))
                                    .setStyle(TextInputStyle.Paragraph);
                                let valueActionRow = new ActionRowBuilder().addComponents(newValueInput);
                                modal.addComponents(valueActionRow);
                                await interaction_second.showModal(modal);
                                let submittedModal = await interaction_second.awaitModalSubmit({ time: 60000 });
                                if (submittedModal) {
                                    if (submittedModal.customId === ('SkillEditModal' + now) && submittedModal.member.id == interaction.member.id) {
                                        const newValue = submittedModal.fields.getTextInputValue('newValue');
                                        await connection.promise().query('update skills set ?? = ? where id = ?', [column_name, newValue, skill_id]);
                                        submittedModal.update({ content: 'Successfully updated this skill entry.', components: [] });
                                        collector.stop();
                                    }
                                }
                            }
                        });
                    }
                } else {
                    await interaction.reply({ content: 'No skills found matching your entry. Please double check and try again.', ephemeral: true });
                }


            } else if (interaction.options.getSubcommand() === 'add') {
                let name = interaction.options.getString('name');
                let type = interaction.options.getString('type');
                let other_targetable = interaction.options.getBoolean('other_targetable');
                let self_targetable = interaction.options.getBoolean('self_targetable');
                let description = interaction.options.getString('description');
                let exists = await connection.promise().query('select * from skills where guild_id = ? and name = ?', [interaction.guildId, name]);
                if (exists[0].length == 0) {
                    await connection.promise().query('insert into skills (name, description, type, guild_id, other_targetable, self_targetable) values (?, ?, ?, ?, ?, ?)', [name, description, type, interaction.guildId, other_targetable, self_targetable]);
                    interaction.reply({ content: 'Skill added!', ephemeral: true });
                } else {
                    interaction.reply({ content: 'Skill with this name already exists!', ephemeral: true });
                }
            } else if (interaction.options.getSubcommand() === 'assign') {
                let to_character = interaction.options.getBoolean('to_character');
                let skills = await connection.promise().query('select * from skills where guild_id = ?', [interaction.guildId]);
                let skillSelectComponent;
                if (skills[0].length > 0) {
                    if (skills[0].length <= 25) {
                        let skillsKeyValues = [{ label: 'Select a skill', value: '0' }];
                        for (const skill of skills[0]) {
                            skillsKeyValues.push({ label: skill.name, value: skill.id.toString() });
                        }
                        skillSelectComponent = new StringSelectMenuBuilder().setOptions(skillsKeyValues).setCustomId('SkillAssignmentSkillSelector').setMinValues(1).setMaxValues(1);
                    } else {
                        let skills = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                        let skillsKeyValues = [];
                        for (const skill of skills) {
                            skillsKeyValues.push({ label: skill, value: skill });
                        }
                        skillSelectComponent = new StringSelectMenuBuilder().setOptions(skillsKeyValues).setCustomId('SkillAssignmentAlphabetSelector').setMinValues(1).setMaxValues(1);
                    }
                    let skillSelectRow = new ActionRowBuilder().addComponents(skillSelectComponent);
                    let secondSelectRow;
                    let characters;
                    let archetypes;
                    if (to_character) {
                        characters = await connection.promise().query('select * from characters where guild_id = ?', [interaction.guildId]);
                        if (characters[0].length >= 25) {
                            let characters = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                            let charactersKeyValues = [];
                            for (const character of characters) {
                                charactersKeyValues.push({ label: character, value: character });
                            }
                            characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('SkillAssignmentCharacterAlphabetSelector').setMinValues(1).setMaxValues(1);
                            secondSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                        } else if (characters[0].length > 0) {
                            let charactersKeyValues = [{ label: 'Select a character', value: '0' }];
                            for (const character of characters[0]) {
                                charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                            }
                            const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('SkillAssignmentCharacterSelector').setMinValues(1).setMaxValues(charactersKeyValues.length);
                            secondSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                        }
                    } else {
                        archetypes = await connection.promise().query('select * from archetypes where guild_id = ?', [interaction.guildId]);
                        if (archetypes[0].length > 0) {
                            let archetypesKeyValues = [{ label: 'Select a archetype', value: '0' }];
                            for (const archetype of archetypes[0]) {
                                archetypesKeyValues.push({ label: archetype.name, value: archetype.id.toString() });
                            }
                            const archetypeSelectComponent = new StringSelectMenuBuilder().setOptions(archetypesKeyValues).setCustomId('SkillAssignmentArchetypeSelector').setMinValues(1).setMaxValues(archetypesKeyValues.length);
                            secondSelectRow = new ActionRowBuilder().addComponents(archetypeSelectComponent);
                        }
                    }
                    if ((to_character && characters[0].length > 0) || (!to_character && archetypes[0].length > 0)) {
                        let message = await interaction.reply({ content: 'Please select the following options:', components: [skillSelectRow, secondSelectRow], ephemeral: true });
                        let collector = message.createMessageComponentCollector();
                        let charactersSelected;
                        let archetypesSelected;
                        let alphabetSelected;
                        let alphabetCSelected;
                        let skillSelected;
                        collector.on('collect', async (interaction_second) => {
                            if (interaction.member.id === interaction_second.member.id) {
                                if (interaction_second.values[0]) {
                                    if (interaction_second.customId === 'SkillAssignmentSkillSelector') {
                                        skillSelected = interaction_second.values[0];
                                    } else if (interaction_second.customId === 'SkillAssignmentAlphabetSelector') {
                                        alphabetSelected = interaction_second.values[0];
                                    } else if (interaction_second.customId === 'SkillAssignmentCharacterAlphabetSelector') {
                                        alphabetCSelected = interaction_second.values[0];
                                    } else if (interaction_second.customId === 'SkillAssignmentCharacterSelector') {
                                        charactersSelected = interaction_second.values;
                                    } else {
                                        archetypesSelected = interaction_second.values;
                                    }
                                    if (alphabetSelected && !skillSelected) {
                                        let skills;
                                        if (alphabetSelected.length == 1) {
                                            skills = await connection.promise().query('select * from skills where guild_id = ? and name like ?', [interaction_second.guildId, alphabetSelected + '%']);
                                        } else {
                                            // hmm something is wrong, bail out
                                        }
                                        let skillsKeyValues = [{ label: 'Select a skill', value: '0' }];
                                        for (const skill of skills[0]) {
                                            skillsKeyValues.push({ label: skill.name, value: skill.id.toString() });
                                        }
                                        skillSelectComponent = new StringSelectMenuBuilder().setOptions(skillsKeyValues).setCustomId('SkillAssignmentSkillSelector').setMinValues(1).setMaxValues(1);
                                        skillSelectRow = new ActionRowBuilder().addComponents(skillSelectComponent);
                                        await interaction_second.update({ content: 'Please select the following options:', components: [skillSelectRow, secondSelectRow] });
                                    } else {
                                        if (alphabetCSelected && !charactersSelected) {
                                            let characters;
                                            if (alphabetCSelected.length == 1) {
                                                characters = await connection.promise().query('select * from characters where guild_id = ? and name like ?', [interaction_second.guildId, alphabetCSelected + '%']);
                                            } else {
                                                //hmm something is wrong, bail out
                                            }
                                            let charactersKeyValues = [{ label: 'Select a character', value: '0' }];
                                            for (const character of characters[0]) {
                                                charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                                            }
                                            characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('SkillAssignmentCharacterSelector').setMinValues(1).setMaxValues(charactersKeyValues.length);
                                            secondSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                                            await interaction_second.update({ content: 'Please select the following options:', components: [skillSelectRow, secondSelectRow] });
                                        } else if (skillSelected && (charactersSelected || archetypesSelected)) {
                                            if (charactersSelected) {
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
                                    }
                                } else {
                                    await interaction_second.deferUpdate();
                                }
                            }
                        });
                    } else {
                        interaction.reply({ content: 'Couldn\'t find any characters. Or archetypes, if you wanted to assign archetypes. I can\'t be sure because Alli is lazy.', ephemeral: true });
                    }
                } else {
                    interaction.reply({ content: 'Please create at least one skill first. <3', ephemeral: true });
                }
            } else if (interaction.options.getSubcommand() === 'unassign') {
                let to_character = interaction.options.getBoolean('to_character');
                let unassignSkillRow;
                let characters = false;
                let archetypes = false;
                let skillName;
                if (interaction.options.getString('skill_name')) {
                    skillName = interaction.options.getString('skill_name');
                } else {
                    skillName = false;
                }
                if (to_character) {
                    characters = await connection.promise().query('select * from characters where guild_id = ?', [interaction.guildId]);
                    if (characters[0].length > 0 && characters[0].length <= 25) {
                        let charactersKeyValues = [];
                        for (const character of characters[0]) {
                            charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                        }
                        const unassignSkillComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('SkillUnassignmentCharacterSelector').setMinValues(1).setMaxValues(1);
                        unassignSkillRow = new ActionRowBuilder().addComponents(unassignSkillComponent);
                    } else {
                        if (characters[0].length > 25) {
                            let characters = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                            let charactersKeyValues = [];
                            for (const character of characters) {
                                charactersKeyValues.push({ label: character, value: character });
                            }
                            const unassignSkillComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('SkillUnassignmentCharacterAlphabetSelector').setMinValues(1).setMaxValues(1);
                            unassignSkillRow = new ActionRowBuilder().addComponents(unassignSkillComponent);
                        }
                    }
                } else {
                    let archetypes = await connection.promise().query('select * from archetypes where guild_id = ?', [interaction.guildId]);
                    if (archetypes[0].length > 0) {
                        let archetypesKeyValues = [];
                        for (const archetype of archetypes[0]) {
                            archetypesKeyValues.push({ label: archetype.name, value: archetype.id.toString() });
                        }
                        const unassignSkillComponent = new StringSelectMenuBuilder().setOptions(archetypesKeyValues).setCustomId('SkillUnassignmentArchetypeSelector').setMinValues(1).setMaxValues(1);
                        unassignSkillRow = new ActionRowBuilder().addComponents(unassignSkillComponent);
                    }
                }
                if ((to_character && characters && characters[0].length > 0) || (archetypes && archetypes.length > 0)) {
                    let message = await interaction.reply({ content: 'Select the archetype/character to remove skill from.', components: [unassignSkillRow], ephemeral: true });
                    let collector = message.createMessageComponentCollector();
                    let characterSelected;
                    let archetypeSelected;
                    let skillSelected;
                    let cLetterSelected;
                    collector.on('collect', async (interaction_second) => {
                        if (interaction_second.member.id === interaction.member.id) {
                            if (interaction_second.customId === 'SkillUnassignmentCharacterSelector') {
                                characterSelected = interaction_second.values[0];
                            } else if (interaction_second.customId === 'SkillUnassignmentArchetypeSelector') {
                                archetypeSelected = interaction_second.values[0];
                            } else if (interaction_second.customId === 'SkillUnassignmentSkillSelector') {
                                skillSelected = interaction_second.values[0];
                            } else if (interaction_second.customId === 'SkillUnassignmentCharacterAlphabetSelector') {
                                cLetterSelected = interaction_second.values[0];
                            }
                            if (cLetterSelected) {
                                let characters = await connection.promise().query('select * from characters where guild_id = ? and name like ?', [interaction.guildId, cLetterSelected + '%']);
                                if (characters[0].length > 0) {
                                    let charactersKeyValues = [];
                                    for (const character of characters[0]) {
                                        charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                                    }
                                    const unassignSkillComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('SkillUnassignmentCharacterSelector').setMinValues(1).setMaxValues(1);
                                    unassignSkillRow = new ActionRowBuilder().addComponents(unassignSkillComponent);
                                    await interaction_second.update({ components: [unasssignSkillRow] });
                                } else {
                                    await interaction_second.update({ content: 'No characters start with that letter.', components: [] });
                                    collector.stop();
                                }
                            }
                            if (!skillSelected && (characterSelected || archetypeSelected)) {
                                if (skillName) {
                                    if (characterSelected) {
                                        skills = await connection.promise().query('select s.* from skills s join skills_characters sc on s.id = sc.skill_id where sc.character_id = ? and s.name like ?', [characterSelected, skillName]);
                                    } else {
                                        skills = await connection.promise().query('select s.* from skills s join skills_characters sc on s.id = sc.skill_id where sc.character_id = ? and s.name like ?', [characterSelected, skillName]);
                                    }
                                    if (skills[0].length == 1) {
                                        skillSelected = skills[0][0].id;
                                    } else {
                                        await interaction_second.update({ content: 'Couldn\'t find any skills matching your specification.', components: [] });
                                        collector.stop();
                                    }
                                } else {
                                    let skills;
                                    if (characterSelected) {
                                        skills = await connection.promise().query('select s.* from skills s join skills_characters sc on s.id = sc.skill_id where sc.character_id = ?', [characterSelected]);
                                    } else {
                                        skills = await connection.promise().query('select s.* from skills s join skills_archetypes sa on s.id = sa.skill_id where sa.archetype_id = ?', [archetypeSelected]);
                                    }
                                    if (skills[0].length > 0 && skills[0].length <= 25) {
                                        let skillsKeyValues = [];
                                        for (const skill of skills[0]) {
                                            skillsKeyValues.push({ label: skill.name, value: skill.id.toString() });
                                        }
                                        const unassignSkillComponent2 = new StringSelectMenuBuilder().setOptions(skillsKeyValues).setCustomId('SkillUnassignmentSkillSelector').setMinValues(1).setMaxValues(1);
                                        let unassignSkillRow2 = new ActionRowBuilder().addComponents(unassignSkillComponent2);
                                        await interaction_second.update({ content: 'Now select a skill to unassign:', components: [unassignSkillRow2] });
                                    } else if (skills[0].length <= 0) {
                                        await interaction_second.update({ content: 'Couldn\'t find any skills for this character/archetype.' });
                                        collector.stop();
                                    } else {
                                        await interaction_second.update({ content: "More than 25 skills are assigned to this character. Use the skill_name parameter in this command to remove a specific skill." });
                                        collector.stop();
                                    }
                                }
                            }
                            if (skillSelected && (characterSelected || archetypeSelected)) {
                                if (characterSelected) {
                                    await connection.promise().query('delete from skills_characters where character_id = ? and skill_id = ?', [characterSelected, skillSelected]);
                                } else {
                                    await connection.promise().query('delete from skills_archetypes where archetype_id = ? and skill_id = ?', [archetypeSelected, skillSelected]);
                                }
                                await interaction_second.update({ content: "Skill removed from character or archetype.", components: [] });
                                collector.stop();
                            }
                        }
                    });
                } else {
                    await interaction.reply({ content: "Couldn't find any characters (or archetypes) to unassign skills from.", ephemeral: true });
                }
            } else if (interaction.options.getSubcommand() === 'vieweffects') {
                let selectedSkillName;
                let skill_partial = interaction.options.getString('name');
                let skill = await connection.promise().query('select * from skills where guild_id = ? and name like ?', [interaction.guildId, '%' + skill_partial + '%']);
                if (skill[0].length > 0) {
                    let message = false;
                    if (skill[0].length == 1) {
                        selectedSkillName = skill[0][0].name;
                        let effects = await connection.promise().query('select ifnull(count(ep.id), 0) as prereq_count, e.* from effects e join skills_effects se on e.id = se.effect_id left outer join effects_prereqs ep on e.id = ep.effect_id where se.skill_id = ? group by e.id', [skill[0][0].id]);
                        let embed = new EmbedBuilder()
                            .setTitle(`Effects for ${selectedSkillName}`);
                        let effectsString = '';
                        for (const effect of effects[0]) {
                            if (effect.type == 'item') {
                                let item = await connection.promise().query('select * from items where id = ?', [effect.type_id]);
                                effectsString += `Modify item count for ${item[0][0].name} by ${effect.type_qty}\n`;
                            } else if (effect.type == 'wflag_inc') {
                                let wflag = await connection.promise().query('select * from worldflags where id = ?', [effect.type_id]);
                                effectsString += `Increment value for worldflag ${wflag[0][0].name} by ${effect.type_qty}`;
                            } else if (effect.type == 'cflag_inc') {
                                let cflag = await connection.promise().query('select * from characterflags where id = ?', [effect.type_id]);
                                effectsString += `Increment value for characterflag ${cflag[0][0].name} by ${effect.type_qty}`;
                            } else if (effect.type == 'wflag_set') {
                                let wflag = await connection.promise().query('select * from worldflags where id = ?', [effect.type_id]);
                                effectsString += `Set value for worldflag ${wflag[0][0].name} to ${effect.type_qty}`;
                            } else if (effect.type == 'cflag_set') {
                                let cflag = await connection.promise().query('select * from characterflags where id = ?', [effect.type_id]);
                                effectsString += `Set value for characterflag ${cflag[0][0].name} to ${effect.type_qty}`;
                            } else if (effect.type == 'skill') {
                                let skill = await connection.promise().query('select * from skills where id = ?', [effect.type_id]);
                                effectsString += `Grant skill ${skill[0][0].name}`;
                            } else if (effect.type == 'archetype') {
                                let archetype = await connection.promise().query('select * from archetypes where id = ?', [effect.type_id]);
                                effectsString += `Grant archetype ${archetype[0][0].name}`;
                            } else if (effect.type == 'reputation_inc') {
                                let reputation = await connection.promise().query('select * from reputations where id = ?', [effect.type_id]);
                                effectsString += `Increment value for reputation ${reputation[0][0].name} by ${effect.type_qty}`;
                            } else if (effect.type == 'stat_inc') {
                                let stat = await connection.promise().query('select * from stats where id = ?', [effect.type_id]);
                                effectsString += `Increment value for stat ${stat[0][0].name} by ${effect.type_qty}`;
                            } else if (effect.type == 'reputation_set') {
                                let reputation = await connection.promise().query('select * from reputations where id = ?', [effect.type_id]);
                                effectsString += `Increment value for reputation ${reputation[0][0].name} by ${effect.type_qty}`;
                            } else if (effect.type == 'stat_set') {
                                let stat = await connection.promise().query('select * from stats where id = ?', [effect.type_id]);
                                effectsString += `Increment value for stat ${stat[0][0].name} by ${effect.type_qty}`;
                            } else if (effect.type == 'message') {
                                effectsString += `Send message \`${effect.typedata}\``;
                            }
                            effectsString += ` to ${effect.target} (${effect.prereq_count} prereqs)\n`;
                        }
                        embed.setDescription(effectsString);
                        await interaction.reply({ content: '', embeds: [embed], ephemeral: true });
                    } else {
                        let keyValues = [];
                        for (const thisSkill of skill[0]) {
                            keyValues.push({ label: thisSkill.name, value: thisSkill.id.toString() });
                        }
                        const selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('EffectViewSkillSelector').setMinValues(1).setMaxValues(1);
                        const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                        message = await interaction.reply({ content: 'Please select a skill:', components: [selectRow], ephemeral: true });

                    }
                    if (message) {
                        let collector = message.createMessageComponentCollector();
                        collector.on('collect', async (interaction_second) => {
                            if (interaction_second.member.id === interaction.member.id) {
                                if (interaction_second.customId === 'EffectViewSkillSelector') {
                                    let skill = await connection.promise().query('select * from skills where id = ?', interaction_second.values[0]);
                                    selectedSkillName = skill[0][0].name;
                                    let effects = await connection.promise().query('select ifnull(count(ep.id), 0) as prereq_count, e.* from effects e join skills_effects se on e.id = se.effect_id left outer join effects_prereqs ep on e.id = ep.effect_id where se.skill_id = ? group by e.id', [interaction_second.values[0]]);
                                    let embed = new EmbedBuilder()
                                        .setTitle(`Effects for ${selectedSkillName}`);
                                    let effectsString = '';
                                    for (const effect of effects[0]) {
                                        if (effect.type == 'item') {
                                            let item = await connection.promise().query('select * from items where id = ?', [effect.type_id]);
                                            effectsString += `Modify item count for ${item[0][0].name} by ${effect.type_qty}\n`;
                                        } else if (effect.type == 'wflag_inc') {
                                            let wflag = await connection.promise().query('select * from worldflags where id = ?', [effect.type_id]);
                                            effectsString += `Increment value for worldflag ${wflag[0][0].name} by ${effect.type_qty}`;
                                        } else if (effect.type == 'cflag_inc') {
                                            let cflag = await connection.promise().query('select * from characterflags where id = ?', [effect.type_id]);
                                            effectsString += `Increment value for characterflag ${cflag[0][0].name} by ${effect.type_qty}`;
                                        } else if (effect.type == 'wflag_set') {
                                            let wflag = await connection.promise().query('select * from worldflags where id = ?', [effect.type_id]);
                                            effectsString += `Set value for worldflag ${wflag[0][0].name} to ${effect.type_qty}`;
                                        } else if (effect.type == 'cflag_set') {
                                            let cflag = await connection.promise().query('select * from characterflags where id = ?', [effect.type_id]);
                                            effectsString += `Set value for characterflag ${cflag[0][0].name} to ${effect.type_qty}`;
                                        } else if (effect.type == 'skill') {
                                            let skill = await connection.promise().query('select * from skills where id = ?', [effect.type_id]);
                                            effectsString += `Grant skill ${skill[0][0].name}`;
                                        } else if (effect.type == 'archetype') {
                                            let archetype = await connection.promise().query('select * from archetypes where id = ?', [effect.type_id]);
                                            effectsString += `Grant archetype ${archetype[0][0].name}`;
                                        } else if (effect.type == 'reputation_inc') {
                                            let reputation = await connection.promise().query('select * from reputations where id = ?', [effect.type_id]);
                                            effectsString += `Increment value for reputation ${reputation[0][0].name} by ${effect.type_qty}`;
                                        } else if (effect.type == 'stat_inc') {
                                            let stat = await connection.promise().query('select * from stats where id = ?', [effect.type_id]);
                                            effectsString += `Increment value for stat ${stat[0][0].name} by ${effect.type_qty}`;
                                        } else if (effect.type == 'reputation_set') {
                                            let reputation = await connection.promise().query('select * from reputations where id = ?', [effect.type_id]);
                                            effectsString += `Increment value for reputation ${reputation[0][0].name} by ${effect.type_qty}`;
                                        } else if (effect.type == 'stat_set') {
                                            let stat = await connection.promise().query('select * from stats where id = ?', [effect.type_id]);
                                            effectsString += `Increment value for stat ${stat[0][0].name} by ${effect.type_qty}`;
                                        } else if (effect.type == 'message') {
                                            effectsString += `Send message \`${effect.typedata}\``;
                                        }
                                        effectsString += ` to ${effect.target} (${effect.prereq_count} prereqs)\n`;
                                    }
                                    embed.setDescription(effectsString);
                                    await interaction_second.update({ content: '', components: [], embeds: [embed] });
                                    await collector.stop();
                                }
                            }
                        });
                    }
                } else {
                    await interaction.reply({ content: 'No skill in this game matched the name you gave. Please try again.', ephemeral: true });
                }
            }
        } else if (interaction.commandName === 'itemadmin') {
            if (interaction.options.getSubcommand() === 'edit') {
                let item_name = interaction.options.getString('name');
                let item_id;
                let column_name;
                let process = true;
                let columns = await connection.promise().query('show columns from items where Type = "text"');
                let message;
                let item = await connection.promise().query('select * from items where name like ? and guild_id = ?', ['%' + item_name + '%', interaction.guildId]);
                if (item[0].length > 0) { // CLEAN THIS MESS UP
                    if (item[0].length == 1) {
                        let keyValues = [];
                        item_id = item[0][0].id;
                        for (const column of columns[0]) {
                            keyValues.push({ label: column.Field, value: column.Field });
                        }
                        const selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('itemEditColumnSelector' + interaction.member.id).setMinValues(1).setMaxValues(1);
                        let selectRow = new ActionRowBuilder().addComponents(selectComponent);
                        message = await interaction.reply({ content: 'Please select a property from the dropdown to edit.', components: [selectRow], ephemeral: true });

                        //show dropdown for column to edit, then show modal
                    } else if (item[0].length > 25) {
                        await interaction.reply({ content: 'Your string match returned more than 25 items. Please try again with a more specific string match.', ephemeral: true });
                        process = false;
                    } else if (item[0].length > 1) {
                        let keyValues = [];
                        for (const thisitem of item[0]) {
                            keyValues.push({ label: thisitem.name, value: thisitem.id.toString() });
                        }
                        const selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('itemEdititemSelector' + interaction.member.id).setMinValues(1).setMaxValues(1);
                        let selectRow = new ActionRowBuilder().addComponents(selectComponent);
                        message = await interaction.reply({ content: 'Please select an item from the dropdown to edit.', components: [selectRow], ephemeral: true });
                        //show dropdown for item, then show dropdown for column, then show modal
                    } else {
                        await interaction.reply({ content: 'Your string match didn\'t return any results, try again please', ephemeral: true });
                        process = false;
                    }
                    if (process) {
                        let collector = message.createMessageComponentCollector();
                        collector.on('collect', async (interaction_second) => {
                            if (interaction_second.customId === 'itemEdititemSelector' + interaction_second.member.id) {
                                item_id = interaction_second.values[0];
                                let keyValues = [];
                                item_id = item[0][0].id;
                                for (const column of columns[0]) {
                                    keyValues.push({ label: column.Field, value: column.Field });
                                }
                                const selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('itemEditColumnSelector' + interaction_second.member.id).setMinValues(1).setMaxValues(1);
                                let selectRow = new ActionRowBuilder().addComponents(selectComponent);
                                await interaction_second.update({ content: 'Please select a property from the dropdown to edit.', components: [selectRow] });
                            } else if (interaction_second.customId === 'itemEditColumnSelector' + interaction_second.member.id) {
                                column_name = interaction_second.values[0];
                                let now = Date.now();
                                let modal = new ModalBuilder()
                                    .setCustomId('itemEditModal' + now);
                                modal.setTitle(`item Update - ${column_name}`);
                                let currentValue = await connection.promise().query(`select ?? as current_value from items where id = ?`, [column_name, item_id]);
                                let newValueInput = new TextInputBuilder()
                                    .setCustomId('newValue')
                                    .setLabel('New value for this field')
                                    .setPlaceholder(currentValue[0][0].current_value.substring(0, 100))
                                    .setStyle(TextInputStyle.Paragraph);
                                let valueActionRow = new ActionRowBuilder().addComponents(newValueInput);
                                modal.addComponents(valueActionRow);
                                await interaction_second.showModal(modal);
                                let submittedModal = await interaction_second.awaitModalSubmit({ time: 60000 });
                                if (submittedModal) {
                                    if (submittedModal.customId === ('itemEditModal' + now) && submittedModal.member.id == interaction.member.id) {
                                        const newValue = submittedModal.fields.getTextInputValue('newValue');
                                        await connection.promise().query('update items set ?? = ? where id = ?', [column_name, newValue, item_id]);
                                        submittedModal.update({ content: 'Successfully updated this item entry.', components: [] });
                                        collector.stop();
                                    }
                                }
                            }
                        });
                    }
                } else {
                    await interaction.reply({ content: 'No items found matching your entry. Please double check and try again.', ephemeral: true });
                }


            } else if (interaction.options.getSubcommand() === 'add') {
                let name = interaction.options.getString('itemname')
                let description = interaction.options.getString('description');
                let consumable = interaction.options.getBoolean('consumable');
                let self_targetable = interaction.options.getBoolean('self_targetable');
                let other_targetable = interaction.options.getBoolean('other_targetable');
                let equippable = interaction.options.getBoolean('equippable');
                await connection.promise().query('insert into items (name, description, guild_id, consumable, self_targetable, other_targetable, equippable) values (?, ?, ?, ?, ?, ?, ?)', [name, description, interaction.guildId, consumable, self_targetable, other_targetable, equippable]);
                if (equippable) {
                    interaction.reply({ content: 'Item added! Assign slots using `/itemadmin assignslot`', ephemeral: true });
                } else {
                    interaction.reply({ content: 'Item added!', ephemeral: true });
                }
            } else if (interaction.options.getSubcommand() === 'slotadd') {
                let name = interaction.options.getString('name');
                let slots = await connection.promise().query('select * from equipslots where guild_id = ? and name = ?', [interaction.guildId, name]);
                if (slots[0].length > 0) {
                    await interaction.reply({ content: 'oh no! there\'s already an item slot with this name.', ephemeral: true });
                } else {
                    await connection.promise().query('insert into equipslots (name, guild_id) values (?, ?)', [name, interaction.guildId]);
                    await interaction.reply({ content: 'Added the equipment slot.', ephemeral: true });
                }
            } else if (interaction.options.getSubcommand() === 'transfer') {
                let quantity = interaction.options.getInteger('quantity'); //implement in future state
                let characters = await connection.promise().query('select * from characters where guild_id = ?', [interaction.guildId]);
                if (characters[0].length > 0) {
                    let charactersKeyValues = [];
                    for (const character of characters[0]) {
                        charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                    }
                    const unassignItemComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('ItemUnassignmentCharacterSelector').setMinValues(1).setMaxValues(1);
                    let unassignItemRow = new ActionRowBuilder().addComponents(unassignItemComponent);
                    let message = await interaction.reply({ content: 'Select the character to remove item from.', components: [unassignItemRow], ephemeral: true });
                    let collector = message.createMessageComponentCollector();
                    let characterSelected;
                    let itemSelected;
                    collector.on('collect', async (interaction_second) => {
                        if (interaction.member.id === interaction_second.member.id) {
                            if (interaction_second.customId === 'ItemUnassignmentCharacterSelector') {
                                characterSelected = interaction_second.values[0];
                            } else {
                                itemSelected = interaction_second.values[0];
                            }
                            if (!itemSelected && characterSelected) {
                                let items = await connection.promise().query('select i.* from items i join characters_items ci on i.id = ci.item_id where ci.character_id = ?', [characterSelected]);
                                if (items[0].length > 0) {
                                    let itemsKeyValues = [];
                                    for (const item of items[0]) {
                                        itemsKeyValues.push({ label: item.name, value: item.id.toString() });
                                    }
                                    const unassignItemComponent2 = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('ItemUnassignmentItemSelector').setMinValues(1).setMaxValues(1);
                                    let unassignItemRow2 = new ActionRowBuilder().addComponents(unassignItemComponent2);
                                    await interaction_second.update({ content: 'Now select a item to unassign:', components: [unassignItemRow2] });
                                } else {
                                    await interaction_second.update({ content: 'Couldn\'t find any items for this cahracter.' });
                                    collector.stop();
                                }
                            }
                            if (itemSelected && characterSelected) {
                                await connection.promise().query('delete from characters_items where character_id = ? and item_id = ?', [characterSelected, itemSelected]);
                                await interaction_second.update({ content: "Item removed from character.", components: [] });
                                collector.stop();
                            }
                        }
                    });
                } else {
                    await interaction.reply({ content: "Couldn't find any characters to unassign items from.", ephemeral: true });
                }

            } else if (interaction.options.getSubcommand() === 'assign') {
                let quantity = interaction.options.getInteger('quantity');
                let items = await connection.promise().query('select i.* from items i where i.guild_id = ?', [interaction.guildId]);
                let itemSelectComponent;
                if (items[0].length > 0) {
                    if (items[0].length <= 25) {
                        let itemsKeyValues = [];
                        for (const item of items[0]) {
                            itemsKeyValues.push({ label: `${item.name}`, value: item.id.toString() });
                        }
                        itemSelectComponent = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('ItemAssignmentItemSelector').setMinValues(1).setMaxValues(1);
                    } else {
                        let items = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                        let itemsKeyValues = [];
                        for (const item of items) {
                            itemsKeyValues.push({ label: item, value: item });
                        }
                        itemSelectComponent = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('ItemAssignmentAlphabetSelector').setMinValues(1).setMaxValues(1);
                    }
                    const itemSelectRow = new ActionRowBuilder().addComponents(itemSelectComponent);
                    let characters = await connection.promise().query('select * from characters where guild_id = ?', [interaction.guildId]);
                    if (characters[0].length > 0) {
                        let charactersKeyValues = [{ label: 'Select a character', value: '0' }];
                        for (const character of characters[0]) {
                            charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                        }
                        const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('ItemAssignmentCharacterSelector').setMinValues(1).setMaxValues(charactersKeyValues.length);
                        let characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                        let message = await interaction.reply({ content: 'Please select the following options:', components: [itemSelectRow, characterSelectRow], ephemeral: true });
                        let collector = message.createMessageComponentCollector();
                        let charactersSelected;
                        let itemSelected;
                        let alphabetSelected;
                        collector.on('collect', async (interaction_second) => {
                            if (interaction.member.id === interaction_second.member.id) {
                                if (interaction_second.values[0]) {
                                    if (interaction_second.customId === 'ItemAssignmentItemSelector') {
                                        itemSelected = interaction_second.values[0];
                                    } else if (interaction_second.customId === 'ItemAssignmentAlphabetSelector') {
                                        alphabetSelected = interaction_second.values[0];
                                    } else if (interaction_second.customId === 'ItemAssignmentCharacterSelector') {
                                        charactersSelected = interaction_second.values;
                                    }
                                    if (alphabetSelected && !itemSelected) {
                                        let items;
                                        if (alphabetSelected.length == 1) {
                                            items = await connection.promise().query('select * from items where guild_id = ? and name like ?', [interaction_second.guildId, alphabetSelected + '%']);
                                        } else {
                                            await interaction_second.update({ content: 'Something has gone really horribly wrong, can you ask Alli maybe?', components: [] });
                                            await collector.stop();
                                        }
                                        let itemsKeyValues = [];
                                        for (const item of items[0]) {
                                            itemsKeyValues.push({ label: `${item.name}`, value: item.id.toString() });
                                        }
                                        const itemSelectComponent = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('ItemAssignmentItemSelector').setMinValues(1).setMaxValues(1);
                                        const itemSelectRow = new ActionRowBuilder().addComponents(itemSelectComponent);
                                        await interaction_second.update({ content: 'Please select the following options:', components: [itemSelectRow, characterSelectRow] });
                                    } else if (itemSelected && charactersSelected) {
                                        for (const characterSelected of charactersSelected) {
                                            let exists = await connection.promise().query('select * from characters_items where character_id = ? and item_id = ?', [characterSelected, itemSelected]);
                                            if (exists[0].length > 0) {
                                                if (quantity + exists[0][0].quantity <= 0) {
                                                    await connection.promise().query('delete from characters_items where character_id = ? and item_id = ?', [characterSelected, itemSelected]);
                                                } else {
                                                    await connection.promise().query('update characters_items set quantity = ? where character_id = ? and item_id = ?', [quantity + exists[0][0].quantity, characterSelected, itemSelected]);
                                                }
                                            } else {
                                                await connection.promise().query('insert into characters_items (character_id, item_id, quantity) values (?, ?, ?)', [characterSelected, itemSelected, quantity]);
                                            }
                                        }
                                        await interaction_second.update({ content: 'Successfully added items to selected character or characters.', components: [] });
                                        await collector.stop();
                                    } else {
                                        await interaction_second.deferUpdate();
                                    }
                                } else {
                                    await interaction_second.deferUpdate();
                                }
                            }
                        });
                    } else {
                        interaction.reply({ content: 'Couldn\'t find any characters, which is a bit odd. Try creating one, or yell at Alli if you shouldn\'t be getting this.', ephemeral: true });
                    }
                } else {
                    interaction.reply({ content: 'Please create at least one item first. <3', ephemeral: true });
                }
            } else if (interaction.options.getSubcommand() === 'vieweffects') {
                let selectedItemName;
                let item_partial = interaction.options.getString('name');
                let item = await connection.promise().query('select * from items where guild_id = ? and name like ?', [interaction.guildId, '%' + item_partial + '%']);
                if (item[0].length > 0) {
                    let message = false;
                    if (item[0].length == 1) {
                        selectedItemName = item[0][0].name;
                        let effects = await connection.promise().query('select ifnull(count(ep.id), 0) as prereq_count, e.* from effects e join items_effects ie on e.id = ie.effect_id left outer join effects_prereqs ep on e.id = ep.effect_id where ie.item_id = ? group by e.id', [item[0][0].id]);
                        let embed = new EmbedBuilder()
                            .setTitle(`Effects for ${selectedItemName}`);
                        let effectsString = '';
                        for (const effect of effects[0]) {
                            if (effect.type == 'item') {
                                let item = await connection.promise().query('select * from items where id = ?', [effect.type_id]);
                                effectsString += `Modify item count for ${item[0][0].name} by ${effect.type_qty}\n`;
                            } else if (effect.type == 'wflag_inc') {
                                let wflag = await connection.promise().query('select * from worldflags where id = ?', [effect.type_id]);
                                effectsString += `Increment value for worldflag ${wflag[0][0].name} by ${effect.type_qty}`;
                            } else if (effect.type == 'cflag_inc') {
                                let cflag = await connection.promise().query('select * from characterflags where id = ?', [effect.type_id]);
                                effectsString += `Increment value for characterflag ${cflag[0][0].name} by ${effect.type_qty}`;
                            } else if (effect.type == 'wflag_set') {
                                let wflag = await connection.promise().query('select * from worldflags where id = ?', [effect.type_id]);
                                effectsString += `Set value for worldflag ${wflag[0][0].name} to ${effect.type_qty}`;
                            } else if (effect.type == 'cflag_set') {
                                let cflag = await connection.promise().query('select * from characterflags where id = ?', [effect.type_id]);
                                effectsString += `Set value for characterflag ${cflag[0][0].name} to ${effect.type_qty}`;
                            } else if (effect.type == 'skill') {
                                let skill = await connection.promise().query('select * from skills where id = ?', [effect.type_id]);
                                effectsString += `Grant skill ${skill[0][0].name}`;
                            } else if (effect.type == 'archetype') {
                                let archetype = await connection.promise().query('select * from archetypes where id = ?', [effect.type_id]);
                                effectsString += `Grant archetype ${archetype[0][0].name}`;
                            } else if (effect.type == 'reputation_inc') {
                                let reputation = await connection.promise().query('select * from reputations where id = ?', [effect.type_id]);
                                effectsString += `Increment value for reputation ${reputation[0][0].name} by ${effect.type_qty}`;
                            } else if (effect.type == 'stat_inc') {
                                let stat = await connection.promise().query('select * from stats where id = ?', [effect.type_id]);
                                effectsString += `Increment value for stat ${stat[0][0].name} by ${effect.type_qty}`;
                            } else if (effect.type == 'reputation_set') {
                                let reputation = await connection.promise().query('select * from reputations where id = ?', [effect.type_id]);
                                effectsString += `Increment value for reputation ${reputation[0][0].name} by ${effect.type_qty}`;
                            } else if (effect.type == 'stat_set') {
                                let stat = await connection.promise().query('select * from stats where id = ?', [effect.type_id]);
                                effectsString += `Increment value for stat ${stat[0][0].name} by ${effect.type_qty}`;
                            } else if (effect.type == 'message') {
                                effectsString += `Send message \`${effect.typedata}\``;
                            }
                            effectsString += ` to ${effect.target} (${effect.prereq_count} prereqs)\n`;
                        }
                        embed.setDescription(effectsString);
                        await interaction.reply({ content: '', embeds: [embed], ephemeral: true });
                    } else {
                        let keyValues = [];
                        for (const thisItem of item[0]) {
                            keyValues.push({ label: thisItem.name, value: thisItem.id.toString() });
                        }
                        const selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('EffectViewItemSelector').setMinValues(1).setMaxValues(1);
                        const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                        message = await interaction.reply({ content: 'Please select an item:', components: [selectRow], ephemeral: true });

                    }
                    if (message) {
                        let collector = message.createMessageComponentCollector();
                        collector.on('collect', async (interaction_second) => {
                            if (interaction_second.member.id === interaction.member.id) {
                                if (interaction_second.customId === 'EffectViewItemSelector') {
                                    let item = await connection.promise().query('select * from items where id = ?', interaction_second.values[0]);
                                    selectedItemName = item[0][0].name;
                                    let effects = await connection.promise().query('select ifnull(count(ep.id), 0) as prereq_count, e.* from effects e join items_effects ie on e.id = ie.effect_id left outer join effects_prereqs ep on e.id = ep.effect_id where ie.item_id = ? group by e.id', [interaction_second.values[0]]);
                                    let embed = new EmbedBuilder()
                                        .setTitle(`Effects for ${selectedItemName}`);
                                    let effectsString = '';
                                    for (const effect of effects[0]) {
                                        if (effect.type == 'item') {
                                            let item = await connection.promise().query('select * from items where id = ?', [effect.type_id]);
                                            effectsString += `Modify item count for ${item[0][0].name} by ${effect.type_qty}\n`;
                                        } else if (effect.type == 'wflag_inc') {
                                            let wflag = await connection.promise().query('select * from worldflags where id = ?', [effect.type_id]);
                                            effectsString += `Increment value for worldflag ${wflag[0][0].name} by ${effect.type_qty}`;
                                        } else if (effect.type == 'cflag_inc') {
                                            let cflag = await connection.promise().query('select * from characterflags where id = ?', [effect.type_id]);
                                            effectsString += `Increment value for characterflag ${cflag[0][0].name} by ${effect.type_qty}`;
                                        } else if (effect.type == 'wflag_set') {
                                            let wflag = await connection.promise().query('select * from worldflags where id = ?', [effect.type_id]);
                                            effectsString += `Set value for worldflag ${wflag[0][0].name} to ${effect.type_qty}`;
                                        } else if (effect.type == 'cflag_set') {
                                            let cflag = await connection.promise().query('select * from characterflags where id = ?', [effect.type_id]);
                                            effectsString += `Set value for characterflag ${cflag[0][0].name} to ${effect.type_qty}`;
                                        } else if (effect.type == 'skill') {
                                            let skill = await connection.promise().query('select * from skills where id = ?', [effect.type_id]);
                                            effectsString += `Grant skill ${skill[0][0].name}`;
                                        } else if (effect.type == 'archetype') {
                                            let archetype = await connection.promise().query('select * from archetypes where id = ?', [effect.type_id]);
                                            effectsString += `Grant archetype ${archetype[0][0].name}`;
                                        } else if (effect.type == 'reputation_inc') {
                                            let reputation = await connection.promise().query('select * from reputations where id = ?', [effect.type_id]);
                                            effectsString += `Increment value for reputation ${reputation[0][0].name} by ${effect.type_qty}`;
                                        } else if (effect.type == 'stat_inc') {
                                            let stat = await connection.promise().query('select * from stats where id = ?', [effect.type_id]);
                                            effectsString += `Increment value for stat ${stat[0][0].name} by ${effect.type_qty}`;
                                        } else if (effect.type == 'reputation_set') {
                                            let reputation = await connection.promise().query('select * from reputations where id = ?', [effect.type_id]);
                                            effectsString += `Increment value for reputation ${reputation[0][0].name} by ${effect.type_qty}`;
                                        } else if (effect.type == 'stat_set') {
                                            let stat = await connection.promise().query('select * from stats where id = ?', [effect.type_id]);
                                            effectsString += `Increment value for stat ${stat[0][0].name} by ${effect.type_qty}`;
                                        } else if (effect.type == 'message') {
                                            effectsString += `Send message \`${effect.typedata}\``;
                                        }
                                        effectsString += ` to ${effect.target} (${effect.prereq_count} prereqs)\n`;
                                    }
                                    embed.setDescription(effectsString);
                                    await interaction_second.update({ content: '', components: [], embeds: [embed] });
                                    await collector.stop();
                                }
                            }
                        });
                    }
                } else {
                    await interaction.reply({ content: 'No item in this game matched the name you gave. Please try again.', ephemeral: true });
                }
            }
        } else if (interaction.commandName === 'setarchetypestat') {
            let value = interaction.options.getInteger('value');
            // Create two dropdowns. For character and stat. See characterlocation for details.
            let stats = await connection.promise().query('select * from archetypestats where guild_id = ?', [interaction.guildId]);
            if (stats[0].length > 0) {
                let statsKeyValues = [];
                for (const stat of stats[0]) {
                    statsKeyValues.push({ label: stat.name, value: stat.id.toString() });
                }
                const statSelectComponent = new StringSelectMenuBuilder().setOptions(statsKeyValues).setCustomId('ArchetypeStatAssignmentStatSelector').setMinValues(1).setMaxValues(1);
                let statSelectRow = new ActionRowBuilder().addComponents(statSelectComponent);

                let message = await interaction.reply({ content: 'Select a stat:', components: [statSelectRow], ephemeral: true });
                const collector = message.createMessageComponentCollector({ time: 35000 });
                let archetypeStatSelected;
                let characterSelected;
                collector.on('collect', async (interaction_second) => {
                    if (interaction_second.member.id === interaction.member.id) {
                        if (interaction_second.values[0]) {
                            if (interaction_second.customId === 'ArchetypeStatAssignmentStatSelector') {
                                archetypeStatSelected = interaction_second.values[0];
                                let archetype = await connection.promise().query('select archetype_id from archetypes_archetypestats where archetypestat_id = ?', [archetypeStatSelected]);
                                let characters = await connection.promise().query('select c.* from characters c join characters_archetypes ca on c.id = ca.character_id where guild_id = ? and ca.archetype_id = ?', [interaction.guildId, archetype[0][0].archetype_id]);
                                if (characters[0].length > 0) {
                                    let charactersKeyValues = [];
                                    for (const character of characters[0]) {
                                        charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                                    }
                                    const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('ArchetypeStatAssignmentCharacterSelector').setMinValues(1).setMaxValues(1);
                                    const characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                                    await interaction_second.update({ content: 'Select a character, please.', components: [characterSelectRow] }); //interaction_second.editReply()
                                } else {
                                    await interaction_second.update({ content: 'Couldn\'t find any valid characters for this archetype stat.', components: [] });
                                    await collector.stop();
                                }
                            } else {
                                characterSelected = interaction_second.values[0];
                            }
                            if (archetypeStatSelected && characterSelected) {
                                let exists = await connection.promise().query('select * from characters_archetypestats where stat_id = ? and character_id = ?', [archetypeStatSelected, characterSelected]);
                                if (exists[0].length > 0) {
                                    await connection.promise().query('update characters_archetypestats set override_value = ? where character_id = ? and stat_id = ?', [value, characterSelected, archetypeStatSelected]);
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
                    }
                });
            } else {
                interaction.reply({ content: 'You haven\'t created any characters yet. Try creating a character first.', ephemeral: true });
            }
        } else if (interaction.commandName === 'modsheet') {
            let characters = await connection.promise().query('select * from characters where guild_id = ?', [interaction.guildId]);
            if (characters[0].length > 0) {
                let charactersAlphabetical;
                let characterSelectComponent;
                if (characters[0].length <= 25) {
                    charactersAlphabetical = false;
                    let charactersKeyValues = [];
                    for (const character of characters[0]) {
                        charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                    }
                    characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('ModSheetCharacterSelector').setMinValues(1).setMaxValues(1);
                } else {
                    charactersAlphabetical = true;
                    characters = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                    let charactersKeyValues = [];
                    for (const character of characters) {
                        charactersKeyValues.push({ label: character, value: character });
                    }
                    characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('ModSheetAlphabetSelector').setMinValues(1).setMaxValues(1);
                }
                let characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                let message = await interaction.reply({ content: 'Please select a character:', components: [characterSelectRow], ephemeral: true });
                let collector = message.createMessageComponentCollector();
                collector.on('collect', async (interaction_second) => {
                    if (interaction.member.id === interaction_second.member.id) {
                        let characterSelected = interaction_second.values[0];
                        if (interaction_second.customId === 'ModSheetAlphabetSelector') {
                            characters = await connection.promise().query('select * from characters where guild_id = ? and upper(name) like ?', [interaction.guildId, characterSelected + '%']);
                            if (characters[0].length > 0) {
                                let charactersKeyValues = [{ label: 'Select a characters', value: '0' }];
                                for (const character of characters[0]) {
                                    charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                                }
                                const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('ModSheetCharacterSelector').setMinValues(1).setMaxValues(1);
                                const characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                                interaction_second.update({ components: [characterSelectRow] });
                            } else {
                                interaction_second.update({ content: 'No characters with this first letter', components: [] });
                                collector.stop();
                            }
                        } else {
                            let character_information = await connection.promise().query('select * from characters where id = ?', [characterSelected]);
                            let character_archetypes = await connection.promise().query('select * from archetypes a join characters_archetypes ca on ca.archetype_id = a.id where ca.character_id = ?', [characterSelected]);
                            let character_stats = await connection.promise().query('select s.*, cs.override_value from stats s left outer join characters_stats cs on cs.stat_id = s.id and cs.character_id = ? where guild_id = ? order by s.id asc', [characterSelected, interaction.guildId]);
                            let archetype_stats = await connection.promise().query('select ars.*, ca2.override_value from archetypestats ars join archetypes_archetypestats aa on ars.id = aa.archetypestat_id join characters_archetypes ca on aa.archetype_id = ca.archetype_id and ca.character_id = ? left outer join characters_archetypestats ca2 on ca2.stat_id = ars.id and ca2.character_id = ?', [characterSelected, characterSelected]);
                            let world_flags = await connection.promise().query('select * from worldflags where guild_id = ? and visible = 1', [interaction.guildId]);
                            let msg = `**${character_information[0][0].name}** - ${character_information[0][0].description}\n`
                            if (character_archetypes[0].length > 0) {
                                msg = msg.concat(`\n__Archetypes__\n`);
                                for (const thisArchetype of character_archetypes[0]) {
                                    msg = msg.concat(`**${thisArchetype.name}** - ${thisArchetype.description}\n`);
                                }
                            }
                            if (character_stats[0].length > 0 || archetype_stats[0].length > 0 || world_flags[0].length > 0) {
                                msg = msg.concat(`\n__Stats__\n`);
                            }
                            if (character_stats[0].length > 0) {
                                for (const thisStat of character_stats[0]) {
                                    if (typeof thisStat.override_value !== 'undefined' && thisStat.override_value != null) {
                                        msg = msg.concat(`**${thisStat.name}** - ${thisStat.override_value}\n`);
                                    } else { // TODO else if thisStat has an ARCHETYPE override value
                                        msg = msg.concat(`**${thisStat.name}** - ${thisStat.default_value}\n`);
                                    }

                                }
                            }
                            if (archetype_stats[0].length > 0) {
                                for (const thisStat of archetype_stats[0]) {
                                    if (typeof thisStat.override_value !== 'undefined' && thisStat.override_value != null) {
                                        msg = msg.concat(`**${thisStat.name}** - ${thisStat.override_value}\n`);
                                    } else { // TODO else if thisStat has an ARCHETYPE override value
                                        msg = msg.concat(`**${thisStat.name}** - ${thisStat.default_value}\n`);
                                    }
                                }
                            }
                            if (world_flags[0].length > 0) {
                                // TODO
                                msg = msg.concat('\n--- *World Information* ---\n\n');
                                for (const thisFlag of world_flags[0]) {
                                    msg = msg.concat(`**${thisFlag.name}** - ${thisFlag.value}\n`);
                                }
                            }
                            const buttonActionRow = new ActionRowBuilder()
                                .addComponents(
                                    new ButtonBuilder().setCustomId(`skillpage-asc-${characterSelected}-1`).setLabel('Skills').setStyle(ButtonStyle.Primary),
                                    new ButtonBuilder().setCustomId(`inventory-asc-${characterSelected}-1`).setLabel('Inventory').setStyle(ButtonStyle.Primary)
                                );

                            let reputation_enabled = await connection.promise().query('select * from game_settings where setting_name = "reputation" and guild_id = ?', [interaction.guildId]);
                            if (reputation_enabled[0].length > 0 && reputation_enabled[0][0].setting_value == true) {
                                buttonActionRow.addComponents(new ButtonBuilder().setCustomId(`reputation-asc-${characterSelected}-1`).setLabel('Reputation').setStyle(ButtonStyle.Primary));
                            }
                            await interaction_second.update({ content: msg, components: [buttonActionRow] });
                            await collector.stop();
                        }
                    }
                });
            } else {
                await interaction.reply({ content: 'There don\'t seem to be any characters, have you made any?', ephemeral: true });
            }
            //dropdown for characters
            //then generate character sheet ephemeral using the sheet code EXACTLY
        } else if (interaction.commandName === 'assignspecialstat') {
            let stats = await connection.promise().query('select * from stats left outer join stats_specialstats sps on stats.id = sps.stat_id where guild_id = ? and sps.special_type is null', [interaction.guildId]);
            if (stats[0].length > 0) {
                let typesKeyValues = [
                    { label: 'Health', value: 'health' },
                    { label: 'Movement Speed', value: 'movement' }
                ];
                let statsKeyValues = [];
                for (const stat of stats[0]) {
                    statsKeyValues.push({ label: stat.name, value: stat.id.toString() });
                }
                const typeSelectComponent = new StringSelectMenuBuilder().setOptions(typesKeyValues).setCustomId('SpecialStatTypeSelector').setMinValues(1).setMaxValues(1);
                const typeSelectRow = new ActionRowBuilder().addComponents(typeSelectComponent);
                const statSelectComponent = new StringSelectMenuBuilder().setOptions(statsKeyValues).setCustomId('SpecialStatStatSelector').setMinValues(1).setMaxValues(1);
                const statSelectRow = new ActionRowBuilder().addComponents(statSelectComponent);
                let message = await interaction.reply({ content: 'Please select the following options:', components: [typeSelectRow, statSelectRow], ephemeral: true });
                let collector = message.createMessageComponentCollector();
                let statSelected;
                let typeSelected;
                collector.on('collect', async (interaction_second) => {
                    if (interaction.member.id === interaction_second.member.id) {
                        if (interaction_second.customId === 'SpecialStatTypeSelector') {
                            typeSelected = interaction_second.values[0];
                        } else if (interaction_second.customId === 'SpecialStatStatSelector') {
                            statSelected = interaction_second.values[0];
                        }

                        if (statSelected && typeSelected) {
                            let exists = await connection.promise().query('select * from stats_specialstats join stats on stats_specialstats.stat_id = stats.id where special_type = ? and stats.guild_id = ?', [typeSelected, interaction.guildId]);
                            if (exists[0].length > 0) {
                                await connection.promise().query('update stats_specialstats set stat_id = ? where stat_id = ?', [statSelected, exists[0][0].stat_id]);
                            } else {
                                await connection.promise().query('insert into stats_specialstats (stat_id, special_type) values (?, ?)', [statSelected, typeSelected]);
                            }
                            await interaction_second.update({ content: 'Updated special stat.', components: [] });
                            await collector.stop();
                        } else {
                            await interaction_second.deferUpdate();
                        }
                    }
                });
            } else {
                await interaction.reply({ content: 'There aren\'t any eligible stats for this! Please double-check and ensure that you have a stat that\'s not assigned to a special function.', ephemeral: true });
            }
        } else if (interaction.commandName === 'characterflag') {
            if (interaction.options.getSubcommand() === 'add') {
                let name = interaction.options.getString('name');
                await connection.promise().query('insert into characterflags (name, guild_id) values (?, ?)', [name, interaction.guildId]);
                await interaction.reply({ content: 'Character flag added.', ephemeral: true });
            }
        } else if (interaction.commandName === 'worldflag') {
            if (interaction.options.getSubcommand() === 'add') {
                let name = interaction.options.getString('name');
                let visible = interaction.options.getString('visible') || false;
                await connection.promise().query('insert into worldflags (name, guild_id, visible) values (?, ?, ?)', [name, interaction.guildId, visible]);
                await interaction.reply({ content: 'World flag added.', ephemeral: true });
            }
        } else if (interaction.commandName === 'reputation') {
            if (interaction.options.getSubcommand() === 'charactersummary') {
                let reputations = await connection.promise().query('select * from reputations where guild_id = ? and name like ?', [interaction.guildId, '%' + interaction.options.getString('reputation_name') + '%']);
                if (reputations[0].length > 0) {
                    if (reputations[0].length == 1) {
                        let reputations_tiers_characters = await connection.promise().query('SELECT r.*, rt.threshold_name, c.name AS character_name, c.id AS character_id, cr.value AS rep_value, rt.value AS tier_value FROM reputations r JOIN characters_reputations cr ON r.id = cr.reputation_id JOIN reputations_tiers rt ON r.id = rt.reputation_id JOIN characters c ON cr.character_id = c.id WHERE r.id = ? AND rt.value <= cr.value order by c.name', [reputations[0][0].id]);
                        let reputations_sorted = [];
                        //let message = '';
                        for (const thisCharacter of reputations_tiers_characters[0]) {
                            if (!reputations_sorted.find(i => i.character_id === thisCharacter.character_id)) {
                                reputations_sorted.push(thisCharacter);
                            } else {
                                let highest = reputations_sorted.find(i => i.character_id === thisCharacter.character_id);
                                if (highest.tier_value < thisCharacter.tier_value) {
                                    let index = reputations_sorted.findIndex(i => i.character_id === thisCharacter.character_id);
                                    reputations_sorted[index] = thisCharacter;
                                }
                            }
                        }
                        console.log(reputations_sorted);
                        names = '';
                        values = '';
                        let embed = new EmbedBuilder();
                        embed.setTitle(`Reputation Summary for ${reputations[0][0].name}`);
                        for (const characterDisplay of reputations_sorted) {
                            console.log(characterDisplay.character_name);
                            //message = message.concat(characterDisplay.character_name + ' - ' + characterDisplay.threshold_name + '\n');
                            names = names.concat(characterDisplay.character_name + '\n');
                            values = values.concat(characterDisplay.threshold_name + ' (' + characterDisplay.rep_value + ')\n');
                        }
                        //await interaction.reply({ content: message });
                        //embed.setDescription(message);
                        embed.addFields({ name: 'Characters', value: names, inline: true }, { name: 'Standing', value: values, inline: true });
                        await interaction.reply({ content: '', embeds: [embed], ephemeral: true });
                    } else {
                        await interaction.reply({ content: 'More than one reputation was found matching your query. Try again, please.', ephemeral: true });
                    }
                } else {
                    await interaction.reply({ content: 'No reputations found matching your query.', ephemeral: true });
                }
            }
            if (interaction.options.getSubcommand() === 'enable') {
                let enabled = interaction.options.getBoolean('enabled');
                await connection.promise().query('replace into game_settings (setting_name, setting_value, guild_id) values (?, ?, ?)', ['reputation', enabled, interaction.guildId]);
                interaction.reply({ content: 'Reputation system enabled set to ' + enabled, ephemeral: true });
            }
            if (interaction.options.getSubcommand() === 'add') {
                let name = interaction.options.getString('name');
                let description = interaction.options.getString('description');
                let visibility = interaction.options.getString('visibility');
                let maximum = interaction.options.getInteger('maximum');
                let icon = interaction.options.getString('icon');
                let reputations = await connection.promise().query('select * from reputations where name = ? and guild_id = ?', [name, interaction.guildId]);
                if (reputations[0].length > 0) {
                    await interaction.reply({ content: `You've already added a reputation with name ${name}.`, ephemeral: true });
                } else {
                    let cflags;
                    let wflags;
                    if (visibility == 'cflag') {
                        cflags = await connection.promise().query('select * from characterflags where guild_id = ?', [interaction.guildId]);
                    } else if (visibility == 'wflag') {
                        wflags = await connection.promise().query('select * from worldflags where guild_id = ?', [interaction.guildId]);
                    }
                    if ((visibility == 'cflag' && cflags[0].length == 0) || (visibility == 'wflag' && wflags[0].length == 0)) {
                        await interaction.reply({ mescontentsage: 'No flags of the specified type exist in this game yet.', ephemeral: true });
                    } else if (visibility == 'always' || visibility == 'never') {
                        await connection.promise().query('insert into reputations (name, guild_id, description, visibility, maximum, start_value) values (?, ?, ?, ?, ?, ?)', [name, interaction.guildId, description, visibility, maximum, 0]);
                        await interaction.reply({ content: 'Reputation added.', ephemeral: true });
                    } else {
                        // build modal
                        let now = Date.now();
                        let modal = new ModalBuilder()
                            .setCustomId('RepCWFlagModal' + now);
                        if (visibility == 'cflag') {
                            modal.setTitle('Character Flag Selection');
                        } else {
                            modal.setTitle('World Flag Selection');
                        }
                        let flagNameInput = new TextInputBuilder()
                            .setCustomId('flagName')
                            .setLabel('Name of flag (bot will autocomplete)')
                            .setStyle(TextInputStyle.Short);
                        let flagValueInput = new TextInputBuilder()
                            .setCustomId('flagValue')
                            .setLabel('Minimum value of the flag')
                            .setStyle(TextInputStyle.Short);
                        let nameActionRow = new ActionRowBuilder().addComponents(flagNameInput);
                        let valueActionRow = new ActionRowBuilder().addComponents(flagValueInput);
                        modal.addComponents(nameActionRow, valueActionRow);
                        await interaction.showModal(modal);
                        let submittedModal = await interaction.awaitModalSubmit({ time: 60000 });
                        if (submittedModal && submittedModal.customId === 'RepCWFlagModal' + now && submittedModal.member.id === interaction.member.id) {
                            let cwflag_name = submittedModal.fields.getTextInputValue('flagName');
                            let value = submittedModal.fields.getTextInputValue('flagValue');
                            let cwflags;
                            if (visibility == 'cflag') {
                                cwflags = await connection.promise().query('select * from characterflags where lower(name) like lower(?) and guild_id = ?', ['%' + cwflag_name + '%', submittedModal.guildId]); // where lower(name) like lower("%?%") and guild_id = ?', [cwflag_name, interaction.guildId]);
                            } else {
                                cwflags = await connection.promise().query('select * from worldflags where lower(name) like lower(?) and guild_id = ?', ['%' + cwflag_name + '%', submittedModal.guildId]);
                            }
                            await submittedModal.reply({ content: 'Checking for flags...', ephemeral: true });
                            if (cwflags[0].length < 1) {
                                await submittedModal.editReply({ content: "No flags with that name exist.", ephemeral: true });
                            } else if (cwflags[0].length == 1) {
                                await connection.promise().query('insert into reputations (name, guild_id, description, visibility, maximum, start_value, cwflag_id, cwflag_value) values (?, ?, ?, ?, ?, ?, ?, ?)', [name, submittedModal.guildId, description, visibility, maximum, 0, cwflags[0][0].id, value]);
                                await submittedModal.editReply({ content: "Reputation added.", ephemeral: true });
                            } else {
                                let cwflagSelectComponent;
                                if (cwflags[0].length <= 25) {
                                    let cwflagsKeyValues = [];
                                    for (const cwflag of cwflags[0]) {
                                        cwflagsKeyValues.push({ label: cwflag.name, value: cwflag.id.toString() });
                                    }
                                    cwflagSelectComponent = new StringSelectMenuBuilder().setOptions(cwflagsKeyValues).setCustomId('RepVisCwflagSelector').setMinValues(1).setMaxValues(1);
                                } else {
                                    cwflags = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                                    let cwflagsKeyValues = [];
                                    for (const cwflag of cwflags) {
                                        cwflagsKeyValues.push({ label: cwflag, value: cwflag });
                                    }
                                    cwflagSelectComponent = new StringSelectMenuBuilder().setOptions(cwflagsKeyValues).setCustomId('RepVisCwAlphaSelector').setMinValues(1).setMaxValues(1);
                                }
                                const cwflagSelectRow = new ActionRowBuilder().addComponents(cwflagSelectComponent);
                                let message = await submittedModal.editReply({ content: 'Please select the following options:', components: [cwflagSelectRow], ephemeral: true });
                                collector = message.createMessageComponentCollector();
                                collector.on('collect', async (interaction_third) => {
                                    if (interaction_third.member.id === interaction.member.id) {
                                        if (interaction_third.customId === 'RepVisCwflagSelector') {
                                            let cwflag_id = interaction_third.values[0];
                                            await connection.promise().query('insert into reputations (name, guild_id, description, visibility, maximum, start_value, cwflag_id, cwflag_value) values (?, ?, ?, ?, ?, ?, ?, ?)', [name, interaction.guildId, description, visibility, maximum, start_value, cwflag_id, value]);
                                            submittedModal.editReply({ content: 'Reputation added.', components: [] });
                                            collector.stop();
                                            // create modal
                                        } else if (interaction_third.customId === 'RepVisCwAlphaSelector') {
                                            let cwflags;
                                            if (visibility == 'cflag') {
                                                cwflags = await connection.promise().query('select * from characterflags where guild_id = ? and lower(name) like lower(?) and upper(name) like ?', [interaction.guildId, '%' + cwflag_name + '%', characterSelected + '%']);
                                            } else {
                                                cwflags = await connection.promise().query('select * from worldflags where guild_id = ? and lower(name) like lower(?) and upper(name) like ?', [interaction.guildId, '%' + cwflag_name + '%', characterSelected + '%']);
                                            }
                                            if (cwflags[0].length > 0) {
                                                let cwflagsKeyValues = [];
                                                for (const cwflag of cwflags[0]) {
                                                    cwflagsKeyValues.push({ label: cwflag.name, value: cwflag.id.toString() });
                                                }
                                                const cwflagSelectComponent = new StringSelectMenuBuilder().setOptions(cwflagsKeyValues).setCustomId('RepVisCwflagSelector').setMinValues(1).setMaxValues(1);
                                                const cwflagSelectRow = new ActionRowBuilder().addComponents(cwflagSelectComponent);
                                                submittedModal.editReply({ components: [cwflagSelectRow] });
                                            } else {
                                                submittedModal.editReply({ content: 'No flags with this first letter', components: [] });
                                                collector.stop();
                                            }
                                        }
                                    }
                                });
                            }
                        }
                    }
                }
            } else if (interaction.options.getSubcommand() === 'tieradd') {
                let name = interaction.options.getString('name');
                let value = interaction.options.getInteger('value');
                let reputations = await connection.promise().query('select * from reputations where guild_id = ?', [interaction.guildId]);
                let reputationSelectComponent;
                if (reputations[0].length <= 25) {
                    let reputationsKeyValues = [];
                    for (const reputation of reputations[0]) {
                        reputationsKeyValues.push({ label: reputation.name, value: reputation.id.toString() });
                    }
                    reputationSelectComponent = new StringSelectMenuBuilder().setOptions(reputationsKeyValues).setCustomId('RepSelector').setMinValues(1).setMaxValues(1);
                } else {
                    reputations = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                    let reputationsKeyValues = [];
                    for (const reputation of reputations) {
                        reputationsKeyValues.push({ label: reputation, value: reputation });
                    }
                    reputationSelectComponent = new StringSelectMenuBuilder().setOptions(reputationsKeyValues).setCustomId('RepAlphaSelector').setMinValues(1).setMaxValues(1);
                }
                const reputationSelectRow = new ActionRowBuilder().addComponents(reputationSelectComponent);
                let message = await interaction.reply({ content: 'Please select the following options:', components: [reputationSelectRow], ephemeral: true });
                collector = message.createMessageComponentCollector();
                collector.on('collect', async (interaction_second) => {
                    if (interaction_second.member.id === interaction.member.id) {
                        if (interaction_second.customId === 'RepSelector') {
                            let reputation_id = interaction_second.values[0];
                            let reputations = await connection.promise().query('select rt.*, r.maximum from reputations_tiers rt join reputations r on rt.reputation_id = r.id where rt.threshold_name = ? and rt.reputation_id = ?', [name, reputation_id]);
                            if (reputations[0].length > 0) {
                                interaction_second.update({ content: 'A reputation tier with this name already exists for this reputation.', components: [] });
                                collector.stop();
                            } else {
                                let reputation = await connection.promise().query('select * from reputations where id = ?', [reputation_id]);
                                if (reputation[0][0].maximum < value) {
                                    interaction_second.update({ content: 'You entered a reputation tier minimum value higher than this reputation\'s maximum value.', components: [] });
                                    collector.stop();
                                } else {
                                    await connection.promise().query('insert into reputations_tiers (reputation_id, threshold_name, value) values (?, ?, ?)', [reputation_id, name, value]);
                                    interaction_second.update({ content: "Reputation tier added.", components: [] });
                                    collector.stop();
                                }
                            }
                            //add tier
                        } else if (interaction_second.customId === 'RepAlphaSelector') {
                            let reputations = await connection.promise().query('select * from reputations where name like ? and guild_id = ?', ['%' + interaction_second.values[0], interaction.guildId]);
                            if (reputations[0].length <= 25) {
                                let reputationsKeyValues = [];
                                for (const reputation of reputations[0]) {
                                    reputationsKeyValues.push({ label: reputation.name, value: reputation.id.toString() });
                                }
                                let reputationSelectComponent = new StringSelectMenuBuilder().setOptions(reputationsKeyValues).setCustomId('RepSelector').setMinValues(1).setMaxValues(1);
                                const reputationSelectRow = new ActionRowBuilder().addComponents(reputationSelectComponent);
                                interaction_second.update({ components: [reputationSelectRow] });
                            } else {
                                interaction_second.update({ content: 'No reputations with this first letter', components: [] });
                                collector.stop();
                            }
                        }
                    }
                });
            } else if (interaction.options.getSubcommand() === 'vieweffects') {
                let selectedReputationName;
                let selectedTierName;
                let rep_partial = interaction.options.getString('reputation');
                let reputation = await connection.promise().query('select * from reputations where guild_id = ? and name like ?', [interaction.guildId, '%' + rep_partial + '%']);
                if (reputation[0].length > 0) {
                    let message = false;
                    if (reputation[0].length == 1) {
                        selectedReputationName = reputation[0][0].name;
                        let tiers = await connection.promise().query('select distinct rt.* from reputations_tiers rt join reputations_tiers_effects rte on rt.id = rte.reputationtier_id where rte.effect_id is not null and rt.reputation_id = ?', reputation[0][0].id);
                        let keyValues = [];
                        if (tiers[0].length > 0) {
                            for (const thisRep of tiers[0]) {
                                keyValues.push({ label: thisRep.threshold_name, value: thisRep.id.toString() });
                            }
                            const selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('EffectViewTierSelector').setMinValues(1).setMaxValues(1);
                            const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                            message = await interaction.reply({ content: 'Please select a reputation tier:', components: [selectRow], ephemeral: true });
                        } else {
                            await interaction.reply({ content: 'There is no reputation tier with an effect in this reputation. Sorry.', ephemeral: true });
                        }
                    } else {
                        let keyValues = [];
                        for (const thisRep of reputation[0]) {
                            keyValues.push({ label: thisRep.name, value: thisRep.id.toString() });
                        }
                        const selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('EffectViewRepSelector').setMinValues(1).setMaxValues(1);
                        const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                        message = await interaction.reply({ content: 'Please select a reputation:', components: [selectRow], ephemeral: true });

                    }
                    if (message) {
                        let collector = message.createMessageComponentCollector();
                        collector.on('collect', async (interaction_second) => {
                            if (interaction_second.member.id === interaction.member.id) {
                                if (interaction_second.customId === 'EffectViewRepSelector') {
                                    let rep = await connection.promise().query('select * from reputations where id = ?', intearction_second.values[0]);
                                    selectedReputationName = rep[0][0].threshold_name;
                                    let tiers = await connection.promise().query('select distinct rt.* from reputations_tiers rt join reputations_tiers_effects rte on rt.id = rte.reputationtier_id where rte.effect_id is not null and rt.reputation_id = ?', [interaction_second.values[0]]);
                                    let keyValues = [];
                                    if (tiers[0].length > 0) {
                                        for (const thisRep of tiers[0]) {
                                            keyValues.push({ label: thisRep.threshold_name, value: thisRep.id.toString() });
                                        }
                                        const selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('EffectViewTierSelector').setMinValues(1).setMaxValues(1);
                                        const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                                        message = await interaction_second.update({ content: 'Please select a reputation tier:', components: [selectRow], ephemeral: true });
                                    } else {
                                        await interaction_second.update({ content: 'There is no reputation tier with an effect in this reputation. Sorry.', ephemeral: true });
                                        collector.stop();
                                    }
                                } else if (interaction_second.customId === 'EffectViewTierSelector') {
                                    let tier = await connection.promise().query('select * from reputations_tiers where id = ?', interaction_second.values[0]);
                                    selectedTierName = tier[0][0].threshold_name;
                                    let effects = await connection.promise().query('select ifnull(count(ep.id), 0) as prereq_count, e.* from effects e join reputations_tiers_effects rte on e.id = rte.effect_id left outer join effects_prereqs ep on e.id = ep.effect_id where rte.reputationtier_id = ? group by e.id', [interaction_second.values[0]]);
                                    let embed = new EmbedBuilder()
                                        .setTitle(`Effects for ${selectedReputationName} - ${selectedTierName}`);
                                    let effectsString = '';
                                    for (const effect of effects[0]) {
                                        if (effect.type == 'item') {
                                            let item = await connection.promise().query('select * from items where id = ?', [effect.type_id]);
                                            effectsString += `Modify item count for ${item[0][0].name} by ${effect.type_qty}\n`;
                                        } else if (effect.type == 'wflag_inc') {
                                            let wflag = await connection.promise().query('select * from worldflags where id = ?', [effect.type_id]);
                                            effectsString += `Increment value for worldflag ${wflag[0][0].name} by ${effect.type_qty}`;
                                        } else if (effect.type == 'cflag_inc') {
                                            let cflag = await connection.promise().query('select * from characterflags where id = ?', [effect.type_id]);
                                            effectsString += `Increment value for characterflag ${cflag[0][0].name} by ${effect.type_qty}`;
                                        } else if (effect.type == 'wflag_set') {
                                            let wflag = await connection.promise().query('select * from worldflags where id = ?', [effect.type_id]);
                                            effectsString += `Set value for worldflag ${wflag[0][0].name} to ${effect.type_qty}`;
                                        } else if (effect.type == 'cflag_set') {
                                            let cflag = await connection.promise().query('select * from characterflags where id = ?', [effect.type_id]);
                                            effectsString += `Set value for characterflag ${cflag[0][0].name} to ${effect.type_qty}`;
                                        } else if (effect.type == 'skill') {
                                            let skill = await connection.promise().query('select * from skills where id = ?', [effect.type_id]);
                                            effectsString += `Grant skill ${skill[0][0].name}`;
                                        } else if (effect.type == 'archetype') {
                                            let archetype = await connection.promise().query('select * from archetypes where id = ?', [effect.type_id]);
                                            effectsString += `Grant archetype ${archetype[0][0].name}`;
                                        } else if (effect.type == 'reputation_inc') {
                                            let reputation = await connection.promise().query('select * from reputations where id = ?', [effect.type_id]);
                                            effectsString += `Increment value for reputation ${reputation[0][0].name} by ${effect.type_qty}`;
                                        } else if (effect.type == 'stat_inc') {
                                            let stat = await connection.promise().query('select * from stats where id = ?', [effect.type_id]);
                                            effectsString += `Increment value for stat ${stat[0][0].name} by ${effect.type_qty}`;
                                        } else if (effect.type == 'reputation_set') {
                                            let reputation = await connection.promise().query('select * from reputations where id = ?', [effect.type_id]);
                                            effectsString += `Increment value for reputation ${reputation[0][0].name} by ${effect.type_qty}`;
                                        } else if (effect.type == 'stat_set') {
                                            let stat = await connection.promise().query('select * from stats where id = ?', [effect.type_id]);
                                            effectsString += `Increment value for stat ${stat[0][0].name} by ${effect.type_qty}`;
                                        } else if (effect.type == 'message') {
                                            effectsString += `Send message \`${effect.typedata}\``;
                                        }
                                        effectsString += ` to ${effect.target} (${effect.prereq_count} prereqs)\n`;
                                    }
                                    embed.setDescription(effectsString);
                                    await interaction_second.update({ content: '', components: [], embeds: [embed] });
                                    await collector.stop();
                                }
                            }
                        });
                    }
                } else {
                    await interaction.reply({ content: 'No reputation in this game matched the name you gave. Please try again.', ephemeral: true });
                }
            }
        } else if (interaction.commandName === 'effect') {
            if (interaction.options.getSubcommand() === 'add') {
                let message;
                let collector = false;
                let reputation_id;
                let selected_id = false;
                let effect_type = interaction.options.getString('type');
                if (effect_type === 'reputationtier') {
                    let reputations = await connection.promise().query('select * from reputations where guild_id = ? and name like ?', [interaction.guildId, '%' + interaction.options.getString('typeahead') + '%']);
                    if (reputations[0].length == 1) {
                        reputation_id = reputations[0][0].id;
                        let result_values = await connection.promise().query('select * from reputations_tiers where reputation_id = ?', [reputation_id]);
                        let selectComponent;
                        if (result_values[0].length > 0) {
                            if (result_values[0].length <= 25) {
                                let keyValues = [];
                                for (const result_value of result_values[0]) {
                                    keyValues.push({ label: result_value.threshold_name, value: result_value.id.toString() });
                                }
                                selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('TierSelector').setMinValues(1).setMaxValues(1);
                            } else {
                                result_values = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                                let keyValues = [];
                                for (const result_value of result_values) {
                                    keyValues.push({ label: result_value, value: result_value });
                                }
                                selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('TierAlphaSelector').setMinValues(1).setMaxValues(1);
                            }
                            const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                            message = await interaction.reply({ content: 'Please select a reputation tier:', components: [selectRow], ephemeral: true });
                            collector = message.createMessageComponentCollector();
                        } else {
                            await interaction.reply({ content: 'No reputation tiers available for this reputation.', components: [], ephemeral: true });
                        }
                    } else if (reputations[0].length > 1) {
                        let reputationSelectComponent;
                        if (reputations[0].length <= 25) {
                            let reputationsKeyValues = [];
                            for (const reputation of reputations[0]) {
                                reputationsKeyValues.push({ label: reputation.name, value: reputation.id.toString() });
                            }
                            reputationSelectComponent = new StringSelectMenuBuilder().setOptions(reputationsKeyValues).setCustomId('RepSelector').setMinValues(1).setMaxValues(1);
                        } else {
                            reputations = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                            let reputationsKeyValues = [];
                            for (const reputation of reputations) {
                                reputationsKeyValues.push({ label: reputation, value: reputation });
                            }
                            reputationSelectComponent = new StringSelectMenuBuilder().setOptions(reputationsKeyValues).setCustomId('RepAlphaSelector').setMinValues(1).setMaxValues(1);
                        }
                        const reputationSelectRow = new ActionRowBuilder().addComponents(reputationSelectComponent);
                        message = await interaction.reply({ content: 'Please select a reputation:', components: [reputationSelectRow], ephemeral: true });
                        collector = message.createMessageComponentCollector();
                    } else {
                        await interaction.reply({ content: 'No reputations matching that name.', ephemeral: true });
                    }
                } else if (effect_type === 'skill') {
                    let skills = await connection.promise().query('select * from skills where guild_id = ? and (other_targetable = 1 or self_targetable = 1) and name like ?', [interaction.guildId, interaction.options.getString('typeahead') + '%']);
                    let skillSelectComponent;
                    if (skills[0].length > 0) {
                        if (skills[0].length == 1) {
                            selected_id = skills[0][0].id;
                            let types = [
                                { label: 'Increment World Flag', value: 'wflag_inc' },
                                { label: 'Set World Flag', value: 'wflag_set' },
                                { label: 'Increment Character Flag', value: 'cflag_inc' },
                                { label: 'Set Character Flag', value: 'cflag_set' },
                                { label: 'Increment Stat', value: 'stat_inc' },
                                { label: 'Set Stat', value: 'stat_set' },
                                { label: 'Increment Reputation', value: 'reputation_inc' },
                                { label: 'Set Reputation', value: 'reputation_set' },
                                { label: 'Add Item', value: 'item' },
                                { label: 'Add Skill', value: 'skill' },
                                { label: 'Add Archetype', value: 'archetype' },
                                { label: 'Send Message', value: 'message' }
                            ]
                            const selectComponent = new StringSelectMenuBuilder().setOptions(types).setCustomId('TypeSelector').setMinValues(1).setMaxValues(1);
                            const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                            message = await interaction.reply({ content: 'Please select a type of effect:', components: [selectRow], ephemeral: true });
                            collector = message.createMessageComponentCollector();
                        } else {
                            if (skills[0].length <= 25) {
                                let skillsKeyValues = [];
                                for (const skill of skills[0]) {
                                    skillsKeyValues.push({ label: skill.name, value: skill.id.toString() });
                                }
                                skillSelectComponent = new StringSelectMenuBuilder().setOptions(skillsKeyValues).setCustomId('SkillEffectSkillSelector').setMinValues(1).setMaxValues(1);
                            } else {
                                let skills = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                                let skillsKeyValues = [];
                                for (const skill of skills) {
                                    skillsKeyValues.push({ label: skill, value: skill });
                                }
                                skillSelectComponent = new StringSelectMenuBuilder().setOptions(skillsKeyValues).setCustomId('SkillEffectAlphabetSelector').setMinValues(1).setMaxValues(1);
                            }
                            let skillSelectRow = new ActionRowBuilder().addComponents(skillSelectComponent);
                            message = await interaction.reply({ content: 'Please select a skill to add an effect to:', components: [skillSelectRow], ephemeral: true });
                            collector = message.createMessageComponentCollector();
                        }
                    } else {
                        await interaction.reply({ content: 'No skills matching that name.', ephemeral: true });
                    }
                } else if (effect_type === 'item') {
                    let items = await connection.promise().query('select * from items where guild_id = ? and (other_targetable = 1 or self_targetable = 1) and name like ?', [interaction.guildId, interaction.options.getString('typeahead') + '%']);
                    let itemSelectComponent;
                    if (items[0].length > 0) {
                        if (items[0].length == 1) {
                            selected_id = items[0][0].id;
                            let types = [
                                { label: 'Increment World Flag', value: 'wflag_inc' },
                                { label: 'Set World Flag', value: 'wflag_set' },
                                { label: 'Increment Character Flag', value: 'cflag_inc' },
                                { label: 'Set Character Flag', value: 'cflag_set' },
                                { label: 'Increment Stat', value: 'stat_inc' },
                                { label: 'Set Stat', value: 'stat_set' },
                                { label: 'Increment Reputation', value: 'reputation_inc' },
                                { label: 'Set Reputation', value: 'reputation_set' },
                                { label: 'Add Item', value: 'item' },
                                { label: 'Add Skill', value: 'skill' },
                                { label: 'Add Archetype', value: 'archetype' },
                                { label: 'Send Message', value: 'message' }
                            ]
                            const selectComponent = new StringSelectMenuBuilder().setOptions(types).setCustomId('TypeSelector').setMinValues(1).setMaxValues(1);
                            const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                            message = await interaction.reply({ content: 'Please select a type of effect:', components: [selectRow], ephemeral: true });
                            collector = message.createMessageComponentCollector();
                        } else {
                            if (items[0].length <= 25) {
                                let itemsKeyValues = [];
                                for (const item of items[0]) {
                                    itemsKeyValues.push({ label: item.name, value: item.id.toString() });
                                }
                                itemSelectComponent = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('ItemEffectItemSelector').setMinValues(1).setMaxValues(1);
                            } else {
                                let items = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                                let itemsKeyValues = [];
                                for (const item of items) {
                                    itemsKeyValues.push({ label: item, value: item });
                                }
                                itemSelectComponent = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('ItemEffectAlphabetSelector').setMinValues(1).setMaxValues(1);
                            }
                            let itemSelectRow = new ActionRowBuilder().addComponents(itemSelectComponent);
                            message = await interaction.reply({ content: 'Please select an item to add an effect to:', components: [itemSelectRow], ephemeral: true });
                            collector = message.createMessageComponentCollector();
                        }
                    } else {
                        await interaction.reply({ content: 'No items matching that name.', ephemeral: true });
                    }
                }
                let type;
                let visible;
                let charges;
                if (collector) {
                    collector.on('collect', async (interaction_second) => {
                        if (interaction_second.member.id === interaction.member.id) {
                            if (interaction_second.customId === 'ItemEffectAlphabetSelector') {
                                let items = await connection.promise().query('select * from items where guild_id = ? and (other_targetable = 1 or self_targetable = 1) and name like ?', [interaction.guildId, interaction_second.values[0] + '%']);
                                let itemsKeyValues = [];
                                for (const item of items[0]) {
                                    itemsKeyValues.push({ label: item.name, value: item.id.toString() });
                                }
                                itemSelectComponent = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('ItemSelectItemSelector').setMinValues(1).setMaxValues(1);
                                let itemSelectRow = new ActionRowBuilder().addComponents(itemSelectComponent);
                                await interaction_second.update({ content: 'Please select an item to add an effect to:', components: [itemSelectRow] });
                            } else if (interaction_second.customId === 'SkillEffectAlphabetSelector') {
                                let skills = await connection.promise().query('select * from skills where guild_id = ? and (other_targetable = 1 or self_targetable = 1) and name like ?', [interaction.guildId, interaction_second.values[0] + '%']);
                                let skillsKeyValues = [{ label: 'Select a skill', value: '0' }];
                                for (const skill of skills[0]) {
                                    skillsKeyValues.push({ label: skill.name, value: skill.id.toString() });
                                }
                                skillSelectComponent = new StringSelectMenuBuilder().setOptions(skillsKeyValues).setCustomId('SkillEffectSkillSelector').setMinValues(1).setMaxValues(1);
                                let skillSelectRow = new ActionRowBuilder().addComponents(skillSelectComponent);
                                await interaction_second.update({ content: 'Please select a skill to add an effect to:', components: [skillSelectRow] });
                            } else if (interaction_second.customId === 'RepSelector') {
                                reputation_id = interaction_second.values[0];
                                let result_values = await connection.promise().query('select * from reputations_tiers where reputation_id = ?', [reputation_id]);
                                let selectComponent;
                                if (result_values[0].length > 0) {
                                    if (result_values[0].length <= 25) {
                                        let keyValues = [];
                                        for (const result_value of result_values[0]) {
                                            keyValues.push({ label: result_value.threshold_name, value: result_value.id.toString() });
                                        }
                                        selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('TierSelector').setMinValues(1).setMaxValues(1);
                                    } else {
                                        result_values = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                                        let keyValues = [];
                                        for (const result_value of result_values) {
                                            keyValues.push({ label: result_value, value: result_value });
                                        }
                                        selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('TierAlphaSelector').setMinValues(1).setMaxValues(1);
                                    }
                                    const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                                    await interaction_second.update({ content: 'Please select a reputation tier:', components: [selectRow], ephemeral: true });
                                } else {
                                    await interaction_second.update({ content: 'No reputation tiers available for this reputation.', components: [], ephemeral: true });
                                }
                            } else if (interaction_second.customId === 'TierSelector' || interaction_second.customId === 'SkillEffectSkillSelector' || interaction_second.customId === 'ItemEffectItemSelector') {
                                selected_id = interaction_second.values[0];
                                let types = [
                                    { label: 'Increment World Flag', value: 'wflag_inc' },
                                    { label: 'Set World Flag', value: 'wflag_set' },
                                    { label: 'Increment Character Flag', value: 'cflag_inc' },
                                    { label: 'Set Character Flag', value: 'cflag_set' },
                                    { label: 'Increment Stat', value: 'stat_inc' },
                                    { label: 'Set Stat', value: 'stat_set' },
                                    { label: 'Increment Reputation', value: 'reputation_inc' },
                                    { label: 'Set Reputation', value: 'reputation_set' },
                                    { label: 'Add Item', value: 'item' },
                                    { label: 'Add Skill', value: 'skill' },
                                    { label: 'Add Archetype', value: 'archetype' },
                                    { label: 'Send Message', value: 'message' }
                                ]
                                const selectComponent = new StringSelectMenuBuilder().setOptions(types).setCustomId('TypeSelector').setMinValues(1).setMaxValues(1);
                                const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                                await interaction_second.update({ content: 'Please select a type of effect:', components: [selectRow], ephemeral: true });
                            } else if (interaction_second.customId === 'TypeSelector') {
                                type = interaction_second.values[0];
                                let visibilities = [{ label: 'Yes', value: '1' }, { label: 'No', value: '0' }];
                                const selectComponent = new StringSelectMenuBuilder().setOptions(visibilities).setCustomId('VisibilitySelector').setMinValues(1).setMaxValues(1);
                                const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                                await interaction_second.update({ content: 'Do you want this effect announced to the player?', components: [selectRow], ephemeral: true });

                            } else if (interaction_second.customId === 'VisibilitySelector') {
                                visible = interaction_second.values[0];
                                console.log(type);
                                let now = Date.now();
                                let modal = new ModalBuilder()
                                    .setCustomId('EffectModal' + now)
                                    .setTitle('Add Effect');
                                let requires_typeahead = ['wflag_inc', 'wflag_set', 'cflag_inc', 'cflag_set', 'stat_inc', 'stat_set', 'reputation_inc', 'reputation_set', 'item', 'skill', 'archetype'];
                                if (requires_typeahead.includes(type)) {
                                    let typeaheadInput = new TextInputBuilder()
                                        .setCustomId('typeahead')
                                        .setStyle(TextInputStyle.Short);
                                    if (type == 'wflag_inc' || type == 'wflag_set') {
                                        typeaheadInput.setLabel('Name of the world flag (autocompletes)');
                                    } else if (type == 'cflag_inc' || type == 'cflag_set') {
                                        typeaheadInput.setLabel('Name of the character flag (autocompletes)');
                                    } else if (type == 'stat_inc' || type == 'stat_set') {
                                        typeaheadInput.setLabel('Name of the stat (autocompletes)');
                                    } else if (type == 'reputation_inc' || type == 'reputation_set') {
                                        typeaheadInput.setLabel('Name of the reputation (autocompletes)');
                                    } else if (type == 'item') {
                                        typeaheadInput.setLabel('Name of the item (autocompletes)');
                                    } else if (type == 'skill') {
                                        typeaheadInput.setLabel('Name of the skill (autocompletes)');
                                    } else if (type == 'archetype') {
                                        typeaheadInput.setLabel('Name of the archetype (autocompletes)');
                                    }
                                    let typeaheadActionRow = new ActionRowBuilder().addComponents(typeaheadInput);
                                    modal.addComponents(typeaheadActionRow);
                                }
                                let requires_quantity = ['wflag_inc', 'wflag_set', 'cflag_inc', 'cflag_set', 'stat_inc', 'stat_set', 'reputation_inc', 'reputation_set', 'item'];
                                if (requires_quantity.includes(type)) {
                                    let quantityInput = new TextInputBuilder()
                                        .setCustomId('type_qty')
                                        .setStyle(TextInputStyle.Short);
                                    if (type == 'wflag_inc' || type == 'cflag_inc' || type == 'stat_inc' || type == 'reputation_inc') {
                                        quantityInput.setLabel('Amount to increment by');
                                    } else {
                                        quantityInput.setLabel('Value to set to');
                                    }
                                    let qtyActionRow = new ActionRowBuilder().addComponents(quantityInput);
                                    modal.addComponents(qtyActionRow);
                                }
                                let chargesInput = new TextInputBuilder()
                                    .setCustomId('charges')
                                    .setStyle(TextInputStyle.Short)
                                    .setLabel('Number of charges (-1 for infinite)');
                                let chargesActionRow = new ActionRowBuilder().addComponents(chargesInput);
                                modal.addComponents(chargesActionRow);
                                let requires_typedata = ['message'];
                                if (requires_typedata.includes(type)) {
                                    let typedataInput = new TextInputBuilder()
                                        .setCustomId('typedata')
                                        .setStyle(TextInputStyle.Paragraph);
                                    if (type == 'message') {
                                        typedataInput.setLabel('Message to send:');
                                    }
                                    let typedataActionRow = new ActionRowBuilder().addComponents(typedataInput);
                                    modal.addComponents(typedataActionRow);
                                }
                                await interaction_second.showModal(modal);
                                let submittedModal = await interaction_second.awaitModalSubmit({ time: 300000 });
                                if (submittedModal.customId === 'EffectModal' + now && submittedModal.member.id === interaction.member.id) {
                                    let typeahead = false;
                                    let type_qty = null;
                                    let typedata = null;
                                    charges = submittedModal.fields.getTextInputValue('charges');
                                    if (submittedModal.fields.fields.find(field => field.customId === 'typeahead')) {
                                        typeahead = submittedModal.fields.getTextInputValue('typeahead');
                                    }
                                    if (submittedModal.fields.fields.find(field => field.customId === 'type_qty')) {
                                        type_qty = submittedModal.fields.getTextInputValue('type_qty');
                                    }
                                    if (submittedModal.fields.fields.find(field => field.customId === 'typedata')) {
                                        typedata = submittedModal.fields.getTextInputValue('typedata');
                                    }
                                    if (typeahead) {
                                        let typeahead_results;
                                        if (type == 'wflag_inc' || type == 'wflag_set') {
                                            typeahead_results = await connection.promise().query('select * from worldflags where guild_id = ? and name like ?', [interaction.guildId, '%' + typeahead + '%']);
                                        } else if (type == 'cflag_inc' || type == 'cflag_set') {
                                            typeahead_results = await connection.promise().query('select * from characterflags where guild_id = ? and name like ?', [interaction.guildId, '%' + typeahead + '%']);
                                        } else if (type == 'stat_inc' || type == 'stat_set') {
                                            typeahead_results = await connection.promise().query('select * from stats where guild_id = ? and name like ?', [interaction.guildId, '%' + typeahead + '%']);
                                        } else if (type == 'item') {
                                            typeahead_results = await connection.promise().query('select * from items where guild_id = ? and name like ?', [interaction.guildId, '%' + typeahead + '%']);
                                        } else if (type == 'skill') {
                                            typeahead_results = await connection.promise().query('select * from skills where guild_id = ? and name like ?', [interaction.guildId, '%' + typeahead + '%']);
                                        } else if (type == 'archetype') {
                                            typeahead_results = await connection.promise().query('select * from archetypes where guild_id = ? and name like ?', [interaction.guildId, '%' + typeahead + '%']);
                                        } else if (type == 'reputation_inc' || type == 'reputation_set') {
                                            typeahead_results = await connection.promise().query('select * from reputations where guild_id = ? and name like ?', [interaction.guildId, '%' + typeahead + '%']);
                                        }

                                        if (typeahead_results[0].length == 0) {
                                            await interaction_second.update({ content: 'No match was found with the autocomplete text you entered. Please try again.', components: [], ephemeral: true });
                                        } else if (typeahead_results[0].length == 1) {
                                            let insertedEffect;
                                            if (type_qty) {
                                                insertedEffect = await connection.promise().query('insert into effects (type, type_id, type_qty, charges, visible, typedata) values (?, ?, ?, ?, ?, ?)', [type, typeahead_results[0][0].id, type_qty, charges, visible, typedata]);
                                            } else {
                                                insertedEffect = await connection.promise().query('insert into effects (type, type_id, charges, visible, typedata) values (?, ?, ?, ?, ?)', [type, typeahead_results[0][0].id, charges, visible, typedata]);
                                            }
                                            if (effect_type === 'reputationtier') {
                                                await connection.promise().query('insert into reputations_tiers_effects (reputationtier_id, effect_id) values (?, ?)', [selected_id, insertedEffect[0].insertId]);
                                            } else if (effect_type === 'skill') {
                                                await connection.promise().query('insert into skills_effects (skill_id, effect_id) values (?, ?)', [selected_id, insertedEffect[0].insertId]);
                                            } else if (effect_type === 'item') {
                                                await connection.promise().query('insert into items_effects (item_id, effect_id) values (?, ?)', [selected_id, insertedEffect[0].insertId]);
                                            }
                                            await submittedModal.update({ content: 'Effect added.', components: [], ephemeral: true });
                                            collector.stop();
                                        } else {
                                            let keyValues = [];
                                            for (const result_value of typeahead_results[0]) {
                                                let thisKeyValue = { label: result_value.name, value: result_value.id.toString() };
                                                keyValues.push(thisKeyValue);
                                            }
                                            selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('TypeaheadSelector').setMinValues(1).setMaxValues(1);
                                            let selectRow = new ActionRowBuilder().addComponents(selectComponent);
                                            await submittedModal.update({ content: 'Select an item from the list:', components: [selectRow], ephemeral: true });
                                        }

                                    } else {
                                        if (typedata) {
                                            console.log('insert');
                                            let insertedEffect = await connection.promise().query('insert into effects (type, charges, visible, typedata) values (?, ?, ?, ?)', [type, charges, visible, typedata]);
                                            if (effect_type === 'reputationtier') {
                                                await connection.promise().query('insert into reputations_tiers_effects (reputationtier_id, effect_id) values (?, ?)', [selected_id, insertedEffect[0].insertId]);
                                            } else if (effect_type === 'skill') {
                                                await connection.promise().query('insert into skills_effects (skill_id, effect_id) values (?, ?)', [selected_id, insertedEffect[0].insertId]);
                                            } else if (effect_type === 'item') {
                                                await connection.promise().query('insert into items_effects (item_id, effect_id) values (?, ?)', [selected_id, insertedEffect[0].insertId]);
                                            }
                                            await submittedModal.update({ content: 'Effect added.', components: [], ephemeral: true });
                                            collector.stop();
                                        }
                                    }
                                }
                            } else if (interaction_second.customId === 'TypeaheadSelector') {
                                let typeahead_id = interaction_second.values[0];
                                let insertedEffect;
                                if (type_qty) {
                                    insertedEffect = await connection.promise().query('insert into effects (type, type_id, type_qty, charges, visible, typedata) values (?, ?, ?, ?, ?, ?)', [type, typeahead_id, type_qty, charges, visible, typedata]);
                                } else {
                                    insertedEffect = await connection.promise().query('insert into effects (type, type_id, charges, visible, typedata) values (?, ?, ?, ?, ?)', [type, typeahead_id, charges, visible, typedata]);
                                }
                                if (effect_type === 'reputationtier') {
                                    await connection.promise().query('insert into reputations_tiers_effects (reputationtier_id, effect_id) values (?, ?)', [selected_id, insertedEffect[0].insertId]);
                                } else if (effect_type === 'skill') {
                                    await connection.promise().query('insert into skills_effects (skill_id, effect_id) values (?, ?)', [selected_id, insertedEffect[0].insertId]);
                                } else if (effect_type === 'item') {
                                    await connection.promise().query('insert into items_effects (item_id, effect_id) values (?, ?)', [selected_id, insertedEffect[0].insertId]);
                                }
                                await interaction_second.update({ content: 'Effect added.', components: [] });
                                collector.stop();
                            } else if (interaction_second.customId === 'TierAlphaSelector') {
                                let result_values = await connection.promise().query('select * from reputations_tiers where reputation_id = ? and threshold_name like ?', [reputation_id, interaction_second.values[0] + '%']);
                                let keyValues = [];
                                for (const result_value of result_values[0]) {
                                    keyValues.push({ label: result_value.threshold_name, value: result_value.id.toString() });
                                }
                                const selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('TierSelector').setMinValues(1).setMaxValues(1);
                                const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                                await interaction_second.update({ content: 'Please select a reputation tier:', components: [selectRow] });
                            } else if (interaction_second.customId === 'RepAlphaSelector') {
                                let reputations = await connection.promise().query('select * from reputations where name like ? and guild_id = ?', ['%' + interaction_second.values[0], interaction.guildId]);
                                if (reputations[0].length <= 25) {
                                    let reputationsKeyValues = [];
                                    for (const reputation of reputations[0]) {
                                        reputationsKeyValues.push({ label: reputation.name, value: reputation.id.toString() });
                                    }
                                    const reputationSelectComponent = new StringSelectMenuBuilder().setOptions(reputationsKeyValues).setCustomId('RepSelector').setMinValues(1).setMaxValues(1);
                                    const reputationSelectRow = new ActionRowBuilder().addComponents(reputationSelectComponent);
                                    interaction_second.update({ components: [reputationSelectRow] });
                                } else {
                                    await interaction_second.update({ content: 'No reputations with this first letter', components: [] });
                                    collector.stop();
                                }
                            }
                        }
                    });
                }
                // Then select action ,visiblity, modal as with reputation tier.
                // Ask whether the effect will hit the caster or the target
            } else if (interaction.options.getSubcommand() === 'addprereq') {
                let choices = [
                    { label: 'Reputation Tier', value: 'reputation' },
                    { label: 'Skill', value: 'skill' },
                    { label: 'Item', value: 'item' }
                ];
                const selectComponent = new StringSelectMenuBuilder().setOptions(choices).setCustomId('PrereqEffectSourceSelector').setMinValues(1).setMaxValues(1);
                const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                let message = await interaction.reply({ content: 'Please select the effect source:', components: [selectRow], ephemeral: true });
                let collector = message.createMessageComponentCollector();
                let prereq_type;
                let logical_and_group;
                let not = false;
                let prereq_value;
                let effect_id;
                collector.on('collect', async (interaction_second) => {
                    if (interaction_second.member.id === interaction.member.id) {
                        if (interaction_second.customId === 'PrereqEffectSourceSelector') {
                            let type = interaction_second.values[0];
                            if (type == 'reputation') {
                                let reputations = await connection.promise().query('select distinct r.* from reputations r inner join reputations_tiers rt on rt.reputation_id = r.id inner join reputations_tiers_effects rte on rt.id = rte.reputationtier_id where guild_id = ?', [interaction.guildId]);
                                let reputationSelectComponent;
                                if (reputations[0].length <= 25) {
                                    let reputationsKeyValues = [];
                                    for (const reputation of reputations[0]) {
                                        reputationsKeyValues.push({ label: reputation.name, value: reputation.id.toString() });
                                    }
                                    reputationSelectComponent = new StringSelectMenuBuilder().setOptions(reputationsKeyValues).setCustomId('PrereqRepSelector').setMinValues(1).setMaxValues(1);
                                } else {
                                    reputations = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                                    let reputationsKeyValues = [];
                                    for (const reputation of reputations) {
                                        let thisReputationKeyValue = { label: reputation, value: reputation }
                                        reputationsKeyValues.push(thisReputationKeyValue);
                                    }
                                    reputationSelectComponent = new StringSelectMenuBuilder().setOptions(reputationsKeyValues).setCustomId('PrereqRepAlphaSelector').setMinValues(1).setMaxValues(1);
                                }
                                const reputationSelectRow = new ActionRowBuilder().addComponents(reputationSelectComponent);
                                await interaction_second.update({ content: 'Please select the following options:', components: [reputationSelectRow], ephemeral: true });
                            } else if (type == 'skill') {
                                let skills = await connection.promise().query('select distinct s.* from skills s inner join skills_effects se on s.id = se.skill_id where guild_id = ?', [interaction.guildId]);
                                let skillSelectComponent;
                                if (skills[0].length > 0) {
                                    if (skills[0].length <= 25) {
                                        let skillsKeyValues = [];
                                        for (const skill of skills[0]) {
                                            skillsKeyValues.push({ label: skill.name, value: skill.id.toString() });
                                        }
                                        skillSelectComponent = new StringSelectMenuBuilder().setOptions(skillsKeyValues).setCustomId('PrereqSkillSelector').setMinValues(1).setMaxValues(1);
                                    } else {
                                        skills = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                                        let skillsKeyValues = [];
                                        for (const skill of skills) {
                                            skillsKeyValues.push({ label: skill, value: skill });
                                        }
                                        skillSelectComponent = new StringSelectMenuBuilder().setOptions(skillsKeyValues).setCustomId('PrereqSkillAlphaSelector').setMinValues(1).setMaxValues(1);
                                    }
                                    const skillSelectRow = new ActionRowBuilder().addComponents(skillSelectComponent);
                                    await interaction_second.update({ content: 'Please select a skill:', components: [skillSelectRow], ephemeral: true });
                                } else {
                                    await interaction_second.update({ content: 'No skills with effects were found. Please add an effect to a skill first.', components: [] });
                                    collector.stop();
                                }
                            } else if (type == 'item') {
                                let items = await connection.promise().query('select distinct i.* from items i inner join items_effects ie on i.id = ie.item_id where guild_id = ?', [interaction.guildId]);
                                let itemSelectComponent;
                                if (items[0].length > 0) {
                                    if (items[0].length <= 25) {
                                        let itemsKeyValues = [];
                                        for (const item of items[0]) {
                                            itemsKeyValues.push({ label: item.name, value: item.id.toString() });
                                        }
                                        itemSelectComponent = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('PrereqItemSelector').setMinValues(1).setMaxValues(1);
                                    } else {
                                        items = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                                        let itemsKeyValues = [];
                                        for (const item of items) {
                                            skillsKeyValues.push({ label: item, value: item });
                                        }
                                        itemSelectComponent = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('PrereqItemAlphaSelector').setMinValues(1).setMaxValues(1);
                                    }
                                    const itemSelectRow = new ActionRowBuilder().addComponents(itemSelectComponent);
                                    await interaction_second.update({ content: 'Please select an item:', components: [itemSelectRow], ephemeral: true });
                                } else {
                                    await interaction_second.update({ content: 'No items with effects were found. Please add an effect to an item first.', components: [] });
                                    collector.stop();
                                }
                            }
                            //extensible for quests and npcs and whatever else
                        } else if (interaction_second.customId === 'PrereqRepAlphaSelector') {
                            let reputations = await connection.promise().query('select distinct r.* from reputations r inner join reputations_tiers rt on rt.reputation_id = r.id inner join reputations_tiers_effects rte on rt.id = rte.reputationtier_id where r.guild_id = ? and r.name like ?', [interaction.guildId, interaction_second.values[0] + '%']);
                            let reputationsKeyValues = [];
                            for (const reputation of reputations[0]) {
                                reputationsKeyValues.push({ label: reputation.name, value: reputation.id.toString() });
                            }
                            reputationSelectComponent = new StringSelectMenuBuilder().setOptions(reputationsKeyValues).setCustomId('PrereqRepSelector').setMinValues(1).setMaxValues(1);
                            const reputationSelectRow = new ActionRowBuilder().addComponents(reputationSelectComponent);
                            await interaction_second.update({ content: 'Please select the following options:', components: [reputationSelectRow], ephemeral: true });
                        } else if (interaction_second.customId === 'PrereqRepSelector') {
                            let reputation_id = interaction_second.values[0];
                            let result_values = await connection.promise().query('select distinct rt.* from reputations_tiers rt inner join reputations_tiers_effects rte on rt.id = rte.reputationtier_id where rt.reputation_id = ?', [reputation_id]);
                            let selectComponent;
                            if (result_values[0].length > 0) {
                                if (result_values[0].length <= 25) {
                                    let keyValues = [];
                                    for (const result_value of result_values[0]) {
                                        keyValues.push({ label: result_value.threshold_name, value: result_value.id.toString() });
                                    }
                                    selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('PrereqRepTierSelector').setMinValues(1).setMaxValues(1);
                                } else {
                                    result_values = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                                    let keyValues = [];
                                    for (const result_value of result_values) {
                                        keyValues.push({ label: result_value, value: result_value });
                                    }
                                    selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('PrereqRepTierAlphaSelector').setMinValues(1).setMaxValues(1);
                                }
                                const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                                await interaction_second.update({ content: 'Please select a reputation tier:', components: [selectRow], ephemeral: true });
                            } else {
                                await interaction_second.update({ content: 'No reputation tiers available for this reputation.', components: [], ephemeral: true });
                            }

                        } else if (interaction_second.customId === 'PrereqSkillAlphaSelector') {
                            let skills = await connection.promise().query('select distinct s.* from skills s inner join skills_effects se on s.id = se.skill_id where guild_id = ? and name like ?', [interaction.guildId, interaction_second.values[0] + '%']);
                            let skillsKeyValues = [];
                            for (const skill of skills[0]) {
                                let thisSkillKeyValue = { label: skill.name, value: skill.id.toString() };
                                skillsKeyValues.push(thisSkillKeyValue);
                            }
                            const skillSelectComponent = new StringSelectMenuBuilder().setOptions(skillsKeyValues).setCustomId('PrereqSkillSelector').setMinValues(1).setMaxValues(1);
                            const skillSelectRow = new ActionRowBuilder().addComponents(skillSelectComponent);
                            await interaction_second.update({ content: 'Please select a skill:', components: [skillSelectRow], ephemeral: true });
                        } else if (interaction_second.customId === 'PrereqSkillSelector' || interaction_second.customId === 'PrereqItemSelector' || interaction_second.customId === 'PrereqRepTierSelector') {
                            let effects;
                            if (interaction_second.customId === 'PrereqSkillSelector') {
                                effects = await connection.promise().query('select e.* from effects e join skills_effects se on e.id = se.effect_id where se.skill_id = ?', [interaction_second.values[0]]);
                            } else if (interaction_second.customId === 'PrereqItemSelector') {
                                effects = await connection.promise().query('select e.* from effects e join items_effects ie on e.id = ie.effect_id where ie.item_id = ?', [interaction_second.values[0]]);
                            } else if (interaction_second.customId === 'PrereqRepTierSelector') {
                                effects = await connection.promise().query('select e.* from effects e join reputations_tiers_effects rte on e.id = rte.effect_id where rte.reputationtier_id = ?', [interaction_second.values[0] + '%']);
                            }
                            let effectsKeyValues = [];
                            for (const effect of effects[0]) {
                                let label;
                                let description;
                                let prereqs = await connection.promise().query('select * from effects_prereqs where effect_id = ?', [effect.id]);
                                if (effect.type == 'message') {
                                    label = `Send message`;
                                    description = effect.typedata.slice(0, 18) + '...';
                                } else if (effect.type == 'wflag_inc' || effect.type == 'wflag_set') {
                                    let worldflag = await connection.promise().query('select * from worldflags where id = ?', [effect.type_id]);
                                    label = `Adjust world flag`;
                                    description = worldflag[0][0].name;
                                } else if (effect.type == 'cflag_inc' || effect.type == 'cflag_set') {
                                    let characterflag = await connection.promise().query('select * from characterflags where id = ?', [effect.type_id]);
                                    label = `Adjust character flag`;
                                    description = characterflag[0][0].name;
                                } else if (effect.type == 'skill') {
                                    let skill = await connection.promise().query('select * from skills where id = ?', [effect.type_id]);
                                    label = `Grant skill`;
                                    description = skill[0][0].name;
                                } else if (effect.type == 'archetype') {
                                    let archetype = await connection.promise().query('select * from archetypes where id = ?', [effect.type_id]);
                                    label = `Grant archetype`;
                                    description = archetype[0][0].name;
                                } else if (effect.type == 'reputation_inc' || effect.type == 'reputation_set') {
                                    let reputation = await connection.promise().query('select * from reputations where id = ?', [effect.type_id]);
                                    label = `Modify reputation`;
                                    description = reputation[0][0].name;
                                } else if (effect.type == 'stat_set' || effect.type == 'stat_inc') {
                                    let stat = await connection.promise().query('select * from stats where id = ?', [effect.type_id]);
                                    label = `Modify stat`;
                                    description = stat[0][0].name;
                                }
                                description += ` (${prereqs[0].length} prereqs already)`;
                                effectsKeyValues.push({ label: label, description: description, value: effect.id.toString() });
                            }
                            const effectSelectComponent = new StringSelectMenuBuilder().setOptions(effectsKeyValues).setCustomId('PrereqEffectSelector').setMinValues(1).setMaxValues(1);
                            const effectSelectRow = new ActionRowBuilder().addComponents(effectSelectComponent);
                            await interaction_second.update({ content: 'Please select an effect:', components: [effectSelectRow], ephemeral: true });
                            // Displays PrereqEffectSelector.
                        } else if (interaction_second.customId === 'PrereqItemAlphaSelector') {
                            let items = await connection.promise().query('select distinct i.* from items i inner join items_effects ie on i.id = ie.item_id where guild_id = ? and name like ?', [interaction.guildId, interaction_second.values[0] + '%']);
                            let itemSelectComponent;
                            if (items[0].length > 0) {
                                let itemsKeyValues = [];
                                for (const item of items[0]) {
                                    itemsKeyValues.push({ label: item.name, value: item.id.toString() });
                                }
                                itemSelectComponent = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('PrereqItemSelector').setMinValues(1).setMaxValues(1);
                            }
                            const selectRow = new ActionRowBuilder().addComponents(itemSelectComponent);
                            await interaction_second.update({ content: 'Please select an item', components: [selectRow] });

                        } else if (interaction_second.customId === 'PrereqRepTierAlphaSelector') {
                            let result_values = await connection.promise().query('select distinct rt.* from reputations_tiers inner join reputations_tiers_effects rte on rt.id = rte.reputationtier_id where rt.reputation_id = ? and name like ?', [reputation_id, interaction_second.values[0] + '%']);
                            if (result_values.length > 0) {
                                let keyValues = [];
                                for (const result_value of result_values[0]) {
                                    keyValues.push({ label: result_value.threshold_name, value: result_value.id.toString() });
                                }
                                const selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('PrereqRepTierSelector').setMinValues(1).setMaxValues(1);
                                const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                                await interaction_second.update({ content: 'Please select a reputation tier:', components: [selectRow], ephemeral: true });
                            } else {
                                await interaction_second.update({ content: 'No reputation tiers available for this reputation.', components: [], ephemeral: true });
                                await collector.stop();
                            }
                        } else if (interaction_second.customId === 'PrereqEffectSelector') {
                            effect_id = interaction_second.values[0];
                            let types = [
                                { label: 'Character is', value: 'character_eq' },
                                { label: 'Character is not', value: 'character_ne' },
                                { label: 'Character flag equals', value: 'cflag_eq' },
                                { label: 'Character flag less than', value: 'cflag_lt' },
                                { label: 'Character flag greater than', value: 'cflag_gt' },
                                { label: 'Character flag not equal', value: 'cflag_ne' },
                                { label: 'World flag equals', value: 'wflag_eq' },
                                { label: 'World flag less than', value: 'wflag_lt' },
                                { label: 'World flag greater than', value: 'wflag_gt' },
                                { label: 'World flag not equal', value: 'wflag_ne' },
                                { label: 'Archetype is', value: 'archetype_eq' },
                                { label: 'Archetype is not', value: 'archetype_ne' },
                            ];
                            const selectComponent = new StringSelectMenuBuilder().setOptions(types).setCustomId('PrereqTypeSelector').setMinValues(1).setMaxValues(1);
                            const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                            await interaction_second.update({ content: 'Please select a prerequisite type:', components: [selectRow], ephemeral: true });
                        } else if (interaction_second.customId === 'PrereqTypeSelector') {
                            if (interaction_second.values[0] == 'character_eq' || interaction_second.values[0] == 'character_ne') {
                                prereq_type = 'character';
                                if (interaction_second.values[0] == 'character_ne') {
                                    not = true;
                                }
                            } else if (interaction_second.values[0] == 'archetype_eq' || interaction_second.values[0] == 'archetype_ne') {
                                prereq_type = 'archetype';
                                if (interaction_second.values[0] == 'archetype_ne') {
                                    not = true;
                                }
                            } else if (prereq_type == 'cflag_ne') {
                                prereq_type == 'cflag_eq';
                                not = true;
                            } else if (prereq_type == 'wflag_ne') {
                                prereq_type == 'wflag_eq';
                                not = true;
                            } else {
                                prereq_type = interaction_second.values[0];
                            }
                            let logical_ands = await connection.promise().query('select logical_and_group, count(*) as conditions from effects_prereqs where effect_id = ? group by logical_and_group', [effect_id]);
                            let types = [
                                { label: 'New logical AND group', value: 'new' }
                            ];
                            if (logical_ands[0].length > 0) {
                                for (const logical_and of logical_ands[0]) {
                                    types.push({ label: 'Logical AND group ' + logical_and.logical_and_group + ' (' + logical_and.conditions + ' prereqs)', value: logical_and.logical_and_group.toString() });
                                }
                            }
                            const selectComponent = new StringSelectMenuBuilder().setOptions(types).setCustomId('PrereqLogicalAndSelector').setMinValues(1).setMaxValues(1);
                            const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                            await interaction_second.update({ content: 'Do you want to add this prerequisite to an existing logical AND group or use a new one?', components: [selectRow], ephemeral: true });
                        } else if (interaction_second.customId === 'PrereqLogicalAndSelector') {
                            if (interaction_second.values[0] == 'new') {
                                let and_groups = await connection.promise().query('select coalesce(max(logical_and_group), 0) as max_val from effects_prereqs where effect_id = ?', [effect_id]);
                                if (and_groups[0].length > 0) {
                                    logical_and_group = and_groups[0][0].max_val + 1;
                                } else {
                                    logical_and_group = 0;
                                }
                            } else {
                                logical_and_group = interaction_second.values[0];
                            }
                            let now = Date.now();
                            let modal = new ModalBuilder()
                                .setCustomId('RepPrereqModal' + now)
                                .setTitle('Add Prerequisite');
                            let typeaheadInput = new TextInputBuilder()
                                .setCustomId('typeahead')
                                .setStyle(TextInputStyle.Short);
                            if (prereq_type == 'wflag_eq' || prereq_type == 'wflag_gt' || prereq_type == 'wflag_lt') {
                                typeaheadInput.setLabel('Name of the world flag (autocompletes)');
                            } else if (prereq_type == 'cflag_eq' || prereq_type == 'cflag_lt' || prereq_type == 'cflag_gt') {
                                typeaheadInput.setLabel('Name of the character flag (autocompletes)');
                            } else if (prereq_type == 'archetype') {
                                typeaheadInput.setLabel('Name of the archetype (autocompletes)');
                            } else if (prereq_type == 'character') {
                                typeaheadInput.setLabel('Name of the character (autocompletes)');
                            }
                            let typeaheadActionRow = new ActionRowBuilder().addComponents(typeaheadInput);
                            modal.addComponents(typeaheadActionRow);
                            let requires_quantity = ['wflag_gt', 'wflag_lt', 'wflag_eq', 'cflag_gt', 'cflag_lt', 'cflag_eq'];
                            if (requires_quantity.includes(type)) {
                                let quantityInput = new TextInputBuilder()
                                    .setCustomId('prereq_value')
                                    .setStyle(TextInputStyle.Short);
                                quantityInput.setLabel('Amount to increment by');
                                let qtyActionRow = new ActionRowBuilder().addComponents(quantityInput);
                                modal.addComponents(qtyActionRow);
                            }
                            await interaction_second.showModal(modal);
                            let submittedModal = await interaction_second.awaitModalSubmit({ time: 300000 });
                            if (submittedModal && submittedModal.customId === 'RepPrereqModal' + now && submittedModal.member.id === interaction_second.member.id) {
                                let typeahead = false;
                                if (submittedModal.fields.fields.find(field => field.customId === 'typeahead')) {
                                    typeahead = submittedModal.fields.getTextInputValue('typeahead');
                                }
                                if (submittedModal.fields.fields.find(field => field.customId === 'prereq_value')) {
                                    prereq_value = submittedModal.fields.getTextInputValue('prereq_value');
                                }
                                if (typeahead) {
                                    let typeahead_results;
                                    if (prereq_type == 'wflag_gt' || prereq_type == 'wflag_lt' || prereq_type == 'wflag_eq') {
                                        typeahead_results = await connection.promise().query('select * from worldflags where guild_id = ? and name like ?', [interaction.guildId, '%' + typeahead + '%']);
                                    } else if (prereq_type == 'cflag_gt' || prereq_type == 'cflag_lt' || prereq_type == 'cflag_eq') {
                                        typeahead_results = await connection.promise().query('select * from characterflags where guild_id = ? and name like ?', [interaction.guildId, '%' + typeahead + '%']);
                                    } else if (prereq_type == 'character') {
                                        typeahead_results = await connection.promise().query('select * from characters where guild_id = ? and name like ?', [interaction.guildId, '%' + typeahead + '%']);
                                    } else if (prereq_type == 'archetype') {
                                        typeahead_results = await connection.promise().query('select * from archetypes where guild_id = ? and name like ?', [interaction.guildId, '%' + typeahead + '%']);
                                    }

                                    if (typeahead_results[0].length == 0) {
                                        await interaction_second.update({ content: 'No match was found with the autocomplete text you entered. Please try again.', components: [], ephemeral: true });
                                    } else if (typeahead_results[0].length == 1) {
                                        let insertedPrereq;
                                        if (prereq_value) {
                                            insertedPrereq = await connection.promise().query('insert into effects_prereqs (effect_id, prereq_type, prereq_id, logical_and_group, \`not\`, prereq_value) values (?, ?, ?, ?, ?, ?)', [effect_id, prereq_type, typeahead_results[0][0].id, logical_and_group, not, prereq_value]);
                                        } else {
                                            insertedPrereq = await connection.promise().query('insert into effects_prereqs (effect_id, prereq_type, prereq_id, logical_and_group, \`not\`) values (?, ?, ?, ?, ?)', [effect_id, prereq_type, typeahead_results[0][0].id, logical_and_group, not]);
                                        }
                                        await submittedModal.update({ content: 'Prereq added.', components: [], ephemeral: true });
                                    } else {
                                        let keyValues = [];
                                        for (const result_value of typeahead_results[0]) {
                                            keyValues.push({ label: result_value.name, value: result_value.id.toString() });
                                        }
                                        const selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('PrereqTypeaheadSelector').setMinValues(1).setMaxValues(1);
                                        const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                                        await submittedModal.update({ content: 'Select an item from the list:', components: [selectRow], ephemeral: true });
                                    }

                                }
                            }
                        } else if (interaction_second.customId === 'PrereqTypeaheadSelector') {
                            let typeahead_id = interaction_second.values[0];
                            let insertedPrereq;
                            if (prereq_value) {
                                insertedPrereq = await connection.promise().query('insert into effects_prereqs (effect_id, prereq_type, prereq_id, logical_and_group, \`not\`, prereq_value) values (?, ?, ?, ?, ?, ?)', [effect_id, prereq_type, typeahead_id, logical_and_group, not, prereq_value]);
                            } else {
                                insertedPrereq = await connection.promise().query('insert into effects_prereqs (effect_id, prereq_type, prereq_id, logical_and_group, \`not\`) values (?, ?, ?, ?, ?)', [effect_id, prereq_type, typeahead_id, logical_and_group, not]);
                            }
                            await interaction_second.update({ content: 'Prereq added.', components: [] });
                        }
                    }
                });
            } else if (interaction.options.getSubcommand() === 'listprereqs') {

            } else if (interaction.options.getSubcommand() === 'remove') {
                let choices = [
                    { label: 'Reputation Tier', value: 'reputation' },
                    { label: 'Skill', value: 'skill' },
                    { label: 'Item', value: 'item' }
                ];
                const selectComponent = new StringSelectMenuBuilder().setOptions(choices).setCustomId('EffectSourceSelector').setMinValues(1).setMaxValues(1);
                const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                let message = await interaction.reply({ content: 'Please select the effect source:', components: [selectRow], ephemeral: true });
                let collector = message.createMessageComponentCollector();
                collector.on('collect', async (interaction_second) => {
                    if (interaction_second.member.id === interaction.member.id) {
                        if (interaction_second.customId === 'EffectSourceSelector') {
                            let type = interaction_second.values[0];
                            if (type == 'reputation') {
                                let reputations = await connection.promise().query('select distinct r.* from reputations r inner join reputations_tiers rt on rt.reputation_id = r.id inner join reputations_tiers_effects rte on rt.id = rte.reputationtier_id where guild_id = ?', [interaction.guildId]);
                                let reputationSelectComponent;
                                if (reputations[0].length <= 25) {
                                    let reputationsKeyValues = [];
                                    for (const reputation of reputations[0]) {
                                        reputationsKeyValues.push({ label: reputation.name, value: reputation.id.toString() });
                                    }
                                    reputationSelectComponent = new StringSelectMenuBuilder().setOptions(reputationsKeyValues).setCustomId('PrereqRepSelector').setMinValues(1).setMaxValues(1);
                                } else {
                                    reputations = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                                    let reputationsKeyValues = [];
                                    for (const reputation of reputations) {
                                        let thisReputationKeyValue = { label: reputation, value: reputation }
                                        reputationsKeyValues.push(thisReputationKeyValue);
                                    }
                                    reputationSelectComponent = new StringSelectMenuBuilder().setOptions(reputationsKeyValues).setCustomId('PrereqRepAlphaSelector').setMinValues(1).setMaxValues(1);
                                }
                                const reputationSelectRow = new ActionRowBuilder().addComponents(reputationSelectComponent);
                                await interaction_second.update({ content: 'Please select the following options:', components: [reputationSelectRow], ephemeral: true });
                            } else if (type == 'skill') {
                                let skills = await connection.promise().query('select distinct s.* from skills s inner join skills_effects se on s.id = se.skill_id where guild_id = ?', [interaction.guildId]);
                                let skillSelectComponent;
                                if (skills[0].length > 0) {
                                    if (skills[0].length <= 25) {
                                        let skillsKeyValues = [];
                                        for (const skill of skills[0]) {
                                            skillsKeyValues.push({ label: skill.name, value: skill.id.toString() });
                                        }
                                        skillSelectComponent = new StringSelectMenuBuilder().setOptions(skillsKeyValues).setCustomId('PrereqSkillSelector').setMinValues(1).setMaxValues(1);
                                    } else {
                                        skills = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                                        let skillsKeyValues = [];
                                        for (const skill of skills) {
                                            skillsKeyValues.push({ label: skill, value: skill });
                                        }
                                        skillSelectComponent = new StringSelectMenuBuilder().setOptions(skillsKeyValues).setCustomId('PrereqSkillAlphaSelector').setMinValues(1).setMaxValues(1);
                                    }
                                    const skillSelectRow = new ActionRowBuilder().addComponents(skillSelectComponent);
                                    await interaction_second.update({ content: 'Please select a skill:', components: [skillSelectRow], ephemeral: true });
                                } else {
                                    await interaction_second.update({ content: 'No skills with effects were found. Please add an effect to a skill first.', components: [] });
                                    collector.stop();
                                }
                            } else if (type == 'item') {
                                let items = await connection.promise().query('select distinct i.* from items i inner join items_effects ie on i.id = ie.item_id where guild_id = ?', [interaction.guildId]);
                                let itemSelectComponent;
                                if (items[0].length > 0) {
                                    if (items[0].length <= 25) {
                                        let itemsKeyValues = [];
                                        for (const item of items[0]) {
                                            itemsKeyValues.push({ label: item.name, value: item.id.toString() });
                                        }
                                        itemSelectComponent = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('PrereqItemSelector').setMinValues(1).setMaxValues(1);
                                    } else {
                                        items = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                                        let itemsKeyValues = [];
                                        for (const item of items) {
                                            skillsKeyValues.push({ label: item, value: item });
                                        }
                                        itemSelectComponent = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('PrereqItemAlphaSelector').setMinValues(1).setMaxValues(1);
                                    }
                                    const itemSelectRow = new ActionRowBuilder().addComponents(itemSelectComponent);
                                    await interaction_second.update({ content: 'Please select an item:', components: [itemSelectRow], ephemeral: true });
                                } else {
                                    await interaction_second.update({ content: 'No items with effects were found. Please add an effect to an item first.', components: [] });
                                    collector.stop();
                                }
                            }
                            //extensible for quests and npcs and whatever else
                        } else if (interaction_second.customId === 'PrereqRepAlphaSelector') {
                            let reputations = await connection.promise().query('select distinct r.* from reputations r inner join reputations_tiers rt on rt.reputation_id = r.id inner join reputations_tiers_effects rte on rt.id = rte.reputationtier_id where r.guild_id = ? and r.name like ?', [interaction.guildId, interaction_second.values[0] + '%']);
                            let reputationsKeyValues = [];
                            for (const reputation of reputations[0]) {
                                reputationsKeyValues.push({ label: reputation.name, value: reputation.id.toString() });
                            }
                            reputationSelectComponent = new StringSelectMenuBuilder().setOptions(reputationsKeyValues).setCustomId('PrereqRepSelector').setMinValues(1).setMaxValues(1);
                            const reputationSelectRow = new ActionRowBuilder().addComponents(reputationSelectComponent);
                            await interaction_second.update({ content: 'Please select the following options:', components: [reputationSelectRow], ephemeral: true });
                        } else if (interaction_second.customId === 'PrereqRepSelector') {
                            let reputation_id = interaction_second.values[0];
                            let result_values = await connection.promise().query('select distinct rt.* from reputations_tiers rt inner join reputations_tiers_effects rte on rt.id = rte.reputationtier_id where rt.reputation_id = ?', [reputation_id]);
                            let selectComponent;
                            if (result_values[0].length > 0) {
                                if (result_values[0].length <= 25) {
                                    let keyValues = [];
                                    for (const result_value of result_values[0]) {
                                        keyValues.push({ label: result_value.threshold_name, value: result_value.id.toString() });
                                    }
                                    selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('PrereqRepTierSelector').setMinValues(1).setMaxValues(1);
                                } else {
                                    result_values = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                                    let keyValues = [];
                                    for (const result_value of result_values) {
                                        keyValues.push({ label: result_value, value: result_value });
                                    }
                                    selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('PrereqRepTierAlphaSelector').setMinValues(1).setMaxValues(1);
                                }
                                const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                                await interaction_second.update({ content: 'Please select a reputation tier:', components: [selectRow], ephemeral: true });
                            } else {
                                await interaction_second.update({ content: 'No reputation tiers available for this reputation.', components: [], ephemeral: true });
                            }

                        } else if (interaction_second.customId === 'PrereqSkillAlphaSelector') {
                            let skills = await connection.promise().query('select distinct s.* from skills s inner join skills_effects se on s.id = se.skill_id where guild_id = ? and name like ?', [interaction.guildId, interaction_second.values[0] + '%']);
                            let skillsKeyValues = [];
                            for (const skill of skills[0]) {
                                let thisSkillKeyValue = { label: skill.name, value: skill.id.toString() };
                                skillsKeyValues.push(thisSkillKeyValue);
                            }
                            const skillSelectComponent = new StringSelectMenuBuilder().setOptions(skillsKeyValues).setCustomId('PrereqSkillSelector').setMinValues(1).setMaxValues(1);
                            const skillSelectRow = new ActionRowBuilder().addComponents(skillSelectComponent);
                            await interaction_second.update({ content: 'Please select a skill:', components: [skillSelectRow], ephemeral: true });
                        } else if (interaction_second.customId === 'PrereqSkillSelector' || interaction_second.customId === 'PrereqItemSelector' || interaction_second.customId === 'PrereqRepTierSelector') {
                            let effects;
                            if (interaction_second.customId === 'PrereqSkillSelector') {
                                effects = await connection.promise().query('select e.* from effects e join skills_effects se on e.id = se.effect_id where se.skill_id = ?', [interaction_second.values[0]]);
                            } else if (interaction_second.customId === 'PrereqItemSelector') {
                                effects = await connection.promise().query('select e.* from effects e join items_effects ie on e.id = ie.effect_id where ie.item_id = ?', [interaction_second.values[0]]);
                            } else if (interaction_second.customId === 'PrereqRepTierSelector') {
                                effects = await connection.promise().query('select e.* from effects e join reputations_tiers_effects rte on e.id = rte.effect_id where rte.reputationtier_id = ?', [interaction_second.values[0] + '%']);
                            }
                            let effectsKeyValues = [];
                            for (const effect of effects[0]) {
                                let label;
                                let description;
                                let prereqs = await connection.promise().query('select * from effects_prereqs where effect_id = ?', [effect.id]);
                                if (effect.type == 'message') {
                                    label = `Send message`;
                                    description = effect.typedata.slice(0, 18) + '...';
                                } else if (effect.type == 'wflag_inc' || effect.type == 'wflag_set') {
                                    let worldflag = await connection.promise().query('select * from worldflags where id = ?', [effect.type_id]);
                                    label = `Adjust world flag`;
                                    description = worldflag[0][0].name;
                                } else if (effect.type == 'cflag_inc' || effect.type == 'cflag_set') {
                                    let characterflag = await connection.promise().query('select * from characterflags where id = ?', [effect.type_id]);
                                    label = `Adjust character flag`;
                                    description = characterflag[0][0].name;
                                } else if (effect.type == 'skill') {
                                    let skill = await connection.promise().query('select * from skills where id = ?', [effect.type_id]);
                                    label = `Grant skill`;
                                    description = skill[0][0].name;
                                } else if (effect.type == 'archetype') {
                                    let archetype = await connection.promise().query('select * from archetypes where id = ?', [effect.type_id]);
                                    label = `Grant archetype`;
                                    description = archetype[0][0].name;
                                } else if (effect.type == 'reputation_inc' || effect.type == 'reputation_set') {
                                    let reputation = await connection.promise().query('select * from reputations where id = ?', [effect.type_id]);
                                    label = `Modify reputation`;
                                    description = reputation[0][0].name;
                                } else if (effect.type == 'stat_set' || effect.type == 'stat_inc') {
                                    let stat = await connection.promise().query('select * from stats where id = ?', [effect.type_id]);
                                    label = `Modify stat`;
                                    description = stat[0][0].name;
                                }
                                description += ` (${prereqs[0].length} prereqs already)`;
                                effectsKeyValues.push({ label: label, description: description, value: effect.id.toString() });
                            }
                            const effectSelectComponent = new StringSelectMenuBuilder().setOptions(effectsKeyValues).setCustomId('PrereqEffectSelector').setMinValues(1).setMaxValues(1);
                            const effectSelectRow = new ActionRowBuilder().addComponents(effectSelectComponent);
                            await interaction_second.update({ content: 'Please select an effect to remove:', components: [effectSelectRow], ephemeral: true });
                            // Displays PrereqEffectSelector.
                        } else if (interaction_second.customId === 'PrereqItemAlphaSelector') {
                            let items = await connection.promise().query('select distinct i.* from items i inner join items_effects ie on i.id = ie.item_id where guild_id = ? and name like ?', [interaction.guildId, interaction_second.values[0] + '%']);
                            let itemSelectComponent;
                            if (items[0].length > 0) {
                                let itemsKeyValues = [];
                                for (const item of items[0]) {
                                    itemsKeyValues.push({ label: item.name, value: item.id.toString() });
                                }
                                itemSelectComponent = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('PrereqItemSelector').setMinValues(1).setMaxValues(1);
                            }
                            const selectRow = new ActionRowBuilder().addComponents(itemSelectComponent);
                            await interaction_second.update({ content: 'Please select an item', components: [selectRow] });

                        } else if (interaction_second.customId === 'PrereqRepTierAlphaSelector') {
                            let result_values = await connection.promise().query('select distinct rt.* from reputations_tiers inner join reputations_tiers_effects rte on rt.id = rte.reputationtier_id where rt.reputation_id = ? and name like ?', [reputation_id, interaction_second.values[0] + '%']);
                            if (result_values.length > 0) {
                                let keyValues = [];
                                for (const result_value of result_values[0]) {
                                    keyValues.push({ label: result_value.threshold_name, value: result_value.id.toString() });
                                }
                                const selectComponent = new StringSelectMenuBuilder().setOptions(keyValues).setCustomId('PrereqRepTierSelector').setMinValues(1).setMaxValues(1);
                                const selectRow = new ActionRowBuilder().addComponents(selectComponent);
                                await interaction_second.update({ content: 'Please select a reputation tier:', components: [selectRow], ephemeral: true });
                            } else {
                                await interaction_second.update({ content: 'No reputation tiers available for this reputation.', components: [], ephemeral: true });
                                await collector.stop();
                            }
                        } else if (interaction_second.customId === 'PrereqEffectSelector') {
                            await connection.promise().query('delete from effects where id = ?', [interaction_second.values[0]]);
                            await interaction_second.update({ content: 'Effect removed.', components: [] });
                            await collector.stop();
                        }
                    }
                });
            }
        } else if (interaction.commandName === 'sendas') {
            let parrot_text = interaction.options.getString('message');
            let character = false;
            if (interaction.options.getString('character')) {
                character = interaction.options.getString('character');
            }
            let characters;
            if (interaction.member.permissions.has('ADMINISTRATOR')) {
                if (character) {
                    characters = await connection.promise().query('select * from characters where guild_id = ? and name like ?', [interaction.guildId, '%' + character + '%']);
                } else {
                    characters = await connection.promise().query('select * from characters where guild_id = ?', [interaction.guildId]);
                }
            } else {
                if (character) {
                    characters = await connection.promise().query('select c.* from players p join players_characters pc on p.id = pc.player_id join characters c on pc.character_id = c.id where p.user_id = ? and p.guild_id = ? and c.name like ?', [interaction.user.id, interaction.guildId, '%' + character + '%']);
                } else {
                    characters = await connection.promise().query('select c.* from players p join players_characters pc on p.id = pc.player_id join characters c on pc.character_id = c.id where p.user_id = ? and p.guild_id = ?', [interaction.user.id, interaction.guildId]);
                }
                // Check players_characters table for available characters
            }
            if (characters[0].length > 0) {
                if (characters[0].length > 1) {
                    let charactersAlphabetical;
                    let characterSelectComponent;
                    if (characters[0].length <= 25) {
                        charactersAlphabetical = false;
                        let charactersKeyValues = [];
                        for (const character of characters[0]) {
                            charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                        }
                        characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('SendAsCharacterSelector').setMinValues(1).setMaxValues(1);
                    } else {
                        charactersAlphabetical = true;
                        characters = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                        let charactersKeyValues = [];
                        for (const character of characters) {
                            charactersKeyValues.push({ label: character, value: character });
                        }
                        characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('SendAsAlphabetSelector').setMinValues(1).setMaxValues(1);
                    }

                    const characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                    let message = await interaction.reply({ content: 'Please select the following options:', components: [characterSelectRow], ephemeral: true });
                    let collector = message.createMessageComponentCollector();
                    collector.on('collect', async (interaction_second) => {
                        if (interaction_second.member.id === interaction.member.id) {
                            let characterSelected = interaction_second.values[0];
                            if (interaction_second.customId === 'SendAsAlphabetSelector') {
                                let characters;
                                if (interaction.member.permissions.has('ADMINISTRATOR')) {
                                    characters = await connection.promise().query('select * from characters where guild_id = ? and upper(character_name) like ?', [interaction.guildId, characterSelected + '%']);
                                } else {
                                    characters = await connection.promise().query('select c.* from players p join players_characters pc on p.id = pc.player_id join characters c on pc.character_id = c.id where p.user_id = ? and p.guild_id = ? and upper(c.character_name) like ?', [interaction.user.id, interaction.guildId, characterSelected + '%']);
                                }
                                if (characters[0].length > 0) {
                                    let charactersKeyValues = [];
                                    for (const character of characters[0]) {
                                        charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                                    }
                                    const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('SendAsCharacterSelector').setMinValues(1).setMaxValues(1);
                                    const characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                                    interaction.update({ components: [characterSelectRow] });
                                } else {
                                    interaction.update({ content: 'No characters with this first letter', components: [] });
                                }
                            } else {
                                let character_information = await connection.promise().query('select * from characters where id = ?', [characterSelected]);

                                let webhook_channel;
                                if (interaction.channel.type == ChannelType.GuildPrivateThread || interaction.channel.type == ChannelType.GuildPublicThread) {
                                    webhook_channel = interaction.channel.parent;
                                } else {
                                    webhook_channel = interaction.channel;
                                }
                                const webhooks = await webhook_channel.fetchWebhooks();
                                let webhook = webhooks.find(wh => wh.token);
                                if (!webhook) {
                                    webhook = await webhook_channel.createWebhook({ name: 'rrgbot' });
                                }
                                if (interaction.channel.type == ChannelType.GuildPrivateThread || interaction.channel.type == ChannelType.GuildPublicThread) {
                                    let attachment = interaction.options.getAttachment('attachment');
                                    if (attachment) {
                                        await webhook.send({ content: parrot_text, username: character_information[0][0].name, avatarURL: character_information[0][0].avatar_url, threadId: interaction.channel.id, files: [attachment] });
                                    } else {
                                        await webhook.send({ content: parrot_text, username: character_information[0][0].name, avatarURL: character_information[0][0].avatar_url, threadId: interaction.channel.id });
                                    }
                                } else {
                                    let attachment = interaction.options.getAttachment('attachment');
                                    if (attachment) {
                                        await webhook.send({ content: parrot_text, username: character_information[0][0].name, avatarURL: character_information[0][0].avatar_url, files: [attachment] });
                                    } else {
                                        await webhook.send({ content: parrot_text, username: character_information[0][0].name, avatarURL: character_information[0][0].avatar_url });
                                    }
                                }
                                interaction.editReply({ content: 'Success', components: [], ephemeral: true });
                            }
                        }
                    });
                } else {
                    let webhook_channel;
                    if (interaction.channel.type == ChannelType.GuildPrivateThread || interaction.channel.type == ChannelType.GuildPublicThread) {
                        webhook_channel = interaction.channel.parent;
                    } else {
                        webhook_channel = interaction.channel;
                    }
                    const webhooks = await webhook_channel.fetchWebhooks();
                    let webhook = webhooks.find(wh => wh.token);
                    if (!webhook) {
                        webhook = await webhook_channel.createWebhook({ name: 'rrgbot' });
                    }
                    if (interaction.channel.type == ChannelType.GuildPrivateThread || interaction.channel.type == ChannelType.GuildPublicThread) {
                        let attachment = interaction.options.getAttachment('attachment');
                        if (attachment) {
                            await webhook.send({ content: parrot_text, username: characters[0][0].name, avatarURL: characters[0][0].avatar_url, threadId: interaction.channel.id, files: [attachment] });
                        } else {
                            await webhook.send({ content: parrot_text, username: characters[0][0].name, avatarURL: characters[0][0].avatar_url, threadId: interaction.channel.id });
                        }
                    } else {
                        let attachment = interaction.options.getAttachment('attachment');
                        if (attachment) {
                            await webhook.send({ content: parrot_text, username: characters[0][0].name, avatarURL: characters[0][0].avatar_url, files: [attachment] });
                        } else {
                            await webhook.send({ content: parrot_text, username: characters[0][0].name, avatarURL: characters[0][0].avatar_url });
                        }
                    }
                    interaction.reply({ content: 'Success', components: [], ephemeral: true });
                }
            } else {
                interaction.reply({ content: "No characters appear to be available to you.", ephemeral: true });
            }
        }


        // PLAYER COMMANDS
        else if (isPlayer(interaction.user.id, interaction.guildId) || interaction.member.permissions.has("ADMINISTRATOR")) {
            if (interaction.commandName === 'move') {
                let is_enabled = await connection.promise().query('select ml.movement_allowed, ml.id from players join players_characters pc on players.id = pc.player_id join characters c on pc.character_id = c.id join movement_locations ml on ml.id = c.location_id where players.user_id = ? and players.guild_id = ? and pc.active = 1', [interaction.user.id, interaction.guildId]);
                if (is_enabled[0].length > 0 && is_enabled[0][0].movement_allowed == 1) {
                    let locations = await connection.promise().query('select * from movement_locations where guild_id = ? and movement_allowed = 1 and id <> ?', [interaction.guildId, is_enabled[0][0].id])
                    if (locations[0].length > 0) {
                        let locationsKeyValues = [];
                        for (const location of locations[0]) {
                            locationsKeyValues.push({ label: location.friendly_name, value: location.id.toString() });
                        }
                        const locationSelectComponent = new StringSelectMenuBuilder().setOptions(locationsKeyValues).setCustomId('LocationMovementSelector' + interaction.member.id).setMinValues(1).setMaxValues(1);
                        const locationSelectRow = new ActionRowBuilder().addComponents(locationSelectComponent);
                        interaction.reply({ content: 'Select a location to move to:', components: [locationSelectRow], ephemeral: true });
                    } else {
                        interaction.reply({ content: 'Sorry, but I can\'t find any other locations for you to move to. Try again another time, or contact the Orchestrators. :purple_heart:', ephemeral: true });
                    }
                    // retrieve any other movement-enabled locations.
                    // Create a DROPDOWN to select movement.
                } else {
                    interaction.reply({ content: 'Sorry, but you don\'t seem to be in a location that allows movement right now. Try again another time, or contact the Orchestrators. :purple_heart:', ephemeral: true });
                }
            } else if (interaction.commandName === 'sheet') {
                let current_character = await connection.promise().query('select character_id from players_characters join players p on p.id = players_characters.player_id where p.user_id = ? and players_characters.active = 1 and p.guild_id = ?', [interaction.user.id, interaction.guildId]);
                if (current_character[0].length > 0) {
                    let character_information = await connection.promise().query('select * from characters where id = ?', [current_character[0][0].character_id]);
                    let character_archetypes = await connection.promise().query('select * from archetypes a join characters_archetypes ca on ca.archetype_id = a.id where ca.character_id = ?', [current_character[0][0].character_id]);
                    let character_stats = await connection.promise().query('select s.*, cs.override_value from stats s left outer join characters_stats cs on cs.stat_id = s.id and cs.character_id = ? where guild_id = ? order by s.id asc', [current_character[0][0].character_id, interaction.guildId]);
                    let archetype_stats = await connection.promise().query('select ars.*, ca2.override_value from archetypestats ars join archetypes_archetypestats aa on ars.id = aa.archetypestat_id join characters_archetypes ca on aa.archetype_id = ca.archetype_id and ca.character_id = ? left outer join characters_archetypestats ca2 on ca2.stat_id = ars.id and ca2.character_id = ?', [current_character[0][0].character_id, current_character[0][0].character_id]);
                    let world_flags = await connection.promise().query('select * from worldflags where guild_id = ? and visible = 1', [interaction.guildId]);
                    let msg = `**${character_information[0][0].name}** - ${character_information[0][0].description}\n`
                    if (character_archetypes[0].length > 0) {
                        msg = msg.concat(`\n__Archetypes__\n`);
                        for (const thisArchetype of character_archetypes[0]) {
                            msg = msg.concat(`**${thisArchetype.name}** - ${thisArchetype.description}\n`);
                        }
                    }
                    if (character_stats[0].length > 0 || archetype_stats[0].length > 0 || world_flags[0].length > 0) {
                        msg = msg.concat(`\n__Stats__\n`);
                    }
                    if (character_stats[0].length > 0) {
                        for (const thisStat of character_stats[0]) {
                            if (typeof thisStat.override_value !== 'undefined' && thisStat.override_value != null) {
                                msg = msg.concat(`**${thisStat.name}** - ${thisStat.override_value}\n`);
                            } else { // TODO else if thisStat has an ARCHETYPE override value
                                msg = msg.concat(`**${thisStat.name}** - ${thisStat.default_value}\n`);
                            }

                        }
                    }
                    if (archetype_stats[0].length > 0) {
                        for (const thisStat of archetype_stats[0]) {
                            if (typeof thisStat.override_value !== 'undefined' && thisStat.override_value != null) {
                                msg = msg.concat(`**${thisStat.name}** - ${thisStat.override_value}\n`);
                            } else { // TODO else if thisStat has an ARCHETYPE override value
                                msg = msg.concat(`**${thisStat.name}** - ${thisStat.default_value}\n`);
                            }
                        }
                    }
                    if (world_flags[0].length > 0) {
                        // TODO
                        msg = msg.concat('\n--- *World Information* ---\n\n');
                        for (const thisFlag of world_flags[0]) {
                            msg = msg.concat(`**${thisFlag.name}** - ${thisFlag.value}\n`);
                        }
                    }
                    const buttonActionRow = new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder().setCustomId(`skillpage-asc-${current_character[0][0].character_id}-1`).setLabel('Skills').setStyle(ButtonStyle.Primary),
                            new ButtonBuilder().setCustomId(`inventory-asc-${current_character[0][0].character_id}-1`).setLabel('Inventory').setStyle(ButtonStyle.Primary)
                        );
                    // If game settings - reputation enabled, then add the Reputation button too
                    let reputation_enabled = await connection.promise().query('select * from game_settings where setting_name = "reputation" and guild_id = ?', [interaction.guildId]);
                    if (reputation_enabled[0].length > 0 && reputation_enabled[0][0].setting_value == true) {
                        buttonActionRow.addComponents(new ButtonBuilder().setCustomId(`reputation-asc-${current_character[0][0].character_id}-1`).setLabel('Reputation').setStyle(ButtonStyle.Primary));
                    }
                    await interaction.reply({ content: msg, components: [buttonActionRow], ephemeral: true });
                } else {
                    interaction.reply({ content: 'Somehow, you don\'t have an active character! If you\'re a player, this means something has gone HORRIBLY WRONG. Please let an Orchestrator know.', ephemeral: true });
                }
                // If number of characters for player is 1, return one sheet. Otherwise, return a dropdown (not relevant for this game, thank god! So this is a Future Improvement).
                // TODO: Separate command for administrators.

            } else if (interaction.commandName === 'rps') {
                if (interaction.options.getUser('challengee')) {
                    let challenged = interaction.options.getUser('challengee');
                    let queryData = [interaction.user.id, interaction.user.id, challenged.id, challenged.id];
                    let rps = await connection.promise().query('select * from rps where (challenger = ? or challenged = ? or challenger = ? or challenged = ?) and (challenger_throw is null or challenged_throw is null);', queryData);
                    if (rps[0].length > 0) {
                        interaction.reply({ content: 'Sorry, it looks like either you or your target is already in a duel!', ephemeral: true });
                    } else {
                        queryData = [interaction.user.id, challenged.id, interaction.channel.id];
                        await connection.promise().query('insert into rps (challenger, challenged, channel) values (?, ?, ?)', queryData);
                        //Create buttons, tag both users.
                        const rpsButtonR = new ButtonBuilder().setCustomId('rpsButtonR').setLabel('Rapid').setStyle('Primary');
                        const rpsButtonP = new ButtonBuilder().setCustomId('rpsButtonP').setLabel('Precision').setStyle('Primary');
                        const rpsButtonS = new ButtonBuilder().setCustomId('rpsButtonS').setLabel('Sweeping').setStyle('Primary');
                        const rpsRow = new ActionRowBuilder().addComponents(rpsButtonR, rpsButtonP, rpsButtonS);
                        await interaction.reply({ content: '<@' + interaction.user.id + '> has challenged <@' + challenged.id + '> to a duel!', components: [rpsRow] });
                    }
                    //also make sure they're on the same location maybe?
                } else {
                    let queryData = [interaction.user.id, interaction.user.id];
                    let rps = await connection.promise().query('select * from rps where (challenger = ? or challenged = ?) and (challenger_throw is null or challenged_throw is null)', queryData);
                    if (rps[0].length > 0) {
                        interaction.reply({ content: 'Sorry, it looks like you\'re already in a duel!', ephemeral: true });
                    } else {
                        queryData = [interaction.user.id, client.user.id, interaction.channel.id];
                        await connection.promise().query('insert into rps (challenger, challenged, channel) values (?, ?, ?)', queryData);
                        const rpsButtonR = new ButtonBuilder().setCustomId('rpsButtonR').setLabel('Rapid').setStyle('Primary');
                        const rpsButtonP = new ButtonBuilder().setCustomId('rpsButtonP').setLabel('Precision').setStyle('Primary');
                        const rpsButtonS = new ButtonBuilder().setCustomId('rpsButtonS').setLabel('Sweeping').setStyle('Primary');
                        const rpsRow = new ActionRowBuilder().addComponents(rpsButtonR, rpsButtonP, rpsButtonS);
                        await interaction.reply({ content: '<@' + interaction.user + '> has challenged me to a duel!', components: [rpsRow] });
                    }
                }
            } else if (interaction.commandName === 'rpsmulti') {
                let current_character = await connection.promise().query('select pc.character_id, c.name from players_characters pc join players p on p.id = pc.player_id join characters c on c.id = pc.character_id where p.user_id = ? and p.guild_id = ? and pc.active = 1', [interaction.user.id, interaction.guildId]);
                if (current_character[0].length > 0) {
                    let openMultiRPS = await connection.promise().query('select * from multirps where character_id = ? and open = 1', [current_character[0][0].character_id]);
                    if (openMultiRPS[0].length == 0) {
                        let multirps = await connection.promise().query('insert into multirps (character_id, open) values (?, ?)', [current_character[0][0].character_id, 1]);
                        let embed = new EmbedBuilder()
                            .setTitle(`MULTIRPS`)
                            .setDescription(`${current_character[0][0].name} v. TBD`);
                        const duelButtonR = new ButtonBuilder().setCustomId('R').setLabel('Rapid').setStyle('Primary'); // TODO ButtonBuilder doesn't exist in Discord.js v14
                        const duelButtonP = new ButtonBuilder().setCustomId('P').setLabel('Precision').setStyle('Primary');
                        const duelButtonS = new ButtonBuilder().setCustomId('S').setLabel('Sweeping').setStyle('Primary');
                        const duelButtonEnd = new ButtonBuilder().setCustomId('mrpsButtonEnd').setLabel('END').setStyle('Secondary');
                        const rpsRow = new ActionRowBuilder().addComponents(duelButtonR, duelButtonP, duelButtonS, duelButtonEnd);
                        let message = await interaction.reply({ embeds: [embed], components: [rpsRow] });
                        let collector = message.createMessageComponentCollector();
                        collector.on('collect', async (interaction_second) => {
                            let thisCharacter = await connection.promise().query('select pc.character_id, c.name from players_characters pc join players p on p.id = pc.player_id join characters c on c.id = pc.character_id where p.user_id = ? and p.guild_id = ? and pc.active = 1', [interaction_second.user.id, interaction.guildId]);
                            if (thisCharacter[0].length > 0) {
                                if (interaction_second.customId != 'mrpsButtonEnd') {
                                    interaction_second.deferUpdate();
                                    await connection.promise().query('replace into multirps_throws (throw, character_id, multirps_id) values (?, ?, ?)', [interaction_second.customId, thisCharacter[0][0].character_id, multirps[0].insertId]);
                                    let allCharacters = await connection.promise().query('select mt.character_id, c.name from multirps_throws mt join characters c on c.id = mt.character_id where mt.multirps_id = ? and mt.character_id != ?', [multirps[0].insertId, current_character[0][0].character_id]);
                                    let cNames;
                                    if (allCharacters[0].length > 0) {
                                        cNames = [];
                                        for (const character of allCharacters[0]) {
                                            cNames.push(character.name);
                                        }
                                    } else {
                                        cNames = ["TBD"];
                                    }
                                    const embed = new EmbedBuilder().setTitle(`MULTIRPS`).setDescription(`${current_character[0][0].name} v. ${cNames.join(', ')}`);
                                    message.edit({ embeds: [embed] });
                                } else {
                                    if (interaction.user.id == interaction_second.user.id) {
                                        let allCharacters = await connection.promise().query('select mt.character_id, c.name, mt.throw from multirps_throws mt join characters c on c.id = mt.character_id where mt.multirps_id = ?', [multirps[0].insertId]);
                                        let owner_throw;
                                        let character_throws = [];
                                        let character_names = [];
                                        if (allCharacters[0].length > 1) {
                                            for (const character of allCharacters[0]) {
                                                if (character.character_id == current_character[0][0].character_id) {
                                                    owner_throw = character.throw;
                                                } else {
                                                    character_throws.push({ name: character.name, throw: character.throw });
                                                    character_names.push(character.name);
                                                }
                                            }
                                            if (owner_throw) {
                                                let embed = new EmbedBuilder()
                                                    .setTitle('MULTIRPS')
                                                    .setDescription(`${current_character[0][0].name} v. ${character_names.join(', ')}`)
                                                    .addFields({ name: 'Boss Throw', value: `${(owner_throw == 'R' ? 'Rapid' : (owner_throw == 'S' ? 'Sweeping' : 'Precision'))}`, inline: true })
                                                let player_throws_text = "";
                                                for (const thisThrow of character_throws) {
                                                    player_throws_text += `${thisThrow.name}: ${thisThrow.throw}`
                                                    if (owner_throw == 'R' && thisThrow.throw == 'S' || owner_throw == 'S' && thisThrow.throw == 'P' || owner_throw == 'P' && thisThrow.throw == 'R') {
                                                        player_throws_text += ' (LOSE)';
                                                    } else if (owner_throw == thisThrow.throw) {
                                                        player_throws_text += ' (TIE)';
                                                    } else {
                                                        player_throws_text += ' (WIN)';
                                                    }
                                                    player_throws_text += '\n';
                                                }
                                                embed.addFields({ name: 'Player Throws', value: player_throws_text, inline: true });
                                                await connection.promise().query('update multirps set open = 0 where id = ?', [multirps[0].insertId]);
                                                await message.edit({ embeds: [embed], components: [] });
                                                interaction_second.deferUpdate();
                                                await collector.stop();
                                            } else {
                                                interaction_second.reply({ content: "Throw something please.", ephemeral: true });
                                            }
                                        } else {
                                            interaction_second.reply({ content: "Wait for more people to throw please.", ephemeral: true });
                                        }
                                    } else {
                                        interaction_second.reply({ content: 'Only the multirps owner can end the multirps', ephemeral: true });
                                    }
                                }
                            } else {
                                interaction_second.reply({ content: "uhhh do you have an active character?", ephemeral: true });
                            }
                        });

                    } else {
                        interaction.reply({ content: "you are already doing this", ephemeral: true });
                    }
                } else {
                    interaction.reply({ content: "uhhh do you have an active character?", ephemeral: true });
                }
            } else if (interaction.commandName === 'skill') { //TODO: Futureproof with alphabet selector.
                let current_character = await connection.promise().query('select players_characters.character_id, c.name from players_characters join players p on p.id = players_characters.player_id join characters c on c.id = players_characters.character_id where p.user_id = ? and p.guild_id = ? and players_characters.active = 1', [interaction.user.id, interaction.guildId]);
                if (current_character[0].length > 0) {
                    if (interaction.options.getSubcommand() === 'display') {
                        let skills = await connection.promise().query('select distinct s.* from skills s left outer join skills_characters sc on sc.skill_id = s.id left outer join skills_archetypes sa on sa.skill_id = s.id left outer join characters_archetypes ca on sa.archetype_id = ca.archetype_id where sc.character_id = ? or ca.character_id = ? order by s.id asc', [current_character[0][0].character_id, current_character[0][0].character_id]);
                        if (skills[0].length > 0) {
                            let skillsKeyValues = [];
                            for (const skill of skills[0]) {
                                skillsKeyValues.push({ label: skill.name, value: skill.id.toString() });
                            }
                            const skillSelectComponent = new StringSelectMenuBuilder().setOptions(skillsKeyValues).setCustomId('SkillSelector' + interaction.member.id).setMinValues(1).setMaxValues(1);
                            const skillSelectRow = new ActionRowBuilder().addComponents(skillSelectComponent);
                            let message = await interaction.reply({ content: 'Select a skill to share with the channel:', components: [skillSelectRow], ephemeral: true });
                            let collector = message.createMessageComponentCollector();
                            collector.on('collect', async (interaction_second) => {
                                if (interaction_second.member.id === interaction.member.id) {
                                    if (interaction_second.values[0]) {
                                        let skillSelected = skills[0].find(s => s.id == interaction_second.values[0]);
                                        await interaction_second.reply({ content: `${current_character[0][0].name}'s **${skillSelected.name}**: ${skillSelected.description}` });
                                        await collector.stop();
                                    }
                                }
                            });
                        } else {
                            await interaction.reply({ content: 'You don\'t seem to have any skills. Sorry about that.', ephemeral: true });
                        }

                        //dropdown
                        // put dropdown in thingy
                    } else if (interaction.options.getSubcommand() === 'use') {
                        let characterskills = await connection.promise().query('select s.* from skills_characters sc join skills s on sc.skill_id = s.id where sc.character_id = ? and (s.other_targetable = 1 or s.self_targetable = 1)', [current_character[0][0].character_id]);
                        let archetypeskills = await connection.promise().query('select s.* from skills s join skills_archetypes sa on sa.skill_id = s.id join characters_archetypes ca on sa.archetype_id = ca.archetype_id where ca.character_id = ? and (s.other_targetable = 1 or s.self_targetable = 1)', [current_character[0][0].character_id]);
                        let skills;
                        let selectedSkill;
                        let location_aware;
                        let characterDetails = await connection.promise().query('select * from characters where id = ?', [current_character[0][0].character_id]);
                        if (archetypeskills[0].length > 0) {
                            let skillids = new Set(archetypeskills[0].map(d => d.id));
                            if (characterskills[0].length > 0) {
                                skills = [...archetypeskills[0], ...characterskills[0].filter(d => !skillids.has(d.id))];
                            } else {
                                skills = archetypeskills[0];
                            }
                        } else if (characterskills[0].length > 0) {
                            skills = characterskills[0];
                        }
                        if (skills) {
                            let skillsKeyValues = [];
                            for (const skill of skills) {
                                skillsKeyValues.push({ label: skill.name, value: skill.id.toString() });
                            }
                            const skillSelectComponent = new StringSelectMenuBuilder().setOptions(skillsKeyValues).setCustomId('SkillUseSelector').setMinValues(1).setMaxValues(1);
                            const skillSelectRow = new ActionRowBuilder().addComponents(skillSelectComponent);
                            let message = await interaction.reply({ content: 'Select a skill to use:', components: [skillSelectRow], ephemeral: true });
                            let collector = message.createMessageComponentCollector();
                            collector.on('collect', async (interaction_second) => {
                                if (interaction.member.id === interaction_second.member.id) {
                                    if (interaction_second.customId === 'SkillUseSelector') {
                                        skillSelected = interaction_second.values[0];
                                        selectedSkill = skills.find(s => s.id == skillSelected);
                                        let characters;
                                        location_aware = await connection.promise().query('select setting_value from game_settings where guild_id = ? and setting_name = ?', [interaction.guildId, 'locationawareskills']);
                                        if (location_aware[0].length > 0 && location_aware[0][0].setting_value == 0) {
                                            if (selectedSkill.self_targetable) {
                                                if (selectedSkill.other_targetable) {
                                                    characters = await connection.promise().query('select * from characters where guild_id = ?', [interaction.guildId]);
                                                } else {
                                                    let characterSelected = await connection.promise().query('select * from characters c where id = ?', [characterDetails[0][0].id]);
                                                    let effects = await connection.promise().query('select e.* from effects e join skills_effects se on se.effect_id = e.id where se.skill_id = ?', [selectedSkill.id]);
                                                    for (const thisEffect of effects[0]) {
                                                        if (thisEffect.target == 'triggering_character') {
                                                            process_effect(characterDetails[0][0], thisEffect, 'skill', interaction.guildId, interaction.channel);
                                                        } else if (thisEffect.target == 'target') {
                                                            process_effect(characterDetails[0][0], thisEffect, 'skill', interaction.guildId, interaction.channel, characterSelected[0][0]);
                                                        } //potentially *specific* effects at some poitn in the future
                                                    }
                                                    await interaction_second.update({ content: 'Successfully used the skill!', components: [] });
                                                    collector.stop();
                                                }
                                            } else {
                                                characters = await connection.promise().query('select * from characters where guild_id = ? and id != ?', [interaction.guildId, characterDetails[0][0].id]);
                                            }
                                        } else {
                                            if (selectedSkill.self_targetable) {
                                                if (selectedSkill.other_targetable) {
                                                    characters = await connection.promise().query('select * from characters where guild_id = ? and location_id = ?', [interaction.guildId, characterDetails[0][0].location_id]);
                                                } else {
                                                    let characterSelected = await connection.promise().query('select * from characters c where id = ?', [characterDetails[0][0].id]);
                                                    let effects = await connection.promise().query('select e.* from effects e join skills_effects se on se.effect_id = e.id where se.skill_id = ?', [selectedSkill.id]);
                                                    for (const thisEffect of effects[0]) {
                                                        if (thisEffect.target == 'triggering_character') {
                                                            process_effect(characterDetails[0][0], thisEffect, 'skill', interaction.guildId, interaction.channel);
                                                        } else if (thisEffect.target == 'target') {
                                                            process_effect(characterDetails[0][0], thisEffect, 'skill', interaction.guildId, interaction.channel, characterSelected[0][0]);
                                                        } //potentially *specific* effects at some poitn in the future
                                                    }
                                                    await interaction_second.update({ content: 'Successfully used the skill!', components: [] });
                                                    collector.stop();
                                                }
                                            } else {
                                                characters = await connection.promise().query('select * from characters where guild_id = ? and location_id = ? and id != ?', [interaction.guildId, characterDetails[0][0].location_id, characterDetails[0][0].id]);
                                            }
                                        }
                                        if (!(selectedSkill.self_targetable && !selectedSkill.other_targetable)) {
                                            if (characters[0].length > 0) {
                                                let charactersAlphabetical;
                                                let characterSelectComponent;
                                                if (characters[0].length <= 25) {
                                                    charactersAlphabetical = false;
                                                    let charactersKeyValues = [];
                                                    for (const character of characters[0]) {
                                                        charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                                                    }
                                                    characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('SkillUseCharacterSelector').setMinValues(1).setMaxValues(1);
                                                } else {
                                                    charactersAlphabetical = true;
                                                    let characters = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                                                    let charactersKeyValues = [];
                                                    for (const character of characters) {
                                                        charactersKeyValues.push({ label: character, value: character });
                                                    }
                                                    characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('SkillUseAlphabetSelector').setMinValues(1).setMaxValues(1);
                                                }
                                                const characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                                                await interaction_second.update({ content: 'Select a character to target with this skill:', components: [characterSelectRow], ephemeral: true });
                                            } else {
                                                await interaction_second.update({ content: 'No valid characters found.', components: [] });
                                                collector.stop();
                                            }
                                        }
                                    } else if (interaction_second.customId === 'SkillUseAlphabetSelector') {
                                        if (location_aware[0].length > 0 && location_aware[0][0].setting_value == 0) {
                                            if (selectedSkill.self_targetable) {
                                                characters = await connection.promise().query('select * from characters where guild_id = ? and name like ?', [interaction.guildId, interaction_second.values[0] + '%']);
                                            } else {
                                                characters = await connection.promise().query('select * from characters where guild_id = ? and id != ? and name like ?', [interaction.guildId, characterDetails[0][0].id, interaction_second.values[0] + '%']);
                                            }
                                        } else {
                                            if (selectedSkill.self_targetable) {
                                                characters = await connection.promise().query('select * from characters where guild_id = ? and location_id = ? and name like ?', [interaction.guildId, characterDetails[0][0].location_id, interaction_second.values[0] + '%']);
                                            } else {
                                                characters = await connection.promise().query('select * from characters where guild_id = ? and location_id = ? and id != ? and name like ?', [interaction.guildId, characterDetails[0][0].location_id, characterDetails[0][0].id, interaction_second.values[0] + '%']);
                                            }
                                        }
                                        if (characters[0].length > 0) {
                                            let characterSelectComponent;
                                            charactersAlphabetical = false;
                                            let charactersKeyValues = [{ label: 'Select a character', value: '0' }];
                                            for (const character of characters[0]) {
                                                charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                                            }
                                            characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('SkillUseCharacterSelector' + interaction.member.id).setMinValues(1).setMaxValues(1);
                                            const characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                                            await interaction_second.update({ content: 'Select a character to target with this skill:', components: [characterSelectRow], ephemeral: true });
                                        } else {
                                            await interaction_second.update({ content: 'No valid characters found.', components: [] });
                                            collector.stop();
                                        }

                                    } else if (interaction_second.customId === 'SkillUseCharacterSelector') {
                                        let characterSelected = await connection.promise().query('select * from characters c where id = ?', [interaction_second.values[0]]);
                                        let effects = await connection.promise().query('select e.* from effects e join skills_effects se on se.effect_id = e.id where se.skill_id = ?', [selectedSkill.id]);
                                        for (const thisEffect of effects[0]) {
                                            if (thisEffect.target == 'triggering_character') {
                                                process_effect(characterDetails[0][0], thisEffect, 'skill', interaction.guildId, interaction.channel);
                                            } else if (thisEffect.target == 'target') {
                                                process_effect(characterDetails[0][0], thisEffect, 'skill', interaction.guildId, interaction.channel, characterSelected[0][0]);
                                            } //potentially *specific* effects at some poitn in the future
                                        }
                                        await interaction_second.update({ content: 'Successfully used the skill!', components: [] });
                                        collector.stop();
                                    }
                                }

                            });
                        } else {
                            interaction.reply({ content: 'You don\'t seem to have any usable skills.', ephemeral: true });
                        }
                    }
                } else {
                    interaction.reply({ content: 'You don\'t seem to have an active character. Check in with the mods on this, please.', ephemeral: true });
                }
            } else if (interaction.commandName === 'item') {
                if (interaction.options.getSubcommand() === 'display') {
                    let current_character = await connection.promise().query('select pc.character_id, c.name from players_characters pc join players p on p.id = pc.player_id join characters c on c.id = pc.character_id where p.user_id = ? and p.guild_id = ? and pc.active = 1', [interaction.user.id, interaction.guildId]);
                    if (current_character[0].length > 0) {
                        let items = await connection.promise().query('select i.* from items i join characters_items ci on ci.item_id = i.id where ci.character_id = ? and ci.quantity > 0', [current_character[0][0].character_id]);
                        if (items[0].length > 0) {
                            let itemsKeyValues = [];
                            for (const item of items[0]) {
                                itemsKeyValues.push({ label: item.name, value: item.id.toString() });
                            }
                            const itemSelectComponent = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('DispItemSelector').setMinValues(1).setMaxValues(1);
                            const itemSelectRow = new ActionRowBuilder().addComponents(itemSelectComponent);
                            let message = await interaction.reply({ content: 'Select a item to share with the channel:', components: [itemSelectRow], ephemeral: true });
                            let collector = message.createMessageComponentCollector();
                            collector.on('collect', async (interaction_second) => {
                                if (interaction_second.customId === 'DispItemSelector' && interaction.member.id === interaction_second.member.id) {
                                    itemSelected = interaction_second.values[0];
                                    let item = items[0].find(i => i.id == itemSelected);
                                    await interaction_second.reply({ content: `${current_character[0][0].name}'s **${item.name}**: ${item.description}` });
                                    await collector.stop();
                                }

                            });
                        } else {
                            interaction.reply({ content: 'You don\'t seem to have any items. Sorry about that.', ephemeral: true });
                        }
                    } else {
                        interaction.reply({ content: 'You don\'t seem to have an active character. Check in with the mods on this, please.', ephemeral: true });
                    }
                    //dropdown
                    // put dropdown in thingy
                } else if (interaction.options.getSubcommand() === 'give') { //TODO: Futureproof this with the alphabet selector.)
                    let quantity = interaction.options.getInteger('quantity');
                    if (quantity > 0) {
                        let current_character = await connection.promise().query('select c.location_id, pc.character_id, c.name, c.id from players_characters pc join characters c on c.id = pc.character_id join players p on p.id = pc.player_id where p.user_id = ? and p.guild_id = ? and pc.active = 1', [interaction.user.id, interaction.guildId]);
                        if (current_character[0].length > 0) {
                            let items = await connection.promise().query('select i.* from items i join characters_items ci on ci.item_id = i.id where ci.character_id = ? and ci.quantity > 0', [current_character[0][0].id]);
                            if (items[0].length > 0) {
                                let itemsKeyValues = [];
                                for (const item of items[0]) {
                                    itemsKeyValues.push({ label: item.name, value: item.id.toString() });
                                }
                                const itemSelectComponent = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('GiveItemSelector').setMinValues(1).setMaxValues(1);
                                const itemSelectRow = new ActionRowBuilder().addComponents(itemSelectComponent);

                                // Get locationawaretrading value from game_settings and adjust this query if necessary.
                                let locationaware = await connection.promise().query('select * from game_settings where setting_name = ? and guild_id = ?', ['locationawaretrading', interaction.guildId]);
                                let characters;
                                if (locationaware[0].length > 0 && locationaware[0][0].setting_value == 0) {
                                    characters = await connection.promise().query('select * from characters where guild_id = ? and id != ?', [interaction.guildId, current_character[0][0].id]);
                                } else {
                                    characters = await connection.promise().query('select * from characters where guild_id = ? and id != ? and location_id = ?', [interaction.guildId, current_character[0][0].id, current_character[0][0].location_id]);
                                }
                                if (characters[0].length > 0) {
                                    let charactersKeyValues = [];
                                    for (const character of characters[0]) {
                                        charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                                    }
                                    const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('GiveCharacterSelector').setMinValues(1).setMaxValues(characters[0].length);
                                    const characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);

                                    let message = await interaction.reply({ content: 'Select an item and a character to give it to:', components: [itemSelectRow, characterSelectRow], ephemeral: true });
                                    let collector = message.createMessageComponentCollector();
                                    let itemSelected;
                                    let characterSelected;
                                    collector.on('collect', async (interaction_second) => {
                                        if (interaction_second.member.id === interaction.member.id) {
                                            if (interaction_second.values[0]) {
                                                if (interaction_second.customId === 'GiveItemSelector') {
                                                    itemSelected = interaction_second.values[0];
                                                } else {
                                                    characterSelected = interaction_second.values[0];
                                                }
                                                if (itemSelected && characterSelected) {
                                                    //get item quantity and update if it's a valid number
                                                    let item_current = await connection.promise().query('select * from characters_items where character_id = ? and item_id = ?', [current_character[0][0].id, itemSelected]);
                                                    if (item_current[0][0].quantity >= quantity) {
                                                        //check if recipient has any of that item yet, and insert or update as needed
                                                        let recipient_has = await connection.promise().query('select * from characters_items where character_id = ? and item_id = ?', [characterSelected, itemSelected]);
                                                        if (recipient_has[0].length > 0) {
                                                            await connection.promise().query('update characters_items set quantity = ? where character_id = ? and item_id = ?', [quantity + recipient_has[0][0].quantity, characterSelected, itemSelected]);
                                                        } else {
                                                            await connection.promise().query('insert into characters_items (character_id, item_id, quantity) values (?, ?, ?)', [characterSelected, itemSelected, quantity]);
                                                        }
                                                        //check if giver quantity = number given, and delete or update as needed
                                                        let giver_has = await connection.promise().query('select * from characters_items where character_id = ? and item_id = ?', [current_character[0][0].id, itemSelected]);
                                                        if (giver_has[0][0].quantity - quantity > 0) {
                                                            await connection.promise().query('update characters_items set quantity = ? where character_id = ? and item_id = ?', [giver_has[0][0].quantity - quantity, current_character[0][0].id, itemSelected]);
                                                        } else {
                                                            await connection.promise().query('delete from characters_items where character_id = ? and item_id = ?', [current_character[0][0].id, itemSelected]);
                                                        }
                                                        let item = items[0].find(i => i.id == itemSelected);
                                                        let character_destination = characters[0].find(c => c.id == characterSelected);
                                                        await interaction_second.update({ content: "Interaction processed.", components: [] });
                                                        await interaction_second.channel.send({ content: `${current_character[0][0].name} gives ${character_destination.name} their **${item.name}**!` });
                                                        await collector.stop();
                                                    } else {
                                                        await interaction_second.update({ content: "You don't have enough of that item to give that quantity.", components: [] });
                                                        await collector.stop();
                                                    }

                                                } else {
                                                    await interaction_second.deferUpdate();
                                                }
                                            } else {
                                                await interaction_second.deferUpdate();
                                            }
                                        }
                                    });
                                    //okay now set up the message

                                    // and the collector

                                    // and then process the give inside the collector (update item owner in characters_items)
                                } else {
                                    interaction.reply({ content: 'There don\'t seem to be any other characters in this game...or maybe just in your area. You may want to double check on this.', ephemeral: true });
                                }
                            } else {
                                interaction.reply({ content: 'You don\'t seem to have any items. Sorry about that.', ephemeral: true });
                            }
                        } else {
                            interaction.reply({ content: 'You don\'t seem to have an active character. If you weren\'t expecting to see this message, check in with the mods.', ephemeral: true });
                        }
                    } else {
                        interaction.reply({ content: 'You can\'t give a negative number or zero of an item.', ephemeral: true });
                    }
                } else if (interaction.options.getSubcommand() === 'use') {
                    let current_character = await connection.promise().query('select pc.character_id, c.name from players_characters pc join players p on p.id = pc.player_id join characters c on c.id = pc.character_id where p.user_id = ? and p.guild_id = ? and pc.active = 1', [interaction.user.id, interaction.guildId]);
                    let items = await connection.promise().query('select i.* from characters_items ci join items i on ci.item_id = i.id where ci.character_id = ? and (i.other_targetable = 1 or i.self_targetable = 1) and ci.quantity > 0', [current_character[0][0].character_id]);
                    let selectedItem;
                    let location_aware;
                    let characterDetails = await connection.promise().query('select * from characters where id = ?', [current_character[0][0].character_id]);
                    if (items[0].length > 0) {
                        let itemsKeyValues = [];
                        for (const item of items[0]) {
                            itemsKeyValues.push({ label: item.name, value: item.id.toString() });
                        }
                        const itemSelectComponent = new StringSelectMenuBuilder().setOptions(itemsKeyValues).setCustomId('ItemUseSelector').setMinValues(1).setMaxValues(1);
                        const itemSelectRow = new ActionRowBuilder().addComponents(itemSelectComponent);
                        let message = await interaction.reply({ content: 'Select an item to use:', components: [itemSelectRow], ephemeral: true });
                        let collector = message.createMessageComponentCollector();
                        collector.on('collect', async (interaction_second) => {
                            if (interaction.member.id === interaction_second.member.id) {
                                if (interaction_second.customId === 'ItemUseSelector') {
                                    itemSelected = interaction_second.values[0];
                                    console.log(itemSelected);
                                    selectedItem = items[0].find(i => i.id == itemSelected);
                                    let characters;
                                    location_aware = await connection.promise().query('select setting_value from game_settings where guild_id = ? and setting_name = ?', [interaction.guildId, 'locationawareskills']);
                                    if (location_aware[0].length > 0 && location_aware[0][0].setting_value == 0) {
                                        if (selectedItem.self_targetable == 1) {
                                            console.log(selectedItem);
                                            if (selectedItem.other_targetable == 1) {
                                                characters = await connection.promise().query('select * from characters where guild_id = ?', [interaction.guildId]);
                                            } else {
                                                let characterSelected = await connection.promise().query('select * from characters c where id = ?', [characterDetails[0][0].id]);
                                                let effects = await connection.promise().query('select e.* from effects e join items_effects ie on ie.effect_id = e.id where ie.item_id = ?', [selectedItem.id]);
                                                for (const thisEffect of effects[0]) {
                                                    if (thisEffect.target == 'triggering_character') {
                                                        process_effect(characterDetails[0][0], thisEffect, 'item', interaction.guildId, interaction.channel);
                                                    } else if (thisEffect.target == 'target') {
                                                        process_effect(characterDetails[0][0], thisEffect, 'item', interaction.guildId, interaction.channel, characterSelected[0][0]);
                                                    } //potentially *specific* effects at some poitn in the future
                                                }
                                                if (selectedItem.consumable) {
                                                    await connection.promise().query('update characters_items set quantity = quantity - 1 where item_id = ? and character_id = ?', [selectedItem.id, characterDetails[0][0].id]);
                                                }
                                                await interaction_second.update({ content: 'Successfully used the item!', components: [] });
                                                collector.stop();
                                            }
                                        } else {
                                            characters = await connection.promise().query('select * from characters where guild_id = ? and id != ?', [interaction.guildId, characterDetails[0][0].id]);
                                        }
                                    } else {
                                        if (selectedItem.self_targetable == 1) {
                                            console.log(selectedItem);
                                            if (selectedItem.other_targetable == 1) {
                                                characters = await connection.promise().query('select * from characters where guild_id = ? and location_id = ?', [interaction.guildId, characterDetails[0][0].location_id]);
                                            } else {
                                                let characterSelected = await connection.promise().query('select * from characters c where id = ?', [characterDetails[0][0].id]);
                                                let effects = await connection.promise().query('select e.* from effects e join items_effects se on ie.effect_id = e.id where ie.item_id = ?', [selectedItem.id]);
                                                for (const thisEffect of effects[0]) {
                                                    if (thisEffect.target == 'triggering_character') {
                                                        process_effect(characterDetails[0][0], thisEffect, 'item', interaction.guildId, interaction.channel);
                                                    } else if (thisEffect.target == 'target') {
                                                        process_effect(characterDetails[0][0], thisEffect, 'item', interaction.guildId, interaction.channel, characterSelected[0][0]);
                                                    } //potentially *specific* effects at some poitn in the future
                                                }
                                                if (selectedItem.consumable) {
                                                    await connection.promise().query('update characters_items set quantity = quantity - 1 where item_id = ? and character_id = ?', [selectedItem.id, characterDetails[0][0].id]);
                                                }
                                                await interaction_second.update({ content: 'Successfully used the item!', components: [] });
                                                collector.stop();
                                            }
                                        } else {
                                            characters = await connection.promise().query('select * from characters where guild_id = ? and location_id = ? and id != ?', [interaction.guildId, characterDetails[0][0].location_id, characterDetails[0][0].id]);
                                        }
                                    }
                                    if (selectedItem.self_targetable == 0 && selectedItem.other_targetable == 1) {
                                        if (characters[0].length > 0) {
                                            let charactersAlphabetical;
                                            let characterSelectComponent;
                                            if (characters[0].length <= 25) {
                                                charactersAlphabetical = false;
                                                let charactersKeyValues = [];
                                                for (const character of characters[0]) {
                                                    charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                                                }
                                                characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('ItemUseCharacterSelector').setMinValues(1).setMaxValues(1);
                                            } else {
                                                charactersAlphabetical = true;
                                                let characters = [...'ABCDEFGHIJKLMNOPQRSTUVWYZ'];
                                                let charactersKeyValues = [];
                                                for (const character of characters) {
                                                    charactersKeyValues.push({ label: character, value: character });
                                                }
                                                characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('ItemUseAlphabetSelector').setMinValues(1).setMaxValues(1);
                                            }
                                            const characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                                            await interaction_second.update({ content: 'Select a character to target with this item:', components: [characterSelectRow], ephemeral: true });
                                        } else {
                                            await interaction_second.update({ content: 'No valid characters found.', components: [] });
                                            collector.stop();
                                        }
                                    }
                                } else if (interaction_second.customId === 'ItemUseAlphabetSelector') {
                                    if (location_aware[0].length > 0 && location_aware[0][0].setting_value == 0) {
                                        if (selectedItem.self_targetable) {
                                            characters = await connection.promise().query('select * from characters where guild_id = ? and name like ?', [interaction.guildId, interaction_second.values[0] + '%']);
                                        } else {
                                            characters = await connection.promise().query('select * from characters where guild_id = ? and id != ? and name like ?', [interaction.guildId, characterDetails[0][0].id, interaction_second.values[0] + '%']);
                                        }
                                    } else {
                                        if (selectedItem.self_targetable) {
                                            characters = await connection.promise().query('select * from characters where guild_id = ? and location_id = ? and name like ?', [interaction.guildId, characterDetails[0][0].location_id, interaction_second.values[0] + '%']);
                                        } else {
                                            characters = await connection.promise().query('select * from characters where guild_id = ? and location_id = ? and id != ? and name like ?', [interaction.guildId, characterDetails[0][0].location_id, characterDetails[0][0].id, interaction_second.values[0] + '%']);
                                        }
                                    }
                                    if (characters[0].length > 0) {
                                        charactersAlphabetical = false;
                                        let charactersKeyValues = [];
                                        for (const character of characters[0]) {
                                            charactersKeyValues.push({ label: character.name, value: character.id.toString() });
                                        }
                                        const characterSelectComponent = new StringSelectMenuBuilder().setOptions(charactersKeyValues).setCustomId('ItemUseCharacterSelector' + interaction.member.id).setMinValues(1).setMaxValues(1);
                                        const characterSelectRow = new ActionRowBuilder().addComponents(characterSelectComponent);
                                        await interaction_second.update({ content: 'Select a character to target with this item:', components: [characterSelectRow], ephemeral: true });
                                    } else {
                                        await interaction_second.update({ content: 'No valid characters found.', components: [] });
                                        collector.stop();
                                    }

                                } else if (interaction_second.customId === 'ItemUseCharacterSelector' + interaction.member.id) {
                                    let characterSelected = await connection.promise().query('select * from characters c where id = ?', [interaction_second.values[0]]);
                                    let effects = await connection.promise().query('select e.* from effects e join items_effects ie on ie.effect_id = e.id where ie.item_id = ?', [selectedItem.id]);
                                    for (const thisEffect of effects[0]) {
                                        if (thisEffect.target == 'triggering_character') {
                                            process_effect(characterDetails[0][0], thisEffect, 'item', interaction.guildId, interaction.channel);
                                        } else if (thisEffect.target == 'target') {
                                            process_effect(characterDetails[0][0], thisEffect, 'item', interaction.guildId, interaction.channel, characterSelected[0][0]);
                                        } //potentially *specific* effects at some poitn in the future
                                    }
                                    if (selectedItem.consumable) {
                                        await connection.promise().query('update characters_items set quantity = quantity - 1 where item_id = ? and character_id = ?', [selectedItem.id, characterDetails[0][0].id]);
                                    }
                                    await interaction_second.update({ content: 'Successfully used the item!', components: [] });
                                    collector.stop();
                                }
                            }

                        });
                    } else {
                        interaction.reply({ content: 'You don\'t seem to have any usable items.', ephemeral: true });
                    }
                }
            } else if (interaction.commandName === 'duel') {
                let isHealthStat = await connection.promise().query('select * from stats join stats_specialstats sps on stats.id = sps.stat_id where stats.guild_id = ? and sps.special_type = "health"', [interaction.guildId]);
                if (isHealthStat[0].length > 0) {
                    let target = interaction.options.getUser('target');
                    let player = await connection.promise().query('select c.* from characters c join players_characters pc on c.id = pc.character_id join players p on pc.player_id = p.id where pc.active = 1 and p.user_id = ? and p.guild_id = ?', [interaction.user.id, interaction.guildId]);
                    target = await connection.promise().query('select c.* from characters c join players_characters pc on c.id = pc.character_id join players p on pc.player_id = p.id where pc.active = 1 and p.user_id = ? and p.guild_id = ?', [target.id, interaction.guildId]);
                    if (player[0][0] && target[0][0]) {
                        let isCustomPlayerHealth = await connection.promise().query('select override_value from characters_stats where character_id = ? and stat_id = ?', [player[0][0].id, isHealthStat[0][0].id]);
                        let isCustomTargetHealth = await connection.promise().query('select override_value from characters_stats where character_id = ? and stat_id = ?', [target[0][0].id, isHealthStat[0][0].id]);
                        let computedPlayerHealth;
                        let computedTargetHealth;
                        if (isCustomPlayerHealth[0].length > 0) {
                            computedPlayerHealth = isCustomPlayerHealth[0][0].override_value;
                        } else {
                            computedPlayerHealth = isHealthStat[0][0].default_value;
                        }
                        if (isCustomTargetHealth[0].length > 0) {
                            computedTargetHealth = isCustomTargetHealth[0][0].override_value;
                        } else {
                            computedTargetHealth = isHealthStat[0][0].default_value;
                        }
                        let embed = new EmbedBuilder()
                            .setTitle(`DUEL: ${player[0][0].name} v. ${target[0][0].name}`)
                            .setDescription(`Round 1`)
                            .addFields(
                                { name: player[0][0].name, value: `${isHealthStat[0][0].name}: ${computedPlayerHealth}`, inline: true }, // active skills, innates, etc
                                { name: target[0][0].name, value: `${isHealthStat[0][0].name}: ${computedTargetHealth}`, inline: true } // active skills, innates, etc
                            );
                        let duel = await connection.promise().query('insert into duels (player_id, target_id) values (?, ?)', [player[0][0].id, target[0][0].id]);
                        const duelButtonR = new ButtonBuilder().setCustomId('duelButtonR' + duel[0].insertId).setLabel('Rapid').setStyle('Primary'); // TODO ButtonBuilder doesn't exist in Discord.js v14
                        const duelButtonP = new ButtonBuilder().setCustomId('duelButtonP' + duel[0].insertId).setLabel('Precision').setStyle('Primary');
                        const duelButtonS = new ButtonBuilder().setCustomId('duelButtonS' + duel[0].insertId).setLabel('Sweeping').setStyle('Primary');
                        const duelButtonSkill = new ButtonBuilder().setCustomId('duelButtonSkill' + duel[0].insertId).setLabel('Declare Innates').setStyle('Primary');
                        const rpsRow = new ActionRowBuilder().addComponents(duelButtonR, duelButtonP, duelButtonS, duelButtonSkill);
                        let msg = interaction.reply({ embeds: [embed], components: [rpsRow] });
                        // buttons rps + skill; skill offers dropdown using interaction.followUp
                    } else {
                        await interaction.reply({ content: 'Either you aren\'t an active character or your target isn\'t. Please double check!', ephemeral: true });
                    }
                } else {
                    await interaction.reply({ content: 'No health stat is set. Check with the Orchestrators, please!', ephemeral: true });
                }
            } else if (interaction.commandName === 'deck') {
                let activeCharacter = await connection.promise().query('select c.* from characters c join players_characters pc on c.id = pc.character_id join players p on pc.player_id = p.id where pc.active = 1 and p.user_id = ? and p.guild_id = ?', [interaction.user.id, interaction.guildId]);
                if (activeCharacter[0][0]) {
                    let tiles = await connection.promise().query('select * from characters_tiles ct join tiles t on ct.tile_id = t.id where ct.character_id = ?', [activeCharacter[0][0].id]);
                    if (tiles[0].length > 0) {
                        let messageText = '';
                        for (const thisTile of tiles[0]) {
                            messageText += `**${thisTile.name}**: rarity ${thisTile.rarity} (type \`/tile\` for more details)\n`;
                        }
                        if (tiles[0].length >= 5) {
                            messageText += '\nRemember, you can challenge another player using `/ttchallenge`!';
                        }
                        await interaction.reply({ content: messageText, ephemeral: true });
                    } else {
                        await interaction.reply({ content: 'You don\'t appear to have any tiles, ' + activeCharacter[0][0].name, ephemeral: true });
                    }
                } else {
                    await interaction.reply({ content: 'You don\'t appear to have an active character.', ephemeral: true });
                }
            } else if (interaction.commandName === 'roll') {
                //dice, sides, public, fixed_add
                let dice = interaction.options.getInteger('dice');
                let sides = interaction.options.getInteger('sides');
                let total = 0;
                let indivDice = [];
                for (i = 1; i <= dice; i++) {
                    let thisValue = Math.floor(Math.random() * sides + 1);
                    indivDice.push(thisValue);
                    total += thisValue;
                }
                if (interaction.options.getInteger('fixed_add')) {
                    total += interaction.options.getInteger('fixed_add');
                }
                if (interaction.options.getBoolean('public') == true) {
                    interaction.reply({ content: '`' + dice + 'd' + sides + (interaction.options.getInteger('fixed_add') ? ' + ' + interaction.options.getInteger('fixed_add').toString() : '') + ' = ' + indivDice + (interaction.options.getInteger('fixed_add') ? ' + ' + interaction.options.getInteger('fixed_add') : '') + ' = ' + total + '`' });
                } else {
                    interaction.reply({ content: '`' + dice + 'd' + sides + (interaction.options.getInteger('fixed_add') ? ' + ' + interaction.options.getInteger('fixed_add').toString() : '') + ' = ' + indivDice + (interaction.options.getInteger('fixed_add') ? ' + ' + interaction.options.getInteger('fixed_add') : '') + ' = ' + total + '`', ephemeral: true });
                }
            } else if (interaction.commandName === 'ticket') {
                if (interaction.options.getSubcommand() === 'channel') {
                    let audit_channel = await connection.promise().query('select * from game_settings where setting_name = "audit_channel" and guild_id = ?', [interaction.guild.id]);
                    if (audit_channel[0].length > 0) {
                        let categories = await connection.promise().query('select * from tickets_categories where guildid = ?', [interaction.guild.id]);
                        if (categories[0].length > 0) {
                            let existing_channel = await connection.promise().query('select * from game_settings where setting_name = "ticket_channel" and guild_id = ?', [interaction.guild.id]);
                            if (existing_channel[0].length > 0) {
                                let channel = await client.channels.cache.get(existing_channel[0][0].setting_value);
                                let existing_message = await connection.promise().query('select * from game_settings where setting_name = "ticket_message" and guild_id = ?', [interaction.guild.id]);
                                if (existing_message[0].length > 0) {
                                    await channel.messages.fetch(existing_message[0][0].setting_value).then(msg => msg.delete());
                                }
                                await connection.promise().query('update game_settings set setting_value = ? where setting_name = "ticket_channel" and guild_id = ?', [interaction.options.getChannel('channel').id, interaction.guild.id]);
                            } else {
                                await connection.promise().query('insert into game_settings (setting_name, guild_id, setting_value) values (?, ?, ?)', ["ticket_channel", interaction.guild.id, interaction.options.getChannel('channel').id]) // really shouldnt we consolidate these into an replace into or whatever
                            }
                            const embeddedMessage = new EmbedBuilder()
                                .setColor(0x770000)
                                .setTitle('Ticket System')
                                .setDescription('Please select a ticket type from the dropdown menu to begin opening a support ticket.');
                            let categoriesKeyValues = [];
                            for (const category of categories[0]) {
                                categoriesKeyValues.push({ label: `${category.name}`, value: category.id.toString() });
                            }
                            const categorySelectComponent = new StringSelectMenuBuilder().setOptions(categoriesKeyValues).setCustomId('TicketCategorySelector').setMinValues(1).setMaxValues(1);
                            const categorySelectRow = new ActionRowBuilder().addComponents(categorySelectComponent);
                            let message = await interaction.options.getChannel('channel').send({ embeds: [embeddedMessage], components: [categorySelectRow] });
                            await connection.promise().query('replace into game_settings (setting_name, guild_id, setting_value) values (?, ?, ?)', ["ticket_message", interaction.guild.id, message.id]);
                            interaction.reply({ content: 'Assigned ticket channel and sent message.', ephemeral: true });
                        } else {
                            interaction.reply({ content: 'Please create at least one ticket category first, using `/addticketcategory`.', ephemeral: true })
                        }
                    } else {
                        interaction.reply({ content: 'Please create an audit channel first, using `/auditchannel`.', ephemeral: true });
                    }
                } else if (interaction.options.getSubcommand() === 'addcategory') {
                    let name = interaction.options.getString('name');
                    let categories = await connection.promise().query('select * from tickets_categories where guildid = ? and name = ?', [interaction.guild.id, name]);
                    if (categories[0].length > 0) {
                        interaction.reply({ content: 'You already have a category with that name.', ephemeral: true });
                    } else {
                        await connection.promise().query('insert into tickets_categories (guildid, name) values (?, ?)', [interaction.guild.id, name]);
                        let channel_db = await connection.promise().query('select * from game_settings where setting_name = "ticket_channel" and guild_id = ?', [interaction.guild.id]);
                        if (channel_db[0].length > 0) {
                            let message = await connection.promise().query('select * from game_settings where setting_name = "ticket_message" and guild_id = ?', [interaction.guild.id]);
                            let categories = await connection.promise().query('select * from tickets_categories where guildid = ?', [interaction.guild.id]);
                            if (categories[0].length > 25) {
                                await connection.promise().query('delete from tickets_categories where guildid = ? and name = ?', [interaction.guild.id, name]);
                                interaction.reply({ content: 'You have more than 25 ticket categories. Please delete some and try adding this again.', ephemeral: true });
                            } else {
                                let channel = await client.channels.cache.get(channel_db[0][0].setting_value);
                                let categoriesKeyValues = [];
                                const embeddedMessage = new EmbedBuilder()
                                    .setColor(0x770000)
                                    .setTitle('Ticket System')
                                    .setDescription('Please select a ticket type from the dropdown menu to begin opening a support ticket.');
                                for (const category of categories[0]) {
                                    categoriesKeyValues.push({ label: `${category.name}`, value: category.id.toString() });
                                }
                                const categorySelectComponent = new StringSelectMenuBuilder().setOptions(categoriesKeyValues).setCustomId('TicketCategorySelector').setMinValues(1).setMaxValues(1);
                                const categorySelectRow = new ActionRowBuilder().addComponents(categorySelectComponent);
                                await channel.messages.fetch(message[0][0].setting_value).then(msg => msg.edit({ embeds: [embeddedMessage], components: [categorySelectRow] }));
                                interaction.reply({ content: 'Created category.', ephemeral: true });
                            }
                        } else {
                            interaction.reply({ content: 'Created category.', ephemeral: true });
                        }
                    }
                } else if (interaction.options.getSubcommand() === 'close') {
                    if (interaction.channel.isThread()) {
                        let ticket = await connection.promise().query('select * from tickets where thread_id = ?', [interaction.channel.id]);
                        if (ticket[0].length > 0) {
                            let ticketRole = await connection.promise().query('select * from tickets_categories_roles where category_id = ?', [ticket[0][0].category_id]);
                            let category = await connection.promise().query('select * from tickets_categories where id = ?', [ticket[0][0].category_id]);
                            if (interaction.member.permissions.has(PermissionsBitField.Flags.Administrator) || interaction.member.roles.cache.has(ticketRole[0][0].role_id)) {
                                let reason = interaction.options.getString('reason');
                                let openuser = await interaction.guild.members.fetch(ticket[0][0].uid_open);
                                if (!openuser.permissions.has(PermissionsBitField.Flags.Administrator)) {
                                    await interaction.channel.members.remove(openuser.id);
                                }
                                await interaction.reply({ content: `Ticket closed by ${interaction.user}` });
                                await interaction.channel.setArchived(true);
                                // Archive thread
                                await connection.promise().query('update tickets set uid_close = ? where thread_id = ?', [interaction.member.id, interaction.channel.id]);
                                // Create embed
                                let settingvalue = await connection.promise().query('select * from game_settings where guild_id = ? and setting_name = ?', [interaction.guild.id, 'audit_channel']);
                                let audit_channel = await client.channels.cache.get(settingvalue[0][0].setting_value);
                                let embed = new EmbedBuilder()
                                    .setTitle('Ticket closed!')
                                    .setDescription(ticket[0][0].title)
                                    .setAuthor({ name: interaction.member.displayName })
                                    .addFields(
                                        {
                                            name: 'Thread link',
                                            value: interaction.channel.toString(),
                                            inline: true
                                        },
                                        {
                                            name: 'Category',
                                            value: category[0][0].name,
                                            inline: true
                                        },
                                        {
                                            name: 'Closure notes',
                                            value: reason,
                                            inline: false
                                        }
                                    )
                                    .setTimestamp();
                                audit_channel.send({ embeds: [embed] });
                                // Remove open_uid from thread
                                // Send message to audit channel
                                // ack the interaction silently
                                //TODO close reason
                            } else {
                                interaction.reply({ content: 'no admin or appropriate role', ephemeral: true });
                            }
                        } else {
                            interaction.reply({ content: 'couldn\'t find ticket with thread id', ephemeral: true });
                        }
                    }
                } else if (interaction.options.getSubcommand() === 'categorygroup') {
                    let categories = await connection.promise().query('select * from tickets_categories where guildid = ?', [interaction.guild.id]);
                    let categoriesKeyValues = [];
                    if (categories[0].length > 0) {
                        for (const category of categories[0]) {
                            categoriesKeyValues.push({ label: `${category.name}`, value: category.id.toString() });
                        }
                        const categorySelectComponent = new StringSelectMenuBuilder().setOptions(categoriesKeyValues).setCustomId('CategorySelector').setMinValues(1).setMaxValues(1);
                        const categorySelectRow = new ActionRowBuilder().addComponents(categorySelectComponent);
                        let message = await interaction.reply({ content: 'Select a category to assign a role to.', components: [categorySelectRow], ephemeral: true });
                        const collector = message.createMessageComponentCollector();
                        let categorySelected;
                        let rolesSelected;
                        collector.on('collect', async (interaction_select) => {
                            if (interaction_select.values[0]) {
                                if (interaction_select.customId === 'CategorySelector') {
                                    interaction_select.deferUpdate();
                                    categorySelected = interaction_select.values[0];
                                    const roleSelectComponent = new RoleSelectMenuBuilder().setCustomId('RoleSelector').setMinValues(1).setMaxValues(5);
                                    const roleSelectRow = new ActionRowBuilder().addComponents(roleSelectComponent);
                                    await interaction.editReply({ content: 'Select the roles you want to assign.', components: [roleSelectRow] });
                                } else if (interaction_select.customId === 'RoleSelector') {
                                    rolesSelected = interaction_select.values;
                                    for (const role of rolesSelected) {
                                        await connection.promise().query('insert into tickets_categories_roles (category_id, role_id) values (?, ?)', [categorySelected, role]);
                                    }
                                    await interaction.editReply({ content: 'Role assigned to category successfully.', components: [] });
                                    await collector.stop();
                                }
                            }
                        });
                    }
                } else if (interaction.options.getSubcommand() === 'removecategory') {
                    let categories = await connection.promise().query('select * from tickets_categories where guildid = ?', [interaction.guild.id]);
                    if (categories[0].length > 1) {
                        let categoriesKeyValues = [];
                        for (const category of categories[0]) {
                            categoriesKeyValues.push({ label: `${category.name}`, value: category.id.toString() });
                        }
                        const categorySelectComponent = new StringSelectMenuBuilder().setOptions(categoriesKeyValues).setCustomId('CategorySelector').setMinValues(1).setMaxValues(1);
                        const categorySelectRow = new ActionRowBuilder().addComponents(categorySelectComponent);
                        let message = await interaction.reply({ content: 'Select a category to delete.', components: [categorySelectRow], ephemeral: true });
                        const collector = message.createMessageComponentCollector();
                        let categorySelected;
                        collector.on('collect', async (interaction_second) => {
                            categorySelected = interaction_second.values[0];
                            await connection.promise().query('delete from tickets_categories where id = ? and guildid = ?', [categorySelected, interaction.guild.id]);
                            let channel = await connection.promise().query('select * from game_settings where setting_name = "ticket_channel" and guild_id = ?', [interaction.guild.id]);
                            if (channel[0].length > 0) {
                                ticketMessage = await connection.promise().query('select * from game_settings where setting_name = "ticket_message" and guild_id = ?', [interaction.guild.id]);
                                categories = await connection.promise().query('select * from tickets_categories where guildid = ?', [interaction.guild.id]);
                                channel = await client.channels.cache.get(channel[0][0].setting_value);
                                let categoriesKeyValues = [];
                                const embeddedMessage = new EmbedBuilder()
                                    .setColor(0x770000)
                                    .setTitle('Ticket System')
                                    .setDescription('Please select a ticket type from the dropdown menu to begin opening a support ticket.');
                                for (const category of categories[0]) {
                                    categoriesKeyValues.push({ label: `${category.name}`, value: category.id.toString() });
                                }
                                const categorySelectComponent = new StringSelectMenuBuilder().setOptions(categoriesKeyValues).setCustomId('TicketCategorySelector').setMinValues(1).setMaxValues(1);
                                const categorySelectRow = new ActionRowBuilder().addComponents(categorySelectComponent);
                                await channel.messages.fetch(ticketMessage[0][0].setting_value).then(msg => msg.edit({ embeds: [embeddedMessage], components: [categorySelectRow] }));
                                await interaction.update('Removed ticket category');
                                await collector.stop();
                            } else {
                                interaction.reply({content: 'No channel found in game settings. You should never see this message.'});
                                collector.stop();
                            }
                        });
                    } else {
                        interaction.reply({ content: 'No created categories, or you have only one category, you can\'t delete your only category.', ephemeral: true });
                    }
                }
            } else if (interaction.commandName === 'auditchannel') {
                await connection.promise().query('replace into game_settings (guild_id, setting_name, setting_value) values (?, ?, ?)', [interaction.guild.id, "audit_channel", interaction.options.getChannel('channel').id]);
                interaction.reply({ content: 'Audit channel created or updated.', ephemeral: true });
            }
        }
    }



    if (interaction.isButton()) {
        if (interaction.customId === 'rpsButtonR' || interaction.customId === 'rpsButtonP' || interaction.customId === 'rpsButtonS') {
            let rpsthrow = interaction.customId.slice(-1);
            let throwfull = '';
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
            let queryData = [interaction.user.id, interaction.user.id];
            let rps = await connection.promise().query('select * from rps where (challenger = ? or challenged = ?) and (challenger_throw IS NULL OR challenged_throw IS NULL)', queryData);
            if (rps[0].length > 0 && (rpsthrow == "R" || rpsthrow == "P" || rpsthrow == "S")) {
                let valid = 1;
                let queryData;
                if (rps[0][0].challenged == interaction.user.id && !rps[0][0].challenged_throw) {
                    queryData = ['challenged_throw', rpsthrow, rps[0][0].id];
                } else if (rps[0][0].challenger == interaction.user.id && !rps[0][0].challenger_throw) {
                    queryData = ['challenger_throw', rpsthrow, rps[0][0].id];
                } else {
                    if (interaction.replied) {
                        await interaction.followUp({ content: 'You\'ve already thrown, sorry!`.', ephemeral: true });
                    } else {
                        await interaction.reply({ content: 'You\'ve already thrown, sorry!`.', ephemeral: true });
                    }
                    valid = 0;
                }
                if (valid) {
                    await connection.promise().query('update rps set ?? = ? where id = ?', queryData);
                    rps = await connection.promise().query(' select * from rps where id = ?', [rps[0][0].id]);

                    if (rps[0][0].challenged_throw && rps[0][0].challenger_throw) {
                        if (interaction.replied) {
                            await interaction.followUp({ content: 'You threw ' + throwfull + '.', ephemeral: true });
                        } else {
                            await interaction.reply({ content: 'You threw ' + throwfull + '.', ephemeral: true });
                        }
                        if ((rps[0][0].challenged_throw == 'R' && rps[0][0].challenger_throw == 'P') || (rps[0][0].challenged_throw == 'P' && rps[0][0].challenger_throw == 'S') || (rps[0][0].challenged_throw == 'S' && rps[0][0].challenger_throw == 'R')) {
                            await interaction.followUp('<@' + rps[0][0].challenger + '> has won the RPS match! (' + rps[0][0].challenger_throw + ' > ' + rps[0][0].challenged_throw + ')');
                        } else if ((rps[0][0].challenger_throw == 'R' && rps[0][0].challenged_throw == 'P') || (rps[0][0].challenger_throw == 'P' && rps[0][0].challenged_throw == 'S') || (rps[0][0].challenger_throw == 'S' && rps[0][0].challenged_throw == 'R')) {
                            await interaction.followUp('<@' + rps[0][0].challenged + '> has won the RPS match! (' + rps[0][0].challenged_throw + ' > ' + rps[0][0].challenger_throw + ')');
                        } else {
                            await interaction.followUp('The RPS round between <@' + rps[0][0].challenger + '> and <@' + rps[0][0].challenged + '> has ended in a draw. (' + rps[0][0].challenged_throw + ' = ' + rps[0][0].challenger_throw + ')');
                        }
                        await interaction.message.edit({ content: '<@' + rps[0][0].challenger + '> has challenged <@' + rps[0][0].challenged + '> to a duel!', components: [] });
                    } else if (rps[0][0].challenged == client.user.id) {
                        await interaction.reply({ content: 'You threw ' + throwfull + '.', ephemeral: true });
                        let options = ['R', 'P', 'S'];
                        let selection = options[Math.floor(Math.random() * options.length)];
                        let queryData = [selection, rps[0][0].id];
                        await connection.promise().query('update rps set challenged_throw = ? where id = ?;', queryData);
                        if ((selection == 'R' && rps[0][0].challenger_throw == 'P') || (selection == 'P' && rps[0][0].challenger_throw == 'S') || (selection == 'S' && rps[0][0].challenger_throw == 'R')) {
                            await interaction.followUp('<@' + rps[0][0].challenger + '> has won the RPS match! (' + rps[0][0].challenger_throw + ' > ' + selection + ')');
                        } else if ((rps[0][0].challenger_throw == 'R' && selection == 'P') || (rps[0][0].challenger_throw == 'P' && selection == 'S') || (rps[0][0].challenger_throw == 'S' && selection == 'R')) {
                            await interaction.followUp('<@' + rps[0][0].challenged + '> has won the RPS match! (' + selection + ' > ' + rps[0][0].challenger_throw + ')');
                        } else {
                            await interaction.followUp('The RPS round between <@' + rps[0][0].challenger + '> and <@' + rps[0][0].challenged + '> has ended in a draw. (' + rps[0][0].challenger_throw + ' = ' + rps[0][0].challenger_throw + ')');
                        }
                        await interaction.message.edit({ content: '<@' + rps[0][0].challenger + '> has challenged <@' + rps[0][0].challenged + '> to a duel!', components: [] });
                    } else {
                        if (interaction.replied) {
                            await interaction.followUp({ content: 'You threw ' + throwfull + '.', ephemeral: true });
                        } else {
                            await interaction.reply({ content: 'You threw ' + throwfull + '.', ephemeral: true });
                        }
                    }
                }
            }
        } else if (interaction.customId.startsWith('duelButton')) {
            console.log(interaction.customId);
            let duel_id = interaction.customId.match(/\d/g).join("");
            let duelResults = await connection.promise().query('select * from duels where id = ?', [duel_id]);
            let duelInfo = duelResults[0][0];
            let characterResults = await connection.promise().query('select c.* from characters c join players_characters pc on c.id = pc.character_id join players p on p.id = pc.player_id where p.user_id = ? and pc.active = 1 and p.guild_id = ?', [interaction.user.id, interaction.guildId]);
            let activeCharacter = characterResults[0][0];
            if (activeCharacter.id == duelInfo.player_id || activeCharacter.id == duelInfo.target_id) {
                if (interaction.customId.startsWith('duelButtonSkill')) {
                    let rounds = await connection.promise().query('select * from duels_rounds where duel_id = ? order by round_id asc', [duel_id]);
                    if (rounds[0].length > 1 || (rounds[0].length == 1 && rounds[0][0].player_throw && rounds[0][0].target_throw)) {
                        // If previous round's winner == activeCharacter AND skill is not yet set for this round
                        let lastRound = rounds[0].at(-1);
                        let roundCurrentlyActive = false;
                        if (!(lastRound.player_throw && lastRound.target_throw) && rounds[0].at(-2)) {
                            lastRound = rounds[0].at(-2);
                            roundCurrentlyActive = true;
                        }
                        if (lastRound.winner_id == activeCharacter.id && !lastRound.skill_id) {
                            let usedSkills = [];
                            let previousRoundWinner = false;
                            for (const round of rounds[0]) {
                                if (round.skill_used && round.winner_id == activeCharacter.id) {
                                    usedSkills.push(round.skill_used);
                                }
                                previousRoundWinner = round.winner_id;
                            }
                            let availableSkills;
                            if (usedSkills.length > 0) {
                                availableSkills = await connection.promise().query('select distinct s.* from skills s left outer join skills_archetypes sa on sa.skill_id = s.id left outer join characters_archetypes ca on ca.archetype_id = sa.archetype_id left outer join skills_characters sc on sc.skill_id = s.id where (sc.character_id = ? or ca.character_id = ?) and s.id not in (?) and s.type = "combat" and s.guild_id = ?', [activeCharacter.id, activeCharacter.id, usedInnates, interaction.guildId]);
                            } else {
                                availableSkills = await connection.promise().query('select distinct s.* from skills s left outer join skills_archetypes sa on sa.skill_id = s.id left outer join characters_archetypes ca on ca.archetype_id = sa.archetype_id left outer join skills_characters sc on sc.skill_id = s.id where (sc.character_id = ? or ca.character_id = ?) and s.type = "combat" and s.guild_id = ?', [activeCharacter.id, activeCharacter.id, interaction.guildId]);
                            }
                            if (availableSkills[0].length > 0) {
                                let skillsKeyValues = [];
                                for (const skill of availableSkills[0]) {
                                    skillsKeyValues.push({ label: skill.name, value: skill.id.toString() });
                                }
                                const skillSelectComponent = new StringSelectMenuBuilder().setOptions(skillsKeyValues).setCustomId('SkillSelector' + interaction.member.id).setMinValues(1).setMaxValues(1);
                                const skillSelectRow = new ActionRowBuilder().addComponents(skillSelectComponent);
                                let message = await interaction.reply({ content: 'Select a skill to share with the channel:', components: [skillSelectRow], ephemeral: true });
                                let collector = message.createMessageComponentCollector();
                                collector.on('collect', async (interaction_second) => {
                                    if (interaction.member.id === interaction_second.member.id) {
                                        let skill_id = interaction_second.values[0];
                                        let skill = await connection.promise().query('select * from skills where id = ?', [skill_id]);
                                        let lastRound = await connection.promise().query('select * from duels_rounds where duel_id = ? order by round_id desc limit 1', [duel_id]);
                                        if (lastRound[0][0].winner_id) {
                                            await connection.promise().query('update duels_rounds set skill_used = ? where id = ?', [skill_id, lastRound[0][0].id]);
                                        } else {
                                            await connection.promise().query('update duels_rounds set skill_used = ? where duel_id = ? and round_id = ?', [skill_id, duel_id, lastRound[0][0].round_id - 1]);
                                        }
                                        await interaction_second.channel.send({ content: `${activeCharacter.name} uses ${skill[0][0].name}: ${skill[0][0].description}` });
                                        await interaction.update({ content: 'Thanks!', components: [] });
                                        await collector.stop();
                                    } else {
                                        interaction.reply({content: 'You aren\'t eligible to click this button.', ephemeral: true});
                                    }
                                });
                                // - Give a SpAtk dropdown.
                                // - create a collector
                            } else {
                                await interaction.reply({ content: "You don't seem to have any skills to use.", ephemeral: true });
                            }
                        } else {
                            await interaction.reply({ content: 'You didn\'t win the last round, so you can\'t use a combat skill.', ephemeral: true });
                        }

                    } else {
                        // get character skills where skill is innate and not already used in this duel (in duels_innates)
                        let results = await connection.promise().query('select * from duels_innates where duel_id = ? and character_id = ?', [duel_id, activeCharacter.id]);
                        let innates = results[0];
                        let usedInnates = [];
                        let availableInnates;
                        if (innates.length > 0) {
                            for (const innate of innates) {
                                usedInnates.push(innate.skill_id);
                            }
                            availableInnates = await connection.promise().query('select distinct s.* from skills s left outer join skills_archetypes sa on sa.skill_id = s.id left outer join characters_archetypes ca on ca.archetype_id = sa.archetype_id left outer join skills_characters sc on sc.skill_id = s.id where (sc.character_id = ? or ca.character_id = ?) and s.id not in (?) and s.type = "innate" and s.guild_id = ?', [activeCharacter.id, activeCharacter.id, usedInnates, interaction.guildId]);
                        } else {
                            availableInnates = await connection.promise().query('select distinct s.* from skills s left outer join skills_archetypes sa on sa.skill_id = s.id left outer join characters_archetypes ca on ca.archetype_id = sa.archetype_id left outer join skills_characters sc on sc.skill_id = s.id where (sc.character_id = ? or ca.character_id = ?) and s.type = "innate" and s.guild_id = ?', [activeCharacter.id, activeCharacter.id, interaction.guildId]);
                        }
                        if (availableInnates[0].length > 0) {
                            let innatesKeyValues = [];
                            for (const innate of availableInnates[0]) {
                                innatesKeyValues.push({ label: innate.name, value: innate.id.toString() });
                            }
                            const innateSelectComponent = new StringSelectMenuBuilder().setOptions(innatesKeyValues).setCustomId('DuelInnateSelector').setMinValues(1).setMaxValues(1);
                            const innateSelectRow = new ActionRowBuilder().addComponents(innateSelectComponent);

                            let message = await interaction.reply({ content: 'Select an innate:', components: [innateSelectRow], ephemeral: true });
                            let collector = message.createMessageComponentCollector();
                            let innateSelected;
                            collector.on('collect', async (interaction_second) => {
                                if (interaction.member.id === interaction_second.member.id) {
                                    if (interaction_second.customId === 'DuelInnateSelector') {
                                        innateSelected = interaction_second.values[0];
                                        await connection.promise().query('insert into duels_innates (duel_id, character_id, skill_id) values (?, ?, ?)', [duel_id, activeCharacter.id, innateSelected]);
                                        interaction_second.update({ content: "Innate selected.", components: [] });
                                        // BEGIN DUEL REDRAW BLOCK
                                        let healthStat = await connection.promise().query('select * from stats join stats_specialstats sps on stats.id = sps.stat_id where stats.guild_id = ? and sps.special_type = "health"', [interaction.guildId]);
                                        let player = await connection.promise().query('select c.* from characters c where id = ?', [duelInfo.player_id]);
                                        let target = await connection.promise().query('select c.* from characters c where id = ?', [duelInfo.target_id]);
                                        let isCustomPlayerHealth = await connection.promise().query('select override_value from characters_stats where character_id = ? and stat_id = ?', [player[0][0].id, healthStat[0][0].id]);
                                        let isCustomTargetHealth = await connection.promise().query('select override_value from characters_stats where character_id = ? and stat_id = ?', [target[0][0].id, healthStat[0][0].id]);
                                        let results = await connection.promise().query('select * from duels_rounds where duel_id = ? order by round_id desc limit 1', [duel_id]);
                                        let displayRound;
                                        if (results[0].length > 0) {
                                            let currentRound = results[0][0];
                                            if (currentRound.winner_id) {
                                                displayRound = currentRound.round_id + 1;
                                            } else {
                                                displayRound = currentRound.round_id;
                                            }
                                        } else {
                                            displayRound = 1;
                                        }
                                        //HEALTH CALCS
                                        let computedPlayerHealth;
                                        let computedTargetHealth;
                                        if (isCustomPlayerHealth[0].length > 0) {
                                            computedPlayerHealth = isCustomPlayerHealth[0][0].override_value;
                                        } else {
                                            computedPlayerHealth = healthStat[0][0].default_value;
                                        }
                                        if (isCustomTargetHealth[0].length > 0) {
                                            computedTargetHealth = isCustomTargetHealth[0][0].override_value;
                                        } else {
                                            computedTargetHealth = healthStat[0][0].default_value;
                                        }
                                        let innates = await connection.promise().query('select di.*, sce.strength, sce.effect from duels_innates di join skills_combateffects sce on di.skill_id = sce.skill_id where duel_id = ?', duel_id);
                                        if (innates[0].length > 0) {
                                            for (const innate of innates[0]) {
                                                if (innate.effect = 'add_health') {
                                                    if (innate.character_id == duelInfo.player_id) {
                                                        computedPlayerHealth += innate.strength;
                                                    } else {
                                                        computedTargetHealth += innate.strength;
                                                    }
                                                }
                                            }
                                        }
                                        if (rounds[0].length > 0) {
                                            let prevRdWinner = false;
                                            let prevRdSpecial = false;
                                            for (const round of rounds[0]) {
                                                // Per-round health calcluation based on 
                                                //  - Round winner
                                                if (round.winner_id == duelInfo.player_id) {
                                                    computedTargetHealth -= 2;
                                                } else if (round.winner_id == duelInfo.target_id) {
                                                    computedPlayerHealth -= 2;
                                                } else if (round.winner_id == -1) {
                                                    computedPlayerHealth -= 1;
                                                    computedTargetHealth -= 1;
                                                }
                                                //  - Special attack used previous round
                                                if (prevRdWinner != -1 && prevRdSpecial) {
                                                    if (prevRdWinner == duelInfo.player_id) {
                                                        computedTargetHealth -= 1;
                                                    } else {
                                                        computedPlayerHealth -= 1;
                                                    }
                                                    // BUG: Calc is one round behind for special attacks. Is this because I'm assuming the special is in the PREVIOUS round here when I am puttin git in the SAME round above? yes
                                                    //  - Prereqs/effects of previous round attack (eventually: prereqs/effects of all attacks with duration (or "until the end of combat"))

                                                }

                                                //  - Innate effects, if there are combats

                                                // ...and stores whether there was a special this round in prevRdSpecial, or false.
                                                if (round.skill_used) {
                                                    prevRdSpecial = round.skill_used;
                                                } else {
                                                    prevRdSpecial = false;
                                                }
                                                prevRdWinner = round.winner_id;
                                            }
                                        }
                                        if (computedTargetHealth < 0) {
                                            computedTargetHealth = 0;
                                        }
                                        if (computedPlayerHealth < 0) {
                                            computedPlayerHealth = 0;
                                        }
                                        let embed = new EmbedBuilder()
                                            .setTitle(`DUEL: ${player[0][0].name} v. ${target[0][0].name}`)
                                            .setDescription(`Round ${displayRound}`)
                                            .addFields(
                                                { name: player[0][0].name, value: `${healthStat[0][0].name}: ${computedPlayerHealth}`, inline: true }, // active skills, innates, etc
                                                { name: target[0][0].name, value: `${healthStat[0][0].name}: ${computedTargetHealth}`, inline: true } // active skills, innates, etc
                                            );
                                        let duelButtonR = new ButtonBuilder().setCustomId('duelButtonR' + duel_id).setLabel('Rapid').setStyle('Primary'); // TODO ButtonBuilder doesn't exist in Discord.js v14
                                        let duelButtonP = new ButtonBuilder().setCustomId('duelButtonP' + duel_id).setLabel('Precision').setStyle('Primary');
                                        let duelButtonS = new ButtonBuilder().setCustomId('duelButtonS' + duel_id).setLabel('Sweeping').setStyle('Primary');
                                        let duelButtonSkill;
                                        if (displayRound > 1) {
                                            duelButtonSkill = new ButtonBuilder().setCustomId('duelButtonSkill' + duel_id).setLabel('Use Special').setStyle('Primary');
                                        } else {
                                            duelButtonSkill = new ButtonBuilder().setCustomId('duelButtonSkill' + duel_id).setLabel('Declare Innates').setStyle('Primary');
                                        }
                                        const rpsRow = new ActionRowBuilder().addComponents(duelButtonR, duelButtonP, duelButtonS, duelButtonSkill);
                                        if (computedPlayerHealth > 0 && computedTargetHealth > 0) {
                                            await interaction.message.edit({ embeds: [embed], components: [rpsRow] });
                                        } else {
                                            await connection.promise().query('update duels set complete = 1 where id = ?', [duel_id]);
                                            await interaction.message.edit({ embeds: [embed], components: [] });
                                        }
                                        // END DUEL REDRAW BLOCK
                                        let skill = await connection.promise().query('select * from skills where id = ?', [innateSelected]);
                                        await interaction.channel.send(`${activeCharacter.name} uses ${skill[0][0].name}: ${skill[0][0].description}`);
                                        await collector.stop();
                                    } else {
                                        await interaction.deferUpdate();
                                    }
                                }
                            });
                        } else {
                            await interaction.reply({ content: 'You have no other available innates, sorry.', ephemeral: true });
                        }
                    }
                } else {
                    // Get the R/P/S...
                    let rpsThrow = interaction.customId.match(/[a-zA-Z]+/g).join("").slice(-1);
                    // activeCharacter is still set
                    // duelInfo is set
                    let currentRound = await connection.promise().query('select * from duels_rounds where duel_id = ? order by round_id desc limit 1', [duel_id]);
                    if (currentRound[0].length > 0 && !(currentRound[0][0].player_throw && currentRound[0][0].target_throw)) {
                        if (activeCharacter.id == duelInfo.player_id) {
                            await connection.promise().query('update duels_rounds set player_throw = ? where id = ?', [rpsThrow, currentRound[0][0].id]);
                        } else {
                            await connection.promise().query('update duels_rounds set target_throw = ? where id = ?', [rpsThrow, currentRound[0][0].id]);
                        }
                    } else {
                        if (activeCharacter.id == duelInfo.player_id) {
                            if (currentRound[0].length > 0) {
                                await connection.promise().query('insert into duels_rounds (duel_id, round_id, player_throw) values (?, ?, ?)', [duelInfo.id, currentRound[0][0].round_id + 1, rpsThrow]);
                            } else {
                                await connection.promise().query('insert into duels_rounds (duel_id, round_id, player_throw) values (?, ?, ?)', [duelInfo.id, 1, rpsThrow]);
                            }
                        } else {
                            if (currentRound[0].length > 0) {
                                await connection.promise().query('insert into duels_rounds (duel_id, round_id, target_throw) values (?, ?, ?)', [duelInfo.id, currentRound[0][0].round_id + 1, rpsThrow]);
                            } else {
                                await connection.promise().query('insert into duels_rounds (duel_id, round_id, target_throw) values (?, ?, ?)', [duelInfo.id, 1, rpsThrow]);
                            }
                        }
                    }
                    currentRound = await connection.promise().query('select * from duels_rounds where duel_id = ? order by round_id desc limit 1', [duel_id]);
                    if (currentRound[0][0].player_throw && currentRound[0][0].target_throw) {
                        let player = await connection.promise().query('select c.* from characters c where id = ?', [duelInfo.player_id]);
                        let target = await connection.promise().query('select c.* from characters c where id = ?', [duelInfo.target_id]);
                        if ((currentRound[0][0].player_throw == 'R' && currentRound[0][0].target_throw == 'S') || (currentRound[0][0].player_throw == 'P' && currentRound[0][0].target_throw == 'R') || (currentRound[0][0].player_throw == 'S' && currentRound[0][0].target_throw == 'P')) {
                            await connection.promise().query('update duels_rounds set winner_id = ? where id = ?', [duelInfo.player_id, currentRound[0][0].id]);
                            interaction.channel.send(`${player[0][0].name} defeats ${target[0][0].name} (${currentRound[0][0].player_throw} > ${currentRound[0][0].target_throw})`);
                        } else if ((currentRound[0][0].target_throw == 'R' && currentRound[0][0].player_throw == 'S') || (currentRound[0][0].target_throw == 'P' && currentRound[0][0].player_throw == 'R') || (currentRound[0][0].target_throw == 'S' && currentRound[0][0].player_throw == 'P')) {
                            await connection.promise().query('update duels_rounds set winner_id = ? where id = ?', [duelInfo.target_id, currentRound[0][0].id]);
                            interaction.channel.send(`${target[0][0].name} defeats ${player[0][0].name} (${currentRound[0][0].target_throw} > ${currentRound[0][0].player_throw})`);
                        } else {
                            await connection.promise().query('update duels_rounds set winner_id = -1 where id = ?', [currentRound[0][0].id]);
                            interaction.channel.send(`${target[0][0].name} and ${player[0][0].name} tie! (${currentRound[0][0].target_throw} = ${currentRound[0][0].player_throw})`)
                        }
                        rounds = await connection.promise().query('select * from duels_rounds where duel_id = ? order by round_id asc', [duel_id]);

                        // BEGIN DUEL REDRAW BLOCK
                        let healthStat = await connection.promise().query('select * from stats join stats_specialstats sps on stats.id = sps.stat_id where stats.guild_id = ? and sps.special_type = "health"', [interaction.guildId]);
                        let isCustomPlayerHealth = await connection.promise().query('select override_value from characters_stats where character_id = ? and stat_id = ?', [player[0][0].id, healthStat[0][0].id]);
                        let isCustomTargetHealth = await connection.promise().query('select override_value from characters_stats where character_id = ? and stat_id = ?', [target[0][0].id, healthStat[0][0].id]);
                        let results = await connection.promise().query('select * from duels_rounds where duel_id = ? order by round_id desc limit 1', [duel_id]);
                        let displayRound;
                        if (results[0].length > 0) {
                            let currentRound = results[0][0];
                            if (currentRound.winner_id) {
                                displayRound = currentRound.round_id + 1;
                            } else {
                                displayRound = currentRound.round_id;
                            }
                        } else {
                            displayRound = 1;
                        }
                        //HEALTH CALCS
                        let computedPlayerHealth;
                        let computedTargetHealth;
                        if (isCustomPlayerHealth[0].length > 0) {
                            computedPlayerHealth = isCustomPlayerHealth[0][0].override_value;
                        } else {
                            computedPlayerHealth = healthStat[0][0].default_value;
                        }
                        if (isCustomTargetHealth[0].length > 0) {
                            computedTargetHealth = isCustomTargetHealth[0][0].override_value;
                        } else {
                            computedTargetHealth = healthStat[0][0].default_value;
                        }
                        let innates = await connection.promise().query('select di.*, sce.strength, sce.effect from duels_innates di join skills_combateffects sce on di.skill_id = sce.skill_id where duel_id = ?', duel_id);
                        if (innates[0].length > 0) {
                            for (const innate of innates[0]) {
                                if (innate.effect = 'add_health') {
                                    if (innate.character_id == duelInfo.player_id) {
                                        computedPlayerHealth += innate.strength;
                                    } else {
                                        computedTargetHealth += innate.strength;
                                    }
                                }
                            }
                        }
                        if (rounds[0].length > 0) {
                            let prevRdWinner = false;
                            let prevRdSpecial = false;
                            for (const round of rounds[0]) {
                                // Per-round health calcluation based on 
                                //  - Round winner
                                if (round.winner_id == duelInfo.player_id) {
                                    computedTargetHealth -= 2;
                                } else if (round.winner_id == duelInfo.target_id) {
                                    computedPlayerHealth -= 2;
                                } else if (round.winner_id == -1) {
                                    computedPlayerHealth -= 1;
                                    computedTargetHealth -= 1;
                                }
                                //  - Special attack used previous round
                                if (prevRdWinner != -1 && prevRdSpecial) {
                                    if (prevRdWinner == duelInfo.player_id) {
                                        computedTargetHealth -= 1;
                                    } else {
                                        computedPlayerHealth -= 1;
                                    }
                                    //  - Prereqs/effects of previous round attack (eventually: prereqs/effects of all attacks with duration (or "until the end of combat"))

                                }

                                //  - Innate effects, if there are combats

                                // ...and stores whether there was a special this round in prevRdSpecial, or false.
                                if (round.skill_used) {
                                    prevRdSpecial = round.skill_used;
                                } else {
                                    prevRdSpecial = false;
                                }
                                prevRdWinner = round.winner_id;
                            }
                        }
                        if (computedTargetHealth < 0) {
                            computedTargetHealth = 0;
                        }
                        if (computedPlayerHealth < 0) {
                            computedPlayerHealth = 0;
                        }
                        let embed = new EmbedBuilder()
                            .setTitle(`DUEL: ${player[0][0].name} v. ${target[0][0].name}`)
                            .setDescription(`Round ${displayRound}`)
                            .addFields(
                                { name: player[0][0].name, value: `${healthStat[0][0].name}: ${computedPlayerHealth}`, inline: true }, // active skills, innates, etc
                                { name: target[0][0].name, value: `${healthStat[0][0].name}: ${computedTargetHealth}`, inline: true } // active skills, innates, etc
                            );
                        let duelButtonR = new ButtonBuilder().setCustomId('duelButtonR' + duel_id).setLabel('Rapid').setStyle('Primary'); // TODO ButtonBuilder doesn't exist in Discord.js v14
                        let duelButtonP = new ButtonBuilder().setCustomId('duelButtonP' + duel_id).setLabel('Precision').setStyle('Primary');
                        let duelButtonS = new ButtonBuilder().setCustomId('duelButtonS' + duel_id).setLabel('Sweeping').setStyle('Primary');
                        let duelButtonSkill;
                        if (displayRound > 1) {
                            duelButtonSkill = new ButtonBuilder().setCustomId('duelButtonSkill' + duel_id).setLabel('Use Special').setStyle('Primary');
                        } else {
                            duelButtonSkill = new ButtonBuilder().setCustomId('duelButtonSkill' + duel_id).setLabel('Declare Innates').setStyle('Primary');
                        }
                        const rpsRow = new ActionRowBuilder().addComponents(duelButtonR, duelButtonP, duelButtonS, duelButtonSkill);
                        if (computedPlayerHealth > 0 && computedTargetHealth > 0) {
                            await interaction.message.edit({ embeds: [embed], components: [rpsRow] });
                        } else {
                            await connection.promise().query('update duels set complete = 1 where id = ?', [duel_id]);
                            await interaction.message.edit({ embeds: [embed], components: [] });
                            if (computedTargetHealth == 0 && computedPlayerHealth > 0) {
                                await interaction.channel.send(`${player[0][0].name} has defeated ${target[0][0].name}!`);
                            } else if (computedPlayerHealth == 0 && computedTargetHealth > 0) {
                                await interaction.channel.send(`${target[0][0].name} has defeated ${player[0][0].name}!`);
                            } else {
                                await interaction.channel.send(`${target[0][0].name} and ${player[0][0].name} have *tied!*`);
                            }
                        }
                        // END DUEL REDRAW BLOCK
                        interaction.deferUpdate();
                    } else {
                        interaction.deferUpdate();
                    }

                }
            } else {
                await interaction.reply({ content: "You're not a participant in this duel!", ephemeral: true });
            }
        } else if (interaction.customId.startsWith('sheet-')) {
            let character_id = interaction.customId.split('-')[1];
            let character_information = await connection.promise().query('select * from characters where id = ?', [character_id]);
            let character_archetypes = await connection.promise().query('select * from archetypes a join characters_archetypes ca on ca.archetype_id = a.id where ca.character_id = ?', [character_id]);
            let character_stats = await connection.promise().query('select s.*, cs.override_value from stats s left outer join characters_stats cs on cs.stat_id = s.id and cs.character_id = ? where guild_id = ? order by s.id asc', [character_id, interaction.guildId]);
            let archetype_stats = await connection.promise().query('select ars.*, ca2.override_value from archetypestats ars join archetypes_archetypestats aa on ars.id = aa.archetypestat_id join characters_archetypes ca on aa.archetype_id = ca.archetype_id and ca.character_id = ? left outer join characters_archetypestats ca2 on ca2.stat_id = ars.id and ca2.character_id = ? order by ars.id asc', [character_id, character_id]);
            let world_flags = await connection.promise().query('select * from worldflags where guild_id = ? and visible = 1', [interaction.guildId]);
            let msg = `**${character_information[0][0].name}** - ${character_information[0][0].description}\n`
            if (character_archetypes[0].length > 0) {
                msg = msg.concat(`\n__Archetypes__\n`);
                for (const thisArchetype of character_archetypes[0]) {
                    msg = msg.concat(`**${thisArchetype.name}** - ${thisArchetype.description}\n`);
                }
            }
            if (character_stats[0].length > 0 || archetype_stats[0].length > 0 || world_flags[0].length > 0) {
                msg = msg.concat(`\n__Stats__\n`);
            }
            if (character_stats[0].length > 0) {
                for (const thisStat of character_stats[0]) {
                    if (typeof thisStat.override_value !== 'undefined' && thisStat.override_value != null) {
                        msg = msg.concat(`**${thisStat.name}** - ${thisStat.override_value}\n`);
                    } else { // TODO else if thisStat has an ARCHETYPE override value
                        msg = msg.concat(`**${thisStat.name}** - ${thisStat.default_value}\n`);
                    }

                }
            }
            if (archetype_stats[0].length > 0) {
                for (const thisStat of archetype_stats[0]) {
                    if (typeof thisStat.override_value !== 'undefined' && thisStat.override_value != null) {
                        msg = msg.concat(`**${thisStat.name}** - ${thisStat.override_value}\n`);
                    } else { // TODO else if thisStat has an ARCHETYPE override value
                        msg = msg.concat(`**${thisStat.name}** - ${thisStat.default_value}\n`);
                    }
                }
            }
            if (world_flags[0].length > 0) {
                // TODO
                msg = msg.concat('\n--- *World Information* ---\n\n');
                for (const thisFlag of world_flags[0]) {
                    msg = msg.concat(`**${thisFlag.name}** - ${thisFlag.value}\n`);
                }
            }
            const buttonActionRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId(`skillpage-asc-${character_id}-1`).setLabel('Skills').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`inventory-asc-${character_id}-1`).setLabel('Inventory').setStyle(ButtonStyle.Primary)
                );

            let reputation_enabled = await connection.promise().query('select * from game_settings where setting_name = "reputation" and guild_id = ?', [interaction.guildId]);
            if (reputation_enabled[0].length > 0 && reputation_enabled[0][0].setting_value == true) {
                buttonActionRow.addComponents(new ButtonBuilder().setCustomId(`reputation-asc-${character_id}-1`).setLabel('Reputation').setStyle(ButtonStyle.Primary));
            }
            await interaction.update({ content: msg, components: [buttonActionRow] });
        } else if (interaction.customId.startsWith('skillpage-')) {
            let sort = interaction.customId.split('-')[1];
            let character_id = interaction.customId.split('-')[2];
            let skill_id = interaction.customId.split('-')[3];
            let skills = await connection.promise().query(`select distinct s.* from skills s left outer join skills_characters sc on s.id = sc.skill_id left outer join skills_archetypes sa on s.id = sa.skill_id left outer join characters_archetypes ca on sa.archetype_id = ca.archetype_id where sc.character_id = ? or ca.character_id = ? order by s.id ${sort}`, [character_id, character_id]);
            let msg = '';
            let firstDisplayedId = false;
            let lastDisplayedId = false;
            let maxId = false;
            let minId = false;
            let msgStart = `__Skills__\n`;
            if (skills[0].length > 0) {
                let process_test_msg = true;
                for (const thisSkill of skills[0]) {
                    maxId = (maxId ? Math.max(maxId, thisSkill.id) : thisSkill.id);
                    minId = (minId ? Math.min(minId, thisSkill.id) : thisSkill.id);
                    if (sort == 'asc' && thisSkill.id >= skill_id || sort == 'desc' && thisSkill.id <= skill_id) {
                        if (process_test_msg) {
                            let test_msg;
                            if (sort == 'desc') {
                                test_msg = (`**${thisSkill.name}**: ${thisSkill.description} (${thisSkill.type})\n`).concat(msg);
                            } else {
                                test_msg = msg.concat(`**${thisSkill.name}**: ${thisSkill.description} (${thisSkill.type})\n`)
                            }
                            if (test_msg.length > 1989) { // 2000 characters minus "__Skills__\n"
                                process_test_msg = false;
                            } else {
                                msg = test_msg;
                                firstDisplayedId = (firstDisplayedId ? Math.min(firstDisplayedId, thisSkill.id) : thisSkill.id);
                                lastDisplayedId = (lastDisplayedId ? Math.max(lastDisplayedId, thisSkill.id) : thisSkill.id);
                            }
                        }
                    }
                }
                msg = msgStart.concat(msg);
            } else {
                msg = `You don't have any skills! Hmm. Maybe check with an Orchestrator if you weren't expecting this.`;
            }
            let components = [];
            if (minId < firstDisplayedId || maxId > lastDisplayedId) {
                console.log('pagination');
                let paginationActionRow = new ActionRowBuilder();
                if (minId < firstDisplayedId) {
                    console.log('prev');
                    paginationActionRow.addComponents(new ButtonBuilder().setCustomId(`skillpage-desc-${character_id}-${firstDisplayedId - 1}`).setLabel('◀️').setStyle(ButtonStyle.Primary));
                }
                if (maxId > lastDisplayedId) {
                    console.log('next');
                    paginationActionRow.addComponents(new ButtonBuilder().setCustomId(`skillpage-asc-${character_id}-${lastDisplayedId + 1}`).setLabel('▶️').setStyle(ButtonStyle.Primary));
                }
                components.push(paginationActionRow);
            }
            const buttonActionRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId(`sheet-${character_id}`).setLabel('Sheet').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`inventory-asc-${character_id}-1`).setLabel('Inventory').setStyle(ButtonStyle.Primary)
                );
            let reputation_enabled = await connection.promise().query('select * from game_settings where setting_name = "reputation" and guild_id = ?', [interaction.guildId]);
            if (reputation_enabled[0].length > 0 && reputation_enabled[0][0].setting_value == true) {
                buttonActionRow.addComponents(new ButtonBuilder().setCustomId(`reputation-asc-${character_id}-1`).setLabel('Reputation').setStyle(ButtonStyle.Primary));
            }
            components.push(buttonActionRow);
            await interaction.update({ content: msg, components: components });
        } else if (interaction.customId.startsWith('inventory-')) {
            let sort = interaction.customId.split('-')[1];
            let character_id = interaction.customId.split('-')[2];
            let item_id = interaction.customId.split('-')[3];
            let items = await connection.promise().query(`select i.*, ci.quantity from items i join characters_items ci on i.id = ci.item_id where ci.character_id = ? and ci.quantity > 0 order by i.id ${sort}`, [character_id, character_id]);
            let msg = '';
            let firstDisplayedId = false;
            let lastDisplayedId = false;
            let maxId = false;
            let minId = false;
            let msgStart = `__Items__\n`;
            if (items[0].length > 0) {
                let process_test_msg = true; //`**${thisItem.name}**: ${thisItem.description} *(x${thisItem.quantity})*\n`
                for (const thisItem of items[0]) {
                    maxId = (maxId ? Math.max(maxId, thisItem.id) : thisItem.id);
                    minId = (minId ? Math.min(minId, thisItem.id) : thisItem.id);
                    if (sort == 'asc' && thisItem.id >= item_id || sort == 'desc' && thisItem.id <= item_id) {
                        if (process_test_msg) {
                            let test_msg;
                            if (sort == 'desc') {
                                test_msg = (`**${thisItem.name}**: ${thisItem.description} *(x${thisItem.quantity})*\n`).concat(msg);
                            } else {
                                test_msg = msg.concat(`**${thisItem.name}**: ${thisItem.description} *(x${thisItem.quantity})*\n`)
                            }
                            if (test_msg.length > 1990) { // 2000 characters minus "__Items__\n"
                                process_test_msg = false;
                            } else {
                                msg = test_msg;
                                firstDisplayedId = (firstDisplayedId ? Math.min(firstDisplayedId, thisItem.id) : thisItem.id);
                                lastDisplayedId = (lastDisplayedId ? Math.max(lastDisplayedId, thisItem.id) : thisItem.id);
                            }
                        }
                    }
                }
                msg = msgStart.concat(msg);
            } else {
                msg = `Your inventory is empty. If you believe you have received this message in error, please contact an Orchestrator.`;
            }
            let components = [];
            if (minId < firstDisplayedId || maxId > lastDisplayedId) {
                let paginationActionRow = new ActionRowBuilder();
                if (minId < firstDisplayedId) {
                    paginationActionRow.addComponents(new ButtonBuilder().setCustomId(`inventory-desc-${character_id}-${firstDisplayedId - 1}`).setLabel('◀️').setStyle(ButtonStyle.Primary));
                }
                if (maxId > lastDisplayedId) {
                    paginationActionRow.addComponents(new ButtonBuilder().setCustomId(`inventory-asc-${character_id}-${lastDisplayedId + 1}`).setLabel('▶️').setStyle(ButtonStyle.Primary));
                }
                components.push(paginationActionRow);
            }
            const buttonActionRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId(`sheet-${character_id}`).setLabel('Sheet').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`skillpage-asc-${character_id}-1`).setLabel('Skills').setStyle(ButtonStyle.Primary)
                );
            let reputation_enabled = await connection.promise().query('select * from game_settings where setting_name = "reputation" and guild_id = ?', [interaction.guildId]);
            if (reputation_enabled[0].length > 0 && reputation_enabled[0][0].setting_value == true) {
                buttonActionRow.addComponents(new ButtonBuilder().setCustomId(`reputation-asc-${character_id}-1`).setLabel('Reputation').setStyle(ButtonStyle.Primary));
            }
            components.push(buttonActionRow);
            await interaction.update({ content: msg, components: components });
        } else if (interaction.customId.startsWith('reputation-')) {
            let sort = interaction.customId.split('-')[1];
            let character_id = interaction.customId.split('-')[2];
            let reputation_id = interaction.customId.split('-')[3];
            let character_reputations = await connection.promise().query(`select r.*, cr.value as characterStanding from reputations r left outer join characters_reputations cr on r.id = cr.reputation_id left outer join characters_characterflags cc on (r.visibility = "cflag" and r.cwflag_id = cc.characterflag_id and cc.character_id = ?) left outer join worldflags w on (r.visibility = "wflag" and r.cwflag_id = w.id) where (r.visibility = "always" and r.guild_id = ? or (r.visibility = "cflag" and cc.value is not null and cc.value >= r.cwflag_value and cr.character_id = ?) or (r.visibility = "wflag" and w.value is not null and w.value >= r.cwflag_value and cr.character_id = ?)) order by r.id ${sort}`, [character_id, interaction.guildId, character_id, character_id]); // Filter this by cflag visibility
            let msg = '';
            let firstDisplayedId = false;
            let lastDisplayedId = false;
            let maxId = false;
            let minId = false;
            let msgStart = `__Reputations__\n`;
            if (character_reputations[0].length > 0) {
                let process_test_msg = true;
                for (const thisReputation of character_reputations[0]) {
                    maxId = (maxId ? Math.max(maxId, thisReputation.id) : thisReputation.id);
                    minId = (minId ? Math.min(minId, thisReputation.id) : thisReputation.id);
                    if (sort == 'asc' && thisReputation.id >= reputation_id || sort == 'desc' && thisReputation.id <= reputation_id) {
                        if (process_test_msg) {
                            let standing;
                            if (thisReputation.characterStanding) {
                                standing = await connection.promise().query('select * from reputations_tiers rt where reputation_id = ? and value <= ? order by value desc limit 1', [thisReputation.id, thisReputation.characterStanding]);
                            } else {
                                standing = [];
                                standing[0] = [];
                                standing[0][0] = { threshold_name: '*Not yet encountered!*' };
                            }
                            //let next_standing = await connection.promise().query('select * from reputations_tiers rt where value > ? order by value asc limit 1', [thisReputation.characterStanding]);
                            //eventually use these three numbers to do "0/12000" or whatever
                            let test_msg;
                            if (sort == 'desc') {
                                test_msg = (`**${thisReputation.name}** (${thisReputation.description}) (${standing[0][0].threshold_name})\n`).concat(msg);
                            } else {
                                test_msg = msg.concat(`**${thisReputation.name}** (${thisReputation.description}) (${standing[0][0].threshold_name})\n`)
                            }
                            if (test_msg.length > 1990) { // 2000 characters minus "__Items__\n"
                                process_test_msg = false;
                            } else {
                                msg = test_msg;
                                firstDisplayedId = (firstDisplayedId ? Math.min(firstDisplayedId, thisReputation.id) : thisReputation.id);
                                lastDisplayedId = (lastDisplayedId ? Math.max(lastDisplayedId, thisReputation.id) : thisReputation.id);
                            }
                        }
                    }
                }
                msg = msgStart.concat(msg);
            } else {
                msg = `You don't have any reputations encountered yet.`;
            }
            let components = [];
            if (minId < firstDisplayedId || maxId > lastDisplayedId) {
                let paginationActionRow = new ActionRowBuilder();
                if (minId < firstDisplayedId) {
                    paginationActionRow.addComponents(new ButtonBuilder().setCustomId(`reputation-desc-${character_id}-${firstDisplayedId - 1}`).setLabel('◀️').setStyle(ButtonStyle.Primary));
                }
                if (maxId > lastDisplayedId) {
                    paginationActionRow.addComponents(new ButtonBuilder().setCustomId(`reputation-asc-${character_id}-${lastDisplayedId + 1}`).setLabel('▶️').setStyle(ButtonStyle.Primary));
                }
                components.push(paginationActionRow);
            }
            const buttonActionRow = new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder().setCustomId(`sheet-${character_id}`).setLabel('Sheet').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`skillpage-asc-${character_id}-1`).setLabel('Skills').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId(`inventory-asc-${character_id}-1`).setLabel('Inventory').setStyle(ButtonStyle.Primary)
                );
            components.push(buttonActionRow);
            await interaction.update({ content: msg, components: components });
        }
    }

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === 'LocationMovementSelector' + interaction.member.id) {
            let dest_id = interaction.values[0]
            console.log(dest_id);
            //let locations = await connection.promise().query('select ml.*, c.name as character_name from players p left outer join players_characters pc on p.id = pc.player_id join characters c on pc.character_id = c.id join movement_locations ml on c.location_id = ml.id where ((p.user_id = ? and pc.active = 1) or c.location_id = ?) and ml.movement_allowed = 1 and ml.guild_id = ?', [interaction.user.id, dest_id, interaction.guild_id]);
            console.log(interaction.member.id);
            console.log(interaction.guildId);
            let locations = await connection.promise().query('select distinct ml.* from movement_locations ml left outer join characters c on c.location_id = ml.id left outer join players_characters pc on pc.character_id = c.id left outer join players p on p.id = pc.player_id where ((p.user_id = ? and pc.active = 1) or ml.id = ?) and ml.movement_allowed = 1 and ml.guild_id = ?', [interaction.member.id, dest_id, interaction.guildId]); //todo get dest id working
            let active_character = await connection.promise().query('select c.* from characters c join players_characters pc on pc.character_id = c.id join players p on p.id = pc.player_id where p.user_id = ? and pc.active = 1', [interaction.member.id]);
            console.log(locations[0]);
            if (locations[0].length == 2) {
                await interaction.update({ content: 'Location selected for movement!', components: [] });
                // Source and dest are both valid.
                let new_announcements;
                let new_name;
                let old_announcements;
                let old_name;
                let character_name = active_character[0][0].name;
                for (const location of locations[0]) {
                    let channel = await client.channels.cache.get(location.channel_id);
                    if (location.id == dest_id) {
                        await channel.permissionOverwrites.edit(interaction.member, { ViewChannel: true, SendMessages: true });
                        if (location.announcements_channel) {
                            new_announcements = await client.channels.cache.get(location.announcements_channel);
                            new_name = location.friendly_name;
                        }
                    } else {
                        if (location.global_read == 0) {
                            await channel.permissionOverwrites.edit(interaction.member, { ViewChannel: false });
                        }
                        if (location.global_write == 0) {
                            await channel.permissionOverwrites.edit(interaction.member, { SendMessages: false });
                        }
                        if (location.announcements_channel) {
                            old_announcements = await client.channels.cache.get(location.announcements_channel);
                            old_name = location.friendly_name;
                        }
                    }
                }
                if (old_announcements && new_name) {
                    await old_announcements.send('*' + character_name + ' moves to ' + new_name + '.*');
                } else if (old_announcements) {
                    await old_announcements.send('*' + character_name + ' leaves for parts unknown.*');
                }
                if (new_announcements && old_name) {
                    await new_announcements.send('*' + character_name + ' arrives from ' + old_name + '.*');
                } else if (new_announcements) {
                    await new_announcements.send('*' + character_name + ' arrives!*');
                }
                await connection.promise().query('update characters set location_id = ? where id = ?', [dest_id, active_character[0][0].id]);
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
        } else if (interaction.customId === 'TicketCategorySelector') {
            let category_id = interaction.values[0];
            let now = Date.now();
            /* Create Modal and accept input */
            let modal = new ModalBuilder()
                .setCustomId('TicketOpenModal-' + now)
                .setTitle('Open a Ticket')

            let fields = {
                title: new TextInputBuilder().setCustomId('title').setLabel('Type a SHORT description of your issue').setStyle(TextInputStyle.Short),
                description: new TextInputBuilder().setCustomId('description').setLabel('A more detailed description, please!').setStyle(TextInputStyle.Paragraph)
            };

            let titleRow = new ActionRowBuilder().addComponents(fields.title);
            let descRow = new ActionRowBuilder().addComponents(fields.description);

            modal.addComponents(titleRow, descRow);

            await interaction.showModal(modal);
            const submitted = await interaction.awaitModalSubmit({
                // Timeout after 5 minute of not receiving any valid Modals
                time: 300000,
                // Make sure we only accept Modals from the User who sent the original Interaction we're responding to
                filter: i => i.customId === 'TicketOpenModal-' + now && i.user.id === interaction.user.id,
            }).catch(error => {
                // Catch any Errors that are thrown (e.g. if the awaitModalSubmit times out after 60000 ms)
                console.error(error)
                return null
            });
            if (submitted) {
                //console.log(submitted.fields);
                let title = submitted.fields.getTextInputValue('title');
                let description = submitted.fields.getTextInputValue('description');
                //const [title, description] = Object.keys(fields).map(key => submitted.fields.getTextInputValue(fields[key].customId))
                let newTicket = await connection.promise().query('insert into tickets (uid_open, title, description, category_id) values (?, ?, ?, ?)', [interaction.user.id, title, description, category_id]);
                let thread = await interaction.channel.threads.create({
                    name: newTicket[0].insertId + ' - ' + title,
                    autoArchiveDuration: 4320, // Three days.
                    type: ChannelType.PrivateThread,
                    reason: 'Ticket thread'
                });
                console.log(thread);
                await connection.promise().query('update tickets set thread_id = ? where id = ?', [thread.id, newTicket[0].insertId]);
                await thread.members.add(interaction.user.id);
                let role = await connection.promise().query('select * from tickets_categories_roles where category_id = ?', [category_id]);
                let category = await connection.promise().query('select * from tickets_categories where id = ?', [category_id]);
                await thread.send(`**${title}**`);
                await thread.send(description);
                if (role[0].length > 0) {
                    await thread.send('<@&' + role[0][0].role_id + '>');
                }
                await submitted.reply({ content: 'Ticket created, check here: <#' + thread.id + '>', ephemeral: true });
                let settingvalue = await connection.promise().query('select * from game_settings where guild_id = ? and setting_name = ?', [interaction.guild.id, 'audit_channel']);
                let audit_channel = await client.channels.cache.get(settingvalue[0][0].setting_value);
                let embed = new EmbedBuilder()
                    .setTitle('Ticket created!')
                    .setDescription(title)
                    .setAuthor({ name: interaction.member.displayName })
                    .addFields(
                        {
                            name: 'Thread link',
                            value: thread.toString(),
                            inline: true
                        },
                        {
                            name: 'Category',
                            value: category[0][0].name,
                            inline: true
                        }
                    )
                    .setTimestamp();
                audit_channel.send({ embeds: [embed] });
            }
        }
    }
});

/* MAIN TIMER LOOP */
async function main_timer_loop() {
    let now = Math.floor(Date.now() / 1000);
    let queryData = [(now / 1000) - 10800]; //todo: plus/minus fifteen minutes
    // Lock Expired Whispers
    let whispers = await connection.promise().query('select * from whispers where locked = 0 and expiration < ?', [now]);
    if (whispers[0].length > 0) {
        for (const thisWhisper of whispers[0]) {
            let channel = await client.channels.fetch(thisWhisper.channel_id);
            await channel.send('Whisper closed!');
            //await channel.lockPermissions(); // Sync permissions with category
            let users = await connection.promise().query('select p.user_id from whispers_characters wc join players_characters pc on wc.character_id = pc.character_id join players p on pc.player_id = p.id where whisper_id = ?', [thisWhisper.id]);
            let characters = await connection.promise().query('select distinct c.name from whispers_characters wc join characters c on wc.character_id = c.id where whisper_id = ?', [thisWhisper.id]);
            if (users[0].length > 0) {
                for (const thisUser of users[0]) {
                    let user = await client.users.fetch(thisUser.user_id);
                    channel.permissionOverwrites.edit(user, { SendMessages: false });
                }
            }
            await connection.promise().query('update whispers set locked = 1 where channel_id = ?', thisWhisper.channel_id);
            let settingvalue = await connection.promise().query('select * from game_settings where guild_id = ? and setting_name = ?', [channel.guild.id, 'audit_channel']);
            if (settingvalue[0].length > 0) {
                let audit_channel = await client.channels.cache.get(settingvalue[0][0].setting_value);
                let embed = new EmbedBuilder()
                    .setTitle('Whisper closed!')
                    .setDescription('Auto-close notification for whisper ID ' + thisWhisper.id)
                    .addFields(
                        {
                            name: 'Channel link',
                            value: channel.toString(),
                            inline: true
                        },
                        {
                            name: 'Whisper members',
                            value: (characters[0].length > 0 ? characters[0].map(a => a.name).join('\n') : '*none*'),
                            inline: true
                        }
                    )
                    .setTimestamp();
                audit_channel.send({ embeds: [embed] });
            }

        }
    }

}

const interval = setInterval(main_timer_loop, 1000 * 30); // Run the main timer loop once every 30 seconds, for now.