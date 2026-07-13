// js/whatsapp-ai.js
const BACKEND_URL = window.location.port === '3000' ? '' : 'http://localhost:3000';

class WhatsAppAI {
    constructor() {
        this.socket = null;
        this.chats = [];
        this.settings = {
            api_key: '',
            api_key_1: '',
            api_key_2: '',
            api_key_3: '',
            system_instruction: '',
            personal_chats_enabled: 1,
            groups_whitelist: ''
        };
        this.waStatus = 'disconnected';
        this.activeChatId = null;
        this.chatHistory = [];
        this.isLoadingHistory = false;
        this.locks = {}; // JID -> { userName }
        this.navHooked = false;
    }

    init() {
        // Connect Socket.io
        if (typeof io !== 'undefined') {
            this.socket = io(BACKEND_URL);
            this.setupSocketListeners();
        } else {
            console.error('Socket.io is not loaded.');
        }

        // Fetch Initial Settings and Live Chats
        this.loadSettings();
        this.loadChats();

        // Hook navigation to release locks when leaving this view
        if (window.app && !this.navHooked) {
            this.navHooked = true;
            const self = this;
            const origNavigate = window.app.navigate;
            window.app.navigate = function(viewId) {
                if (window.app.currentView === 'whatsapp-ai' && viewId !== 'whatsapp-ai') {
                    self.releaseActiveChatLock();
                }
                origNavigate.call(this, viewId);
            };
        }

        // Sync tests to backend as a backup
        setTimeout(() => this.syncTestsToBackend(), 2000);
    }

    releaseActiveChatLock() {
        if (this.activeChatId) {
            console.log(`Releasing active lock for ${this.activeChatId}`);
            this.socket.emit('unlock_chat', { chatId: this.activeChatId, userName: this.getCurrentUserName() });
            this.activeChatId = null;
            this.chatHistory = [];
        }
    }

    async syncTestsToBackend() {
        try {
            const tests = window.storage ? window.storage.getTests() : [];
            if (tests.length > 0) {
                console.log(`Sending ${tests.length} tests to backend to sync...`);
                await fetch(`${BACKEND_URL}/api/medical-services/sync`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tests })
                });
            }
        } catch (e) {
            console.error('Failed to sync tests to backend:', e);
        }
    }

    setupSocketListeners() {
        this.socket.on('wa_status', (data) => {
            this.waStatus = data.status;
            this.updateConnectionHeaderUI();
            this.updateConnectionModalUI();
            this.loadChats();
        });

        this.socket.on('wa_qr', (data) => {
            this.renderQR(data.url);
        });

        // Live chat incoming message event
        this.socket.on('new_message_received', (data) => {
            this.loadChats();
            if (this.activeChatId === data.from) {
                this.loadChatHistory(this.activeChatId);
            }
        });

        // Ticket locks synchronization
        this.socket.on('active_locks', (locks) => {
            this.locks = locks;
            this.renderChatsList();
            this.renderChatWindow();
        });

        this.socket.on('chat_locked', (data) => {
            this.locks[data.chatId] = { userName: data.userName };
            this.renderChatsList();
            if (this.activeChatId === data.chatId) {
                this.renderChatWindow();
            }
        });

        this.socket.on('chat_unlocked', (data) => {
            delete this.locks[data.chatId];
            this.renderChatsList();
            if (this.activeChatId === data.chatId) {
                this.renderChatWindow();
            }
        });
    }

    async loadSettings() {
        try {
            const res = await fetch(`${BACKEND_URL}/api/ai/settings`);
            const json = await res.json();
            if (json.status === 'success' && json.data) {
                this.settings = { ...this.settings, ...json.data };
            }
        } catch (e) {
            console.error('Failed to load AI settings:', e);
        }
    }

    async saveSettingsFromModal() {
        const apiKey1 = document.getElementById('wa-api-key-1').value.trim();
        const apiKey2 = document.getElementById('wa-api-key-2').value.trim();
        const apiKey3 = document.getElementById('wa-api-key-3').value.trim();

        const prompt = document.getElementById('wa-prompt').value.trim();
        const personalEnabled = document.getElementById('wa-personal-chats').checked ? 1 : 0;
        const whitelist = document.getElementById('wa-whitelist').value.trim();

        try {
            const response = await fetch(`${BACKEND_URL}/api/ai/settings`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    api_key_1: apiKey1,
                    api_key_2: apiKey2,
                    api_key_3: apiKey3,
                    system_instruction: prompt,
                    personal_chats_enabled: personalEnabled,
                    groups_whitelist: whitelist
                })
            });

            const json = await response.json();
            if (json.status === 'success') {
                this.settings = {
                    ...this.settings,
                    api_key_1: apiKey1,
                    api_key_2: apiKey2,
                    api_key_3: apiKey3,
                    api_key: [apiKey1, apiKey2, apiKey3].filter(Boolean).join(','),
                    system_instruction: prompt,
                    personal_chats_enabled: personalEnabled,
                    groups_whitelist: whitelist
                };
                if (window.app) {
                    window.app.showToast('تم حفظ الإعدادات بنجاح', 'success');
                    window.app.closeModal();
                }
            } else {
                if (window.app) window.app.showToast('فشل في حفظ الإعدادات: ' + json.error, 'error');
            }
        } catch (e) {
            console.error(e);
            if (window.app) window.app.showToast('حدث خطأ أثناء حفظ الإعدادات', 'error');
        }
    }

    async loadChats() {
        if (this.waStatus !== 'ready') {
            this.chats = [];
            this.renderChatsList();
            this.updateBadge();
            return;
        }

        try {
            const res = await fetch(`${BACKEND_URL}/api/wa/chats`);
            const json = await res.json();
            if (json.status === 'success' && json.data) {
                this.chats = json.data;
                this.renderChatsList();
                this.updateBadge();
            }
        } catch (e) {
            console.error('Failed to load chats:', e);
        }
    }

    filterChats() {
        const query = document.getElementById('wa-chat-search').value.toLowerCase().trim();
        if (!query) {
            this.renderChatsList();
            return;
        }
        const filtered = this.chats.filter(chat => {
            const name = (chat.name || '').toLowerCase();
            const id = chat.id.toLowerCase();
            const snippet = chat.lastMessage ? chat.lastMessage.body.toLowerCase() : '';
            return name.includes(query) || id.includes(query) || snippet.includes(query);
        });
        this.renderChatsList(filtered);
    }

    updateBadge() {
        const badge = document.getElementById('wa-drafts-badge');
        if (badge) {
            const unreadCount = this.chats ? this.chats.reduce((acc, c) => acc + (c.unreadCount || 0), 0) : 0;
            if (unreadCount > 0) {
                badge.textContent = unreadCount;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    getCurrentUserName() {
        return (window.app && window.app.currentUser) ? window.app.currentUser.name : 'موظف';
    }

    async selectChat(chatId) {
        if (this.activeChatId === chatId) return;

        // Release old lock if any
        if (this.activeChatId) {
            this.socket.emit('unlock_chat', { chatId: this.activeChatId, userName: this.getCurrentUserName() });
        }

        this.activeChatId = chatId;
        
        // Zero out unread badge locally for better responsiveness
        if (this.chats) {
            const c = this.chats.find(chat => chat.id === chatId);
            if (c) c.unreadCount = 0;
        }

        // Reset history and render loading state
        this.chatHistory = [];
        this.isLoadingHistory = true;
        this.renderChatWindow();
        this.renderChatsList(); // updates active highlighting
        this.updateBadge();

        // Lock chat on socket
        this.socket.emit('lock_chat', { chatId: chatId, userName: this.getCurrentUserName() });

        try {
            const response = await fetch(`${BACKEND_URL}/api/wa/chat-history/${encodeURIComponent(chatId)}`);
            const json = await response.json();
            if (json.status === 'success') {
                this.chatHistory = json.data;
            } else {
                if (window.app) window.app.showToast('فشل في تحميل سجل المحادثة: ' + json.message, 'error');
            }
        } catch (e) {
            console.error('Failed to load chat history:', e);
            if (window.app) window.app.showToast('حدث خطأ أثناء تحميل سجل المحادثة', 'error');
        } finally {
            this.isLoadingHistory = false;
            this.renderChatWindow();
            this.scrollToBottom();
        }
    }

    async loadChatHistory(chatId) {
        try {
            const response = await fetch(`${BACKEND_URL}/api/wa/chat-history/${encodeURIComponent(chatId)}`);
            const json = await response.json();
            if (json.status === 'success') {
                this.chatHistory = json.data;
                this.renderChatWindow();
                this.scrollToBottom();
            }
        } catch (e) {
            console.error('Failed to load chat history:', e);
        }
    }

    async startWhatsApp() {
        try {
            if (window.app) window.app.showToast('جاري بدء تشغيل العميل وتوليد رمز QR...', 'info');
            const res = await fetch(`${BACKEND_URL}/api/wa/initialize`, { method: 'POST' });
            const json = await res.json();
            console.log(json.message);
        } catch (e) {
            console.error(e);
        }
    }

    async logoutWhatsApp() {
        const isAdmin = window.app && window.app.currentUser && window.app.currentUser.role === 'Administrator';
        if (!isAdmin) {
            if (window.app) window.app.showToast('غير مصرح لك بتسجيل الخروج من الواتساب', 'error');
            return;
        }

        try {
            if (window.app) window.app.showToast('جاري تسجيل الخروج من حساب الواتساب...', 'info');
            const res = await fetch(`${BACKEND_URL}/api/wa/logout`, { method: 'POST' });
            const json = await res.json();
            if (json.status === 'success') {
                if (window.app) {
                    window.app.showToast('تم تسجيل الخروج من الواتساب بنجاح', 'success');
                    window.app.closeModal();
                }
            } else {
                if (window.app) window.app.showToast('فشل في تسجيل الخروج: ' + json.message, 'error');
            }
        } catch (e) {
            console.error('Failed to log out WhatsApp:', e);
            if (window.app) window.app.showToast('حدث خطأ أثناء تسجيل الخروج', 'error');
        }
    }

    async lazyLoadMedia(chatId, messageId, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        const origHtml = container.innerHTML;
        container.innerHTML = `
            <i class="fa-solid fa-circle-notch fa-spin" style="color: var(--primary);"></i>
            <span style="font-size: 0.8rem; color: var(--text-muted); margin-right: 0.5rem;">جاري تحميل الصورة من الهاتف...</span>
        `;

        try {
            const res = await fetch(`${BACKEND_URL}/api/wa/message-media/${encodeURIComponent(chatId)}/${messageId}`);
            const json = await res.json();
            if (json.status === 'success' && json.data) {
                const base64Data = json.data;
                const mime = json.mimetype || 'image/png';
                
                // Update local chat history so it doesn't fetch again if we rerender
                const msg = this.chatHistory.find(m => m.id === messageId);
                if (msg) {
                    msg.mediaData = base64Data;
                    msg.mimetype = mime;
                }

                // Swap container HTML with the actual image
                container.outerHTML = `
                    <div style="position: relative; margin-top: 0.5rem; border-radius: 8px; overflow: hidden; border: 1px solid rgba(0,0,0,0.1); max-width: 280px; background:#000;">
                        <img src="data:${mime};base64,${base64Data}" style="width: 100%; max-height: 200px; object-fit: contain; cursor: pointer; display: block;" onclick="whatsappAI.downloadImage('${base64Data}', '${mime}', 'prescription-${messageId}.png')" title="اضغط لتحميل الصورة">
                        <div style="position: absolute; bottom: 8px; left: 8px; background: rgba(0,0,0,0.6); color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer; pointer-events: none; display: flex; align-items: center; gap: 0.25rem;">
                            <i class="fa-solid fa-download"></i>
                            <span>تحميل</span>
                        </div>
                    </div>
                `;

                // Update checked state values if any
                const cb = document.querySelector(`.msg-selector-checkbox[data-msg-id="${messageId}"]`);
                if (cb) {
                    cb.setAttribute('data-msg-media', base64Data);
                }
            } else {
                container.innerHTML = origHtml;
                if (window.app) window.app.showToast('فشل تحميل الصورة: ' + (json.message || 'خطأ غير معروف'), 'error');
            }
        } catch (e) {
            console.error(e);
            container.innerHTML = origHtml;
            if (window.app) window.app.showToast('حدث خطأ أثناء تحميل الصورة', 'error');
        }
    }

    downloadImage(base64Data, mimeType, filename = 'image.png') {
        try {
            const link = document.createElement('a');
            link.href = `data:${mimeType};base64,${base64Data}`;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            if (window.app) window.app.showToast('جاري تحميل الصورة إلى جهازك...', 'success');
        } catch (e) {
            console.error('Failed to download image:', e);
            if (window.app) window.app.showToast('فشل في تحميل الصورة', 'error');
        }
    }

    updateSelectedMessagesCount() {
        const checkboxes = document.querySelectorAll('.msg-selector-checkbox:checked');
        const countSpan = document.getElementById('selected-msg-count');
        const btn = document.getElementById('ai-batch-gen-btn');
        if (countSpan && btn) {
            countSpan.textContent = checkboxes.length;
            btn.disabled = checkboxes.length === 0;
        }
    }

    async generateAIResponseForSelected() {
        const checkboxes = document.querySelectorAll('.msg-selector-checkbox:checked');
        if (checkboxes.length === 0) return;

        const btn = document.getElementById('ai-batch-gen-btn');
        const origHtml = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> جاري التحليل...`;
        btn.disabled = true;

        try {
            let combinedText = '';
            let mediaData = null;
            let hasMedia = false;

            for (let i = 0; i < checkboxes.length; i++) {
                const cb = checkboxes[i];
                const text = decodeURIComponent(cb.getAttribute('data-msg-body') || '');
                const isMedia = cb.getAttribute('data-msg-hasmedia') === 'true';
                let mData = cb.getAttribute('data-msg-media');

                combinedText += `- ${text}\n`;
                if (isMedia) {
                    if (!mData) {
                        const msgId = cb.getAttribute('data-msg-id');
                        try {
                            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> جاري تحميل الوسائط...`;
                            const mediaRes = await fetch(`${BACKEND_URL}/api/wa/message-media/${encodeURIComponent(this.activeChatId)}/${msgId}`);
                            const mediaJson = await mediaRes.json();
                            if (mediaJson.status === 'success' && mediaJson.data) {
                                mData = mediaJson.data;
                                cb.setAttribute('data-msg-media', mData);
                                const historyMsg = this.chatHistory.find(m => m.id === msgId);
                                if (historyMsg) historyMsg.mediaData = mData;
                            }
                        } catch (e) { console.error('Failed to load media for batch:', e); }
                    }
                    if (mData) {
                        mediaData = mData;
                        hasMedia = true;
                    }
                }
            }

            const body = { message_body: combinedText.trim() };
            if (hasMedia && mediaData) {
                body.media_data = mediaData;
                body.mime_type = mediaData.startsWith('iVBORw0KG') ? 'image/png' : 'image/jpeg';
            }

            const res = await fetch(`${BACKEND_URL}/api/ai/generate-reply`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const json = await res.json();
            if (json.status === 'success') {
                const textarea = document.getElementById('chat-reply-input');
                if (textarea) {
                    textarea.value = json.suggested_reply;
                }
                if (window.app) window.app.showToast('تم تحليل مجموعة الرسائل وتوليد الرد بنجاح!', 'success');
                
                // Reset checkboxes
                checkboxes.forEach(cb => cb.checked = false);
                this.updateSelectedMessagesCount();
            } else {
                if (window.app) window.app.showToast('فشل في التوليد الموحد: ' + json.message, 'error');
            }
        } catch (e) {
            console.error(e);
            if (window.app) window.app.showToast('حدث خطأ أثناء الاتصال بالخادم', 'error');
        } finally {
            btn.innerHTML = origHtml;
            btn.disabled = false;
        }
    }

    async generateAIResponseForMessage(msgText, mediaData, hasMedia, buttonId) {
        const btn = document.getElementById(buttonId);
        if (!btn) return;

        const origHtml = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> جاري التوليد...`;
        btn.disabled = true;

        try {
            if (hasMedia && !mediaData) {
                btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> جاري تحميل الصورة...`;
                const msgId = buttonId.replace('ai-gen-btn-', '');
                const mediaRes = await fetch(`${BACKEND_URL}/api/wa/message-media/${encodeURIComponent(this.activeChatId)}/${msgId}`);
                const mediaJson = await mediaRes.json();
                if (mediaJson.status === 'success' && mediaJson.data) {
                    mediaData = mediaJson.data;
                    // Cache it in history
                    const historyMsg = this.chatHistory.find(m => m.id === msgId);
                    if (historyMsg) historyMsg.mediaData = mediaData;
                }
            }

            const body = { message_body: msgText };
            if (hasMedia && mediaData) {
                body.media_data = mediaData;
                body.mime_type = mediaData.startsWith('iVBORw0KG') ? 'image/png' : 'image/jpeg';
            }

            const res = await fetch(`${BACKEND_URL}/api/ai/generate-reply`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const json = await res.json();
            if (json.status === 'success') {
                const textarea = document.getElementById('chat-reply-input');
                if (textarea) {
                    textarea.value = json.suggested_reply;
                }
                if (window.app) window.app.showToast('تم توليد الرد بنجاح!', 'success');
            } else {
                if (window.app) window.app.showToast('فشل توليد الرد: ' + json.message, 'error');
            }
        } catch (e) {
            console.error(e);
            if (window.app) window.app.showToast('حدث خطأ أثناء توليد الرد', 'error');
        } finally {
            btn.innerHTML = origHtml;
            btn.disabled = false;
        }
    }

    async sendDirectResponse() {
        const chatId = this.activeChatId;
        if (!chatId) return;

        const replyText = document.getElementById('chat-reply-input').value.trim();
        if (!replyText) {
            if (window.app) window.app.showToast('الرجاء إدخال رد قبل الإرسال', 'error');
            return;
        }

        const btn = document.getElementById('chat-send-btn');
        const origText = btn.innerHTML;
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> جاري الإرسال...`;
        btn.disabled = true;

        try {
            const response = await fetch(`${BACKEND_URL}/api/wa/send-message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chatId: chatId, message: replyText })
            });

            const json = await response.json();
            if (json.status === 'success') {
                // Clear the input
                document.getElementById('chat-reply-input').value = '';
                
                // Add the sent message to local chat history for immediate response rendering
                this.chatHistory.push({
                    id: 'temp-' + Date.now(),
                    from: 'me',
                    to: chatId,
                    fromMe: true,
                    body: replyText,
                    timestamp: Date.now(),
                    hasMedia: false,
                    mediaData: null
                });

                this.renderChatWindow();
                this.scrollToBottom();

                // Refresh the chat list so the last message preview updates
                await this.loadChats();

                if (window.app) window.app.showToast('تم إرسال الرسالة بنجاح', 'success');
            } else {
                if (window.app) window.app.showToast('فشل في إرسال الرسالة: ' + json.message, 'error');
                btn.innerHTML = origText;
                btn.disabled = false;
            }
        } catch (e) {
            console.error(e);
            if (window.app) window.app.showToast('حدث خطأ أثناء الاتصال بالخادم', 'error');
            btn.innerHTML = origText;
            btn.disabled = false;
        }
    }

    showSettingsModal() {
        const isAdmin = window.app && window.app.currentUser && window.app.currentUser.role === 'Administrator';
        if (!isAdmin) {
            if (window.app) window.app.showToast('غير مصرح لك بالوصول لإعدادات الـ API Key', 'error');
            return;
        }
        const key1 = this.settings.api_key_1 || '';
        const key2 = this.settings.api_key_2 || '';
        const key3 = this.settings.api_key_3 || '';

        // Fallback for older configurations that used comma-separated api_key
        let fallbackKey1 = key1;
        let fallbackKey2 = key2;
        let fallbackKey3 = key3;
        if (!key1 && !key2 && !key3 && this.settings.api_key) {
            const keys = this.settings.api_key.split(',').map(k => k.trim());
            fallbackKey1 = keys[0] || '';
            fallbackKey2 = keys[1] || '';
            fallbackKey3 = keys[2] || '';
        }

        const modalHtml = `
            <div style="display: flex; flex-direction: column; gap: 1.25rem; padding: 0.5rem 0;">
                <div class="form-group-modal">
                    <label style="font-weight: 700; color: var(--primary); display: block; margin-bottom: 0.4rem;">Gemini API Key #1 (الرئيسي)</label>
                    <input type="password" id="wa-api-key-1" class="neon-input" value="${fallbackKey1}" placeholder="أدخل مفتاح الـ API الرئيسي هنا..." style="direction: ltr; font-family: monospace; width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0.65rem 0.8rem;">
                </div>

                <div class="form-group-modal">
                    <label style="font-weight: 700; color: var(--primary); display: block; margin-bottom: 0.4rem;">Gemini API Key #2 (الاحتياطي الأول)</label>
                    <input type="password" id="wa-api-key-2" class="neon-input" value="${fallbackKey2}" placeholder="أدخل مفتاح الـ API الاحتياطي الأول هنا..." style="direction: ltr; font-family: monospace; width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0.65rem 0.8rem;">
                </div>

                <div class="form-group-modal">
                    <label style="font-weight: 700; color: var(--primary); display: block; margin-bottom: 0.4rem;">Gemini API Key #3 (الاحتياطي الثاني)</label>
                    <input type="password" id="wa-api-key-3" class="neon-input" value="${fallbackKey3}" placeholder="أدخل مفتاح الـ API الاحتياطي الثاني هنا..." style="direction: ltr; font-family: monospace; width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0.65rem 0.8rem;">
                </div>

                <div class="form-group-modal">
                    <label style="font-weight: 700; color: var(--primary); display: block; margin-bottom: 0.5rem;">التعليمات والأسلوب للمساعد (System Prompt)</label>
                    <textarea id="wa-prompt" style="height: 120px; line-height: 1.5; width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0.65rem 0.8rem; font-family: inherit; resize: vertical;">${this.settings.system_instruction || ''}</textarea>
                </div>

                <div class="form-group-modal" style="display: flex; align-items: center; gap: 0.75rem; margin: 0.5rem 0;">
                    <input type="checkbox" id="wa-personal-chats" ${this.settings.personal_chats_enabled ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
                    <label for="wa-personal-chats" style="font-weight: 700; color: var(--primary); cursor: pointer; user-select: none;">تفعيل المساعد للمحادثات الفردية الشخصية</label>
                </div>

                <div class="form-group-modal">
                    <label style="font-weight: 700; color: var(--primary); display: block; margin-bottom: 0.5rem;">المجموعات المسموح بالرد فيها (Groups Whitelist)</label>
                    <input type="text" id="wa-whitelist" value="${this.settings.groups_whitelist || ''}" placeholder="اسم المجموعة أو الـ ID (افصل بينهم بفاصلة ,)" style="width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0.65rem 0.8rem;">
                    <small class="text-muted" style="font-size: 0.8rem; display: block; margin-top: 0.25rem;">سيتجاهل المساعد كافة المجموعات ما عدا المجموعات المكتوبة هنا بالاسم أو جزء منه.</small>
                </div>

                <div class="modal-footer" style="padding-top: 1rem; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 0.5rem;">
                    <button class="btn btn-outline" style="background:var(--border-color); border: none; padding: 0.5rem 1.25rem; border-radius: 8px; font-weight: 600; cursor: pointer;" onclick="app.closeModal()">إلغاء</button>
                    <button class="btn btn-primary" style="background: var(--primary); color: white; border: none; padding: 0.5rem 1.25rem; border-radius: 8px; font-weight: 600; cursor: pointer;" onclick="whatsappAI.saveSettingsFromModal()">حفظ الإعدادات</button>
                </div>
            </div>
        `;
        window.app.openModal('إعدادات مساعد واتساب الذكي', modalHtml);
    }

    showConnectionModal() {
        const modalHtml = `
            <div style="display:flex; flex-direction:column; gap:1.25rem; padding: 0.5rem 0;">
                <div id="modal-wa-status-banner" style="display: flex; align-items: center; gap: 0.75rem; background: rgba(0,0,0,0.03); padding: 0.75rem 1rem; border-radius: 10px; font-weight: 700;">
                    <span id="modal-wa-status-dot" style="width: 12px; height: 12px; border-radius: 50%; display: inline-block;"></span>
                    <strong>حالة الاتصال: <span id="modal-wa-status-text">جاري التحقق...</span></strong>
                </div>

                <div id="modal-wa-qr-container" style="background: #fff; padding: 1.5rem; border-radius: 12px; display: flex; justify-content: center; align-items: center; min-height: 250px; border: 1px solid rgba(0,0,0,0.08);">
                    <i class="fa-solid fa-qrcode fa-5x" style="color: #cbd5e1;"></i>
                </div>

                <div id="modal-wa-action-container">
                    <!-- Loaded dynamically in updateConnectionModalUI -->
                </div>
            </div>
        `;
        window.app.openModal('ربط حساب واتساب بالمنصة', modalHtml);
        this.updateConnectionModalUI();
    }

    updateConnectionHeaderUI() {
        const dot = document.getElementById('header-wa-status-dot');
        if (dot) {
            let color = '#ff4757'; // red
            let title = 'غير متصل';
            if (this.waStatus === 'ready') {
                color = '#2ed573'; // green
                title = 'متصل وجاهز';
            } else if (this.waStatus === 'authenticating' || this.waStatus === 'qr_ready') {
                color = '#ffa502'; // yellow
                title = 'جاري الاتصال';
            }
            dot.style.backgroundColor = color;
            dot.style.boxShadow = `0 0 8px ${color}`;
            dot.title = title;
        }
    }

    updateConnectionModalUI() {
        const dot = document.getElementById('modal-wa-status-dot');
        const text = document.getElementById('modal-wa-status-text');
        const actionBox = document.getElementById('modal-wa-action-container');
        const qrContainer = document.getElementById('modal-wa-qr-container');

        if (!dot || !text || !actionBox) return;

        let statusText = 'غير متصل';
        let statusDotColor = '#ff4757';
        let actionBtnHtml = `
            <button class="cyber-btn" onclick="whatsappAI.startWhatsApp()" style="padding:0; height: 42px; width: 100%;">
                <div class="cyber-btn-bg" style="background: linear-gradient(90deg, #00d2ff, var(--primary-light));"></div>
                <div class="cyber-btn-inner" style="background: #ffffff; color: var(--primary); border: 1px solid rgba(102, 26, 87, 0.2); border-radius: 6px;"><i class="fa-solid fa-link"></i> ربط الجهاز الآن</div>
            </button>
        `;

        if (this.waStatus === 'ready') {
            statusText = 'متصل وجاهز';
            statusDotColor = '#2ed573';
            const isAdmin = window.app && window.app.currentUser && window.app.currentUser.role === 'Administrator';
            const logoutButtonHtml = isAdmin ? `
                <div style="margin-top: 1.5rem; border-top: 1px solid rgba(0,0,0,0.08); padding-top: 1rem;">
                    <button class="btn btn-danger" onclick="whatsappAI.logoutWhatsApp()" style="width: 100%; display: flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.65rem; border-radius: 8px; font-weight: 700; cursor: pointer; border: none; background: #ff4757; color: white;">
                        <i class="fa-solid fa-right-from-bracket"></i>
                        تسجيل خروج من الواتساب
                    </button>
                </div>
            ` : '';
            actionBtnHtml = `
                <div class="text-center" style="color: #2ed573; padding: 1rem 0; font-weight: bold;">
                    <i class="fa-solid fa-circle-check fa-4x" style="display:block; margin-bottom: 0.75rem;"></i>
                    <span>المنصة متصلة بالواتساب وتعمل الآن في الخلفية بنجاح</span>
                </div>
                ${logoutButtonHtml}
            `;
            if (qrContainer) {
                qrContainer.innerHTML = `<i class="fa-brands fa-whatsapp" style="font-size: 6rem; color: #25d366;"></i>`;
            }
        } else if (this.waStatus === 'authenticating') {
            statusText = 'جاري الاتصال وتوليد الـ QR...';
            statusDotColor = '#ffa502';
            actionBtnHtml = `
                <div class="text-center" style="padding: 1.5rem 0;">
                    <i class="fa-solid fa-circle-notch fa-spin fa-3x" style="color: #ffa502; display:block; margin-bottom: 0.75rem;"></i>
                    <p style="color: #ffa502; font-weight: 600;">انتظار تجهيز رمز الـ QR من الخادم...</p>
                </div>
            `;
        } else if (this.waStatus === 'qr_ready') {
            statusText = 'يرجى مسح رمز الـ QR للربط';
            statusDotColor = '#ffa502';
            actionBtnHtml = `
                <div class="text-center text-muted" style="font-size: 0.85rem; font-weight: 600; padding: 0.5rem 0;">
                    افتتح تطبيق واتساب على هاتفك > الأجهزة المرتبطة > ربط جهاز، ثم وجه الكاميرا نحو الشاشة.
                </div>
            `;
        }

        dot.style.backgroundColor = statusDotColor;
        dot.style.boxShadow = `0 0 8px ${statusDotColor}`;
        text.textContent = statusText;
        text.style.color = statusDotColor;
        actionBox.innerHTML = actionBtnHtml;
    }

    renderQR(qrUrl) {
        this.waStatus = 'qr_ready';
        this.updateConnectionHeaderUI();
        this.updateConnectionModalUI();
        
        const qrContainer = document.getElementById('modal-wa-qr-container');
        if (qrContainer) {
            qrContainer.innerHTML = `<img src="${qrUrl}" alt="WhatsApp QR Code" style="width: 100%; max-height: 250px; object-fit: contain;">`;
        }
    }

    scrollToBottom() {
        const container = document.getElementById('chat-messages-container');
        if (container) {
            container.scrollTop = container.scrollHeight;
        }
    }

    render(container) {
        const isAdmin = window.app && window.app.currentUser && window.app.currentUser.role === 'Administrator';
        const settingsBtnHtml = isAdmin ? `
            <button class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; border-color: rgba(102, 26, 87, 0.2); cursor: pointer;" onclick="whatsappAI.showSettingsModal()" title="إعدادات المساعد">
                <i class="fa-solid fa-gear"></i>
            </button>
        ` : '';
        container.innerHTML = `
            <style>
                .crm-layout {
                    display: grid;
                    grid-template-columns: 350px 1fr;
                    gap: 1.25rem;
                    height: calc(100vh - 160px);
                    margin-top: 1rem;
                }
                
                .crm-sidebar {
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                    height: 100%;
                    overflow: hidden;
                }
                
                .crm-chat-window {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    border-radius: var(--radius-md);
                    border: 1px solid rgba(102, 26, 87, 0.1);
                    overflow: hidden;
                    background: var(--bg-card);
                    box-shadow: var(--shadow-md);
                }
                
                .crm-sidebar-card {
                    border-radius: var(--radius-md);
                    border: 1px solid rgba(102, 26, 87, 0.1);
                    background: var(--bg-card);
                    padding: 1rem;
                    box-shadow: var(--shadow-sm);
                }

                .crm-sidebar-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .crm-sidebar-header h3 {
                    font-size: 1.1rem;
                    color: var(--primary);
                    font-weight: 700;
                    margin: 0;
                }

                .crm-patient-list {
                    flex-grow: 1;
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                    gap: 0.75rem;
                    padding-right: 2px;
                }

                .patient-card {
                    display: flex;
                    align-items: center;
                    gap: 0.75rem;
                    padding: 0.85rem;
                    border-radius: var(--radius-sm);
                    border: 1px solid rgba(0, 0, 0, 0.05);
                    background: #fbfbfb;
                    cursor: pointer;
                    transition: var(--transition);
                    position: relative;
                }

                .patient-card:hover {
                    background: rgba(102, 26, 87, 0.03);
                    border-color: rgba(102, 26, 87, 0.15);
                }

                .patient-card.active {
                    background: rgba(102, 26, 87, 0.06);
                    border-color: var(--primary);
                    box-shadow: 0 0 0 2px rgba(102, 26, 87, 0.1);
                }

                .patient-avatar {
                    width: 44px;
                    height: 44px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, var(--primary), var(--primary-light));
                    color: white;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-weight: 700;
                    font-size: 1.1rem;
                    flex-shrink: 0;
                }

                .patient-details {
                    flex-grow: 1;
                    min-width: 0;
                }

                .patient-name-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: baseline;
                    margin-bottom: 0.15rem;
                }

                .patient-name {
                    font-weight: 700;
                    font-size: 0.95rem;
                    color: var(--text-main);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }

                .patient-time {
                    font-size: 0.75rem;
                    color: var(--text-muted);
                    flex-shrink: 0;
                }

                .patient-msg-snippet {
                    font-size: 0.85rem;
                    color: var(--text-muted);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    margin-bottom: 0.15rem;
                }

                .patient-lock-badge {
                    font-size: 0.75rem;
                    color: var(--accent);
                    font-weight: 700;
                    display: flex;
                    align-items: center;
                    gap: 0.25rem;
                }

                .chat-header {
                    padding: 0.9rem 1.25rem;
                    border-bottom: 1px solid rgba(102, 26, 87, 0.1);
                    background: #fff;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    flex-shrink: 0;
                }

                .chat-header-info h3 {
                    font-weight: 700;
                    font-size: 1.1rem;
                    color: var(--primary);
                    margin: 0 0 0.15rem 0;
                }

                .chat-header-info p {
                    font-size: 0.85rem;
                    color: var(--text-muted);
                    direction: ltr;
                    text-align: right;
                    margin: 0;
                }

                .chat-banner {
                    padding: 0.65rem 1.25rem;
                    font-size: 0.9rem;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    font-weight: 700;
                    flex-shrink: 0;
                }

                .chat-banner.locked-by-other {
                    background: #fff1f2;
                    color: #be123c;
                    border-bottom: 1px solid #fecdd3;
                }

                .chat-banner.locked-by-me {
                    background: #ecfdf5;
                    color: #047857;
                    border-bottom: 1px solid #a7f3d0;
                }

                .chat-messages {
                    flex-grow: 1;
                    padding: 1.25rem;
                    overflow-y: auto;
                    background: #f8fafc;
                    display: flex;
                    flex-direction: column;
                    gap: 1rem;
                }

                .msg-group {
                    display: flex;
                    flex-direction: column;
                    max-width: 70%;
                    gap: 0.25rem;
                }

                .msg-group.incoming {
                    align-self: flex-start;
                }

                .msg-group.outgoing {
                    align-self: flex-end;
                }

                .msg-bubble {
                    padding: 0.75rem 1rem;
                    border-radius: var(--radius-sm);
                    font-size: 0.95rem;
                    line-height: 1.5;
                    position: relative;
                    word-break: break-word;
                }

                .msg-group.incoming .msg-bubble {
                    background: #ffffff;
                    color: var(--text-main);
                    border: 1px solid #e2e8f0;
                    border-top-right-radius: 2px;
                }

                .msg-group.outgoing .msg-bubble {
                    background: var(--primary);
                    color: #ffffff;
                    border-top-left-radius: 2px;
                }

                .msg-time-stamp {
                    font-size: 0.7rem;
                    color: var(--text-muted);
                    align-self: flex-end;
                    margin-top: 0.15rem;
                }

                .msg-group.outgoing .msg-time-stamp {
                    color: rgba(255, 255, 255, 0.7);
                    align-self: flex-start;
                }

                .chat-input-area {
                    padding: 1.25rem;
                    border-top: 1px solid rgba(102, 26, 87, 0.1);
                    background: #ffffff;
                    display: flex;
                    flex-direction: column;
                    gap: 0.85rem;
                    flex-shrink: 0;
                }

                .ai-prompt-heading {
                    display: flex;
                    align-items: center;
                    gap: 0.4rem;
                    font-weight: 700;
                    font-size: 0.9rem;
                    color: var(--primary);
                }

                .ai-textarea {
                    width: 100%;
                    height: 110px;
                    border-radius: var(--radius-sm);
                    border: 1px solid #cbd5e1;
                    padding: 0.75rem;
                    font-size: 0.95rem;
                    font-family: inherit;
                    line-height: 1.5;
                    resize: none;
                    outline: none;
                    transition: var(--transition);
                }

                .ai-textarea:focus {
                    border-color: var(--primary);
                    box-shadow: 0 0 0 2px rgba(102, 26, 87, 0.1);
                }

                .ai-textarea:disabled {
                    background: #f1f5f9;
                    color: #94a3b8;
                    cursor: not-allowed;
                }

                .chat-action-buttons {
                    display: flex;
                    justify-content: flex-end;
                    gap: 0.75rem;
                }

                .chat-placeholder {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    height: 100%;
                    color: var(--text-muted);
                    padding: 3rem;
                    text-align: center;
                    background: #f8fafc;
                }

                .chat-placeholder i {
                    font-size: 4rem;
                    color: #cbd5e1;
                    margin-bottom: 1.5rem;
                }

                .chat-placeholder h3 {
                    color: var(--primary);
                    font-weight: 700;
                    margin-bottom: 0.5rem;
                }

                .crm-patient-list::-webkit-scrollbar, .chat-messages::-webkit-scrollbar {
                    width: 6px;
                }
                .crm-patient-list::-webkit-scrollbar-thumb, .chat-messages::-webkit-scrollbar-thumb {
                    background-color: rgba(102, 26, 87, 0.15);
                    border-radius: 3px;
                }
            </style>

            <div class="view-header">
                <h2>مساعد واستعلامات واتساب الطبية الذكية</h2>
                <p>محادثة حية واسترجاع السجلات مع إمكانية التوليد اليدوي الذكي لردود الأسعار والتحاليل الطبية.</p>
            </div>
            
            <div class="crm-layout">
                <!-- Sidebar Pane (Chats List) -->
                <div class="crm-sidebar">
                    <div class="crm-sidebar-card">
                        <div class="crm-sidebar-header">
                            <h3>المحادثات النشطة</h3>
                            <div style="display:flex; align-items:center; gap: 0.4rem;">
                                <!-- Pulsing WA Connection status dot -->
                                <span id="header-wa-status-dot" style="width: 10px; height: 10px; border-radius: 50%; background-color: #ff4757; box-shadow: 0 0 6px #ff4757; display: inline-block; cursor: pointer;" onclick="whatsappAI.showConnectionModal()" title="غير متصل"></span>
                                <button class="btn btn-outline" id="wa-sync-unanswered-btn" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; border-color: rgba(102, 26, 87, 0.2); cursor: pointer;" onclick="whatsappAI.loadChats()" title="تحديث المحادثات">
                                    <i class="fa-solid fa-rotate"></i> تحديث
                                </button>
                                <button class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; border-color: rgba(102, 26, 87, 0.2); cursor: pointer;" onclick="whatsappAI.showConnectionModal()" title="ربط واتساب">
                                    <i class="fa-brands fa-whatsapp"></i> الربط
                                </button>
                                ${settingsBtnHtml}
                            </div>
                        </div>
                        <div style="margin-top: 0.75rem; position: relative;">
                            <input type="text" id="wa-chat-search" class="form-control" placeholder="ابحث عن محادثة..." style="width: 100%; padding: 0.5rem 2.2rem 0.5rem 0.8rem; border: 1px solid rgba(0,0,0,0.1); border-radius: 8px; font-size: 0.85rem; outline: none; background: #f8fafc;" oninput="whatsappAI.filterChats()">
                            <i class="fa-solid fa-magnifying-glass" style="position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: #94a3b8; font-size: 0.85rem;"></i>
                        </div>
                    </div>

                    <!-- Live WhatsApp Chats List -->
                    <div id="crm-patient-queue" class="crm-patient-list">
                        <!-- Populated dynamically -->
                    </div>
                </div>

                <!-- Chat Pane (Selected Conversation & Live chat history) -->
                <div id="crm-chat-pane" class="crm-chat-window">
                    <!-- Populated dynamically -->
                </div>
            </div>
        `;

        this.loadChats();
        this.renderChatWindow();
        this.updateConnectionHeaderUI();
    }

    renderChatsList(chatsToRender = null) {
        const listContainer = document.getElementById('crm-patient-queue');
        if (!listContainer) return;
        listContainer.innerHTML = '';

        if (this.waStatus !== 'ready') {
            listContainer.innerHTML = `
                <div class="text-center text-muted" style="padding: 3rem 1rem;">
                    <i class="fa-solid fa-link-slash" style="font-size: 3rem; color: #ff4757; margin-bottom: 1rem; display:block;"></i>
                    <h4 style="font-weight: 700; color: var(--primary);">الواتساب غير متصل</h4>
                    <p style="font-size:0.85rem;">يرجى ربط حساب واتساب من زر الربط في الأعلى لمشاهدة المحادثات.</p>
                </div>
            `;
            return;
        }

        const chatsList = chatsToRender || this.chats || [];

        if (chatsList.length === 0) {
            listContainer.innerHTML = `
                <div class="text-center text-muted" style="padding: 3rem 1rem;">
                    <i class="fa-regular fa-folder-open" style="font-size: 3rem; color: #cbd5e1; margin-bottom: 1rem; display:block;"></i>
                    <h4 style="font-weight: 700; color: var(--primary);">لا توجد محادثات</h4>
                    <p style="font-size:0.85rem;">لم يتم العثور على أي محادثات مطابقة.</p>
                </div>
            `;
            return;
        }

        chatsList.forEach(chat => {
            const isSelected = this.activeChatId === chat.id;
            const initials = chat.name ? chat.name.substring(0, 2).toUpperCase() : 'W';
            
            // Format time of latest activity
            const formattedTime = chat.timestamp ? new Date(chat.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '';
            
            // Check locks status
            const isLocked = this.locks[chat.id] ? true : false;
            const lockedBy = isLocked ? this.locks[chat.id].userName : '';
            const isLockedByOther = isLocked && lockedBy !== this.getCurrentUserName();

            const card = document.createElement('div');
            card.className = `patient-card ${isSelected ? 'active' : ''}`;
            card.onclick = () => this.selectChat(chat.id);

            let lockBadgeHtml = '';
            if (isLocked) {
                lockBadgeHtml = `
                    <div class="patient-lock-badge" style="color: ${isLockedByOther ? 'var(--accent)' : '#047857'};">
                        <i class="fa-solid fa-lock"></i>
                        <span>${isLockedByOther ? `مفتوحة مع (${lockedBy})` : 'أنت تراجعها'}</span>
                    </div>
                `;
            }

            let unreadBadgeHtml = '';
            if (chat.unreadCount > 0) {
                unreadBadgeHtml = `<span class="badge badge-danger" style="margin-right: auto; padding: 0.25rem 0.5rem; border-radius: 10px; font-size: 0.75rem;">${chat.unreadCount}</span>`;
            }

            const snippet = chat.lastMessage ? chat.lastMessage.body : '';

            card.innerHTML = `
                <div class="patient-avatar">${initials}</div>
                <div class="patient-details">
                    <div class="patient-name-row">
                        <span class="patient-name">${chat.name}</span>
                        <span class="patient-time">${formattedTime}</span>
                    </div>
                    <div style="display:flex; align-items:center; justify-content:space-between; gap: 0.5rem; width: 100%;">
                        <span class="patient-msg-snippet" style="flex-grow:1; max-width:200px;">${snippet || '[وسائط]'}</span>
                        ${unreadBadgeHtml}
                    </div>
                    ${lockBadgeHtml}
                </div>
            `;
            listContainer.appendChild(card);
        });
    }

    renderChatWindow() {
        const chatPane = document.getElementById('crm-chat-pane');
        if (!chatPane) return;

        if (!this.activeChatId) {
            chatPane.innerHTML = `
                <div class="chat-placeholder">
                    <i class="fa-regular fa-comments"></i>
                    <h3>مرحباً بك في مركز استلام استفسارات واتساب</h3>
                    <p class="text-muted" style="max-width: 400px; margin: 0 auto;">الرجاء اختيار أحد المرضى من قائمة المحادثات النشطة على اليمين لمراجعة تفاصيل الاستفسار والتحكم بالردود.</p>
                </div>
            `;
            return;
        }

        const activeChat = this.chats ? this.chats.find(c => c.id === this.activeChatId) : null;
        const chatName = activeChat ? activeChat.name : this.activeChatId.replace('@c.us', '');

        // Check Lock Status
        const lockInfo = this.locks[this.activeChatId];
        const isLocked = lockInfo ? true : false;
        const lockedBy = isLocked ? lockInfo.userName : '';
        const isLockedByOther = isLocked && lockedBy !== this.getCurrentUserName();

        // 1. Render Header
        let headerHtml = `
            <div class="chat-header">
                <div class="chat-header-info">
                    <h3>${chatName}</h3>
                    <p>${this.activeChatId.replace('@c.us', '')}</p>
                </div>
                <div>
                    <button class="btn btn-outline" style="border-color: rgba(102, 26, 87, 0.15); padding: 0.4rem 0.8rem; font-size: 0.85rem;" onclick="whatsappAI.loadChatHistory('${this.activeChatId}')">
                        <i class="fa-solid fa-rotate"></i> تحديث السجل
                    </button>
                </div>
            </div>
        `;

        // 2. Render Lock Banner
        let bannerHtml = '';
        if (isLocked) {
            if (isLockedByOther) {
                bannerHtml = `
                    <div class="chat-banner locked-by-other">
                        <i class="fa-solid fa-lock"></i>
                        <span>تنبيه: الموظف (${lockedBy}) يراجع هذه المحادثة حالياً. تم قفل المحادثة لتجنب إرسال ردود مكررة للمريض.</span>
                    </div>
                `;
            } else {
                bannerHtml = `
                    <div class="chat-banner locked-by-me">
                        <i class="fa-solid fa-lock-open"></i>
                        <span>أنت تراجع هذه التذكرة حالياً. قفل نشط لمنع زملائك من التدخل في الرد.</span>
                    </div>
                `;
            }
        }

        // 3. Render Message History Box
        let messagesHtml = '';
        if (this.isLoadingHistory) {
            messagesHtml = `
                <div style="display:flex; flex-direction:column; justify-content:center; align-items:center; height:100%; color:var(--text-muted);">
                    <i class="fa-solid fa-circle-notch fa-spin fa-3x" style="color:var(--primary); margin-bottom:1rem;"></i>
                    <p style="font-weight:600;">جاري استرجاع سجل المحادثة بالكامل من هاتف الواتساب...</p>
                </div>
            `;
        } else if (this.chatHistory.length === 0) {
            messagesHtml = `
                <div class="text-center text-muted" style="padding: 4rem 1rem;">
                    <p>لا توجد رسائل مسترجعة حديثة في سجل الواتساب.</p>
                </div>
            `;
        } else {
            const bubbles = this.chatHistory.map(msg => {
                let mediaHtml = '';
                if (msg.hasMedia) {
                    if (msg.mediaData) {
                        const mime = msg.mediaData.startsWith('iVBORw0KG') ? 'image/png' : 'image/jpeg';
                        mediaHtml = `
                            <div style="position: relative; margin-top: 0.5rem; border-radius: 8px; overflow: hidden; border: 1px solid rgba(0,0,0,0.1); max-width: 280px; background:#000;">
                                <img src="data:${mime};base64,${msg.mediaData}" style="width: 100%; max-height: 200px; object-fit: contain; cursor: pointer; display: block;" onclick="whatsappAI.downloadImage('${msg.mediaData}', '${mime}', 'prescription-${msg.id}.png')" title="اضغط لتحميل الصورة">
                                <div style="position: absolute; bottom: 8px; left: 8px; background: rgba(0,0,0,0.6); color: #fff; padding: 4px 8px; border-radius: 4px; font-size: 0.75rem; cursor: pointer; pointer-events: none; display: flex; align-items: center; gap: 0.25rem;">
                                    <i class="fa-solid fa-download"></i>
                                    <span>تحميل</span>
                                </div>
                            </div>
                        `;
                    } else {
                        const containerId = `media-container-${msg.id}`;
                        mediaHtml = `
                            <div id="${containerId}" style="margin-top: 0.5rem; display: flex; align-items: center; gap: 0.5rem; background: #f1f5f9; padding: 0.75rem; border-radius: 8px; border: 1px dashed #cbd5e1; max-width: 280px;">
                                <i class="fa-regular fa-image fa-2x" style="color: #94a3b8;"></i>
                                <div style="flex-grow: 1;">
                                    <div style="font-size: 0.85rem; font-weight: 700; color: var(--text-main);">صورة مرفقة</div>
                                    <button class="btn btn-outline" style="padding: 0.2rem 0.5rem; font-size: 0.75rem; margin-top: 0.25rem; cursor: pointer;" onclick="whatsappAI.lazyLoadMedia('${this.activeChatId}', '${msg.id}', '${containerId}')">
                                        <i class="fa-solid fa-download"></i> تحميل وعرض الصورة
                                    </button>
                                </div>
                            </div>
                        `;
                    }
                }

                const directionClass = msg.fromMe ? 'outgoing' : 'incoming';
                const bodyHtml = msg.body ? `<div>${msg.body.replace(/\n/g, '<br>')}</div>` : '';

                let aiGenButtonHtml = '';
                let checkboxHtml = '';
                if (!msg.fromMe) {
                    const btnId = `ai-gen-btn-${msg.id}`;
                    // Escape single quotes and newlines safely for JSON/string arguments in HTML
                    const escapedBody = (msg.body || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
                    const mediaArg = msg.mediaData ? `'${msg.mediaData}'` : 'null';
                    
                    aiGenButtonHtml = `
                        <div style="margin-top: 0.5rem; text-align: left;">
                            <button id="${btnId}" class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; border-color: rgba(102, 26, 87, 0.25); color: var(--primary); cursor: pointer;" onclick="whatsappAI.generateAIResponseForMessage('${escapedBody}', ${mediaArg}, ${msg.hasMedia}, '${btnId}')">
                                <i class="fa-solid fa-wand-magic-sparkles"></i> توليد رد بالذكاء الاصطناعي
                            </button>
                        </div>
                    `;

                    checkboxHtml = `
                        <input type="checkbox" class="msg-selector-checkbox" 
                            data-msg-id="${msg.id}" 
                            data-msg-body="${encodeURIComponent(msg.body || '')}" 
                            data-msg-media="${msg.mediaData || ''}" 
                            data-msg-hasmedia="${msg.hasMedia}" 
                            style="margin-left: 12px; cursor: pointer; width: 18px; height: 18px; accent-color: var(--primary); flex-shrink: 0;" 
                            onchange="whatsappAI.updateSelectedMessagesCount()">
                    `;
                }

                return `
                    <div style="display: flex; align-items: center; justify-content: ${msg.fromMe ? 'flex-end' : 'flex-start'}; gap: 0.25rem; width: 100%;">
                        ${checkboxHtml}
                        <div class="msg-group ${directionClass}" style="flex-grow: 0;">
                            <div class="msg-bubble">
                                ${bodyHtml}
                                ${mediaHtml}
                                ${aiGenButtonHtml}
                            </div>
                            <span class="msg-time-stamp">${new Date(msg.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                    </div>
                `;
            }).join('');
            messagesHtml = bubbles;
        }

        const isInputDisabled = isLockedByOther;

        let inputAreaHtml = `
            <div class="chat-input-area">
                <div id="ai-batch-generator-bar" style="display: flex; align-items: center; justify-content: space-between; background: #f8fafc; padding: 0.5rem 1rem; border-radius: 8px; margin-bottom: 0.5rem; border: 1px solid rgba(0,0,0,0.06); width: 100%;">
                    <span style="font-size: 0.85rem; font-weight: 700; color: var(--primary); display: flex; align-items: center; gap: 0.4rem;">
                        <i class="fa-solid fa-square-check"></i> 
                        <span>الرسائل المحددة للرد: <span id="selected-msg-count">0</span></span>
                    </span>
                    <button id="ai-batch-gen-btn" class="btn btn-outline" style="padding: 0.3rem 0.8rem; font-size: 0.8rem; border-color: var(--primary); color: var(--primary); font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 0.3rem;" onclick="whatsappAI.generateAIResponseForSelected()" disabled>
                        <i class="fa-solid fa-wand-magic-sparkles"></i>
                        <span>توليد رد موحد للمحدّد</span>
                    </button>
                </div>
                <div class="ai-prompt-heading">
                    <i class="fa-solid fa-keyboard"></i>
                    <span>الرد الطبي للمريض:</span>
                </div>
                <textarea id="chat-reply-input" class="ai-textarea" placeholder="اكتب ردك الطبي هنا للمريض، أو حدد مجموعة رسائل في الأعلى واضغط على زر توليد رد موحد..." ${isInputDisabled ? 'disabled' : ''}></textarea>
                <div class="chat-action-buttons">
                    <button class="btn btn-danger" style="padding: 0.5rem 1.25rem; border-radius: 8px; font-weight: 700; display:flex; align-items:center; gap:0.4rem; cursor:pointer;" onclick="document.getElementById('chat-reply-input').value = ''" ${isInputDisabled ? 'disabled' : ''}>
                        <i class="fa-solid fa-eraser"></i> مسح الحقل
                    </button>
                    <button id="chat-send-btn" class="cyber-btn" style="padding:0; height: 38px; width: 180px;" onclick="whatsappAI.sendDirectResponse()" ${isInputDisabled ? 'disabled' : ''}>
                        <div class="cyber-btn-bg" style="background: ${isInputDisabled ? '#94a3b8' : 'linear-gradient(90deg, #00d2ff, var(--primary));'}"></div>
                        <div class="cyber-btn-inner" style="background: ${isInputDisabled ? '#cbd5e1' : '#ffffff; color: var(--primary); border: 1px solid rgba(102, 26, 87, 0.2)'}; border-radius: 6px;"><i class="fa-solid fa-paper-plane"></i> إرسال الرد للمريض</div>
                    </button>
                </div>
            </div>
        `;

        chatPane.innerHTML = `
            ${headerHtml}
            ${bannerHtml}
            <div id="chat-messages-container" class="chat-messages">
                ${messagesHtml}
            </div>
            ${inputAreaHtml}
        `;
    }
}

window.whatsappAI = new WhatsAppAI();
