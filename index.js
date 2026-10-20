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
        const senderClean = sender.replace(/[^0-9]/g, '');

        // Verificação forte do Dono (aceita o número completo com ou sem prefixos)
        const isOwner = senderClean.includes(OWNER_NUMBER) || msg.key.fromMe;

        const body = msg.message.conversation ||
                     msg.message.extendedTextMessage?.text ||
                     msg.message.imageMessage?.caption ||
                     msg.message.videoMessage?.caption || '';

        if (!body.startsWith(PREFIX)) return;

        const args = body.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift()?.toLowerCase();

        // 1. MENU
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
                "│ 🎬 *€baixar vídeo [nome]* — Baixa vídeo",
                "│ 📷 *€baixar foto [nome]* — Busca foto",
                "",
                "━━━ 🎭 𝕄Í𝔻𝕀𝔸 / 𝔼𝔽𝔼𝕀𝕋𝕆𝕊 ━━━",
                "│ 🎭 *€sticker* — Cria figurinhas",
                "│ 🎙️ *€áudio [texto]* — Fala com voz",
                "│ 😎 *€perfil @Pessoa* — Mostra perfil",
                "",
                "━━━ 🎮 𝕌𝕋𝕀𝕃𝕀𝕋Á𝕊 ━━━",
                "│ 🎮 *€quiz* — Quiz interativo",
                "│ 🧩 *€charada* — Jogo de charadas",
                "│ 🌍 *€hora* — Hora em vários países",
                "│ 🏓 *€ping* — Status e latência",
                "│ 📋 *€menu* — Abre este menu",
                "",
                "╔══════════════════════════════════╗",
                "║  ⚡ 🟢 𝕄𝔼ℕ𝕋𝔼𝕄𝔸𝕃𝕌ℂ𝔸 𝕆ℕ𝕃𝕀ℕ𝔼 ⚡  ║",
                "╚══════════════════════════════════╝"
            ].join("\n");

            return sock.sendMessage(from, { text: menuTexto }, { quoted: msg });
        }

        // 2. PING
        if (command === 'ping') {
            return sock.sendMessage(from, { text: '🏓 Pong! Bot ativo, forte e online.' }, { quoted: msg });
        }

        // 3. ABRIR / FECHAR GRUPO
        if (command === 'abrir') {
            if (!isGroup) return sock.sendMessage(from, { text: '❌ Este comando só pode ser usado em grupos!' }, { quoted: msg });
            if (!isOwner) return sock.sendMessage(from, { text: '❌ Apenas o dono pode usar este comando!' }, { quoted: msg });
            try {
                await sock.groupSettingUpdate(from, 'not_announcement');
                return sock.sendMessage(from, { text: '🔓 Grupo aberto com sucesso!' }, { quoted: msg });
            } catch (e) {
                return sock.sendMessage(from, { text: '❌ Erro: O bot precisa de ser Administrador do grupo.' }, { quoted: msg });
            }
        }

        if (command === 'fechar') {
            if (!isGroup) return sock.sendMessage(from, { text: '❌ Este comando só pode ser usado em grupos!' }, { quoted: msg });
            if (!isOwner) return sock.sendMessage(from, { text: '❌ Apenas o dono pode usar este comando!' }, { quoted: msg });
            try {
                await sock.groupSettingUpdate(from, 'announcement');
                return sock.sendMessage(from, { text: '🔒 Grupo fechado com sucesso!' }, { quoted: msg });
            } catch (e) {
                return sock.sendMessage(from, { text: '❌ Erro: O bot precisa de ser Administrador do grupo.' }, { quoted: msg });
            }
        }

        // 4. LINK DO GRUPO (Requer que o bot seja Admin)
        if (command === 'link') {
            if (!isGroup) return sock.sendMessage(from, { text: '❌ Este comando só pode ser usado em grupos!' }, { quoted: msg });
            try {
                const code = await sock.groupInviteCode(from);
                return sock.sendMessage(from, { text: `🔗 Link de convite do grupo:\nhttps://chat.whatsapp.com/${code}` }, { quoted: msg });
            } catch (e) {
                return sock.sendMessage(from, { text: '❌ Erro ao obter o link. Certifique-se de que o bot foi promovido a Administrador do grupo!' }, { quoted: msg });
            }
        }

        // 5. BAN / REMOVER MEMBRO
        if (command === 'ban' || command === 'nuke') {
            if (!isGroup) return sock.sendMessage(from, { text: '❌ Este comando só pode ser usado em grupos!' }, { quoted: msg });
            if (!isOwner) return sock.sendMessage(from, { text: '❌ Apenas o dono pode usar este comando!' }, { quoted: msg });
            
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (mentioned.length === 0) {
                return sock.sendMessage(from, { text: '❌ Marque o usuário com @ para banir (ex: €ban @número)' }, { quoted: msg });
            }

            try {
                await sock.groupParticipantsUpdate(from, mentioned, 'remove');
                return sock.sendMessage(from, { text: '✅ Membro(s) removido(s) com sucesso!' }, { quoted: msg });
            } catch (e) {
                return sock.sendMessage(from, { text: '❌ Erro ao remover. O bot precisa de ser Administrador.' }, { quoted: msg });
            }
        }

        // 6. HORA
        if (command === 'hora') {
            const dataHora = new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' });
            return sock.sendMessage(from, { text: `🌍 Hora atual: *${dataHora}*` }, { quoted: msg });
        }

        // 7. IA
        if (command === 'ia') {
            const pergunta = args.join(' ');
            if (!pergunta) return sock.sendMessage(from, { text: '❌ Escreva uma pergunta. Exemplo: *€ia como estás?*' }, { quoted: msg });
            
            try {
                const response = await axios.get(`https://api.duckduckgo.com/?q=${encodeURIComponent(pergunta)}&format=json`);
                const respostaIA = response.data.AbstractText || "Comando processado com sucesso!";
                return sock.sendMessage(from, { text: `🤖 *IA:* ${respostaIA}` }, { quoted: msg });
            } catch (e) {
                return sock.sendMessage(from, { text: '❌ Erro ao consultar a IA.' }, { quoted: msg });
            }
        }
    });
}

startBot();
