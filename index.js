const { Client, GatewayIntentBits, REST, Routes, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.GuildMembers] });

const TOKEN = process.env.TIER_TEST_TOKEN;
const CLIENT_ID = process.env.TIER_CLIENT_ID;
const GUILD_ID = process.env.TIER_GUILD_ID;

// ==================== DATA STORES ====================
let testQueue = {};
let activeTests = {};
let testResults = [];
let testCooldown = {};
let testerStats = {};
let pendingRankSelections = {};

// ==================== KITS CONFIGURATION ====================
const GAMEMODES = ['hydro', 'smp', 'diapot', 'noaxe', 'axe', 'uhc', 'elytramace', 'nethpot', 'crystal', 'spearmace'];

const KIT_NAMES = {
    hydro: '💧 Hydro', smp: '🌍 SMP', diapot: '💎 Diapot', noaxe: '🪓 No Axe', axe: '⚔️ Axe',
    uhc: '🏹 UHC', elytramace: '🦅 Elytra Mace', nethpot: '🧪 NethPot', crystal: '💥 Crystal', spearmace: '🔱 Spear Mace'
};

const KIT_EMOJIS = {
    hydro: '💧', smp: '🌍', diapot: '💎', noaxe: '🪓', axe: '⚔️',
    uhc: '🏹', elytramace: '🦅', nethpot: '🧪', crystal: '💥', spearmace: '🔱'
};

// Available ranks from LT5 (lowest) to HT1 (highest)
const RANKS = [
    { name: 'LT5', emoji: '🪖', level: 1, description: 'Beginner - Needs significant improvement' },
    { name: 'LT4', emoji: '🪖', level: 2, description: 'Novice - Basic understanding' },
    { name: 'LT3', emoji: '🪖', level: 3, description: 'Apprentice - Decent skills' },
    { name: 'LT2', emoji: '🪖', level: 4, description: 'Intermediate - Good player' },
    { name: 'LT1', emoji: '🪖', level: 5, description: 'Advanced - Very good player' },
    { name: 'HT5', emoji: '🎖️', level: 6, description: 'Expert - Excellent performance' },
    { name: 'HT4', emoji: '🎖️', level: 7, description: 'Master - Pro level' },
    { name: 'HT3', emoji: '🎖️', level: 8, description: 'Grandmaster - Very pro' },
    { name: 'HT2', emoji: '🎖️', level: 9, description: 'Elite - Top tier' },
    { name: 'HT1', emoji: '🎖️', level: 10, description: 'Legend - Best of the best' }
];

const RANK_BY_LEVEL = Object.fromEntries(RANKS.map(r => [r.level, r]));

function suggestRank(answers) {
    let score = 0;
    
    // Defeated tester? Big boost
    if (answers.defeated === 'yes') score += 4;
    else if (answers.defeated === 'close') score += 2;
    
    // Movement & game sense
    if (answers.movement === 'excellent') score += 3;
    else if (answers.movement === 'good') score += 2;
    else if (answers.movement === 'average') score += 1;
    
    // Aim & mechanics
    if (answers.aim === 'excellent') score += 3;
    else if (answers.aim === 'good') score += 2;
    else if (answers.aim === 'average') score += 1;
    
    // Overall rating (1-10)
    const overall = parseInt(answers.overall) || 5;
    score += Math.floor(overall / 2);
    
    // Map score to rank level (1-10)
    let level = Math.min(10, Math.max(1, Math.floor(score / 1.5)));
    
    return RANK_BY_LEVEL[level] || RANKS[0];
}

// ==================== HELPER FUNCTIONS ====================
async function isTester(member) {
    return member.roles.cache.some(r => r.name === 'Tester') || member.permissions.has('Administrator');
}

async function canTest(member) {
    const daysInServer = (Date.now() - member.joinedTimestamp) / (1000 * 60 * 60 * 24);
    return daysInServer >= 7;
}

async function createTestChannel(guild, playerId, testerId, kit) {
    let category = guild.channels.cache.find(c => c.name === '🧪｜TESTING' && c.type === 4);
    if (!category) {
        category = await guild.channels.create({
            name: '🧪｜TESTING',
            type: 4,
            permissionOverwrites: [{ id: guild.id, deny: ['ViewChannel'] }]
        });
    }
    const channel = await guild.channels.create({
        name: `test-${kit}-${playerId.slice(-4)}`,
        type: 0,
        parent: category.id,
        permissionOverwrites: [
            { id: guild.id, deny: ['ViewChannel'] },
            { id: playerId, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] },
            { id: testerId, allow: ['ViewChannel', 'SendMessages', 'ReadMessageHistory'] }
        ]
    });
    activeTests[channel.id] = { playerId, testerId, kit, startTime: Date.now() };
    return channel;
}

function checkCollusion(playerId, testerId) {
    return testResults.filter(r =>
        (r.testerId === testerId && r.playerId === playerId) ||
        (r.testerId === playerId && r.playerId === testerId)
    ).length;
}

function logToStaffChannel(guild, message) {
    const logChannel = guild.channels.cache.find(c => c.name === '🔒｜staff-logs');
    if (logChannel) logChannel.send(message).catch(() => {});
}

// ==================== COMMAND REGISTRATION ====================
client.once('ready', async () => {
    console.log(`✅ Tier Test Bot logged in as ${client.user.tag}`);
    await registerCommands();
    console.log('✅ Commands registered');
    console.log(`📊 Loaded ${testResults.length} test results`);
});

async function registerCommands() {
    const commands = [
        {
            name: 'test',
            description: 'Join, leave, or check test queue status',
            options: [
                {
                    name: 'action',
                    type: 3,
                    required: true,
                    description: 'What to do',
                    choices: [
                        { name: 'join', value: 'join' },
                        { name: 'leave', value: 'leave' },
                        { name: 'status', value: 'status' }
                    ]
                },
                {
                    name: 'kit',
                    type: 3,
                    required: false,
                    description: 'Kit to test (required for join)',
                    choices: GAMEMODES.map(k => ({ name: KIT_NAMES[k], value: k }))
                }
            ]
        },
        {
            name: 'testnext',
            description: '[Tester] Take next player from queue (any or specific kit)',
            options: [{
                name: 'kit',
                type: 3,
                required: false,
                description: 'Specific kit (optional)',
                choices: GAMEMODES.map(k => ({ name: KIT_NAMES[k], value: k }))
            }]
        },
        {
            name: 'testlist',
            description: '[Tester] Show clickable list of players waiting for a kit',
            options: [{
                name: 'kit',
                type: 3,
                required: true,
                description: 'Kit to view',
                choices: GAMEMODES.map(k => ({ name: KIT_NAMES[k], value: k }))
            }]
        },
        {
            name: 'testselect',
            description: '[Tester] Select a specific player from queue',
            options: [
                { name: 'player', type: 6, required: true, description: 'Player to test' },
                { name: 'kit', type: 3, required: true, description: 'Kit to test', choices: GAMEMODES.map(k => ({ name: KIT_NAMES[k], value: k })) }
            ]
        },
        {
            name: 'testresult',
            description: '[Tester] Submit results for active test (use in test channel)'
        },
        {
            name: 'testhistory',
            description: '[Tester] View test history of a player',
            options: [{ name: 'player', type: 6, required: true, description: 'Player to view' }]
        },
        {
            name: 'teststats',
            description: '[Tester] Show current queue sizes and stats'
        },
        {
            name: 'testcancel',
            description: '[Tester] Remove a player from queue',
            options: [
                { name: 'player', type: 6, required: true, description: 'Player to remove' },
                { name: 'kit', type: 3, required: true, description: 'Kit', choices: GAMEMODES.map(k => ({ name: KIT_NAMES[k], value: k })) }
            ]
        },
        {
            name: 'testerstats',
            description: '[Tester] View tester leaderboard (most tests conducted)'
        }
    ];

    const rest = new REST({ version: '10' }).setToken(TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
}

// ==================== COMMAND HANDLERS ====================
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // ========== PLAYER: /test ==========
    if (interaction.commandName === 'test') {
        const action = interaction.options.getString('action');
        const userId = interaction.user.id;

        if (action === 'join') {
            const kit = interaction.options.getString('kit');
            if (!kit) {
                return interaction.reply({
                    content: `❌ Please specify a kit.\nAvailable: ${GAMEMODES.map(k => KIT_NAMES[k]).join(', ')}`,
                    ephemeral: true
                });
            }
            if (!GAMEMODES.includes(kit)) {
                return interaction.reply({ content: '❌ Invalid kit.', ephemeral: true });
            }

            const cooldownKey = `${userId}_${kit}`;
            if (testCooldown[cooldownKey] && Date.now() - testCooldown[cooldownKey] < 6 * 60 * 60 * 1000) {
                const remaining = Math.ceil((6 * 60 * 60 * 1000 - (Date.now() - testCooldown[cooldownKey])) / (60 * 60 * 1000));
                return interaction.reply({ content: `❌ You can only request a test every 6 hours. ${remaining} hour(s) remaining.`, ephemeral: true });
            }

            let already = false;
            for (let k in testQueue) {
                if (testQueue[k]?.includes(userId)) {
                    already = true;
                    break;
                }
            }
            if (already) {
                return interaction.reply({ content: '❌ You are already in a queue. Use `/test leave` first.', ephemeral: true });
            }

            if (!testQueue[kit]) testQueue[kit] = [];
            testQueue[kit].push(userId);
            const position = testQueue[kit].length;

            await interaction.reply({
                content: `✅ Joined **${KIT_NAMES[kit]}** test queue. Position: ${position}\n⏳ You will be notified when a tester picks you.`,
                ephemeral: true
            });
        }
        else if (action === 'leave') {
            let removed = false;
            let removedFrom = null;
            for (let k in testQueue) {
                const idx = testQueue[k]?.indexOf(userId);
                if (idx !== -1) {
                    testQueue[k].splice(idx, 1);
                    removed = true;
                    removedFrom = k;
                    break;
                }
            }
            await interaction.reply({
                content: removed ? `✅ Left **${KIT_NAMES[removedFrom]}** queue.` : '❌ You are not in any queue.',
                ephemeral: true
            });
        }
        else if (action === 'status') {
            let msg = `**📋 Your test queue status**\n━━━━━━━━━━━━━━━━━━━━\n`;
            let inQueue = false;
            for (let k in testQueue) {
                const idx = testQueue[k]?.indexOf(userId);
                if (idx !== -1) {
                    msg += `\n${KIT_EMOJIS[k]} **${KIT_NAMES[k]}**: position ${idx + 1}`;
                    inQueue = true;
                }
            }
            if (!inQueue) {
                msg = '📭 You are not in any test queue.\nUse `/test join <kit>` to request a test.';
            }
            await interaction.reply({ content: msg, ephemeral: true });
        }
    }

    // ========== TESTER PERMISSION CHECK ==========
    const testerCommands = ['testnext', 'testlist', 'testselect', 'testresult', 'testhistory', 'teststats', 'testcancel', 'testerstats'];
    if (testerCommands.includes(interaction.commandName)) {
        if (!await isTester(interaction.member)) {
            return interaction.reply({ content: '❌ Only members with the `Tester` role can use this command.', ephemeral: true });
        }
        if (!await canTest(interaction.member)) {
            return interaction.reply({ content: '❌ Testers must be in the server for at least 7 days before conducting tests.', ephemeral: true });
        }
    }

    // ========== TESTER: /testnext ==========
    if (interaction.commandName === 'testnext') {
        const specificKit = interaction.options.getString('kit');
        let selectedKit = null;
        let selectedPlayer = null;

        if (specificKit) {
            if (testQueue[specificKit]?.length > 0) {
                selectedKit = specificKit;
                selectedPlayer = testQueue[specificKit].shift();
            }
        } else {
            for (let kit in testQueue) {
                if (testQueue[kit]?.length > 0) {
                    selectedKit = kit;
                    selectedPlayer = testQueue[kit].shift();
                    break;
                }
            }
        }

        if (!selectedPlayer) {
            return interaction.reply({
                content: `📭 No players in ${specificKit ? KIT_NAMES[specificKit] : 'any'} queue.`,
                ephemeral: true
            });
        }

        if (selectedPlayer === interaction.user.id) {
            if (!testQueue[selectedKit]) testQueue[selectedKit] = [];
            testQueue[selectedKit].unshift(selectedPlayer);
            return interaction.reply({ content: '❌ You cannot test yourself.', ephemeral: true });
        }

        const collusionCount = checkCollusion(selectedPlayer, interaction.user.id);
        if (collusionCount >= 2) {
            logToStaffChannel(interaction.guild, `⚠️ **Collusion Warning**: <@${interaction.user.id}> and <@${selectedPlayer}> have tested each other ${collusionCount + 1} times.`);
        }

        const channel = await createTestChannel(interaction.guild, selectedPlayer, interaction.user.id, selectedKit);
        await channel.send({
            content: `**🔍 TIER TEST STARTED**\n━━━━━━━━━━━━━━━━━━━━\n${KIT_EMOJIS[selectedKit]} **Kit:** ${KIT_NAMES[selectedKit]}\n👤 **Player:** <@${selectedPlayer}>\n👤 **Tester:** <@${interaction.user.id}>\n🕒 **Start:** <t:${Math.floor(Date.now() / 1000)}:F>\n━━━━━━━━━━━━━━━━━━━━\nConduct the test match. When finished, use \`/testresult\` in this channel.`
        });
        await channel.send(`<@${selectedPlayer}> <@${interaction.user.id}>`);
        await interaction.reply({ content: `✅ Test started with <@${selectedPlayer}>. Private channel created.`, ephemeral: true });
    }

    // ========== TESTER: /testlist ==========
    if (interaction.commandName === 'testlist') {
        const kit = interaction.options.getString('kit');
        const queue = testQueue[kit] || [];

        if (queue.length === 0) {
            return interaction.reply({ content: `📭 No players waiting for **${KIT_NAMES[kit]}**.`, ephemeral: true });
        }

        const players = [];
        for (let i = 0; i < Math.min(queue.length, 25); i++) {
            const playerId = queue[i];
            let name = `Player ${i + 1}`;
            try {
                const user = await client.users.fetch(playerId);
                name = user.username;
            } catch (e) { }
            players.push({ id: playerId, name, position: i + 1 });
        }

        const embed = new EmbedBuilder()
            .setColor(0x00FF00)
            .setTitle(`${KIT_EMOJIS[kit]} ${KIT_NAMES[kit]} Test Queue`)
            .setDescription(`**${queue.length} player(s) waiting**\n━━━━━━━━━━━━━━━━━━━━\n${players.map(p => `**${p.position}.** ${p.name}`).join('\n')}`)
            .setFooter({ text: 'Click a button below to test that player' });

        const rows = [];
        let currentRow = new ActionRowBuilder();
        let buttonCount = 0;

        for (const player of players) {
            if (buttonCount === 5) {
                rows.push(currentRow);
                currentRow = new ActionRowBuilder();
                buttonCount = 0;
            }
            currentRow.addComponents(
                new ButtonBuilder()
                    .setCustomId(`test_${kit}_${player.id}`)
                    .setLabel(`${player.position}. ${player.name.slice(0, 20)}`)
                    .setStyle(ButtonStyle.Primary)
            );
            buttonCount++;
        }
        if (buttonCount > 0) rows.push(currentRow);

        await interaction.reply({ embeds: [embed], components: rows, ephemeral: true });
    }

    // ========== TESTER: /testselect ==========
    if (interaction.commandName === 'testselect') {
        const targetPlayer = interaction.options.getUser('player');
        const kit = interaction.options.getString('kit');

        if (!testQueue[kit] || !testQueue[kit].includes(targetPlayer.id)) {
            return interaction.reply({ content: `❌ ${targetPlayer.username} is not in ${KIT_NAMES[kit]} queue.`, ephemeral: true });
        }

        if (targetPlayer.id === interaction.user.id) {
            return interaction.reply({ content: '❌ You cannot test yourself.', ephemeral: true });
        }

        testQueue[kit] = testQueue[kit].filter(id => id !== targetPlayer.id);

        const channel = await createTestChannel(interaction.guild, targetPlayer.id, interaction.user.id, kit);
        await channel.send({
            content: `**🔍 TIER TEST STARTED**\n━━━━━━━━━━━━━━━━━━━━\n${KIT_EMOJIS[kit]} **Kit:** ${KIT_NAMES[kit]}\n👤 **Player:** ${targetPlayer.tag}\n👤 **Tester:** <@${interaction.user.id}>\n🕒 **Start:** <t:${Math.floor(Date.now() / 1000)}:F>\n━━━━━━━━━━━━━━━━━━━━\nUse \`/testresult\` when done.`
        });
        await channel.send(`<@${targetPlayer.id}> <@${interaction.user.id}>`);
        await interaction.reply({ content: `✅ Test started with ${targetPlayer.username}.`, ephemeral: true });
    }

    // ========== TESTER: /testresult (First Modal - Assessment) ==========
    if (interaction.commandName === 'testresult') {
        const channelId = interaction.channelId;
        if (!activeTests[channelId]) {
            return interaction.reply({ content: '❌ This is not an active test channel.', ephemeral: true });
        }

        const modal = new ModalBuilder()
            .setCustomId('playerAssessmentModal')
            .setTitle('Player Skill Assessment');

        const defeatedInput = new TextInputBuilder()
            .setCustomId('defeated')
            .setLabel('Did the player defeat you? (yes/close/no)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('yes, close, or no');

        const movementInput = new TextInputBuilder()
            .setCustomId('movement')
            .setLabel('Movement & game sense? (poor/average/good/excellent)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('poor, average, good, or excellent');

        const aimInput = new TextInputBuilder()
            .setCustomId('aim')
            .setLabel('Aim & mechanics? (poor/average/good/excellent)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('poor, average, good, or excellent');

        const overallInput = new TextInputBuilder()
            .setCustomId('overall')
            .setLabel('Overall rating (1-10)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('1 = very poor, 10 = exceptional');

        modal.addComponents(
            new ActionRowBuilder().addComponents(defeatedInput),
            new ActionRowBuilder().addComponents(movementInput),
            new ActionRowBuilder().addComponents(aimInput),
            new ActionRowBuilder().addComponents(overallInput)
        );
        await interaction.showModal(modal);
    }

    // ========== TESTER: /testhistory ==========
    if (interaction.commandName === 'testhistory') {
        const target = interaction.options.getUser('player');
        const playerResults = testResults.filter(r => r.playerId === target.id);

        if (playerResults.length === 0) {
            return interaction.reply({ content: `📭 No test history found for ${target.username}.`, ephemeral: true });
        }

        let msg = `**📜 TEST HISTORY FOR ${target.username.toUpperCase()}**\n━━━━━━━━━━━━━━━━━━━━\n**Total Tests:** ${playerResults.length}\n\n**Recent Tests:**\n`;
        playerResults.slice(-5).reverse().forEach(r => {
            msg += `\n${KIT_EMOJIS[r.kit]} **${KIT_NAMES[r.kit]}** | Rank: **${r.rank}**\n📅 ${new Date(r.date).toLocaleString()} | Tester: <@${r.testerId}>\n📝 Notes: ${r.notes || 'None'}\n━━━━━━━━━━━━━━━━━━━━`;
        });

        await interaction.reply({ content: msg, ephemeral: true });
    }

    // ========== TESTER: /teststats ==========
    if (interaction.commandName === 'teststats') {
        let msg = '**📊 TEST QUEUE STATS**\n━━━━━━━━━━━━━━━━━━━━\n';
        let any = false;
        let total = 0;

        for (let kit of GAMEMODES) {
            const count = testQueue[kit]?.length || 0;
            if (count > 0) {
                any = true;
                total += count;
                msg += `\n${KIT_EMOJIS[kit]} **${KIT_NAMES[kit]}**: ${count} waiting`;
            }
        }

        if (!any) {
            msg += '\n📭 No players currently in any queue.';
        } else {
            msg += `\n━━━━━━━━━━━━━━━━━━━━\n**Total waiting:** ${total}`;
        }

        const totalTests = testResults.length;
        const uniquePlayers = new Set(testResults.map(r => r.playerId)).size;
        msg += `\n\n**📈 Overall Stats:**\n━━━━━━━━━━━━━━━━━━━━\n**Total Tests Conducted:** ${totalTests}\n**Unique Players Tested:** ${uniquePlayers}`;

        await interaction.reply({ content: msg, ephemeral: true });
    }

    // ========== TESTER: /testcancel ==========
    if (interaction.commandName === 'testcancel') {
        const target = interaction.options.getUser('player');
        const kit = interaction.options.getString('kit');

        if (!testQueue[kit] || !testQueue[kit].includes(target.id)) {
            return interaction.reply({ content: `❌ ${target.username} is not in ${KIT_NAMES[kit]} queue.`, ephemeral: true });
        }

        testQueue[kit] = testQueue[kit].filter(id => id !== target.id);
        await interaction.reply({ content: `✅ Removed ${target.username} from ${KIT_NAMES[kit]} queue.`, ephemeral: true });
        logToStaffChannel(interaction.guild, `🛠️ **${interaction.user.tag}** removed ${target.tag} from ${KIT_NAMES[kit]} queue.`);
    }

    // ========== TESTER: /testerstats ==========
    if (interaction.commandName === 'testerstats') {
        const testerCounts = {};
        testResults.forEach(r => {
            testerCounts[r.testerId] = (testerCounts[r.testerId] || 0) + 1;
        });

        const sorted = Object.entries(testerCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

        if (sorted.length === 0) {
            return interaction.reply({ content: '📭 No tests have been conducted yet.', ephemeral: true });
        }

        let msg = '**🏆 TESTER LEADERBOARD**\n━━━━━━━━━━━━━━━━━━━━\n';
        let rank = 1;
        for (const [id, count] of sorted) {
            let name = id;
            try {
                const user = await client.users.fetch(id);
                name = user.username;
            } catch (e) { }
            const medal = rank === 1 ? '👑 ' : rank === 2 ? '🥈 ' : rank === 3 ? '🥉 ' : '';
            msg += `\n**${rank}.** ${medal}${name} — ${count} test${count !== 1 ? 's' : ''}`;
            rank++;
        }

        await interaction.reply({ content: msg, ephemeral: true });
    }
});

// ==================== BUTTON HANDLER ====================
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('test_')) return;

    if (!await isTester(interaction.member)) {
        return interaction.reply({ content: '❌ Only testers can do this.', ephemeral: true });
    }
    if (!await canTest(interaction.member)) {
        return interaction.reply({ content: '❌ Testers must be in the server for at least 7 days.', ephemeral: true });
    }

    const parts = interaction.customId.split('_');
    const kit = parts[1];
    const playerId = parts[2];

    if (playerId === interaction.user.id) {
        return interaction.reply({ content: '❌ You cannot test yourself.', ephemeral: true });
    }

    if (!testQueue[kit] || !testQueue[kit].includes(playerId)) {
        return interaction.reply({ content: '❌ This player is no longer in the queue.', ephemeral: true });
    }

    testQueue[kit] = testQueue[kit].filter(id => id !== playerId);

    await interaction.reply({ content: `✅ Starting test with <@${playerId}> for **${KIT_NAMES[kit]}**...`, ephemeral: true });

    const channel = await createTestChannel(interaction.guild, playerId, interaction.user.id, kit);
    await channel.send({
        content: `**🔍 TIER TEST STARTED**\n━━━━━━━━━━━━━━━━━━━━\n${KIT_EMOJIS[kit]} **Kit:** ${KIT_NAMES[kit]}\n👤 **Player:** <@${playerId}>\n👤 **Tester:** <@${interaction.user.id}>\n🕒 **Start:** <t:${Math.floor(Date.now() / 1000)}:F>\n━━━━━━━━━━━━━━━━━━━━\nUse \`/testresult\` when done.`
    });
    await channel.send(`<@${playerId}> <@${interaction.user.id}>`);
});

// ==================== FIRST MODAL HANDLER (Assessment) ====================
client.on('interactionCreate', async interaction => {
    if (!interaction.isModalSubmit()) return;
    if (interaction.customId !== 'playerAssessmentModal') return;

    const testData = activeTests[interaction.channelId];
    if (!testData) {
        return interaction.reply({ content: '❌ This test session has expired.', ephemeral: true });
    }

    const defeated = interaction.fields.getTextInputValue('defeated').toLowerCase();
    const movement = interaction.fields.getTextInputValue('movement').toLowerCase();
    const aim = interaction.fields.getTextInputValue('aim').toLowerCase();
    const overall = interaction.fields.getTextInputValue('overall');

    // Validate inputs
    if (!['yes', 'close', 'no'].includes(defeated)) {
        return interaction.reply({ content: '❌ Invalid value for "defeated". Use yes, close, or no.', ephemeral: true });
    }
    if (!['poor', 'average', 'good', 'excellent'].includes(movement)) {
        return interaction.reply({ content: '❌ Invalid value for movement. Use poor, average, good, or excellent.', ephemeral: true });
    }
    if (!['poor', 'average', 'good', 'excellent'].includes(aim)) {
        return interaction.reply({ content: '❌ Invalid value for aim. Use poor, average, good, or excellent.', ephemeral: true });
    }
    if (isNaN(parseInt(overall)) || parseInt(overall) < 1 || parseInt(overall) > 10) {
        return interaction.reply({ content: '❌ Overall rating must be a number between 1 and 10.', ephemeral: true });
    }

    const answers = { defeated, movement, aim, overall: parseInt(overall) };
    const suggestedRank = suggestRank(answers);

    // Store answers temporarily
    pendingRankSelections[interaction.channelId] = {
        testData,
        answers,
        suggestedRank
    };

    // Create rank selection dropdown
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('rankSelect')
        .setPlaceholder(`Suggested: ${suggestedRank.emoji} ${suggestedRank.name} - ${suggestedRank.description}`)
        .addOptions(RANKS.map(rank => ({
            label: `${rank.emoji} ${rank.name}`,
            description: rank.description,
            value: rank.name
        })));

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await interaction.reply({
        content: `**📊 Player Assessment Summary**\n━━━━━━━━━━━━━━━━━━━━\n🏆 Defeated tester: ${defeated}\n🎯 Movement: ${movement}\n🔫 Aim: ${aim}\n⭐ Overall: ${overall}/10\n━━━━━━━━━━━━━━━━━━━━\n**Suggested Rank:** ${suggestedRank.emoji} ${suggestedRank.name}\n\nSelect the final rank to assign to the player:`,
        components: [row],
        ephemeral: true
    });
});

// ==================== RANK SELECTION HANDLER ====================
client.on('interactionCreate', async interaction => {
    if (!interaction.isStringSelectMenu()) return;
    if (interaction.customId !== 'rankSelect') return;

    const selectedRankName = interaction.values[0];
    const selectedRank = RANKS.find(r => r.name === selectedRankName);
    if (!selectedRank) return;

    const pending = pendingRankSelections[interaction.channelId];
    if (!pending) {
        return interaction.reply({ content: '❌ Session expired. Please run /testresult again.', ephemeral: true });
    }

    const { testData, answers, suggestedRank } = pending;
    delete pendingRankSelections[interaction.channelId];

    const result = {
        playerId: testData.playerId,
        testerId: testData.testerId,
        kit: testData.kit,
        rank: selectedRank.name,
        rankEmoji: selectedRank.emoji,
        answers: answers,
        suggestedRank: suggestedRank.name,
        notes: '',
        date: new Date().toISOString()
    };
    testResults.push(result);

    // Update cooldown
    testCooldown[`${testData.playerId}_${testData.kit}`] = Date.now();

    // Update tester stats
    testerStats[testData.testerId] = (testerStats[testData.testerId] || 0) + 1;

    // Collusion check
    const collusionCount = checkCollusion(testData.playerId, testData.testerId);
    if (collusionCount >= 2) {
        logToStaffChannel(interaction.guild, `⚠️ **Collusion Detected**: <@${testData.testerId}> and <@${testData.playerId}> have tested each other ${collusionCount} times.`);
    }

    // Post to public results channel
    const publicChannel = interaction.guild.channels.cache.find(c => c.name === '📜｜test-results');
    if (publicChannel) {
        const embed = new EmbedBuilder()
            .setColor(selectedRank.level >= 8 ? 0xFFD700 : selectedRank.level >= 6 ? 0xC0C0C0 : 0xCD7F32)
            .setTitle(`${KIT_EMOJIS[testData.kit]} New Test Result`)
            .addFields(
                { name: 'Player', value: `<@${testData.playerId}>`, inline: true },
                { name: 'Kit', value: KIT_NAMES[testData.kit], inline: true },
                { name: 'Assigned Rank', value: `${selectedRank.emoji} ${selectedRank.name}`, inline: true },
                { name: 'Defeated Tester?', value: answers.defeated, inline: true },
                { name: 'Movement', value: answers.movement, inline: true },
                { name: 'Aim', value: answers.aim, inline: true },
                { name: 'Overall Rating', value: `${answers.overall}/10`, inline: true },
                { name: 'Tester', value: `<@${testData.testerId}>`, inline: true }
            )
            .setFooter({ text: suggestedRank.name !== selectedRank.name ? `⚠️ Tester overrode suggested rank (${suggestedRank.emoji} ${suggestedRank.name})` : `Rank matches assessment` })
            .setTimestamp();
        await publicChannel.send({ embeds: [embed] });
    }

    // Log to staff channel
    logToStaffChannel(interaction.guild, `📝 **Test Completed**\n${KIT_NAMES[testData.kit]} | Rank: ${selectedRank.emoji} ${selectedRank.name}\nPlayer: <@${testData.playerId}> | Tester: <@${testData.testerId}>`);

    // Send result in test channel
    await interaction.channel.send({
        content: `✅ **TEST COMPLETE**\n━━━━━━━━━━━━━━━━━━━━\n${KIT_EMOJIS[testData.kit]} **Kit:** ${KIT_NAMES[testData.kit]}\n${selectedRank.emoji} **Assigned Rank:** ${selectedRank.name}\n━━━━━━━━━━━━━━━━━━━━\n**Assessment:**\n🏆 Defeated tester: ${answers.defeated}\n🎯 Movement: ${answers.movement}\n🔫 Aim: ${answers.aim}\n⭐ Overall: ${answers.overall}/10\n━━━━━━━━━━━━━━━━━━━━\n🔒 This channel will close in 15 seconds.`
    });

    // Lock channel
    await interaction.channel.permissionOverwrites.edit(testData.playerId, { SendMessages: false });
    await interaction.channel.permissionOverwrites.edit(testData.testerId, { SendMessages: false });

    // Delete after 15 seconds
    setTimeout(() => {
        interaction.channel.delete().catch(() => {});
        delete activeTests[interaction.channelId];
    }, 15000);

    await interaction.reply({ content: `✅ Result recorded! **${selectedRank.emoji} ${selectedRank.name}** assigned to <@${testData.playerId}>.`, ephemeral: true });
});

// ==================== ERROR HANDLING ====================
process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

client.login(TOKEN);
