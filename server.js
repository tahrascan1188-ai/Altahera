const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const qrcode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Bypass self-signed certificate errors caused by firewalls/antivirus
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;
const GAS_URL = 'https://script.google.com/macros/s/AKfycbzp2otr64XQ4PTt3EnYoxq30JwiXS9B_p2MV7ol49Cdy_8Xgs62mPFq3WZRnRUAHSugkA/exec';

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname)));

// --- SQLite Database Setup ---
const dbPath = path.resolve(__dirname, 'wa_settings.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening SQLite settings database:', err.message);
    } else {
        console.log('Connected to local SQLite database: wa_settings.db');
        initDb();
    }
});

function initDb() {
    db.run(`CREATE TABLE IF NOT EXISTS ai_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        api_key TEXT,
        provider TEXT DEFAULT 'gemini',
        system_instruction TEXT,
        personal_chats_enabled INTEGER DEFAULT 1,
        groups_whitelist TEXT DEFAULT ''
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS ai_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT,
        chat_name TEXT,
        message_body TEXT,
        media_data TEXT, -- base64 image data
        suggested_reply TEXT,
        status TEXT DEFAULT 'pending', -- pending, approved, dismissed
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Insert default system prompt if table is empty
    db.get("SELECT count(*) as count FROM ai_settings", [], (err, row) => {
        if (!err && row.count === 0) {
            const defaultPrompt = `أنت موظف استقبال ذكي ومساعد طبي في مركز الطاهرة للأشعة والتحاليل. وظيفتك هي الرد على استفسارات المرضى حول أسعار التحاليل والأشعة والتعليمات المطلوبة للفحص بكل أدب واحترافية وبالمعلومات المتاحة فقط في قاعدة البيانات دون تخمين أو تأليف.`;
            db.run("INSERT INTO ai_settings (system_instruction, personal_chats_enabled, groups_whitelist) VALUES (?, 1, '')", [defaultPrompt]);
        }
    });
}

// --- Medical Tests Memory Cache & Sync ---
let cachedTests = [];

async function syncTestsFromGAS() {
    try {
        console.log('🔄 Syncing medical tests database from Google Sheets...');
        // We use dynamic import for node-fetch to support all environments gracefully
        const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
        const res = await fetch(`${GAS_URL}?action=GET_DB`);
        const json = await res.json();
        if (json.status === 'success' && json.data && json.data.tests) {
            cachedTests = json.data.tests;
            console.log(`✅ Synced ${cachedTests.length} tests/scans from Google Sheets.`);
        } else {
            console.warn('⚠️ Google Sheets returned empty tests database.');
        }
    } catch (e) {
        console.error('❌ Failed to sync medical tests from GAS:', e.message);
    }
}

// Initial Sync and interval every 15 minutes
syncTestsFromGAS();
setInterval(syncTestsFromGAS, 15 * 60 * 1000);

// Smart matching function
function findMatchingTests(text) {
    if (!text || cachedTests.length === 0) return [];
    const query = text.toLowerCase();
    const stopWords = ['سعر', 'تحليل', 'اشعة', 'اشعه', 'بكم', 'يا', 'لو', 'عايز', 'اعرف', 'عن', 'فى', 'في', 'من', 'شروط', 'تعليمات', 'هو', 'هي', 'حجز', 'موعد', 'تفاصيل', 'طلب', 'عمل'];
    const words = query.split(/[\s,._-]+/).filter(w => w.length > 2 && !stopWords.includes(w));
    
    if (words.length === 0) {
        return cachedTests.filter(t => {
            const nameAr = (t.nameAr || '').toLowerCase();
            const nameEn = (t.nameEn || '').toLowerCase();
            return nameAr.includes(query) || nameEn.includes(query);
        });
    }

    return cachedTests.filter(t => {
        const nameAr = (t.nameAr || '').toLowerCase();
        const nameEn = (t.nameEn || '').toLowerCase();
        return words.some(word => nameAr.includes(word) || nameEn.includes(word));
    });
}

// --- WhatsApp Client Logic ---
let client;
let clientStatus = 'disconnected'; // disconnected, authenticating, ready

function initializeWhatsAppClient() {
    if (client) {
        console.log('WhatsApp client already initialized or initializing.');
        return;
    }

    console.log('Initializing WhatsApp Web client...');
    clientStatus = 'authenticating';
    io.emit('wa_status', { status: clientStatus });

    client = new Client({
        authStrategy: new LocalAuth({ clientId: 'altahera-ai' }),
        puppeteer: {
            headless: true,
            executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', (qr) => {
        console.log('WhatsApp QR Code generated.');
        qrcode.toDataURL(qr, (err, url) => {
            if (!err) {
                io.emit('wa_qr', { url });
            }
        });
    });

    client.on('ready', () => {
        console.log('WhatsApp Client is READY!');
        clientStatus = 'ready';
        io.emit('wa_status', { status: clientStatus });
    });

    client.on('authenticated', () => {
        console.log('WhatsApp Client Authenticated.');
        clientStatus = 'ready';
        io.emit('wa_status', { status: clientStatus });
    });

    client.on('auth_failure', (msg) => {
        console.error('WhatsApp Authentication Failure:', msg);
        clientStatus = 'disconnected';
        client = null;
        io.emit('wa_status', { status: clientStatus, error: msg });
    });

    client.on('disconnected', (reason) => {
        console.log('WhatsApp Client Disconnected:', reason);
        clientStatus = 'disconnected';
        client = null;
        io.emit('wa_status', { status: clientStatus });
    });

    client.on('message', async (msg) => {
        console.log(`📩 Received WhatsApp message from ${msg.from}: "${msg.body || '[Media]'}"`);
        
        // Load settings to check routing
        db.get("SELECT * FROM ai_settings LIMIT 1", [], async (err, settings) => {
            if (err) {
                console.error('❌ Database error while loading settings:', err.message);
                return;
            }
            if (!settings || !settings.api_key) {
                console.log('⚠️ Skipping message: Gemini API Key is not configured in the AI Settings tab.');
                return;
            }

            const isGroup = msg.from.endsWith('@g.us');
            
            // Check if group is whitelisted
            if (isGroup) {
                const whitelist = (settings.groups_whitelist || '').split(',').map(s => s.trim().toLowerCase());
                const chat = await msg.getChat();
                const groupName = chat.name.toLowerCase();
                const isWhitelisted = whitelist.some(g => g && (groupName.includes(g) || msg.from.includes(g)));
                if (!isWhitelisted) {
                    console.log(`ℹ️ Skipping group message from "${chat.name}" (Group not in whitelist).`);
                    return;
                }
            } else {
                if (!settings.personal_chats_enabled) {
                    console.log(`ℹ️ Skipping personal message from ${msg.from} (Personal chats disabled in settings).`);
                    return;
                }
            }

            console.log(`🤖 Processing message with Gemini AI for ${msg.from}...`);

            // Start AI drafting
            try {
                let mediaData = null;
                let mimeType = null;
                
                if (msg.hasMedia && msg.type === 'image') {
                    const media = await msg.downloadMedia();
                    if (media) {
                        mediaData = media.data;
                        mimeType = media.mimetype;
                    }
                }

                const patientMsgText = msg.body || '';
                const matchingTests = findMatchingTests(patientMsgText);

                // Initialize Gemini AI
                const genAI = new GoogleGenerativeAI(settings.api_key);
                const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

                const systemPrompt = `
التعليمات الخاصة بك (System Instructions):
${settings.system_instruction}

قاعدة بيانات التحاليل والأشعة المتاحة بالمركز والمطابقة لاستفسار المريض:
${matchingTests.length > 0 ? JSON.stringify(matchingTests, null, 2) : 'لم يتم العثور على فحوصات مطابقة في قاعدة البيانات.'}

ملاحظة هامة جداً للالتزام بها:
1. يجب الالتزام بالأسعار والتعليمات المذكورة في الجدول أعلاه فقط بشكل حرفي!
2. إذا لم تجد التحليل أو الفحص المطلوب في الجدول، أخبر المريض بلطف أنك لم تجد هذا الفحص في قاعدة البيانات وسيتم الرد عليه من قبل الموظف المختص فوراً. لا تقم أبداً بتأليف أسعار أو تعليمات أو شروط من رأسك!
3. إذا أرسل المريض صورة روشتة تحتوي على فحوصات متعددة، قم بفحص الصورة، ثم ابحث عن أسعار كل فحص منها واعرض أسعارها وتعليماتها المذكورة فقط.
4. أجب باللغة العربية الفصحى أو العامية المهذبة بأسلوب ودود واحترافي كمنسق طبي بالمركز.
5. لا تشرح للمريض كيف يعمل الذكاء الاصطناعي أو تذكر كلمة "جدول مطابقة" أو "قاعدة بيانات".

الرسالة الحالية للمريض: "${patientMsgText}"
`;

                let result;
                if (mediaData) {
                    result = await model.generateContent([
                        systemPrompt,
                        { inlineData: { data: mediaData, mimeType: mimeType } }
                    ]);
                } else {
                    result = await model.generateContent(systemPrompt);
                }

                const responseText = result.response.text().trim();
                const chat = await msg.getChat();

                // Save draft to SQLite
                db.run(
                    `INSERT INTO ai_drafts (chat_id, chat_name, message_body, media_data, suggested_reply, status) VALUES (?, ?, ?, ?, ?, 'pending')`,
                    [msg.from, chat.name || msg.from, patientMsgText, mediaData, responseText],
                    function(err) {
                        if (!err) {
                            console.log(`✅ AI draft generated and saved successfully for "${chat.name || msg.from}".`);
                            // Emit draft update to clients
                            io.emit('new_ai_draft', {
                                id: this.lastID,
                                chat_id: msg.from,
                                chat_name: chat.name || msg.from,
                                message_body: patientMsgText,
                                media_data: mediaData,
                                suggested_reply: responseText,
                                created_at: new Date()
                            });
                        } else {
                            console.error('❌ Error inserting draft into SQLite:', err.message);
                        }
                    }
                );

            } catch (aiErr) {
                console.error('❌ Gemini AI generation failed:', aiErr.message);
            }
        });
    });

    client.initialize().catch(err => {
        console.error('Failed to initialize client:', err);
        clientStatus = 'disconnected';
        client = null;
        io.emit('wa_status', { status: clientStatus });
    });
}

// Automatically try initializing if auth folders exist
initializeWhatsAppClient();

// --- REST API Routes ---

// AI Settings
app.get('/api/ai/settings', (req, res) => {
    db.get("SELECT * FROM ai_settings LIMIT 1", [], (err, row) => {
        if (err) {
            res.status(500).json({ status: 'error', error: err.message });
        } else {
            res.json({ status: 'success', data: row || {} });
        }
    });
});

app.post('/api/ai/settings', (req, res) => {
    const { api_key, system_instruction, personal_chats_enabled, groups_whitelist } = req.body;
    db.get("SELECT id FROM ai_settings LIMIT 1", [], (err, row) => {
        if (err) {
            return res.status(500).json({ status: 'error', error: err.message });
        }
        
        if (row) {
            db.run(
                `UPDATE ai_settings SET api_key = ?, system_instruction = ?, personal_chats_enabled = ?, groups_whitelist = ? WHERE id = ?`,
                [api_key, system_instruction, personal_chats_enabled ? 1 : 0, groups_whitelist, row.id],
                (err2) => {
                    if (err2) return res.status(500).json({ status: 'error', error: err2.message });
                    res.json({ status: 'success', message: 'Settings updated successfully' });
                }
            );
        } else {
            db.run(
                `INSERT INTO ai_settings (api_key, system_instruction, personal_chats_enabled, groups_whitelist) VALUES (?, ?, ?, ?)`,
                [api_key, system_instruction, personal_chats_enabled ? 1 : 0, groups_whitelist],
                (err2) => {
                    if (err2) return res.status(500).json({ status: 'error', error: err2.message });
                    res.json({ status: 'success', message: 'Settings created successfully' });
                }
            );
        }
    });
});

// AI Drafts
app.get('/api/ai/drafts', (req, res) => {
    db.all("SELECT * FROM ai_drafts WHERE status = 'pending' ORDER BY created_at DESC", [], (err, rows) => {
        if (err) {
            res.status(500).json({ status: 'error', error: err.message });
        } else {
            res.json({ status: 'success', data: rows });
        }
    });
});

// Approve & Send Draft
app.post('/api/ai/drafts/:id/approve', async (req, res) => {
    const { id } = req.params;
    const { reply_text } = req.body;

    db.get("SELECT * FROM ai_drafts WHERE id = ?", [id], async (err, draft) => {
        if (err || !draft) {
            return res.status(404).json({ status: 'error', message: 'Draft not found' });
        }

        if (clientStatus !== 'ready' || !client) {
            return res.status(400).json({ status: 'error', message: 'WhatsApp client is not connected' });
        }

        try {
            await client.sendMessage(draft.chat_id, reply_text);
            
            db.run("UPDATE ai_drafts SET status = 'approved', suggested_reply = ? WHERE id = ?", [reply_text, id], (err2) => {
                if (err2) console.error(err2);
                res.json({ status: 'success', message: 'Message sent and draft approved' });
            });
        } catch (sendErr) {
            console.error('Failed to send message:', sendErr);
            res.status(500).json({ status: 'error', message: 'Failed to send WhatsApp message: ' + sendErr.message });
        }
    });
});

// Dismiss Draft
app.delete('/api/ai/drafts/:id', (req, res) => {
    const { id } = req.params;
    db.run("UPDATE ai_drafts SET status = 'dismissed' WHERE id = ?", [id], (err) => {
        if (err) {
            res.status(500).json({ status: 'error', error: err.message });
        } else {
            res.json({ status: 'success', message: 'Draft dismissed successfully' });
        }
    });
});

// WhatsApp Initialization
app.post('/api/wa/initialize', (req, res) => {
    initializeWhatsAppClient();
    res.json({ status: 'success', message: 'WhatsApp client initialization triggered' });
});

// WhatsApp Status
app.get('/api/wa/status', (req, res) => {
    res.json({ status: 'success', data: { status: clientStatus } });
});

// Sync tests from frontend
app.post('/api/medical-services/sync', (req, res) => {
    const { tests } = req.body;
    if (Array.isArray(tests)) {
        cachedTests = tests;
        console.log(`✅ Synced ${cachedTests.length} tests/scans from frontend client.`);
        res.json({ status: 'success', message: `Synced ${tests.length} tests` });
    } else {
        res.status(400).json({ status: 'error', message: 'Invalid tests data' });
    }
});

// Socket connection
io.on('connection', (socket) => {
    // Send current status on connect
    socket.emit('wa_status', { status: clientStatus });
});

server.listen(PORT, () => {
    console.log(`🚀 Altahera Management System with AI WhatsApp running at http://localhost:${PORT}`);
});
