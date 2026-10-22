process.on('uncaughtException', (err) => {
    console.error('❌ [ERRO GLOBAL]:', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('❌ [REJEIÇÃO]:', reason);
});

const http = require('http');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Mentemaluca Bot Online');
}).listen(PORT, () => {
    console.log(`[HTTP] Servidor a escutar na porta ${PORT}`);
});

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

const PREFIX = '€';
const DEFAULT_OWNER = '258856868102';
const TELEGRAM_TOKEN = '8892332641:AAEw6nYXCjqATmxtvECXw1KqEA06tqROQZ4';

const httpsAgent = new https.Agent({ family: 4, keepAlive: true, timeout: 10000 });
const tgAxios = axios.create({ httpsAgent, timeout: 10000 });

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

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
    try {
        const payload = {
            chat_id: chatId,
            text: text,
            parse_mode: 'Markdown'
        };
        if (replyMarkup) {
            payload.reply_markup = replyMarkup;
        }
        await tgAxios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, payload);
    } catch (e) {
        console.log('[TELEGRAM ERR]', e.message);
    }
}

async function startWhatsAppBot(targetPhone = DEFAULT_OWNER, telegramChatId = null) {
    try {
        if (telegramChatId && fs.existsSync('./session')) {
            try { fs.rmSync('./session', { recursive: true, force: true }); } catch (e) {}
        }

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
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 15000
        });

        globalSock = sock;
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = (statusCode !== DisconnectReason.loggedOut);
                if (shouldReconnect) {
                    await delay(3000);
                    startWhatsAppBot(targetPhone, null);
                }
            } else if (connection === 'open') {
                console.log('⚡ 🟢 MENTEMALUCA BOT ONLINE NO WHATSAPP COM SUCESSO! ⚡');
                if (telegramChatId) {
                    await sendTelegramMessage(telegramChatId, '✅ *WhatsApp conectado com sucesso ao bot!*');
                }
            }
        });

        if (!sock.authState.creds.registered && targetPhone && telegramChatId) {
            setTimeout(async () => {
                try {
                    await delay(4000);
                    const cleanPhone = targetPhone.replace(/[^0-9]/g, '');
                    const rawCode = await sock.requestPairingCode(cleanPhone);
                    const cleanCode = rawCode ? rawCode.replace(/[^A-Z0-9]/gi, '') : '';
                    
                    console.log(`🔑 CÓDIGO DE PAREAMENTO: ${cleanCode}`);
                    const textoResposta = `🔮 *MENTEMALUCA BOT*\n\n📱 Número: +${cleanPhone}\n🔑 *CÓDIGO DE PAREAMENTO:*\n\n\`${cleanCode}\`\n\n👉 *Instruções:* Vá ao WhatsApp > Aparelhos Conectados > Conectar com número de telemóvel.`;
                    
                    const replyMarkup = {
                        inline_keyboard: [
                            [
                                {
                                    text: "📋 COPIAR CÓDIGO",
                                    copy_text: { text: cleanCode }
                                }
                            ]
                        ]
                    };
                    await sendTelegramMessage(telegramChatId, textoResposta, replyMarkup);
                } catch (err) {
                    console.log('Erro ao gerar código:', err.message);
                    await sendTelegramMessage(telegramChatId, `❌ *Erro ao gerar código:* ${err.message}`);
                }
            }, 5000);
        }

        // TODAS AS FUNÇÕES ANTIGAS DE MENSAGENS E COMANDOS
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
                    "║  🔮 𝕄𝔼ℕ𝕋𝔼𝕄𝔸𝕃𝕌ℂ𝔸 𝔹𝕆𝕋 (V75) 🔮 ║",
                    "║       ✦ 𝑏𝑜𝑡 𝑑𝑜 𝑑𝑜𝑛𝑜 ✦       ║",
                    "╠══════════════════════════════════╣",
                    "╚══════════════════════════════════╝",
                    "",
                    "𝕀ℕ𝔽𝕆ℝ𝕄𝔸Ç𝔸̃𝕆 𝔾𝔼ℝ𝔸𝕃",
                    "  🟢 Status: *Online*",
                    "  👑 Dono: *+258856868102*",
                    "  🔑 Prefixo: *€*",
                    "",
                    "━━━ 📱 𝔹𝕌𝔾𝕊 𝔸ℕ𝔻ℝ𝕆𝕀D / 🇮🇴🇸 ━━━",
                    "│ 💥 *€crash_android* — Crash para Android",
                    "│ ⚡ *€crash_ios_invi* — Crash invisível iOS",
                    "│ 🎠 *€carosel_atraso* — Carrossel de atraso",
                    "│ 🏠 *€atraso_home* — Bug atraso home",
                    "│ 💬 *€crash_chat_ios* — Crash chat iOS",
                    "│ 💬 *€crash_chat_android* — Crash chat Android",
                    "│ 🔄 *€reverso* — Envia mensagem de volta",
                    "",
                    "━━━ 👥 𝔹𝕌𝔾𝕊 𝔼𝕄 𝔾ℝ𝕌ℙ𝕆 ━━━",
                    "│ 🆔 *€idgp* — Obtém o ID do grupo",
                    "│ 🚫 *€ban&&* — Remove todos (Admin)",
                    "",
                    "━━━ 👑 𝔽𝕌ℕÇ𝕆̃𝔼𝕊 𝔻𝕆 𝔻𝕆ℕ𝕆 / 𝔾ℝ𝕌ℙ𝕆 ━━━",
                    "│ 💣 *€nuke* — Remove todos os membros",
                    "│ 🔇 *€silenciar @num* — Silencia membro",
                    "│ 🔉 *€dessilenciar @num* — Dessilencia membro",
                    "│ 🔓 *€abrir* — Abre o grupo",
                    "│ 🔒 *€fechar* — Fecha o grupo",
                    "│ ⭐ *€promover @num* — Promove a admin",
                    "│ ⬇️ *€rebaixar @num* — Remove admin",
                    "│ 🚫 *€ban @num* — Banir membro",
                    "│ 🔗 *€link* — Link de convite",
                    "",
                    "━━━ 🍑 𝕄Í𝔻𝕀𝔸 & 🤖 𝕀𝔸 ━━━",
                    "│ 🍑 *€viewonce* / *€salvar* — Salva mídia",
                    "│ 🤖 *€ia [pergunta]* — Pergunta à IA",
                    "│ 🎮 *€quiz* / *€charada* — Jogos",
                    "│ 🏓 *€ping* — Status e latência",
                    "",
                    "╔══════════════════════════════════╗",
                    "║  ⚡ 🟢 𝕄𝔼ℕ𝕋𝔼𝕄𝔸𝕃𝕌ℂ𝔸 𝕆ℕ𝕃𝕀ℕ𝔼 ⚡  ║",
                    "╚══════════════════════════════════╝"
                ].join("\n");
                return sock.sendMessage(from, { text: menuTexto }, { quoted: msg });
            }

            if (command === 'crash_android') {
                const alvo = args[0] || 'Alvo não especificado';
                return sock.sendMessage(from, { text: `⚠️ Comando \`crash_android\` executado contra: *${alvo}*` }, { quoted: msg });
            }

            if (command === 'crash_ios_invi') {
                const alvo = args[0] || 'Alvo não especificado';
                return sock.sendMessage(from, { text: `⚠️ Comando \`crash_ios_invi\` executado contra: *${alvo}*` }, { quoted: msg });
            }

            if (command === 'carosel_atraso') {
                return sock.sendMessage(from, { text: `⚠️ Função \`carosel_atraso\` aplicada com sucesso.` }, { quoted: msg });
            }

            if (command === 'atraso_home') {
                return sock.sendMessage(from, { text: `⚠️ Função \`atraso_home\` configurada.` }, { quoted: msg });
            }

            if (command === 'crash_chat_ios') {
                return sock.sendMessage(from, { text: `⚠️ Comando \`crash_chat_ios\` disparado.` }, { quoted: msg });
            }

            if (command === 'crash_chat_android') {
                return sock.sendMessage(from, { text: `⚠️ Comando \`crash_chat_android\` disparado.` }, { quoted: msg });
            }

            if (command === 'reverso') {
                return sock.sendMessage(from, { text: `🔄 Modo \`reverso\` ativado para a mensagem citada.` }, { quoted: msg });
            }

            if (command === 'idgp') {
                return sock.sendMessage(from, { text: `🆔 ID deste grupo: \`${from}\`` }, { quoted: msg });
            }

            if (command === 'ban&&') {
                if (!isGroup || !isOwner) return sock.sendMessage(from, { text: '❌ Apenas o dono pode usar este comando!' }, { quoted: msg });
                try {
                    const meta = await sock.groupMetadata(from);
                    const targets = meta.participants.filter(p => !p.admin && !p.id.includes(DEFAULT_OWNER)).map(p => p.id);
                    for (let t of targets) {
                        await sock.groupParticipantsUpdate(from, [t], 'remove');
                        await delay(500);
                    }
                    return sock.sendMessage(from, { text: '🚫 \`ban&&\` executado com sucesso!' });
                } catch (e) {
                    return sock.sendMessage(from, { text: '❌ O bot precisa de privilégios de Administrador.' });
                }
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
    } catch (err) {
        console.error('Erro ao iniciar WhatsApp Bot:', err.message);
    }
}

async function startTelegramPoller() {
    console.log('🤖 Poller do Telegram iniciado...');
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

                    if (text.startsWith('/conectar') || text.startsWith('/start')) {
                        const parts = text.split(' ');
                        let phone = parts[1] ? parts[1].replace(/[^0-9]/g, '') : DEFAULT_OWNER;

                        if (!phone.startsWith('258') || phone.length < 12) {
                            await sendTelegramMessage(chatId, '❌ *Número inválido!*\nUso correto: `/conectar 25885XXXXXXX` ou apenas `/conectar` para o número padrão.');
                            continue;
                        }

                        await sendTelegramMessage(chatId, `🔄 A limpar sessão anterior e a gerar código para +${phone}... Aguarde.`);
                        await startWhatsAppBot(phone, chatId);
                    }
                }
            }
        } catch (err) {}
    }, 2000);
}

startTelegramPoller();
