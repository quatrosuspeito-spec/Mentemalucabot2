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
require('dotenv').config();

const PREFIX = process.env.BOT_PREFIX || '€';
const OWNER_NUMBER = '258856868102';
const TELEGRAM_TOKEN = '8892332641:AAFL7pp9MiEggo6ztp2tuT1l4Wuovc5X6Ec';

// Inicialização forçada limpando webhooks pendentes
const tgBot = new TelegramBot(TELEGRAM_TOKEN, { polling: { interval: 300, autoStart: true } });

tgBot.deleteWebHook().then(() => {
    console.log('🤖 Webhooks limpos. Telegram Bot em modo Polling ativo!');
});

tgBot.on('polling_error', (err) => {
    // Silencia erros menores de rede para evitar poluição
});

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

    // Ouvinte direto de mensagens do Telegram
    tgBot.on('message', async (msg) => {
        try {
            const chatId = msg.chat.id;
            const text = (msg.text || '').trim();

            console.log(`📩 Mensagem recebida no Telegram de ${chatId}: ${text}`);

            if (text.startsWith('/conectar') || text.startsWith('/start')) {
                const parts = text.split(' ');
                let phone = parts[1] ? parts[1].replace(/[^0-9]/g, '') : '258856868102';

                if (sock.authState?.creds?.registered) {
                    return tgBot.sendMessage(chatId, '⚠️ O WhatsApp já está conectado nesta sessão!');
                }

                await delay(1000);
                const code = await sock.requestPairingCode(phone);
                await tgBot.sendMessage(chatId, `🔮 *MENTEMALUCA BOT*\n\n📱 Número: +${phone}\n🔑 Seu Código de Pareamento:\n\n\`${code}\`\n\nIntroduza este código no seu WhatsApp imediatamente!`, { parse_mode: 'Markdown' });
                console.log('✅ Código de pareamento enviado com sucesso para o Telegram!');
            }
        } catch (err) {
            console.log('❌ Erro ao processar mensagem do Telegram:', err.message);
        }
    });

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

        const body = (msg.message.conversation ||
                     msg.message.extendedTextMessage?.text ||
                     msg.message.imageMessage?.caption || '').trim();

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
                "│ 🌍 *€hora* — Hora atual",
                "╚═══════════════════════════════╝"
            ].join("\n");
            return sock.sendMessage(from, { text: menu }, { quoted: msg });
        }

        if (command === 'ping') {
            return sock.sendMessage(from, { text: '🏓 Pong! Bot operacional.' }, { quoted: msg });
        }
    });
}

startBot();
