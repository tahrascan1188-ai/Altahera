-- supabase-schema.sql
-- Run this script in the Supabase SQL Editor to initialize your database structure.

-- Disable triggers temporarily if needed
SET session_replication_role = 'replica';

-- 1. Create Enums and Custom Types
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
        CREATE TYPE user_role AS ENUM ('Administrator', 'Branch Manager', 'Doctor', 'Call Center');
    END IF;
END $$;

-- 2. Create Tables

-- Branches Table
CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL
);

-- Users Table (linked optionally to Supabase Auth via trigger or direct lookup)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, -- Matches auth.uid() string or local custom UID
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL, -- Plaintext or hashed depending on auth strategy
    branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
    role user_role NOT NULL DEFAULT 'Call Center',
    status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Suspended')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Devices Table
CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'Available' CHECK (status IN ('Available', 'Maintenance', 'Out of Service'))
);

-- Doctors Table
CREATE TABLE IF NOT EXISTS doctors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    specialty TEXT NOT NULL,
    branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL
);

-- Schedules Table
CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    doctor_id TEXT REFERENCES doctors(id) ON DELETE CASCADE,
    branch_id TEXT REFERENCES branches(id) ON DELETE SET NULL,
    day_of_week TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Available' CHECK (status IN ('Available', 'Excused', 'Not Available'))
);

-- Device Logs Table
CREATE TABLE IF NOT EXISTS device_logs (
    id TEXT PRIMARY KEY,
    device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
    device_name TEXT NOT NULL,
    old_branch TEXT,
    new_branch TEXT,
    old_status_str TEXT,
    new_status_str TEXT,
    reason TEXT,
    date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    user_name TEXT
);

-- Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    message TEXT NOT NULL,
    type TEXT NOT NULL,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    read_by TEXT NOT NULL DEFAULT '[]'
);

-- Tests Table (Medical Analyses & Scans)
CREATE TABLE IF NOT EXISTS tests (
    id TEXT PRIMARY KEY,
    name_ar TEXT NOT NULL,
    name_en TEXT NOT NULL,
    category TEXT NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    instructions TEXT,
    device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
    specific_days TEXT,
    all_week BOOLEAN NOT NULL DEFAULT TRUE
);

-- AI Settings Table (Singular Config row enforced)
CREATE TABLE IF NOT EXISTS ai_settings (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    api_key_1 TEXT,
    api_key_2 TEXT,
    api_key_3 TEXT,
    system_instruction TEXT,
    personal_chats_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    groups_whitelist TEXT DEFAULT '',
    active_key_index INTEGER NOT NULL DEFAULT 1 CHECK (active_key_index IN (1, 2, 3))
);

-- Chat Locks Table (Real-time Collision Lock)
CREATE TABLE IF NOT EXISTS chat_locks (
    chat_id TEXT PRIMARY KEY,
    user_name TEXT NOT NULL,
    socket_id TEXT NOT NULL,
    locked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Re-enable triggers
SET session_replication_role = 'origin';

-- 3. Create Indexes for High Performance Queries
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_devices_branch ON devices(branch_id);
CREATE INDEX IF NOT EXISTS idx_schedules_doctor ON schedules(doctor_id);
CREATE INDEX IF NOT EXISTS idx_device_logs_device ON device_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_tests_device ON tests(device_id);

-- 4. Disable Row Level Security (RLS) on all tables
-- Since the frontend queries directly using the public anon key without Supabase Auth,
-- RLS must be disabled for the application to function correctly.
ALTER TABLE branches DISABLE ROW LEVEL SECURITY;
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE devices DISABLE ROW LEVEL SECURITY;
ALTER TABLE doctors DISABLE ROW LEVEL SECURITY;
ALTER TABLE schedules DISABLE ROW LEVEL SECURITY;
ALTER TABLE device_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE tests DISABLE ROW LEVEL SECURITY;
ALTER TABLE ai_settings DISABLE ROW LEVEL SECURITY;
ALTER TABLE chat_locks DISABLE ROW LEVEL SECURITY;

-- 5. Helper Function to determine User Role (Retained for backwards compatibility)
CREATE OR REPLACE FUNCTION get_my_role()
RETURNS user_role AS $$
    SELECT role FROM users WHERE id = auth.uid()::text LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;


-- 7. Seed Initial Seed Data (Enables Admin access on new instances)
INSERT INTO branches (id, name) VALUES ('b1', 'روكسي') ON CONFLICT (id) DO NOTHING;
INSERT INTO users (id, name, email, password, branch_id, role, status)
VALUES ('u_admin', 'مدير النظام الأساسي', 'admin', 'admin', 'b1', 'Administrator', 'Active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_settings (id, api_key_1, api_key_2, api_key_3, system_instruction, personal_chats_enabled, groups_whitelist)
VALUES (1, NULL, NULL, NULL, 'أنت مساعد طبي ذكي لمركز الطاهرة...', TRUE, '')
ON CONFLICT (id) DO NOTHING;
