import { useEffect, useMemo, useRef, useState } from 'react';
import { createSupabaseClient } from './lib/supabase';
import { isValidStaffId, normalizeStaffId } from './lib/staffId';

type PunchAction = 'IN' | 'OUT';

type Page = 'punch' | 'log' | 'employee' | 'edit';

type StatusTone = 'idle' | 'pending' | 'success' | 'error';

type Status = {
  tone: StatusTone;
  message: string;
};

type PunchBoardRow = {
  id: number | string;
  staff_id: string;
  action: PunchAction;
  created_at: string | null;
};

const ALLOWED_POSITIONS = ['Pick', 'Pack', 'Rebin', 'Preship', 'Transfer'] as const;
type AllowedPosition = (typeof ALLOWED_POSITIONS)[number];

const EMPLOYEE_TABLE = (import.meta.env.VITE_EMPLOYEE_TABLE as string | undefined) ?? 'ob_employees';
const EMPLOYEE_REQUESTS_TABLE = (import.meta.env.VITE_EMPLOYEE_REQUESTS_TABLE as string | undefined) ?? 'ob_employee_requests';

const supabase = createSupabaseClient({ persistSession: false });

const formatTime = (value: Date) =>
  value.toLocaleString('zh-CN', {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function getBestTimeField(row: Record<string, unknown>) {
  const candidates = ['created_at', 'inserted_at', 'punch_at', 'time', 'timestamp', 'ts'];
  for (const c of candidates) {
    const v = row[c];
    if (typeof v === 'string' && v.trim() !== '') {
      return v;
    }
  }
  return null;
}

export default function App() {
  const busyRef = useRef(false);
  const [busy, setBusy] = useState<string | null>(null);
  const isLocked = Boolean(busy);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const successInAudioRef = useRef<HTMLAudioElement | null>(null);
  const successOutAudioRef = useRef<HTMLAudioElement | null>(null);
  const errorAudioRef = useRef<HTMLAudioElement | null>(null);

  type EmployeeColumnMode = 'lower' | 'cased';
  const employeeColumnModeRef = useRef<EmployeeColumnMode | null>(null);

  const [page, setPage] = useState<Page>('punch');

  const [staffId, setStaffId] = useState('');
  const normalizedId = useMemo(() => normalizeStaffId(staffId), [staffId]);
  const isValidId = useMemo(() => isValidStaffId(normalizedId), [normalizedId]);

  const [uiStatus, setUiStatus] = useState<Status>({ tone: 'idle', message: 'Enter US ID to start punch' });

  useEffect(() => {
    if (typeof Audio === 'undefined') return;
    const successIn = new Audio(encodeURI('/sound/success in.mp3'));
    successIn.preload = 'auto';
    successIn.volume = 1;
    successInAudioRef.current = successIn;

    const successOut = new Audio(encodeURI('/sound/success out.mp3'));
    successOut.preload = 'auto';
    successOut.volume = 1;
    successOutAudioRef.current = successOut;

    const error = new Audio('/sound/error.mp3');
    error.preload = 'auto';
    error.volume = 1;
    errorAudioRef.current = error;

    return () => {
      successInAudioRef.current = null;
      successOutAudioRef.current = null;
      errorAudioRef.current = null;
    };
  }, []);

  const playSound = (audio: HTMLAudioElement | null) => {
    if (!audio) return;
    try {
      audio.currentTime = 0;
      void audio.play();
    } catch {
      // ignore autoplay/permission issues
    }
  };

  const playSuccess = (action: PunchAction) =>
    playSound(action === 'OUT' ? successOutAudioRef.current : successInAudioRef.current);
  const playError = () => playSound(errorAudioRef.current);

  const [offsetMs, setOffsetMs] = useState(0);
  const [serverTime, setServerTime] = useState(() => new Date());

  const [punches, setPunches] = useState<Record<string, unknown>[]>([]);
  const [punchesError, setPunchesError] = useState<string | null>(null);

  const [employee, setEmployee] = useState<Record<string, unknown> | null>(null);
  const [employeeError, setEmployeeError] = useState<string | null>(null);

  const [punchBoard, setPunchBoard] = useState<PunchBoardRow[]>([]);
  const [punchBoardError, setPunchBoardError] = useState<string | null>(null);
  const [punchBoardEmployeeMap, setPunchBoardEmployeeMap] = useState<
    Record<string, { name: string; agency: string; position: string }>
  >({});
  const [punchLogPositionFilter, setPunchLogPositionFilter] = useState<AllowedPosition | ''>('');

  const [lastPunchAction, setLastPunchAction] = useState<PunchAction | null>(null);
  const [lastPunchActionError, setLastPunchActionError] = useState<string | null>(null);

  const punchBoardFiltered = useMemo(() => {
    if (!punchLogPositionFilter) return punchBoard;
    const needle = punchLogPositionFilter.trim().toLowerCase();
    return punchBoard.filter((p) => {
      const employee = punchBoardEmployeeMap[p.staff_id];
      const pos = String(employee?.position ?? '').trim().toLowerCase();
      return pos === needle;
    });
  }, [punchBoard, punchBoardEmployeeMap, punchLogPositionFilter]);
  const [lastPunchActionLoading, setLastPunchActionLoading] = useState(false);

  const [editName, setEditName] = useState('');
  const [editDept, setEditDept] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editNote, setEditNote] = useState('');

  const runLocked = async (reason: string, fn: () => Promise<void>) => {
    if (busyRef.current) {
      return;
    }
    busyRef.current = true;
    setBusy(reason);
    try {
      await fn();
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!isLocked) {
      inputRef.current?.focus();
    }
  }, [isLocked, page]);

  useEffect(() => {
    const tick = () => {
      setServerTime(new Date(Date.now() + offsetMs));
    };
    const timer = window.setInterval(tick, 1000);
    tick();
    return () => window.clearInterval(timer);
  }, [offsetMs]);

  useEffect(() => {
    let active = true;
    const sync = async () => {
      if (!supabase) {
        return;
      }
      const { data, error } = await supabase.rpc('now');
      if (!active) {
        return;
      }
      if (error || !data) {
        setOffsetMs(0);
        return;
      }
      const server = new Date(data as string);
      if (!Number.isNaN(server.getTime())) {
        setOffsetMs(server.getTime() - Date.now());
      }
    };
    sync();
    const timer = window.setInterval(sync, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const fetchLastPunch = async (staff: string) => {
    if (!supabase) {
      return { action: null as PunchAction | null, error: '缺少 Supabase 配置。' };
    }

    const base = () => supabase.from('ob_punches').select('id, action, created_at').eq('staff_id', staff).limit(1);

    const attemptCreatedAt = await base().order('created_at', { ascending: false });
    const attempt = attemptCreatedAt.error ? await base().order('id', { ascending: false }) : attemptCreatedAt;
    if (attempt.error) {
      return { action: null as PunchAction | null, error: attempt.error.message };
    }

    const rows = (attempt.data as any[] | null) ?? [];
    const action = (rows[0]?.action as PunchAction | undefined) ?? null;
    return { action, error: null as string | null };
  };

  useEffect(() => {
    if (!supabase || !isValidId) {
      setLastPunchAction(null);
      setLastPunchActionError(null);
      setLastPunchActionLoading(false);
      return;
    }

    let active = true;
    const staff = normalizedId;
    void (async () => {
      setLastPunchActionLoading(true);
      const { action, error } = await fetchLastPunch(staff);
      if (!active) return;
      setLastPunchAction(action);
      setLastPunchActionError(error);
      setLastPunchActionLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [normalizedId, isValidId]);

  const canPunchIn =
    isValidId && !lastPunchActionLoading && !lastPunchActionError && (lastPunchAction === null || lastPunchAction === 'OUT');
  const canPunchOut = isValidId && !lastPunchActionLoading && !lastPunchActionError && lastPunchAction === 'IN';

  const fetchEmployeeMap = async (staffIds: string[]) => {
    if (!supabase || staffIds.length === 0) {
      return { map: {} as Record<string, { name: string; agency: string; position: string }>, error: null as string | null };
    }

    const ids = Array.from(new Set(staffIds.map((s) => s.trim()).filter(Boolean)));
    if (ids.length === 0) {
      return { map: {} as Record<string, { name: string; agency: string; position: string }>, error: null as string | null };
    }

    const resolveColumnMode = async (): Promise<EmployeeColumnMode> => {
      const cached = employeeColumnModeRef.current;
      if (cached) return cached;

      const cased = await supabase.from(EMPLOYEE_TABLE).select('staff_id, "Agency", "Position"').limit(1);
      if (!cased.error) {
        employeeColumnModeRef.current = 'cased';
        return 'cased';
      }

      const lower = await supabase.from(EMPLOYEE_TABLE).select('staff_id, agency, position').limit(1);
      if (!lower.error) {
        employeeColumnModeRef.current = 'lower';
        return 'lower';
      }

      employeeColumnModeRef.current = 'lower';
      return 'lower';
    };

    const runQuery = async (mode: EmployeeColumnMode) => {
      const select = mode === 'cased' ? 'staff_id, name, "Agency", "Position"' : 'staff_id, name, agency, position';
      return await supabase.from(EMPLOYEE_TABLE).select(select).in('staff_id', ids);
    };

    const mode = await resolveColumnMode();
    let rows = await runQuery(mode);
    if (rows.error) {
      const flipped: EmployeeColumnMode = mode === 'cased' ? 'lower' : 'cased';
      employeeColumnModeRef.current = flipped;
      rows = await runQuery(flipped);
    }
    if (rows.error) {
      return { map: {} as Record<string, { name: string; agency: string; position: string }>, error: rows.error.message };
    }

    const map: Record<string, { name: string; agency: string; position: string }> = {};
    for (const r of (rows.data as any[] | null) ?? []) {
      const staff = String(r.staff_id ?? '').trim();
      if (!staff) continue;
      map[staff] = {
        name: String(r.name ?? '').trim(),
        agency: String(r.agency ?? r.Agency ?? '').trim(),
        position: String(r.position ?? r.Position ?? '').trim()
      };
    }
    return { map, error: null as string | null };
  };

  const fetchPunchBoard = async () => {
    if (!supabase) {
      setPunchBoardError('缺少 Supabase 配置。');
      return;
    }

    setPunchBoardError(null);

    const base = () => supabase.from('ob_punches').select('id, staff_id, action, created_at').limit(20);
    const attemptCreatedAt = await base().order('created_at', { ascending: false });
    const attempt = attemptCreatedAt.error ? await base().order('id', { ascending: false }) : attemptCreatedAt;
    if (attempt.error) {
      setPunchBoardError(attempt.error.message);
      setPunchBoard([]);
      setPunchBoardEmployeeMap({});
      return;
    }

    const rows = ((attempt.data as any[] | null) ?? []).map((r) => ({
      id: r.id,
      staff_id: String(r.staff_id ?? '').trim(),
      action: String(r.action ?? '').toUpperCase() === 'OUT' ? 'OUT' : 'IN',
      created_at: (r.created_at ?? null) as string | null
    })) as PunchBoardRow[];

    setPunchBoard(rows);

    const staffIds = rows.map((r) => r.staff_id).filter(Boolean);
    const mapRes = await fetchEmployeeMap(staffIds);
    if (mapRes.error) {
      setPunchBoardEmployeeMap({});
      return;
    }
    setPunchBoardEmployeeMap(mapRes.map);
  };

  useEffect(() => {
    if (!supabase) return;
    if (page !== 'punch') return;

    let active = true;
    void (async () => {
      if (!active) return;
      await fetchPunchBoard();
    })();

    const timer = window.setInterval(() => {
      void fetchPunchBoard();
    }, 10000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [page]);

  const submitPunch = async (
    action: PunchAction,
    options?: { latestAction?: PunchAction | null; skipLatestFetch?: boolean; clearInput?: boolean }
  ) => {
    if (isLocked) {
      return;
    }
    if (!isValidId) {
      setUiStatus({ tone: 'error', message: '工号格式不正确（例如：US010454）' });
      playError();
      return;
    }
    if (!supabase) {
      setUiStatus({ tone: 'error', message: '缺少 Supabase 配置，请检查环境变量。' });
      playError();
      return;
    }

    setUiStatus({ tone: 'pending', message: `打卡中... (${action})` });

    await runLocked('punch', async () => {
      const latest = options?.skipLatestFetch
        ? { action: options?.latestAction ?? null, error: null as string | null }
        : await fetchLastPunch(normalizedId);
      if (latest.error) {
        setUiStatus({ tone: 'error', message: `无法获取上次打卡记录：${latest.error}` });
        playError();
        return;
      }

      const allowed =
        (action === 'IN' && (latest.action === null || latest.action === 'OUT')) ||
        (action === 'OUT' && latest.action === 'IN');
      if (!allowed) {
        const msg =
          latest.action === null
            ? '没有记录时只能 IN，不能 OUT'
            : latest.action === 'IN'
              ? '已有 IN 记录，请先 OUT'
              : '已有 OUT 记录，请先 IN';
        setUiStatus({ tone: 'error', message: msg });
        playError();
        setLastPunchAction(latest.action);
        setLastPunchActionError(null);
        return;
      }

      const { error } = await supabase.from('ob_punches').insert([
        {
          staff_id: normalizedId,
          action,
          metadata: {
            device: 'web_browser',
            user_agent: navigator.userAgent
          }
        }
      ]);

      if (error) {
        setUiStatus({ tone: 'error', message: `打卡失败：${error.message}` });
        playError();
        return;
      }

      setUiStatus({ tone: 'success', message: `打卡成功（${action}）` });
      playSuccess(action);
      setLastPunchAction(action);
      setLastPunchActionError(null);
      if (options?.clearInput ?? true) {
        setStaffId('');
      }
      void fetchPunchBoard();
    });
  };

  const submitAutoPunch = async () => {
    if (isLocked) {
      return;
    }
    if (!isValidId) {
      setUiStatus({ tone: 'error', message: '工号格式不正确（例如：US010454）' });
      playError();
      return;
    }
    if (!supabase) {
      setUiStatus({ tone: 'error', message: '缺少 Supabase 配置，请检查环境变量。' });
      playError();
      return;
    }

    const latest = await fetchLastPunch(normalizedId);
    if (latest.error) {
      setUiStatus({ tone: 'error', message: `无法获取上次打卡记录：${latest.error}` });
      playError();
      return;
    }

    const nextAction: PunchAction = latest.action === 'IN' ? 'OUT' : 'IN';
    await submitPunch(nextAction, { latestAction: latest.action, skipLatestFetch: true, clearInput: true });
  };

  const onStaffIdKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submitAutoPunch();
    }
  };

  const staffIdPanel = (
    <section className="glass reveal rounded-3xl px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="text-sm uppercase tracking-[0.25em] text-slate-400">Employee ID</label>
      </div>
      <input
        ref={inputRef}
        value={staffId}
        onChange={(event) => setStaffId(event.target.value)}
        onKeyDown={onStaffIdKeyDown}
        disabled={isLocked}
        inputMode="text"
        autoCapitalize="characters"
        spellCheck={false}
        placeholder="Scan your barcode"
        className="mt-3 w-full rounded-2xl border border-white/10 bg-black/30 px-5 py-4 text-2xl text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
      />
      <div className="mt-3 text-xs text-slate-400">
        {!isValidId && 'Waiting for USID'}
        {isValidId && (
          <>
            当前：{normalizedId}
            {lastPunchActionLoading && <span className="ml-2 text-slate-500">（查询中...）</span>}
            {!lastPunchActionLoading && lastPunchActionError && (
              <span className="ml-2 text-ember">（查询失败：{lastPunchActionError}）</span>
            )}
            {!lastPunchActionLoading && !lastPunchActionError && (
              <span className="ml-2 text-slate-500">
                {lastPunchAction === null
                  ? '（无记录：将自动 IN）'
                  : lastPunchAction === 'IN'
                    ? '（未签出：将自动 OUT）'
                    : '（已签出：将自动 IN）'}
              </span>
            )}
          </>
        )}
      </div>
    </section>
  );

  const fetchPunches = async () => {
    if (!supabase) {
      setPunchesError('缺少 Supabase 配置。');
      return;
    }

    await runLocked('punches', async () => {
      setPunchesError(null);

      const base = () => {
        let q = supabase.from('ob_punches').select('*').limit(50);
        if (isValidId) {
          q = q.eq('staff_id', normalizedId);
        }
        return q;
      };

      const attemptCreatedAt = await base().order('created_at', { ascending: false });
      const attempt = attemptCreatedAt.error ? await base().order('id', { ascending: false }) : attemptCreatedAt;
      if (attempt.error) {
        const fallback = await base();
        if (fallback.error) {
          setPunchesError(fallback.error.message);
          setPunches([]);
          setUiStatus({ tone: 'error', message: `加载流水失败：${fallback.error.message}` });
          return;
        }
        const rows = (fallback.data as Record<string, unknown>[] | null) ?? [];
        setPunches(rows);
        setUiStatus({ tone: 'success', message: `已加载流水：${rows.length} 条` });
        return;
      }

      const rows = (attempt.data as Record<string, unknown>[] | null) ?? [];
      setPunches(rows);
      setUiStatus({ tone: 'success', message: `已加载流水：${rows.length} 条` });
    });
  };

  const fetchEmployee = async () => {
    if (!supabase) {
      setEmployeeError('缺少 Supabase 配置。');
      return;
    }
    if (!isValidId) {
      setEmployeeError('请输入有效工号后查询。');
      setEmployee(null);
      return;
    }

    await runLocked('employee', async () => {
      setEmployeeError(null);
      setEmployee(null);

      const base = () => supabase.from(EMPLOYEE_TABLE).select('*').eq('staff_id', normalizedId).limit(1);

      const attempt = await base().order('created_at', { ascending: false });
      if (attempt.error) {
        const fallback = await base();
        if (fallback.error) {
          setEmployeeError(fallback.error.message);
          setUiStatus({ tone: 'error', message: `查询员工信息失败：${fallback.error.message}` });
          return;
        }
        const rows = (fallback.data as Record<string, unknown>[] | null) ?? [];
        const found = rows[0] ?? null;
        if (!found) {
          setEmployeeError(null);
          setEmployee(null);
          setUiStatus({ tone: 'idle', message: '未找到该工号的员工信息' });
          return;
        }
        setEmployee(found);
        setUiStatus({ tone: 'success', message: '员工信息已加载' });
        return;
      }

      const rows = (attempt.data as Record<string, unknown>[] | null) ?? [];
      const found = rows[0] ?? null;
      if (!found) {
        setEmployeeError(null);
        setEmployee(null);
        setUiStatus({ tone: 'idle', message: '未找到该工号的员工信息' });
        return;
      }

      setEmployee(found);
      setUiStatus({ tone: 'success', message: '员工信息已加载' });
    });
  };

  const submitEmployeeChange = async () => {
    if (isLocked) {
      return;
    }
    if (!supabase) {
      setUiStatus({ tone: 'error', message: '缺少 Supabase 配置，请检查环境变量。' });
      return;
    }
    if (!isValidId) {
      setUiStatus({ tone: 'error', message: '工号格式不正确（例如：US010454）' });
      return;
    }

    const payload: Record<string, string> = {};
    if (editName.trim()) payload.name = editName.trim();
    if (editDept.trim()) payload.department = editDept.trim();
    if (editPhone.trim()) payload.phone = editPhone.trim();
    if (editNote.trim()) payload.note = editNote.trim();

    if (Object.keys(payload).length === 0) {
      setUiStatus({ tone: 'error', message: '请至少填写一项需要修改的信息。' });
      return;
    }

    await runLocked('employee_request', async () => {
      setUiStatus({ tone: 'pending', message: '提交修改申请中...' });
      const { error } = await supabase.from(EMPLOYEE_REQUESTS_TABLE).insert([
        {
          staff_id: normalizedId,
          payload,
          metadata: {
            device: 'web_browser',
            user_agent: navigator.userAgent
          }
        }
      ]);

      if (error) {
        setUiStatus({ tone: 'error', message: `提交失败：${error.message}` });
        return;
      }

      setUiStatus({ tone: 'success', message: '已提交修改申请（insert）' });
      setEditName('');
      setEditDept('');
      setEditPhone('');
      setEditNote('');
    });
  };

  useEffect(() => {
    if (page === 'log') {
      void fetchPunches();
    }
    if (page === 'employee') {
      void fetchEmployee();
    }
  }, [page]);

  const toneColor: Record<StatusTone, string> = {
    idle: 'text-slate-200',
    pending: 'text-neon',
    success: 'text-mint',
    error: 'text-ember'
  };

  const tabClass = (active: boolean) =>
    [
      'rounded-2xl px-4 py-2 text-sm font-medium transition',
      active ? 'bg-neon text-ink shadow-glow' : 'bg-white/5 text-slate-200 hover:bg-white/10',
      isLocked ? 'cursor-not-allowed opacity-60' : ''
    ].join(' ');

  return (
    <div className="min-h-screen px-5 py-8 text-paper">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        {page === 'punch' ? (
          <section className="reveal grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
            <div className="space-y-6">
              <header className="glass reveal rounded-3xl px-6 py-6 shadow-glow">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h1 className="font-display text-4xl tracking-[0.08em]">ObPunch</h1>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center justify-end gap-2 text-sm text-slate-300">
                      <span className="pulse-dot h-2 w-2 rounded-full bg-neon"></span>
                      <span>Time</span>
                    </div>
                    <div className="mt-2 font-display text-3xl tracking-[0.08em] text-neon">{formatTime(serverTime)}</div>
                  </div>
                </div>

                <div className={['mt-4 text-sm', toneColor[uiStatus.tone]].join(' ')}>{uiStatus.message}</div>
              </header>

              {staffIdPanel}

              <div className="grid gap-4 md:grid-cols-2">
                <button
                  type="button"
                  disabled={isLocked || !canPunchIn}
                  onClick={() => void submitPunch('IN')}
                  className="h-24 rounded-3xl bg-mint text-3xl font-semibold text-ink shadow-lg transition hover:-translate-y-1 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
                >
                  IN
                </button>
                <button
                  type="button"
                  disabled={isLocked || !canPunchOut}
                  onClick={() => void submitPunch('OUT')}
                  className="h-24 rounded-3xl bg-ember text-3xl font-semibold text-white shadow-lg transition hover:-translate-y-1 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
                >
                  OUT
                </button>
              </div>
            </div>

            <div className="lg:sticky lg:top-8 lg:h-[calc(100vh-4rem)]">
              <section className="glass reveal flex h-full flex-col rounded-3xl px-6 py-6 shadow-glow">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-display text-2xl tracking-[0.08em]">Punch Log</h2>
                  <button
                    type="button"
                    disabled={isLocked}
                    onClick={() => void fetchPunchBoard()}
                    className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Refresh
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {ALLOWED_POSITIONS.map((pos) => (
                    <button
                      key={pos}
                      type="button"
                      disabled={isLocked}
                      onClick={() => setPunchLogPositionFilter((prev) => (prev === pos ? '' : pos))}
                      className={[
                        'rounded-xl px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] transition disabled:cursor-not-allowed disabled:opacity-60',
                        punchLogPositionFilter === pos
                          ? 'bg-neon text-ink shadow-glow'
                          : 'bg-white/10 text-slate-200 hover:bg-white/15'
                      ].join(' ')}
                      title={`Filter: ${pos}`}
                    >
                      {pos}
                    </button>
                  ))}
                </div>

                {punchBoardError && <p className="mt-3 text-sm text-ember">加载失败：{punchBoardError}</p>}
                {!punchBoardError && punchBoardFiltered.length === 0 && <p className="mt-3 text-sm text-slate-400">暂无数据</p>}

                {!punchBoardError && punchBoardFiltered.length > 0 && (
                  <div className="mt-4 flex-1 overflow-auto pr-1">
                    <div className="space-y-2">
                      <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_6.5rem] items-center gap-3 px-4 text-xs uppercase tracking-[0.25em] text-slate-500 sm:grid-cols-[3.5rem_minmax(0,1fr)_7rem_7rem_9.5rem]">
                        <div>Action</div>
                        <div className="sm:hidden">Info</div>
                        <div className="hidden sm:block">Name</div>
                        <div className="hidden sm:block">Agency</div>
                        <div className="hidden sm:block">Position</div>
                        <div className="text-right">Time</div>
                      </div>
                      {punchBoardFiltered.map((p) => {
                        const employee = punchBoardEmployeeMap[p.staff_id];
                        const time = p.created_at
                          ? new Date(p.created_at).toLocaleString('zh-CN', { hour12: false })
                          : '';
                        const isIn = p.action === 'IN';
                        const name = employee?.name || p.staff_id || '-';
                        const agency = employee?.agency || '-';
                        const position = employee?.position || '-';
                        return (
                          <div key={String(p.id)} className="rounded-2xl bg-white/5 px-4 py-3">
                            <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_6.5rem] items-center gap-3 sm:grid-cols-[3.5rem_minmax(0,1fr)_7rem_7rem_9.5rem]">
                              <span className={['font-display text-xl', isIn ? 'text-mint' : 'text-ember'].join(' ')}>
                                {p.action}
                              </span>
                              <span className="min-w-0">
                                <span className="block truncate text-sm text-slate-200 sm:hidden">{name}</span>
                                <span className="mt-0.5 block truncate text-xs text-slate-400 sm:hidden">
                                  {agency} · {position}
                                </span>
                                <span className="hidden truncate text-sm text-slate-200 sm:block">{name}</span>
                              </span>
                              <span className="hidden min-w-0 truncate text-sm text-slate-200 sm:block">{agency}</span>
                              <span className="hidden min-w-0 truncate text-sm text-slate-200 sm:block">{position}</span>
                              <span className="text-right text-xs text-slate-400">{time}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </section>
            </div>
          </section>
        ) : (
          <>
            <header className="glass reveal rounded-3xl px-6 py-6 shadow-glow">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-400">ObPunch</p>
                  <h1 className="font-display text-4xl tracking-[0.08em]">仓库打卡</h1>
                </div>
                <div className="text-right">
                  <div className="flex items-center justify-end gap-2 text-sm text-slate-300">
                    <span className="pulse-dot h-2 w-2 rounded-full bg-neon"></span>
                    <span>Time</span>
                  </div>
                  <div className="mt-2 font-display text-3xl tracking-[0.08em] text-neon">{formatTime(serverTime)}</div>
                  <p className="mt-2 text-xs text-slate-400">每 60 秒自动同步一次（本地偏移）</p>
                </div>
              </div>

              <nav className="mt-6 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => setPage('punch')}
                  className={tabClass(false)}
                >
                  1 打卡界面
                </button>
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => setPage('log')}
                  className={tabClass(page === 'log')}
                >
                  2 打卡流水
                </button>
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => setPage('employee')}
                  className={tabClass(page === 'employee')}
                >
                  3 员工信息
                </button>
                <button
                  type="button"
                  disabled={isLocked}
                  onClick={() => setPage('edit')}
                  className={tabClass(page === 'edit')}
                >
                  4 修改信息
                </button>
              </nav>

              <div className={['mt-4 text-sm', toneColor[uiStatus.tone]].join(' ')}>{uiStatus.message}</div>
            </header>

            {staffIdPanel}
          </>
        )}

        {page === 'log' && (
          <section className="glass reveal rounded-3xl px-6 py-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-2xl tracking-[0.08em]">打卡流水</h2>
              <button
                type="button"
                disabled={isLocked}
                onClick={() => void fetchPunches()}
                className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                刷新
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              只读展示，不提供 update/delete。{isValidId ? `当前筛选：${normalizedId}` : '未筛选（展示最近 50 条）'}
            </p>
            {punchesError && <p className="mt-4 text-sm text-ember">加载失败：{punchesError}</p>}
            {!punchesError && punches.length === 0 && <p className="mt-4 text-sm text-slate-400">暂无数据</p>}
            <div className="mt-5 space-y-2">
              {punches.map((p) => {
                const staff = String(p.staff_id ?? '');
                const action = String(p.action ?? '');
                const timeStr = getBestTimeField(p);
                const time = timeStr ? new Date(timeStr).toLocaleString('zh-CN', { hour12: false }) : '';
                const isIn = action.toUpperCase() === 'IN';
                return (
                  <div
                    key={String(p.id ?? `${staff}-${action}-${time}`)}
                    className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className={['font-display text-xl', isIn ? 'text-mint' : 'text-ember'].join(' ')}>
                        {action}
                      </span>
                      <span className="text-sm text-slate-200">{staff}</span>
                    </div>
                    <div className="text-xs text-slate-400">{time}</div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {page === 'employee' && (
          <section className="glass reveal rounded-3xl px-6 py-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-2xl tracking-[0.08em]">员工信息</h2>
              <button
                type="button"
                disabled={isLocked}
                onClick={() => void fetchEmployee()}
                className="rounded-2xl bg-white/10 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
              >
                查询
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              默认表：<span className="text-slate-200">{EMPLOYEE_TABLE}</span>（按 created_at 取最新一条）
            </p>
            {employeeError && <p className="mt-4 text-sm text-ember">查询失败：{employeeError}</p>}
            {!employeeError && !employee && <p className="mt-4 text-sm text-slate-400">请输入工号后查询</p>}
            {employee && (
              <div className="mt-5 space-y-3">
                <div className="rounded-2xl bg-black/30 px-4 py-3">
                  <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Raw</div>
                  <pre className="mt-2 overflow-auto text-xs text-slate-200">{JSON.stringify(employee, null, 2)}</pre>
                </div>
                {isRecord(employee.profile) && (
                  <div className="rounded-2xl bg-black/30 px-4 py-3">
                    <div className="text-xs uppercase tracking-[0.25em] text-slate-400">Profile</div>
                    <pre className="mt-2 overflow-auto text-xs text-slate-200">
                      {JSON.stringify(employee.profile, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {page === 'edit' && (
          <section className="glass reveal rounded-3xl px-6 py-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-2xl tracking-[0.08em]">修改信息（提交申请）</h2>
              <button
                type="button"
                disabled={isLocked || !isValidId}
                onClick={() => void submitEmployeeChange()}
                className="rounded-2xl bg-neon px-4 py-2 text-sm font-semibold text-ink shadow-glow transition hover:-translate-y-0.5 hover:shadow-2xl disabled:cursor-not-allowed disabled:opacity-50"
              >
                提交
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              不做 update/upsert。写入表：<span className="text-slate-200">{EMPLOYEE_REQUESTS_TABLE}</span>
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">姓名</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  disabled={isLocked}
                  placeholder="可选"
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">部门</label>
                <input
                  value={editDept}
                  onChange={(e) => setEditDept(e.target.value)}
                  disabled={isLocked}
                  placeholder="可选"
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">电话</label>
                <input
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  disabled={isLocked}
                  placeholder="可选"
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs uppercase tracking-[0.25em] text-slate-400">说明</label>
                <textarea
                  value={editNote}
                  onChange={(e) => setEditNote(e.target.value)}
                  disabled={isLocked}
                  placeholder="可选（例如：手机号更换原因）"
                  rows={3}
                  className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-base text-white outline-none transition focus:border-neon focus:shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            </div>
          </section>
        )}

        <footer className="text-center text-xs text-slate-500">
          {isLocked && '请求处理中，已锁定交互'}
          {!isLocked && 'Ready'}
        </footer>
      </div>
    </div>
  );
}
