import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const parseEnv = (text) => {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx <= 0) continue;
    out[line.slice(0, idx).trim()] = line
      .slice(idx + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }
  return out;
};

const env = parseEnv(fs.readFileSync('.env', 'utf8'));
const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials in .env.');
}

const args = process.argv.slice(2);
const deleteIndex = args.indexOf('--delete');
const deleteStaffIds =
  deleteIndex >= 0
    ? args
        .slice(deleteIndex + 1)
        .filter((value) => !value.startsWith('--'))
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean)
    : [];

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
});

const fetchAll = async (table, selectColumns) => {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const res = await supabase.from(table).select(selectColumns).range(from, to);
    if (res.error) throw new Error(`${table}: ${res.error.message}`);
    const pageRows = res.data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
  }
  return rows;
};

if (deleteStaffIds.length > 0) {
  const before = await supabase
    .from('ob_schedules')
    .select('id,staff_id,date,position,note')
    .in('staff_id', deleteStaffIds);
  if (before.error) throw new Error(`delete precheck: ${before.error.message}`);

  const del = await supabase.from('ob_schedules').delete().in('staff_id', deleteStaffIds).select('id,staff_id,date,position,note');
  if (del.error) throw new Error(`delete failed: ${del.error.message}`);

  console.log('\n[deleted]');
  console.log(
    JSON.stringify(
      {
        staffIds: deleteStaffIds,
        matchedBefore: before.data?.length ?? 0,
        deleted: del.data?.length ?? 0
      },
      null,
      2
    )
  );
}

const [employees, schedules] = await Promise.all([
  fetchAll('ob_employees', 'staff_id,name,agency,Agency,active,terminated_at'),
  fetchAll('ob_schedules', 'id,staff_id,date,position,note,operator,updated_at')
]);

const employeeStaffIds = new Set(
  employees.map((row) => String(row.staff_id ?? '').trim().toUpperCase()).filter(Boolean)
);
const byStaff = new Map();

for (const row of schedules) {
  const staffId = String(row.staff_id ?? '').trim().toUpperCase();
  if (!staffId || employeeStaffIds.has(staffId)) continue;
  const entry = byStaff.get(staffId) ?? {
    staff_id: staffId,
    schedule_count: 0,
    work_count: 0,
    rest_count: 0,
    positions: new Set(),
    latest_updated_at: '',
    sample_dates: []
  };
  entry.schedule_count += 1;
  const note = String(row.note ?? '').trim();
  if (note === '__rest__' || note === '__planned_rest__' || note === '__leave__' || note === '__temp_rest__') {
    entry.rest_count += 1;
  } else {
    entry.work_count += 1;
  }
  const position = String(row.position ?? '').trim();
  if (position) entry.positions.add(position);
  const updatedAt = String(row.updated_at ?? '').trim();
  if (updatedAt > entry.latest_updated_at) entry.latest_updated_at = updatedAt;
  const date = String(row.date ?? '').trim();
  if (date && entry.sample_dates.length < 5) entry.sample_dates.push(date);
  byStaff.set(staffId, entry);
}

const orphans = Array.from(byStaff.values())
  .map((entry) => ({
    ...entry,
    positions: Array.from(entry.positions).sort()
  }))
  .sort((a, b) => b.work_count - a.work_count || a.staff_id.localeCompare(b.staff_id, 'en-US'));

console.log('\n[orphan_schedule_staff]');
console.log(JSON.stringify(orphans, null, 2));
