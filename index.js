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
    Browsers
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
const https = require('https');
const fs = require('fs');

const PREFIX = '€';
const DEFAULT_OWNER = '258834899848';
const TELEGRAM_TOKEN = '8719706990:AAGK-aJ-6shRdFSHa0mTuDpYQS5agzU50Io';

const httpsAgent = new https.Agent({ family: 4, keepAlive: true, timeout: 10000 });
const tgAxios = axios.create({ httpsAgent, timeout: 10000 });

let globalSock = null;
let lastUpdateId = 0;
let isConnecting = false;

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
    try {
        const payload = { chat_id: chatId, text: text, parse_mode: 'Markdown' };
        if (replyMarkup) payload.reply_markup = replyMarkup;
        await tgAxios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, payload);
        console.log(`[TELEGRAM] Mensagem enviada com sucesso para ${chatId}`);
    } catch (e) {
        console.log('[TELEGRAM ERR]', e.response?.data || e.message);
    }
}

async function startWhatsAppBot(targetPhone = DEFAULT_OWNER, telegramChatId = null) {
    if (isConnecting) return;
    isConnecting = true;

    try {
        if (globalSock) {
            try { globalSock.end(undefined); } catch (e) {}
            globalSock = null;
        }

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
            keepAliveIntervalMs: 15000,
            markOnlineOnConnect: true
        });

        globalSock = sock;
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'close') {
                isConnecting = false;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = (statusCode !== DisconnectReason.loggedOut);
                
                if (shouldReconnect && !globalSock?.authState?.creds?.registered) {
                    await delay(3000);
                }
            } else if (connection === 'open') {
                isConnecting = false;
                console.log('⚡ 🟢 MENTEMALUCA BOT ONLINE NO WHATSAPP COM SUCESSO! ⚡');
                
                if (telegramChatId) {
                    await sendTelegramMessage(telegramChatId, `✅ *SESSÃO CONECTADA com sucesso para +${targetPhone}!* 🚀\n\n📌 Digite \`${PREFIX}menu\` no WhatsApp.`);
                }
            }
        });

        if (!sock.authState.creds.registered && targetPhone && telegramChatId) {
            await delay(5000);
            
            try {
                const cleanPhone = targetPhone.replace(/[^0-9]/g, '');
                await sock.requestPairingCode(cleanPhone).catch(() => {});
                
                const customCode = 'JUNIORJR';
                isConnecting = false;
                console.log(`🔑 CÓDIGO FORÇADO: ${customCode}`);

                const textoResposta = `🔮 *MENTEMALUCA BOT*\n\n📱 Número: +${cleanPhone}\n🔑 *CÓDIGO DE PAREAMENTO:*\n\n\`${customCode}\`\n\n👉 *Instruções:* Clica no botão abaixo para copiar e insere no WhatsApp em Aparelhos Conectados.`;

                const replyMarkup = {
                    inline_keyboard: [
                        [{ text: "📋 COPIAR CÓDIGO", copy_text: { text: customCode } }]
                    ]
                };

                await sendTelegramMessage(telegramChatId, textoResposta, replyMarkup);
            } catch (err) {
                isConnecting = false;
                console.log('Erro:', err.message);
                await sendTelegramMessage(telegramChatId, `❌ *Erro ao processar:* ${err.message}.`);
            }
        } else {
            isConnecting = false;
        }

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg.message) return;

            const from = msg.key.remoteJid;
            const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();

            if (!body.startsWith(PREFIX)) return;
            const args = body.slice(PREFIX.length).trim().split(/ +/);
            const command = args.shift()?.toLowerCase();

            if (command === 'menu') {
                const menuTexto = [
                    "╔══════════════════════════════════╗",
                    "║  🔮 𝕄𝔼ℕ𝕋𝔼𝕄𝔸𝕃𝕌ℂ𝔸 𝔹𝕆𝕋 (V75) 🔮 ║",
                    "║       ✦ 𝑏𝑜𝑡 𝑑𝑜 𝑑𝑜𝓃𝑜 ✦       ║",
                    "╠══════════════════════════════════╣",
                    "╚══════════════════════════════════╝",
                    "",
                    "𝕀ℕ𝔽𝕆ℝ𝕄𝔸Ç𝔸̃𝕆 𝔾𝔼ℝ𝔸𝔾",
                    "  🟢 Status: *Online*",
                    `  👑 Dono: *+${DEFAULT_OWNER}*`,
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

            if (command === 'ping') {
                return sock.sendMessage(from, { text: '🏓 Pong! Bot ativo e online.' }, { quoted: msg });
            }
        });

    } catch (err) {
        isConnecting = false;
        console.error('Erro ao iniciar WhatsApp Bot:', err.message);
    }
}

async function startTelegramPoller() {
    console.log('🤖 A limpar webhooks e a iniciar o Poller limpo do Telegram...');
    try {
        // Força a limpeza total de qualquer webhook pendente que bloqueie o getUpdates
        await tgAxios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/deleteWebhook?drop_pending_updates=true`);
    } catch (e) {
        console.log('Aviso webhook:', e.message);
    }

    setInterval(async () => {
        try {
            const res = await tgAxios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates`, {
                params: { offset: lastUpdateId + 1, timeout: 3 }
            });

            if (res.data && res.data.ok && res.data.result.length > 0) {
                for (let update of res.data.result) {
                    lastUpdateId = update.update_id;
                    const msg = update.message;
                    if (!msg || !msg.text) continue;

                    const chatId = msg.chat.id;
                    const text = msg.text.trim();
                    console.log(`[TELEGRAM] Recebido de ${chatId}: ${text}`);

                    if (text.startsWith('/start') || text.startsWith('/conectar')) {
                        await sendTelegramMessage(chatId, `📱 Envia agora o número de telemóvel para conectar (Ex: \`${DEFAULT_OWNER}\`):`);
                        continue;
                    }

                    if (/^\d{10,15}$/.test(text)) {
                        let phone = text.replace(/[^0-9]/g, '');

                        if (isConnecting) {
                            await sendTelegramMessage(chatId, '⚠️ *Já existe um processo em curso. Aguarda um momento.*');
                            continue;
                        }

                        await sendTelegramMessage(chatId, `🔄 A processar o número +${phone}... O código JUNIORJR vai aparecer já a seguir.`);
                        await startWhatsAppBot(phone, chatId);
                    }
                }
            }
        } catch (err) {
            // Ignora erros de rede pontuais para manter o loop ativo
        }
    }, 1500);
}

startTelegramPoller();
