window.CONFIG = {
    GOOGLE_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzp2otr64XQ4PTt3EnYoxq30JwiXS9B_p2MV7ol49Cdy_8Xgs62mPFq3WZRnRUAHSugkA/exec' // Web App endpoint
};

class StorageManager {
    constructor() {
        this.cache = {
            users: [],
            branches: [],
            devices: [],
            tests: [],
            doctors: [],
            schedules: []
        };
        this.loadLocalCache();

        // Local seed fallback if empty
        if (this.cache.branches.length === 0 && typeof seedInitialData === 'function') {
            seedInitialData(this);
        }
    }

    // --- Core Sync Mechanics ---
    loadLocalCache() {
        const keys = Object.keys(this.cache);
        keys.forEach(k => {
            const data = localStorage.getItem('db_' + k);
            if (data) {
                try { this.cache[k] = JSON.parse(data); } catch (e) { }
            }
        });
    }

    saveLocalCache(key, data) {
        this.cache[key] = data;
        localStorage.setItem('db_' + key, JSON.stringify(data));
    }

    async syncDB() {
        if (!window.CONFIG.GOOGLE_APPS_SCRIPT_URL) {
            console.warn("Google Apps Script URL not configured. Operating in Offline/Local Mode.");
            return true;
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000); // 6 sec timeout

            const res = await fetch(`${window.CONFIG.GOOGLE_APPS_SCRIPT_URL}?action=GET_DB`, { signal: controller.signal });
            clearTimeout(timeoutId);
            const json = await res.json();
            if (json.status === 'success' && json.data) {
                const db = json.data;

                // Auto-Seed Admin User if Users sheet is completely empty
                if (!db.users || db.users.length === 0) {
                    console.log("Empty Users detected. Injecting Admin user to Google Sheets...");
                    if (typeof initialUsers !== 'undefined' && initialUsers.length > 0) {
                        for (const u of initialUsers) {
                            await this.apiPost('ADD', 'Users', u);
                        }
                        db.users = initialUsers;
                    }
                }

                // Auto-Seed Branches if Branches sheet is completely empty
                if (!db.branches || db.branches.length === 0) {
                    console.log("Empty Branches detected. Injecting base branches to Google Sheets...");
                    if (typeof initialBranches !== 'undefined' && initialBranches.length > 0) {
                        for (const b of initialBranches) {
                            await this.apiPost('ADD', 'Branches', b);
                        }
                        db.branches = initialBranches;
                    }
                }

                Object.keys(db).forEach(k => {
                    this.saveLocalCache(k, db[k]);
                });
                return true;
            }
            return false;
        } catch (e) {
            console.warn("Failed to sync DB from Google Sheets (Timeout/Network Error). Working happily from Local Cache.", e);
            return true; // Graceful offline mode
        }
    }

    async apiPost(action, sheetName, dataObj) {
        if (!window.CONFIG.GOOGLE_APPS_SCRIPT_URL) {
            console.warn("Offline Mode - Local Mutation", action, sheetName);
            return this.localMutation(action, sheetName, dataObj);
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 sec timeout

            const res = await fetch(window.CONFIG.GOOGLE_APPS_SCRIPT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({
                    action: action,
                    sheetName: sheetName,
                    data: dataObj
                }),
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            const json = await res.json();
            if (json.status === 'success') {
                return json.data;
            } else {
                console.error("API Error", json.error);
                return this.localMutation(action, sheetName, dataObj); // Fallback to local
            }
        } catch (e) {
            console.warn("API Network Error (Timeout/Offline) - Mutating Locally", e);
            return this.localMutation(action, sheetName, dataObj);
        }
    }

    localMutation(action, sheetName, dataObj) {
        let key = sheetName.toLowerCase();
        let arr = this.cache[key] || [];
        if (action === 'ADD') {
            const newObj = { ...dataObj };
            newObj.id = dataObj.id || Date.now().toString();
            arr.push(newObj);
            this.saveLocalCache(key, arr);
            return newObj;
        } else if (action === 'UPDATE') {
            const idx = arr.findIndex(i => i.id === dataObj.id);
            if (idx > -1) {
                arr[idx] = { ...arr[idx], ...dataObj };
                this.saveLocalCache(key, arr);
                return arr[idx];
            }
        } else if (action === 'DELETE') {
            this.saveLocalCache(key, arr.filter(i => i.id !== dataObj.id));
            return dataObj;
        }
        return null;
    }

    // --- USERS ---
    getUsers() { return this.cache['users'] || []; }
    getUserById(id) { return this.getUsers().find(u => u.id == id); }
    getUserByEmail(email) { return this.getUsers().find(u => u.email === email); }
    async addUser(data) {
        let permissionsStr = data.permissions;
        if (Array.isArray(permissionsStr)) {
            permissionsStr = JSON.stringify(permissionsStr);
        }
        const obj = { ...data, permissions: permissionsStr };
        const res = await this.apiPost('ADD', 'Users', obj);
        if (res) {
            this.localMutation('ADD', 'Users', res);
            return res;
        }
        return false;
    }
    async updateUser(data) {
        let permissionsStr = data.permissions;
        if (Array.isArray(permissionsStr)) {
            permissionsStr = JSON.stringify(permissionsStr);
        }
        const obj = { ...data, permissions: permissionsStr };
        const res = await this.apiPost('UPDATE', 'Users', obj);
        if (res) {
            this.localMutation('UPDATE', 'Users', res);
            return true;
        }
        return false;
    }
    async deleteUser(id) {
        const res = await this.apiPost('DELETE', 'Users', { id: id });
        if (res) {
            this.localMutation('DELETE', 'Users', { id: id });
            return true;
        }
        return false;
    }

    // --- BRANCHES ---
    getBranches() { return this.cache['branches'] || []; }
    getBranchById(id) { return this.getBranches().find(b => b.id == id); }

    // --- DEVICES ---
    getDevices() { return this.cache['devices'] || []; }
    getDevicesByBranch(branchId) { return this.getDevices().filter(d => d.branchId == branchId); }
    getDeviceById(id) { return this.getDevices().find(d => d.id == id); }
    async addDevice(data) {
        const res = await this.apiPost('ADD', 'Devices', data);
        if (res) {
            this.localMutation('ADD', 'Devices', res);
            return res;
        }
        return false;
    }
    async updateDeviceStatus(id, status) {
        const dev = this.getDeviceById(id);
        if (dev) {
            const data = { ...dev, status: status };
            const res = await this.apiPost('UPDATE', 'Devices', data);
            if (res) {
                this.localMutation('UPDATE', 'Devices', data);
                return true;
            }
        }
        return false;
    }

    // --- TESTS ---
    getTests() { return this.cache['tests'] || []; }
    getTestById(id) { return this.getTests().find(t => t.id == id); }
    async addTest(data) {
        const obj = { ...data };
        if (Array.isArray(obj.specificDays)) obj.specificDays = JSON.stringify(obj.specificDays);
        const res = await this.apiPost('ADD', 'Tests', obj);
        if (res) {
            this.localMutation('ADD', 'Tests', res);
            return res;
        }
        return false;
    }
    async updateTest(data) {
        const obj = { ...data };
        if (Array.isArray(obj.specificDays)) obj.specificDays = JSON.stringify(obj.specificDays);
        const res = await this.apiPost('UPDATE', 'Tests', obj);
        if (res) {
            this.localMutation('UPDATE', 'Tests', res);
            return true;
        }
        return false;
    }

    // --- DOCTORS ---
    getDoctors() { return this.cache['doctors'] || []; }
    getDoctorsByBranch(branchId) { return this.getDoctors().filter(d => d.branchId == branchId); }
    getDoctorById(id) { return this.getDoctors().find(d => d.id == id); }
    async addDoctor(data) {
        const res = await this.apiPost('ADD', 'Doctors', data);
        if (res) {
            this.localMutation('ADD', 'Doctors', res);
            return res;
        }
        return false;
    }

    // --- SCHEDULES ---
    getSchedules() { return this.cache['schedules'] || []; }
    getSchedulesByDoctor(doctorId) { return this.getSchedules().filter(s => s.doctorId == doctorId); }
    async addSchedule(data) {
        const res = await this.apiPost('ADD', 'Schedules', data);
        if (res) {
            this.localMutation('ADD', 'Schedules', res);
            return res;
        }
        return false;
    }
    async updateScheduleStatus(id, status) {
        const sch = this.getSchedules().find(s => s.id == id);
        if (sch) {
            const data = { ...sch, status: status };
            const res = await this.apiPost('UPDATE', 'Schedules', data);
            if (res) {
                this.localMutation('UPDATE', 'Schedules', data);
                return true;
            }
        }
        return false;
    }
}

const storage = new StorageManager();
