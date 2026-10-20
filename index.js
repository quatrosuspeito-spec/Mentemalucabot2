const http = require('http');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot Online');
}).listen(PORT, () => {
    console.log(`Servidor HTTP a escutar na porta ${PORT}`);
});

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    delay
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const axios = require('axios');
require('dotenv').config();

const PREFIX = process.env.BOT_PREFIX || '€';
const OWNER_NUMBER = '258856868102';
const TELEGRAM_TOKEN = '8892332641:AAFL7pp9MiEggo6ztp2tuT1l4Wuovc5X6Ec';

let globalSock = null;
let lastUpdateId = 0;

// Função para enviar mensagens para o Telegram via API HTTP direta
async function sendTelegramMessage(chatId, text, parseMode = '') {
    try {
        await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
            chat_id: chatId,
            text: text,
            parse_mode: parseMode
        });
    } catch (e) {
        console.log('Erro ao enviar mensagem Telegram:', e.response?.data || e.message);
    }
}

// Leitor de mensagens do Telegram super seguro por HTTP (Sem erros de Polling/401)
async function startTelegramPoller() {
    console.log('🤖 Leitor HTTP do Telegram iniciado com sucesso!');
    setInterval(async () => {
        try {
            const res = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getUpdates`, {
                params: { offset: lastUpdateId + 1, timeout: 25 }
            });

            if (res.data && res.data.ok && res.data.result.length > 0) {
                for (let update of res.data.result) {
                    lastUpdateId = update.update_id;
                    const msg = update.message;
                    if (!msg || !msg.text) continue;

                    const chatId = msg.chat.id;
                    const text = msg.text.trim();
                    console.log(`📩 Comando recebido no Telegram: ${text}`);

                    if (text.startsWith('/conectar') || text.startsWith('/start')) {
                        const parts = text.split(' ');
                        let phone = parts[1] ? parts[1].replace(/[^0-9]/g, '') : '258856868102';

                        if (!globalSock) {
                            await sendTelegramMessage(chatId, '⚠️ O WhatsApp ainda está a iniciar no servidor. Aguarde 10 segundos e tente novamente.');
                            continue;
                        }

                        if (globalSock.authState?.creds?.registered) {
                            await sendTelegramMessage(chatId, '⚠️ O WhatsApp já está conectado nesta sessão!');
                            continue;
                        }

                        try {
                            await delay(1000);
                            const code = await globalSock.requestPairingCode(phone);
                            const resposta = `🔮 *MENTEMALUCA BOT*\n\n📱 Número: +${phone}\n🔑 Seu Código de Pareamento:\n\n\`${code}\`\n\nIntroduza este código no seu WhatsApp imediatamente!`;
                            await sendTelegramMessage(chatId, resposta, 'Markdown');
                            console.log('✅ Código de pareamento gerado e enviado com sucesso!');
                        } catch (err) {
                            await sendTelegramMessage(chatId, `❌ Erro ao gerar código: ${err.message}`);
                        }
                    }
                }
            }
        } catch (err) {
            // Ignora falhas temporárias de rede
        }
    }, 2000);
}

async function startWhatsAppBot() {
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

    globalSock = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
            console.log('Conexão fechada. Reconectando...', shouldReconnect);
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
        const body = (msg.message.conversation ||
                     msg.message.extendedTextMessage?.text || '').trim();

        if (!body.startsWith(PREFIX)) return;
        const command = body.slice(PREFIX.length).trim().split(/ +/)[0]?.toLowerCase();

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

// Inicia os serviços em paralelo
startWhatsAppBot();
startTelegramPoller();
