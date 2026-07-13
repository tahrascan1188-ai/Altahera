// services/whatsappService.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');

let client = null;
let clientStatus = 'disconnected'; // disconnected, authenticating, ready
let ioInstance = null;

const initialize = (io) => {
    ioInstance = io;
    autoInitializeIfAuthExists();
};

const getStatus = () => clientStatus;
const getClient = () => client;

const initializeClient = () => {
    if (client) {
        console.log('WhatsApp client is already initialized or initializing.');
        return client;
    }

    console.log('Initializing WhatsApp Web client...');
    clientStatus = 'authenticating';
    if (ioInstance) {
        ioInstance.emit('wa_status', { status: clientStatus });
    }

    client = new Client({
        authStrategy: new LocalAuth({ clientId: 'altahera-ai' }),
        puppeteer: {
            headless: true,
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--no-first-run',
                '--no-zygote',
                '--disable-features=IsolateOrigins,site-per-process',
                '--disable-site-isolation-trials'
            ]
        },
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
        }
    });

    client.on('qr', (qr) => {
        console.log('WhatsApp QR Code generated.');
        qrcode.toDataURL(qr, (err, url) => {
            if (!err && ioInstance) {
                ioInstance.emit('wa_qr', { url });
            }
        });
    });

    client.on('ready', () => {
        console.log('WhatsApp Client is READY!');
        clientStatus = 'ready';
        if (ioInstance) {
            ioInstance.emit('wa_status', { status: clientStatus });
        }
    });

    client.on('authenticated', () => {
        console.log('WhatsApp Client Authenticated.');
        clientStatus = 'ready';
        if (ioInstance) {
            ioInstance.emit('wa_status', { status: clientStatus });
        }
    });

    client.on('auth_failure', (msg) => {
        console.error('WhatsApp Authentication Failure:', msg);
        clientStatus = 'disconnected';
        client = null;
        if (ioInstance) {
            ioInstance.emit('wa_status', { status: clientStatus, error: msg });
        }
    });

    client.on('disconnected', (reason) => {
        console.log('WhatsApp Client Disconnected:', reason);
        clientStatus = 'disconnected';
        client = null;
        if (ioInstance) {
            ioInstance.emit('wa_status', { status: clientStatus });
        }
    });

    client.on('message', async (msg) => {
        console.log(`📩 Received WhatsApp message from ${msg.from}: "${msg.body || '[Media]'}"`);
        if (ioInstance) {
            ioInstance.emit('new_message_received', {
                from: msg.from,
                body: msg.body || '',
                timestamp: Date.now()
            });
        }
    });

    client.initialize().catch(err => {
        console.error('Failed to initialize client:', err);
        clientStatus = 'disconnected';
        client = null;
        if (ioInstance) {
            ioInstance.emit('wa_status', { status: clientStatus });
        }
    });

    return client;
};

const destroyClient = async () => {
    if (!client) return;
    console.log('Destroying WhatsApp Web client session...');
    try {
        await client.logout();
    } catch (e) {
        console.warn('Regular logout failed, forcing destroy...', e.message);
        try {
            await client.destroy();
        } catch (dErr) {
            console.error('Failed to destroy client:', dErr.message);
        }
    }
    client = null;
    clientStatus = 'disconnected';
    if (ioInstance) {
        ioInstance.emit('wa_status', { status: clientStatus });
    }
};

const autoInitializeIfAuthExists = () => {
    const fs = require('fs');
    const path = require('path');
    const authDir = path.join(__dirname, '..', '.wwebjs_auth');
    if (fs.existsSync(authDir)) {
        console.log('Found active authentication folders. Booting client automatically...');
        initializeClient();
    }
};

module.exports = {
    initialize,
    initializeClient,
    destroyClient,
    getStatus,
    getClient
};
