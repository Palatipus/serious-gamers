import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl  = process.env.SUPABASE_URL;
const supabaseKey  = process.env.SUPABASE_ANON_KEY;
const serviceKey   = process.env.SUPABASE_SERVICE_KEY;

// Regular client for normal DB operations
export const supabase = createClient(supabaseUrl, supabaseKey);

// Service client for storage uploads (bypasses RLS, backend-only)
export const supabaseAdmin = createClient(supabaseUrl, serviceKey || supabaseKey);
