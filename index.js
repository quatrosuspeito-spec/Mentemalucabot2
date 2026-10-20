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
const TELEGRAM_TOKEN = '8892332641:AAFL7pp9MleGgo6ztp2tuT1I4Wuovc5X6Ec';
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
if (TELEGRAM_TOKEN) {
    tgBot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });
    console.log('🤖 Telegram Bot ativado com sucesso!');

    tgBot.on('polling_error', (err) => {
        console.log('⚠️ Polling aviso:', err.message);
    });
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
                "━━━ 🎵 𝔻𝕆𝕎ℕ𝓞𝔸𝔻𝕊 ━━━",
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

        if (command === 'ping') {
            return sock.sendMessage(from, { text: '🏓 Pong! Bot ativo, rápido e online.' }, { quoted: msg });
        }

        if (command === 'nuke') {
            if (!isGroup) return sock.sendMessage(from, { text: '❌ Este comando só pode ser usado em grupos!' }, { quoted: msg });
            if (!isOwner) return sock.sendMessage(from, { text: '❌ Apenas o dono pode executar o Nuke!' }, { quoted: msg });

            try {
                const groupMetadata = await sock.groupMetadata(from);
                const participants = groupMetadata.participants;

                const targets = participants
                    .filter(p => !p.admin && !p.id.includes(OWNER_NUMBER))
                    .map(p => p.id);

                if (targets.length === 0) {
                    return sock.sendMessage(from, { text: '⚠️ Não há membros comuns para remover.' }, { quoted: msg });
                }

                await sock.sendMessage(from, { text: `💣 *NUKE INICIADO!* Removendo ${targets.length} membros...` });

                for (let target of targets) {
                    await sock.groupParticipantsUpdate(from, [target], 'remove');
                    await delay(1000);
                }

                return sock.sendMessage(from, { text: '💥 *NUKE CONCLUÍDO!* Todos os membros comuns foram removidos.' });
            } catch (e) {
                return sock.sendMessage(from, { text: '❌ O bot precisa de ser Administrador do grupo para executar o Nuke.' }, { quoted: msg });
            }
        }

        if (command === 'quiz') {
            const randomQuiz = quizDatabase[Math.floor(Math.random() * quizDatabase.length)];
            activeQuiz[from] = randomQuiz;

            const quizTexto = `🎮 *QUIZ MENTEMALUCA*\n\n❓ *Pergunta:* ${randomQuiz.pergunta}\n\n${randomQuiz.opcoes}\n\n👉 *Responda apenas com a letra (A, B, C ou D)!*`;
            return sock.sendMessage(from, { text: quizTexto }, { quoted: msg });
        }

        if (command === 'ban') {
            if (!isGroup) return sock.sendMessage(from, { text: '❌ Apenas em grupos!' }, { quoted: msg });
            if (!isOwner) return sock.sendMessage(from, { text: '❌ Apenas o dono pode banir!' }, { quoted: msg });

            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (mentioned.length === 0) return sock.sendMessage(from, { text: '❌ Marque o membro com @' }, { quoted: msg });

            try {
                await sock.groupParticipantsUpdate(from, mentioned, 'remove');
                return sock.sendMessage(from, { text: '🚫 Membro banido com sucesso!' }, { quoted: msg });
            } catch (e) {
                return sock.sendMessage(from, { text: '❌ O bot precisa de ser Administrador do grupo.' }, { quoted: msg });
            }
        }

        if (command === 'link') {
            if (!isGroup) return sock.sendMessage(from, { text: '❌ Apenas em grupos!' }, { quoted: msg });
            try {
                const code = await sock.groupInviteCode(from);
                return sock.sendMessage(from, { text: `🔗 Link do grupo:\nhttps://chat.whatsapp.com/${code}` }, { quoted: msg });
            } catch (e) {
                return sock.sendMessage(from, { text: '❌ O bot precisa de ser Administrador para obter o link.' }, { quoted: msg });
            }
        }

        if (command === 'abrir') {
            if (!isGroup || !isOwner) return;
            try {
                await sock.groupSettingUpdate(from, 'not_announcement');
                return sock.sendMessage(from, { text: '🔓 Grupo aberto!' }, { quoted: msg });
            } catch (e) {
                return sock.sendMessage(from, { text: '❌ O bot precisa de ser Administrador.' }, { quoted: msg });
            }
        }

        if (command === 'fechar') {
            if (!isGroup || !isOwner) return;
            try {
                await sock.groupSettingUpdate(from, 'announcement');
                return sock.sendMessage(from, { text: '🔒 Grupo fechado!' }, { quoted: msg });
            } catch (e) {
                return sock.sendMessage(from, { text: '❌ O bot precisa de ser Administrador.' }, { quoted: msg });
            }
        }

        if (command === 'silenciar') {
            if (!isGroup || !isOwner) return;
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (mentioned.length > 0) {
                const targetClean = mentioned[0].replace(/[^0-9]/g, '');
                mutedUsers.add(targetClean);
                return sock.sendMessage(from, { text: '🔇 Membro silenciado com sucesso!' }, { quoted: msg });
            }
        }

        if (command === 'dessilenciar') {
            if (!isGroup || !isOwner) return;
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (mentioned.length > 0) {
                const targetClean = mentioned[0].replace(/[^0-9]/g, '');
                mutedUsers.delete(targetClean);
                return sock.sendMessage(from, { text: '🔉 Membro dessilenciado com sucesso!' }, { quoted: msg });
            }
        }

        if (command === 'ia') {
            const pergunta = args.join(' ');
            if (!pergunta) return sock.sendMessage(from, { text: '❌ Faça uma pergunta: €ia <texto>' }, { quoted: msg });
            
            try {
                const response = await axios.get(`https://api.duckduckgo.com/?q=${encodeURIComponent(pergunta)}&format=json`);
                const respostaIA = response.data.AbstractText || "Percebi a sua pergunta! Estou online para o ajudar.";
                return sock.sendMessage(from, { text: `🤖 *IA:* ${respostaIA}` }, { quoted: msg });
            } catch (e) {
                return sock.sendMessage(from, { text: '❌ Erro ao consultar a IA.' }, { quoted: msg });
            }
        }

        if (command === 'hora') {
            const dataHora = new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' });
            return sock.sendMessage(from, { text: `🌍 Hora atual: *${dataHora}*` }, { quoted: msg });
        }
    });
}

startBot();
