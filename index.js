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

// Rank roles (order matters for auto-update)
const RANK_ROLES = ['LT5', 'LT4', 'LT3', 'LT2', 'LT1', 'HT5', 'HT4', 'HT3', 'HT2', 'HT1'];

// Gamemodes/Kits with their corresponding tester role names
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
    queueMessages: {}
};

const DATA_FILE = 'tierbot.json';
if (fs.existsSync(DATA_FILE)) {
    try { db = JSON.parse(fs.readFileSync(DATA_FILE)); } catch(e) {}
}
function saveData() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }

// ==================== ROLE HELPERS ====================
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
    
    if (db.players[userId]) {
        db.players[userId].rank = newRank;
        saveData();
    }
    return true;
}

// Get kit name from object
function getKitName(kitObj) {
    return typeof kitObj === 'object' ? kitObj.name : kitObj;
}

// ==================== QUEUE EMBED ====================
async function updateQueueEmbed(guild, kitObj) {
    const kitName = getKitName(kitObj);
    const queue = db.queues[kitName];
    if (!queue || !queue.messageId) return;
    
    const channel = await guild.channels.fetch(QUEUE_CHANNEL).catch(() => null);
    if (!channel) return;
    
    const waitingList = queue.waiting || [];
    const testingList = queue.testing || [];
    
    // Get active testers for this specific kit
    const kitData = GAMEMODES.find(k => k.name === kitName);
    const testerRoleName = kitData?.testerRole;
    const testerRole = testerRoleName ? await getRole(guild, testerRoleName) : null;
    const activeTesters = testerRole ? testerRole.members.map(m => `<@${m.id}>`).join(', ') : 'None';
    
    let waitingText = '';
    for (let i = 0; i < waitingList.length; i++) {
        const playerId = waitingList[i];
        const player = db.players[playerId];
        const member = await guild.members.fetch(playerId).catch(() => null);
        waitingText += `${i+1}. **${player?.username || 'Unknown'}** (${member ? `<@${playerId}>` : 'Unknown'})\n`;
    }
    if (waitingText === '') waitingText = '*No players waiting*';
    
    let testingText = '';
    for (const test of testingList) {
        const player = db.players[test.userId];
        const member = await guild.members.fetch(test.userId).catch(() => null);
        testingText += `• **${player?.username || 'Unknown'}** — tested by <@${test.testerId}>\n`;
    }
    if (testingText === '') testingText = '*No active tests*';
    
    const embed = new EmbedBuilder()
        .setTitle(`⚔️ ${kitName} QUEUE — Waiting: ${waitingList.length}`)
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

async function saveQueueMessage(kit, messageId) {
    if (!db.queues[kit]) db.queues[kit] = { waiting: [], testing: [], messageId: null };
    db.queues[kit].messageId = messageId;
    saveData();
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
        .setPlaceholder('Enter your Minecraft username (Bedrock)');
    
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

async function showDoneModal(interaction, playerId, playerName) {
    const modal = new ModalBuilder()
        .setCustomId(`done_modal:${playerId}`)
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
        { name: 'apply', description: 'Apply to become a Combat Learner' },
        { name: 'request', description: 'Request a test for a specific gamemode' },
        { name: 'cancel', description: 'Cancel your pending test request' },
        { name: 'position', description: 'Check your position in queues' },
        { name: 'queue', description: 'View waiting queue for a kit', options: [{ name: 'kit', type: 3, required: true, choices: kitChoices }] },
        { name: 'testnow', description: 'Start a test with a player', options: [{ name: 'player', type: 6, required: true }] },
        { name: 'start', description: 'Start the test timer (use in test channel)' },
        { name: 'done', description: 'Complete the current test' },
        { name: 'close', description: 'Force close the test channel' },
        { name: 'deploy', description: '[Staff] Deploy queue embed for a kit', options: [{ name: 'kit', type: 3, required: true, choices: kitChoices }] },
        { name: 'removequeue', description: '[Staff] Remove queue embed for a kit', options: [{ name: 'kit', type: 3, required: true, choices: kitChoices }] },
        { name: 'refreshqueue', description: '[Staff] Manually refresh queue embed', options: [{ name: 'kit', type: 3, required: true, choices: kitChoices }] },
        { name: 'kit', description: '[Admin] Manage kits', options: [
            { name: 'action', type: 3, required: true, choices: [{ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }, { name: 'list', value: 'list' }] },
            { name: 'name', type: 3, required: false },
            { name: 'image', type: 3, required: false }
        ] },
        { name: 'check', description: '[Staff] Check player info', options: [{ name: 'player', type: 6, required: true }] },
        { name: 'forcerank', description: '[Admin] Force change player rank', options: [{ name: 'player', type: 6, required: true }, { name: 'rank', type: 3, required: true, choices: RANK_ROLES.map(r => ({ name: r, value: r })) }] },
        { name: 'reset', description: '[Admin] Reset player completely', options: [{ name: 'player', type: 6, required: true }] },
        { name: 'help', description: 'Show all commands' }
    ];
    
    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Commands registered');
}

// ==================== READY ====================
client.once('ready', async () => {
    console.log(`✅ Tier Bot logged in as ${client.user.tag}`);
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return console.error('❌ Guild not found!');
    
    await registerCommands();
    
    // Log available tester roles
    console.log('\n📋 Detected Tester Roles:');
    for (const kit of GAMEMODES) {
        const role = await getRole(guild, kit.testerRole);
        console.log(`   ${kit.name}: ${role ? '✅ ' + kit.testerRole : '❌ Missing - create role "' + kit.testerRole + '"'}`);
    }
    
    for (const kit of GAMEMODES) {
        if (db.queues[kit.name] && db.queues[kit.name].messageId) {
            setInterval(async () => {
                const g = client.guilds.cache.get(GUILD_ID);
                if (g) await updateQueueEmbed(g, kit.name);
            }, 60 * 60 * 1000);
        }
    }
    
    console.log(`\n✅ Ready! | ${GAMEMODES.length} gamemodes loaded`);
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
                appliedAt: Date.now(),
                testHistory: []
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
            const playerId = interaction.customId.split(':')[1];
            const rank = interaction.fields.getTextInputValue('rank').toUpperCase();
            const score = interaction.fields.getTextInputValue('score');
            const notes = interaction.fields.getTextInputValue('notes') || 'No notes';
            
            const player = db.players[playerId];
            if (!player) {
                return interaction.reply({ content: '❌ Player not found!', flags: 64 });
            }
            
            const previousRank = player.rank || 'Unranked';
            await setRank(interaction.guild, playerId, rank);
            
            player.testHistory.push({
                tester: interaction.user.id,
                rank: rank,
                score: score,
                notes: notes,
                date: Date.now()
            });
            saveData();
            
            const resultsChannel = interaction.guild.channels.cache.find(c => c.name === RESULTS_CHANNEL);
            const resultsEmbed = new EmbedBuilder()
                .setColor(rank.startsWith('HT') ? 0x9B59B6 : 0x3498DB)
                .setTitle(`🎉 ${player.username}'s Test Results`)
                .setDescription([
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                    `**Tester:** <@${interaction.user.id}>`,
                    `**Region:** ${player.region}`,
                    `**Username:** ${player.username}`,
                    `**Score:** ${score}`,
                    `**Previous Rank:** ${previousRank}`,
                    `**Rank Earned:** ${rank} ${rank !== previousRank ? '🆙' : ''}`,
                    `**Notes:** ${notes}`,
                    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
                ].join('\n'))
                .setFooter({ text: `Test completed by ${interaction.user.username}` })
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
            
            await interaction.reply({ content: `✅ Test completed! ${player.username} is now ${rank}`, flags: 64 });
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
        
        if (!db.queues[kitName]) db.queues[kitName] = { waiting: [], testing: [], messageId: null };
        
        if (db.queues[kitName].waiting.includes(interaction.user.id)) {
            return interaction.reply({ content: '❌ You are already in this queue!', flags: 64 });
        }
        
        db.queues[kitName].waiting.push(interaction.user.id);
        saveData();
        
        await updateQueueEmbed(interaction.guild, kitName);
        await interaction.reply({ content: `✅ Added to **${kitName}** queue at position #${db.queues[kitName].waiting.length}!`, flags: 64 });
        return;
    }
    
    // Slash Commands
    if (!interaction.isChatInputCommand()) return;
    
    const { commandName, options, member, guild, channel } = interaction;
    const isAdmin = member.permissions.has(PermissionsBitField.Flags.Administrator);
    
    // Check if user is tester for a specific kit (has ANY tester role)
    const isTester = isAdmin || member.roles.cache.some(r => r.name.endsWith('Tester'));
    
    // Player Commands
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
    
    // Tester Commands (only if has tester role or admin)
    if (!isTester && !isAdmin && ['queue', 'testnow', 'start', 'done', 'close', 'check'].includes(commandName)) {
        return interaction.reply({ content: '❌ You need a **Tester** role to use this command!', flags: 64 });
    }
    
    if (commandName === 'queue' && (isTester || isAdmin)) {
        const kitName = options.getString('kit');
        const queue = db.queues[kitName];
        
        if (!queue || queue.waiting.length === 0) {
            return interaction.reply({ content: `📭 **${kitName}** queue is empty!`, flags: 64 });
        }
        
        // Check if tester has the required role for this kit (unless admin)
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
        
        // Check if tester has required role (unless admin)
        if (!isAdmin && requiredRole && !member.roles.cache.some(r => r.name === requiredRole)) {
            // Put player back in queue
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
        
        const kitImage = db.kits[kitName];
        const embed = new EmbedBuilder()
            .setColor(0x2C2F33)
            .setTitle(`🎮 TEST SESSION — ${kitName}`)
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
        const match = channelName.match(/test-(.+)-/);
        if (!match) {
            return interaction.reply({ content: '❌ This is not a test channel!', flags: 64 });
        }
        
        const username = match[1];
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
        
        await showDoneModal(interaction, playerId, username);
        return;
    }
    
    if (commandName === 'close' && (isTester || isAdmin)) {
        await interaction.reply({ content: '🔒 Closing channel in 3 seconds...', flags: 64 });
        setTimeout(() => channel.delete().catch(() => {}), 3000);
        return;
    }
    
    // Admin/Staff Commands
    if (commandName === 'deploy' && isAdmin) {
        const kitName = options.getString('kit');
        const queueChannel = guild.channels.cache.find(c => c.name === QUEUE_CHANNEL);
        
        if (!queueChannel) {
            return interaction.reply({ content: `❌ Channel #${QUEUE_CHANNEL} not found!`, flags: 64 });
        }
        
        if (!db.queues[kitName]) db.queues[kitName] = { waiting: [], testing: [], messageId: null };
        
        const embed = new EmbedBuilder()
            .setTitle(`⚔️ ${kitName} QUEUE — Waiting: 0`)
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
        const name = options.getString('name');
        const image = options.getString('image');
        
        if (action === 'add') {
            if (!name || !image) return interaction.reply({ content: '❌ Usage: /kit add [name] [image_url]', flags: 64 });
            db.kits[name] = image;
            saveData();
            await interaction.reply({ content: `✅ Kit **${name}** added!`, flags: 64 });
        } else if (action === 'remove') {
            if (!name) return interaction.reply({ content: '❌ Usage: /kit remove [name]', flags: 64 });
            delete db.kits[name];
            saveData();
            await interaction.reply({ content: `✅ Kit **${name}** removed!`, flags: 64 });
        } else if (action === 'list') {
            const list = Object.keys(db.kits).join(', ') || 'No kits';
            await interaction.reply({ content: `📦 **Available Kits:**\n${list}`, flags: 64 });
        }
        return;
    }
    
    if (commandName === 'check' && (isTester || isAdmin)) {
        const target = options.getMember('player');
        const data = db.players[target.id];
        
        if (!data) {
            return interaction.reply({ content: `❌ ${target.user.tag} has not applied yet!`, flags: 64 });
        }
        
        let history = '';
        for (let i = 0; i < Math.min(data.testHistory.length, 5); i++) {
            const t = data.testHistory[i];
            history += `• ${new Date(t.date).toLocaleDateString()} → **${t.rank}** (${t.score}) - ${t.notes.substring(0, 50)}\n`;
        }
        if (!history) history = '*No test history*';
        
        const embed = new EmbedBuilder()
            .setColor(0x3498DB)
            .setTitle(`📊 ${target.user.tag}`)
            .setDescription([
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `**Username:** ${data.username}`,
                `**Region:** ${data.region}`,
                `**Device:** ${data.device}`,
                `**Current Rank:** ${data.rank || 'Unranked'}`,
                `**Applied:** ${new Date(data.appliedAt).toLocaleDateString()}`,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `**Recent Tests:**\n${history}`,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
            ].join('\n'));
        
        await interaction.reply({ embeds: [embed], flags: 64 });
        return;
    }
    
    if (commandName === 'forcerank' && isAdmin) {
        const target = options.getMember('player');
        const rank = options.getString('rank');
        
        await setRank(guild, target.id, rank);
        await interaction.reply({ content: `✅ Set ${target.user.tag} to **${rank}**!`, flags: 64 });
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
        
        await interaction.reply({ content: `✅ Reset ${target.user.tag} completely!`, flags: 64 });
        return;
    }
    
    if (commandName === 'help') {
        const embed = new EmbedBuilder()
            .setColor(0x2ECC71)
            .setTitle('📋 Tier Bot Commands')
            .setDescription([
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
                `**👤 Player Commands:**`,
                `\`/apply\` - Apply as Combat Learner`,
                `\`/request\` - Request a test`,
                `\`/cancel\` - Cancel queue request`,
                `\`/position\` - Check queue position`,
                ``,
                `**🎮 Tester Commands:**`,
                `\`/queue [kit]\` - View waiting queue`,
                `\`/testnow @player\` - Start test`,
                `\`/start\` - Begin test timer`,
                `\`/done\` - Complete test`,
                `\`/close\` - Force close channel`,
                ``,
                `**⚙️ Admin Commands:**`,
                `\`/deploy queue [kit]\` - Deploy queue embed`,
                `\`/removequeue [kit]\` - Remove queue`,
                `\`/refreshqueue [kit]\` - Refresh queue`,
                `\`/kit add/remove/list\` - Manage kits`,
                `\`/check @user\` - Lookup player`,
                `\`/forcerank @user [rank]\` - Force rank`,
                `\`/reset @user\` - Reset player`,
                `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
            ].join('\n'));
        
        await interaction.reply({ embeds: [embed], flags: 64 });
        return;
    }
});

// ==================== ERROR HANDLERS ====================
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);

client.login(TOKEN);