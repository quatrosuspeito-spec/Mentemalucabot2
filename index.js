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
const DEFAULT_OWNER = '258856868102';
const TELEGRAM_TOKEN = '8892332641:AAEw6nYXCjqATmxtvECXw1KqEA06tqROQZ4';

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

/* STREAMING_CHUNK:Initializing WhatsApp Socket Handler */
async function startWhatsAppBot() {
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

    /* STREAMING_CHUNK:Processing Incoming Messages */
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
                await sock.sendMessage(from, { text: `🤖 *IA
