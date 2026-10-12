// Isi dari Supabase: Settings > API Keys (Project URL + anon / publishable key).
// Jangan pernah memakai service_role / secret key di sini.
const SUPABASE_URL = "https://elwggwrcldvmhixbkqfl.supabase.co";
const SUPABASE_KEY = "sb_publishable_d4ut-genWGHbHhPI6aFyHQ_8yR4mOS-";
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
