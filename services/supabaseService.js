// services/supabaseService.js
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('❌ CRITICAL: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables are missing!');
    console.error('Please configure them in your .env file.');
}

const supabase = createClient(
    supabaseUrl || 'https://placeholder.supabase.co', 
    supabaseServiceKey || 'placeholder'
);

module.exports = supabase;
