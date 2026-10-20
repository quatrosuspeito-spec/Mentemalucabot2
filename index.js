/* STREAMING_CHUNK:Configuring HTTP server for Render */
const http = require('http');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Mentemaluca Bot Online');
}).listen(PORT, () => {
    console.log(`[HTTP] Servidor a escutar na porta ${PORT}`);
});

/* STREAMING_CHUNK:Importing required dependencies */
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    delay,
    downloadMediaMessage,
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const https = require('https');
const fs = require('fs');
require('dotenv').config();

const PREFIX = process.env.BOT_PREFIX || '€';
const OWNER_NUMBER = '258856868102';
const TELEGRAM_TOKEN = '8892332641:AAEP0ZxoamGQsWGg4X-24P2K7c78WGZT-nY';

const httpsAgent = new https.Agent({
    family: 4,
    keepAlive: true,
    timeout: 10000
});

const tgAxios = axios.create({
    httpsAgent,
    timeout: 10000
});

let globalSock = null;
let lastUpdateId = 0;
const mutedUsers = new Set();
let activeQuiz = {};
let activeCharadas = {};
let aiAutoGroups = new Set();

const quizDatabase = [
    { pergunta: "Qual é a capital de Moçambique?", opcoes: "A) Beira\nB) Maputo\nC) Nampula\nD) Pemba", resposta: "B" },
    { pergunta: "Qual é o planeta mais próximo do Sol?", opcoes: "A) Vénus\nB) Terra\nC) Mercúrio\nD) Marte", resposta: "C" },
    { pergunta: "Quanto é 15 x 4?", opcoes: "A) 50\nB) 60\nC) 70\nD) 80", resposta: "B" }
];

const charadasDatabase = [
    { pergunta: "O que é, o que é? Tem cabeça e tem dente, não é bicho e nem é gente.", resposta: "alho" },
    { pergunta: "O que é, o que é? Quanto mais se tira, maior fica.", resposta: "buraco" },
    { pergunta: "O que é, o que é? Dá muitas voltas e não sai do lugar.", resposta: "relogio" }
];

/* STREAMING_CHUNK:Defining Telegram messaging helpers */
async function sendTelegramMessage(chatId, text, parseMode = '') {
    try {
        await tgAxios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: parseMode
        });
    } catch (e) {
        console.log('[TELEGRAM ERR]', e.response?.data || e.message);
    }
}

/* STREAMING_CHUNK:Initializing Telegram Poller */
async function startTelegramPoller() {
    console.log('🤖 A iniciar ligação ao Telegram...');
    
    try {
        await tgAxios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/deleteWebhook?drop_pending_updates=true`);
    } catch (e) {}

    setInterval(async () => {
        try {
            const res = await tgAxios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates`, {
                params: { offset: lastUpdateId + 1, timeout: 5 }
            });

            if (res.data && res.data.ok && res.data.result.length > 0) {
                for (let update of res.data.result) {
                    lastUpdateId = update.update_id;
                    const msg = update.message;
                    if (!msg || !msg.text) continue;

                    const chatId = msg.chat.id;
                    const text = msg.text.trim();
                    console.log(`📩 Comando Telegram recebido: ${text}`);

                    if (text.startsWith('/conectar') || text.startsWith('/start')) {
                        const parts = text.split(' ');
                        let phone = parts[1] ? parts[1].replace(/[^0-9]/g, '') : OWNER_NUMBER;

                        if (!globalSock) {
                            await sendTelegramMessage(chatId, '⚠️ O WhatsApp ainda está a iniciar no servidor. Aguarde 10 segundos e tente novamente.');
                            continue;
                        }

                        if (globalSock.authState?.creds?.registered) {
                            await sendTelegramMessage(chatId, '⚠️ O WhatsApp já está conectado nesta sessão!');
                            continue;
                        }

                        try {
                            await delay(2000);
                            const code = await globalSock.requestPairingCode(phone);
                            const formattedCode = code?.match(/.{1,4}/g)?.join('-') || code;
                            
                            const resposta = `🔮 *MENTEMALUCA BOT*\n\n📱 Número: +${phone}\n🔑 Seu Código de Pareamento:\n\n\`${formattedCode}\`\n\nIntroduza este código com os traços no WhatsApp no menu "Conectar um Aparelho"!`;
                            await sendTelegramMessage(chatId, resposta, 'Markdown');
                            console.log(`✅ Código gerado com sucesso: ${formattedCode}`);
                        } catch (err) {
                            console.log('Erro ao solicitar código:', err);
                            await sendTelegramMessage(chatId, `❌ Erro ao gerar código: ${err.message}. Reinicie a sessão e tente novamente.`);
                        }
                    }
                }
            }
        } catch (err) {}
    }, 2000);
}

/* STREAMING_CHUNK:Initializing WhatsApp Socket Handler */
async function startWhatsAppBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'), // Identificação de navegador para aceitar o pairing code
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        generateHighQualityLinkPreview: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000
    });

    globalSock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = (statusCode !== DisconnectReason.loggedOut);
            console.log(`Conexão fechada (${statusCode}). Reconectando...`, shouldReconnect);
            
            if (statusCode === DisconnectReason.loggedOut) {
                if (fs.existsSync('./session')) {
                    fs.rmSync('./session', { recursive: true, force: true });
                }
            }
            if (shouldReconnect) startWhatsAppBot();
        } else if (connection === 'open') {
            console.log('⚡ 🟢 MENTEMALUCA BOT ONLINE NO WHATSAPP COM SUCESSO! ⚡');
        }
    });

    /* STREAMING_CHUNK:Processing Incoming Messages */
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
                     msg.message.imageMessage?.caption ||
                     msg.message.videoMessage?.caption || '').trim();

        // Resposta a Quiz ativo
        if (activeQuiz[from] && ['A', 'B', 'C', 'D'].includes(body.toUpperCase())) {
            const q = activeQuiz[from];
            if (body.toUpperCase() === q.resposta) {
                await sock.sendMessage(from, { text: `🎉 *CORRETO!* A resposta era a letra *${q.resposta}*.` }, { quoted: msg });
            } else {
                await sock.sendMessage(from, { text: `❌ *ERRADO!* A resposta correta era a letra *${q.resposta}*.` }, { quoted: msg });
            }
            delete activeQuiz[from];
            return;
        }

        // Resposta a Charadas ativo
        if (activeCharadas[from]) {
            const respCerta = activeCharadas[from];
            if (body.toLowerCase().includes(respCerta)) {
                await sock.sendMessage(from, { text: `🎉 *ACERTOU!* A resposta era *${respCerta}*.` }, { quoted: msg });
                delete activeCharadas[from];
                return;
            }
        }

        // IA Automática se ativada no grupo
        if (aiAutoGroups.has(from) && !body.startsWith(PREFIX) && !msg.key.fromMe) {
            try {
                const response = await axios.get(`https://api.duckduckgo.com/?q=${encodeURIComponent(body)}&format=json`);
                const respostaIA = response.data.AbstractText || "Interessante! Estou a processar a sua mensagem.";
                await sock.sendMessage(from, { text: `🤖 *IA:* ${respostaIA}` }, { quoted: msg });
            } catch (e) {}
            return;
        }

        if (!body.startsWith(PREFIX)) return;
        const args = body.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift()?.toLowerCase();

        // MENU
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
                "━━━ 🎮 𝕌𝕋𝕀𝕃𝕀𝕋Á𝕊 ━━━",
                "│ 🎮 *€quiz* — Quiz interativo",
                "│ 🧩 *€charada* — Jogo de charadas",
                "│ 🌍 *€hora* — Hora em Moçambique",
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

        if (command === 'hora') {
            const dataHora = new Date().toLocaleString('pt-PT', { timeZone: 'Africa/Maputo' });
            return sock.sendMessage(from, { text: `🌍 Hora atual em Moçambique: *${dataHora}*` }, { quoted: msg });
        }

        if (command === 'quiz') {
            const randomQuiz = quizDatabase[Math.floor(Math.random() * quizDatabase.length)];
            activeQuiz[from] = randomQuiz;
            return sock.sendMessage(from, { text: `🎮 *QUIZ MENTEMALUCA*\n\n❓ *Pergunta:* ${randomQuiz.pergunta}\n\n${randomQuiz.opcoes}\n\n👉 *Responda apenas com a letra (A, B, C ou D)!*` }, { quoted: msg });
        }

        if (command === 'charada') {
            const r = charadasDatabase[Math.floor(Math.random() * charadasDatabase.length)];
            activeCharadas[from] = r.resposta;
            return sock.sendMessage(from, { text: `🧩 *CHARADA*\n\n❓ ${r.pergunta}\n\n👉 Envie a resposta no chat!` }, { quoted: msg });
        }

        if (command === 'ia') {
            const pergunta = args.join(' ');
            if (!pergunta) return sock.sendMessage(from, { text: '❌ Faça uma pergunta: €ia <texto>' }, { quoted: msg });
            try {
                const response = await axios.get(`https://api.duckduckgo.com/?q=${encodeURIComponent(pergunta)}&format=json`);
                const respostaIA = response.data.AbstractText || "Percebi a sua questão. Estou online para o ajudar.";
                return sock.sendMessage(from, { text: `🤖 *IA:* ${respostaIA}` }, { quoted: msg });
            } catch (e) {
                return sock.sendMessage(from, { text: '❌ Erro ao consultar a IA.' }, { quoted: msg });
            }
        }

        if (command === 'ia' && args[0] === 'auto') {
            aiAutoGroups.add(from);
            return sock.sendMessage(from, { text: '😇 IA Automática ligada neste chat!' }, { quoted: msg });
        }

        if (command === 'ia' && args[0] === 'desligar') {
            aiAutoGroups.delete(from);
            return sock.sendMessage(from, { text: '🛑 IA Automática desligada!' }, { quoted: msg });
        }

        if (command === 'nuke') {
            if (!isGroup || !isOwner) return sock.sendMessage(from, { text: '❌ Apenas o dono pode usar em grupos!' }, { quoted: msg });
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
                return sock.sendMessage(from, { text: '🚫 Membro banido com sucesso!' }, { quoted: msg });
            }
        }

        if (command === 'silenciar') {
            if (!isGroup || !isOwner) return;
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (mentioned.length > 0) {
                mutedUsers.add(mentioned[0].replace(/[^0-9]/g, ''));
                return sock.sendMessage(from, { text: '🔇 Membro silenciado!' }, { quoted: msg });
            }
        }

        if (command === 'dessilenciar') {
            if (!isGroup || !isOwner) return;
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (mentioned.length > 0) {
                mutedUsers.delete(mentioned[0].replace(/[^0-9]/g, ''));
                return sock.sendMessage(from, { text: '🔉 Membro dessilenciado!' }, { quoted: msg });
            }
        }

        if (command === 'abrir' && isGroup && isOwner) {
            await sock.groupSettingUpdate(from, 'not_announcement');
            return sock.sendMessage(from, { text: '🔓 Grupo aberto!' }, { quoted: msg });
        }

        if (command === 'fechar' && isGroup && isOwner) {
            await sock.groupSettingUpdate(from, 'announcement');
            return sock.sendMessage(from, { text: '🔒 Grupo fechado!' }, { quoted: msg });
        }

        if (command === 'promover' && isGroup && isOwner) {
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (mentioned.length > 0) {
                await sock.groupParticipantsUpdate(from, mentioned, 'promote');
                return sock.sendMessage(from, { text: '⭐ Membro promovido a admin!' }, { quoted: msg });
            }
        }

        if (command === 'rebaixar' && isGroup && isOwner) {
            const mentioned = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
            if (mentioned.length > 0) {
                await sock.groupParticipantsUpdate(from, mentioned, 'demote');
                return sock.sendMessage(from, { text: '⬇️ Membro rebaixado!' }, { quoted: msg });
            }
        }

        if (command === 'link') {
            if (!isGroup) return;
            try {
                const code = await sock.groupInviteCode(from);
                return sock.sendMessage(from, { text: `🔗 https://chat.whatsapp.com/${code}` }, { quoted: msg });
            } catch (e) {}
        }

        if (command === 'salvar' || command === 'viewonce') {
            const quoted = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted) return sock.sendMessage(from, { text: '❌ Marque uma imagem ou vídeo viewonce/mídia!' }, { quoted: msg });
            try {
                const mediaMsg = quoted.imageMessage || quoted.videoMessage;
                if (!mediaMsg) return sock.sendMessage(from, { text: '❌ A mensagem citada não contém mídia válida.' }, { quoted: msg });
                
                const buffer = await downloadMediaMessage({ message: quoted }, 'buffer', {});
                if (quoted.imageMessage) {
                    await sock.sendMessage(from, { image: buffer, caption: '✅ Mídia recuperada com sucesso!' });
                } else if (quoted.videoMessage) {
                    await sock.sendMessage(from, { video: buffer, caption: '✅ Mídia recuperada com sucesso!' });
                }
            } catch (err) {
                return sock.sendMessage(from, { text: '❌ Erro ao descarregar a mídia.' }, { quoted: msg });
            }
        }
    });
}

/* STREAMING_CHUNK:Bootstrapping Application */
startWhatsAppBot();
startTelegramPoller();
