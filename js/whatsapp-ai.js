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
        this.activeTab = 'drafts';
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

        // Sync tests to backend as a backup
        setTimeout(() => this.syncTestsToBackend(), 2000); // 2 second delay to let storage initialize
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
            this.renderConnectionPanel();
        });

        this.socket.on('wa_qr', (data) => {
            this.renderQR(data.url);
        });

        this.socket.on('new_ai_draft', (draft) => {
            this.drafts.unshift(draft);
            this.updateBadge();
            if (this.activeTab === 'drafts') {
                this.renderDraftsList();
            }
            if (window.app && typeof window.app.showToast === 'function') {
                window.app.showToast('لديك استفسار مريض جديد ينتظر المراجعة عبر واتساب!', 'info');
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

    async saveSettings() {
        try {
            const apiKey = document.getElementById('wa-api-key').value.trim();
            const prompt = document.getElementById('wa-prompt').value.trim();
            const personalEnabled = document.getElementById('wa-personal-chats').checked ? 1 : 0;
            const whitelist = document.getElementById('wa-whitelist').value.trim();

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
                if (window.app) window.app.showToast('تم حفظ الإعدادات بنجاح', 'success');
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
                if (this.activeTab === 'drafts') {
                    this.renderDraftsList();
                }
            }
        } catch (e) {
            console.error('Failed to load drafts:', e);
        }
    }

    updateBadge() {
        const badge = document.getElementById('wa-drafts-badge');
        if (badge) {
            const count = this.drafts.length;
            if (count > 0) {
                badge.textContent = count;
                badge.style.display = 'inline-block';
            } else {
                badge.style.display = 'none';
            }
        }
    }

    switchTab(tabName) {
        this.activeTab = tabName;
        const draftsBtn = document.querySelectorAll('.tab-btn')[0];
        const settingsBtn = document.querySelectorAll('.tab-btn')[1];
        
        const draftsTab = document.getElementById('wa-tab-drafts');
        const settingsTab = document.getElementById('wa-tab-settings');

        if (tabName === 'drafts') {
            draftsBtn.classList.add('active');
            draftsBtn.style.color = 'var(--text-main)';
            settingsBtn.classList.remove('active');
            settingsBtn.style.color = 'var(--text-muted)';

            draftsTab.style.display = 'block';
            settingsTab.style.display = 'none';
            this.renderDraftsList();
        } else {
            settingsBtn.classList.add('active');
            settingsBtn.style.color = 'var(--text-main)';
            draftsBtn.classList.remove('active');
            draftsBtn.style.color = 'var(--text-muted)';

            settingsTab.style.display = 'block';
            draftsTab.style.display = 'none';
            this.renderSettingsPanel();
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

    async approveDraft(id) {
        const replyText = document.getElementById(`reply-input-${id}`).value.trim();
        if (!replyText) {
            if (window.app) window.app.showToast('الرجاء إدخال رد قبل الإرسال', 'error');
            return;
        }

        const btn = document.getElementById(`approve-btn-${id}`);
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
                this.drafts = this.drafts.filter(d => d.id !== id);
                this.updateBadge();
                this.renderDraftsList();
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

    async dismissDraft(id) {
        if (!confirm('هل أنت متأكد من تجاهل وحذف هذا الرد المقترح؟')) return;

        try {
            const response = await fetch(`/api/ai/drafts/${id}`, { method: 'DELETE' });
            const json = await response.json();
            if (json.status === 'success') {
                this.drafts = this.drafts.filter(d => d.id !== id);
                this.updateBadge();
                this.renderDraftsList();
                if (window.app) window.app.showToast('تم تجاهل الرد بنجاح', 'success');
            }
        } catch (e) {
            console.error(e);
        }
    }

    render(container) {
        container.innerHTML = `
            <div class="view-header">
                <h2>مساعد واتساب الطبي الذكي (عيادة الطاهرة)</h2>
                <p>مراجعة استفسارات المرضى حول أسعار التحاليل والأشعة والتعليمات الطبية وتأكيد إرسالها.</p>
            </div>
            
            <div class="whatsapp-ai-container" style="display: grid; grid-template-columns: 1fr 360px; gap: 1.5rem; margin-top: 1rem; align-items: start;">
                <!-- Main/Right Column -->
                <div class="main-column" style="display: flex; flex-direction: column; gap: 1rem;">
                    <!-- Tab Headers -->
                    <div class="tabs-nav glass-panel" style="display: flex; gap: 1.5rem; padding: 1rem 1.5rem; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);">
                        <button class="tab-btn active" onclick="whatsappAI.switchTab('drafts')" style="background: none; border: none; color: var(--secondary); font-weight: bold; cursor: pointer; font-size: 1.05rem; font-family: inherit; transition: var(--transition);">📋 طلبات الردود المعلقة</button>
                        <button class="tab-btn" onclick="whatsappAI.switchTab('settings')" style="background: none; border: none; color: var(--text-muted); font-weight: bold; cursor: pointer; font-size: 1.05rem; font-family: inherit; transition: var(--transition);">⚙️ إعدادات الذكاء الاصطناعي</button>
                    </div>

                    <!-- Tab Content: Drafts Queue -->
                    <div id="wa-tab-drafts" class="tab-content">
                        <div id="drafts-queue-list" class="drafts-queue-list" style="display: flex; flex-direction: column; gap: 1.25rem;">
                            <!-- Injected dynamically -->
                        </div>
                    </div>

                    <!-- Tab Content: Settings -->
                    <div id="wa-tab-settings" class="tab-content" style="display: none;">
                        <!-- Injected dynamically -->
                    </div>
                </div>

                <!-- Side Column: Status & QR -->
                <div class="side-column" id="wa-connection-panel">
                    <!-- Injected dynamically -->
                </div>
            </div>
        `;

        this.renderDraftsList();
        this.renderConnectionPanel();
    }

    renderDraftsList() {
        const listContainer = document.getElementById('drafts-queue-list');
        if (!listContainer) return;
        listContainer.innerHTML = '';

        if (this.drafts.length === 0) {
            listContainer.innerHTML = `
                <div class="glass-panel text-center" style="padding: 3rem; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);">
                    <i class="fa-solid fa-circle-check" style="font-size: 3.5rem; color: #00ffcc; margin-bottom: 1rem;"></i>
                    <h3 style="color: var(--secondary); margin-bottom: 0.5rem;">لا توجد رسائل معلقة!</h3>
                    <p class="text-muted">الذكاء الاصطناعي لا يجد أي رسائل واردة تحتاج لمراجعتك حالياً.</p>
                </div>
            `;
            return;
        }

        this.drafts.forEach(draft => {
            const card = document.createElement('div');
            card.className = 'glass-panel draft-card';
            card.style.cssText = `
                padding: 1.5rem; 
                border-radius: 16px; 
                border: 1px solid rgba(255,255,255,0.1); 
                background: rgba(255,255,255,0.03); 
                display: flex; 
                flex-direction: column; 
                gap: 1rem;
                position: relative;
            `;

            // Handle Prescription Image Preview
            let imageHtml = '';
            if (draft.media_data) {
                // Determine mime type, default to jpeg
                const mime = draft.media_data.startsWith('iVBORw0KG') ? 'image/png' : 'image/jpeg';
                imageHtml = `
                    <div class="prescription-preview" style="margin-bottom: 0.5rem; border-radius: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,0.15); max-width: 300px;">
                        <span style="display: block; background: rgba(0,0,0,0.3); padding: 0.25rem 0.5rem; font-size: 0.8rem; color: #00fff7; font-weight: bold;"><i class="fa-solid fa-image"></i> روشتة مبعوتة من المريض:</span>
                        <img src="data:${mime};base64,${draft.media_data}" alt="Prescription" style="width: 100%; max-height: 250px; object-fit: contain; cursor: pointer; background: #000;" onclick="window.open(this.src)">
                    </div>
                `;
            }

            const formattedTime = new Date(draft.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

            card.innerHTML = `
                <div class="draft-card-header" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.75rem;">
                    <div>
                        <h4 style="color: #00fff7; margin-bottom: 0.25rem;"><i class="fa-solid fa-user"></i> مريض: ${draft.chat_name}</h4>
                        <span class="text-muted" style="font-size: 0.8rem; direction: ltr; display: inline-block;">${draft.chat_id.replace('@c.us', '')}</span>
                    </div>
                    <span class="badge" style="background: rgba(0,255,247,0.1); color: #00fff7; font-size: 0.8rem; padding: 0.4rem 0.8rem; border-radius: 8px;">${formattedTime}</span>
                </div>

                <div class="patient-query" style="background: rgba(255,255,255,0.02); padding: 0.85rem; border-radius: 12px; border-right: 4px solid var(--primary); font-size: 0.95rem;">
                    <strong style="color: var(--secondary); display: block; margin-bottom: 0.25rem;">استفسار المريض:</strong>
                    <span style="color: #d1d5db;">${draft.message_body || '💡 المريض أرسل صورة فقط (بدون نص)'}</span>
                </div>

                ${imageHtml}

                <div class="ai-suggestion" style="display: flex; flex-direction: column; gap: 0.5rem;">
                    <label style="color: #00ffcc; font-weight: bold; font-size: 0.95rem;"><i class="fa-solid fa-wand-magic-sparkles"></i> الرد الطبي المقترح:</label>
                    <textarea id="reply-input-${draft.id}" class="neon-input" style="width: 100%; height: 120px; border-radius: 12px; background: rgba(0,0,0,0.2); border: 1px solid rgba(0,255,247,0.2); color: #fff; padding: 0.75rem; font-family: inherit; font-size: 0.95rem; resize: vertical; box-sizing: border-box; line-height: 1.5;" placeholder="اكتب الرد هنا...">${draft.suggested_reply}</textarea>
                </div>

                <div class="draft-actions" style="display: flex; gap: 1rem; margin-top: 0.5rem;">
                    <button id="approve-btn-${draft.id}" class="cyber-btn" onclick="whatsappAI.approveDraft(${draft.id})" style="flex: 1; padding: 0px; height: 42px;">
                        <div class="cyber-btn-bg" style="background: linear-gradient(90deg, #00ffcc, #00b3ff);"></div>
                        <div class="cyber-btn-inner" style="background: #0d1b2a; border-radius: 6px;"><i class="fa-solid fa-paper-plane"></i> إرسال وتأكيد الرد</div>
                    </button>
                    <button class="btn btn-danger" onclick="whatsappAI.dismissDraft(${draft.id})" style="padding: 0.5rem 1.25rem; border-radius: 8px; font-weight: bold; display: flex; align-items: center; gap: 0.5rem;">
                        <i class="fa-solid fa-trash-can"></i> تجاهل
                    </button>
                </div>
            `;
            listContainer.appendChild(card);
        });
    }

    renderSettingsPanel() {
        const settingsContainer = document.getElementById('wa-tab-settings');
        if (!settingsContainer) return;

        settingsContainer.innerHTML = `
            <div class="glass-panel" style="padding: 2rem; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.03); display: flex; flex-direction: column; gap: 1.5rem;">
                <h3 style="color: var(--secondary); border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.5rem;"><i class="fa-solid fa-sliders"></i> إعدادات مساعد واتساب</h3>

                <div class="form-group" style="display: flex; flex-direction: column; gap: 0.5rem;">
                    <label style="color: var(--secondary); font-weight: bold;">Gemini API Key</label>
                    <input type="password" id="wa-api-key" class="neon-input" value="${this.settings.api_key || ''}" placeholder="أدخل مفتاح الـ API الخاص بـ Gemini هنا..." style="direction: ltr; font-family: monospace;">
                </div>

                <div class="form-group" style="display: flex; flex-direction: column; gap: 0.5rem;">
                    <label style="color: var(--secondary); font-weight: bold;">التعليمات والأسلوب للمساعد (System Prompt)</label>
                    <textarea id="wa-prompt" class="neon-input" style="height: 120px; line-height: 1.5;" placeholder="اكتب تعليمات الرد هنا...">${this.settings.system_instruction || ''}</textarea>
                </div>

                <div class="form-group" style="display: flex; align-items: center; gap: 0.75rem; margin: 0.5rem 0;">
                    <input type="checkbox" id="wa-personal-chats" ${this.settings.personal_chats_enabled ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
                    <label for="wa-personal-chats" style="color: var(--secondary); font-weight: bold; cursor: pointer; user-select: none;">تفعيل المساعد للمحادثات الفردية الشخصية</label>
                </div>

                <div class="form-group" style="display: flex; flex-direction: column; gap: 0.5rem;">
                    <label style="color: var(--secondary); font-weight: bold;">المجموعات المسموح بالرد فيها (Groups Whitelist)</label>
                    <input type="text" id="wa-whitelist" class="neon-input" value="${this.settings.groups_whitelist || ''}" placeholder="اسم المجموعة أو الـ ID (افصل بينهم بفاصلة كوما ,)">
                    <small class="text-muted" style="font-size: 0.8rem;">سيتجاهل المساعد كافة المجموعات ما عدا المجموعات المكتوبة هنا بالاسم أو جزء منه.</small>
                </div>

                <button class="cyber-btn" onclick="whatsappAI.saveSettings()" style="padding: 0px; height: 42px; margin-top: 0.5rem; width: 100%;">
                    <div class="cyber-btn-bg"></div>
                    <div class="cyber-btn-inner" style="background: #0d1b2a; border-radius: 6px;"><i class="fa-solid fa-save"></i> حفظ الإعدادات</div>
                </button>
            </div>
        `;
    }

    renderConnectionPanel() {
        const panel = document.getElementById('wa-connection-panel');
        if (!panel) return;

        let statusText = 'غير متصل';
        let statusDotColor = '#ff3333';
        let actionBtnHtml = `
            <button class="cyber-btn" onclick="whatsappAI.startWhatsApp()" style="padding:0; height: 42px; width: 100%;">
                <div class="cyber-btn-bg" style="background: linear-gradient(90deg, #00fff7, #00b3ff);"></div>
                <div class="cyber-btn-inner" style="background: #0d1b2a; border-radius: 6px;"><i class="fa-solid fa-link"></i> ربط الجهاز الآن</div>
            </button>
        `;

        if (this.waStatus === 'ready') {
            statusText = 'متصل وجاهز';
            statusDotColor = '#00ffcc';
            actionBtnHtml = `
                <div class="text-center" style="color: #00ffcc; padding: 1.5rem 0;">
                    <i class="fa-solid fa-circle-check fa-4x" style="display:block; margin-bottom: 1rem;"></i>
                    <strong>المنصة متصلة بالواتساب بنجاح</strong>
                    <p class="text-muted" style="margin-top: 0.5rem; font-size: 0.85rem;">المساعد الذكي يعمل الآن في الخلفية ويقوم بتحضير المسودات.</p>
                </div>
            `;
        } else if (this.waStatus === 'authenticating') {
            statusText = 'جاري الاتصال...';
            statusDotColor = '#ffcc00';
            actionBtnHtml = `
                <div class="text-center" style="padding: 2rem 0;">
                    <i class="fa-solid fa-circle-notch fa-spin fa-3x" style="color: #ffcc00; display:block; margin-bottom:1rem;"></i>
                    <p style="color: #ffcc00;">جاري التحقق وتجهيز رمز الـ QR...</p>
                </div>
            `;
        }

        panel.innerHTML = `
            <div class="glass-panel" style="padding: 1.75rem; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.03); display: flex; flex-direction: column; gap: 1.25rem;">
                <h3 style="color: var(--secondary); border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 0.5rem;"><i class="fa-brands fa-whatsapp"></i> ربط واتساب بالمنصة</h3>
                
                <div class="status-indicator" style="display: flex; align-items: center; gap: 0.75rem; background: rgba(255,255,255,0.02); padding: 0.75rem 1rem; border-radius: 10px;">
                    <span style="width: 12px; height: 12px; border-radius: 50%; background-color: ${statusDotColor}; display: inline-block; box-shadow: 0 0 8px ${statusDotColor};"></span>
                    <strong style="color: var(--secondary);">حالة الاتصال: <span style="color: ${statusDotColor};">${statusText}</span></strong>
                </div>

                <div id="wa-qr-container" style="background: #fff; padding: 1rem; border-radius: 12px; display: flex; justify-content: center; align-items: center; min-height: 250px; border: 1px solid rgba(255,255,255,0.1);">
                    ${this.waStatus === 'ready' 
                        ? `<i class="fa-brands fa-whatsapp" style="font-size: 6rem; color: #25d366;"></i>` 
                        : (this.waStatus === 'authenticating'
                            ? `<i class="fa-solid fa-qrcode fa-5x" style="color: #ddd;"></i>`
                            : `<div class="text-center text-muted" style="font-size: 0.9rem;"><i class="fa-solid fa-qrcode fa-4x" style="display:block; margin-bottom:10px;"></i>انتظار الربط لتوليد الكود</div>`
                        )
                    }
                </div>

                <div class="action-btn-wrap">
                    ${actionBtnHtml}
                </div>
            </div>
        `;
    }

    renderQR(qrUrl) {
        const qrContainer = document.getElementById('wa-qr-container');
        if (qrContainer) {
            qrContainer.innerHTML = `<img src="${qrUrl}" alt="WhatsApp QR Code" style="width: 100%; height: 100%; object-fit: contain;">`;
            if (this.waStatus === 'authenticating') {
                this.waStatus = 'qr_ready';
                const statusLabel = document.querySelector('.status-indicator span');
                const statusTextSpan = document.querySelector('.status-indicator span + strong span');
                if (statusLabel) {
                    statusLabel.style.backgroundColor = '#ffcc00';
                    statusLabel.style.boxShadow = '0 0 8px #ffcc00';
                }
                if (statusTextSpan) {
                    statusTextSpan.textContent = 'امسح الرمز للربط';
                    statusTextSpan.style.color = '#ffcc00';
                }
            }
        }
    }
}

window.whatsappAI = new WhatsAppAI();
