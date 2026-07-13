// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const supabase = require('./services/supabaseService');
const whatsappService = require('./services/whatsappService');
const aiService = require('./services/aiService');

require('dotenv').config();

// Bypass self-signed certificate errors caused by firewalls/antivirus
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// Intercept favicon requests to prevent file locks
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/favicon.png', (req, res) => res.status(204).end());

// Initialize WhatsApp Service
whatsappService.initialize(io);

// --- REST API Endpoints ---

// Get configuration variables for frontend initialization
app.get('/api/config', (req, res) => {
    res.json({
        supabaseUrl: process.env.SUPABASE_URL || '',
        supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
    });
});

const DEFAULT_API_KEY = process.env.GEMINI_API_KEY || '';
const DEFAULT_SYSTEM_INSTRUCTION = `أنت المنسق الطبي ومساعد خدمة العملاء الذكي لـ "مركز الطاهرة للتحاليل والأشعة". وظيفتك هي الرد على استفسارات المرضى والعملاء عبر واتساب بأسلوب مهذب، ودود، واحترافي.

عند إجابة المرضى، يرجى الالتزام بالتعليمات التالية:
1. الرد باللغة العربية الفصحى المبسطة أو العامية المصرية المهذبة الودودة (على سبيل المثال: "أهلاً بك يا فندم"، "تحت أمرك"، "نورتنا").
2. الإجابة بدقة بالاعتماد على أسعار الفحوصات والتحاليل وشروطها المرفقة معك. لا تقم بتأليف أسعار أو مواعيد أو شروط من عندك مطلقاً.
3. إذا طلب المريض فحصاً غير موجود في قاعدة البيانات المرفقة، أخبره بلطف أن هذا الفحص غير مدرج حالياً وسيقوم موظف خدمة العملاء بالرد عليك فوراً.
4. اعرض أسعار التحاليل/الأشعة المطلوبة بشكل واضح ومنسق، واذكر أي شروط خاصة بها (مثل الصيام لعدد ساعات معين، أو الحضور في أيام محددة).
5. كن مختصراً وواضحاً، وتجنب الإطالة غير المفيدة، ولا تذكر للمريض أي تفاصيل تقنية حول الذكاء الاصطناعي أو قاعدة البيانات.`;

// Get AI settings from Supabase
app.get('/api/ai/settings', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('ai_settings')
            .select('*')
            .eq('id', 1)
            .single();

        let responseData = data || {};
        if (error) {
            console.error('Error fetching AI settings from database, using defaults:', error.message);
            responseData = {
                id: 1,
                api_key_1: DEFAULT_API_KEY,
                api_key_2: '',
                api_key_3: '',
                system_instruction: DEFAULT_SYSTEM_INSTRUCTION,
                personal_chats_enabled: true,
                groups_whitelist: '',
                active_key_index: 1
            };
        } else {
            // Fill defaults if database values are null/empty
            if (!responseData.api_key_1 && !responseData.api_key_2 && !responseData.api_key_3) {
                responseData.api_key_1 = DEFAULT_API_KEY;
            }
            if (!responseData.system_instruction) {
                responseData.system_instruction = DEFAULT_SYSTEM_INSTRUCTION;
            }
        }
        res.json({ status: 'success', data: responseData });
    } catch (err) {
        console.error('Server error fetching AI settings, using defaults:', err);
        res.json({
            status: 'success',
            data: {
                id: 1,
                api_key_1: DEFAULT_API_KEY,
                api_key_2: '',
                api_key_3: '',
                system_instruction: DEFAULT_SYSTEM_INSTRUCTION,
                personal_chats_enabled: true,
                groups_whitelist: '',
                active_key_index: 1
            }
        });
    }
});

// Update AI settings in Supabase
app.post('/api/ai/settings', async (req, res) => {
    const { api_key_1, api_key_2, api_key_3, system_instruction, personal_chats_enabled, groups_whitelist } = req.body;
    try {
        const { data, error } = await supabase
            .from('ai_settings')
            .upsert({
                id: 1,
                api_key_1,
                api_key_2,
                api_key_3,
                system_instruction,
                personal_chats_enabled: !!personal_chats_enabled,
                groups_whitelist: groups_whitelist || '',
                active_key_index: 1 // Default index
            });

        if (error) {
            console.error('Error updating AI settings:', error);
            return res.status(500).json({ status: 'error', error: error.message });
        }
        res.json({ status: 'success', message: 'Settings updated successfully' });
    } catch (err) {
        console.error('Server error updating AI settings:', err);
        res.status(500).json({ status: 'error', error: err.message });
    }
});

// Sync medical services endpoint (compatibility stub)
app.post('/api/medical-services/sync', (req, res) => {
    res.json({ status: 'success', message: 'Medical services synced successfully' });
});

// Check WhatsApp connection status
app.get('/api/wa/status', (req, res) => {
    res.json({ status: 'success', data: { status: whatsappService.getStatus() } });
});

// Trigger WhatsApp initialization
app.post('/api/wa/initialize', (req, res) => {
    whatsappService.initializeClient();
    res.json({ status: 'success', message: 'WhatsApp client initialization triggered' });
});

// Force logout / disconnect WhatsApp
app.post('/api/wa/logout', async (req, res) => {
    try {
        await whatsappService.destroyClient();
        res.json({ status: 'success', message: 'WhatsApp logged out successfully' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: 'Failed to log out: ' + err.message });
    }
});

// Fetch active chat list
app.get('/api/wa/chats', async (req, res) => {
    const client = whatsappService.getClient();
    const status = whatsappService.getStatus();

    if (status !== 'ready' || !client) {
        return res.status(400).json({ status: 'error', message: 'WhatsApp client is not connected' });
    }

    try {
        console.log('📥 Fetching active WhatsApp chats from device...');
        const chats = await client.getChats();
        const formatted = chats.slice(0, 30).map(c => ({
            id: c.id._serialized,
            name: c.name || c.id.user,
            unreadCount: c.unreadCount || 0,
            timestamp: c.timestamp ? c.timestamp * 1000 : Date.now(),
            lastMessage: c.lastMessage ? {
                body: c.lastMessage.body || '',
                fromMe: c.lastMessage.fromMe
            } : null
        }));
        res.json({ status: 'success', data: formatted });
    } catch (err) {
        console.error('❌ Failed to fetch chats:', err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch chats: ' + err.message });
    }
});

// Fetch chat history (instant load without downloading media)
app.get('/api/wa/chat-history/:chatId', async (req, res) => {
    const { chatId } = req.params;
    const client = whatsappService.getClient();
    const status = whatsappService.getStatus();

    if (status !== 'ready' || !client) {
        return res.status(400).json({ status: 'error', message: 'WhatsApp client is not connected' });
    }

    try {
        console.log(`📥 Fetching messages for chat: ${chatId}`);
        const chat = await client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit: 20 });
        
        const formatted = messages.map(m => ({
            id: m.id.id,
            from: m.from,
            to: m.to,
            fromMe: m.fromMe,
            body: m.body,
            timestamp: m.timestamp * 1000,
            hasMedia: m.hasMedia && m.type === 'image',
            mediaData: null // Loaded on-demand via media API
        }));
        
        // Fetch active locks from Supabase
        const { data: lock } = await supabase
            .from('chat_locks')
            .select('*')
            .eq('chat_id', chatId)
            .single();

        res.json({ status: 'success', data: formatted, lockInfo: lock });
    } catch (err) {
        console.error('❌ Failed to fetch history:', err);
        res.status(500).json({ status: 'error', message: 'Failed to fetch history: ' + err.message });
    }
});

// Fetch media for specific message on-demand (lazy load)
app.get('/api/wa/message-media/:chatId/:messageId', async (req, res) => {
    const { chatId, messageId } = req.params;
    const client = whatsappService.getClient();
    const status = whatsappService.getStatus();

    if (status !== 'ready' || !client) {
        return res.status(400).json({ status: 'error', message: 'WhatsApp client is not connected' });
    }

    try {
        console.log(`📥 Downloading media for msg: ${messageId}`);
        const chat = await client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit: 40 });
        const msg = messages.find(m => m.id.id === messageId);
        
        if (!msg || !msg.hasMedia) {
            return res.status(404).json({ status: 'error', message: 'Media message not found' });
        }
        
        const media = await msg.downloadMedia();
        if (media) {
            res.json({ status: 'success', data: media.data, mimetype: media.mimetype });
        } else {
            res.status(500).json({ status: 'error', message: 'Failed to extract media data' });
        }
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// Generate AI suggestion reply on-demand
app.post('/api/ai/generate-reply', async (req, res) => {
    const { message_body, media_data, mime_type } = req.body;
    try {
        const reply = await aiService.generateReply(message_body, media_data, mime_type);
        res.json({ status: 'success', suggested_reply: reply });
    } catch (err) {
        console.error('❌ AI service failed:', err.message);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// Send message to patient
app.post('/api/wa/send-message', async (req, res) => {
    const { chatId, message } = req.body;
    const client = whatsappService.getClient();
    const status = whatsappService.getStatus();

    if (status !== 'ready' || !client) {
        return res.status(400).json({ status: 'error', message: 'WhatsApp client is not connected' });
    }

    try {
        console.log(`📤 Sending message to ${chatId}`);
        await client.sendMessage(chatId, message);
        res.json({ status: 'success', message: 'Message sent successfully' });
    } catch (err) {
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// --- Real-time Sockets Collision Lock ---

io.on('connection', async (socket) => {
    // Send current status on connect
    socket.emit('wa_status', { status: whatsappService.getStatus() });
    
    // Fetch and send all active database locks on connect
    const { data: locks } = await supabase.from('chat_locks').select('*');
    const locksMap = {};
    if (locks) {
        locks.forEach(l => {
            locksMap[l.chat_id] = { userName: l.user_name, socketId: l.socket_id };
        });
    }
    socket.emit('active_locks', locksMap);

    // Handle lock chat
    socket.on('lock_chat', async (data) => {
        const { chatId, userName } = data;
        
        // Save lock to Supabase
        await supabase
            .from('chat_locks')
            .upsert({ chat_id: chatId, user_name: userName, socket_id: socket.id });
            
        io.emit('chat_locked', { chatId, userName, socketId: socket.id });
        console.log(`🔒 Chat ${chatId} locked by ${userName}`);
    });

    // Handle unlock chat
    socket.on('unlock_chat', async (data) => {
        const { chatId } = data;
        
        // Remove lock from Supabase
        await supabase
            .from('chat_locks')
            .delete()
            .eq('chat_id', chatId);
            
        io.emit('chat_unlocked', { chatId });
        console.log(`🔓 Chat ${chatId} unlocked`);
    });

    // Handle disconnect (Clean up orphan locks)
    socket.on('disconnect', async () => {
        // Find all locks held by this socket ID
        const { data: myLocks } = await supabase
            .from('chat_locks')
            .select('chat_id')
            .eq('socket_id', socket.id);
            
        if (myLocks && myLocks.length > 0) {
            for (const lock of myLocks) {
                await supabase
                    .from('chat_locks')
                    .delete()
                    .eq('chat_id', lock.chat_id);
                    
                io.emit('chat_unlocked', { chatId: lock.chat_id });
                console.log(`🔓 Chat ${lock.chat_id} unlocked automatically on disconnect.`);
            }
        }
    });
});

// Start Server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Altahera SaaS Backend running on port ${PORT}`);
});
