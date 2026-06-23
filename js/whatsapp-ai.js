// js/whatsapp-ai.js
class WhatsAppAI {
    constructor() {
        this.socket = null;
        this.drafts = [];
        this.settings = {
            api_key: '',
            system_instruction: '',
            personal_chats_enabled: 1,
            groups_whitelist: ''
        };
        this.waStatus = 'disconnected';
        this.activeChatId = null;
        this.activeDraftId = null;
        this.chatHistory = [];
        this.isLoadingHistory = false;
        this.locks = {}; // JID -> { userName }
        this.navHooked = false;
    }

    init() {
        // Connect Socket.io
        if (typeof io !== 'undefined') {
            this.socket = io();
            this.setupSocketListeners();
        } else {
            console.error('Socket.io is not loaded.');
        }

        // Fetch Initial Settings and Drafts
        this.loadSettings();
        this.loadDrafts();

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
            this.activeDraftId = null;
            this.chatHistory = [];
        }
    }

    async syncTestsToBackend() {
        try {
            const tests = window.storage ? window.storage.getTests() : [];
            if (tests.length > 0) {
                console.log(`Sending ${tests.length} tests to backend to sync...`);
                await fetch('/api/medical-services/sync', {
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
        });

        this.socket.on('wa_qr', (data) => {
            this.renderQR(data.url);
        });

        this.socket.on('new_ai_draft', (draft) => {
            this.drafts.unshift(draft);
            this.updateBadge();
            this.renderDraftsList();
            
            // If the new draft belongs to the currently open chat, update the active draft ID
            if (this.activeChatId === draft.chat_id) {
                this.activeDraftId = draft.id;
                this.renderChatWindow();
            }

            if (window.app && typeof window.app.showToast === 'function') {
                window.app.showToast('لديك استفسار مريض جديد ينتظر المراجعة عبر واتساب!', 'info');
            }
        });

        // Ticket locks synchronization
        this.socket.on('active_locks', (locks) => {
            this.locks = locks;
            this.renderDraftsList();
            this.renderChatWindow();
        });

        this.socket.on('chat_locked', (data) => {
            this.locks[data.chatId] = { userName: data.userName };
            this.renderDraftsList();
            if (this.activeChatId === data.chatId) {
                this.renderChatWindow();
            }
        });

        this.socket.on('chat_unlocked', (data) => {
            delete this.locks[data.chatId];
            this.renderDraftsList();
            if (this.activeChatId === data.chatId) {
                this.renderChatWindow();
            }
        });
    }

    async loadSettings() {
        try {
            const res = await fetch('/api/ai/settings');
            const json = await res.json();
            if (json.status === 'success' && json.data) {
                this.settings = { ...this.settings, ...json.data };
            }
        } catch (e) {
            console.error('Failed to load AI settings:', e);
        }
    }

    async saveSettingsFromModal() {
        const apiKey = document.getElementById('wa-api-key').value.trim();
        const prompt = document.getElementById('wa-prompt').value.trim();
        const personalEnabled = document.getElementById('wa-personal-chats').checked ? 1 : 0;
        const whitelist = document.getElementById('wa-whitelist').value.trim();

        try {
            const response = await fetch('/api/ai/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    api_key: apiKey,
                    system_instruction: prompt,
                    personal_chats_enabled: personalEnabled,
                    groups_whitelist: whitelist
                })
            });

            const json = await response.json();
            if (json.status === 'success') {
                this.settings = {
                    api_key: apiKey,
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

    async loadDrafts() {
        try {
            const res = await fetch('/api/ai/drafts');
            const json = await res.json();
            if (json.status === 'success' && json.data) {
                this.drafts = json.data;
                this.updateBadge();
                this.renderDraftsList();
            }
        } catch (e) {
            console.error('Failed to load drafts:', e);
        }
    }

    updateBadge() {
        const badge = document.getElementById('wa-drafts-badge');
        if (badge) {
            // Group unique chats for counting
            const uniqueChats = this.getUniqueChats();
            const count = uniqueChats.length;
            if (count > 0) {
                badge.textContent = count;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    getCurrentUserName() {
        return (window.app && window.app.currentUser) ? window.app.currentUser.name : 'موظف';
    }

    getUniqueChats() {
        const chatMap = {};
        this.drafts.forEach(draft => {
            if (!chatMap[draft.chat_id]) {
                chatMap[draft.chat_id] = draft;
            } else {
                // Keep the latest draft for this chat
                if (new Date(draft.created_at) > new Date(chatMap[draft.chat_id].created_at)) {
                    chatMap[draft.chat_id] = draft;
                }
            }
        });
        return Object.values(chatMap).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    async selectChat(chatId) {
        if (this.activeChatId === chatId) return;

        // Release old lock if any
        if (this.activeChatId) {
            this.socket.emit('unlock_chat', { chatId: this.activeChatId, userName: this.getCurrentUserName() });
        }

        this.activeChatId = chatId;
        
        // Find latest draft details for this chat
        const uniqueDrafts = this.getUniqueChats();
        const draft = uniqueDrafts.find(d => d.chat_id === chatId);
        this.activeDraftId = draft ? draft.id : null;

        // Reset history and render loading state
        this.chatHistory = [];
        this.isLoadingHistory = true;
        this.renderChatWindow();
        this.renderDraftsList(); // updates active highlighting

        // Lock chat on socket
        this.socket.emit('lock_chat', { chatId: chatId, userName: this.getCurrentUserName() });

        try {
            const response = await fetch(`/api/wa/chat-history/${encodeURIComponent(chatId)}`);
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

    async startWhatsApp() {
        try {
            if (window.app) window.app.showToast('جاري بدء تشغيل العميل وتوليد رمز QR...', 'info');
            const res = await fetch('/api/wa/initialize', { method: 'POST' });
            const json = await res.json();
            console.log(json.message);
        } catch (e) {
            console.error(e);
        }
    }

    async approveActiveDraft() {
        const id = this.activeDraftId;
        if (!id) return;

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
            const response = await fetch(`/api/ai/drafts/${id}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reply_text: replyText })
            });

            const json = await response.json();
            if (json.status === 'success') {
                const chat_id = this.activeChatId;
                // Remove all drafts for this chat_id locally
                this.drafts = this.drafts.filter(d => d.chat_id !== chat_id);
                this.updateBadge();

                // Release lock
                this.socket.emit('unlock_chat', { chatId: chat_id, userName: this.getCurrentUserName() });
                
                this.activeChatId = null;
                this.activeDraftId = null;
                this.chatHistory = [];
                
                this.renderDraftsList();
                this.renderChatWindow();
                if (window.app) window.app.showToast('تم إرسال الرد للمريض بنجاح', 'success');
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

    async dismissActiveDraft() {
        const id = this.activeDraftId;
        if (!id) return;
        if (!confirm('هل أنت متأكد من تجاهل وحذف هذا الرد المقترح؟')) return;

        try {
            const response = await fetch(`/api/ai/drafts/${id}`, { method: 'DELETE' });
            const json = await response.json();
            if (json.status === 'success') {
                const chat_id = this.activeChatId;
                this.drafts = this.drafts.filter(d => d.id !== id);
                this.updateBadge();

                const remainingDrafts = this.drafts.filter(d => d.chat_id === chat_id);
                if (remainingDrafts.length === 0) {
                    this.socket.emit('unlock_chat', { chatId: chat_id, userName: this.getCurrentUserName() });
                    this.activeChatId = null;
                    this.activeDraftId = null;
                    this.chatHistory = [];
                } else {
                    const uniqueDrafts = this.getUniqueChats();
                    const nextDraft = uniqueDrafts.find(d => d.chat_id === chat_id);
                    this.activeDraftId = nextDraft ? nextDraft.id : null;
                }

                this.renderDraftsList();
                this.renderChatWindow();
                if (window.app) window.app.showToast('تم تجاهل الرد بنجاح', 'success');
            }
        } catch (e) {
            console.error(e);
        }
    }

    showSettingsModal() {
        const modalHtml = `
            <div style="display: flex; flex-direction: column; gap: 1.25rem; padding: 0.5rem 0;">
                <div class="form-group-modal">
                    <label style="font-weight: 700; color: var(--primary); display: block; margin-bottom: 0.5rem;">Gemini API Key</label>
                    <input type="password" id="wa-api-key" class="neon-input" value="${this.settings.api_key || ''}" placeholder="أدخل مفتاح الـ API الخاص بـ Gemini..." style="direction: ltr; font-family: monospace; width: 100%; border: 1px solid #cbd5e1; border-radius: 8px; padding: 0.65rem 0.8rem;">
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
            actionBtnHtml = `
                <div class="text-center" style="color: #2ed573; padding: 1rem 0; font-weight: bold;">
                    <i class="fa-solid fa-circle-check fa-4x" style="display:block; margin-bottom: 0.75rem;"></i>
                    <span>المنصة متصلة بالواتساب وتعمل الآن في الخلفية بنجاح</span>
                </div>
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
                    margin-bottom: 0.5rem;
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
                    color: #0d9488;
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
                <h2>مساعد واتساب الطبي الذكي المركزي</h2>
                <p>مراجعة واسترجاع المحادثات والردود الطبية الذكية للمرضى من رقم واتساب المربوط بالمنصة.</p>
            </div>
            
            <div class="crm-layout">
                <!-- Sidebar Pane (Unique Patients Queue) -->
                <div class="crm-sidebar">
                    <div class="crm-sidebar-card">
                        <div class="crm-sidebar-header">
                            <h3>المحادثات المعلقة</h3>
                            <div style="display:flex; align-items:center; gap: 0.4rem;">
                                <!-- Pulsing WA Connection status dot -->
                                <span id="header-wa-status-dot" style="width: 10px; height: 10px; border-radius: 50%; background-color: #ff4757; box-shadow: 0 0 6px #ff4757; display: inline-block; cursor: pointer;" onclick="whatsappAI.showConnectionModal()" title="غير متصل"></span>
                                <button class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; border-color: rgba(102, 26, 87, 0.2); cursor: pointer;" onclick="whatsappAI.showConnectionModal()" title="ربط واتساب">
                                    <i class="fa-brands fa-whatsapp"></i> الربط
                                </button>
                                <button class="btn btn-outline" style="padding: 0.25rem 0.5rem; font-size: 0.8rem; border-color: rgba(102, 26, 87, 0.2); cursor: pointer;" onclick="whatsappAI.showSettingsModal()" title="إعدادات المساعد">
                                    <i class="fa-solid fa-gear"></i>
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Unique Patients List -->
                    <div id="crm-patient-queue" class="crm-patient-list">
                        <!-- Populated dynamically -->
                    </div>
                </div>

                <!-- Chat Pane (Selected Conversation & AI suggestion) -->
                <div id="crm-chat-pane" class="crm-chat-window">
                    <!-- Populated dynamically -->
                </div>
            </div>
        `;

        this.renderDraftsList();
        this.renderChatWindow();
        this.updateConnectionHeaderUI();
    }

    renderDraftsList() {
        const listContainer = document.getElementById('crm-patient-queue');
        if (!listContainer) return;
        listContainer.innerHTML = '';

        const uniqueChats = this.getUniqueChats();

        if (uniqueChats.length === 0) {
            listContainer.innerHTML = `
                <div class="text-center text-muted" style="padding: 3rem 1rem;">
                    <i class="fa-solid fa-circle-check" style="font-size: 3rem; color: #2ed573; margin-bottom: 1rem; display:block;"></i>
                    <h4 style="font-weight: 700; color: var(--primary);">لا توجد تذاكر معلقة</h4>
                    <p style="font-size:0.85rem;">جميع استفسارات المرضى تمت معالجتها بنجاح!</p>
                </div>
            `;
            return;
        }

        uniqueChats.forEach(draft => {
            const isSelected = this.activeChatId === draft.chat_id;
            const initials = draft.chat_name.substring(0, 2).toUpperCase();
            
            // Format time of latest draft
            const formattedTime = new Date(draft.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
            
            // Check locks status
            const isLocked = this.locks[draft.chat_id] ? true : false;
            const lockedBy = isLocked ? this.locks[draft.chat_id].userName : '';
            const isLockedByOther = isLocked && lockedBy !== this.getCurrentUserName();

            const card = document.createElement('div');
            card.className = `patient-card ${isSelected ? 'active' : ''}`;
            card.onclick = () => this.selectChat(draft.chat_id);

            let lockBadgeHtml = '';
            if (isLocked) {
                lockBadgeHtml = `
                    <div class="patient-lock-badge" style="color: ${isLockedByOther ? 'var(--accent)' : '#047857'};">
                        <i class="fa-solid fa-lock"></i>
                        <span>${isLockedByOther ? `مفتوحة مع (${lockedBy})` : 'أنت تراجعها'}</span>
                    </div>
                `;
            }

            card.innerHTML = `
                <div class="patient-avatar">${initials}</div>
                <div class="patient-details">
                    <div class="patient-name-row">
                        <span class="patient-name">${draft.chat_name}</span>
                        <span class="patient-time">${formattedTime}</span>
                    </div>
                    <div class="patient-msg-snippet">${draft.message_body || '💡 أرسل صورة روشتة فقط'}</div>
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
                    <p class="text-muted" style="max-width: 400px; margin: 0 auto;">الرجاء اختيار أحد المرضى من قائمة المحادثات المعلقة على اليمين لمراجعة تفاصيل الاستفسار والرد الطبي المولد بالذكاء الاصطناعي.</p>
                </div>
            `;
            return;
        }

        const uniqueChats = this.getUniqueChats();
        const activeDraft = uniqueChats.find(d => d.chat_id === this.activeChatId);

        if (!activeDraft) {
            // fallback if active chat is no longer in drafts queue
            this.activeChatId = null;
            this.renderChatWindow();
            return;
        }

        // Check Lock Status
        const lockInfo = this.locks[this.activeChatId];
        const isLocked = lockInfo ? true : false;
        const lockedBy = isLocked ? lockInfo.userName : '';
        const isLockedByOther = isLocked && lockedBy !== this.getCurrentUserName();

        // 1. Render Header
        let headerHtml = `
            <div class="chat-header">
                <div class="chat-header-info">
                    <h3>${activeDraft.chat_name}</h3>
                    <p>${this.activeChatId.replace('@c.us', '')}</p>
                </div>
                <div>
                    <button class="btn btn-outline" style="border-color: rgba(102, 26, 87, 0.15); padding: 0.4rem 0.8rem; font-size: 0.85rem;" onclick="whatsappAI.selectChat('${this.activeChatId}')">
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
                    <p>لا يوجد رسائل مسترجعة حديثة في سجل الواتساب.</p>
                </div>
            `;
        } else {
            const bubbles = this.chatHistory.map(msg => {
                let mediaHtml = '';
                if (msg.hasMedia && msg.mediaData) {
                    const mime = msg.mediaData.startsWith('iVBORw0KG') ? 'image/png' : 'image/jpeg';
                    mediaHtml = `
                        <div style="margin-top: 0.5rem; border-radius: 8px; overflow: hidden; border: 1px solid rgba(0,0,0,0.1); max-width: 280px; background:#000;">
                            <img src="data:${mime};base64,${msg.mediaData}" style="width: 100%; max-height: 200px; object-fit: contain; cursor: pointer;" onclick="window.open(this.src)">
                        </div>
                    `;
                }

                const directionClass = msg.fromMe ? 'outgoing' : 'incoming';
                const bodyHtml = msg.body ? `<div>${msg.body.replace(/\n/g, '<br>')}</div>` : '';

                return `
                    <div class="msg-group ${directionClass}">
                        <div class="msg-bubble">
                            ${bodyHtml}
                            ${mediaHtml}
                        </div>
                        <span class="msg-time-stamp">${new Date(msg.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                `;
            }).join('');
            messagesHtml = bubbles;
        }

        // 4. Render AI suggested reply & text area
        let prescriptionPreviewHtml = '';
        if (activeDraft.media_data) {
            const mime = activeDraft.media_data.startsWith('iVBORw0KG') ? 'image/png' : 'image/jpeg';
            prescriptionPreviewHtml = `
                <div style="background:#f8fafc; padding: 0.5rem; border-radius: 8px; border: 1px dashed rgba(102, 26, 87, 0.2); max-width: 250px; margin-bottom: 0.5rem;">
                    <span style="font-size:0.8rem; font-weight:700; color:var(--primary); display:block; margin-bottom: 0.25rem;"><i class="fa-solid fa-image"></i> الروشتة المرفقة بالاستفسار:</span>
                    <img src="data:${mime};base64,${activeDraft.media_data}" style="width:100%; max-height:120px; object-fit:contain; border-radius:6px; cursor:pointer;" onclick="window.open(this.src)">
                </div>
            `;
        }

        const isInputDisabled = isLockedByOther;

        let inputAreaHtml = `
            <div class="chat-input-area">
                ${prescriptionPreviewHtml}
                <div class="ai-prompt-heading">
                    <i class="fa-solid fa-wand-magic-sparkles"></i>
                    <span>الرد المقترح من المساعد الطبي الذكي:</span>
                </div>
                <textarea id="chat-reply-input" class="ai-textarea" placeholder="اكتب الرد هنا لمراجعته وإرساله..." ${isInputDisabled ? 'disabled' : ''}>${activeDraft.suggested_reply}</textarea>
                <div class="chat-action-buttons">
                    <button class="btn btn-danger" style="padding: 0.5rem 1.25rem; border-radius: 8px; font-weight: 700; display:flex; align-items:center; gap:0.4rem; cursor:pointer;" onclick="whatsappAI.dismissActiveDraft()" ${isInputDisabled ? 'disabled' : ''}>
                        <i class="fa-solid fa-trash-can"></i> تجاهل المسودة
                    </button>
                    <button id="chat-send-btn" class="cyber-btn" style="padding:0; height: 38px; width: 180px;" onclick="whatsappAI.approveActiveDraft()" ${isInputDisabled ? 'disabled' : ''}>
                        <div class="cyber-btn-bg" style="background: ${isInputDisabled ? '#94a3b8' : 'linear-gradient(90deg, #00d2ff, var(--primary));'}"></div>
                        <div class="cyber-btn-inner" style="background: ${isInputDisabled ? '#cbd5e1' : '#ffffff; color: var(--primary); border: 1px solid rgba(102, 26, 87, 0.2)'}; border-radius: 6px;"><i class="fa-solid fa-paper-plane"></i> إرسال وتأكيد الرد</div>
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
