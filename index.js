const { Client, GatewayIntentBits, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionsBitField, StringSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const express = require('express');

// ==================== KEEP-ALIVE SERVER ====================
const keepAliveApp = express();
keepAliveApp.get('/', (req, res) => res.send('Bot is alive!'));
keepAliveApp.listen(3000, () => console.log('🌐 Server on port 3000'));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

const TOKEN = process.env.TIER_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

// ==================== CONFIGURATION ====================
const APPLICANT_ROLE = 'Combat Learner';
const APPLY_CHANNEL = 'apply';
const QUEUE_CHANNEL = 'queue';
const RESULTS_CHANNEL = 'test-results';
const LOG_CHANNEL = 'staff-logs';
const TESTER_PANEL_CHANNEL = 'test-panels';
const QUEUE_CATEGORY = 'TIER TESTING';

// Rank roles
const RANK_ROLES = ['LT5', 'LT4', 'LT3', 'LT2', 'LT1', 'HT5', 'HT4', 'HT3', 'HT2', 'HT1'];

// Points for rank progression
const RANK_POINTS = {
    'LT5': 0, 'LT4': 5, 'LT3': 15, 'LT2': 30, 'LT1': 50,
    'HT5': 80, 'HT4': 115, 'HT3': 155, 'HT2': 200, 'HT1': 250
};

// Title requirements
const TITLES = [
    { name: 'Combat Learner', minPoints: 0, role: 'Combat Learner' },
    { name: 'Combat Cadet', minPoints: 100, role: 'Combat Cadet' },
    { name: 'Combat Ace', minPoints: 180, role: 'Combat Ace' },
    { name: 'Combat Master', minPoints: 270, role: 'Combat Master' },
    { name: 'Combat Grandmaster', minPoints: 330, role: 'Combat Grandmaster' }
];

// Custom kit symbols (replace with your emoji IDs after uploading)
// Format: <:emojiname:emojiid>
const KIT_SYMBOLS = {
    'Sword': '<:sword_custom:>',
    'Axe': '<:axe_custom:>',
    'No Axe': '<:noaxe_custom:>',
    'Mace HT': '<:maceht_custom:>',
    'Mace LT': '<:macelt_custom:>',
    'Nethpot': '<:nethpot_custom:>',
    'Crystal': '<:crystal_custom:>',
    'Mace-Sphere': '<:macesphere_custom:>',
    'UHC': '<:uhc_custom:>',
    'SMP': '<:smp_custom:>',
    'Pot': '<:pot_custom:>'
};

const KIT_ORDER = ['Sword', 'Axe', 'No Axe', 'Mace HT', 'Mace LT', 'Nethpot', 'Crystal', 'Mace-Sphere', 'UHC', 'SMP', 'Pot'];

const GAMEMODES = [
    { name: 'Sword', testerRole: 'Sword Tester' },
    { name: 'Axe', testerRole: 'Axe Tester' },
    { name: 'No Axe', testerRole: 'No Axe Tester' },
    { name: 'Mace HT', testerRole: 'Mace HT Tester' },
    { name: 'Mace LT', testerRole: 'Mace LT Tester' },
    { name: 'Nethpot', testerRole: 'Nethpot Tester' },
    { name: 'Crystal', testerRole: 'Crystal Tester' },
    { name: 'Mace-Sphere', testerRole: 'Mace-Sphere Tester' },
    { name: 'UHC', testerRole: 'UHC Tester' },
    { name: 'SMP', testerRole: 'SMP Tester' },
    { name: 'Pot', testerRole: 'Pot Tester' }
];

// ==================== DATABASE ====================
let db = {
    players: {},
    queues: {},
    kits: {},
    queueMessages: {},
    staffNotes: {},
    strikes: {},
    blacklist: [],
    settings: { cooldown: 5, maxQueueSize: 20 }
};

const DATA_FILE = 'tierbot.json';
if (fs.existsSync(DATA_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DATA_FILE)); } catch(e) {}
}
function saveData() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

// ==================== HELPER FUNCTIONS ====================
function calculateTotalPoints(playerId) {
    const player = db.players[playerId];
    if (!player || !player.testHistory) return player?.manualPoints || 0;
    
    let totalPoints = player.manualPoints || 0;
    for (const test of player.testHistory) {
        totalPoints += test.pointsEarned || 0;
    }
    return totalPoints;
}

function getTitleFromPoints(points) {
    for (let i = TITLES.length - 1; i >= 0; i--) {
        if (points >= TITLES[i].minPoints) {
            return TITLES[i];
        }
    }
    return TITLES[0];
}

async function updateTitleRole(guild, userId) {
    const points = calculateTotalPoints(userId);
    const title = getTitleFromPoints(points);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) return;
    
    for (const t of TITLES) {
        const role = await getRole(guild, t.role);
        if (role && member.roles.cache.has(role.id)) {
            await member.roles.remove(role);
        }
    }
    
    const newRole = await getRole(guild, title.role);
    if (newRole && !member.roles.cache.has(newRole.id)) {
        await member.roles.add(newRole);
    }
}

function calculatePointsForRankChange(oldRank, newRank) {
    const oldPoints = RANK_POINTS[oldRank] || 0;
    const newPoints = RANK_POINTS[newRank] || 0;
    return newPoints - oldPoints > 0 ? newPoints - oldPoints : 2;
}

function getPlayerPosition(playerId) {
    const allPlayers = Object.entries(db.players).map(([id]) => ({
        id: id,
        points: calculateTotalPoints(id)
    }));
    allPlayers.sort((a, b) => b.points - a.points);
    const position = allPlayers.findIndex(p => p.id === playerId) + 1;
    return position > 0 ? position : allPlayers.length + 1;
}

async function getRole(guild, name) {
    return guild.roles.cache.find(r => r.name === name);
}

async function setRank(guild, userId, newRank) {
    const member = await guild.members.fetch(userId);
    if (!member) return false;
    
    for (const rank of RANK_ROLES) {
        const role = await getRole(guild, rank);
        if (role && member.roles.cache.has(role.id)) {
            await member.roles.remove(role);
        }
    }
    
    const newRankRole = await getRole(guild, newRank);
    if (newRankRole) {
        await member.roles.add(newRankRole);
    }
    return true;
}

// ==================== PROFILE COMMAND ====================
async function showProfile(interaction, targetUser) {
    const playerData = db.players[targetUser.id];
    if (!playerData) {
        return interaction.reply({ content: `❌ ${targetUser.username} has not applied yet! Use \`/apply\``, flags: 64 });
    }
    
    const totalPoints = calculateTotalPoints(targetUser.id);
    const title = getTitleFromPoints(totalPoints);
    const position = getPlayerPosition(targetUser.id);
    
    let tiersRow = '';
    for (const kit of KIT_ORDER) {
        const rank = playerData.kitRanks?.[kit] || 'NA';
        const symbol = KIT_SYMBOLS[kit] || '📦';
        tiersRow += `${symbol}${rank} `;
    }
    
    const avatarUrl = playerData.customAvatar || 'https://static.wikia.nocookie.net/minecraft/images/8/8c/Steve_%28Mob%29.png';
    
    const embed = new EmbedBuilder()
        .setColor(0x2C2F33)
        .setAuthor({ name: targetUser.username, iconURL: avatarUrl })
        .setTitle(`⚔️ ${playerData.username} ⚔️`)
        .setDescription([
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `**🏆 ${title.name}**`,
            `**🌍 ${playerData.region}**`,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `┌─────────────────────────────┐`,
            `│  POSITION: #${position}               │`,
            `│  OVERALL: ${totalPoints} points        │`,
            `└─────────────────────────────┘`,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `**🎮 KIT RANKS**`,
            `\`\`\``,
            `${tiersRow}`,
            `\`\`\``,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        ].join('\n'))
        .setFooter({ text: `Next: ${getTitleFromPoints(totalPoints + 1).name} at ${getTitleFromPoints(totalPoints + 1).minPoints} points` })
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed], flags: 64 });
}

// ==================== QUEUE EMBED ====================
async function updateQueueEmbed(guild, kitName) {
    const queue = db.queues[kitName];
    if (!queue || !queue.messageId) return;
    
    const channel = await guild.channels.fetch(QUEUE_CHANNEL).catch(() => null);
    if (!channel) return;
    
    const waitingList = queue.waiting || [];
    const testingList = queue.testing || [];
    
    const kitData = GAMEMODES.find(k => k.name === kitName);
    const testerRoleName = kitData?.testerRole;
    const testerRole = testerRoleName ? await getRole(guild, testerRoleName) : null;
    const activeTesters = testerRole ? testerRole.members.map(m => `<@${m.id}>`).join(', ') : 'None';
    
    let waitingText = '';
    for (let i = 0; i < waitingList.length; i++) {
        const playerId = waitingList[i];
        const player = db.players[playerId];
        waitingText += `${i+1}. **${player?.username || 'Unknown'}** (<@${playerId}>)\n`;
    }
    if (waitingText === '') waitingText = '*No players waiting*';
    
    let testingText = '';
    for (const test of testingList) {
        const player = db.players[test.userId];
        testingText += `• **${player?.username || 'Unknown'}** — tested by <@${test.testerId}>\n`;
    }
    if (testingText === '') testingText = '*No active tests*';
    
    const embed = new EmbedBuilder()
        .setTitle(`${KIT_SYMBOLS[kitName] || '⚔️'} ${kitName} QUEUE — Waiting: ${waitingList.length}`)
        .setColor(0x2C2F33)
        .setDescription([
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
            `**🟢 Active ${kitName} Testers:**\n${activeTesters}`,
            '',
            `**🔴 Currently Testing:**\n${testingText}`,
            '',
            `**⏳ Waiting Queue:**\n${waitingText}`,
            '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
        ].join('\n'))
        .setFooter({ text: 'Updated every 60 minutes • Click button below to check your position' })
        .setTimestamp();
    
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`queue_position:${kitName}`)
            .setLabel('📍 WHERE AM I?')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📍')
    );
    
    const message = await channel.messages.fetch(queue.messageId).catch(() => null);
    if (message) {
        await message.edit({ embeds: [embed], components: [row] });
    } else {
        const newMsg = await channel.send({ embeds: [embed], components: [row] });
        db.queues[kitName].messageId = newMsg.id;
        saveData();
    }
}

// ==================== MODALS ====================
async function showApplyModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId('apply_modal')
        .setTitle('Minecraft Tier Application');
    
    const usernameInput = new TextInputBuilder()
        .setCustomId('username')
        .setLabel('Minecraft Username')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Enter your Minecraft username');
    
    const regionInput = new TextInputBuilder()
        .setCustomId('region')
        .setLabel('Region')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('EU / NA / ASIA / etc.');
    
    const deviceInput = new TextInputBuilder()
        .setCustomId('device')
        .setLabel('Device')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('Mobile / PC / Console');
    
    modal.addComponents(
        new ActionRowBuilder().addComponents(usernameInput),
        new ActionRowBuilder().addComponents(regionInput),
        new ActionRowBuilder().addComponents(deviceInput)
    );
    
    await interaction.showModal(modal);
}

async function showDoneModal(interaction, playerId, playerName, kitName) {
    const modal = new ModalBuilder()
        .setCustomId(`done_modal:${playerId}:${kitName}`)
        .setTitle('Complete Test');
    
    const rankInput = new TextInputBuilder()
        .setCustomId('rank')
        .setLabel('Earned Rank')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('LT5, LT4, LT3, LT2, LT1, HT5, HT4, HT3, HT2, HT1');
    
    const scoreInput = new TextInputBuilder()
        .setCustomId('score')
        .setLabel('Score / Frags')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('e.g., 7-2 or 5');
    
    const notesInput = new TextInputBuilder()
        .setCustomId('notes')
        .setLabel('Notes')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setPlaceholder('Optional notes about the test');
    
    modal.addComponents(
        new ActionRowBuilder().addComponents(rankInput),
        new ActionRowBuilder().addComponents(scoreInput),
        new ActionRowBuilder().addComponents(notesInput)
    );
    
    await interaction.showModal(modal);
}

// ==================== REGISTER COMMANDS ====================
async function registerCommands() {
    const kitChoices = GAMEMODES.map(k => ({ name: k.name, value: k.name }));
    
    const commands = [
        // Player commands
        { name: 'apply', description: 'Apply to become a Combat Learner' },
        { name: 'request', description: 'Request a test for a specific gamemode' },
        { name: 'cancel', description: 'Cancel your pending test request' },
        { name: 'position', description: 'Check your position in queues' },
        { name: 'profile', description: 'View your Minecraft profile', options: [{ name: 'user', type: 6, required: false }] },
        { name: 'setavatar', description: 'Set custom avatar for your profile', options: [{ name: 'image_url', type: 3, required: true }] },
        { name: 'resetavatar', description: 'Reset to default Steve avatar' },
        { name: 'history', description: 'View your test history' },
        { name: 'leaderboard', description: 'View top players by points' },
        { name: 'stats', description: 'View your stats per kit' },
        { name: 'rankup', description: 'Check points needed for next title' },
        { name: 'notify', description: 'Toggle DM notifications when picked from queue' },
        
        // Tester commands
        { name: 'queue', description: 'View waiting queue for a kit', options: [{ name: 'kit', type: 3, required: true, choices: kitChoices }] },
        { name: 'testnow', description: 'Start a test with a player', options: [{ name: 'player', type: 6, required: true }] },
        { name: 'start', description: 'Start the test timer (use in test channel)' },
        { name: 'done', description: 'Complete the current test' },
        { name: 'close', description: 'Force close the test channel' },
        { name: 'notes', description: 'Add private note about a player', options: [{ name: 'player', type: 6, required: true }, { name: 'note', type: 3, required: true }] },
        { name: 'warn', description: 'Warn a player', options: [{ name: 'player', type: 6, required: true }, { name: 'reason', type: 3, required: true }] },
        { name: 'strike', description: 'Add a strike to a player', options: [{ name: 'player', type: 6, required: true }] },
        { name: 'blacklist', description: 'Blacklist a player from testing', options: [{ name: 'player', type: 6, required: true }] },
        { name: 'unblacklist', description: 'Remove player from blacklist', options: [{ name: 'player', type: 6, required: true }] },
        { name: 'claim', description: 'Claim a player from queue', options: [{ name: 'player', type: 6, required: true }] },
        
        // Admin commands
        { name: 'deploy', description: '[Admin] Deploy queue embed for a kit', options: [{ name: 'kit', type: 3, required: true, choices: kitChoices }] },
        { name: 'removequeue', description: '[Admin] Remove queue embed for a kit', options: [{ name: 'kit', type: 3, required: true, choices: kitChoices }] },
        { name: 'refreshqueue', description: '[Admin] Manually refresh queue embed', options: [{ name: 'kit', type: 3, required: true, choices: kitChoices }] },
        { name: 'kit', description: '[Admin] Manage kit images', options: [
            { name: 'action', type: 3, required: true, choices: [{ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }, { name: 'list', value: 'list' }] },
            { name: 'kit', type: 3, required: false, choices: kitChoices },
            { name: 'image', type: 3, required: false }
        ] },
        { name: 'check', description: '[Staff] Check player info', options: [{ name: 'player', type: 6, required: true }] },
        { name: 'forcerank', description: '[Admin] Force change player rank', options: [{ name: 'player', type: 6, required: true }, { name: 'rank', type: 3, required: true, choices: RANK_ROLES.map(r => ({ name: r, value: r })) }] },
        { name: 'setpoints', description: '[Admin] Set player points', options: [{ name: 'player', type: 6, required: true }, { name: 'points', type: 4, required: true }] },
        { name: 'reset', description: '[Admin] Reset player completely', options: [{ name: 'player', type: 6, required: true }] },
        { name: 'recalculate', description: '[Admin] Recalculate player points', options: [{ name: 'player', type: 6, required: true }] },
        { name: 'export', description: '[Admin] Export all player data to CSV' },
        { name: 'backup', description: '[Admin] Manual database backup' },
        { name: 'announce', description: '[Admin] Announce to all testers', options: [{ name: 'message', type: 3, required: true }] },
        { name: 'audit', description: '[Admin] View staff actions on a player', options: [{ name: 'player', type: 6, required: true }] },
        { name: 'setcooldown', description: '[Admin] Set cooldown between requests (minutes)', options: [{ name: 'minutes', type: 4, required: true }] },
        { name: 'maxqueue', description: '[Admin] Set max queue size per kit', options: [{ name: 'kit', type: 3, required: true, choices: kitChoices }, { name: 'size', type: 4, required: true }] },
        { name: 'help', description: 'Show all commands' }
    ];
    
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Commands registered');
}

// ==================== HELP COMMAND ====================
async function showHelp(interaction) {
    const embed = new EmbedBuilder()
        .setColor(0x2ECC71)
        .setTitle('📋 TIER BOT COMMANDS')
        .setDescription([
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `**👤 PLAYER COMMANDS**`,
            `\`/apply\` - Apply as Combat Learner`,
            `\`/request\` - Request a test`,
            `\`/cancel\` - Cancel queue request`,
            `\`/position\` - Check queue position`,
            `\`/profile\` - View your Minecraft profile`,
            `\`/setavatar\` - Custom avatar for profile`,
            `\`/resetavatar\` - Reset to Steve`,
            `\`/history\` - View test history`,
            `\`/leaderboard\` - Top players`,
            `\`/stats\` - Your per-kit stats`,
            `\`/rankup\` - Points to next title`,
            `\`/notify\` - Toggle DM notifications`,
            ``,
            `**🎮 TESTER COMMANDS**`,
            `\`/queue <kit>\` - View queue`,
            `\`/testnow @player\` - Start test`,
            `\`/claim @player\` - Claim from queue`,
            `\`/start\` - Begin test`,
            `\`/done\` - Complete test`,
            `\`/close\` - Force close`,
            `\`/notes @user\` - Add private note`,
            `\`/warn @user\` - Warn player`,
            `\`/strike @user\` - Add strike`,
            `\`/blacklist @user\` - Ban from testing`,
            `\`/unblacklist @user\` - Remove ban`,
            ``,
            `**⚙️ ADMIN COMMANDS**`,
            `\`/deploy queue <kit>\` - Deploy queue`,
            `\`/removequeue <kit>\` - Remove queue`,
            `\`/kit add/remove/list\` - Manage kit images`,
            `\`/check @user\` - Lookup player`,
            `\`/forcerank @user\` - Force rank`,
            `\`/setpoints @user\` - Set points`,
            `\`/reset @user\` - Reset player`,
            `\`/recalculate @user\` - Recalc points`,
            `\`/export\` - Export data to CSV`,
            `\`/backup\` - Manual backup`,
            `\`/announce\` - Announce to testers`,
            `\`/audit @user\` - Staff actions log`,
            `\`/setcooldown\` - Set request cooldown`,
            `\`/maxqueue\` - Set queue limit`,
            `\`/help\` - Show this menu`,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        ].join('\n'))
        .setFooter({ text: `Cooldown: ${db.settings.cooldown} min | Max Queue: ${db.settings.maxQueueSize} | Blacklisted: ${db.blacklist.length}` })
        .setTimestamp();
    
    await interaction.reply({ embeds: [embed], flags: 64 });
}

// ==================== READY ====================
client.once('ready', async () => {
    console.log(`✅ Tier Bot logged in as ${client.user.tag}`);
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return console.error('❌ Guild not found!');
    
    await registerCommands();
    
    console.log('\n📋 Detected Tester Roles:');
    for (const kit of GAMEMODES) {
        const role = await getRole(guild, kit.testerRole);
        console.log(`   ${kit.name}: ${role ? '✅ ' + kit.testerRole : '❌ Missing - create role "' + kit.testerRole + '"'}`);
    }
    
    for (const kit of GAMEMODES) {
        if (db.queues[kit.name]?.messageId) {
            setInterval(async () => {
                const g = client.guilds.cache.get(GUILD_ID);
                if (g) await updateQueueEmbed(g, kit.name);
            }, 60 * 60 * 1000);
        }
    }
    
    console.log(`\n✅ Ready! | ${GAMEMODES.length} gamemodes loaded`);
    console.log(`📌 Use /help to see all commands`);
});

// ==================== INTERACTION HANDLER ====================
client.on('interactionCreate', async interaction => {
    // Modals
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'apply_modal') {
            const username = interaction.fields.getTextInputValue('username');
            const region = interaction.fields.getTextInputValue('region');
            const device = interaction.fields.getTextInputValue('device');
            
            const applicantRole = await getRole(interaction.guild, APPLICANT_ROLE);
            if (!applicantRole) {
                return interaction.reply({ content: '❌ Combat Learner role not found! Please create it.', flags: 64 });
            }
            
            if (interaction.member.roles.cache.has(applicantRole.id)) {
                return interaction.reply({ content: '❌ You already applied!', flags: 64 });
            }
            
            await interaction.member.roles.add(applicantRole);
            
            db.players[interaction.user.id] = {
                username,
                region,
                device,
                rank: null,
                kitRanks: {},
                customAvatar: null,
                appliedAt: Date.now(),
                testHistory: [],
                notifyOnPick: true,
                lastRequestAt: 0,
                warnings: [],
                strikes: 0
            };
            saveData();
            
            const embed = new EmbedBuilder()
                .setColor(0x2ECC71)
                .setTitle('✅ Application Submitted!')
                .setDescription(`**Welcome, ${interaction.user.username}!**\n\nYou are now a **Combat Learner**.\n\nUse \`/request\` to request a test!`)
                .addFields(
                    { name: '📝 Username', value: username, inline: true },
                    { name: '🌍 Region', value: region, inline: true },
                    { name: '📱 Device', value: device, inline: true }
                );
            
            await interaction.reply({ embeds: [embed], flags: 64 });
            return;
        }
        
        if (interaction.customId.startsWith('done_modal:')) {
            const parts = interaction.customId.split(':');
            const playerId = parts[1];
            const kitName = parts[2];
            const rank = interaction.fields.getTextInputValue('rank').toUpperCase();
            const score = interaction.fields.getTextInputValue('score');
            const notes = interaction.fields.getTextInputValue('notes') || 'No notes';
            
            const player = db.players[playerId];
            if (!player) {
                return interaction.reply({ content: '❌ Player not found!', flags: 64 });
            }
            
            const previousRank = player.kitRanks?.[kitName] || 'Unranked';
            let pointsEarned = 2;
            
            if (previousRank !== rank) {
                pointsEarned = calculatePointsForRankChange(previousRank, rank);
                if (!player.kitRanks) player.kitRanks = {};
                player.kitRanks[kitName] = rank;
            }
            
            const allRanks = Object.values(player.kitRanks || {});
            const highestRank = allRanks.sort((a, b) => RANK_ROLES.indexOf(a) - RANK_ROLES.indexOf(b)).pop() || null;
            if (highestRank) {
                await setRank(interaction.guild, playerId, highestRank);
                player.rank = highestRank;
            }
            
            player.testHistory.push({
                tester: interaction.user.id,
                kit: kitName,
                rank: rank,
                score: score,
                notes: notes,
                pointsEarned: pointsEarned,
                date: Date.now()
            });
            saveData();
            
            await updateTitleRole(interaction.guild, playerId);
            
            const resultsChannel = interaction.guild.channels.cache.find(c => c.name === RESULTS_CHANNEL);
            const resultsEmbed = new EmbedBuilder()
                .setColor(rank.startsWith('HT') ? 0x9B59B6 : 0x3498DB)
                .setTitle(`🎉 ${player.username}'s Test Results`)
                .setDescription([
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                    `**Tester:** <@${interaction.user.id}>`,
                    `**Kit:** ${kitName || 'Unknown'}`,
                    `**Region:** ${player.region}`,
                    `**Username:** ${player.username}`,
                    `**Score:** ${score}`,
                    `**Previous ${kitName} Rank:** ${previousRank}`,
                    `**New ${kitName} Rank:** ${rank}`,
                    `**Points Earned:** +${pointsEarned}`,
                    `**Notes:** ${notes}`,
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
                ].join('\n'))
                .setFooter({ text: `Total points: ${calculateTotalPoints(playerId)}` })
                .setTimestamp();
            
            if (resultsChannel) await resultsChannel.send({ content: `<@${playerId}>`, embeds: [resultsEmbed] });
            
            for (const kit of GAMEMODES) {
                const queue = db.queues[kit.name];
                if (queue) {
                    queue.waiting = queue.waiting.filter(id => id !== playerId);
                    queue.testing = queue.testing.filter(t => t.userId !== playerId);
                    await updateQueueEmbed(interaction.guild, kit.name);
                }
            }
            
            await interaction.reply({ content: `✅ Test completed! ${player.username} earned +${pointsEarned} points!`, flags: 64 });
            setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
            return;
        }
    }
    
    // Buttons
    if (interaction.isButton() && interaction.customId.startsWith('queue_position:')) {
        const kit = interaction.customId.split(':')[1];
        const queue = db.queues[kit];
        if (!queue) {
            return interaction.reply({ content: '❌ Queue not found!', flags: 64 });
        }
        
        const position = queue.waiting.indexOf(interaction.user.id);
        if (position === -1) {
            return interaction.reply({ content: '❌ You are not in this queue!', flags: 64 });
        }
        
        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle(`📍 Your Position in ${kit} Queue`)
            .setDescription([
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `**Position:** #${position + 1} out of ${queue.waiting.length}`,
                `**Players ahead:** ${position}`,
                `**Estimated wait:** ~${position * 10} minutes`,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `You will be notified when a tester picks you!`
            ].join('\n'));
        
        await interaction.reply({ embeds: [embed], flags: 64 });
        return;
    }
    
    // Select Menus
    if (interaction.isStringSelectMenu() && interaction.customId === 'request_menu') {
        const kitName = interaction.values[0];
        
        if (!db.players[interaction.user.id]) {
            return interaction.reply({ content: '❌ You need to `/apply` first!', flags: 64 });
        }
        
        if (db.blacklist.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ You are blacklisted from testing! Contact staff.', flags: 64 });
        }
        
        const player = db.players[interaction.user.id];
        const cooldownRemaining = (player.lastRequestAt + db.settings.cooldown * 60 * 1000) - Date.now();
        if (cooldownRemaining > 0) {
            const minutes = Math.ceil(cooldownRemaining / 60000);
            return interaction.reply({ content: `❌ Please wait ${minutes} minutes before requesting again!`, flags: 64 });
        }
        
        if (!db.queues[kitName]) db.queues[kitName] = { waiting: [], testing: [], messageId: null };
        
        const maxSize = db.settings.maxQueueSize;
        if (db.queues[kitName].waiting.length >= maxSize) {
            return interaction.reply({ content: `❌ ${kitName} queue is full (${maxSize} max)! Try later.`, flags: 64 });
        }
        
        if (db.queues[kitName].waiting.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ You are already in this queue!', flags: 64 });
        }
        
        db.queues[kitName].waiting.push(interaction.user.id);
        player.lastRequestAt = Date.now();
        saveData();
        
        await updateQueueEmbed(interaction.guild, kitName);
        await interaction.reply({ content: `✅ Added to **${kitName}** queue at position #${db.queues[kitName].waiting.length}!`, flags: 64 });
        return;
    }
    
    // Slash Commands
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName, options, member, guild, channel } = interaction;
    const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
    const isTester = isAdmin || member.roles.cache.some(r => r.name && r.name.includes('Tester'));
    
    // ==================== PLAYER COMMANDS ====================
    
    if (commandName === 'apply') {
        const applyChannel = guild.channels.cache.find(c => c.name === APPLY_CHANNEL);
        if (channel.id !== applyChannel?.id) {
            return interaction.reply({ content: `❌ Use this command in #${APPLY_CHANNEL}!`, flags: 64 });
        }
        await showApplyModal(interaction);
        return;
    }
    
    if (commandName === 'request') {
        if (!db.players[interaction.user.id]) {
            return interaction.reply({ content: '❌ You need to `/apply` first!', flags: 64 });
        }
        
        const row = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('request_menu')
                .setPlaceholder('Select a gamemode')
                .addOptions(GAMEMODES.map(k => ({ label: k.name, value: k.name, description: `Join ${k.name} queue` })))
        );
        
        await interaction.reply({ content: '🎮 **Select a gamemode to test:**', components: [row], flags: 64 });
        return;
    }
    
    if (commandName === 'cancel') {
        let removed = false;
        for (const kit of GAMEMODES) {
            const queue = db.queues[kit.name];
            if (queue && queue.waiting.includes(interaction.user.id)) {
                queue.waiting = queue.waiting.filter(id => id !== interaction.user.id);
                await updateQueueEmbed(guild, kit.name);
                removed = true;
            }
        }
        
        await interaction.reply({ content: removed ? '✅ Removed from all queues!' : '❌ You are not in any queue!', flags: 64 });
        return;
    }
    
    if (commandName === 'position') {
        let message = '**Your Queue Positions:**\n━━━━━━━━━━━━━━━━━━━━\n';
        let inQueue = false;
        
        for (const kit of GAMEMODES) {
            const queue = db.queues[kit.name];
            if (queue) {
                const pos = queue.waiting.indexOf(interaction.user.id);
                if (pos !== -1) {
                    message += `**${kit.name}:** #${pos + 1}/${queue.waiting.length}\n`;
                    inQueue = true;
                }
            }
        }
        
        if (!inQueue) message += '*You are not in any queue*';
        await interaction.reply({ content: message, flags: 64 });
        return;
    }
    
    if (commandName === 'profile') {
        const targetUser = options.getUser('user') || interaction.user;
        await showProfile(interaction, targetUser);
        return;
    }
    
    if (commandName === 'setavatar') {
        const imageUrl = options.getString('image_url');
        if (!imageUrl.match(/\.(png|jpg|jpeg|gif|webp)/i)) {
            return interaction.reply({ content: '❌ Please provide a valid image URL!', flags: 64 });
        }
        
        if (!db.players[interaction.user.id]) {
            return interaction.reply({ content: '❌ You need to `/apply` first!', flags: 64 });
        }
        
        db.players[interaction.user.id].customAvatar = imageUrl;
        saveData();
        await interaction.reply({ content: '✅ Your profile avatar has been updated!', flags: 64 });
        return;
    }
    
    if (commandName === 'resetavatar') {
        if (!db.players[interaction.user.id]) {
            return interaction.reply({ content: '❌ You need to `/apply` first!', flags: 64 });
        }
        
        db.players[interaction.user.id].customAvatar = null;
        saveData();
        await interaction.reply({ content: '✅ Your profile avatar has been reset to Steve!', flags: 64 });
        return;
    }
    
    if (commandName === 'history') {
        const player = db.players[interaction.user.id];
        if (!player) {
            return interaction.reply({ content: '❌ You need to `/apply` first!', flags: 64 });
        }
        
        let historyText = '';
        for (let i = 0; i < player.testHistory.length; i++) {
            const t = player.testHistory[i];
            historyText += `${i+1}. ${new Date(t.date).toLocaleDateString()} | ${t.kit} | ${t.rank} | ${t.score} | +${t.pointsEarned}pts\n`;
        }
        if (!historyText) historyText = '*No test history yet*';
        
        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle(`📜 ${player.username}'s Test History`)
            .setDescription(`\`\`\`\n${historyText}\n\`\`\``)
            .setFooter({ text: `Total points: ${calculateTotalPoints(interaction.user.id)}` });
        
        await interaction.reply({ embeds: [embed], flags: 64 });
        return;
    }
    
    if (commandName === 'leaderboard') {
        const allPlayers = Object.entries(db.players).map(([id, data]) => ({
            id: id,
            username: data.username,
            points: calculateTotalPoints(id)
        }));
        allPlayers.sort((a, b) => b.points - a.points);
        
        let leaderboardText = '';
        for (let i = 0; i < Math.min(allPlayers.length, 15); i++) {
            const p = allPlayers[i];
            leaderboardText += `${i+1}. **${p.username}** — ${p.points} pts\n`;
        }
        
        const embed = new EmbedBuilder()
            .setColor(0xF1C40F)
            .setTitle('🏆 LEADERBOARD')
            .setDescription(leaderboardText || '*No players yet*')
            .setFooter({ text: 'Top 15 players by total points' });
        
        await interaction.reply({ embeds: [embed], flags: 64 });
        return;
    }
    
    if (commandName === 'stats') {
        const player = db.players[interaction.user.id];
        if (!player) {
            return interaction.reply({ content: '❌ You need to `/apply` first!', flags: 64 });
        }
        
        let statsText = '';
        for (const kit of KIT_ORDER) {
            const rank = player.kitRanks?.[kit] || 'NA';
            statsText += `${KIT_SYMBOLS[kit] || '📦'} ${kit}: ${rank}\n`;
        }
        
        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle(`📊 ${player.username}'s Kit Stats`)
            .setDescription(statsText)
            .setFooter({ text: `Total points: ${calculateTotalPoints(interaction.user.id)}` });
        
        await interaction.reply({ embeds: [embed], flags: 64 });
        return;
    }
    
    if (commandName === 'rankup') {
        const points = calculateTotalPoints(interaction.user.id);
        const nextTitle = getTitleFromPoints(points + 1);
        const pointsNeeded = nextTitle.minPoints - points;
        
        const embed = new EmbedBuilder()
            .setColor(0x9B59B6)
            .setTitle(`📈 Rank Up Progress`)
            .setDescription([
                `**Current Title:** ${getTitleFromPoints(points).name}`,
                `**Current Points:** ${points}`,
                `**Next Title:** ${nextTitle.name}`,
                `**Points Needed:** ${pointsNeeded} points`,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `*Complete more tests to rank up!*`
            ].join('\n'));
        
        await interaction.reply({ embeds: [embed], flags: 64 });
        return;
    }
    
    if (commandName === 'notify') {
        if (!db.players[interaction.user.id]) {
            return interaction.reply({ content: '❌ You need to `/apply` first!', flags: 64 });
        }
        
        db.players[interaction.user.id].notifyOnPick = !db.players[interaction.user.id].notifyOnPick;
        saveData();
        const status = db.players[interaction.user.id].notifyOnPick ? 'enabled' : 'disabled';
        await interaction.reply({ content: `✅ DM notifications ${status}!`, flags: 64 });
        return;
    }
    
    // ==================== TESTER COMMANDS ====================
    
    if (!isTester && !isAdmin && ['queue', 'testnow', 'start', 'done', 'close', 'notes', 'warn', 'strike', 'blacklist', 'unblacklist', 'claim', 'check'].includes(commandName)) {
        return interaction.reply({ content: '❌ You need a **Tester** role to use this command!', flags: 64 });
    }
    
    if (commandName === 'queue' && (isTester || isAdmin)) {
        const kitName = options.getString('kit');
        const queue = db.queues[kitName];
        
        if (!queue || queue.waiting.length === 0) {
            return interaction.reply({ content: `📭 **${kitName}** queue is empty!`, flags: 64 });
        }
        
        const kitData = GAMEMODES.find(k => k.name === kitName);
        const requiredRole = kitData?.testerRole;
        const hasRequiredRole = isAdmin || (requiredRole && member.roles.cache.some(r => r.name === requiredRole));
        
        if (!hasRequiredRole) {
            return interaction.reply({ content: `❌ You need the **${requiredRole}** role to view ${kitName} queue!`, flags: 64 });
        }
        
        let list = `**${kitName} Queue (${queue.waiting.length} waiting):**\n━━━━━━━━━━━━━━━━━━━━\n`;
        for (let i = 0; i < Math.min(queue.waiting.length, 10); i++) {
            const playerId = queue.waiting[i];
            const player = db.players[playerId];
            list += `${i+1}. ${player?.username || 'Unknown'} (<@${playerId}>)\n`;
        }
        
        await interaction.reply({ content: list, flags: 64 });
        return;
    }
    
    if (commandName === 'claim' && (isTester || isAdmin)) {
        const target = options.getMember('player');
        if (!target) return interaction.reply({ content: '❌ Player not found!', flags: 64 });
        
        let foundKit = null;
        for (const kit of GAMEMODES) {
            const queue = db.queues[kit.name];
            if (queue && queue.waiting.includes(target.id)) {
                foundKit = kit;
                break;
            }
        }
        
        if (!foundKit) {
            return interaction.reply({ content: '❌ Player is not in any queue!', flags: 64 });
        }
        
        const playerData = db.players[target.id];
        const queue = db.queues[foundKit.name];
        queue.waiting = queue.waiting.filter(id => id !== target.id);
        queue.testing.push({ userId: target.id, testerId: interaction.user.id });
        saveData();
        
        const category = guild.channels.cache.find(c => c.name === QUEUE_CATEGORY && c.type === 4);
        const testChannel = await guild.channels.create({
            name: `test-${playerData.username}-${foundKit.name}`,
            type: 0,
            parent: category,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: target.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });
        
        if (playerData.notifyOnPick !== false) {
            try {
                await target.send(`🔔 **You have been picked for testing!**\n━━━━━━━━━━━━━━━━━━━━\n**Tester:** ${interaction.user.username}\n**Kit:** ${foundKit.name}\n**Channel:** ${testChannel.url}\n\nPlease join the channel to begin your test!`);
            } catch(e) {}
        }
        
        const kitImage = db.kits[foundKit.name];
        const embed = new EmbedBuilder()
            .setColor(0x2C2F33)
            .setTitle(`${KIT_SYMBOLS[foundKit.name] || '🎮'} TEST SESSION — ${foundKit.name}`)
            .setDescription([
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `**Tester:** <@${interaction.user.id}>`,
                `**Kit:** ${foundKit.name}`,
                `**Player:** <@${target.id}>`,
                `**Region:** ${playerData.region}`,
                `**Device:** ${playerData.device}`,
                `**Current Rank:** ${playerData.rank || 'Unranked'}`,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `**Commands:**`,
                `• \`/start\` - Begin the test`,
                `• \`/done\` - Complete the test`,
                `• \`/close\` - Force close channel`
            ].join('\n'))
            .setImage(kitImage || null)
            .setFooter({ text: 'Test session • Good luck!' })
            .setTimestamp();
        
        await testChannel.send({ content: `<@${target.id}> <@${interaction.user.id}>`, embeds: [embed] });
        await updateQueueEmbed(guild, foundKit.name);
        await interaction.reply({ content: `✅ Claimed ${target.user.username} and created test channel: ${testChannel}`, flags: 64 });
        return;
    }
    
    if (commandName === 'testnow' && (isTester || isAdmin)) {
        const target = options.getMember('player');
        if (!target) return interaction.reply({ content: '❌ Player not found!', flags: 64 });
        
        const playerData = db.players[target.id];
        if (!playerData) {
            return interaction.reply({ content: '❌ Player has not applied yet! Use `/apply` first.', flags: 64 });
        }
        
        let kitName = null;
        let requiredRole = null;
        
        for (const kit of GAMEMODES) {
            const queue = db.queues[kit.name];
            if (queue && queue.waiting.includes(target.id)) {
                kitName = kit.name;
                requiredRole = kit.testerRole;
                queue.waiting = queue.waiting.filter(id => id !== target.id);
                queue.testing.push({ userId: target.id, testerId: interaction.user.id });
                saveData();
                break;
            }
        }
        
        if (!kitName) {
            return interaction.reply({ content: '❌ Player is not in any queue!', flags: 64 });
        }
        
        if (!isAdmin && requiredRole && !member.roles.cache.some(r => r.name === requiredRole)) {
            for (const kit of GAMEMODES) {
                const queue = db.queues[kit.name];
                if (queue) {
                    queue.waiting = queue.waiting.filter(id => id !== target.id);
                    queue.testing = queue.testing.filter(t => t.userId !== target.id);
                }
            }
            db.queues[kitName].waiting.push(target.id);
            saveData();
            return interaction.reply({ content: `❌ You need the **${requiredRole}** role to test ${kitName}!`, flags: 64 });
        }
        
        const category = guild.channels.cache.find(c => c.name === QUEUE_CATEGORY && c.type === 4);
        const testChannel = await guild.channels.create({
            name: `test-${playerData.username}-${kitName}`,
            type: 0,
            parent: category,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: target.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
            ]
        });
        
        if (playerData.notifyOnPick !== false) {
            try {
                await target.send(`🔔 **You have been picked for testing!**\n━━━━━━━━━━━━━━━━━━━━\n**Tester:** ${interaction.user.username}\n**Kit:** ${kitName}\n**Channel:** ${testChannel.url}\n\nPlease join the channel to begin your test!`);
            } catch(e) {}
        }
        
        const kitImage = db.kits[kitName];
        const embed = new EmbedBuilder()
            .setColor(0x2C2F33)
            .setTitle(`${KIT_SYMBOLS[kitName] || '🎮'} TEST SESSION — ${kitName}`)
            .setDescription([
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `**Tester:** <@${interaction.user.id}>`,
                `**Kit:** ${kitName}`,
                `**Player:** <@${target.id}>`,
                `**Region:** ${playerData.region}`,
                `**Device:** ${playerData.device}`,
                `**Current Rank:** ${playerData.rank || 'Unranked'}`,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `**Commands:**`,
                `• \`/start\` - Begin the test`,
                `• \`/done\` - Complete the test`,
                `• \`/close\` - Force close channel`
            ].join('\n'))
            .setImage(kitImage || null)
            .setFooter({ text: 'Test session • Good luck!' })
            .setTimestamp();
        
        await testChannel.send({ content: `<@${target.id}> <@${interaction.user.id}>`, embeds: [embed] });
        await updateQueueEmbed(guild, kitName);
        await interaction.reply({ content: `✅ Test channel created: ${testChannel}`, flags: 64 });
        return;
    }
    
    if (commandName === 'start' && (isTester || isAdmin)) {
        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('⏱️ TEST STARTED!')
            .setDescription('The test has begun. Use `/done` when finished.')
            .setTimestamp();
        
        await interaction.reply({ embeds: [embed] });
        return;
    }
    
    if (commandName === 'done' && (isTester || isAdmin)) {
        const channelName = channel.name;
        const match = channelName.match(/test-(.+)-(.+)/);
        if (!match) {
            return interaction.reply({ content: '❌ This is not a test channel!', flags: 64 });
        }
        
        const username = match[1];
        const kitName = match[2];
        let playerId = null;
        for (const [id, data] of Object.entries(db.players)) {
            if (data.username === username) {
                playerId = id;
                break;
            }
        }
        
        if (!playerId) {
            return interaction.reply({ content: '❌ Player not found!', flags: 64 });
        }
        
        await showDoneModal(interaction, playerId, username, kitName);
        return;
    }
    
    if (commandName === 'close' && (isTester || isAdmin)) {
        await interaction.reply({ content: '🔒 Closing channel in 3 seconds...', flags: 64 });
        setTimeout(() => channel.delete().catch(() => {}), 3000);
        return;
    }
    
    if (commandName === 'notes' && (isTester || isAdmin)) {
        const target = options.getMember('player');
        const note = options.getString('note');
        
        if (!db.staffNotes[target.id]) db.staffNotes[target.id] = [];
        db.staffNotes[target.id].push({
            author: interaction.user.id,
            note: note,
            date: Date.now()
        });
        saveData();
        
        await interaction.reply({ content: `✅ Note added for ${target.user.tag}`, flags: 64 });
        return;
    }
    
    if (commandName === 'warn' && (isTester || isAdmin)) {
        const target = options.getMember('player');
        const reason = options.getString('reason');
        
        if (!db.players[target.id]) {
            return interaction.reply({ content: '❌ Player not found!', flags: 64 });
        }
        
        if (!db.players[target.id].warnings) db.players[target.id].warnings = [];
        db.players[target.id].warnings.push({
            by: interaction.user.id,
            reason: reason,
            date: Date.now()
        });
        saveData();
        
        try {
            await target.send(`⚠️ **You have been warned in ${guild.name}**\n**Reason:** ${reason}\n**Staff:** ${interaction.user.tag}`);
        } catch(e) {}
        
        await interaction.reply({ content: `⚠️ Warned ${target.user.tag} | Reason: ${reason}`, flags: 64 });
        
        const logChannel = guild.channels.cache.find(c => c.name === LOG_CHANNEL);
        if (logChannel) logChannel.send(`⚠️ **${interaction.user.tag}** warned **${target.user.tag}** | ${reason}`);
        return;
    }
    
    if (commandName === 'strike' && (isTester || isAdmin)) {
        const target = options.getMember('player');
        
        if (!db.players[target.id]) {
            return interaction.reply({ content: '❌ Player not found!', flags: 64 });
        }
        
        db.players[target.id].strikes = (db.players[target.id].strikes || 0) + 1;
        
        if (db.players[target.id].strikes >= 3) {
            db.blacklist.push(target.id);
            try {
                await target.send(`🚫 **You have been blacklisted from ${guild.name}**\nReason: 3 strikes. Contact staff for appeal.`);
            } catch(e) {}
        }
        saveData();
        
        await interaction.reply({ content: `⚠️ Strike added to ${target.user.tag} (${db.players[target.id].strikes}/3)`, flags: 64 });
        return;
    }
    
    if (commandName === 'blacklist' && (isTester || isAdmin)) {
        const target = options.getMember('player');
        
        if (!db.blacklist.includes(target.id)) {
            db.blacklist.push(target.id);
            saveData();
            
            try {
                await target.send(`🚫 **You have been blacklisted from ${guild.name}**\nYou can no longer request tests. Contact staff for appeal.`);
            } catch(e) {}
        }
        
        await interaction.reply({ content: `🚫 Blacklisted ${target.user.tag}`, flags: 64 });
        return;
    }
    
    if (commandName === 'unblacklist' && (isTester || isAdmin)) {
        const target = options.getMember('player');
        
        db.blacklist = db.blacklist.filter(id => id !== target.id);
        saveData();
        
        await interaction.reply({ content: `✅ Removed ${target.user.tag} from blacklist`, flags: 64 });
        return;
    }
    
    // ==================== ADMIN COMMANDS ====================
    
    if (commandName === 'deploy' && isAdmin) {
        const kitName = options.getString('kit');
        const queueChannel = guild.channels.cache.find(c => c.name === QUEUE_CHANNEL);
        
        if (!queueChannel) {
            return interaction.reply({ content: `❌ Channel #${QUEUE_CHANNEL} not found!`, flags: 64 });
        }
        
        if (!db.queues[kitName]) db.queues[kitName] = { waiting: [], testing: [], messageId: null };
        
        const embed = new EmbedBuilder()
            .setTitle(`${KIT_SYMBOLS[kitName] || '⚔️'} ${kitName} QUEUE — Waiting: 0`)
            .setColor(0x2C2F33)
            .setDescription('Loading queue data...');
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`queue_position:${kitName}`)
                .setLabel('📍 WHERE AM I?')
                .setStyle(ButtonStyle.Secondary)
                .setEmoji('📍')
        );
        
        const message = await queueChannel.send({ embeds: [embed], components: [row] });
        db.queues[kitName].messageId = message.id;
        saveData();
        await updateQueueEmbed(guild, kitName);
        
        setInterval(async () => {
            const g = client.guilds.cache.get(GUILD_ID);
            if (g) await updateQueueEmbed(g, kitName);
        }, 60 * 60 * 1000);
        
        await interaction.reply({ content: `✅ Deployed ${kitName} queue embed in #${QUEUE_CHANNEL}!`, flags: 64 });
        return;
    }
    
    if (commandName === 'removequeue' && isAdmin) {
        const kitName = options.getString('kit');
        const queue = db.queues[kitName];
        
        if (queue && queue.messageId) {
            const queueChannel = guild.channels.cache.find(c => c.name === QUEUE_CHANNEL);
            if (queueChannel) {
                const msg = await queueChannel.messages.fetch(queue.messageId).catch(() => null);
                if (msg) await msg.delete().catch(() => {});
            }
        }
        
        delete db.queues[kitName];
        saveData();
        await interaction.reply({ content: `✅ Removed ${kitName} queue!`, flags: 64 });
        return;
    }
    
    if (commandName === 'refreshqueue' && isAdmin) {
        const kitName = options.getString('kit');
        await updateQueueEmbed(guild, kitName);
        await interaction.reply({ content: `✅ Refreshed ${kitName} queue!`, flags: 64 });
        return;
    }
    
    if (commandName === 'kit' && isAdmin) {
        const action = options.getString('action');
        const kitName = options.getString('kit');
        const image = options.getString('image');
        
        if (action === 'add') {
            if (!kitName || !image) return interaction.reply({ content: '❌ Usage: /kit add [kit] [image_url]', flags: 64 });
            db.kits[kitName] = image;
            saveData();
            await interaction.reply({ content: `✅ Kit **${kitName}** image added!`, flags: 64 });
        } else if (action === 'remove') {
            if (!kitName) return interaction.reply({ content: '❌ Usage: /kit remove [kit]', flags: 64 });
            delete db.kits[kitName];
            saveData();
            await interaction.reply({ content: `✅ Kit **${kitName}** image removed!`, flags: 64 });
        } else if (action === 'list') {
            const list = Object.keys(db.kits).join(', ') || 'No kits';
            await interaction.reply({ content: `📦 **Kit Images:**\n${list}`, flags: 64 });
        }
        return;
    }
    
    if (commandName === 'check' && (isTester || isAdmin)) {
        const target = options.getMember('player');
        const data = db.players[target.id];
        
        if (!data) {
            return interaction.reply({ content: `❌ ${target.user.tag} has not applied yet!`, flags: 64 });
        }
        
        const totalPoints = calculateTotalPoints(target.id);
        const title = getTitleFromPoints(totalPoints);
        const isBlacklisted = db.blacklist.includes(target.id);
        
        let history = '';
        for (let i = 0; i < Math.min(data.testHistory.length, 5); i++) {
            const t = data.testHistory[i];
            history += `• ${new Date(t.date).toLocaleDateString()} → ${t.kit}: ${t.rank} (+${t.pointsEarned}pts)\n`;
        }
        if (!history) history = '*No test history*';
        
        let warnings = '';
        if (data.warnings) {
            for (const w of data.warnings.slice(-3)) {
                warnings += `• ${new Date(w.date).toLocaleDateString()}: ${w.reason}\n`;
            }
        }
        if (!warnings) warnings = '*No warnings*';
        
        const embed = new EmbedBuilder()
            .setColor(isBlacklisted ? 0xE74C3C : 0x3498DB)
            .setTitle(`📊 ${target.user.tag}`)
            .setDescription([
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `**Username:** ${data.username}`,
                `**Region:** ${data.region}`,
                `**Device:** ${data.device}`,
                `**Title:** ${title.name}`,
                `**Total Points:** ${totalPoints}`,
                `**Status:** ${isBlacklisted ? '🚫 BLACKLISTED' : '✅ Active'}`,
                `**Strikes:** ${data.strikes || 0}/3`,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `**Recent Tests:**\n${history}`,
                `**Recent Warnings:**\n${warnings}`,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
            ].join('\n'));
        
        await interaction.reply({ embeds: [embed], flags: 64 });
        return;
    }
    
    if (commandName === 'forcerank' && isAdmin) {
        const target = options.getMember('player');
        const rank = options.getString('rank');
        
        await setRank(guild, target.id, rank);
        if (db.players[target.id]) db.players[target.id].rank = rank;
        saveData();
        await interaction.reply({ content: `✅ Set ${target.user.tag} to **${rank}**!`, flags: 64 });
        return;
    }
    
    if (commandName === 'setpoints' && isAdmin) {
        const target = options.getMember('player');
        const points = options.getInteger('points');
        
        if (!db.players[target.id]) {
            return interaction.reply({ content: `❌ ${target.user.tag} has not applied yet!`, flags: 64 });
        }
        
        db.players[target.id].manualPoints = points;
        await updateTitleRole(guild, target.id);
        saveData();
        await interaction.reply({ content: `✅ Set ${target.user.tag}'s points to **${points}**!`, flags: 64 });
        return;
    }
    
    if (commandName === 'reset' && isAdmin) {
        const target = options.getMember('player');
        delete db.players[target.id];
        saveData();
        
        const applicantRole = await getRole(guild, APPLICANT_ROLE);
        if (applicantRole && target.roles.cache.has(applicantRole.id)) {
            await target.roles.remove(applicantRole);
        }
        
        for (const rank of RANK_ROLES) {
            const role = await getRole(guild, rank);
            if (role && target.roles.cache.has(role.id)) await target.roles.remove(role);
        }
        
        for (const title of TITLES) {
            const role = await getRole(guild, title.role);
            if (role && target.roles.cache.has(role.id)) await target.roles.remove(role);
        }
        
        await interaction.reply({ content: `✅ Reset ${target.user.tag} completely!`, flags: 64 });
        return;
    }
    
    if (commandName === 'recalculate' && isAdmin) {
        const target = options.getMember('player');
        const points = calculateTotalPoints(target.id);
        await updateTitleRole(guild, target.id);
        await interaction.reply({ content: `✅ Recalculated ${target.user.tag}: ${points} points`, flags: 64 });
        return;
    }
    
    if (commandName === 'export' && isAdmin) {
        let csv = 'User ID,Username,Region,Device,Total Points,Rank,Strikes,Blacklisted\n';
        for (const [id, data] of Object.entries(db.players)) {
            csv += `${id},${data.username},${data.region},${data.device},${calculateTotalPoints(id)},${data.rank || 'None'},${data.strikes || 0},${db.blacklist.includes(id) ? 'Yes' : 'No'}\n`;
        }
        
        fs.writeFileSync('export.csv', csv);
        await interaction.reply({ content: '✅ Data exported!', files: [{ attachment: 'export.csv', name: 'player_data.csv' }], flags: 64 });
        fs.unlinkSync('export.csv');
        return;
    }
    
    if (commandName === 'backup' && isAdmin) {
        const backup = JSON.stringify(db, null, 2);
        fs.writeFileSync(`backup_${Date.now()}.json`, backup);
        await interaction.reply({ content: '✅ Database backup created!', flags: 64 });
        return;
    }
    
    if (commandName === 'announce' && isAdmin) {
        const message = options.getString('message');
        const testerRole = await getRole(guild, 'Tester');
        
        if (testerRole) {
            const channel = guild.channels.cache.find(c => c.name === TESTER_PANEL_CHANNEL);
            if (channel) {
                await channel.send({ content: `${testerRole.toString()}`, embeds: [
                    new EmbedBuilder()
                        .setColor(0xF1C40F)
                        .setTitle('📢 ANNOUNCEMENT')
                        .setDescription(message)
                        .setTimestamp()
                ] });
            }
        }
        
        await interaction.reply({ content: '✅ Announcement sent!', flags: 64 });
        return;
    }
    
    if (commandName === 'audit' && isAdmin) {
        const target = options.getMember('player');
        const notes = db.staffNotes[target.id] || [];
        
        let auditText = '';
        for (const note of notes.slice(-10)) {
            auditText += `• ${new Date(note.date).toLocaleString()} - <@${note.author}>: ${note.note}\n`;
        }
        if (!auditText) auditText = '*No staff notes*';
        
        const embed = new EmbedBuilder()
            .setColor(0xE67E22)
            .setTitle(`📋 Audit Log: ${target.user.tag}`)
            .setDescription(auditText);
        
        await interaction.reply({ embeds: [embed], flags: 64 });
        return;
    }
    
    if (commandName === 'setcooldown' && isAdmin) {
        const minutes = options.getInteger('minutes');
        db.settings.cooldown = minutes;
        saveData();
        await interaction.reply({ content: `✅ Request cooldown set to ${minutes} minutes!`, flags: 64 });
        return;
    }
    
    if (commandName === 'maxqueue' && isAdmin) {
        const kit = options.getString('kit');
        const size = options.getInteger('size');
        db.settings.maxQueueSize = size;
        saveData();
        await interaction.reply({ content: `✅ Max queue size for ${kit} set to ${size}!`, flags: 64 });
        return;
    }
    
    if (commandName === 'help') {
        await showHelp(interaction);
        return;
    }
});

// ==================== ERROR HANDLERS ====================
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

client.login(TOKEN);