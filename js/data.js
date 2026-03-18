const initialBranches = [
    { id: 'b1', name: 'روكسي' },
    { id: 'b2', name: 'المقطم' },
    { id: 'b3', name: 'فيصل' },
    { id: 'b4', name: 'حدائق الأهرام' },
    { id: 'b5', name: 'المنيا' },
    { id: 'b6', name: 'السيدة زينب' },
    { id: 'b7', name: 'ميت غمر' }
];

const initialDevices = [];

const initialTests = [];

const initialDoctors = [];

const initialSchedules = [];

// Branches mappings for quick reference:
// b1: روكسي, b2: المقطم, b3: فيصل, b4: حدائق الأهرام, b5: المنيا, b6: السيدة زينب, b7: ميت غمر

const initialUsers = [
    {
        id: 'u_admin',
        name: 'مدير النظام الأساسي',
        email: 'admin',
        password: 'admin', // Kept easy for testing depending on the environment, user can change later
        branchId: 'b1',
        role: 'Administrator',
        status: 'Active',
        permissions: JSON.stringify([
            "View Tests", "Add Tests", "Edit Tests", "Delete Tests",
            "Manage Devices", "Manage Doctors", "Manage Schedules", "Manage Users"
        ])
    },
    // --- Branch Managers (Regional Admins) ---
    { id: 'u_mgr_b1', name: 'مدير فرع روكسي', email: 'admin.roxy', password: '123', branchId: 'b1', role: 'Branch Manager', status: 'Active', permissions: JSON.stringify(["View Tests", "Add Tests", "Edit Tests", "Manage Devices", "Manage Doctors", "Manage Schedules"]) },
    { id: 'u_mgr_b2', name: 'مدير فرع المقطم', email: 'admin.mokattam', password: '123', branchId: 'b2', role: 'Branch Manager', status: 'Active', permissions: JSON.stringify(["View Tests", "Add Tests", "Edit Tests", "Manage Devices", "Manage Doctors", "Manage Schedules"]) },
    { id: 'u_mgr_b3', name: 'مدير فرع فيصل', email: 'admin.faisal', password: '123', branchId: 'b3', role: 'Branch Manager', status: 'Active', permissions: JSON.stringify(["View Tests", "Add Tests", "Edit Tests", "Manage Devices", "Manage Doctors", "Manage Schedules"]) },
    { id: 'u_mgr_b4', name: 'مدير فرع حدائق الأهرام', email: 'admin.hadaek', password: '123', branchId: 'b4', role: 'Branch Manager', status: 'Active', permissions: JSON.stringify(["View Tests", "Add Tests", "Edit Tests", "Manage Devices", "Manage Doctors", "Manage Schedules"]) },
    { id: 'u_mgr_b5', name: 'مدير فرع المنيا', email: 'admin.minya', password: '123', branchId: 'b5', role: 'Branch Manager', status: 'Active', permissions: JSON.stringify(["View Tests", "Add Tests", "Edit Tests", "Manage Devices", "Manage Doctors", "Manage Schedules"]) },
    { id: 'u_mgr_b6', name: 'مدير فرع السيدة زينب', email: 'admin.sayeda', password: '123', branchId: 'b6', role: 'Branch Manager', status: 'Active', permissions: JSON.stringify(["View Tests", "Add Tests", "Edit Tests", "Manage Devices", "Manage Doctors", "Manage Schedules"]) },
    { id: 'u_mgr_b7', name: 'مدير فرع ميت غمر', email: 'admin.mitghamr', password: '123', branchId: 'b7', role: 'Branch Manager', status: 'Active', permissions: JSON.stringify(["View Tests", "Add Tests", "Edit Tests", "Manage Devices", "Manage Doctors", "Manage Schedules"]) },

    // --- Call Center Team ---
    { id: 'u_cc_1', name: 'Adel Ahmed', email: 'Adel.ahmed', password: '123', branchId: 'all', role: 'Call Center', status: 'Active', permissions: JSON.stringify(["View Tests", "View Devices", "View Doctors", "View Schedules"]) },
    { id: 'u_cc_2', name: 'Aya Abdelmohsen', email: 'aya.mohsen', password: '123', branchId: 'all', role: 'Call Center', status: 'Active', permissions: JSON.stringify(["View Tests", "View Devices", "View Doctors", "View Schedules"]) },
    { id: 'u_cc_3', name: 'Eman Elfeky', email: 'Eman.Elfeky', password: '123', branchId: 'all', role: 'Call Center', status: 'Active', permissions: JSON.stringify(["View Tests", "View Devices", "View Doctors", "View Schedules"]) },
    { id: 'u_cc_4', name: 'Eman Khaled', email: 'Eman.Khaled', password: '123', branchId: 'all', role: 'Call Center', status: 'Active', permissions: JSON.stringify(["View Tests", "View Devices", "View Doctors", "View Schedules"]) },
    { id: 'u_cc_5', name: 'Hamed Elbadry Saied', email: 'hamed.elbadry', password: '123', branchId: 'all', role: 'Call Center', status: 'Active', permissions: JSON.stringify(["View Tests", "View Devices", "View Doctors", "View Schedules"]) },
    { id: 'u_cc_6', name: 'Hend Yassen', email: 'hend.yassen', password: '123', branchId: 'all', role: 'Call Center', status: 'Active', permissions: JSON.stringify(["View Tests", "View Devices", "View Doctors", "View Schedules"]) },
    { id: 'u_cc_7', name: 'Mai Mohamed', email: 'Mai.Mohamed', password: '123', branchId: 'all', role: 'Call Center', status: 'Active', permissions: JSON.stringify(["View Tests", "View Devices", "View Doctors", "View Schedules"]) },
    { id: 'u_cc_8', name: 'Marwa Ahmed', email: 'Marwa.Ahmed', password: '123', branchId: 'all', role: 'Call Center', status: 'Active', permissions: JSON.stringify(["View Tests", "View Devices", "View Doctors", "View Schedules"]) },
    { id: 'u_cc_9', name: 'Mohamed Adel', email: 'Mohamed.adel', password: '123', branchId: 'all', role: 'Call Center', status: 'Active', permissions: JSON.stringify(["View Tests", "View Devices", "View Doctors", "View Schedules"]) },
    { id: 'u_cc_10', name: 'Mohamed Shehata', email: 'Mohamed.Shehata', password: '123', branchId: 'all', role: 'Call Center', status: 'Active', permissions: JSON.stringify(["View Tests", "View Devices", "View Doctors", "View Schedules"]) },
    { id: 'u_cc_11', name: 'mostafa shehata', email: 'mostafa.shehata', password: '123', branchId: 'all', role: 'Call Center', status: 'Active', permissions: JSON.stringify(["View Tests", "View Devices", "View Doctors", "View Schedules"]) },
    { id: 'u_cc_12', name: 'Nada Sayed', email: 'Nada.Sayed', password: '123', branchId: 'all', role: 'Call Center', status: 'Active', permissions: JSON.stringify(["View Tests", "View Devices", "View Doctors", "View Schedules"]) },
    { id: 'u_cc_13', name: 'saad mohamed', email: 'saad.mohamed', password: '123', branchId: 'all', role: 'Call Center', status: 'Active', permissions: JSON.stringify(["View Tests", "View Devices", "View Doctors", "View Schedules"]) },
    { id: 'u_cc_14', name: 'sayed shaaban', email: 'sayed.shaaban', password: '123', branchId: 'all', role: 'Call Center', status: 'Active', permissions: JSON.stringify(["View Tests", "View Devices", "View Doctors", "View Schedules"]) },
    { id: 'u_cc_15', name: 'Yasmin Hassan Ibrahim', email: 'yasmin.ibrahim', password: '123', branchId: 'all', role: 'Call Center', status: 'Active', permissions: JSON.stringify(["View Tests", "View Devices", "View Doctors", "View Schedules"]) },
    { id: 'u_cc_16', name: 'Ziad Ehab', email: 'ziad.ehab', password: '123', branchId: 'all', role: 'Call Center', status: 'Active', permissions: JSON.stringify(["View Tests", "View Devices", "View Doctors", "View Schedules"]) }
];

// Seed function
function seedInitialData(storageManager) {
    if (!localStorage.getItem('altahera_seeded_v6')) {
        storageManager.saveLocalCache('branches', initialBranches);
        // Always reset users to ensure correct credentials
        storageManager.saveLocalCache('users', initialUsers);
        localStorage.setItem('altahera_seeded_v6', 'true');
        // Clear old seed keys
        localStorage.removeItem('altahera_seeded_v5');
        localStorage.removeItem('altahera_seeded_v4');
    }
}
