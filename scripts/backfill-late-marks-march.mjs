import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const EMPLOYEE_TABLE = process.env.VITE_EMPLOYEE_TABLE || 'ob_employees';
const ATTENDANCE_MARKS_TABLE = process.env.VITE_ATTENDANCE_MARKS_TABLE || 'ob_attendance_marks';
const PUNCH_TABLE = process.env.PUNCH_TABLE || 'ob_punches';

const TARGET_MONTH = process.env.TARGET_MONTH || '2026-03';
const DAY_CUTOFF_HOUR_RAW = Number(process.env.VITE_DAY_CUTOFF_HOUR ?? 5);
const DAY_CUTOFF_HOUR = Number.isFinite(DAY_CUTOFF_HOUR_RAW)
  ? Math.max(0, Math.min(23, Math.round(DAY_CUTOFF_HOUR_RAW)))
  : 5;
const LATE_GRACE_MINUTES_RAW = Number(process.env.LATE_GRACE_MINUTES ?? 10);
const LATE_GRACE_MINUTES = Number.isFinite(LATE_GRACE_MINUTES_RAW) ? Math.max(0, Math.round(LATE_GRACE_MINUTES_RAW)) : 10;
const WRITE = process.env.WRITE === '1';
const OPERATOR = process.env.OPERATOR || 'script:backfill-late-marks-march';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/VITE_SUPABASE_ANON_KEY.');
  process.exit(1);
}

if (!/^\d{4}-\d{2}$/.test(TARGET_MONTH)) {
  console.error(`Invalid TARGET_MONTH: ${TARGET_MONTH}. Expected YYYY-MM.`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 0 } }
});

const parseClockTextToMinutes = (value) => {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
};

const formatClockMinutes = (value) => {
  const minutes = Math.round(Number(value ?? 0));
  if (!Number.isFinite(minutes) || minutes < 0) return '00:00';
  const normalized = minutes % (24 * 60);
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

const normalizeShiftValue = (value) => {
  const v = String(value ?? '').trim().toLowerCase();
  if (v === 'early' || v === 'day' || v === 'morning') return 'early';
  if (v === 'late' || v === 'night' || v === 'evening') return 'late';
  return '';
};

const normalizePosition = (value) => String(value ?? '').trim();

const normalizeShiftTimeValue = (value) => {
  const parsed = parseClockTextToMinutes(String(value ?? '').trim());
  return Number.isFinite(parsed) ? formatClockMinutes(parsed) : '';
};

const getDefaultShiftStartTime = (shift, position) => {
  const pos = String(position ?? '').trim().toLowerCase();
  const isPickTrack = pos === 'pick';
  if (shift === 'early') return isPickTrack ? '07:00' : '08:00';
  return isPickTrack ? '15:30' : '16:30';
};

const inferShiftFromStartMinutes = (minutes) => (minutes < 12 * 60 ? 'early' : 'late');

const toDateOnly = (value) => {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const toDateOnlyUtc = (value) => {
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return '';
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const toOperationalWorkDate = (atRaw, actionRaw) => {
  const at = new Date(atRaw);
  if (Number.isNaN(at.getTime())) return '';
  const action = String(actionRaw ?? '').trim().toUpperCase() === 'OUT' ? 'OUT' : 'IN';
  const bucketMs = at.getTime() - (action === 'OUT' ? 1 : 0);
  const shifted = new Date(bucketMs - DAY_CUTOFF_HOUR * 60 * 60 * 1000);
  return toDateOnly(shifted);
};

const monthRange = (yyyyMm) => {
  const [yRaw, mRaw] = yyyyMm.split('-');
  const y = Number(yRaw);
  const m = Number(mRaw);
  const start = new Date(Date.UTC(y, m - 1, 1, DAY_CUTOFF_HOUR, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, 1, DAY_CUTOFF_HOUR, 0, 0, 0));
  return { start, end };
};

const fetchAllEmployees = async () => {
  const rows = [];
  const pageSize = 1000;
  const selectLower = 'staff_id, shift, shift_time, position, name, agency, terminated_at';
  const selectCased = 'staff_id, shift, shift_time, "Position", name, "Agency", terminated_at';
  let useCasedColumns = false;
  for (let from = 0; ; from += pageSize) {
    const to = from + pageSize - 1;
    let res = await supabase
      .from(EMPLOYEE_TABLE)
      .select(useCasedColumns ? selectCased : selectLower)
      .order('staff_id', { ascending: true })
      .range(from, to);

    if (res.error && !useCasedColumns && /column .*position.* does not exist/i.test(String(res.error.message ?? ''))) {
      useCasedColumns = true;
      res = await supabase
        .from(EMPLOYEE_TABLE)
        .select(selectCased)
        .order('staff_id', { ascending: true })
        .range(from, to);
    }
    if (res.error) throw new Error(`Load employees failed: ${res.error.message}`);
    const page = res.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
};

const fetchPunchRows = async (startIso, endIso) => {
  const rows = [];
  const pageSize = 1000;
  const maxPages = 400;
  for (let page = 0; page < maxPages; page += 1) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const base = () =>
      supabase
        .from(PUNCH_TABLE)
        .select('staff_id, action, created_at, id')
        .gte('created_at', startIso)
        .lt('created_at', endIso);
    const byCreatedAt = await base().order('created_at', { ascending: true }).range(from, to);
    const attempt = byCreatedAt.error ? await base().order('id', { ascending: true }).range(from, to) : byCreatedAt;
    if (attempt.error) throw new Error(`Load punches failed: ${attempt.error.message}`);
    const pageRows = attempt.data ?? [];
    if (pageRows.length === 0) break;
    rows.push(...pageRows);
    if (pageRows.length < pageSize) break;
  }
  return rows;
};

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const isMissingLateSyncRpcError = (error) => {
  const text = String(error?.code ?? '') + ' ' + String(error?.message ?? '') + ' ' + String(error?.details ?? '');
  const normalized = text.toLowerCase();
  return (
    normalized.includes('sync_late_attendance_marks') &&
    (normalized.includes('could not find') || normalized.includes('function') || normalized.includes('schema cache') || normalized.includes('pgrst'))
  );
};

const buildStaleLateAutoDeletePlan = ({ existingRows, nextRows }) => {
  const nextKeySet = new Set(
    nextRows
      .map((row) => {
        const staffId = String(row?.staff_id ?? '').trim();
        const workDate = String(row?.work_date ?? '').trim();
        return staffId && workDate ? `${staffId}__${workDate}` : '';
      })
      .filter(Boolean)
  );

  const workDatesByStaffId = new Map();
  for (const row of existingRows) {
    const staffId = String(row?.staff_id ?? '').trim();
    const workDate = String(row?.work_date ?? '').trim();
    if (!staffId || !workDate) continue;
    if (nextKeySet.has(`${staffId}__${workDate}`)) continue;
    const dates = workDatesByStaffId.get(staffId) ?? new Set();
    dates.add(workDate);
    workDatesByStaffId.set(staffId, dates);
  }

  return Array.from(workDatesByStaffId.entries())
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'en-US'))
    .map(([staffId, workDates]) => ({
      staffId,
      workDates: Array.from(workDates).sort((a, b) => String(a).localeCompare(String(b), 'en-US'))
    }));
};

const main = async () => {
  const { start, end } = monthRange(TARGET_MONTH);
  const [yearRaw, monthRaw] = TARGET_MONTH.split('-');
  const yearNum = Number(yearRaw);
  const monthNum = Number(monthRaw);
  const monthStartDate = `${TARGET_MONTH}-01`;
  const monthEndDate = toDateOnlyUtc(new Date(Date.UTC(yearNum, monthNum, 0)));

  console.log(`Target month: ${TARGET_MONTH}`);
  console.log(`Operational range: [${start.toISOString()}, ${end.toISOString()})`);
  console.log(`Date keys: ${monthStartDate} -> ${monthEndDate}`);
  console.log(`WRITE=${WRITE ? '1' : '0'} (0 = dry-run)`);

  const employees = await fetchAllEmployees();
  const employeeByStaff = new Map();
  for (const row of employees) {
    const staff = String(row.staff_id ?? '').trim();
    if (!staff) continue;
    employeeByStaff.set(staff, {
      staff,
      shift: normalizeShiftValue(row.shift),
      shiftTime: normalizeShiftTimeValue(row.shift_time),
      position: normalizePosition(row.position ?? row.Position),
      name: String(row.name ?? '').trim(),
      agency: String(row.agency ?? row.Agency ?? '').trim()
    });
  }

  const punchRows = await fetchPunchRows(start.toISOString(), end.toISOString());
  const firstInByStaffDay = new Map();
  const punchCountByStaffDay = new Map();

  for (const row of punchRows) {
    const staff = String(row.staff_id ?? '').trim();
    if (!staff || !employeeByStaff.has(staff)) continue;
    const action = String(row.action ?? '').trim().toUpperCase() === 'OUT' ? 'OUT' : 'IN';
    const atRaw = String(row.created_at ?? '').trim();
    if (!atRaw) continue;
    const at = new Date(atRaw);
    if (Number.isNaN(at.getTime())) continue;

    const workDate = toOperationalWorkDate(atRaw, action);
    if (!workDate || workDate < monthStartDate || workDate > monthEndDate) continue;

    const key = `${staff}__${workDate}`;
    punchCountByStaffDay.set(key, Number(punchCountByStaffDay.get(key) ?? 0) + 1);
    if (action === 'IN') {
      const prev = firstInByStaffDay.get(key);
      if (!prev || at.getTime() < prev.getTime()) firstInByStaffDay.set(key, at);
    }
  }

  const marksToInsert = [];
  for (const [key, firstIn] of firstInByStaffDay.entries()) {
    const [staff, workDate] = String(key).split('__');
    if (!staff || !workDate) continue;
    const profile = employeeByStaff.get(staff);
    if (!profile) continue;

    const punchCount = Number(punchCountByStaffDay.get(key) ?? 0);
    if (punchCount < 2) continue;

    const fallbackShift = profile.shift || 'early';
    const fallbackStartText = getDefaultShiftStartTime(fallbackShift, profile.position);
    const fallbackStartMinutes = parseClockTextToMinutes(fallbackStartText);
    if (!Number.isFinite(fallbackStartMinutes)) continue;

    const shiftTimeMinutes = parseClockTextToMinutes(profile.shiftTime);
    const plannedStartMinutes = Number.isFinite(shiftTimeMinutes)
      ? shiftTimeMinutes
      : fallbackStartMinutes;
    const effectiveShift = profile.shift || inferShiftFromStartMinutes(plannedStartMinutes);

    const firstInMinutes = firstIn.getHours() * 60 + firstIn.getMinutes();
    const minutesLate = Math.max(0, Math.round(firstInMinutes - plannedStartMinutes));
    const isLate = minutesLate > LATE_GRACE_MINUTES;
    if (!isLate) continue;

    const learnedExpectedStartRaw = formatClockMinutes(plannedStartMinutes);
    const roundingFamily = effectiveShift === 'late' ? 'late_shift_points' : 'early_hour';

    marksToInsert.push({
      staff_id: staff,
      work_date: workDate,
      mark_type: 'late',
      source: 'late_auto',
      operator: OPERATOR,
      payload: {
        reason: Number.isFinite(shiftTimeMinutes) ? 'employee_shift_time' : 'schedule_fallback',
        learned_expected_start_raw: learnedExpectedStartRaw,
        learned_expected_start_rounded: learnedExpectedStartRaw,
        guardrail_expected_start: formatClockMinutes(plannedStartMinutes + 15),
        final_expected_start: learnedExpectedStartRaw,
        first_in: formatClockMinutes(firstInMinutes),
        minutes_late: minutesLate,
        sample_count: 0,
        baseline_source: 'planned',
        rounding_family: roundingFamily,
        shift: effectiveShift,
        position: profile.position
      },
      updated_at: new Date().toISOString()
    });
  }

  console.log(`Employees loaded: ${employeeByStaff.size}`);
  console.log(`Punch rows loaded: ${punchRows.length}`);
  console.log(`Days with first IN: ${firstInByStaffDay.size}`);
  console.log(`Late marks to write: ${marksToInsert.length}`);

  if (!WRITE) {
    const preview = marksToInsert.slice(0, 8).map((x) => ({
      staff_id: x.staff_id,
      work_date: x.work_date,
      minutes_late: x.payload.minutes_late,
      final_expected_start: x.payload.final_expected_start,
      first_in: x.payload.first_in,
      reason: x.payload.reason
    }));
    console.log('Dry-run preview:', preview);
    return;
  }

  const persistLateMarksFallback = async () => {
    const existingLateRows = [];
    const pageSize = 1000;
    const maxPages = 80;
    for (let page = 0; page < maxPages; page += 1) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const res = await supabase
        .from(ATTENDANCE_MARKS_TABLE)
        .select('staff_id, work_date, source')
        .gte('work_date', monthStartDate)
        .lte('work_date', monthEndDate)
        .eq('mark_type', 'late')
        .range(from, to);
      if (res.error) throw new Error(`Load existing late marks failed: ${res.error.message}`);
      const rows = res.data ?? [];
      existingLateRows.push(...rows);
      if (rows.length < pageSize) break;
    }

    const protectedManualKeySet = new Set(
      existingLateRows
        .filter((row) => String(row?.source ?? '').trim() && String(row?.source ?? '').trim() !== 'late_auto')
        .map((row) => `${String(row?.staff_id ?? '').trim()}__${String(row?.work_date ?? '').trim()}`)
    );
    const marksToPersist = marksToInsert.filter((row) => !protectedManualKeySet.has(`${row.staff_id}__${row.work_date}`));

    if (marksToPersist.length > 0) {
      for (const batch of chunk(marksToPersist, 500)) {
        const upsertRes = await supabase
          .from(ATTENDANCE_MARKS_TABLE)
          .upsert(batch, { onConflict: 'staff_id,work_date,mark_type' });
        if (upsertRes.error) throw new Error(`Upsert late marks failed: ${upsertRes.error.message}`);
      }
    } else {
      console.log('No late marks to upsert after protecting manual rows.');
    }

    const staleDeletePlan = buildStaleLateAutoDeletePlan({
      existingRows: existingLateRows.filter((row) => String(row?.source ?? '').trim() === 'late_auto'),
      nextRows: marksToPersist.map((row) => ({ staff_id: row.staff_id, work_date: row.work_date }))
    });
    console.log(`Clearing stale late_auto marks for ${staleDeletePlan.length} staff in ${TARGET_MONTH} ...`);
    for (const item of staleDeletePlan) {
      for (const workDateBatch of chunk(item.workDates, 50)) {
        const clearRes = await supabase
          .from(ATTENDANCE_MARKS_TABLE)
          .delete()
          .eq('staff_id', item.staffId)
          .in('work_date', workDateBatch)
          .eq('mark_type', 'late')
          .eq('source', 'late_auto');
        if (clearRes.error) throw new Error(`Delete stale late_auto marks failed: ${clearRes.error.message}`);
      }
    }

    return { persistedCount: marksToPersist.length, mode: 'fallback' };
  };

  try {
    const rpcRes = await supabase.rpc('sync_late_attendance_marks', {
      p_range_start: monthStartDate,
      p_range_end: monthEndDate,
      p_staff_ids: Array.from(new Set(marksToInsert.map((row) => row.staff_id))),
      p_rows: marksToInsert,
      p_actor: OPERATOR
    });
    if (rpcRes.error) {
      if (isMissingLateSyncRpcError(rpcRes.error)) {
        const result = await persistLateMarksFallback();
        console.log(`Done. Recalculated late marks for ${TARGET_MONTH}. Inserted/updated: ${result.persistedCount} (${result.mode}).`);
        return;
      }
      throw new Error(`Sync late marks RPC failed: ${rpcRes.error.message}`);
    }
    console.log(`Done. Recalculated late marks for ${TARGET_MONTH}. Inserted/updated: ${marksToInsert.length} (rpc).`);
  } catch (error) {
    if (isMissingLateSyncRpcError(error)) {
      const result = await persistLateMarksFallback();
      console.log(`Done. Recalculated late marks for ${TARGET_MONTH}. Inserted/updated: ${result.persistedCount} (${result.mode}).`);
      return;
    }
    throw error;
  }
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
