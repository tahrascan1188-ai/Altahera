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

        if (navTests) navTests.style.display = (this.hasPermission('Manage Tests') || this.hasPermission('Edit Tests')) ? 'flex' : 'none';
        if (navUsers) navUsers.style.display = this.hasPermission('Manage Users') ? 'flex' : 'none';
        if (navGlobalDevices) navGlobalDevices.style.display = this.hasPermission('Manage Devices') ? 'flex' : 'none';

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
                <div class="dashboard-header">
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
        }
    }

    // --- Tests View ---
    renderTestsView(container) {
        container.innerHTML = `
            <div class="view-header">
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
                    <div class="test-warning">
                        <i class="fa-solid fa-triangle-exclamation"></i>
                        <span>غير متاح مؤقتاً لوجود عطل بالجهاز (${device ? device.name : ''}).</span>
                    </div>
                `;
            }

            const card = document.createElement('div');
            card.className = `glass-panel test-card ${!isAvailable ? 'disabled-card' : ''}`;

            // Specific days parsing
            let daysDisp = 'طوال الأسبوع';
            try {
                let specD = typeof test.specificDays === 'string' ? JSON.parse(test.specificDays) : test.specificDays;
                if (Array.isArray(specD) && specD.length > 0) daysDisp = specD.join('، ');
            } catch (e) { }
            if (test.allWeek) daysDisp = 'طوال الأسبوع';

            card.innerHTML = `
                <div class="test-card-header">
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
            <div class="view-header flex-between">
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
                    <div class="device-actions" style="margin-top: 1rem;">
                        <select onchange="app.changeDeviceStatus('${dev.id}', this.value)" class="status-select" style="padding: 0.5rem; width:100%; border:1px solid var(--border); border-radius:var(--radius-sm)">
                            <option value="Available" ${dev.status === 'Available' ? 'selected' : ''}>متاح</option>
                            <option value="Maintenance" ${dev.status === 'Maintenance' ? 'selected' : ''}>صيانة</option>
                            <option value="Out of Service" ${dev.status === 'Out of Service' ? 'selected' : ''}>خارج الخدمة</option>
                        </select>
                    </div>
                `;
            }

            const card = document.createElement('div');
            card.className = 'glass-panel device-card';
            card.innerHTML = `
                <div class="device-header">
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

        container.innerHTML = `
            <div class="view-header flex-between" style="margin-bottom:1.5rem;">
                <div>
                    <h2 style="margin:0;"><i class="fa-solid fa-calendar-week" style="color:var(--primary);margin-left:0.5rem;"></i> جدول الأطباء الأسبوعي</h2>
                    <p style="margin:0.25rem 0 0; color:var(--text-muted); font-size:0.9rem;">عرض مواعيد الأطباء حسب أيام الأسبوع</p>
                </div>
                <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
                    ${canManageDoctors ? '<button class="btn btn-primary" onclick="app.showAddDoctorModal()"><i class="fa-solid fa-user-plus"></i> إضافة طبيب</button>' : ''}
                    ${canManageSchedules ? '<button class="btn" style="background:var(--secondary); color:#fff;" onclick="app.showAddScheduleModal()"><i class="fa-solid fa-calendar-plus"></i> إضافة موعد</button>' : ''}
                </div>
            </div>
            <div id="weekly-calendar" class="weekly-calendar-grid"></div>
        `;
        this.loadDoctorsCalendar(canManageSchedules);
    }

    loadDoctorsCalendar(canManageSchedules) {
        const calendarEl = document.getElementById('weekly-calendar');
        if (!calendarEl) return;

        const days = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
        const dayIcons = ['🗓️', '☀️', '🌙', '⭐', '🌿', '🌟', '🕌'];

        let allDoctors = [];
        if (this.currentUser.branchId === 'all') {
            allDoctors = storage.getDoctors();
        } else {
            allDoctors = storage.getDoctorsByBranch(this.currentUser.branchId);
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

        // Determine today's Arabic day name
        const todayNames = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
        const todayAr = todayNames[new Date().getDay()];

        calendarEl.innerHTML = days.map((day, idx) => {
            const entries = dayMap[day];
            const isToday = day === todayAr;

            const cardsHtml = entries.length === 0
                ? `<div class="cal-empty"><i class="fa-regular fa-calendar-xmark"></i><span>لا يوجد</span></div>`
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
                    <div class="cal-day-header">
                        <span class="cal-day-icon">${dayIcons[idx]}</span>
                        <span class="cal-day-name">${day}</span>
                        ${isToday ? '<span class="cal-today-badge">اليوم</span>' : ''}
                        <span class="cal-count">${entries.length}</span>
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
        } else {
            this.showToast('فشل التحديث', 'error');
        }
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

    loadDoctorsSchedules(canManageSchedules) {
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
        container.innerHTML = `
            <div class="view-header flex-between">
                <h2>إدارة التحاليل والأشعة</h2>
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

            if (await storage.updateTest(test)) {
                this.showToast('تم التحديث بنجاح', 'success');
                this.loadManageTests(this.hasPermission('Edit Tests'));
                this.closeModal();
            } else {
                this.showToast('فشل التحديث', 'error');
            }
        } else {
            this.showToast('الرجاء إدخال سعر صحيح', 'error');
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

    showAddUserModal() {
        const bodyHtml = `
            <div class="form-group-modal">
                <label>الاسم</label>
                <input type="text" id="modal-user-name" placeholder="اسم المستخدم">
            </div>
            <div class="form-group-modal">
                <label>البريد الإلكتروني (اسم مستخدم الدخول)</label>
                <input type="text" id="modal-user-email" placeholder="مثال: user.name">
            </div>
            <div class="form-group-modal">
                <label>الدور</label>
                <input type="text" id="modal-user-role" placeholder="مثال: Reception, Manager" value="Employee">
            </div>
            <div class="form-group-modal">
                <label>الصلاحيات المبدئية</label>
                <label class="checkbox-group"><input type="checkbox" id="modal-perm-tests"> عرض التحاليل والمواعيد</label>
                <label class="checkbox-group"><input type="checkbox" id="modal-perm-devices"> أجهزة الفروع (Global Devices)</label>
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
        const pTests = document.getElementById('modal-perm-tests').checked;
        const pDevices = document.getElementById('modal-perm-devices').checked;

        if (!name || !email) {
            this.showToast('يجب إدخال الاسم والبريد الإلكتروني', 'error');
            return;
        }

        let perms = [];
        if (pTests) perms.push("View Tests");
        if (pDevices) perms.push("Manage Devices");

        const btn = document.querySelector('.modal-footer .btn-primary');
        const origText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري الحفظ...';
        btn.disabled = true;

        const res = await storage.addUser({
            name: name,
            email: email,
            password: '123',
            branchId: this.currentUser.branchId === 'all' ? 'b1' : this.currentUser.branchId, // Default to their own branch
            role: role,
            status: 'Active',
            permissions: perms
        });

        if (res) {
            this.showToast('تم الإضافة بكلمة مرور 123', 'success');
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

        const bodyHtml = `
            <div class="form-group-modal">
                <label>الدور / الوظيفة</label>
                <input type="text" id="modal-edit-role" value="${user.role}">
            </div>
            <div class="modal-footer">
                <button class="btn" style="background:var(--border-color);" onclick="app.closeModal()">إلغاء</button>
                <button class="btn btn-primary" onclick="app.submitEditRole('${user.id}')">تحديث</button>
            </div>
        `;
        this.openModal(`تعديل دور: ${user.name}`, bodyHtml);
    }

    async submitEditRole(userId) {
        const user = storage.getUserById(userId);
        if (!user) return;

        const newRole = document.getElementById('modal-edit-role').value.trim();
        if (newRole) {
            user.role = newRole;
            const res = await storage.updateUser(user);
            if (res) {
                this.showToast('تم تحديث الدور بنجاح', 'success');
                this.loadUsersTable();
                this.closeModal();
            } else {
                this.showToast('حدث خطأ', 'error');
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

        const res = await storage.apiPost('ADD', 'Devices', newDevice);
        if (res) {
            this.showToast('تم إضافة الجهاز بنجاح', 'success');
            await storage.syncDB();
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
}

window.app = new App();
