const http = require('http');
http.createServer((req, res) => res.end('Bot Online')).listen(process.env.PORT || 3000);

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    delay
} = require('@whiskeysockets/baileys');
const TelegramBot = require('node-telegram-bot-api');
const pino = require('pino');
const axios = require('axios');
require('dotenv').config();

const PREFIX = process.env.BOT_PREFIX || '€';
const OWNER_NUMBER = '258856868102';
const TELEGRAM_TOKEN = '8892332641:AAFL7pp9MiEggo6ztp2tuT1l4Wuovc5X6Ec';

const mutedUsers = new Set();
const quizDatabase = [
    { pergunta: "Qual é a capital de Moçambique?", opcoes: "A) Beira\nB) Maputo\nC) Nampula\nD) Pemba", resposta: "B" },
    { pergunta: "Qual é o planeta mais próximo do Sol?", opcoes: "A) Vénus\nB) Terra\nC) Mercúrio\nD) Marte", resposta: "C" },
    { pergunta: "Quanto é 15 x 4?", opcoes: "A) 50\nB) 60\nC) 70\nD) 80", resposta: "B" }
];
let activeQuiz = {};

let tgBot = null;
try {
    tgBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
    console.log('🤖 Telegram Bot ativado com sucesso!');
    tgBot.on('polling_error', () => {});
} catch (e) {
    console.log('⚠️ Erro no Telegram:', e.message);
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        generateHighQualityLinkPreview: true
    });

    sock.ev.on('creds.update', saveCreds);

    if (tgBot) {
        tgBot.removeAllListeners('text');
        tgBot.onText(/\/conectar (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            let phone = match[1].replace(/[^0-9]/g, '');
            if (!phone) return tgBot.sendMessage(chatId, '❌ Use: /conectar 258856868102');
            try {
                if (sock.authState?.creds?.registered) {
                    return tgBot.sendMessage(chatId, '⚠️ O WhatsApp já está conectado!');
                }
                await delay(2000);
                const code = await sock.requestPairingCode(phone);
                tgBot.sendMessage(chatId, `🔮 *MENTEMALUCA BOT*\n\n📱 Número: +${phone}\n🔑 Código de Pareamento:\n\n\`${code}\`\n\nIntroduza no WhatsApp!`, { parse_mode: 'Markdown' });
            } catch (err) {
                tgBot.sendMessage(chatId, `❌ Erro: ${err.message}`);
            }
        });
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('⚡ 🟢 MENTEMALUCA BOT ONLINE COM SUCESSO! ⚡');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');
        const sender = msg.key.participant || from;
        const senderClean = sender.replace(/[^0-9]/g, '');
        const isOwner = senderClean.includes(OWNER_NUMBER) || msg.key.fromMe;

        if (mutedUsers.has(senderClean)) {
            try { await sock.sendMessage(from, { delete: msg.key }); } catch (e) {}
            return;
        }

        const body = (msg.message.conversation ||
                     msg.message.extendedTextMessage?.text ||
                     msg.message.imageMessage?.caption || '').trim();

        if (activeQuiz[from] && ['A', 'B', 'C', 'D'].includes(body.toUpperCase())) {
            const q = activeQuiz[from];
            if (body.toUpperCase() === q.resposta) {
                await sock.sendMessage(from, { text: `🎉 *CORRETO!* A resposta era *${q.resposta}*.` }, { quoted: msg });
            } else {
                await sock.sendMessage(from, { text: `❌ *ERRADO!* A resposta era *${q.resposta}*.` }, { quoted: msg });
            }
            delete activeQuiz[from];
            return;
        }

        if (!body.startsWith(PREFIX)) return;
        const args = body.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift()?.toLowerCase();

        if (command === 'menu') {
            const menu = [
                "╔═══════════════════════════════╗",
                "║  🔮 𝕄𝔼ℕ𝕋𝔼𝕄𝔸𝕃𝕌ℂ𝔸 𝔹𝕆𝕋 2.0 🔮  ║",
                "╠═══════════════════════════════╣",
                "│ 📋 *€menu* — Mostra este menu",
                "│ 🏓 *€ping* — Testa a latência",
                "│ 🎮 *€quiz* — Inicia um quiz",
                "│ 💣 *€nuke* — Remove membros (Dono)",
                "│ 🚫 *€ban @membro* — Bane do grupo",
                "│ 🔗 *€link* — Link de convite",
                "│ 🔓 *€abrir* / 🔒 *€fechar* grupo",
                "│ 🌍 *€hora* — Hora atual",
                "╚═══════════════════════════════╝"
            ].join("\n");
            return sock.sendMessage(from, { text: menu }, { quoted: msg });
        }

        if (command === 'ping') {
            return sock.sendMessage(from, { text: '🏓 Pong! Bot operacional.' }, { quoted: msg });
        }

        if (command === 'quiz') {
            const q = quizDatabase[Math.floor(Math.random() * quizDatabase.length)];
            activeQuiz[from] = q;
            return sock.sendMessage(from, { text: `🎮 *QUIZ*\n\n${q.pergunta}\n\n${q.opcoes}\n\n👉 Responda com A, B, C ou D!` }, { quoted: msg });
        }

        if (command === 'nuke') {
            if (!isGroup || !isOwner) return;
            try {
                const meta = await sock.groupMetadata(from);
                const targets = meta.participants.filter(p => !p.admin && !p.id.includes(OWNER_NUMBER)).map(p => p.id);
                for (let t of targets) {
                    await sock.groupParticipantsUpdate(from, [t], 'remove');
                    await delay(1000);
                }
                return sock.sendMessage(from, { text: '💥 Nuke concluído!' });
            } catch (e) {
                return sock.sendMessage(from, { text: '❌ O bot precisa de ser Administrador.' });
            }
        }

        if (command === 'ban') {
            if (!isGroup || !isOwner) return;
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (mentioned.length > 0) {
                await sock.groupParticipantsUpdate(from, mentioned, 'remove');
                return sock.sendMessage(from, { text: '🚫 Membro banido!' }, { quoted: msg });
            }
        }

        if (command === 'link') {
            if (!isGroup) return;
            try {
                const code = await sock.groupInviteCode(from);
                return sock.sendMessage(from, { text: `🔗 https://chat.whatsapp.com/${code}` }, { quoted: msg });
            } catch (e) {}
        }

        if (command === 'abrir' && isGroup && isOwner) {
            await sock.groupSettingUpdate(from, 'not_announcement');
            return sock.sendMessage(from, { text: '🔓 Grupo aberto!' }, { quoted: msg });
        }

        if (command === 'fechar' && isGroup && isOwner) {
            await sock.groupSettingUpdate(from, 'announcement');
            return sock.sendMessage(from, { text: '🔒 Grupo fechado!' }, { quoted: msg });
        }

        if (command === 'hora') {
            const hora = new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' });
            return sock.sendMessage(from, { text: `🌍 Hora: *${hora}*` }, { quoted: msg });
        }
    });
}

startBot();
