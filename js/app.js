// app.js
class App {
    constructor() {
        this.currentUser = null;
        this.currentView = null;
        this.init();
    }

    async init() {
        // Add overlay for mobile sidebar
        const overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        overlay.onclick = () => this.toggleSidebar();
        document.body.appendChild(overlay);

        // Sync Data with Google Sheets in BACKGROUND — never block the login button
        storage.syncDB().catch(() => { });

        // Populate branches list if we wanted to show it on login (not needed now since we use email)

        // Restore session if exists
        const savedUserStr = localStorage.getItem('altahera_session_user');
        if (savedUserStr) {
            try {
                const savedUser = JSON.parse(savedUserStr);
                // Validate if user still exists/active in DB
                const dbUser = storage.getUserByEmail(savedUser.email);
                if (dbUser && String(dbUser.password) === String(savedUser.password) && dbUser.status === 'Active') {
                    this.applyLoginState(dbUser);
                } else {
                    localStorage.removeItem('altahera_session_user');
                }
            } catch (e) {
                localStorage.removeItem('altahera_session_user');
            }
        }
    }

    async loginWithEmail() {
        try {
            const email = document.getElementById('login-email').value.trim();
            const password = document.getElementById('login-password').value;

            console.log('🔑 Login attempt:', email, '| pass length:', password.length);

            if (!email || !password) {
                if (window.setLoginStatus) setLoginStatus('error', 'fa-triangle-exclamation', 'الرجاء إدخال اسم المستخدم وكلمة المرور');
                return;
            }

            const user = storage.getUserByEmail(email);
            console.log('👤 User found:', user ? user.email : 'NULL', '| pass type:', user ? typeof user.password : 'N/A');

            if (user && String(user.password) === String(password)) {
                if (user.status !== 'Active') {
                    if (window.setLoginStatus) setLoginStatus('error', 'fa-ban', 'هذا الحساب معطل — يرجى مراجعة الإدارة');
                    return;
                }

                localStorage.setItem('altahera_session_user', JSON.stringify({ email: user.email, password: user.password }));

                if (window.setLoginStatus) setLoginStatus('success', 'fa-check-circle', `مرحباً ${user.name} — جاري الدخول...`);

                // Apply login immediately
                this.applyLoginState(user);
                this.showToast(`مرحباً ${user.name}`, 'success');
            } else {
                if (window.setLoginStatus) setLoginStatus('error', 'fa-circle-xmark', 'اسم المستخدم أو كلمة المرور غير صحيحة');
                const fields = document.querySelectorAll('.neon-field');
                fields.forEach(f => { f.style.animation = 'shake 0.4s ease'; setTimeout(() => f.style.animation = '', 400); });
            }
        } catch (err) {
            console.error('❌ Login error:', err);
            if (window.setLoginStatus) setLoginStatus('error', 'fa-triangle-exclamation', 'خطأ: ' + err.message);
        }
    }

    applyLoginState(user) {
        const branch = storage.getBranchById(user.branchId);
        let perms = [];
        try {
            perms = typeof user.permissions === 'string' ? JSON.parse(user.permissions) : user.permissions;
        } catch (e) { }

        this.currentUser = {
            ...user,
            branchName: user.branchId === 'all' ? 'المركز الرئيسي / كول سنتر' : (branch ? branch.name : 'الرئيسي'),
            permissionsList: Array.isArray(perms) ? perms : []
        };

        // Update User UI
        document.getElementById('current-user-role').textContent = user.role;
        document.getElementById('current-user-branch').textContent = `فرع ${this.currentUser.branchName}`;

        this.setupNavigationPermissions();

        // Switch Screens
        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('app-shell').classList.add('active');

        // Clear inputs
        document.getElementById('login-email').value = '';
        document.getElementById('login-password').value = '';

        // Go to default view
        this.navigate('dashboard');
        this.updateNotificationBell();

        this.showToast(`مرحباً ${user.name} في فرع ${this.currentUser.branchName}`, 'success');
    }

    hasPermission(perm) {
        if (!this.currentUser) return false;
        if (this.currentUser.role === 'Administrator') return true; // Admins bypass all
        return this.currentUser.permissionsList.includes(perm);
    }

    setupNavigationPermissions() {
        // Manager menu wrapper visibility
        const managerMenu = document.getElementById('manager-menu');
        const canManageSome = this.hasPermission('Manage Tests') || this.hasPermission('Edit Tests') || this.hasPermission('Manage Users') || this.hasPermission('Manage Devices');
        if (managerMenu) {
            if (canManageSome) managerMenu.classList.remove('hidden');
            else managerMenu.classList.add('hidden');
        }

        // Specific manager links
        const navTests = document.getElementById('nav-manage-tests');
        const navUsers = document.getElementById('nav-users');
        const navGlobalDevices = document.getElementById('nav-global-devices');
        const navReports = document.getElementById('nav-reports');

        if (navTests) navTests.style.display = (this.hasPermission('Manage Tests') || this.hasPermission('Edit Tests')) ? 'flex' : 'none';
        if (navUsers) navUsers.style.display = this.hasPermission('Manage Users') ? 'flex' : 'none';
        if (navGlobalDevices) navGlobalDevices.style.display = this.hasPermission('Manage Devices') ? 'flex' : 'none';
        if (navReports) navReports.style.display = this.hasPermission('Manage Devices') ? 'flex' : 'none';

        // General sidebar links logic
        const linkTests = document.querySelector('.nav-item[data-view="tests"]');
        if (linkTests) linkTests.style.display = this.hasPermission('View Tests') ? 'flex' : 'none';

        const linkDoctors = document.querySelector('.nav-item[data-view="doctors"]');
        if (linkDoctors) linkDoctors.style.display = (this.hasPermission('Manage Schedules') || this.hasPermission('Manage Doctors') || this.hasPermission('View Doctors')) ? 'flex' : 'none';

        const linkGlobalDevices = document.querySelector('.nav-item[data-view="global-devices"]');
        if (linkGlobalDevices) linkGlobalDevices.style.display = (this.hasPermission('Manage Devices') || this.hasPermission('View Devices')) ? 'flex' : 'none';
    }

    logout() {
        this.currentUser = null;
        localStorage.removeItem('altahera_session_user');
        document.getElementById('app-shell').classList.remove('active');
        document.getElementById('login-screen').classList.add('active');
        this.showToast('تم تسجيل الخروج بنجاح', 'success');
    }

    navigate(viewId) {
        // Permission guards
        if (viewId === 'tests' && !this.hasPermission('View Tests')) {
            this.showToast('غير مصرح لك بعرض هذه الصفحة', 'error');
            return;
        }
        if (viewId === 'manage-tests' && !this.hasPermission('Manage Tests') && !this.hasPermission('Edit Tests') && !this.hasPermission('Add Tests')) {
            this.showToast('غير مصرح', 'error');
            return;
        }
        if (viewId === 'users' && !this.hasPermission('Manage Users')) {
            this.showToast('غير مصرح لك بإدارة المستخدمين', 'error');
            return;
        }
        if (viewId === 'global-devices' && !this.hasPermission('Manage Devices') && !this.hasPermission('View Devices')) {
            this.showToast('غير مصرح لك بعرض مراقبة الأجهزة', 'error');
            return;
        }

        // Update nav links
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
        const activeLink = document.querySelector(`.nav-item[data-view="${viewId}"]`);
        if (activeLink) activeLink.classList.add('active');

        // Update views
        document.querySelectorAll('.content-view').forEach(el => el.classList.remove('active'));
        const targetView = document.getElementById(`view-${viewId}`);
        if (targetView) targetView.classList.add('active');

        this.currentView = viewId;

        if (window.innerWidth <= 992) {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.querySelector('.sidebar-overlay');
            if (sidebar && sidebar.classList.contains('mobile-active')) {
                sidebar.classList.remove('mobile-active');
                overlay.classList.remove('active');
            }
        }

        this.renderView(viewId);
    }

    renderView(viewId) {
        const container = document.getElementById(`view-${viewId}`);
        if (!container) return;

        if (viewId === 'dashboard') {
            container.innerHTML = `
        <div class= "dashboard-header" >
                    <h2>نظرة عامة على النظام</h2>
                    <p>فرع ${this.currentUser.branchName}</p>
                </div>
            <div class="stats-grid" style="display: flex; gap: 1rem; margin-top: 1rem;">
                <div class="glass-panel" style="padding: 1.5rem; flex: 1; text-align: center;">
                    <h3 class="text-primary">مرحباً ${this.currentUser.name}</h3>
                    <p class="text-muted">نظام إدارة الفروع المركزي - يرجى الاختيار من القائمة للبدء</p>
                </div>
            </div>
            `;
        } else if (viewId === 'tests') {
            this.renderTestsView(container);
        } else if (viewId === 'devices') {
            this.renderDevicesView(container);
        } else if (viewId === 'manage-tests') {
            this.renderManageTestsView(container);
        } else if (viewId === 'doctors') {
            this.renderDoctorsView(container);
        } else if (viewId === 'users') {
            this.renderUsersView(container);
        } else if (viewId === 'global-devices') {
            this.renderGlobalDevicesView(container);
        } else if (viewId === 'reports') {
            this.renderReportsView(container);
        }
    }

    // --- Tests View ---
    renderTestsView(container) {
        container.innerHTML = `
            <div class= "view-header" >
            <h2>دليل التحاليل والأشعة</h2>
            </div>
            <div class="search-box glass-panel">
                <i class="fa-solid fa-search"></i>
                <input type="text" id="test-search-input" placeholder="ابحث باسم التحليل أو الأشعة..." onkeyup="app.filterTests()">
            </div>
            <div id="tests-grid" class="cards-grid"></div>
        `;
        this.filterTests();
    }

    filterTests() {
        const query = document.getElementById('test-search-input').value.toLowerCase();
        let tests = storage.getTests();
        if (query) {
            tests = tests.filter(t => t.nameAr.toLowerCase().includes(query) || t.nameEn.toLowerCase().includes(query));
        }

        const grid = document.getElementById('tests-grid');
        grid.innerHTML = '';

        if (tests.length === 0) {
            grid.innerHTML = '<div class="glass-panel text-center" style="grid-column: 1/-1; padding: 2rem;"><p>لا توجد نتائج بحث</p></div>';
            return;
        }

        tests.forEach(test => {
            const isAvailable = this.checkTestAvailability(test);
            const statusClass = isAvailable ? 'status-available' : 'status-unavailable';
            const statusText = isAvailable ? 'متاح' : 'غير متاح مؤقتاً';

            let warningHtml = '';
            if (!isAvailable) {
                const device = storage.getDeviceById(test.deviceId);
                warningHtml = `
            <div class= "test-warning" >
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        <span>غير متاح مؤقتاً لوجود عطل بالجهاز (${device ? device.name : ''}).</span>
                    </div>
            `;
            }

            const card = document.createElement('div');
            card.className = `glass - panel test - card ${!isAvailable ? 'disabled-card' : ''}`;

            // Specific days parsing
            let daysDisp = 'طوال الأسبوع';
            try {
                let specD = typeof test.specificDays === 'string' ? JSON.parse(test.specificDays) : test.specificDays;
                if (Array.isArray(specD) && specD.length > 0) daysDisp = specD.join('، ');
            } catch (e) { }
            if (test.allWeek) daysDisp = 'طوال الأسبوع';

            card.innerHTML = `
    <div class="test-card-header" >
                    <span class="test-category ${test.category === 'Radiology' ? 'cat-rad' : 'cat-lab'}">
                        ${test.category === 'Radiology' ? 'أشعة' : 'تحليل معملي'}
                    </span>
                    <span class="test-price">${test.price} ج.م</span>
                </div>
                <h3>${test.nameAr}</h3>
                <p class="test-en-name text-muted">${test.nameEn}</p>
                <div class="test-details">
                    <p><i class="fa-solid fa-info-circle"></i> <strong>التعليمات:</strong> ${test.instructions}</p>
                    <p><i class="fa-solid fa-calendar-alt"></i> <strong>المواعيد:</strong> ${daysDisp}</p>
                    <p class="test-status ${statusClass}"><i class="fa-solid ${isAvailable ? 'fa-check-circle' : 'fa-times-circle'}"></i> ${statusText}</p>
                </div>
                ${warningHtml}
`;
            grid.appendChild(card);
        });
    }

    checkTestAvailability(test) {
        if (!test.deviceId) return true;
        const device = storage.getDeviceById(test.deviceId);

        // If it's a call center user, we just check if it's available ANYWHERE, 
        // but if they're on a specific branch view (later logic), we restrict.
        // For now, if the device attached to the test is working, it's available.
        if (device && (device.status === 'Maintenance' || device.status === 'Out of Service')) {
            return false;
        }
        return true;
    }

    // --- Devices View (Local Branch) ---
    renderDevicesView(container) {
        const canManageDevices = this.hasPermission('Manage Devices');
        container.innerHTML = `
    <div class="view-header flex-between" >
        <h2>أجهزة الأشعة بفرعك</h2>
                ${canManageDevices ? '<button class="btn btn-primary" onclick="app.showAddDeviceModal()"><i class="fa-solid fa-plus"></i> إضافة جهاز</button>' : ''}
            </div>
    <div id="devices-grid" class="cards-grid"></div>
`;
        this.loadDevices();
    }

    loadDevices() {
        const grid = document.getElementById('devices-grid');
        if (!grid) return;
        grid.innerHTML = '';

        let devices = [];
        if (this.currentUser.branchId === 'all') {
            devices = storage.getDevices();
        } else {
            devices = storage.getDevicesByBranch(this.currentUser.branchId);
        }

        this.renderDevicesGrid(grid, devices, this.hasPermission('Manage Devices'));
    }

    renderDevicesGrid(grid, devices, canManage) {
        if (devices.length === 0) {
            grid.innerHTML = '<div class="glass-panel text-center" style="grid-column: 1/-1; padding: 2rem;"><p>لا توجد أجهزة مسجلة</p></div>';
            return;
        }

        devices.forEach(dev => {
            let statusBadge = '';
            let icon = '';
            if (dev.status === 'Available') { statusBadge = 'badge-success'; icon = 'fa-check'; }
            else if (dev.status === 'Maintenance') { statusBadge = 'badge-warning'; icon = 'fa-tools'; }
            else { statusBadge = 'badge-danger'; icon = 'fa-triangle-exclamation'; }

            const statusTextAr = dev.status === 'Available' ? 'متاح العمل' : (dev.status === 'Maintenance' ? 'صيانة' : 'خارج الخدمة');
            const branch = storage.getBranchById(dev.branchId);

            let managerActions = '';
            if (canManage) {
                managerActions = `
    <div class="device-actions" style="margin-top: 1rem; display:flex; gap:0.5rem;" >
        <button class="btn btn-outline" style="flex:1; padding:0.4rem; font-size: 0.85rem; border:1px solid var(--border); background:var(--bg-main); cursor:pointer;" onclick="app.editDevicePrompt('${dev.id}')">
            <i class="fa-solid fa-pen"></i> نقل/تعديل
        </button>
        ${this.currentUser.role === 'Administrator' ? `<button class="btn btn-outline" style="padding:0.4rem; font-size: 0.85rem; border:1px solid #fecdd3; background:#fff1f2; color:#be123c; cursor:pointer;" onclick="app.submitDeleteDevice('${dev.id}', this)" title="حذف نهائي"><i class="fa-solid fa-trash"></i></button>` : ''}
    </div>
    `;
            }

            const card = document.createElement('div');
            card.className = 'glass-panel device-card';
            card.innerHTML = `
    <div class="device-header" >
                    <div class="device-icon"><i class="fa-solid fa-laptop-medical"></i></div>
                    <span class="badge ${statusBadge}"><i class="fa-solid ${icon}"></i> ${statusTextAr}</span>
                </div>
                <h3>${dev.name}</h3>
                <p class="text-muted" style="margin: 0.2rem 0;">النوع: ${dev.type}</p>
                <p class="text-muted" style="margin: 0.2rem 0; font-size: 0.85rem;"><i class="fa-solid fa-location-dot"></i> فرع ${branch ? branch.name : '?'}</p>
                ${managerActions}
`;
            grid.appendChild(card);
        });
    }

    async changeDeviceStatus(deviceId, newStatus) {
        if (await storage.updateDeviceStatus(deviceId, newStatus)) {
            this.showToast('تم تحديث حالة الجهاز بنجاح', 'success');
            if (this.currentView === 'devices') this.loadDevices();
            if (this.currentView === 'global-devices') {
                // Determine active filter
                let activeFilter = 'All';
                if (document.querySelector('.filter-available').classList.contains('active')) activeFilter = 'Available';
                if (document.querySelector('.filter-maintenance').classList.contains('active')) activeFilter = 'Maintenance';
                if (document.querySelector('.filter-outofservice').classList.contains('active')) activeFilter = 'Out of Service';
                this.filterGlobalDevices(activeFilter);
            }
        } else {
            this.showToast('حدث خطأ أثناء التحديث', 'error');
        }
    }

    // --- Doctors View ---
    renderDoctorsView(container) {
        const canManageDoctors = this.hasPermission('Manage Doctors');
        const canManageSchedules = this.hasPermission('Manage Schedules');

        if (!this.calendarCurrentDate) {
            this.calendarCurrentDate = new Date();
        }
        if (!this.calendarBranchFilter) {
            this.calendarBranchFilter = this.currentUser.branchId === 'all' ? 'all' : this.currentUser.branchId;
        }

        const branches = storage.getBranches();
        const branchOpts = `< option value = "all" > كل الفروع</option > ` +
            branches.map(b => `< option value = "${b.id}" ${this.calendarBranchFilter === b.id ? 'selected' : ''}> ${b.name}</option > `).join('');

        const isCallCenterOrAdmin = this.currentUser.branchId === 'all';

        container.innerHTML = `
    <div class="view-header flex-between" style = "margin-bottom:1.5rem;" >
                <div>
                    <h2 style="margin:0;"><i class="fa-solid fa-calendar-week" style="color:var(--primary);margin-left:0.5rem;"></i> جدول الأطباء الأسبوعي</h2>
                    <p style="margin:0.25rem 0 0; color:var(--text-muted); font-size:0.9rem;">عرض مواعيد الأطباء لتواريخ حقيقية</p>
                </div>
                <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                    ${canManageDoctors ? '<button class="btn btn-primary" onclick="app.showAddDoctorModal()"><i class="fa-solid fa-user-plus"></i> إضافة طبيب</button>' : ''}
                    ${canManageSchedules ? '<button class="btn" style="background:var(--secondary); color:#fff;" onclick="app.showAddScheduleModal()"><i class="fa-solid fa-calendar-plus"></i> إضافة موعد</button>' : ''}
                </div>
            </div>

            <div class="calendar-toolbar">
                <div class="cal-nav-group">
                    <button class="btn btn-icon" title="الأسبوع السابق" onclick="app.prevWeek()"><i class="fa-solid fa-chevron-right"></i></button>
                    <div id="calendar-week-label" class="cal-week-label">جاري الحساب...</div>
                    <button class="btn btn-icon" title="الأسبوع التالي" onclick="app.nextWeek()"><i class="fa-solid fa-chevron-left"></i></button>
                    <button class="btn btn-outline" style="padding:0.3rem 0.6rem; font-size:0.8rem;" onclick="app.jumpToToday()">اليوم</button>
                </div>
                ${isCallCenterOrAdmin ? `
                <div class="cal-filter-group">
                    <i class="fa-solid fa-building" style="color:var(--text-muted);"></i>
                    <select id="calendar-branch-filter" onchange="app.calendarBranchFilter = this.value; app.loadDoctorsCalendar(${canManageSchedules});">
                        ${branchOpts}
                    </select>
                </div>` : ''}
            </div>

            <div id="weekly-calendar" class="weekly-calendar-grid"></div>
`;
        this.loadDoctorsCalendar(canManageSchedules);
    }

    getWeekDaysForCalendar(baseDate) {
        const date = new Date(baseDate);
        const dayInfo = date.getDay(); // 0: Sun, 1: Mon, ..., 6: Sat
        const diffToSat = dayInfo === 6 ? 0 : -(dayInfo + 1);

        const saturday = new Date(date);
        saturday.setDate(date.getDate() + diffToSat);

        const weekDays = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(saturday);
            d.setDate(saturday.getDate() + i);
            weekDays.push(d);
        }
        return weekDays;
    }

    prevWeek() {
        this.calendarCurrentDate.setDate(this.calendarCurrentDate.getDate() - 7);
        this.loadDoctorsCalendar(this.hasPermission('Manage Schedules'));
    }

    nextWeek() {
        this.calendarCurrentDate.setDate(this.calendarCurrentDate.getDate() + 7);
        this.loadDoctorsCalendar(this.hasPermission('Manage Schedules'));
    }

    jumpToToday() {
        this.calendarCurrentDate = new Date();
        this.loadDoctorsCalendar(this.hasPermission('Manage Schedules'));
    }

    loadDoctorsCalendar(canManageSchedules) {
        const calendarEl = document.getElementById('weekly-calendar');
        if (!calendarEl) return;

        const days = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
        const dayIcons = ['🗓️', '☀️', '🌙', '⭐', '🌿', '🌟', '🕌'];
        const weekDates = this.getWeekDaysForCalendar(this.calendarCurrentDate);

        // Update the week label (e.g., 20 Nov - 26 Nov)
        const labelEl = document.getElementById('calendar-week-label');
        if (labelEl) {
            const d1Options = { day: 'numeric', month: 'short' };
            const d2Options = { day: 'numeric', month: 'short', year: 'numeric' };
            labelEl.textContent = `${weekDates[0].toLocaleDateString('ar-EG', d1Options)} - ${weekDates[6].toLocaleDateString('ar-EG', d2Options)} `;
        }

        let allDoctors = [];
        if (this.calendarBranchFilter === 'all') {
            allDoctors = storage.getDoctors();
        } else {
            allDoctors = storage.getDoctorsByBranch(this.calendarBranchFilter);
        }

        // Build map: day → list of {doc, sch}
        const dayMap = {};
        days.forEach(d => dayMap[d] = []);

        allDoctors.forEach(doc => {
            storage.getSchedulesByDoctor(doc.id).forEach(sch => {
                if (dayMap[sch.dayOfWeek] !== undefined) {
                    dayMap[sch.dayOfWeek].push({ doc, sch });
                }
            });
        });

        // Determine today's actual date string to highlight the current day
        const todayStr = new Date().toDateString();

        calendarEl.innerHTML = days.map((day, idx) => {
            const entries = dayMap[day];
            const colDate = weekDates[idx];
            const isToday = colDate.toDateString() === todayStr;
            const dateStr = `${colDate.getDate()}/${colDate.getMonth() + 1}`;

            const cardsHtml = entries.length === 0
                ? `<div class="cal-empty"><i class="fa-regular fa-calendar-xmark"></i><span>لا يوجد أطباء</span></div>`
                : entries.map(({ doc, sch }) => {
                    let badgeColor = sch.status === 'Available' ? 'var(--success)' : sch.status === 'Excused' ? '#f59e0b' : 'var(--danger)';
                    let statusText = sch.status === 'Available' ? 'متاح' : sch.status === 'Excused' ? 'معتذر' : 'غير متاح';
                    let statusIcon = sch.status === 'Available' ? 'fa-circle-check' : sch.status === 'Excused' ? 'fa-circle-exclamation' : 'fa-circle-xmark';
                    const timeStr = `${this.formatTime(sch.startTime)} — ${this.formatTime(sch.endTime)}`;

                    const selectHtml = canManageSchedules ? `
                        <select onchange="app.changeDoctorStatus('${sch.id}', this.value)" class="cal-status-select">
                            <option value="Available" ${sch.status === 'Available' ? 'selected' : ''}>✅ متاح</option>
                            <option value="Excused" ${sch.status === 'Excused' ? 'selected' : ''}>⚠️ معتذر</option>
                            <option value="Not Available" ${sch.status === 'Not Available' ? 'selected' : ''}>❌ غير متاح</option>
                        </select>` : '';

                    return `
                        <div class="cal-doc-card" style="border-right: 3px solid ${badgeColor};">
                            <div class="cal-doc-name"><i class="fa-solid fa-user-doctor"></i> ${doc.name}</div>
                            <div class="cal-doc-specialty">${doc.specialty}</div>
                            <div class="cal-doc-time"><i class="fa-regular fa-clock"></i> ${timeStr}</div>
                            <div class="cal-doc-status" style="color:${badgeColor};"><i class="fa-solid ${statusIcon}"></i> ${statusText}</div>
                            ${selectHtml}
                        </div>`;
                }).join('');

            return `
                <div class="cal-day-col ${isToday ? 'cal-today' : ''}">
                    <div class="cal-day-header" onclick="app.showDayDetail('${day}', '${colDate.toISOString()}')" title="انقر لعرض التفاصيل" style="cursor:pointer;">
                        <span class="cal-day-icon">${dayIcons[idx]}</span>
                        <div style="display:flex; flex-direction:column; margin-right:4px;">
                            <span class="cal-day-name" style="font-size:0.8rem;line-height:1;">${day}</span>
                            <span style="font-size:0.65rem; opacity:0.8; font-weight:600;">${dateStr}</span>
                        </div>
                        ${isToday ? '<span class="cal-today-badge">اليوم</span>' : ''}
                        <span class="cal-count" style="margin-right:auto; margin-left:4px;">${entries.length}</span>
                        <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:0.65rem;opacity:0.5;"></i>
                    </div>
                    <div class="cal-cards">${cardsHtml}</div>
                </div>`;
        }).join('');
    }

    loadDoctorsSchedules(canManageSchedules) {
        // Keep for backward compat - now delegates to calendar
        this.loadDoctorsCalendar(canManageSchedules);
    }

    async changeDoctorStatus(scheduleId, newStatus) {
        if (await storage.updateScheduleStatus(scheduleId, newStatus)) {
            this.showToast('تم تحديث حالة الطبيب', 'success');
            this.loadDoctorsCalendar(this.hasPermission('Manage Schedules'));
            // Refresh day detail if open
            const panel = document.getElementById('day-detail-overlay');
            if (panel && panel.dataset.day) this.filterDayDetail(panel.dataset.day);
        } else {
            this.showToast('فشل التحديث', 'error');
        }
    }

    showDayDetail(day, isoDateStr) {
        const canManageSchedules = this.hasPermission('Manage Schedules');
        const branches = storage.getBranches();
        const branchOptions = `<option value="all">كل الفروع</option>` +
            branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');

        let dateTitle = '';
        if (isoDateStr) {
            const d = new Date(isoDateStr);
            dateTitle = `<span style="font-size:0.85em; opacity:0.85; font-weight:500;">(${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()})</span>`;
        }

        // Create or reuse overlay
        let overlay = document.getElementById('day-detail-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'day-detail-overlay';
            overlay.className = 'day-detail-overlay';
            document.body.appendChild(overlay);
        }
        overlay.dataset.day = day;
        overlay.dataset.canManage = canManageSchedules ? '1' : '0';

        overlay.innerHTML = `
            <div class="day-detail-panel">
                <div class="day-detail-header">
                    <div>
                        <h3 style="margin:0;"><i class="fa-solid fa-calendar-day" style="color:var(--primary);"></i> جدول يوم ${day} ${dateTitle}</h3>
                        <p style="margin:0.2rem 0 0;color:var(--text-muted);font-size:0.85rem;">عرض جميع الأطباء عبر الفروع</p>
                    </div>
                    <button onclick="document.getElementById('day-detail-overlay').remove()" class="btn" style="padding:0.4rem 0.8rem;"><i class="fa-solid fa-xmark"></i> إغلاق</button>
                </div>
                <div class="day-detail-filters">
                    <div class="day-filter-group">
                        <i class="fa-solid fa-magnifying-glass"></i>
                        <input type="text" id="day-search-doc" placeholder="ابحث باسم الطبيب..." oninput="app.filterDayDetail('${day}')">
                    </div>
                    <div class="day-filter-group">
                        <i class="fa-solid fa-building"></i>
                        <select id="day-filter-branch" onchange="app.filterDayDetail('${day}')">
                            ${branchOptions}
                        </select>
                    </div>
                    <div class="day-filter-group">
                        <i class="fa-solid fa-circle-half-stroke"></i>
                        <select id="day-filter-status" onchange="app.filterDayDetail('${day}')">
                            <option value="all">كل الحالات</option>
                            <option value="Available">✅ متاح</option>
                            <option value="Excused">⚠️ معتذر</option>
                            <option value="Not Available">❌ غير متاح</option>
                        </select>
                    </div>
                </div>
                <div id="day-detail-cards" class="day-detail-cards"></div>
            </div>
        `;
        overlay.style.display = 'flex';
        this.filterDayDetail(day);

        // Close on backdrop click
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    }

    filterDayDetail(day) {
        const canManage = document.getElementById('day-detail-overlay')?.dataset.canManage === '1';
        const searchVal = (document.getElementById('day-search-doc')?.value || '').toLowerCase();
        const branchVal = document.getElementById('day-filter-branch')?.value || 'all';
        const statusVal = document.getElementById('day-filter-status')?.value || 'all';
        const cardsEl = document.getElementById('day-detail-cards');
        if (!cardsEl) return;

        let allDoctors = storage.getDoctors();
        if (branchVal !== 'all') allDoctors = allDoctors.filter(d => d.branchId === branchVal);
        if (searchVal) allDoctors = allDoctors.filter(d => d.name.toLowerCase().includes(searchVal) || (d.specialty || '').toLowerCase().includes(searchVal));

        let entries = [];
        allDoctors.forEach(doc => {
            storage.getSchedulesByDoctor(doc.id).forEach(sch => {
                if (sch.dayOfWeek === day) {
                    if (statusVal === 'all' || sch.status === statusVal) {
                        entries.push({ doc, sch });
                    }
                }
            });
        });

        if (entries.length === 0) {
            cardsEl.innerHTML = `<div class="day-no-results"><i class="fa-regular fa-calendar-xmark"></i><p>لا يوجد أطباء بهذه المعايير في يوم ${day}</p></div>`;
            return;
        }

        cardsEl.innerHTML = entries.map(({ doc, sch }) => {
            const branch = storage.getBranchById(doc.branchId);
            const branchName = branch ? branch.name : doc.branchId;
            const badgeColor = sch.status === 'Available' ? 'var(--success)' : sch.status === 'Excused' ? '#f59e0b' : 'var(--danger)';
            const statusText = sch.status === 'Available' ? 'متاح' : sch.status === 'Excused' ? 'معتذر' : 'غير متاح';
            const statusIcon = sch.status === 'Available' ? 'fa-circle-check' : sch.status === 'Excused' ? 'fa-circle-exclamation' : 'fa-circle-xmark';
            const timeStr = `${this.formatTime(sch.startTime)} — ${this.formatTime(sch.endTime)}`;

            const selectHtml = canManage ? `
                <select onchange="app.changeDoctorStatus('${sch.id}', this.value)" class="day-status-select">
                    <option value="Available" ${sch.status === 'Available' ? 'selected' : ''}>✅ متاح</option>
                    <option value="Excused" ${sch.status === 'Excused' ? 'selected' : ''}>⚠️ معتذر</option>
                    <option value="Not Available" ${sch.status === 'Not Available' ? 'selected' : ''}>❌ غير متاح</option>
                </select>` : '';

            return `
                <div class="day-doc-card" style="border-right:4px solid ${badgeColor};">
                    <div class="day-doc-main">
                        <div class="day-doc-avatar" style="background:${badgeColor}22;color:${badgeColor};">
                            <i class="fa-solid fa-user-doctor"></i>
                        </div>
                        <div class="day-doc-info">
                            <div class="day-doc-name">${doc.name}</div>
                            <div class="day-doc-meta">${doc.specialty} &nbsp;·&nbsp; <i class="fa-solid fa-location-dot"></i> فرع ${branchName}</div>
                            <div class="day-doc-time"><i class="fa-regular fa-clock"></i> ${timeStr}</div>
                        </div>
                        <div class="day-doc-status-col">
                            <span class="day-status-badge" style="background:${badgeColor}22;color:${badgeColor};">
                                <i class="fa-solid ${statusIcon}"></i> ${statusText}
                            </span>
                            ${selectHtml}
                        </div>
                    </div>
                </div>`;
        }).join('');
    }


    formatTime(isoStr) {
        if (!isoStr) return '';
        // Handle ISO-like string from Google Sheets (e.g. 1899-12-30T06:54:51.000Z)
        try {
            const date = new Date(isoStr);
            if (isNaN(date.getTime())) return isoStr; // Return raw if invalid

            let hours = date.getHours();
            const minutes = date.getMinutes().toString().padStart(2, '0');
            const ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12; // the hour '0' should be '12'
            return `${hours.toString().padStart(2, '0')}:${minutes} ${ampm}`;
        } catch (e) {
            return isoStr;
        }
    }

    loadDoctorsSchedules_LEGACY(canManageSchedules) {
        const tbody = document.getElementById('doctors-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        let allDoctors = [];
        if (this.currentUser.branchId === 'all') {
            allDoctors = storage.getDoctors();
        } else {
            allDoctors = storage.getDoctorsByBranch(this.currentUser.branchId);
        }

        if (allDoctors.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center">لا يوجد أطباء مسجلين</td></tr>';
            return;
        }

        let hasSchedules = false;
        allDoctors.forEach(doc => {
            const schedules = storage.getSchedulesByDoctor(doc.id);
            schedules.forEach(sch => {
                hasSchedules = true;
                const tr = document.createElement('tr');

                let statusBadge = '';
                if (sch.status === 'Available') statusBadge = 'badge-success';
                else if (sch.status === 'Excused') statusBadge = 'badge-warning';
                else statusBadge = 'badge-danger';

                const statusText = sch.status === 'Available' ? 'متاح' : (sch.status === 'Excused' ? 'معتذر' : 'غير متاح');
                const timeStr = `${this.formatTime(sch.startTime)} - ${this.formatTime(sch.endTime)}`;

                let managerTd = '';
                if (canManageSchedules) {
                    managerTd = `
                        <td>
                            <select onchange="app.changeDoctorStatus('${sch.id}', this.value)" class="status-select" style="padding: 0.3rem;">
                                <option value="Available" ${sch.status === 'Available' ? 'selected' : ''}>متاح</option>
                                <option value="Excused" ${sch.status === 'Excused' ? 'selected' : ''}>معتذر</option>
                                <option value="Not Available" ${sch.status === 'Not Available' ? 'selected' : ''}>غير متاح</option>
                            </select>
                        </td>
                    `;
                }

                tr.innerHTML = `
                    <td><div class="doc-name"><i class="fa-solid fa-user-md"></i> ${doc.name}</div></td>
                    <td>${doc.specialty}</td>
                    <td><strong>${sch.dayOfWeek}</strong></td>
                    <td>${timeStr}</td>
                    <td><span class="badge ${statusBadge}">${statusText}</span></td>
                    ${managerTd}
                `;
                tbody.appendChild(tr);
            });
        });

        if (!hasSchedules) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center">لا توجد جداول</td></tr>';
        }
    }

    async changeDoctorStatus(scheduleId, newStatus) {
        if (await storage.updateScheduleStatus(scheduleId, newStatus)) {
            this.showToast('تم تحديث حالة الطبيب', 'success');
            this.loadDoctorsSchedules(this.hasPermission('Manage Schedules'));
        } else {
            this.showToast('فشل التحديث', 'error');
        }
    }

    // --- Manage Tests View ---
    renderManageTestsView(container) {
        const canEdit = this.hasPermission('Edit Tests');
        const canAdd = this.hasPermission('Add Tests');
        container.innerHTML = `
            <div class="view-header flex-between">
                <h2>إدارة التحاليل والأشعة</h2>
                ${canAdd ? '<button class="btn btn-primary" onclick="app.showAddTestModal()"><i class="fa-solid fa-plus"></i> إضافة فحص جديد</button>' : ''}
            </div>
            <div class="table-responsive">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>الكود</th>
                            <th>الاسم</th>
                            <th>النوع</th>
                            <th>السعر</th>
                            ${canEdit ? '<th>إجراء</th>' : ''}
                        </tr>
                    </thead>
                    <tbody id="manage-tests-tbody"></tbody>
                </table>
            </div>
        `;
        this.loadManageTests(canEdit);
    }

    showAddTestModal() {
        const bodyHtml = `
            <div class="form-group-modal">
                <label>الاسم بالعربية</label>
                <input type="text" id="modal-new-test-namear" placeholder="مثال: صورة دم كاملة">
            </div>
            <div class="form-group-modal">
                <label>الاسم بالإنجليزية</label>
                <input type="text" id="modal-new-test-nameen" placeholder="مثال: CBC">
            </div>
            <div class="form-group-modal">
                <label>النوع</label>
                <select id="modal-new-test-category">
                    <option value="Laboratory">تحليل معملي</option>
                    <option value="Radiology">أشعة</option>
                </select>
            </div>
            <div class="form-group-modal">
                <label>السعر (ج.م)</label>
                <input type="number" id="modal-new-test-price" placeholder="مثال: 150">
            </div>
            <div class="form-group-modal">
                <label>التعليمات (اختياري)</label>
                <input type="text" id="modal-new-test-instructions" placeholder="مثال: صيام 8 ساعات">
            </div>
            <div class="modal-footer">
                <button class="btn" style="background:var(--border-color);" onclick="app.closeModal()">إلغاء</button>
                <button class="btn btn-primary" onclick="app.submitAddTest()">إضافة الفحص</button>
            </div>
        `;
        this.openModal('إضافة فحص جديد', bodyHtml);
    }

    async submitAddTest() {
        const nameAr = document.getElementById('modal-new-test-namear').value.trim();
        const nameEn = document.getElementById('modal-new-test-nameen').value.trim();
        const category = document.getElementById('modal-new-test-category').value;
        const price = parseFloat(document.getElementById('modal-new-test-price').value);
        const instructions = document.getElementById('modal-new-test-instructions').value.trim();

        if (!nameAr || isNaN(price)) {
            this.showToast('الرجاء تعبئة الاسم والسعر بشكل صحيح', 'error');
            return;
        }

        const newTestId = 'test_' + Date.now();
        const testData = {
            id: newTestId,
            nameAr: nameAr,
            nameEn: nameEn,
            category: category,
            price: price,
            instructions: instructions || 'لا توجد',
            deviceId: '', // Usually assigned later or specific devices
            specificDays: '',
            allWeek: true
        };

        const btn = document.querySelector('.modal-footer .btn-primary');
        const origText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الاتصال بالخادم...';
        btn.disabled = true;

        if (await storage.addTest(testData)) {
            this.showToast('تمت إضافة الفحص بنجاح', 'success');
            this.loadManageTests(this.hasPermission('Edit Tests'));
            this.closeModal();
        } else {
            this.showToast('حدث خطأ أثناء الاتصال بالخادم', 'error');
            btn.innerHTML = origText;
            btn.disabled = false;
        }
    }

    loadManageTests(canEdit) {
        const tbody = document.getElementById('manage-tests-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        const tests = storage.getTests();
        tests.forEach(test => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${test.id}</strong></td>
                <td>${test.nameAr}</td>
                <td><span class="badge ${test.category === 'Radiology' ? 'badge-warning' : 'badge-success'}">${test.category === 'Radiology' ? 'أشعة' : 'معمل'}</span></td>
                <td>${test.price} ج.م</td>
                ${canEdit ? `
                <td>
                    <button class="btn btn-primary" onclick="app.editTestPrompt('${test.id}')" style="padding: 0.3rem 0.8rem; font-size: 0.85rem;">
                        <i class="fa-solid fa-pen"></i> تعديل
                    </button>
                    ${this.currentUser.role === 'Administrator' ? `<button class="btn" style="background:#fecdd3; color:#be123c; padding: 0.3rem 0.8rem; font-size: 0.85rem; border:1px solid #fecdd3; margin-right: 0.2rem;" onclick="app.submitDeleteTest('${test.id}', this)" title="حذف نهائي"><i class="fa-solid fa-trash"></i></button>` : ''}
                </td>` : ''}
            `;
            tbody.appendChild(tr);
        });
    }

    editTestPrompt(testId) {
        const test = storage.getTestById(testId);
        if (!test) return;

        const bodyHtml = `
            <div class="form-group-modal">
                <label>سعر التحليل/الأشعة (ج.م)</label>
                <input type="number" id="modal-test-price" value="${test.price}">
            </div>
            <div class="form-group-modal">
                <label>التعليمات (اختياري)</label>
                <input type="text" id="modal-test-instructions" value="${test.instructions}">
            </div>
            <div class="modal-footer">
                <button class="btn" style="background:var(--border-color);" onclick="app.closeModal()">إلغاء</button>
                <button class="btn btn-primary" onclick="app.submitEditTest('${testId}')">حفظ التعديلات</button>
            </div>
        `;
        this.openModal(`تعديل: ${test.nameAr}`, bodyHtml);
    }

    async submitEditTest(testId) {
        const test = storage.getTestById(testId);
        if (!test) return;

        const newPrice = document.getElementById('modal-test-price').value;
        const newInst = document.getElementById('modal-test-instructions').value;

        if (newPrice !== '' && !isNaN(newPrice)) {
            test.price = parseFloat(newPrice);
            test.instructions = newInst;

            const btn = document.querySelector('.modal-footer .btn-primary');
            const origText = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري مزامنة التعديلات...';
            btn.disabled = true;

            if (await storage.updateTest(test)) {
                this.showToast('تم التحديث بنجاح', 'success');
                this.loadManageTests(this.hasPermission('Edit Tests'));
                this.closeModal();
            } else {
                this.showToast('فشل الاتصال لتحديث الفحص', 'error');
                btn.innerHTML = origText;
                btn.disabled = false;
            }
        } else {
            this.showToast('الرجاء إدخال سعر صحيح', 'error');
        }
    }

    async submitDeleteTest(id, btn) {
        if (!confirm('تحذير: هل أنت متأكد من حذف هذا الفحص نهائياً؟')) return;
        const origText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btn.disabled = true;
        if (await storage.deleteTest(id)) {
            this.showToast('تم مسح الفحص بنجاح', 'success');
            this.loadManageTests(this.hasPermission('Edit Tests'));
        } else {
            this.showToast('فشل مسح الفحص', 'error');
            btn.innerHTML = origText;
            btn.disabled = false;
        }
    }

    // --- Global Devices Monitoring ---
    renderGlobalDevicesView(container) {
        container.innerHTML = `
            <div class="view-header">
                <h2>مراقبة أجهزة الفروع</h2>
            </div>
            <div class="glass-panel" style="margin-bottom: 1.5rem; padding: 1rem; display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
                <strong style="margin-left: 1rem;">تصفية بحالة الجهاز:</strong>
                <button class="btn btn-sm btn-primary filter-btn filter-all active" onclick="app.filterGlobalDevices('All')">الكل</button>
                <button class="btn btn-sm btn-success filter-btn filter-available" onclick="app.filterGlobalDevices('Available')">متاح العمل</button>
                <button class="btn btn-sm filter-btn filter-maintenance" onclick="app.filterGlobalDevices('Maintenance')" style="background: var(--warning); color: #000;">صيانة</button>
                <button class="btn btn-sm filter-btn filter-outofservice" onclick="app.filterGlobalDevices('Out of Service')" style="background: var(--accent); color: #fff;">خارج الخدمة</button>
            </div>
            <div id="global-devices-grid" class="cards-grid"></div>
        `;
        this.filterGlobalDevices('All');
    }

    filterGlobalDevices(statusFilter) {
        document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));

        let activeClass = '';
        if (statusFilter === 'All') activeClass = '.filter-all';
        else if (statusFilter === 'Available') activeClass = '.filter-available';
        else if (statusFilter === 'Maintenance') activeClass = '.filter-maintenance';
        else if (statusFilter === 'Out of Service') activeClass = '.filter-outofservice';

        const activeBtn = document.querySelector(activeClass);
        if (activeBtn) activeBtn.classList.add('active');

        const grid = document.getElementById('global-devices-grid');
        if (grid) grid.innerHTML = ''; // Clear grid before filtering

        let devices = storage.getDevices();
        if (statusFilter !== 'All') {
            devices = devices.filter(d => d.status === statusFilter);
        }

        this.renderDevicesGrid(grid, devices, true); // Admin can manage
    }

    // --- Users Management ---
    renderUsersView(container) {
        container.innerHTML = `
            <div class="view-header flex-between">
                <h2>إدارة المستخدمين والصلاحيات</h2>
                <div style="display:flex; gap:0.5rem;">
                    <button class="btn" style="background:var(--warning); color:#000;" onclick="app.forceSeedUsers()"><i class="fa-solid fa-cloud-arrow-up"></i> رفع باقي الحسابات للشيت</button>
                    <button class="btn btn-primary" onclick="app.showAddUserModal()"><i class="fa-solid fa-user-plus"></i> إضافة مستخدم</button>
                </div>
            </div>
            <div class="table-responsive">
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>الاسم</th>
                            <th>البريد الإلكتروني</th>
                            <th>الفرع</th>
                            <th>الدور</th>
                            <th>الصلاحيات</th>
                            <th>الحالة</th>
                            <th>إجراء</th>
                        </tr>
                    </thead>
                    <tbody id="users-tbody"></tbody>
                </table>
            </div>
        `;
        this.loadUsersTable();
    }

    loadUsersTable() {
        const tbody = document.getElementById('users-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        const users = storage.getUsers();

        users.forEach(user => {
            const branch = storage.getBranchById(user.branchId);
            const statusBadge = user.status === 'Active' ? 'badge-success' : 'badge-danger';

            let perms = [];
            try { perms = typeof user.permissions === 'string' ? JSON.parse(user.permissions) : user.permissions; } catch (e) { }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${user.name}</strong></td>
                <td>${user.email}</td>
                <td>${branch ? branch.name : '-'}</td>
                <td>${user.role}</td>
                <td style="font-size: 0.8rem; color: #64748b; max-width: 200px;">${Array.isArray(perms) ? perms.join(', ') : ''}</td>
                <td><span class="badge ${statusBadge}">${user.status === 'Active' ? 'نشط' : 'معطل'}</span></td>
                <td>
                    <button class="btn" style="background:${user.status === 'Active' ? '#fecdd3' : '#dcfce7'}; color:#1e293b; padding:0.3rem 0.6rem; border:1px solid #cbd5e1" onclick="app.toggleUserStatus('${user.id}')" title="تفعيل/تعطيل">
                        <i class="fa-solid fa-power-off"></i>
                    </button>
                    ${user.id !== 'u_admin' ? `<button class="btn btn-primary" style="padding:0.3rem 0.6rem;" onclick="app.editUserPrompt('${user.id}')" title="تعديل"><i class="fa-solid fa-pen"></i></button>` : ''}
                    ${this.currentUser.role === 'Administrator' && user.id !== 'u_admin' ? `<button class="btn" style="background:#fecdd3; color:#be123c; padding:0.3rem 0.6rem; border:1px solid #fecdd3; margin-right: 0.2rem;" onclick="app.submitDeleteUser('${user.id}', this)" title="حذف نهائي"><i class="fa-solid fa-trash"></i></button>` : ''}
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    async toggleUserStatus(userId) {
        if (userId === 'u_admin') {
            this.showToast('لا يمكن تعطيل مدير النظام الأساسي', 'error');
            return;
        }
        const user = storage.getUserById(userId);
        if (!user) return;
        user.status = user.status === 'Active' ? 'Disabled' : 'Active';
        if (await storage.updateUser(user)) {
            this.showToast('تم تغيير حالة المستخدم', 'success');
            this.loadUsersTable();
        } else {
            this.showToast('حدث خطأ', 'error');
        }
    }

    async submitDeleteUser(id, btn) {
        if (!confirm('تحذير: القضاء على المستخدم سيمسحه نهائياً من قاعدة البيانات. هل أنت متأكد؟')) return;
        const origText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btn.disabled = true;
        if (await storage.deleteUser(id)) {
            this.showToast('تم حذف المستخدم بنجاح', 'success');
            this.loadUsersTable();
        } else {
            this.showToast('فشل حذف المستخدم', 'error');
            btn.innerHTML = origText;
            btn.disabled = false;
        }
    }

    showAddUserModal() {
        const branches = storage.getBranches();
        const branchOpts = `<option value="all">كل الفروع (مدير عام/كول سنتر)</option>` + branches.map(b => `<option value="${b.id}">${b.name}</option>`).join('');

        const permLabels = {
            'View Tests': 'عرض الفحوصات', 'Add Tests': 'إضافة فحص', 'Edit Tests': 'تعديل الفحوصات', 'Delete Tests': 'حذف فحص',
            'View Devices': 'عرض الأجهزة', 'Manage Devices': 'إدارة الأجهزة',
            'View Doctors': 'عرض الأطباء', 'Manage Doctors': 'إدارة الأطباء',
            'Manage Schedules': 'إدارة المواعيد', 'Manage Users': 'إدارة المستخدمين'
        };

        const permsHtml = Object.keys(permLabels).map(p =>
            `<label class="checkbox-group" style="display:inline-flex; width:48%; align-items:center;"><input type="checkbox" class="modal-perm-cb" value="${p}"> ${permLabels[p]}</label>`
        ).join('');

        const bodyHtml = `
            <div class="form-group-modal">
                <label>الاسم</label>
                <input type="text" id="modal-user-name" placeholder="اسم المستخدم">
            </div>
            <div class="form-group-modal">
                <label>البريد الإلكتروني (اسم مستخدم الدخول)</label>
                <input type="text" id="modal-user-email" placeholder="مثال: user.name">
            </div>
            <div style="display:flex; gap:1rem;">
                <div class="form-group-modal" style="flex:1;">
                    <label>الدور</label>
                    <input type="text" id="modal-user-role" placeholder="مثال: Reception" value="Employee">
                </div>
                <div class="form-group-modal" style="flex:1;">
                    <label>تعيين الفرع</label>
                    <select id="modal-user-branch">${branchOpts}</select>
                </div>
            </div>
            <div class="form-group-modal">
                <label style="margin-bottom:0.5rem; display:block;">الصلاحيات:</label>
                <div style="display:flex; flex-wrap:wrap; gap:0.5rem;">${permsHtml}</div>
            </div>
            <div class="modal-footer">
                <button class="btn" style="background:var(--border-color);" onclick="app.closeModal()">إلغاء</button>
                <button class="btn btn-primary" onclick="app.submitAddUser()">حفظ وإضافة</button>
            </div>
        `;
        this.openModal("إضافة مستخدم جديد", bodyHtml);
    }

    async submitAddUser() {
        const name = document.getElementById('modal-user-name').value.trim();
        const email = document.getElementById('modal-user-email').value.trim();
        const role = document.getElementById('modal-user-role').value.trim();
        const branchId = document.getElementById('modal-user-branch').value;

        const perms = Array.from(document.querySelectorAll('.modal-perm-cb')).filter(cb => cb.checked).map(cb => cb.value);

        if (!name || !email) {
            this.showToast('يجب إدخال الاسم والبريد الإلكتروني', 'error');
            return;
        }

        const btn = document.querySelector('.modal-footer .btn-primary');
        const origText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
        btn.disabled = true;

        const res = await storage.addUser({
            name: name,
            email: email,
            password: '123',
            branchId: branchId,
            role: role,
            status: 'Active',
            permissions: perms
        });

        if (res) {
            this.showToast('تم الإضافة بنجاح (الباسورد الافتراضي: 123)', 'success');
            this.loadUsersTable();
            this.closeModal();
        } else {
            this.showToast('فشل في الإضافة', 'error');
            btn.innerHTML = origText;
            btn.disabled = false;
        }
    }

    editUserPrompt(userId) {
        const user = storage.getUserById(userId);
        if (!user) return;

        const branches = storage.getBranches();
        const branchOpts = `<option value="all" ${user.branchId === 'all' ? 'selected' : ''}>كل الفروع (مدير عام/كول سنتر)</option>` +
            branches.map(b => `<option value="${b.id}" ${user.branchId === b.id ? 'selected' : ''}>${b.name}</option>`).join('');

        const permLabels = {
            'View Tests': 'عرض الفحوصات', 'Add Tests': 'إضافة فحص', 'Edit Tests': 'تعديل الفحوصات', 'Delete Tests': 'حذف فحص',
            'View Devices': 'عرض الأجهزة', 'Manage Devices': 'إدارة الأجهزة',
            'View Doctors': 'عرض الأطباء', 'Manage Doctors': 'إدارة الأطباء',
            'Manage Schedules': 'إدارة المواعيد', 'Manage Users': 'إدارة المستخدمين'
        };

        const userPerms = typeof user.permissions === 'string' ? JSON.parse(user.permissions || '[]') : (user.permissions || []);

        const permsHtml = Object.keys(permLabels).map(p => {
            const isChecked = userPerms.includes(p) ? 'checked' : '';
            return `<label class="checkbox-group" style="display:inline-flex; width:48%; align-items:center;"><input type="checkbox" class="modal-perm-cb-edit" value="${p}" ${isChecked}> ${permLabels[p]}</label>`;
        }).join('');

        const bodyHtml = `
            <div style="display:flex; gap:1rem;">
                <div class="form-group-modal" style="flex:1;">
                    <label>الدور / الوظيفة</label>
                    <input type="text" id="modal-edit-role" value="${user.role}">
                </div>
                <div class="form-group-modal" style="flex:1;">
                    <label>الفرع المعين</label>
                    <select id="modal-edit-branch">${branchOpts}</select>
                </div>
            </div>
            <div class="form-group-modal">
                <label style="margin-bottom:0.5rem; display:block;">تعديل الصلاحيات:</label>
                <div style="display:flex; flex-wrap:wrap; gap:0.5rem;">${permsHtml}</div>
            </div>
            <div class="modal-footer">
                <button class="btn" style="background:var(--border-color);" onclick="app.closeModal()">إلغاء</button>
                <button class="btn btn-primary" onclick="app.submitEditUser('${user.id}')">تحديث تفاصيل المستخدم</button>
            </div>
        `;
        this.openModal(`تعديل المستخدم: ${user.name}`, bodyHtml);
    }

    async submitEditUser(userId) {
        const user = storage.getUserById(userId);
        if (!user) return;

        const newRole = document.getElementById('modal-edit-role').value.trim();
        const newBranchId = document.getElementById('modal-edit-branch').value;
        const newPerms = Array.from(document.querySelectorAll('.modal-perm-cb-edit')).filter(cb => cb.checked).map(cb => cb.value);

        if (newRole) {
            user.role = newRole;
            user.branchId = newBranchId;
            user.permissions = newPerms;

            const btn = document.querySelector('.modal-footer .btn-primary');
            const origText = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
            btn.disabled = true;

            const res = await storage.updateUser(user);
            if (res) {
                this.showToast('تم تحديث تفاصيل المستخدم بنجاح', 'success');
                this.loadUsersTable();
                this.closeModal();
            } else {
                this.showToast('حدث خطأ أثناء التحديث', 'error');
                btn.innerHTML = origText;
                btn.disabled = false;
            }
        }
    }

    showAddDeviceModal() {
        const types = ["X-Ray", "MRI", "CT Scan", "Ultrasound", "Lab Analyzer"];
        const opts = types.map(t => `<option value="${t}">${t}</option>`).join('');

        const bodyHtml = `
            <div class="form-group-modal">
                <label>اسم الجهاز</label>
                <input type="text" id="modal-device-name" placeholder="مثال: X-Ray Room 1">
            </div>
            <div class="form-group-modal">
                <label>النوع</label>
                <select id="modal-device-type">
                    ${opts}
                </select>
            </div>
            <div class="modal-footer">
                <button class="btn" style="background:var(--border-color);" onclick="app.closeModal()">إلغاء</button>
                <button class="btn btn-primary" onclick="app.submitAddDevice()">حفظ الجهاز</button>
            </div>
        `;
        this.openModal("إضافة جهاز لفرعك", bodyHtml);
    }

    async submitAddDevice() {
        const name = document.getElementById('modal-device-name').value.trim();
        const type = document.getElementById('modal-device-type').value;

        if (!name) {
            this.showToast('يجب كتابة اسم الجهاز', 'error');
            return;
        }

        const btn = document.querySelector('.modal-footer .btn-primary');
        const origText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> الحفظ...';
        btn.disabled = true;

        const branchId = this.currentUser.branchId === 'all' ? 'b1' : this.currentUser.branchId;
        const newDevice = {
            id: 'dev_' + Date.now(),
            name: name,
            type: type,
            branchId: branchId,
            status: 'Available'
        };

        const res = await storage.addDevice(newDevice);
        if (res) {
            this.showToast('تم إضافة الجهاز بنجاح', 'success');
            if (this.currentView === 'devices') this.loadDevices();
            if (this.currentView === 'global-devices') this.renderGlobalDevicesView(document.getElementById('view-global-devices'));
            this.closeModal();
        } else {
            this.showToast('فشل الحفظ', 'error');
            btn.innerHTML = origText;
            btn.disabled = false;
        }
    }

    showAddDoctorModal() {
        const bodyHtml = `
            <div class="form-group-modal">
                <label>اسم الطبيب</label>
                <input type="text" id="modal-doc-name" placeholder="مثال: د. أحمد خالد">
            </div>
            <div class="form-group-modal">
                <label>التخصص</label>
                <input type="text" id="modal-doc-specialty" placeholder="مثال: أخصائي باطنة">
            </div>
            <div class="modal-footer">
                <button class="btn" style="background:var(--border-color);" onclick="app.closeModal()">إلغاء</button>
                <button class="btn btn-primary" onclick="app.submitAddDoctor()">إضافة الطبيب</button>
            </div>
        `;
        this.openModal("إضافة طبيب جديد", bodyHtml);
    }

    async submitAddDoctor() {
        const name = document.getElementById('modal-doc-name').value.trim();
        const spec = document.getElementById('modal-doc-specialty').value.trim();

        if (!name || !spec) {
            this.showToast('يجب إكمال البيانات', 'error');
            return;
        }

        const btn = document.querySelector('.modal-footer .btn-primary');
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btn.disabled = true;

        const docId = 'doc_' + Date.now();
        const branchId = this.currentUser.branchId === 'all' ? 'b1' : this.currentUser.branchId;

        // Add doc
        await storage.apiPost('ADD', 'Doctors', {
            id: docId, name: name, specialty: spec, branchId: branchId
        });

        this.showToast('تم الإضافة بنجاح', 'success');
        await storage.syncDB();
        if (this.currentView === 'doctors') this.loadDoctorsSchedules(this.hasPermission('Manage Schedules'));
        this.closeModal();
    }

    showAddScheduleModal() {
        let allDoctors = [];
        if (this.currentUser.branchId === 'all') {
            allDoctors = storage.getDoctors();
        } else {
            allDoctors = storage.getDoctorsByBranch(this.currentUser.branchId);
        }

        if (allDoctors.length === 0) {
            this.showToast('لا يوجد أطباء مسجلين لإضافة مواعيد لهم', 'error');
            return;
        }

        const docOpts = allDoctors.map(d => `<option value="${d.id}">${d.name} (${d.specialty})</option>`).join('');
        const days = ["السبت", "الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"];
        const dayOpts = days.map(d => `<option value="${d}">${d}</option>`).join('');

        const bodyHtml = `
            <div class="form-group-modal">
                <label>اختر الطبيب</label>
                <select id="modal-sch-doc">
                    ${docOpts}
                </select>
            </div>
            <div class="form-group-modal">
                <label>اليوم</label>
                <select id="modal-sch-day">
                    ${dayOpts}
                </select>
            </div>
            <div class="form-group-modal">
                <label>من الساعة</label>
                <input type="time" id="modal-sch-start">
            </div>
            <div class="form-group-modal">
                <label>إلى الساعة</label>
                <input type="time" id="modal-sch-end">
            </div>
            <div class="modal-footer">
                <button class="btn" style="background:var(--border-color);" onclick="app.closeModal()">إلغاء</button>
                <button class="btn btn-primary" onclick="app.submitAddSchedule()">حفظ الموعد</button>
            </div>
        `;
        this.openModal("إضافة موعد شيفت", bodyHtml);
    }

    async submitAddSchedule() {
        const docId = document.getElementById('modal-sch-doc').value;
        const day = document.getElementById('modal-sch-day').value;
        const start = document.getElementById('modal-sch-start').value;
        const end = document.getElementById('modal-sch-end').value;

        if (!docId || !day || !start || !end) {
            this.showToast('يجب إكمال جميع البيانات', 'error');
            return;
        }

        const btn = document.querySelector('.modal-footer .btn-primary');
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btn.disabled = true;

        const schId = 'sch_' + Date.now();

        await storage.apiPost('ADD', 'Schedules', {
            id: schId, doctorId: docId, dayOfWeek: day, startTime: start, endTime: end, status: 'Available'
        });

        this.showToast('تم الإضافة بنجاح', 'success');
        await storage.syncDB();
        if (this.currentView === 'doctors') this.loadDoctorsSchedules(this.hasPermission('Manage Schedules'));
        this.closeModal();
    }

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.querySelector('.sidebar-overlay');
        sidebar.classList.toggle('mobile-active');
        overlay.classList.toggle('active');
    }

    // --- Universal Modals Logic ---
    openModal(title, contentHtml) {
        const overlay = document.getElementById('modal-overlay');
        const modal = document.getElementById('app-modal');
        const titleEl = document.getElementById('modal-title');
        const bodyEl = document.getElementById('modal-body');

        if (!overlay || !modal) return;

        titleEl.textContent = title;
        bodyEl.innerHTML = contentHtml;

        overlay.classList.add('active');
        modal.classList.add('active');
    }

    closeModal() {
        const overlay = document.getElementById('modal-overlay');
        const modal = document.getElementById('app-modal');
        if (overlay) overlay.classList.remove('active');
        if (modal) modal.classList.remove('active');
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerText = message;
        Object.assign(toast.style, {
            background: type === 'success' ? 'var(--success)' : (type === 'error' ? 'var(--accent)' : 'var(--primary)'),
            color: 'white',
            padding: '1rem 1.5rem',
            marginBottom: '0.5rem',
            borderRadius: 'var(--radius-sm)',
            boxShadow: 'var(--shadow-md)',
            opacity: '0',
            transform: 'translateX(50px)',
            transition: 'all 0.3s ease',
            minWidth: '250px'
        });
        container.style.position = 'fixed';
        container.style.bottom = '20px';
        container.style.left = '20px';
        container.style.zIndex = '9999';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '1'; toast.style.transform = 'translateX(0)'; }, 10);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(20px)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    async forceSeedUsers() {
        if (!confirm('سيتم فحص الشيت وإضافة أي مستخدمين من النظام الأساسي غير موجودين بالشيت. هل أنت متأكد؟')) return;

        const btn = document.querySelector('button[onclick="app.forceSeedUsers()"]');
        const origText = btn ? btn.innerHTML : 'رفع باقي الحسابات';
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الرفع...';
            btn.disabled = true;
        }

        try {
            const res = await fetch(`${window.CONFIG.GOOGLE_APPS_SCRIPT_URL}?action=GET_DB`);
            const json = await res.json();
            if (json.status === 'success' && json.data) {
                const remoteUsers = json.data.users || [];
                const localUsers = initialUsers;

                let addedCount = 0;
                for (const defaultUser of localUsers) {
                    const exists = remoteUsers.find(u => u.id === defaultUser.id || u.email === defaultUser.email);
                    if (!exists) {
                        await storage.apiPost('ADD', 'Users', defaultUser);
                        addedCount++;
                    }
                }

                if (addedCount > 0) {
                    this.showToast(`تم رفع ${addedCount} مستخدم للشيت بنجاح.`, 'success');
                    await storage.syncDB();
                    if (this.currentView === 'users') this.loadUsersTable();
                } else {
                    this.showToast('جميع المستخدمين موجودين بالفعل في الشيت ولم تتم أي إضافة جديدة.', 'success');
                }
            }
        } catch (e) {
            console.error(e);
            this.showToast('حدث خطأ أثناء الاتصال جوجل شيت', 'error');
        } finally {
            if (btn) {
                btn.innerHTML = origText;
                btn.disabled = false;
            }
        }
    }

    // --- Device Movement Tracking & Notifications ---
    editDevicePrompt(deviceId) {
        const dev = storage.getDeviceById(deviceId);
        if (!dev) return;

        const branches = storage.getBranches();
        const branchOpts = branches.map(b => `<option value="${b.id}" ${dev.branchId === b.id ? 'selected' : ''}>${b.name}</option>`).join('');

        const bodyHtml = `
            <div class="form-group-modal">
                <label>اسم الجهاز</label>
                <input type="text" id="modal-dev-name" value="${dev.name}" disabled>
            </div>
            <div class="form-group-modal">
                <label>الفرع الحالي / الجديد</label>
                <select id="modal-dev-branch">
                    ${branchOpts}
                </select>
            </div>
            <div class="form-group-modal">
                <label>تحديد حالة الجهاز</label>
                <select id="modal-dev-status">
                    <option value="Available" ${dev.status === 'Available' ? 'selected' : ''}>متاح العمل</option>
                    <option value="Maintenance" ${dev.status === 'Maintenance' ? 'selected' : ''}>دخول صيانة</option>
                    <option value="Out of Service" ${dev.status === 'Out of Service' ? 'selected' : ''}>خارج الخدمة / تكهين</option>
                </select>
            </div>
            <div class="form-group-modal">
                <label style="color:var(--accent); font-weight:bold;">سبب النقل / التعديل (إجباري)</label>
                <textarea id="modal-dev-reason" rows="3" placeholder="اكتب سبب تغيير الفرع أو عطل الجهاز هنا لتسجيله بالتقرير..." style="width:100%; border:1px solid var(--border); border-radius:var(--radius-sm); padding:0.8rem; outline:none; font-family:inherit;"></textarea>
            </div>
            <div class="modal-footer">
                <button class="btn" style="background:var(--border-color);" onclick="app.closeModal()">إلغاء</button>
                <button class="btn btn-primary" onclick="app.submitEditDevice('${deviceId}')">حفظ وإرسال إشعار</button>
            </div>
        `;
        this.openModal(`تعديل ومعالجة جهاز: ${dev.name}`, bodyHtml);
    }

    async submitEditDevice(deviceId) {
        const dev = storage.getDeviceById(deviceId);
        if (!dev) return;

        const newBranch = document.getElementById('modal-dev-branch').value;
        const newStatus = document.getElementById('modal-dev-status').value;
        const reason = document.getElementById('modal-dev-reason').value.trim();

        if (dev.branchId === newBranch && dev.status === newStatus) {
            this.showToast('لم يتم تغيير أي بيانات', 'warning');
            return;
        }

        if (!reason) {
            this.showToast('عفواً، يجب كتابة سبب لتوثيق التعديل.', 'error');
            return;
        }

        const oldBranch = storage.getBranchById(dev.branchId);
        const newBranchObj = storage.getBranchById(newBranch);
        const oldBranchName = oldBranch ? oldBranch.name : 'غير معروف';
        const newBranchName = newBranchObj ? newBranchObj.name : 'غير معروف';

        const oldStatus = dev.status;
        dev.branchId = newBranch;
        dev.status = newStatus;

        const btn = document.querySelector('.modal-footer .btn-primary');
        if (btn) { btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>'; btn.disabled = true; }

        if (await storage.updateDevice(dev)) {
            const statusMap = { 'Available': 'متاح العمل', 'Maintenance': 'صيانة', 'Out of Service': 'خارج الخدمة' };

            const isTransfer = oldBranchName !== newBranchName;
            let notifMsg = isTransfer
                ? `قام [${this.currentUser.name}] بنقل الجهاز (${dev.name}) من (${oldBranchName}) إلى (${newBranchName})`
                : `قام [${this.currentUser.name}] بتحديث جاهزية (${dev.name}) بفرع (${newBranchName}) إلى (${statusMap[newStatus]})`;

            // Fire and forget logs and notifications to avoid blocking the UI
            Promise.all([
                storage.addDeviceLog({
                    id: 'log_' + Date.now(),
                    deviceId: dev.id,
                    deviceName: dev.name,
                    oldBranch: oldBranchName,
                    newBranch: newBranchName,
                    oldStatusStr: statusMap[oldStatus] || oldStatus,
                    newStatusStr: statusMap[newStatus] || newStatus,
                    reason: reason,
                    date: new Date().toISOString(),
                    userName: this.currentUser.name
                }),
                storage.addNotification({
                    id: 'notif_' + Date.now(),
                    message: notifMsg + ` - السبب: ${reason}`,
                    type: newStatus === 'Available' ? 'success' : 'warning',
                    timestamp: new Date().toISOString(),
                    readBy: JSON.stringify([this.currentUser.id])
                })
            ]).catch(e => console.error("Logging error", e));

            this.showToast('تم التعديل وحفظ التقرير وإرسال الإشعار بنجاح!', 'success');

            if (this.currentView === 'devices') this.loadDevices();
            if (this.currentView === 'global-devices') {
                let activeFilter = 'All';
                if (document.querySelector('.filter-available') && document.querySelector('.filter-available').classList.contains('active')) activeFilter = 'Available';
                if (document.querySelector('.filter-maintenance') && document.querySelector('.filter-maintenance').classList.contains('active')) activeFilter = 'Maintenance';
                if (document.querySelector('.filter-outofservice') && document.querySelector('.filter-outofservice').classList.contains('active')) activeFilter = 'Out of Service';
                this.filterGlobalDevices(activeFilter);
            }
            this.updateNotificationBell();
            this.closeModal();
        } else {
            this.showToast('حدث خطأ أثناء الحفظ', 'error');
            if (btn) { btn.innerHTML = 'حفظ وإرسال إشعار'; btn.disabled = false; }
        }
    }

    async submitDeleteDevice(id, btn) {
        if (!confirm('تحذير: هل أنت متأكد من حذف هذا الجهاز بشكل نهائي من قاعدة البيانات؟')) return;
        const origText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btn.disabled = true;
        if (await storage.deleteDevice(id)) {
            this.showToast('تم مسح الجهاز بنجاح', 'success');
            if (this.currentView === 'devices') this.loadDevices();
            if (this.currentView === 'global-devices') {
                let activeFilter = 'All';
                if (document.querySelector('.filter-available') && document.querySelector('.filter-available').classList.contains('active')) activeFilter = 'Available';
                if (document.querySelector('.filter-maintenance') && document.querySelector('.filter-maintenance').classList.contains('active')) activeFilter = 'Maintenance';
                if (document.querySelector('.filter-outofservice') && document.querySelector('.filter-outofservice').classList.contains('active')) activeFilter = 'Out of Service';
                this.filterGlobalDevices(activeFilter);
            }
        } else {
            this.showToast('فشل حذف الجهاز', 'error');
            btn.innerHTML = origText;
            btn.disabled = false;
        }
    }

    renderReportsView(container) {
        container.innerHTML = `
            <div class="view-header flex-between" style="border-bottom: 2px solid var(--border); padding-bottom:1rem; margin-bottom:1.5rem;">
                <h2>دورية تحركات وتقارير الأجهزة</h2>
            </div>
            <div style="display:flex; gap:2rem; flex-wrap:wrap;">
                <div style="flex:1; min-width: 320px;" class="glass-panel">
                    <h3 style="margin-bottom:1rem; border-bottom:1px solid var(--border); padding-bottom:0.5rem;"><i class="fa-solid fa-clock-rotate-left"></i> سجل القرارات والأعطال</h3>
                    <div id="device-logs-container" style="max-height: 60vh; overflow-y:auto; padding-right:0.5rem;"></div>
                </div>
                <div style="flex:1; min-width: 320px;" class="glass-panel">
                    <h3 style="margin-bottom:1rem; border-bottom:1px solid var(--border); padding-bottom:0.5rem;"><i class="fa-solid fa-bell"></i> الإشعارات الأخيرة</h3>
                    <div id="notifications-container" style="max-height: 60vh; overflow-y:auto; padding-right:0.5rem;"></div>
                </div>
            </div>
        `;

        this.loadDeviceLogs();
        this.loadNotifications();
    }

    loadDeviceLogs() {
        const logsContainer = document.getElementById('device-logs-container');
        if (!logsContainer) return;

        const logs = storage.getDeviceLogs().sort((a, b) => new Date(b.date) - new Date(a.date));
        if (logs.length === 0) {
            logsContainer.innerHTML = '<p class="text-muted">لا توجد حركات أجهزة حديثة مسجلة.</p>';
            return;
        }

        let html = '';
        logs.forEach(log => {
            const dStr = new Date(log.date).toLocaleString('ar-EG');
            html += `
                <div style="margin-bottom: 1rem; padding: 1rem; border-right: 4px solid var(--primary); background: var(--bg-main); border-radius: var(--radius-sm);">
                    <div class="flex-between" style="margin-bottom:0.5rem;">
                        <strong><i class="fa-solid fa-laptop-medical text-primary"></i> ${log.deviceName}</strong>
                        <span style="font-size:0.8rem; color:var(--text-muted);">${dStr}</span>
                    </div>
                    <p style="font-size:0.9rem; margin:0.2rem 0;">الفروع: <span style="color:var(--text-muted);">${log.oldBranch} <i class="fa-solid fa-arrow-left"></i></span> ${log.newBranch}</p>
                    <p style="font-size:0.9rem; margin:0.2rem 0;">الحالة: <span style="color:var(--text-muted);">${log.oldStatusStr} <i class="fa-solid fa-arrow-left"></i></span> ${log.newStatusStr}</p>
                    <div style="margin:0.8rem 0 0 0; background:rgba(255, 193, 7, 0.1); padding:0.8rem; border-radius:4px; border-right: 2px solid var(--warning);">
                        <span style="font-size:0.85rem; color:var(--warning); display:block; margin-bottom:0.2rem;">سبب النقل/التعديل:</span>
                        <p style="margin:0; font-size:0.9rem; font-weight:500;">${log.reason}</p>
                    </div>
                    <p style="font-size:0.8rem; margin:0.5rem 0 0 0; color:var(--text-muted); text-align:left;">بناءً على طلب من: ${log.userName}</p>
                </div>
            `;
        });
        logsContainer.innerHTML = html;
    }

    loadNotifications() {
        const notifsContainer = document.getElementById('notifications-container');
        if (!notifsContainer) return;

        const notifs = storage.getNotifications().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        if (notifs.length === 0) {
            notifsContainer.innerHTML = '<p class="text-muted">لا توجد إشعارات حالياً.</p>';
            return;
        }

        let html = '';
        notifs.forEach(n => {
            let readBy = [];
            try { readBy = typeof n.readBy === 'string' ? JSON.parse(n.readBy) : (n.readBy || []); } catch (e) { }
            const isRead = readBy.includes(this.currentUser.id);
            const badgeClass = n.type === 'success' ? 'badge-success' : 'badge-warning';
            const icon = n.type === 'success' ? 'fa-check-circle' : 'fa-bell';
            const bgClass = isRead ? '' : 'unread-notif';
            const dStr = new Date(n.timestamp).toLocaleString('ar-EG');
            const bgStyle = isRead ? 'background: var(--bg-main); opacity:0.85;' : 'background: rgba(var(--primary-rgb), 0.1); border-right: 4px solid var(--accent);';

            html += `
                <div class="${bgClass}" style="margin-bottom: 1rem; padding: 1rem; border-radius: var(--radius-sm); transition: 0.3s ease; ${bgStyle}">
                    <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                        <p style="margin:0; font-size:0.95rem; line-height:1.4;"><i class="fa-solid ${icon} ${badgeClass.replace('badge-', 'text-')}"></i> ${n.message}</p>
                        ${!isRead ? `<button class="btn btn-sm" style="font-size:0.75rem; background:transparent; color:var(--accent); border:1px solid currentColor;" onclick="app.markAsRead('${n.id}')">تحديد كمقروء</button>` : ''}
                    </div>
                    <p style="font-size:0.75rem; color:var(--text-muted); margin:0.5rem 0 0 0; text-align:left;">${dStr}</p>
                </div>
            `;
        });
        notifsContainer.innerHTML = html;
    }

    async markAsRead(notifId) {
        if (await storage.markNotificationRead(notifId, this.currentUser.id)) {
            if (this.currentView === 'reports') {
                this.loadNotifications();
            }
            this.updateNotificationBell();
        }
    }

    updateNotificationBell() {
        if (!this.currentUser) return;
        const notifs = storage.getNotifications();
        let unreadCount = 0;
        notifs.forEach(n => {
            let readBy = [];
            try { readBy = typeof n.readBy === 'string' ? JSON.parse(n.readBy) : (n.readBy || []); } catch (e) { }
            if (!readBy.includes(this.currentUser.id)) {
                unreadCount++;
            }
        });

        const badges = [document.getElementById('desktop-notif-badge'), document.getElementById('mobile-notif-badge')];
        badges.forEach(b => {
            if (b) {
                if (unreadCount > 0) {
                    b.style.display = 'inline-block';
                    b.innerText = unreadCount;
                } else {
                    b.style.display = 'none';
                }
            }
        });
    }
}

window.app = new App();
