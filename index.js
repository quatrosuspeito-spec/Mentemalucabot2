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
const googleTTS = require('google-tts-api');
require('dotenv').config();

const PREFIX = process.env.BOT_PREFIX || '€';
let OWNER_NUMBER = process.env.OWNER_NUMBER || '258856868102';

// Token fixo e direto para evitar qualquer erro de leitura
const TELEGRAM_TOKEN = '8892332641:AAFL7pp9MiEggo6ztp2tuT1l4Wuovc5X6Ec';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const mutedUsers = new Set();
const delegatedOwners = new Set();

const quizDatabase = [
    {
        pergunta: "Qual é a capital de Moçambique?",
        opcoes: "A) Beira\nB) Maputo\nC) Nampula\nD) Pemba",
        resposta: "B"
    },
    {
        pergunta: "Qual é o planeta mais próximo do Sol?",
        opcoes: "A) Vénus\nB) Terra\nC) Mercúrio\nD) Marte",
        resposta: "C"
    },
    {
        pergunta: "Quanto é 15 x 4?",
        opcoes: "A) 50\nB) 60\nC) 70\nD) 80",
        resposta: "B"
    }
];

let activeQuiz = {};

let tgBot = null;
try {
    tgBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
    console.log('🤖 Telegram Bot ativado com sucesso!');

    tgBot.on('polling_error', (err) => {
        // Ignora erros menores de polling para não sujar os logs
    });
} catch (e) {
    console.log('⚠️ Erro ao iniciar Telegram:', e.message);
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
            if (!phone) {
                return tgBot.sendMessage(chatId, '❌ Formato inválido. Use: /conectar 258856868102');
            }
            try {
                if (sock.authState?.creds?.registered) {
                    return tgBot.sendMessage(chatId, '⚠️ O WhatsApp já está conectado nesta sessão!');
                }

                await delay(2000);
                const code = await sock.requestPairingCode(phone);
                
                tgBot.sendMessage(chatId, `🔮 *MENTEMALUCA BOT*\n\n📱 Número: +${phone}\n🔑 Seu Código de Pareamento WhatsApp:\n\n\`${code}\`\n\nIntroduza este código no seu WhatsApp imediatamente!`, { parse_mode: 'Markdown' });
            } catch (err) {
                tgBot.sendMessage(chatId, `❌ Erro ao gerar código: ${err.message}`);
            }
        });
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Conexão fechada. Reconectando...', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('⚡ 🟢 MENTEMALUCA BOT ONLINE COM SUCESSO! ⚡');
            if (TELEGRAM_CHAT_ID && tgBot) {
                tgBot.sendMessage(TELEGRAM_CHAT_ID, '⚡ 🟢 MENTEMALUCA BOT ESTÁ ONLINE NO WHATSAPP! ⚡');
            }
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
        
        const isOwner = senderClean.includes(OWNER_NUMBER) || msg.key.fromMe || delegatedOwners.has(senderClean);

        if (mutedUsers.has(senderClean)) {
            try { await sock.sendMessage(from, { delete: msg.key }); } catch (e) {}
            return;
        }

        const body = (msg.message.conversation ||
                     msg.message.extendedTextMessage?.text ||
                     msg.message.imageMessage?.caption ||
                     msg.message.videoMessage?.caption || '').trim();

        if (activeQuiz[from] && ['A', 'B', 'C', 'D'].includes(body.toUpperCase())) {
            const quizAtual = activeQuiz[from];
            if (body.toUpperCase() === quizAtual.resposta) {
                await sock.sendMessage(from, { text: `🎉 *CORRETO!* A resposta era a letra *${quizAtual.resposta}*.` }, { quoted: msg });
            } else {
                await sock.sendMessage(from, { text: `❌ *ERRADO!* A resposta correta era a letra *${quizAtual.resposta}*.` }, { quoted: msg });
            }
            delete activeQuiz[from];
            return;
        }

        if (!body.startsWith(PREFIX)) return;

        const args = body.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift()?.toLowerCase();

        if (command === 'menu') {
            const menuTexto = [
                "╔══════════════════════════════════╗",
                "║  🔮 𝕄𝔼ℕ𝕋𝔼𝕄𝔸𝕃𝕌ℂ𝔸 𝔹𝕆𝕋 🔮  ║",
                "║       ✦ 𝑏𝑜𝑡 𝑑𝑜 𝑑𝑜𝑛𝑜 ✦       ║",
                "╠══════════════════════════════════╣",
                "╚══════════════════════════════════╝",
                "",
                "𝕀ℕ𝔽𝕆ℝ𝕄𝔸Ç𝔸̃𝕆 𝔾𝔼ℝ𝔸𝕃",
                "  🟢 Status: *Online*",
                "  👑 Dono: *+258856868102*",
                "  🤖 Versão: *2.0 Pro*",
                "  🔑 Prefixo: *€*",
                "",
                "━━━ 👑 𝔽𝕌ℕÇ𝕆̃𝔼𝕊 𝔻𝕆 𝔻𝕆ℕ𝕆 (só dono) ━━━",
                "│ 💣 *€nuke* — Remove todos os membros",
                "│ 🔇 *€silenciar @num* — Silencia um membro",
                "│ 🔉 *€dessilenciar @num* — Dessilencia o membro",
                "│ 🔓 *€abrir* — Abre o grupo para todos",
                "│ 🔒 *€fechar* — Fecha o grupo (só admins)",
                "│ ⭐ *€promover @num* — Promove a admin",
                "│ ⬇️ *€rebaixar @num* — Remove admin",
                "│ 🚫 *€ban @num* — Banir membro do grupo",
                "│ 🔗 *€link* — Obtém link de convite",
                "│ 🧹 *€limpar* — Limpa o chat atual",
                "",
                "━━━ 🍑 𝕄Í𝔻𝕀𝔸 𝙋ℝ𝕀𝕍𝔸𝔻𝔸 ━━━",
                "│ 🍑 *€viewonce* — Revela view once",
                "│ 🥹 *€salvar* — Guarda mídia citada",
                "",
                "━━━ 🤖 𝕀ℕ𝕋𝔼𝕃𝕀𝔾𝔼̂ℕℂ𝕀𝔸 𝔸ℝ𝕋𝕀𝔽𝕀ℂ𝕀𝔸𝕃 ━━━",
                "│ 🤖 *€ia [pergunta]* — Pergunta à IA",
                "│ 😇 *€ia auto* — Liga IA automática",
                "│ 🛑 *€ia desligar* — Desliga a IA",
                "",
                "━━━ 🎵 𝔻𝕆𝕎ℕ𝕃𝕆𝔸𝔻𝕊 ━━━",
                "│ 🎵 *€baixar música [nome]* — Baixa MP3",
                "│
