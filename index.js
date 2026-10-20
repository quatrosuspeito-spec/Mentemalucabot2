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
const TELEGRAM_TOKEN = '8892332641:AAG2DP__BuXnXp9-XE50jWP0i8j4yGfyHEo';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const mutedUsers = new Set();
const delegatedOwners = new Set();
let autoIaActive = false;

let tgBot = null;
if (TELEGRAM_TOKEN) {
    tgBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
    console.log('🤖 Telegram Bot ativado!');
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
        tgBot.onText(/\/conectar (.+)/, async (msg, match) => {
            const chatId = msg.chat.id;
            let phone = match[1].replace(/[^0-9]/g, '');
            if (!phone) {
                return tgBot.sendMessage(chatId, '❌ Formato inválido. Use: /conectar 258856868102');
            }
            try {
                await delay(2000);
                const code = await sock.requestPairingCode(phone);
                tgBot.sendMessage(chatId, `🔮 *MENTEMALUCA BOT*\n\n📱 Número: +${phone}\n🔑 Seu Código de Pareamento WhatsApp:\n\n\`${code}\`\n\nIntroduza este código no seu WhatsApp!`, { parse_mode: 'Markdown' });
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
        const senderClean = sender.split('@')[0];

        const isOwner = senderClean.includes(OWNER_NUMBER) || delegatedOwners.has(senderClean);

        if (mutedUsers.has(senderClean)) {
            try { await sock.sendMessage(from, { delete: msg.key }); } catch (e) {}
            return;
        }

        const body = msg.message.conversation ||
                     msg.message.extendedTextMessage?.text ||
                     msg.message.imageMessage?.caption ||
                     msg.message.videoMessage?.caption || '';

        if (!body.startsWith(PREFIX) && !body.startsWith('@')) return;

        const args = body.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift()?.toLowerCase();

        if (command === 'ping') {
            return sock.sendMessage(from, { text: '🟢 Status: *Online Pro*' });
        }

        if (command === 'menu') {
  const menuTexto = "╔══════════════════════════════════╗\n" +
                    "║  🔮 𝕄𝔼ℕ𝕋𝔼𝕄𝔸𝕃𝕌ℂ𝔸 𝔹𝕆𝕋 🔮  ║\n" +
                    "║       ✦ 𝑏𝑜𝑡 𝑑𝑜 𝑑𝑜𝑛𝑜 ✦       ║\n" +
                    "╠══════════════════════════════════╣\n" +
                    "╚══════════════════════════════════╝\n\n" +
                    "𝕀ℕ𝔽𝕆ℝ𝕄𝔸Ç𝔸̃𝕆 𝔾𝔼ℝ𝔸𝕃\n" +
                    "  🟢 Status: *Online*\n" +
                    "  👑 Dono: *+258856868102*\n" +
                    "  🤖 Versão: *2.0 Pro*\n" +
                    "  🔑 Prefixo: *€*\n\n" +
                    "━━━ 👑 𝔽𝕌ℕÇ𝕆̃𝔼𝕊 𝔻𝕆 𝔻𝕆ℕ𝕆 (só dono) ━━━\n" +
                    "│ 💣 *€nuke* — Remove todos os membros\n" +
                    "│ 🔇 *€silenciar @num* — Silencia um membro\n" +
                    "│ 🔉 *€dessilenciar @num* — Dessilencia o membro\n" +
                    "│ 🔓 *€abrir* — Abre o grupo para todos\n" +
                    "│ 🔒 *€fechar* — Fecha o grupo (só admins)\n" +
                    "│ ⭐ *€promover @num* — Promove a admin\n" +
                    "│ ⬇️ *€rebaixar @num* — Remove admin\n" +
                    "│ 🚫 *€ban @num* — Banir membro do grupo\n" +
                    "│ 🔗 *€link* — Obtém link de convite\n" +
                    "│ 🧹 *€limpar* — Limpa o chat atual\n\n" +
                    "━━━ 🍑 𝕄Í𝔻𝕀𝔸 𝙋ℝ𝕀𝕍𝔸𝔻𝔸 ━━━\n" +
                    "│ 🍑 *€viewonce* — Revela view once\n" +
                    "│ 🥹 *€salvar* — Guarda mídia citada\n\n" +
                    "━━━ 🤖 𝕀ℕ𝕋𝔼𝕃𝕀𝔾𝔼̂ℕℂ𝕀𝔸 𝔸ℝ𝕋𝕀𝔽𝕀ℂ𝕀𝔸𝕃 ━━━\n" +
                    "│ 🤖 *€ia [pergunta]* — Pergunta à IA\n" +
                    "│ 😇 *€ia auto* — Liga IA automática\n" +
                    "│ 🛑 *€ia desligar* — Desliga a IA\n\n" +
                    "━━━ 🎵 𝔻𝕆𝕎ℕ𝕃𝕆𝔸𝔻𝕊 ━━━\n" +
                    "│ 🎵 *€baixar música [nome]* — Baixa MP3\n" +
                    "│ 🎬 *€baixar vídeo [nome]* — Baixa vídeo\n" +
                    "│ 📷 *€baixar foto [nome]* — Busca foto\n\n" +
                    "━━━ 🎭 𝕄Í𝔻𝕀𝔸 / 𝔼𝔽𝔼𝕀𝕋𝕆𝕊 ━━━\n" +
                    "│ 🎭 *€sticker* — Cria figurinhas\n" +
                    "│ 🎙️ *€áudio [texto]* — Fala com voz\n" +
                    "│ 😎 *€perfil @Pessoa* — Mostra perfil\n\n" +
                    "━━━ 🎮 𝕌𝕋𝕀𝕃𝕀𝕋Á𝕊 ━━━\n" +
                    "│ 🎮 *€quiz* — Quiz interativo\n" +
                    "│ 🧩 *€charada* — Jogo de charadas\n" +
                    "│ 🌍 *€hora* — Hora em vários países\n" +
                    "│ 🏓 *€ping* — Status e latência\n" +
                    "│ 📋 *€menu* — Abre este menu\n\n" +
                    "╔══════════════════════════════════╗\n" +
                    "║  ⚡ 🟢 𝕄𝔼ℕ𝕋𝔼𝕄𝔸𝕃𝕌ℂ𝔸 𝕆ℕ𝕃𝕀ℕ𝔼 ⚡  ║\n" +
                    "╚══════════════════════════════════╝";

  return sock.sendMessage(from, { text: menuTexto }, { quoted: msg });
}

      
  


startBot();
