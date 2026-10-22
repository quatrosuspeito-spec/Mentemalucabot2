process.on('uncaughtException', (err) => {
    console.error('❌ [ERRO NÃO CAPTURADO]:', err.stack || err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ [REJEIÇÃO NÃO TRATADA]:', reason);
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
const fs = require('fs');

const DEFAULT_OWNER = '258856868102';
const TELEGRAM_TOKEN = '8892332641:AAEw6nYXCjqATmxtvECXw1KqEA06tqROQZ4';

let globalSock = null;

async function gerarCodigoPareamento(numeroTelefone) {
    // 1. Limpa a pasta de sessão para garantir que não haja credenciais antigas corrompidas
    if (fs.existsSync('./session')) {
        try {
            fs.rmSync('./session', { recursive: true, force: true });
        } catch (e) {
            console.log('Erro ao limpar sessão:', e.message);
        }
    }

    // 2. Carrega estado limpo de autenticação
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    const { version } = await fetchLatestBaileysVersion();

    // 3. Inicializa o socket configurado estritamente para Pairing Code
    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // Obrigatório estar false para pairing code
        browser: Browsers.ubuntu('Chrome'), // Simula navegador Ubuntu
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

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = (statusCode !== DisconnectReason.loggedOut);
            console.log(`Conexão fechada (${statusCode}). Reconectando...`, shouldReconnect);
            if (shouldReconnect) {
                // Reconecta mantendo os dados de sessão recém-salvos
            }
        } else if (connection === 'open') {
            console.log('⚡ 🟢 MENTEMALUCA BOT CONECTADO COM SUCESSO AO WHATSAPP! ⚡');
        }
    });

    // 4. Aguarda a estabilização do socket antes de solicitar o código
    await delay(3000);

    // 5. Solicita o código se o aparelho ainda não estiver registrado
    if (!sock.authState.creds.registered) {
        const numeroLimpo = numeroTelefone.replace(/[^0-9]/g, '');
        const rawCode = await sock.requestPairingCode(numeroLimpo);
        const codeFormatado = rawCode?.match(/.{1,4}/g)?.join('-') || rawCode;
        return codeFormatado;
    } else {
        throw new Error("O bot já se encontra registrado/conectado.");
    }
}
