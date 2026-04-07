import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const EMPLOYEE_TABLE = process.env.VITE_EMPLOYEE_TABLE || 'ob_employees';
const PUNCH_TABLE = process.env.PUNCH_TABLE || 'ob_punches';
const DAYS = Number(process.env.DAYS || 30);
const WRITE = process.env.WRITE !== '0';
const UPDATE_ALL = process.env.UPDATE_ALL === '1';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 0 } }
});

const toDate = (value) => {
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const overlapMs = (aStart, aEnd, bStart, bEnd) => {
  const start = Math.max(aStart, bStart);
  const end = Math.min(aEnd, bEnd);
  return Math.max(0, end - start);
};

const computeShiftMs = (start, end) => {
  let earlyMs = 0;
  let lateMs = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() < end.getTime()) {
    const dayStart = new Date(cursor);
    const earlyStart = new Date(dayStart);
    earlyStart.setHours(5, 0, 0, 0);
    const earlyEnd = new Date(dayStart);
    earlyEnd.setHours(15, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    // Late = [00:00, 05:00) + [15:00, 24:00)
    const lateStartA = dayStart;
    const lateEndA = new Date(dayStart);
    lateEndA.setHours(5, 0, 0, 0);
    const lateStartB = new Date(dayStart);
    lateStartB.setHours(15, 0, 0, 0);
    const lateEndB = dayEnd;

    const sMs = start.getTime();
    const eMs = end.getTime();
    earlyMs += overlapMs(sMs, eMs, earlyStart.getTime(), earlyEnd.getTime());
    lateMs += overlapMs(sMs, eMs, lateStartA.getTime(), lateEndA.getTime());
    lateMs += overlapMs(sMs, eMs, lateStartB.getTime(), lateEndB.getTime());

    cursor.setDate(cursor.getDate() + 1);
  }
  return { earlyMs, lateMs };
};

const getShiftFromEvents = (events) => {
  events.sort((a, b) => a.at.getTime() - b.at.getTime());
  let currentIn = null;
  let earlyMs = 0;
  let lateMs = 0;

  for (const ev of events) {
    if (ev.action === 'IN') {
      currentIn = ev.at;
      continue;
    }
    if (ev.action === 'OUT' && currentIn && ev.at.getTime() > currentIn.getTime()) {
      const { earlyMs: e, lateMs: l } = computeShiftMs(currentIn, ev.at);
      earlyMs += e;
      lateMs += l;
      currentIn = null;
    }
  }

  if (earlyMs > lateMs) return 'early';
  if (lateMs > earlyMs) return 'late';
  return '';
};

const fetchAllEmployees = async () => {
  const out = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const { data, error } = await supabase
      .from(EMPLOYEE_TABLE)
      .select('staff_id, shift')
      .order('staff_id', { ascending: true })
      .range(from, to);
    if (error) throw new Error(error.message);
    const rows = data || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
};

const fetchPunchesByStaffBatch = async (staffIds, rangeStart, rangeEnd) => {
  const eventsByStaff = new Map();
  const pageSize = 1000;
  const base = () =>
    supabase
      .from(PUNCH_TABLE)
      .select('staff_id, action, created_at')
      .in('staff_id', staffIds)
      .gte('created_at', rangeStart.toISOString())
      .lt('created_at', rangeEnd.toISOString());

  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    const attemptCreatedAt = await base().order('created_at', { ascending: true }).range(from, to);
    const attempt = attemptCreatedAt.error ? await base().order('id', { ascending: true }).range(from, to) : attemptCreatedAt;
    if (attempt.error) throw new Error(attempt.error.message);
    const rows = attempt.data || [];
    for (const row of rows) {
      const staff = String(row.staff_id ?? '').trim();
      const actionRaw = String(row.action ?? '').toUpperCase();
      const atRaw = String(row.created_at ?? '').trim();
      if (!staff || (actionRaw !== 'IN' && actionRaw !== 'OUT') || !atRaw) continue;
      const at = toDate(atRaw);
      if (!at) continue;
      const list = eventsByStaff.get(staff) || [];
      list.push({ at, action: actionRaw === 'OUT' ? 'OUT' : 'IN' });
      eventsByStaff.set(staff, list);
    }
    if (rows.length < pageSize) break;
  }

  return eventsByStaff;
};

const main = async () => {
  const rangeEnd = new Date();
  const rangeStart = new Date(rangeEnd);
  rangeStart.setDate(rangeStart.getDate() - Math.max(1, DAYS));

  const employees = await fetchAllEmployees();
  const staffIds = employees
    .map((e) => String(e.staff_id ?? '').trim())
    .filter(Boolean);

  const candidates = employees.filter((e) => {
    const shift = String(e.shift ?? '').trim();
    return UPDATE_ALL || !shift;
  });

  console.log(`Employees total: ${employees.length}`);
  console.log(`Candidates: ${candidates.length}`);

  const staffIdSet = new Set(candidates.map((e) => String(e.staff_id ?? '').trim()).filter(Boolean));
  const batchSize = 200;
  const updates = [];

  for (let i = 0; i < staffIds.length; i += batchSize) {
    const batch = staffIds.slice(i, i + batchSize);
    const batchTargets = batch.filter((id) => staffIdSet.has(id));
    if (batchTargets.length === 0) continue;

    const eventsByStaff = await fetchPunchesByStaffBatch(batchTargets, rangeStart, rangeEnd);
    for (const staff of batchTargets) {
      const events = eventsByStaff.get(staff) || [];
      const shift = getShiftFromEvents(events);
      updates.push({ staff_id: staff, shift });
    }
  }

  const toWrite = updates.filter((u) => u.shift === 'early' || u.shift === 'late');
  const emptyCount = updates.length - toWrite.length;

  console.log(`Resolved shifts: ${toWrite.length}`);
  console.log(`Unresolved (kept empty): ${emptyCount}`);

  if (!WRITE) {
    console.log('WRITE=0 set; skipping database update.');
    return;
  }

  let success = 0;
  let failed = 0;
  for (const row of toWrite) {
    const { error } = await supabase.from(EMPLOYEE_TABLE).update({ shift: row.shift }).eq('staff_id', row.staff_id);
    if (error) {
      failed += 1;
      console.warn(`Update failed for ${row.staff_id}: ${error.message}`);
    } else {
      success += 1;
    }
  }

  console.log(`Done. Updated: ${success}, Failed: ${failed}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
