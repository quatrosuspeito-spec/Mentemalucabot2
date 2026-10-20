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
    const agora = new Date();
    const dataFormatada = agora.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' });
    const horaFormatada = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const menuTexto = `╔══════════════════════════════════╗
║  🔮 𝕄𝔼ℕ𝕋𝔼𝕄𝔸𝕃𝕌ℂ𝔸 𝔹𝕆𝕋 🔮  ║
║       ✦ 𝑏𝑜𝑡 𝑑𝑜 𝑑𝑜𝑛𝑜 ✦       ║
╠══════════════════════════════════╣
║  🕒 ${horaFormatada}  │  📅 ${dataFormatada}
╚══════════════════════════════════╝

𝕀ℕ𝔽𝕆ℝ𝕄𝔸Ç𝔸̃𝕆 𝔾𝔼ℝ𝔸𝕃
  🟢 Status: *𝙊𝙣𝙡𝙞𝙣𝙚*
  👑 Dono: *+258856868102*
  🤖 Versão: *𝟚.𝟘 𝙋𝙧𝙤*
  🔑 Prefixo: *€*

━━━ 👑 𝔽𝕌ℕÇ𝕆̃𝔼𝕊 𝔻𝕆 𝔻𝕆ℕ𝕆 (só dono) ━━━
│ 💣 *€nuke* — 𝑅𝑒𝑚𝑜𝑣𝑒 𝑡𝑜𝑑𝑜𝑠 𝑜𝑠 𝑚𝑒𝑚𝑏𝑟𝑜𝑠 𝑑𝑜 𝑔𝑟𝑢𝑝𝑜
│ 🔇 *€silenciar @num* — 𝑆𝑖𝑙𝑒𝑛𝑐𝑖𝑎 𝑢𝑚 𝑚𝑒𝑚𝑏𝑟𝑜 (𝑎𝑝𝑎𝑔𝑎 𝑚𝑠𝑔𝑠)
│ 🔉 *€dessilenciar @num* — 𝐷𝑒𝑠𝑠𝑖𝑙𝑒𝑛𝑐𝑖𝑎 𝑜 𝑚𝑒𝑚𝑏𝑟𝑜
│ 🔓 *€abrir* — 𝐴𝑏𝑟𝑒 𝑜 𝑔𝑟𝑢𝑝𝑜 𝑝𝑎𝑟𝑎 𝑡𝑜𝑑𝑜𝑠
│ 🔒 *€fechar* — 𝐹𝑒𝑐ℎ𝑎 𝑜 𝑔𝑟𝑢𝑝𝑜 (𝑠ó 𝑎𝑑𝑚𝑖𝑛𝑠 𝑓𝑎𝑙𝑎𝑚)
│ ⭐ *€promover @num* — 𝑃𝑟𝑜𝑚𝑜𝑣𝑒 𝑎 𝑎𝑑𝑚𝑖𝑛 𝑑𝑜 𝑔𝑟𝑢𝑝𝑜
│ ⬇️ *€rebaixar @num* — 𝑅𝑒𝑚𝑜𝑣𝑒 𝑎𝑑𝑚𝑖𝑛 𝑑𝑜 𝑔𝑟𝑢𝑝𝑜
│ 🚫 *€ban @num* — 𝐵𝑎𝑛𝑖𝑟 𝑚𝑒𝑚𝑏𝑟𝑜 𝑑𝑜 𝑔𝑟𝑢𝑝𝑜
│ 🔗 *€link* — 𝑂𝑏𝑡é𝑚 𝑙𝑖𝑛𝑘 𝑑𝑒 𝑐𝑜𝑛𝑣𝑖𝑡𝑒 𝑑𝑜 𝑔𝑟𝑢𝑝𝑜
│ 🧹 *€limpar* — 𝐿𝑖𝑚𝑝𝑎 𝑜 𝑐ℎ𝑎𝑡 𝑎𝑐𝑡𝑢𝑎𝑙
│ 🧹 *€limpar [número]* — 𝐿𝑖𝑚𝑝𝑎 𝑎 𝑐𝑜𝑛𝑣𝑒𝑟𝑠𝑎 𝑑𝑜 𝑛ú𝑚𝑒𝑟𝑜
│ 🧹 *€limpar todos* — 𝐿𝑖𝑚𝑝𝑎 𝑎𝑠 𝑐𝑜𝑛𝑣𝑒𝑟𝑠𝑎𝑠 𝑐𝑜𝑛ℎ𝑒𝑐𝑖𝑑𝑎𝑠
│ 👥 *@Pessoa* — 𝑑á 𝑎𝑐𝑒𝑠𝑠𝑜 𝑎𝑜𝑠 𝑐𝑜𝑚𝑎𝑛𝑑𝑜𝑠 𝑑𝑜 𝑑𝑜𝑛𝑜
│ 🛑 *@Pessoa cancelar* — 𝑟𝑒𝑚𝑜𝑣𝑒 𝑒𝑠𝑠𝑒 𝑎𝑐𝑒𝑠𝑠𝑜

━━━ 🍑 𝕄Í𝔻𝕀𝔸 𝙋ℝ𝕀𝕍𝔸𝔻𝔸 ━━━
│ 🍑 *€viewonce* — 𝑅𝑒𝑣𝑒𝑙𝑎 𝑓𝑜𝑡𝑜/𝑣í𝑑𝑒𝑜/á𝑢𝑑𝑖𝑜 𝑣𝑖𝑒𝑤 𝑜𝑛𝑐𝑒
│ 🥹 *€salvar* — 𝐺𝑢𝑎𝑟𝑑𝑎 𝑞𝑢𝑎𝑙𝑞𝑢𝑒𝑟 𝑚í𝑑𝑖𝑎 𝑐𝑖𝑡𝑎𝑑𝑎

━━━ 🤖 𝕀ℕ𝕋𝔼𝕃𝕀𝔾𝔼̂ℕℂ𝕀𝔸 𝔸ℝ𝕋𝕀𝔽𝕀ℂ𝕀𝔸𝕃 ━━━
│ 🤖 *€ia [pergunta]* — pergunta à IA Groq
│ 😇 *€ia auto* — 𝐿𝑖𝑔𝑎 𝐼𝐴 𝑎𝑢𝑡𝑜𝑚á𝑡𝑖𝑐𝑎; 𝑛𝑜 𝑔𝑟𝑢𝑝𝑜 𝑟𝑒𝑠𝑝𝑜𝑛𝑑𝑒 𝑎 𝑚𝑒𝑛çõ𝑒𝑠 𝑑𝑜 𝑑𝑜𝑛𝑜
│ 🛑 *€ia desligar* — 𝐷𝑒𝑠𝑙𝑖𝑔𝑎 𝑎 𝐼𝐴 𝑎𝑢𝑡𝑜𝑚á𝑡𝑖𝑐𝑎

━━━ 🎵 𝔻𝕆𝕎ℕ𝕃𝕆𝔸𝔻𝕊 ━━━
│ 🎵 *€baixar música [nome]* — 𝑩𝒂𝒊𝒙𝒂 𝑴𝑷𝟑 𝒄𝒐𝒎𝒑𝒍𝒆𝒕𝒂 𝒔ó 𝒑𝒐𝒓 𝒏𝒐𝒎𝒆
│ 🎬 *€baixar vídeo [nome]* — 𝑩𝒂𝒊𝒙𝒂 𝒗í𝒅𝒆𝒐 𝒅𝒆 𝒀𝒐𝒖𝑻𝒖𝒃𝒆 𝒔ó 𝒑𝒐𝒓 𝒏𝒐𝒎𝒆
│ 📷 *€baixar foto [nome]* — 𝑩𝒖𝒔𝒄𝒂 𝒇𝒐𝒕𝒐 𝒓𝒆𝒂𝒍 𝑑𝑒 𝑝𝑒𝑠𝑠𝑜𝑎𝑠/𝑐𝑜𝑖𝑠𝑎𝑠
│ ⚡ Atalhos: *€foto [nome]* e *€vídeo [nome]*

━━━ 🎭 𝕄Í𝔻𝕀𝔸 / 𝔼𝔽𝔼𝕀𝕋𝕆𝕊 ━━━
│ 🎭 *€sticker* — 𝐶𝑜𝑛𝑣𝑒𝑟𝑡𝑒 𝑓𝑜𝑡𝑜 𝑜𝑢 𝑣í𝑑𝑒𝑜 𝑒𝑚 𝑠𝑡𝑖𝑐𝑘𝑒𝑟
│ 🎙️ *€áudio [texto]* — fala com voz em português do Brasil
│ 😎 *€perfil @Pessoa* — 𝑀𝑜𝑠𝑡𝑟𝑎 𝑎 𝑓𝑜𝑡𝑜 𝑑𝑒 𝑝𝑒𝑟𝑓𝑖𝑙 𝑑𝑎 𝑝𝑒𝑠𝑠𝑜𝑎
│ 🤝 *€elogio @Pessoa* — 𝑀𝑜𝑠𝑡𝑟𝑎 𝑎 𝑓𝑜𝑡𝑜 𝑒 𝑑𝑖𝑧 𝑢𝑚 𝑒𝑙𝑜𝑔𝑖𝑜

━━━ 🎮 𝕌𝕋𝕀𝕃𝕀𝕋Á𝕊 ━━━
│ 📍 *€mencionar* — dono menciona apenas membros que aderiram à lista voluntária
│ ➕ *€mencionar entrar / €mencionar sair* — membro aceita ou cancela as menções
│ 🎮 *€quiz* — quiz com 300 fases; uma resposta por pessoa em cada fase
│ 🧩 *€charada* — jogo de 150 charadas, respostas A, B, C ou D
│ 🛑 *€charada parar* — termina o jogo e mostra o placar
│ 🛑 *€quiz parar* — termina o quiz e mostra o placar
│ 🤪 *€online* — 𝐿𝑖𝑠𝑡𝑎 𝑞𝑢𝑒𝑚 𝑒𝑠𝑡á 𝑜𝑛𝑙𝑖𝑛𝑒 𝑒 𝑞𝑢𝑒𝑚 𝑛ã𝑜 𝑒𝑠𝑡á 𝑑𝑖𝑠𝑝𝑜𝑛í𝑣𝑒𝑙 𝑛𝑜 𝑔𝑟𝑢𝑝𝑜
│ 🤪 *€status @pessoa* — 𝑒𝑥𝑝𝑙𝑖𝑐𝑎 𝑎𝑙𝑡𝑒𝑟𝑛𝑎𝑡𝑖𝑣𝑎𝑠; não controla chamadas
│ 🌍 *€hora* — 𝐻𝑜𝑟𝑎 𝑒𝑚 12 𝑝𝑎í𝑠𝑒𝑠 𝑒𝑚 𝑡𝑒𝑚𝑝𝑜 𝑟𝑒𝒂𝑙
│ 🏓 *€ping* — 𝑆𝑡𝑎𝑡𝑢𝑠 𝑒 𝑙𝑎𝑡ê𝑛𝑐𝑖𝑎 𝑑𝑜 𝑏𝑜𝑡
│ 📋 *€menu* — 𝐴𝑏𝑟𝑒 𝑒𝑠𝑡𝑒 𝑚𝑒𝑛𝑢

╔══════════════════════════════════╗
║  ⚡ 🟢 𝕄𝔼ℕ𝕋𝔼𝕄𝔸𝕃𝕌ℂ𝔸 𝕆ℕ𝕃𝕀ℕ𝔼 ⚡  ║
╚══════════════════════════════════╝`;

    return sock.sendMessage(from, { text: menuTexto }, { quoted: msg });
  }


startBot();
