import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const parseEnv = (text) => {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line
      .slice(idx + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    out[key] = value;
  }
  return out;
};

const env = parseEnv(fs.readFileSync('.env', 'utf8'));
const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials in .env.');
}

const ids = process.argv.slice(2).map((value) => value.trim().toUpperCase()).filter(Boolean);
if (ids.length === 0) {
  throw new Error('Pass at least one staff ID, for example: node scripts/inspect-staff-records.mjs US014919');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const print = (label, result) => {
  console.log(`\n[${label}]`);
  console.log(JSON.stringify(result.error ? { error: result.error.message } : result.data, null, 2));
};

const runEmployees = async (selectColumns) =>
  await supabase
    .from('ob_employees')
    .select(selectColumns)
    .in('staff_id', ids)
    .order('staff_id');
let employees = await runEmployees('staff_id,name,agency,Agency,position,Position,active,terminated_at,updated_at');
if (employees.error && /updated_at/i.test(String(employees.error.message ?? ''))) {
  employees = await runEmployees('staff_id,name,agency,Agency,position,Position,active,terminated_at');
}
print('employees', employees);

const runSchedules = async (selectColumns) =>
  await supabase
    .from('ob_schedules')
    .select(selectColumns)
    .in('staff_id', ids)
    .order('date', { ascending: false })
    .order('staff_id', { ascending: true })
    .limit(120);
let schedules = await runSchedules('id,staff_id,date,shift,position,note,operator,updated_at,created_at');
if (schedules.error && /shift/i.test(String(schedules.error.message ?? ''))) {
  schedules = await runSchedules('id,staff_id,date,position,note,operator,updated_at,created_at');
}
print('schedules', schedules);
