const http = require('http');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Mentemaluca Bot Online');
}).listen(PORT, () => {
    console.log(`[HTTP] Servidor a escutar na porta ${PORT}`);
});

const pino = require('pino');
const axios = require('axios');
const https = require('https');
const fs = require('fs');

const PREFIX = '€';
const DEFAULT_OWNER = '258856868102';
const TELEGRAM_TOKEN = '9224940368:AAG2r3ckwywTi6QuH3C5Cimr7aIms2jP0Ks';

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
let awaitingPhone = {};

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

async function startWhatsAppBot() {
    const Baileys = await import('@whiskeysockets/baileys');
    const makeWASocket = Baileys.default;
    const {
        useMultiFileAuthState,
        DisconnectReason,
        fetchLatestBaileysVersion,
        makeCacheableSignalKeyStore,
        delay,
        downloadMediaMessage,
        Browsers
    } = Baileys;

    const { state, saveCreds } = await useMultiFileAuthState('./session');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
        },
        generateHighQualityLinkPreview: true,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 15000,
        syncFullHistory: false
    });

    globalSock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = (statusCode !== DisconnectReason.loggedOut);
            console.log(`Conexão fechada (${statusCode}). Reconectando...`, shouldReconnect);
            
            if (statusCode === DisconnectReason.loggedOut) {
                if (fs.existsSync('./session')) {
                    try { fs.rmSync('./session', { recursive: true, force: true }); } catch (e) {}
                }
            }
            if (shouldReconnect) startWhatsAppBot();
        } else if (connection === 'open') {
            console.log('⚡ 🟢 MENTEMALUCA BOT ONLINE NO WHATSAPP COM SUCESSO! ⚡');
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
        const isOwner = senderClean.includes(DEFAULT_OWNER) || msg.key.fromMe;

        if (mutedUsers.has(senderClean)) {
            try { await sock.sendMessage(from, { delete: msg.key }); } catch (e) {}
            return;
        }

        const body = (msg.message.conversation ||
                     msg.message.extendedTextMessage?.text ||
                     msg.message.imageMessage?.caption ||
                     msg.message.videoMessage?.caption || '').trim();

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

        if (activeCharadas[from]) {
            const respCerta = activeCharadas[from];
            if (body.toLowerCase().includes(respCerta)) {
                await sock.sendMessage(from, { text: `🎉 *ACERTOU!* A resposta era *${respCerta}*.` }, { quoted: msg });
                delete activeCharadas[from];
                return;
            }
        }

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
                "━━━ 🤖 𝕀ℕ𝕋𝔼𝕃𝕀𝔾𝔼̂ℕℂ𝕀𝔸 𝔸ℝ𝕋𝕀𝔽𝕀ℂ𝕀𝔸𝔃 ━━━",
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
                const targets = meta.participants.filter(p => !p.admin && !p.id.includes(DEFAULT_OWNER)).map(p => p.id);
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

async function startTelegramPoller() {
    console.log('🤖 A ligar e verificar atualizações do Telegram...');
    
    try {
        await tgAxios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/deleteWebhook?drop_pending_updates=true`);
        console.log('✅ Telegram Poller iniciado com sucesso!');
    } catch (e) {
        console.log('⚠️ Erro ao ligar ao Telegram:', e.message);
    }

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
                    console.log(`📩 Comando Telegram recebido de ${chatId}: ${text}`);

                    if (text.startsWith('/start') || text.startsWith('/conectar')) {
                        awaitingPhone[chatId] = true;
                        await sendTelegramMessage(chatId, "🔮 *MENTEMALUCA BOT 2.0*\n\n📱 Por favor, envie agora o **número de telemóvel** que pretende conectar ao WhatsApp (com o código do país).\n\n_Exemplo:_ `258856868102`", "Markdown");
                        continue;
                    }

                    if (awaitingPhone[chatId]) {
                        let phone = text.replace(/[^0-9]/g, '');
                        if (phone.length < 8) {
                            await sendTelegramMessage(chatId, "❌ Número inválido. Envie apenas os dígitos com o código do país (Ex: `258856868102`).", "Markdown");
                            continue;
                        }

                        delete awaitingPhone[chatId];
                        await sendTelegramMessage(chatId, `🔄 A preparar sessão e a solicitar código de pareamento para o número +${phone}... Aguarde 6 segundos.`);

                        if (fs.existsSync('./session')) {
                            try { fs.rmSync('./session', { recursive: true, force: true }); } catch (e) {}
                        }

                        await startWhatsAppBot();
                        await new Promise(resolve => setTimeout(resolve, 6000));

                        try {
                            if (!globalSock) throw new Error("Socket WhatsApp não foi iniciado.");
                            const rawCode = await globalSock.requestPairingCode(phone);
                            const cleanCode = rawCode ? rawCode.replace(/[^A-Z0-9]/gi, '') : '';
                            const formattedCode = cleanCode.match(/.{1,4}/g)?.join('-') || cleanCode;

                            const resposta = `🔮 *MENTEMALUCA BOT*\n\n📱 Número: +${phone}\n🔑 *CÓDIGO DE PAREAMENTO (8 DÍGITOS):*\n\n\`${formattedCode}\`\n\n👉 *Como conectar no WhatsApp:*\n1. Abra o WhatsApp no telemóvel (+${phone})\n2. Vá em *Configurações > Aparelhos Conectados > Conectar um Aparelho*\n3. Clique em *Conectar com número de telemóvel*\n4. Introduza o código acima imediatamente!`;
                            await sendTelegramMessage(chatId, resposta, 'Markdown');
                            console.log(`✅ Código gerado com sucesso para ${phone}: ${formattedCode}`);
                        } catch (err) {
                            console.log('Erro ao solicitar código:', err);
                            await sendTelegramMessage(chatId, `❌ Erro do WhatsApp: ${err.message}. Envie /conectar novamente.`);
                        }
                    }
                }
            }
        } catch (err) {}
    }, 2000);
}

startTelegramPoller();
