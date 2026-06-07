import { memo, useCallback, useDeferredValue, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { Check, Hourglass, Plus, Save, Trash2, Users } from 'lucide-react';
import { createPortal } from 'react-dom';
import { createSupabaseClient } from '../lib/supabase';
import { hasModuleAccess, getModuleMapFromContext, type AdminAccessContext } from '../shared/adminAccess';
import { addDays, startOfWeekMonday, toDateOnly, type AgencyShift } from '../shared/agencyShared';
import {
  DAILY_LIST_LIGHTS_KEY,
  createEmptyDailyListLightFlags,
  normalizeDailyListLightPosition,
  readDailyListLightsForDate,
  type DailyListLightFlags
} from '../shared/dailyListLights';
import {
  cancelAgencyTerminationRequest,
  createAgencyTerminationRequest,
  deleteAgencyDriverGroup,
  deleteAgencyNewHireDemand,
  fetchAdminAccessContext,
  fetchAgencyAbsentMarkKeys,
  fetchAgencyPunchPresenceStaffIds,
  fetchAgencyScheduleWeek,
  fetchAgencyUserDisplayName,
  setAgencyDriverGroupIndividual,
  setAgencyScheduleState,
  upsertAgencyEmployeeNote,
  upsertAgencyDriverGroup,
  upsertAgencyNewHireDemand
} from './api';
import { computeAgencySummaryCards, isAgencyWorklikeState } from './boardMetrics';
import { buildDriverGroupWarnings, getNextDriverGroupCode } from './driverGroups';
import { normalizeAgencyNote } from './notes';
import type {
  AgencyBoard,
  AgencyEmployeeRow,
  AgencyNewHireRequestRow,
  AgencyScheduleState,
  AgencyUpsertNewHireInput,
  AgencyWeekSchedule
} from './types';

type ModalState = 'new_hire' | 'termination' | 'driver_group' | 'employee_note' | null;
type NoticeTone = 'error' | 'info';

type NoticeState = {
  title: string;
  message: string;
  tone: NoticeTone;
} | null;

type DeleteNewHireConfirmState = {
  staffId: string;
  displayName: string;
} | null;

type CancelTerminationConfirmState = {
  staffId: string;
  displayName: string;
} | null;

type DeleteDriverGroupConfirmState = {
  code: string;
} | null;

type DriverGroupFormState = {
  code: string;
  driverStaffId: string;
  memberStaffIds: string[];
  sourceStaffId: string;
};

type SchedulePickerState = {
  open: boolean;
  staffId: string;
  workDate: string;
  currentState: AgencyScheduleState;
  options: SchedulePickerOption[];
  anchorLeft: number;
  anchorTop: number;
};

type SchedulePickerOption = {
  key: AgencyScheduleState;
  label: string;
  cls: string;
};

const EMPLOYEE_RENDER_PAGE_SIZE = 80;
const MOBILE_SCHEDULE_MAX_WIDTH = 900;
const APP_SETTINGS_TABLE = (import.meta.env.VITE_APP_SETTINGS_TABLE as string | undefined) ?? 'ob_app_settings';
const DAY_CUTOFF_HOUR_RAW = Number(import.meta.env.VITE_DAY_CUTOFF_HOUR ?? 5);
const DAY_CUTOFF_HOUR = Number.isFinite(DAY_CUTOFF_HOUR_RAW) ? Math.min(Math.max(DAY_CUTOFF_HOUR_RAW, 0), 23) : 5;
const TIMECARD_ABSENT_VISIBLE_HOUR_RAW = Number(import.meta.env.VITE_TIMECARD_ABSENT_VISIBLE_HOUR ?? 12);
const TIMECARD_ABSENT_VISIBLE_HOUR = Number.isFinite(TIMECARD_ABSENT_VISIBLE_HOUR_RAW)
  ? Math.min(Math.max(TIMECARD_ABSENT_VISIBLE_HOUR_RAW, 0), 23)
  : 12;

const NEW_YORK_TIMEZONE = 'America/New_York';
const newYorkClockFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: NEW_YORK_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

const formatWeekLabel = (value: string, dayIndex: number) => {
  const date = new Date(`${value}T00:00:00`);
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][dayIndex] ?? 'Day';
  if (Number.isNaN(date.getTime())) return `${weekday} ${value}`;
  return `${weekday} ${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const getNewYorkNowContext = (now: Date = new Date()) => {
  const parts = newYorkClockFormatter.formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const date = `${values.year ?? '0000'}-${values.month ?? '01'}-${values.day ?? '01'}`;
  const minutes = Number(values.hour ?? '0') * 60 + Number(values.minute ?? '0');
  return { date, minutes };
};

const shiftDateOnlyByDays = (value: string, deltaDays: number) => {
  const [year, month, day] = value.split('-').map((item) => Number(item) || 0);
  const next = new Date(Date.UTC(year, Math.max(month - 1, 0), day + deltaDays, 12, 0, 0));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
};

const getTimeZoneOffsetMinutes = (date: Date, timeZone: string) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const asUtcMs = Date.UTC(
    Number(parts.year ?? '0'),
    Math.max(Number(parts.month ?? '1') - 1, 0),
    Number(parts.day ?? '1'),
    Number(parts.hour ?? '0'),
    Number(parts.minute ?? '0'),
    Number(parts.second ?? '0')
  );
  return Math.round((asUtcMs - date.getTime()) / 60000);
};

const getNewYorkDateTimeUtc = (dateOnly: string, hour: number, minute = 0, second = 0) => {
  const [year, month, day] = dateOnly.split('-').map((item) => Number(item) || 0);
  const approximateUtc = new Date(Date.UTC(year, Math.max(month - 1, 0), day, hour, minute, second));
  const offsetMinutes = getTimeZoneOffsetMinutes(approximateUtc, NEW_YORK_TIMEZONE);
  return new Date(approximateUtc.getTime() - offsetMinutes * 60 * 1000);
};

const getAgencyOperationalNowContext = (now: Date = new Date()) => {
  const current = getNewYorkNowContext(now);
  return {
    ...current,
    operationalDate: current.minutes < DAY_CUTOFF_HOUR * 60 ? shiftDateOnlyByDays(current.date, -1) : current.date
  };
};

const getDefaultSelectedDate = () => {
  const { date } = getNewYorkNowContext();
  const [year, month, day] = date.split('-').map((value) => Number(value) || 0);
  const next = new Date(Date.UTC(year, Math.max(month - 1, 0), day + 1, 12, 0, 0));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
};

const isAgencyLeaveCutoffPassed = (
  shift: AgencyShift | '',
  workDate: string,
  context: ReturnType<typeof getNewYorkNowContext> = getNewYorkNowContext()
) => {
  if (shift !== 'early' && shift !== 'late') return false;
  if (workDate < context.date) return true;
  if (workDate > context.date) return false;
  const cutoffMinutes = shift === 'early' ? 10 * 60 : 17 * 60;
  return context.minutes > cutoffMinutes;
};

const isAgencyScheduleCutoffPassed = (
  shift: AgencyShift | '',
  workDate: string,
  context: ReturnType<typeof getNewYorkNowContext> = getNewYorkNowContext()
) => {
  if (workDate < context.date) return true;
  return isAgencyLeaveCutoffPassed(shift, workDate, context);
};

const isAgencyDeadlineLockedState = (
  shift: AgencyShift | '',
  workDate: string,
  context: ReturnType<typeof getNewYorkNowContext>
) => isAgencyScheduleCutoffPassed(shift, workDate, context);

const shouldShowAgencyLiveAbsent = ({
  shift,
  workDate,
  state,
  operationalDate,
  currentMinutes,
  hasPunch
}: {
  shift: AgencyShift | '';
  workDate: string;
  state: AgencyScheduleState;
  operationalDate: string;
  currentMinutes: number;
  hasPunch: boolean;
}) => {
  if (!isWorklikeState(state)) return false;
  if (workDate !== operationalDate) return false;
  if (hasPunch) return false;
  if (shift === 'late') return currentMinutes >= 16 * 60 + 30;
  return currentMinutes >= TIMECARD_ABSENT_VISIBLE_HOUR * 60;
};

const stateLabel = (state: AgencyScheduleState) => {
  if (state === 'new') return 'NEW';
  if (state === 'fixed_work') return 'Work';
  if (state === 'temp_work') return 'Temp';
  if (state === 'planned_temp_work') return 'Replace';
  if (state === 'leave_pending') return 'Excuse Pending';
  if (state === 'leave') return 'Excuse';
  if (state === 'planned_leave') return 'Excuse';
  if (state === 'temp_rest') return 'Off';
  if (state === 'planned_temp_rest') return 'Off';
  if (state === 'rest') return 'Off';
  return 'Work';
};

const isWorklikeState = (state: AgencyScheduleState) => isAgencyWorklikeState(state);

const normalizeServerScheduleState = (value: unknown, fallback: AgencyScheduleState): AgencyScheduleState => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  const allowedStates: AgencyScheduleState[] = [
    'new',
    'work',
    'fixed_work',
    'temp_work',
    'planned_temp_work',
    'leave_pending',
    'leave',
    'planned_leave',
    'temp_rest',
    'planned_temp_rest',
    'rest'
  ];
  if (allowedStates.includes(normalized as AgencyScheduleState)) {
    return normalized as AgencyScheduleState;
  }
  if (fallback === 'planned_leave') return 'leave_pending';
  return fallback;
};

const stateCellClass = (state: AgencyScheduleState, muted = false) => {
  if (state === 'new') return muted ? 'border border-cyan-500/40 bg-cyan-950/40 text-cyan-100' : 'border border-cyan-300/60 bg-cyan-500/20 text-cyan-100';
  if (state === 'work') return muted ? 'bg-lime-700/70 text-lime-100' : 'bg-neon text-white shadow-glow';
  if (state === 'fixed_work') return muted ? 'border-2 border-[#b6912e]/70 bg-[#153428] text-[#e3c772]' : 'border-2 border-[#d4a017] bg-[#0f3f2b] text-[#ffd24d]';
  if (state === 'temp_work') return muted ? 'border border-emerald-500/35 bg-emerald-950/80 text-emerald-100' : 'border border-emerald-400/40 bg-emerald-700 text-white shadow-[0_10px_24px_rgba(16,185,129,0.22)]';
  if (state === 'planned_temp_work') return muted ? 'border border-sky-500/35 bg-sky-950/75 text-sky-100' : 'border border-sky-300/50 bg-sky-500/20 text-sky-100 shadow-[0_10px_24px_rgba(56,189,248,0.18)]';
  if (state === 'leave_pending') return muted ? 'border border-amber-500/30 bg-amber-900/35 text-amber-100' : 'border border-amber-400/50 bg-amber-500/15 text-amber-100';
  if (state === 'leave') return muted ? 'bg-violet-900/70 text-violet-100' : 'bg-violet-500 text-white';
  if (state === 'planned_leave') return muted ? 'bg-fuchsia-950/70 text-fuchsia-200' : 'bg-fuchsia-600 text-white';
  if (state === 'temp_rest') return muted ? 'bg-slate-700/70 text-slate-300' : 'bg-red-800 text-red-100';
  if (state === 'planned_temp_rest') return muted ? 'bg-slate-700/70 text-slate-300' : 'bg-rose-600 text-white';
  return muted ? 'bg-slate-700/70 text-slate-300' : 'bg-ember text-white';
};

const shiftLabel = (shift: AgencyEmployeeRow['shift']) => {
  if (shift === 'early') return 'Morning';
  if (shift === 'late') return 'Night';
  return '-';
};

const normalizeAgencyShift = (shift: string): AgencyShift => (shift === 'late' ? 'late' : 'early');

const shiftChipClass = (shift: AgencyEmployeeRow['shift']) => {
  if (shift === 'early') return 'badge-elevated-dark border-amber-300/30 bg-amber-400/[0.13] text-amber-100';
  if (shift === 'late') return 'badge-elevated-dark border-violet-300/30 bg-violet-400/[0.13] text-violet-100';
  return 'badge-elevated-dark border-white/12 bg-white/[0.05] text-slate-200';
};

const agencyStatusLabel = (status: AgencyEmployeeRow['agencyStatus']) =>
  status === 'ready' ? 'Ready' : 'Wait for Confirm';

const agencyStatusChipClass = (status: AgencyEmployeeRow['agencyStatus']) =>
  status === 'ready'
    ? 'border-emerald-400/35 bg-emerald-500/12 text-emerald-100'
    : 'border-amber-400/35 bg-amber-500/12 text-amber-100';

const formatStartTime = (value: string) => {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return '-';
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return '-';
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return '-';
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const formatNewHireStartTime = (value: string) => {
  const normalized = formatStartTime(value);
  if (normalized !== '-') return normalized;
  return '09:00';
};

const toCsvCell = (value: unknown) => {
  const text = String(value ?? '');
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
};

const normalizeAgencyValue = (value: unknown) => {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const candidate = record.agency ?? record.Agency ?? record.name ?? record.label ?? record.value ?? record.text ?? '';
    return String(candidate ?? '').trim();
  }
  return '';
};

const positionChipClass = (position: string) => {
  const key = String(position ?? '').trim().toLowerCase();
  if (key === 'pick') return 'badge-elevated-dark border-sky-300/30 bg-sky-400/[0.13] text-sky-100';
  if (key === 'rebin') return 'badge-elevated-dark border-emerald-300/30 bg-emerald-400/[0.13] text-emerald-100';
  if (key === 'pack') return 'badge-elevated-dark border-rose-300/30 bg-rose-400/[0.13] text-rose-100';
  if (key === 'preship') return 'badge-elevated-dark border-amber-300/30 bg-amber-400/[0.13] text-amber-100';
  if (key === 'transfer') return 'badge-elevated-dark border-violet-300/30 bg-violet-400/[0.13] text-violet-100';
  return 'badge-elevated-dark border-white/12 bg-white/[0.05] text-slate-200';
};

const summaryCardStatusClass = (
  key: string,
  value: number,
  summaryValues: { required: number; scheduled: number; gap: number }
) => {
  if (key === 'required' || key === 'scheduled') {
    return summaryValues.required === summaryValues.scheduled
      ? 'border-2 border-emerald-400/80 bg-[linear-gradient(180deg,rgba(16,185,129,0.16),rgba(0,0,0,0.18))] shadow-[0_0_0_1px_rgba(16,185,129,0.18),0_22px_56px_rgba(16,185,129,0.18)]'
      : 'border-2 border-amber-400/85 bg-[linear-gradient(180deg,rgba(245,158,11,0.16),rgba(0,0,0,0.18))] shadow-[0_0_0_1px_rgba(245,158,11,0.16),0_22px_56px_rgba(245,158,11,0.16)]';
  }
  if (key === 'gap') {
    return value === 0
      ? 'border-2 border-emerald-400/80 bg-[linear-gradient(180deg,rgba(16,185,129,0.16),rgba(0,0,0,0.18))] shadow-[0_0_0_1px_rgba(16,185,129,0.18),0_22px_56px_rgba(16,185,129,0.18)]'
      : 'border-2 border-rose-400/85 bg-[linear-gradient(180deg,rgba(244,63,94,0.18),rgba(0,0,0,0.18))] shadow-[0_0_0_1px_rgba(244,63,94,0.2),0_22px_56px_rgba(244,63,94,0.18)]';
  }
  if (key === 'new_requests') {
    return 'border-2 border-emerald-400/80 bg-[linear-gradient(180deg,rgba(16,185,129,0.14),rgba(0,0,0,0.18))] shadow-[0_0_0_1px_rgba(16,185,129,0.16),0_22px_56px_rgba(16,185,129,0.16)]';
  }
  if (key === 'active') {
    return 'border-2 border-emerald-400/80 bg-[linear-gradient(180deg,rgba(16,185,129,0.14),rgba(0,0,0,0.18))] shadow-[0_0_0_1px_rgba(16,185,129,0.16),0_22px_56px_rgba(16,185,129,0.16)]';
  }
  if (key === 'day_off') {
    return 'border-2 border-emerald-400/80 bg-[linear-gradient(180deg,rgba(16,185,129,0.14),rgba(0,0,0,0.18))] shadow-[0_0_0_1px_rgba(16,185,129,0.16),0_22px_56px_rgba(16,185,129,0.16)]';
  }
  if (key === 'excuse') {
    return value === 0
      ? 'border-2 border-emerald-400/80 bg-[linear-gradient(180deg,rgba(16,185,129,0.14),rgba(0,0,0,0.18))] shadow-[0_0_0_1px_rgba(16,185,129,0.16),0_22px_56px_rgba(16,185,129,0.16)]'
      : 'border-2 border-violet-400/80 bg-[linear-gradient(180deg,rgba(167,139,250,0.16),rgba(0,0,0,0.18))] shadow-[0_0_0_1px_rgba(167,139,250,0.16),0_22px_56px_rgba(124,58,237,0.16)]';
  }
  return 'border-white/10';
};

const canRequestAgencyLeave = (state: AgencyScheduleState) =>
  state === 'work' || state === 'fixed_work' || state === 'temp_work';

const canAssignAgencySubstitute = (state: AgencyScheduleState) =>
  state === 'rest' || state === 'temp_rest' || state === 'planned_temp_rest';

const isCurrentTempWorkState = (state: AgencyScheduleState) => state === 'temp_work';

const isReplacementState = (state: AgencyScheduleState) => state === 'planned_temp_work';

const cardClass = 'rounded-[28px] border border-white/10 bg-black/20 p-5 shadow-[0_18px_40px_rgba(0,0,0,0.25)]';
const inputClass =
  'h-11 w-full rounded-2xl border border-white/10 bg-black/30 px-4 text-sm text-white outline-none transition focus:border-[#9eff00]';
const buttonClass =
  'inline-flex h-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 px-4 text-sm font-medium text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50';
const neonButtonClass =
  'inline-flex h-10 items-center justify-center rounded-2xl bg-neon px-4 text-sm font-semibold text-slate-950 transition hover:shadow-[0_12px_30px_rgba(158,255,0,0.25)] disabled:cursor-not-allowed disabled:opacity-50';
const selectedDateColumnClass =
  'bg-white/[0.03] shadow-[inset_3px_0_0_rgba(255,255,255,0.95),inset_-3px_0_0_rgba(255,255,255,0.95)]';
const selectedDateHeaderLabelClass =
  'inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.06] px-2 py-1 text-white';
const selectedDateColumnClassMobile = 'bg-white/[0.03]';

const Modal = ({
  open,
  title,
  children
}: {
  open: boolean;
  title: string;
  children: ReactNode;
}) => {
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 py-6">
      <div className="w-full max-w-xl rounded-[32px] border border-white/10 bg-slate-950 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="font-display text-2xl tracking-[0.04em] text-white">{title}</h3>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
};

const LoadingOverlay = ({ open, label }: { open: boolean; label: string }) => {
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[110] flex items-center justify-center px-6">
      <div className="agency-loading-shell">
        <div className="agency-loading-orbit agency-loading-orbit-a" />
        <div className="agency-loading-orbit agency-loading-orbit-b" />
        <div className="agency-loading-core">
          <div className="agency-loading-pulse" />
          <div className="agency-loading-dot agency-loading-dot-a" />
          <div className="agency-loading-dot agency-loading-dot-b" />
          <div className="agency-loading-dot agency-loading-dot-c" />
        </div>
        <div className="agency-loading-copy">
          <div className="agency-loading-label">Working</div>
          <div className="agency-loading-text">{label}</div>
        </div>
      </div>
    </div>,
    document.body
  );
};

const LoginPanel = ({
  email,
  password,
  setEmail,
  setPassword,
  onLogin,
  busy
}: {
  email: string;
  password: string;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  onLogin: () => void | Promise<void>;
  busy: boolean;
}) => (
  <section className="relative mx-auto w-full max-w-[1120px] overflow-hidden rounded-[36px] border border-white/10 bg-[linear-gradient(135deg,rgba(5,7,10,0.92),rgba(11,13,16,0.84))] shadow-[0_40px_120px_rgba(0,0,0,0.45)]">
    <div className="pointer-events-none absolute inset-0">
      <div className="absolute -left-20 top-[-72px] h-64 w-64 rounded-full bg-[#9eff00]/10 blur-3xl" />
      <div className="absolute bottom-[-96px] right-[-56px] h-72 w-72 rounded-full bg-sky-400/10 blur-3xl" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.02),transparent_32%)]" />
    </div>
    <div className="relative grid min-h-[520px] gap-8 px-6 py-6 md:grid-cols-[minmax(0,1.3fr)_minmax(380px,0.9fr)] md:px-8 md:py-8 xl:px-10 xl:py-10">
      <div className="flex min-h-[240px] flex-col justify-between rounded-[28px] border border-white/8 bg-white/[0.03] p-6 md:p-8">
        <div>
          <div className="text-[11px] uppercase tracking-[0.32em] text-sky-200/80">OBP Agency</div>
          <h1 className="mt-6 max-w-[9ch] font-display text-5xl leading-[0.92] tracking-[0.03em] text-white md:text-6xl xl:text-7xl">
            Secure Agency Access
          </h1>
        </div>
      </div>
      <div className="flex items-center">
        <div className="w-full rounded-[30px] border border-white/10 bg-black/35 p-6 shadow-[0_28px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl md:p-8">
          <div className="text-[11px] uppercase tracking-[0.3em] text-slate-400">Sign In</div>
          <div className="mt-4 font-display text-4xl tracking-[0.03em] text-white md:text-5xl">Agency Board</div>
          <div className="mt-8 grid gap-5">
            <label className="grid gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">Email</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                autoComplete="email"
                className={[inputClass, 'h-14 rounded-[20px] border-white/12 bg-black/30 px-5 text-base placeholder:text-slate-500'].join(' ')}
              />
            </label>
            <label className="grid gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.22em] text-slate-500">Password</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                className={[inputClass, 'h-14 rounded-[20px] border-white/12 bg-black/30 px-5 text-base placeholder:text-slate-500'].join(' ')}
              />
            </label>
            <button
              type="button"
              disabled={busy || !email.trim() || !password}
              onClick={() => void onLogin()}
              className={[neonButtonClass, 'mt-2 h-14 rounded-[20px] text-base font-semibold'].join(' ')}
            >
              Sign In
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
);

type ScheduleCellProps = {
  staffId: string;
  employeeName: string;
  workDate: string;
  state: AgencyScheduleState;
  showAbsent: boolean;
  isSelectedWorkDate: boolean;
  isLastEmployeeRow: boolean;
  cellOptions: SchedulePickerOption[];
  canEditCell: boolean;
  isDeadlineLocked: boolean;
  busy: boolean;
  selectedDateColumnClass: string;
  selectedDateLastRowClass: string;
  onCellClick: (
    event: ReactMouseEvent<HTMLButtonElement>,
    staffId: string,
    workDate: string,
    cellOptions: SchedulePickerOption[],
    state: AgencyScheduleState
  ) => void;
};

const ScheduleCell = memo(function ScheduleCell({
  staffId,
  employeeName,
  workDate,
  state,
  showAbsent,
  isSelectedWorkDate,
  isLastEmployeeRow,
  cellOptions,
  canEditCell,
  isDeadlineLocked,
  busy,
  selectedDateColumnClass,
  selectedDateLastRowClass,
  onCellClick
}: ScheduleCellProps) {
  const useMutedCellStyle = !canEditCell || isDeadlineLocked;

  return (
    <td
      className={[
        'px-0.5 py-1.5 text-center',
        isSelectedWorkDate ? selectedDateColumnClass : '',
        isSelectedWorkDate && isLastEmployeeRow ? selectedDateLastRowClass : ''
      ].join(' ')}
    >
      <button
        type="button"
        data-agency-schedule-trigger="true"
        disabled={busy || !canEditCell}
        onClick={(event) => onCellClick(event, staffId, workDate, cellOptions, state)}
        className={[
          'h-8 w-[74px] rounded-md px-1 text-[9px] font-semibold leading-none transition disabled:cursor-not-allowed disabled:opacity-100',
          !canEditCell ? 'saturate-50 brightness-90' : '',
          showAbsent
            ? 'border border-slate-300 bg-white text-slate-900'
            : stateCellClass(state, useMutedCellStyle)
        ].join(' ')}
        title={`${employeeName} · ${workDate}${showAbsent ? ' · Absent' : ''}${isDeadlineLocked ? ' · Cutoff locked' : ''}`}
      >
        {showAbsent ? 'Absent' : stateLabel(state)}
      </button>
    </td>
  );
}, (previousProps, nextProps) =>
  previousProps.staffId === nextProps.staffId &&
  previousProps.employeeName === nextProps.employeeName &&
  previousProps.workDate === nextProps.workDate &&
  previousProps.state === nextProps.state &&
  previousProps.showAbsent === nextProps.showAbsent &&
  previousProps.isSelectedWorkDate === nextProps.isSelectedWorkDate &&
  previousProps.isLastEmployeeRow === nextProps.isLastEmployeeRow &&
  previousProps.canEditCell === nextProps.canEditCell &&
  previousProps.isDeadlineLocked === nextProps.isDeadlineLocked &&
  previousProps.busy === nextProps.busy &&
  previousProps.selectedDateColumnClass === nextProps.selectedDateColumnClass &&
  previousProps.selectedDateLastRowClass === nextProps.selectedDateLastRowClass &&
  previousProps.onCellClick === nextProps.onCellClick);

export default function AgencyAppPage() {
  const [supabase] = useState(() => createSupabaseClient({ persistSession: true }));
  const [user, setUser] = useState<User | null>(null);
  const [access, setAccess] = useState<AdminAccessContext | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [board] = useState<AgencyBoard | null>(null);
  const [weekSchedule, setWeekSchedule] = useState<AgencyWeekSchedule | null>(null);
  const [absentMarkKeys, setAbsentMarkKeys] = useState<Set<string>>(() => new Set());
  const [currentOperationalPunchStaffIds, setCurrentOperationalPunchStaffIds] = useState<Set<string>>(() => new Set());
  const [dailyListLightFlags, setDailyListLightFlags] = useState<DailyListLightFlags>(createEmptyDailyListLightFlags);
  const [scheduleStateOverrides, setScheduleStateOverrides] = useState(() => new Map<string, AgencyScheduleState>());
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingNoteStaffIds, setSavingNoteStaffIds] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('Syncing board');
  const [notice, setNotice] = useState<NoticeState>(null);
  const [deleteNewHireConfirm, setDeleteNewHireConfirm] = useState<DeleteNewHireConfirmState>(null);
  const [cancelTerminationConfirm, setCancelTerminationConfirm] = useState<CancelTerminationConfirmState>(null);
  const [deleteDriverGroupConfirm, setDeleteDriverGroupConfirm] = useState<DeleteDriverGroupConfirmState>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedDate, setSelectedDate] = useState(getDefaultSelectedDate);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [agencyFilter, setAgencyFilter] = useState('all');
  const [positionFilter, setPositionFilter] = useState('all');
  const [shiftFilter, setShiftFilter] = useState<'all' | 'early' | 'late'>('all');
  const [modal, setModal] = useState<ModalState>(null);
  const [selectedEmployee, setSelectedEmployee] = useState<AgencyEmployeeRow | null>(null);
  const [selectedNewHire, setSelectedNewHire] = useState<AgencyNewHireRequestRow | null>(null);
  const [selectedNoteEmployee, setSelectedNoteEmployee] = useState<AgencyEmployeeRow | null>(null);
  const [driverGroupForm, setDriverGroupForm] = useState<DriverGroupFormState>({
    code: '1',
    driverStaffId: '',
    memberStaffIds: [],
    sourceStaffId: ''
  });
  const [terminationReason, setTerminationReason] = useState('');
  const [newHireForm, setNewHireForm] = useState<AgencyUpsertNewHireInput>({
    staffId: null,
    workDate: selectedDate,
    position: 'Pick',
    shift: 'early',
    agency: String(agencyFilter !== 'all' ? agencyFilter : access?.managed_agencies[0] ?? ''),
    label: '',
    entryTime: '',
    note: '',
    count: 1,
    employeeName: '',
    lockedAgency: false,
    lockedPosition: false,
    lockedShift: false,
    lockedWorkDate: false
  });
  const [schedulePicker, setSchedulePicker] = useState<SchedulePickerState>({
    open: false,
    staffId: '',
    workDate: '',
    currentState: 'rest',
    options: [],
    anchorLeft: 0,
    anchorTop: 0
  });
  const [compactScheduleView, setCompactScheduleView] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= MOBILE_SCHEDULE_MAX_WIDTH : false
  );

  const openNotice = useCallback((tone: NoticeTone, message: string, title?: string) => {
    const fallbackTitle = tone === 'error' ? 'Error' : 'Notice';
    setNotice({
      title: title?.trim() || fallbackTitle,
      message,
      tone
    });
  }, []);

  const beginBusy = useCallback((label: string) => {
    setBusyLabel(label);
    setBusy(true);
  }, []);

  const endBusy = useCallback(() => {
    setBusy(false);
    setBusyLabel('');
  }, []);

  const moduleMap = useMemo(() => getModuleMapFromContext(access), [access]);
  const canViewAgency = hasModuleAccess(moduleMap, 'agency', 'view');
  const canOperateAgency = hasModuleAccess(moduleMap, 'agency', 'operate');
  const newYorkNowContext = useMemo(() => getNewYorkNowContext(), [selectedDate, weekSchedule]);
  const operationalNowContext = useMemo(() => getAgencyOperationalNowContext(), [selectedDate, weekSchedule]);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
    });
    const subscription = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => {
      active = false;
      subscription.data.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    let active = true;
    const loadContext = async () => {
      if (!supabase || !user) {
        setAccess(null);
        setDisplayName('');
        setAccessLoading(false);
        return;
      }
      setAccessLoading(true);
      try {
        const [nextAccess, nextDisplayName] = await Promise.all([
          fetchAdminAccessContext(supabase, user.email),
          fetchAgencyUserDisplayName(supabase, user.id)
        ]);
        if (!active) return;
        if (!nextAccess.is_active) {
          setAccess(null);
          setDisplayName('');
          openNotice('error', 'Account was locked', 'Account was locked');
          await supabase.auth.signOut();
          return;
        }
        setAccess(nextAccess);
        setDisplayName(nextDisplayName);
      } catch (nextError) {
        if (!active) return;
        openNotice('error', nextError instanceof Error ? nextError.message : 'Failed to load access context.');
      } finally {
        if (active) setAccessLoading(false);
      }
    };
    void loadContext();
    return () => {
      active = false;
    };
  }, [supabase, user]);

  useEffect(() => {
    if (!selectedDate) return;
    setNewHireForm((prev) => ({
      ...prev,
      workDate: selectedDate,
      agency: normalizeAgencyValue(agencyFilter !== 'all' ? agencyFilter : access?.managed_agencies[0] ?? prev.agency),
      entryTime: '09:00',
      note: prev.note || 'NEW'
    }));
  }, [selectedDate, access?.managed_agencies, agencyFilter]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const updateCompactMode = () => {
      setCompactScheduleView(window.innerWidth <= MOBILE_SCHEDULE_MAX_WIDTH);
    };
    updateCompactMode();
    window.addEventListener('resize', updateCompactMode);
    return () => {
      window.removeEventListener('resize', updateCompactMode);
    };
  }, []);

  useEffect(() => {
    if (!schedulePicker.open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-agency-schedule-popover="true"]') || target?.closest('[data-agency-schedule-trigger="true"]')) return;
      setSchedulePicker((prev) => ({ ...prev, open: false }));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSchedulePicker((prev) => ({ ...prev, open: false }));
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [schedulePicker.open]);

  useEffect(() => {
    const nextDrafts: Record<string, string> = {};
    for (const row of weekSchedule?.employees ?? []) {
      nextDrafts[row.staff_id] = row.agency_note ?? '';
    }
    setNoteDrafts(nextDrafts);
  }, [weekSchedule]);

  const refreshBoard = useCallback(async () => {
    if (!supabase || !user || !canViewAgency) return;
    beginBusy('Syncing board');
    try {
      const nextWeekSchedule = await fetchAgencyScheduleWeek(supabase, selectedDate);
      setWeekSchedule(nextWeekSchedule);
      setScheduleStateOverrides(new Map());
    } catch (nextError) {
      openNotice('error', nextError instanceof Error ? nextError.message : 'Failed to load board.');
    } finally {
      endBusy();
    }
  }, [beginBusy, canViewAgency, endBusy, openNotice, selectedDate, supabase, user]);

  const refreshBoardSilent = useCallback(async () => {
    if (!supabase || !user || !canViewAgency) return;
    try {
      const nextWeekSchedule = await fetchAgencyScheduleWeek(supabase, selectedDate);
      setWeekSchedule(nextWeekSchedule);
      setScheduleStateOverrides(new Map());
    } catch {
      // Keep current board state when silent refresh fails.
    }
  }, [canViewAgency, selectedDate, supabase, user]);

  useEffect(() => {
    void refreshBoard();
  }, [refreshBoard]);

  useEffect(() => {
    let active = true;
    const loadDailyListLights = async () => {
      if (!supabase || !user || !canViewAgency) {
        setDailyListLightFlags(createEmptyDailyListLightFlags());
        return;
      }
      const res = await supabase
        .from(APP_SETTINGS_TABLE)
        .select('value')
        .eq('key', DAILY_LIST_LIGHTS_KEY)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (!active) return;
      if (res.error) {
        setDailyListLightFlags(createEmptyDailyListLightFlags());
        return;
      }
      const row = (((res.data as Array<{ value?: unknown }> | null) ?? [])[0] ?? null) as { value?: unknown } | null;
      setDailyListLightFlags(readDailyListLightsForDate(row?.value ?? null, selectedDate));
    };
    void loadDailyListLights();
    return () => {
      active = false;
    };
  }, [canViewAgency, selectedDate, supabase, user]);

  useEffect(() => {
    let active = true;
    const loadAbsentMarks = async () => {
      if (!supabase || !user || !canViewAgency || !weekSchedule) {
        setAbsentMarkKeys(new Set());
        return;
      }
      const staffIds = (weekSchedule.employees ?? []).map((row) => row.staff_id).filter(Boolean);
      const workDates = (weekSchedule.week_dates ?? []).filter(Boolean);
      if (staffIds.length === 0 || workDates.length === 0) {
        setAbsentMarkKeys(new Set());
        return;
      }
      try {
        const keys = await fetchAgencyAbsentMarkKeys(supabase, staffIds, workDates);
        if (!active) return;
        setAbsentMarkKeys(new Set(keys));
      } catch {
        if (!active) return;
        setAbsentMarkKeys(new Set());
      }
    };
    void loadAbsentMarks();
    return () => {
      active = false;
    };
  }, [canViewAgency, supabase, user, weekSchedule]);

  useEffect(() => {
    let active = true;
    const loadCurrentOperationalPunchPresence = async () => {
      if (!supabase || !user || !canViewAgency || !weekSchedule) {
        setCurrentOperationalPunchStaffIds(new Set());
        return;
      }
      if (!(weekSchedule.week_dates ?? []).includes(operationalNowContext.operationalDate)) {
        setCurrentOperationalPunchStaffIds(new Set());
        return;
      }
      const staffIds = (weekSchedule.employees ?? []).map((row) => row.staff_id).filter(Boolean);
      if (staffIds.length === 0) {
        setCurrentOperationalPunchStaffIds(new Set());
        return;
      }
      try {
        const rangeStartIso = getNewYorkDateTimeUtc(operationalNowContext.operationalDate, DAY_CUTOFF_HOUR).toISOString();
        const rangeEndIso = new Date().toISOString();
        const staffWithPunches = await fetchAgencyPunchPresenceStaffIds(supabase, staffIds, rangeStartIso, rangeEndIso);
        if (!active) return;
        setCurrentOperationalPunchStaffIds(new Set(staffWithPunches));
      } catch {
        if (!active) return;
        setCurrentOperationalPunchStaffIds(new Set());
      }
    };
    void loadCurrentOperationalPunchPresence();
    const timer = window.setInterval(() => {
      void loadCurrentOperationalPunchPresence();
    }, 60000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [canViewAgency, operationalNowContext.operationalDate, supabase, user, weekSchedule]);

  useEffect(() => {
    if (!supabase || !user || !canViewAgency || !weekSchedule) return;
    const staffIds = new Set((weekSchedule.employees ?? []).map((row) => row.staff_id).filter(Boolean));
    const workDates = new Set((weekSchedule.week_dates ?? []).filter(Boolean));
    const refreshAbsentMarks = async () => {
      const keys = await fetchAgencyAbsentMarkKeys(supabase, Array.from(staffIds), Array.from(workDates));
      setAbsentMarkKeys(new Set(keys));
    };
    const refreshPunchPresence = async () => {
      if (!workDates.has(operationalNowContext.operationalDate)) {
        setCurrentOperationalPunchStaffIds(new Set());
        return;
      }
      const rangeStartIso = getNewYorkDateTimeUtc(operationalNowContext.operationalDate, DAY_CUTOFF_HOUR).toISOString();
      const rangeEndIso = new Date().toISOString();
      const staffWithPunches = await fetchAgencyPunchPresenceStaffIds(supabase, Array.from(staffIds), rangeStartIso, rangeEndIso);
      setCurrentOperationalPunchStaffIds(new Set(staffWithPunches));
    };
    const channel = supabase
      .channel(`agency-live-attendance-${selectedDate}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ob_attendance_marks' },
        (payload) => {
          const row = (payload.new ?? payload.old) as { staff_id?: string | null; work_date?: string | null; mark_type?: string | null } | null;
          const staffId = String(row?.staff_id ?? '').trim();
          const workDate = String(row?.work_date ?? '').trim();
          const markType = String(row?.mark_type ?? '').trim();
          if (!staffIds.has(staffId) || !workDates.has(workDate) || markType !== 'absent') return;
          void refreshAbsentMarks();
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'ob_punches' },
        (payload) => {
          const row = (payload.new ?? payload.old) as { staff_id?: string | null } | null;
          const staffId = String(row?.staff_id ?? '').trim();
          if (!staffIds.has(staffId)) return;
          void refreshPunchPresence();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [canViewAgency, operationalNowContext.operationalDate, selectedDate, supabase, user, weekSchedule]);

  useEffect(() => {
    setSchedulePicker((prev) => ({ ...prev, open: false }));
  }, [selectedDate]);

  const doLogin = async () => {
    if (!supabase) return;
    beginBusy('Signing in');
    try {
      const nextEmail = email.trim();
      const result = await supabase.auth.signInWithPassword({ email: nextEmail, password });
      if (result.error) throw new Error(result.error.message);
      const context = await fetchAdminAccessContext(supabase, nextEmail);
      if (!context.is_active) {
        await supabase.auth.signOut();
        openNotice('error', 'Account was locked', 'Account was locked');
        setPassword('');
        return;
      }
      setPassword('');
    } catch (nextError) {
      openNotice('error', nextError instanceof Error ? nextError.message : 'Sign in failed.');
    } finally {
      endBusy();
    }
  };

  const doLogout = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
  };

  const openCreateNewHire = (overrideAgency?: string, overridePosition?: string, overrideShift?: 'early' | 'late') => {
    if (!hasOpenGapForSelectedDate && !overrideAgency) {
      openNotice('info', 'No GAP for the selected date.');
      return;
    }
    setSelectedNewHire(null);
    const defaultGap = gapsByGroupOnSelectedDate[0];
    const msgAgency = normalizeAgencyValue(
      overrideAgency ?? defaultGap?.agency ?? (agencyFilter !== 'all' ? agencyFilter : access?.managed_agencies[0] ?? agencyOptions[0] ?? '')
    );
    const hasLockedAgency = Boolean(overrideAgency) && Boolean(msgAgency);
    const msgPosition = String(overridePosition ?? defaultGap?.position ?? 'Pick');
    const msgShift = (overrideShift ?? normalizeAgencyShift(String(defaultGap?.shift ?? 'early'))) as 'early' | 'late';
    setNewHireForm({
      staffId: null,
      workDate: selectedDate,
      position: msgPosition,
      shift: msgShift,
      agency: msgAgency,
      label: '',
      entryTime: '09:00',
      note: 'NEW',
      count: 1,
      employeeName: '',
      lockedAgency: hasLockedAgency,
      lockedPosition: Boolean(overridePosition),
      lockedShift: Boolean(overrideShift),
      lockedWorkDate: Boolean(overrideAgency)
    });
    setModal('new_hire');
  };

  const openEditNewHire = (row: AgencyNewHireRequestRow) => {
    setSelectedNewHire(row);
    setNewHireForm({
      staffId: row.staff_id,
      workDate: selectedDate,
      position: String(row.position),
      shift: (row.shift === 'late' ? 'late' : 'early') as 'early' | 'late',
      agency: normalizeAgencyValue(row.agency),
      label: '',
      entryTime: '09:00',
      note: 'NEW',
      count: 1,
      employeeName: String(row.name ?? ''),
      lockedAgency: true,
      lockedPosition: true,
      lockedShift: true,
      lockedWorkDate: true
    });
    setModal('new_hire');
  };

  const closeModal = () => {
    setModal(null);
    setSelectedEmployee(null);
    setSelectedNewHire(null);
    setSelectedNoteEmployee(null);
    setTerminationReason('');
  };

  const closeDeleteNewHireConfirm = () => {
    setDeleteNewHireConfirm(null);
  };

  const closeCancelTerminationConfirm = () => {
    setCancelTerminationConfirm(null);
  };

  const closeDeleteDriverGroupConfirm = () => {
    setDeleteDriverGroupConfirm(null);
  };

  const openDriverGroupModal = (code?: string, seedEmployee?: AgencyEmployeeRow) => {
    const normalizedCode = String(code ?? nextDriverGroupCode).trim() || nextDriverGroupCode;
    const groupRows = employeeRows.filter((employee) => employee.driver_group_code === normalizedCode);
    const seedStaffId = String(seedEmployee?.staff_id ?? '').trim();
    const driver = groupRows.find((employee) => employee.driver_group_role === 'driver') ?? groupRows[0] ?? seedEmployee ?? null;
    const memberStaffIds = Array.from(new Set([...groupRows.map((employee) => employee.staff_id), seedStaffId].filter(Boolean)));
    setDriverGroupForm({
      code: normalizedCode,
      driverStaffId: driver?.staff_id ?? '',
      memberStaffIds,
      sourceStaffId: seedStaffId
    });
    setModal('driver_group');
  };

  const requestDeleteDriverGroup = (code: string) => {
    const normalizedCode = String(code ?? '').trim();
    if (!normalizedCode) return;
    setDeleteDriverGroupConfirm({ code: normalizedCode });
  };

  const openTerminationModal = (employee: AgencyEmployeeRow) => {
    setSelectedEmployee(employee);
    setTerminationReason('');
    setModal('termination');
  };

  const openNoteModal = (employee: AgencyEmployeeRow) => {
    setSelectedNoteEmployee(employee);
    setNoteDrafts((previous) => ({
      ...previous,
      [employee.staff_id]: previous[employee.staff_id] ?? employee.agency_note ?? ''
    }));
    setModal('employee_note');
  };

  const requestCancelTermination = (employee: AgencyEmployeeRow) => {
    const displayName = String(employee.name ?? '').trim() || employee.staff_id;
    setCancelTerminationConfirm({
      staffId: employee.staff_id,
      displayName
    });
  };

  const submitNewHire = async () => {
    if (!supabase) return;
    if (!selectedNewHire && newHireSelectedOpenSlots <= 0) {
      openNotice('error', 'No GAP for selected Agency / Position / Shift.');
      return;
    }
    beginBusy(selectedNewHire ? 'Saving request' : 'Creating request');
    try {
      await upsertAgencyNewHireDemand(supabase, newHireForm);
      closeModal();
      await refreshBoard();
    } catch (nextError) {
      openNotice('error', nextError instanceof Error ? nextError.message : 'New request save failed.');
    } finally {
      endBusy();
    }
  };

  const submitDriverGroup = async () => {
    if (!supabase || !canOperateAgency) return;
    const code = String(driverGroupForm.code ?? '').trim();
    const driverStaffId = String(driverGroupForm.driverStaffId ?? '').trim();
    const memberStaffIds = Array.from(new Set([...driverGroupForm.memberStaffIds, driverStaffId].map((item) => String(item ?? '').trim()).filter(Boolean)));
    if (!code || !driverStaffId || memberStaffIds.length < 2) {
      openNotice('error', 'Select one driver and at least one member.');
      return;
    }
    beginBusy('Saving group');
    try {
      await upsertAgencyDriverGroup(supabase, code, driverStaffId, memberStaffIds);
      closeModal();
      await refreshBoard();
    } catch (nextError) {
      openNotice('error', nextError instanceof Error ? nextError.message : 'Driver group save failed.');
    } finally {
      endBusy();
    }
  };

  const submitDriverGroupIndividual = async () => {
    if (!supabase || !canOperateAgency) return;
    const staffId = String(driverGroupForm.sourceStaffId ?? '').trim();
    if (!staffId) return;
    beginBusy('Saving group');
    try {
      await setAgencyDriverGroupIndividual(supabase, staffId);
      closeModal();
      await refreshBoard();
    } catch (nextError) {
      openNotice('error', nextError instanceof Error ? nextError.message : 'Driver group save failed.');
    } finally {
      endBusy();
    }
  };

  const selectEmployeeDriverGroup = async (employee: AgencyEmployeeRow, value: string) => {
    if (!supabase || !canOperateAgency) return;
    const staffId = String(employee.staff_id ?? '').trim();
    if (!staffId) return;
    if (value === (employee.driver_group_code ? `group:${employee.driver_group_code}` : 'individual')) return;

    beginBusy('Saving group');
    try {
      if (value === 'individual') {
        await setAgencyDriverGroupIndividual(supabase, staffId);
      } else {
        const code = value === 'new' ? nextDriverGroupCode : value.replace(/^group:/, '').trim();
        if (!code) throw new Error('Driver group is required.');
        const groupRows = employeeRows.filter((row) => row.driver_group_code === code);
        const driver = groupRows.find((row) => row.driver_group_role === 'driver') ?? groupRows[0] ?? employee;
        const memberStaffIds = Array.from(
          new Set([...groupRows.map((row) => row.staff_id), staffId, driver.staff_id].map((item) => String(item ?? '').trim()).filter(Boolean))
        );
        await upsertAgencyDriverGroup(supabase, code, driver.staff_id, memberStaffIds);
      }
      await refreshBoard();
    } catch (nextError) {
      openNotice('error', nextError instanceof Error ? nextError.message : 'Driver group save failed.');
    } finally {
      endBusy();
    }
  };

  const submitEmployeeNote = async (employee: AgencyEmployeeRow) => {
    if (!supabase || !canOperateAgency) return;
    const nextNote = normalizeAgencyNote(noteDrafts[employee.staff_id] ?? '');
    if (nextNote === normalizeAgencyNote(employee.agency_note)) return;
    setSavingNoteStaffIds((previous) => {
      const next = new Set(previous);
      next.add(employee.staff_id);
      return next;
    });
    try {
      await upsertAgencyEmployeeNote(supabase, employee.staff_id, nextNote);
      setWeekSchedule((previous) => {
        if (!previous) return previous;
        return {
          ...previous,
          employees: previous.employees.map((row) => (row.staff_id === employee.staff_id ? { ...row, agency_note: nextNote } : row))
        };
      });
      setSelectedNoteEmployee((previous) =>
        previous?.staff_id === employee.staff_id ? { ...previous, agency_note: nextNote } : previous
      );
      setNoteDrafts((previous) => ({ ...previous, [employee.staff_id]: nextNote }));
    } catch (nextError) {
      openNotice('error', nextError instanceof Error ? nextError.message : 'Note save failed.');
    } finally {
      setSavingNoteStaffIds((previous) => {
        const next = new Set(previous);
        next.delete(employee.staff_id);
        return next;
      });
    }
  };

  const confirmDeleteDriverGroup = async () => {
    if (!supabase || !canOperateAgency || !deleteDriverGroupConfirm) return;
    beginBusy('Removing group');
    try {
      await deleteAgencyDriverGroup(supabase, deleteDriverGroupConfirm.code);
      closeDeleteDriverGroupConfirm();
      await refreshBoard();
    } catch (nextError) {
      openNotice('error', nextError instanceof Error ? nextError.message : 'Driver group delete failed.');
    } finally {
      endBusy();
    }
  };

  const deleteNewHire = async (row: AgencyNewHireRequestRow) => {
    if (!supabase || !canOperateAgency) return;
    if (!row.can_delete) return;
    const displayName = String(row.name ?? '').trim() || row.staff_id;
    setDeleteNewHireConfirm({
      staffId: row.staff_id,
      displayName
    });
  };

  const confirmDeleteNewHire = async () => {
    if (!supabase || !canOperateAgency || !deleteNewHireConfirm) return;
    beginBusy('Removing request');
    try {
      await deleteAgencyNewHireDemand(supabase, deleteNewHireConfirm.staffId, selectedDate);
      if (selectedNewHire?.staff_id === deleteNewHireConfirm.staffId) {
        closeModal();
      }
      closeDeleteNewHireConfirm();
      await refreshBoard();
    } catch (nextError) {
      openNotice('error', nextError instanceof Error ? nextError.message : 'Delete NEW failed.');
    } finally {
      endBusy();
    }
  };

  const submitTermination = async () => {
    if (!supabase || !selectedEmployee || !terminationReason.trim()) return;
    beginBusy('Submitting termination');
    try {
      await createAgencyTerminationRequest(supabase, selectedEmployee.staff_id, terminationReason.trim());
      closeModal();
      await refreshBoard();
    } catch (nextError) {
      openNotice('error', nextError instanceof Error ? nextError.message : 'Termination request failed.');
    } finally {
      endBusy();
    }
  };

  const confirmCancelTermination = async () => {
    if (!supabase || !canOperateAgency || !cancelTerminationConfirm) return;
    beginBusy('Withdrawing termination');
    try {
      await cancelAgencyTerminationRequest(supabase, cancelTerminationConfirm.staffId);
      closeCancelTerminationConfirm();
      await refreshBoard();
    } catch (nextError) {
      openNotice('error', nextError instanceof Error ? nextError.message : 'Withdraw termination request failed.');
    } finally {
      endBusy();
    }
  };

  const submitScheduleState = useCallback(
    async (staffId: string, workDate: string, state: AgencyScheduleState) => {
      if (!supabase || !canOperateAgency) return;
      setSchedulePicker((prev) => ({ ...prev, open: false }));
      const overrideKey = `${staffId}__${workDate}`;
      const previousState = scheduleStateOverrides.get(overrideKey);
      setScheduleStateOverrides((previous) => {
        const next = new Map(previous);
        next.set(overrideKey, state);
        return next;
      });
      try {
        const response = await setAgencyScheduleState(supabase, staffId, workDate, state);
        const nextState = normalizeServerScheduleState(response?.state, state);
        setScheduleStateOverrides((previous) => {
          const next = new Map(previous);
          next.set(overrideKey, nextState);
          return next;
        });
        void refreshBoardSilent();
      } catch (nextError) {
        if (previousState === undefined) {
          setScheduleStateOverrides((previous) => {
            const next = new Map(previous);
            next.delete(overrideKey);
            return next;
          });
        } else {
          setScheduleStateOverrides((previous) => {
            const next = new Map(previous);
            next.set(overrideKey, previousState);
            return next;
          });
        }
        openNotice('error', nextError instanceof Error ? nextError.message : 'Schedule update failed.');
      }
    },
    [canOperateAgency, openNotice, refreshBoardSilent, scheduleStateOverrides, supabase]
  );

  const handleScheduleCellClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, staffId: string, workDate: string, cellOptions: SchedulePickerOption[], state: AgencyScheduleState) => {
      if (cellOptions.length === 0) return;
      if (cellOptions.length === 1) {
        void submitScheduleState(staffId, workDate, cellOptions[0].key);
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      setSchedulePicker({
        open: true,
        staffId,
        workDate,
        currentState: state,
        options: cellOptions,
        anchorLeft: rect.left + rect.width / 2,
        anchorTop: rect.bottom + 10
      });
    },
    [submitScheduleState, setSchedulePicker]
  );

  /*
  const LegacyScheduleCell = memo(function LegacyScheduleCell({
    staffId,
    employeeName,
    workDate,
    state,
    isSelectedWorkDate,
    isLastEmployeeRow,
    cellOptions,
    canEditCell,
    isDeadlineLocked,
    busy,
    selectedDateColumnClass
  }: LegacyScheduleCellProps) {
    const displayState = state;
    const useMutedCellStyle = !canEditCell || isDeadlineLocked;
    
    return (
      <td
        key={`${staffId}__${workDate}`}
        className={[
          'px-0.5 py-1.5 text-center',
          isSelectedWorkDate ? selectedDateColumnClass : '',
          isSelectedWorkDate && isLastEmployeeRow ? 'shadow-[inset_3px_0_0_rgba(255,255,255,0.95),inset_-3px_0_0_rgba(255,255,255,0.95),inset_0_-3px_0_rgba(255,255,255,0.95)]' : ''
        ].join(' ')}
      >
        <button
          type="button"
          data-agency-schedule-trigger="true"
          disabled={busy || !canEditCell}
          onClick={(event) => handleScheduleCellClick(event, staffId, workDate, cellOptions, state)}
          className={[
            'h-8 w-[74px] rounded-md px-1 text-[9px] font-semibold leading-none transition disabled:cursor-not-allowed disabled:opacity-100',
            !canEditCell ? 'saturate-50 brightness-90' : '',
            stateCellClass(displayState, useMutedCellStyle)
          ].join(' ')}
          title={`${employeeName} · ${workDate}${isDeadlineLocked ? ' · Cutoff locked' : ''}`}
        >
          {stateLabel(displayState)}
        </button>
      </td>
    );
  });
  */

  const weekDates = useMemo(() => {
    if (weekSchedule && weekSchedule.week_dates.length === 7) return weekSchedule.week_dates;
    const anchor = new Date(`${selectedDate}T00:00:00`);
    const weekStart = startOfWeekMonday(Number.isNaN(anchor.getTime()) ? new Date() : anchor);
    return Array.from({ length: 7 }, (_, index) => toDateOnly(addDays(weekStart, index)));
  }, [selectedDate, weekSchedule]);

  const visibleWeekDates = useMemo(() => {
    if (!compactScheduleView) return weekDates;
    return weekDates.includes(selectedDate) ? [selectedDate] : [weekDates[0] ?? selectedDate];
  }, [compactScheduleView, selectedDate, weekDates]);

  const showIdColumn = !compactScheduleView;
  const showAgencyColumn = !compactScheduleView;
  const showDriverGroupColumn = !compactScheduleView;
  const showNoteColumn = !compactScheduleView;
  const showStartTimeColumn = !compactScheduleView;
  const selectedDateColumnToneClass = compactScheduleView ? selectedDateColumnClassMobile : selectedDateColumnClass;
  const selectedDateHeaderColumnClass = compactScheduleView
    ? selectedDateColumnClassMobile
    : `${selectedDateColumnClass} shadow-[inset_3px_0_0_rgba(255,255,255,0.95),inset_-3px_0_0_rgba(255,255,255,0.95),inset_0_3px_0_rgba(255,255,255,0.95)]`;
  const selectedDateLastRowClass = compactScheduleView
    ? ''
    : 'shadow-[inset_3px_0_0_rgba(255,255,255,0.95),inset_-3px_0_0_rgba(255,255,255,0.95),inset_0_-3px_0_rgba(255,255,255,0.95)]';
  const fixedScheduleColumnCount =
    (showIdColumn ? 1 : 0) +
    1 +
    (showAgencyColumn ? 1 : 0) +
    (showDriverGroupColumn ? 1 : 0) +
    (showNoteColumn ? 1 : 0) +
    1 +
    1 +
    1 +
    (showStartTimeColumn ? 1 : 0);

  const scheduleCellByStaffDate = useMemo(() => {
    const next = new Map<string, AgencyWeekSchedule['employees'][number]['days'][number]>();
    for (const row of weekSchedule?.employees ?? []) {
      for (const day of row.days) {
        if (!row.staff_id || !day.work_date) continue;
        next.set(`${row.staff_id}__${day.work_date}`, day);
      }
    }
    return next;
  }, [weekSchedule]);

  const weekEmployeeByStaffId = useMemo(() => {
    const next = new Map<string, AgencyWeekSchedule['employees'][number]>();
    for (const row of weekSchedule?.employees ?? []) {
      if (!row.staff_id) continue;
      next.set(row.staff_id, row);
    }
    return next;
  }, [weekSchedule]);

  const openSubstituteSlotsByStaffDate = useMemo(() => {
    const next = new Map<string, number>();
    for (const row of weekSchedule?.employees ?? []) {
      for (const day of row.days) {
        next.set(`${row.staff_id}__${day.work_date}`, Number(day.substitute_open_count ?? 0) || 0);
      }
    }
    return next;
  }, [weekSchedule]);

  const weeklyWorkCountByStaffId = useMemo(() => {
    const next = new Map<string, number>();
    for (const row of weekSchedule?.employees ?? []) {
      const workCount = row.days.filter((day) => isWorklikeState((day.base_state ?? day.state) as AgencyScheduleState)).length;
      next.set(row.staff_id, workCount);
    }
    return next;
  }, [weekSchedule]);

  const employeeRows = useMemo<AgencyEmployeeRow[]>(
    () =>
      (weekSchedule?.employees ?? []).map((row) => ({
        agencyStatus: (() => {
          const readinessPosition = normalizeDailyListLightPosition(row.position);
          if (!readinessPosition) return 'wait_confirm' as const;
          return dailyListLightFlags[readinessPosition] ? ('ready' as const) : ('wait_confirm' as const);
        })(),
        staff_id: row.staff_id,
        name: row.name,
        agency: row.agency,
        position: row.position,
        shift: row.shift,
        start_time: row.start_time,
        label: row.label,
        state: row.days.find((item) => item.work_date === selectedDate)?.state ?? 'rest',
        fixed_work_count: weeklyWorkCountByStaffId.get(row.staff_id) ?? row.fixed_work_count,
        has_absent: absentMarkKeys.has(`${row.staff_id}__${selectedDate}`),
        has_late: false,
        termination_status: row.termination_status,
        driver_group_code: row.driver_group_code,
        driver_group_role: row.driver_group_role,
        driver_group_label: row.driver_group_label,
        agency_note: row.agency_note
      })),
    [absentMarkKeys, dailyListLightFlags, selectedDate, weekSchedule, weeklyWorkCountByStaffId]
  );

  const driverGroupSummaries = useMemo(() => weekSchedule?.driver_groups ?? [], [weekSchedule]);

  const nextDriverGroupCode = useMemo(() => getNextDriverGroupCode(driverGroupSummaries), [driverGroupSummaries]);

  const driverGroupWarnings = useMemo(
    () => buildDriverGroupWarnings(weekSchedule?.employees ?? []),
    [weekSchedule]
  );

  const driverGroupEmployeeOptions = useMemo(
    () =>
      employeeRows
        .filter((employee) => employee.termination_status !== 'pending')
        .map((employee) => ({
          staffId: employee.staff_id,
          label: `${employee.name || employee.staff_id} (${employee.staff_id})`,
          groupCode: employee.driver_group_code
        })),
    [employeeRows]
  );

  const selectedDateNewHireRequests = useMemo<AgencyNewHireRequestRow[]>(
    () =>
      (weekSchedule?.new_hire_requests ?? [])
        .filter((row) => row.work_date === selectedDate)
        .map((row) => ({
          staff_id: row.staff_id,
          name: row.name,
          agency: row.agency,
          position: row.position,
          shift: row.shift,
          start_time: row.start_time,
          label: row.label,
          state: '',
          can_delete: row.can_delete
        })),
    [selectedDate, weekSchedule]
  );

  const getCellOptions = useCallback(
    (
      employee: AgencyEmployeeRow,
      state: AgencyScheduleState,
      baseState: AgencyScheduleState,
      workDate: string
    ): SchedulePickerOption[] => {
      if (employee.termination_status === 'pending') return [];
      if (isAgencyScheduleCutoffPassed(employee.shift, workDate, newYorkNowContext)) return [];
      if (state === 'leave_pending' && (baseState === 'work' || baseState === 'fixed_work' || baseState === 'temp_work' || baseState === 'planned_temp_work')) {
        return [
          {
            key: baseState,
            label: `Restore ${stateLabel(baseState)}`,
            cls: stateCellClass(baseState, false)
          }
        ];
      }
      const options: SchedulePickerOption[] = [];
      if (canRequestAgencyLeave(state) && !isAgencyLeaveCutoffPassed(employee.shift, workDate, newYorkNowContext)) {
        options.push({ key: 'planned_leave', label: 'Leave', cls: 'bg-amber-500 text-slate-950' });
      }
      if (state === 'temp_work' || state === 'planned_temp_work') {
        options.push({
          key: state === 'planned_temp_work' ? 'planned_temp_rest' : 'temp_rest',
          label: 'Off',
          cls: 'bg-slate-600 text-white'
        });
      }
      const openSlots = openSubstituteSlotsByStaffDate.get(`${employee.staff_id}__${workDate}`) ?? 0;
      if (canAssignAgencySubstitute(state) && employee.fixed_work_count < 5 && openSlots > 0) {
        const isFuture = workDate > newYorkNowContext.date;
        options.push({
          key: isFuture ? 'planned_temp_work' : 'temp_work',
          label: isFuture ? 'Replacement' : 'Temp Work',
          cls: isFuture ? 'bg-emerald-500 text-white' : 'bg-emerald-700 text-white'
        });
      }
      return options;
    },
    [newYorkNowContext, openSubstituteSlotsByStaffDate]
  );

  const agencyOptions = useMemo(
    () => Array.from(new Set(employeeRows.map((employee) => String(employee.agency ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [employeeRows]
  );

  const positionOptions = useMemo(
    () =>
      Array.from(new Set(employeeRows.map((employee) => String(employee.position ?? '').trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [employeeRows]
  );

  const activeFilterQuery = deferredSearchQuery.trim().toLowerCase();

  const filteredEmployees = useMemo(() => {
    return employeeRows.filter((employee) => {
      if (agencyFilter !== 'all' && employee.agency !== agencyFilter) return false;
      if (positionFilter !== 'all' && employee.position !== positionFilter) return false;
      if (shiftFilter !== 'all' && employee.shift !== shiftFilter) return false;
      if (!activeFilterQuery) return true;
      const name = String(employee.name ?? '').toLowerCase();
      const staffId = String(employee.staff_id ?? '').toLowerCase();
      return name.includes(activeFilterQuery) || staffId.includes(activeFilterQuery);
    });
  }, [activeFilterQuery, agencyFilter, employeeRows, positionFilter, shiftFilter]);

  const [visibleEmployeeCount, setVisibleEmployeeCount] = useState(EMPLOYEE_RENDER_PAGE_SIZE);

  useEffect(() => {
    setVisibleEmployeeCount(EMPLOYEE_RENDER_PAGE_SIZE);
  }, [filteredEmployees.length]);

  const visibleFilteredEmployees = useMemo(
    () => filteredEmployees.slice(0, visibleEmployeeCount),
    [filteredEmployees, visibleEmployeeCount]
  );

  const dailyCountsByDate = useMemo(() => {
    const next = new Map<string, { work: number; temp: number; replacement: number }>();
    for (const workDate of weekDates) {
      next.set(workDate, { work: 0, temp: 0, replacement: 0 });
    }
    for (const employee of filteredEmployees) {
      for (const workDate of weekDates) {
        const state =
          scheduleStateOverrides.get(`${employee.staff_id}__${workDate}`) ??
          scheduleCellByStaffDate.get(`${employee.staff_id}__${workDate}`)?.state ??
          'rest';
        const current = next.get(workDate) ?? { work: 0, temp: 0, replacement: 0 };
        if (isReplacementState(state)) {
          current.replacement += 1;
          current.work += 1;
          next.set(workDate, current);
          continue;
        }
        if (isCurrentTempWorkState(state)) {
          current.temp += 1;
          current.work += 1;
          next.set(workDate, current);
          continue;
        }
        if (!isWorklikeState(state)) continue;
        current.work += 1;
        next.set(workDate, current);
      }
    }
    return next;
  }, [filteredEmployees, scheduleCellByStaffDate, scheduleStateOverrides, weekDates]);

  const selectedDateWorkExportRows = useMemo(() => {
    return filteredEmployees
      .map((employee) => {
        const overrideKey = `${employee.staff_id}__${selectedDate}`;
        const cell = scheduleCellByStaffDate.get(overrideKey);
        const state = scheduleStateOverrides.get(overrideKey) ?? cell?.state ?? 'rest';
        if (!isWorklikeState(state)) return null;
        const hasAbsentMark = absentMarkKeys.has(overrideKey);
        const showLiveAbsent = shouldShowAgencyLiveAbsent({
          shift: employee.shift,
          workDate: selectedDate,
          state,
          operationalDate: operationalNowContext.operationalDate,
          currentMinutes: operationalNowContext.minutes,
          hasPunch: currentOperationalPunchStaffIds.has(employee.staff_id)
        });
        if (hasAbsentMark || showLiveAbsent) return null;
        return {
          staffId: employee.staff_id,
          name: String(employee.name ?? '').trim(),
          agency: String(employee.agency ?? '').trim(),
          position: String(employee.position ?? '').trim(),
          shift: shiftLabel(employee.shift),
          startTime: formatStartTime(employee.start_time),
          state: stateLabel(state)
        };
      })
      .filter((row): row is {
        staffId: string;
        name: string;
        agency: string;
        position: string;
        shift: string;
        startTime: string;
        state: string;
      } => row !== null);
  }, [
    absentMarkKeys,
    currentOperationalPunchStaffIds,
    filteredEmployees,
    operationalNowContext.minutes,
    operationalNowContext.operationalDate,
    scheduleCellByStaffDate,
    scheduleStateOverrides,
    selectedDate
  ]);

  const exportSelectedDateWorkList = useCallback(() => {
    const header = ['Date', 'USID', 'Name', 'Agency', 'Position', 'Shift', 'Start Time', 'State'];
    const rows = selectedDateWorkExportRows.map((row) => [
      selectedDate,
      row.staffId,
      row.name,
      row.agency,
      row.position,
      row.shift,
      row.startTime,
      row.state
    ]);
    const csv = [header, ...rows].map((line) => line.map(toCsvCell).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `agency-worklist-${selectedDate}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
    openNotice('info', `Exported ${rows.length} work records for ${selectedDate}.`, 'Export complete');
  }, [openNotice, selectedDate, selectedDateWorkExportRows]);

  const hasMoreEmployees = visibleFilteredEmployees.length < filteredEmployees.length;

  const filteredNewHireRequests = useMemo(
    () =>
      selectedDateNewHireRequests.filter((row) => {
        if (agencyFilter !== 'all' && row.agency !== agencyFilter) return false;
        if (positionFilter !== 'all' && row.position !== positionFilter) return false;
        if (shiftFilter !== 'all' && row.shift !== shiftFilter) return false;
        if (!activeFilterQuery) return true;
        const name = String(row.name ?? '').toLowerCase();
        const staffId = String(row.staff_id ?? '').toLowerCase();
        return name.includes(activeFilterQuery) || staffId.includes(activeFilterQuery);
      }),
    [activeFilterQuery, agencyFilter, positionFilter, selectedDateNewHireRequests, shiftFilter]
  );
  const filteredGapCount = useMemo(() => {
    const groupSlots = new Map<string, number>();
    for (const employee of filteredEmployees) {
      const groupKey = [employee.agency, employee.position, employee.shift].join('__');
      const openSlots = openSubstituteSlotsByStaffDate.get(`${employee.staff_id}__${selectedDate}`) ?? 0;
      groupSlots.set(groupKey, Math.max(groupSlots.get(groupKey) ?? 0, openSlots));
    }
    return Array.from(groupSlots.values()).reduce((total, value) => total + value, 0);
  }, [filteredEmployees, openSubstituteSlotsByStaffDate, selectedDate]);

  const hasOpenGapForSelectedDate = useMemo(
    () => filteredGapCount > 0,
    [filteredGapCount]
  );

  const gapsByGroupOnSelectedDate = useMemo(() => {
    const groupMap = new Map<string, { agency: string; position: string; shift: string; count: number }>();
    for (const employee of filteredEmployees) {
      const groupKey = [employee.agency, employee.position, employee.shift].join('__');
      const openSlots = openSubstituteSlotsByStaffDate.get(`${employee.staff_id}__${selectedDate}`) ?? 0;
      if (openSlots > 0) {
        groupMap.set(groupKey, { agency: employee.agency, position: employee.position, shift: employee.shift, count: openSlots });
      }
    }
    return Array.from(groupMap.values());
  }, [filteredEmployees, openSubstituteSlotsByStaffDate, selectedDate]);

  const newHireAgencyOptions = useMemo(() => {
    const fromGaps = Array.from(
      new Set(gapsByGroupOnSelectedDate.map((gap) => normalizeAgencyValue(gap.agency)).filter(Boolean))
    ).sort((a, b) => a.localeCompare(b));
    if (fromGaps.length > 0) return fromGaps;

    return Array.from(
      new Set(
        [...agencyOptions, ...(access?.managed_agencies ?? [])]
          .map((agency) => normalizeAgencyValue(agency))
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
  }, [access?.managed_agencies, agencyOptions, gapsByGroupOnSelectedDate]);

  const newHireGapGroups = useMemo(() => {
    const scoped = gapsByGroupOnSelectedDate.filter((gap) => gap.agency === newHireForm.agency);
    return scoped.length ? scoped : gapsByGroupOnSelectedDate;
  }, [gapsByGroupOnSelectedDate, newHireForm.agency]);

  const newHirePositionOptions = useMemo(
    () => Array.from(new Set(newHireGapGroups.map((gap) => String(gap.position ?? '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)),
    [newHireGapGroups]
  );

  const newHireShiftOptions = useMemo(() => {
    const scoped = newHireGapGroups.filter((gap) => gap.position === newHireForm.position);
    const shifts = Array.from(new Set(scoped.map((gap) => normalizeAgencyShift(String(gap.shift ?? ''))))) as AgencyShift[];
    return shifts.length ? shifts : (['early', 'late'] as AgencyShift[]);
  }, [newHireGapGroups, newHireForm.position]);

  const newHireSelectedOpenSlots = useMemo(() => {
    const matched = gapsByGroupOnSelectedDate.find(
      (gap) =>
        String(gap.agency ?? '').trim() === String(newHireForm.agency ?? '').trim() &&
        String(gap.position ?? '').trim() === String(newHireForm.position ?? '').trim() &&
        normalizeAgencyShift(String(gap.shift ?? '')) === newHireForm.shift
    );
    return Number(matched?.count ?? 0) || 0;
  }, [gapsByGroupOnSelectedDate, newHireForm.agency, newHireForm.position, newHireForm.shift]);

  useEffect(() => {
    if (modal !== 'new_hire' || selectedNewHire || newHireForm.lockedAgency) return;
    if (newHireAgencyOptions.length === 0) return;
    if (newHireAgencyOptions.includes(newHireForm.agency)) return;
    setNewHireForm((prev) => ({ ...prev, agency: newHireAgencyOptions[0] }));
  }, [modal, newHireAgencyOptions, newHireForm.agency, newHireForm.lockedAgency, selectedNewHire]);

  useEffect(() => {
    if (modal !== 'new_hire' || selectedNewHire || newHireForm.lockedPosition) return;
    if (newHirePositionOptions.length === 0) return;
    const nextPosition = newHirePositionOptions.includes(newHireForm.position) ? newHireForm.position : newHirePositionOptions[0];
    const scopedShifts = newHireGapGroups
      .filter((gap) => gap.position === nextPosition)
      .map((gap) => normalizeAgencyShift(String(gap.shift ?? '')));
    const shiftOptions = Array.from(new Set(scopedShifts));
    const nextShift = shiftOptions.includes(newHireForm.shift) ? newHireForm.shift : (shiftOptions[0] ?? newHireForm.shift);
    if (nextPosition === newHireForm.position && nextShift === newHireForm.shift) return;
    setNewHireForm((prev) => ({
      ...prev,
      position: nextPosition,
      shift: nextShift
    }));
  }, [
    modal,
    selectedNewHire,
    newHireForm.lockedPosition,
    newHireForm.position,
    newHireForm.shift,
    newHirePositionOptions,
    newHireGapGroups
  ]);

  const derivedSummaryCards = useMemo(
    () =>
      computeAgencySummaryCards({
        employees: filteredEmployees,
        newHireRequests: filteredNewHireRequests,
        openSlotsByStaffDate: openSubstituteSlotsByStaffDate,
        selectedDate
      }),
    [filteredEmployees, filteredNewHireRequests, openSubstituteSlotsByStaffDate, selectedDate]
  );

  const summaryCards = useMemo(() => derivedSummaryCards, [derivedSummaryCards]);

  const summaryCardValues = useMemo(() => {
    const getValue = (key: string) => Number(summaryCards.find((card) => card.key === key)?.value ?? 0) || 0;
    return {
      required: getValue('required'),
      scheduled: getValue('scheduled'),
      gap: getValue('gap')
    };
  }, [summaryCards]);

  const useCompactNewSection = gapsByGroupOnSelectedDate.length > 0 && filteredNewHireRequests.length === 0;
  const selectedNoteStaffId = selectedNoteEmployee?.staff_id ?? '';
  const selectedNoteDraft = selectedNoteStaffId ? (noteDrafts[selectedNoteStaffId] ?? selectedNoteEmployee?.agency_note ?? '') : '';
  const selectedNoteDirty =
    Boolean(selectedNoteEmployee) && normalizeAgencyNote(selectedNoteDraft) !== normalizeAgencyNote(selectedNoteEmployee?.agency_note);
  const selectedNoteSaving = selectedNoteStaffId ? savingNoteStaffIds.has(selectedNoteStaffId) : false;
  const selectedDriverGroupEmployee = driverGroupForm.sourceStaffId
    ? employeeRows.find((employee) => employee.staff_id === driverGroupForm.sourceStaffId) ?? null
    : null;
  const canSetSelectedDriverGroupIndividual = Boolean(selectedDriverGroupEmployee?.driver_group_code);

  if (!supabase) {
    return <div className="min-h-screen px-6 py-10 text-white">Missing Supabase configuration.</div>;
  }

  return (
    <div className="min-h-screen px-5 py-8 text-paper">
      <div className="mx-auto flex max-w-[1480px] flex-col gap-6">
        <header className={cardClass}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.28em] text-slate-400">OBP Agency</div>
              <h1 className="mt-4 font-display text-5xl tracking-[0.04em] text-white">Agency Board</h1>
              <div className="mt-3 text-sm text-slate-400">{displayName || user?.email || 'Signed out'}</div>
            </div>
            {user ? (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void doLogout()} className={buttonClass} disabled={busy}>
                  Logout
                </button>
              </div>
            ) : null}
          </div>
        </header>

        {!user ? (
          <div className="flex flex-1 items-center py-4 md:min-h-[calc(100vh-240px)] md:py-8">
            <LoginPanel email={email} password={password} setEmail={setEmail} setPassword={setPassword} onLogin={doLogin} busy={busy} />
          </div>
        ) : null}

        {user && accessLoading ? (
          <section className={cardClass}>
            <div className="text-sm text-slate-400">Checking access...</div>
          </section>
        ) : null}

        {user && !accessLoading && !canViewAgency ? (
          <section className={cardClass}>
            <div className="text-sm text-rose-200">This account does not have access to the Agency module.</div>
          </section>
        ) : null}

        {user && !accessLoading && canViewAgency && weekSchedule ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
              {summaryCards.map((card) => (
                <div
                  key={card.key}
                  className={[
                    cardClass,
                    summaryCardStatusClass(card.key, Number(card.value ?? 0) || 0, summaryCardValues)
                  ].join(' ')}
                >
                  <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">{card.label}</div>
                  <div className="mt-4 text-4xl font-semibold text-white">{card.value}</div>
                </div>
              ))}
            </section>

            {board?.attendance_cards?.length ? (
              <section className="grid gap-4 md:grid-cols-3">
                {board.attendance_cards.map((card) => (
                  <div key={card.key} className={cardClass}>
                    <div className="text-[11px] uppercase tracking-[0.24em] text-slate-400">{card.label}</div>
                    <div className="mt-4 text-4xl font-semibold text-white">{card.value}</div>
                  </div>
                ))}
              </section>
            ) : null}

            <section className={[cardClass, useCompactNewSection ? 'w-fit max-w-full self-start' : ''].join(' ')}>
              <div>
                <div className="mb-4 flex items-center justify-between gap-4">
                  <h2 className="font-display text-3xl tracking-[0.04em] text-white">NEW</h2>
                </div>
                <div className="space-y-3">
                  {gapsByGroupOnSelectedDate.length > 0 ? (
                    <div className={useCompactNewSection ? 'grid w-fit gap-3' : 'grid gap-3 md:grid-cols-2 lg:grid-cols-3'}>
                      {gapsByGroupOnSelectedDate.map((gap, idx) => (
                        <div
                          key={`${gap.agency}__${gap.position}__${gap.shift}__${idx}`}
                          className={[
                            'rounded-[18px] border border-white/10 bg-white/[0.03] p-4',
                            useCompactNewSection ? 'min-w-[470px] max-w-[470px]' : ''
                          ].join(' ')}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="flex-1">
                              <div className="text-sm font-semibold text-white">Need Replacement</div>
                              <div className="mt-1 text-sm text-slate-300">{gap.agency}</div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <span className={['inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]', positionChipClass(gap.position)].join(' ')}>
                                  {gap.position}
                                </span>
                                <span className={['inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-semibold', shiftChipClass(normalizeAgencyShift(String(gap.shift ?? 'early')))].join(' ')}>
                                  {shiftLabel(normalizeAgencyShift(String(gap.shift ?? 'early')))}
                                </span>
                              </div>
                              <div className="mt-2 text-xs text-slate-400">Needed: {gap.count}</div>
                            </div>
                            <button
                              type="button"
                              className={neonButtonClass}
                              disabled={busy || !canOperateAgency}
                              onClick={() => openCreateNewHire(gap.agency, gap.position, gap.shift as 'early' | 'late')}
                            >
                              + Add
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {filteredNewHireRequests.length === 0 && gapsByGroupOnSelectedDate.length === 0 ? <div className="text-sm text-slate-400">No new requests.</div> : null}
                  {filteredNewHireRequests.length > 0 ? (
                    <div className="overflow-x-auto rounded-[22px] border border-white/10 bg-white/[0.03]">
                      <div className="min-w-[900px]">
                        <div className="grid grid-cols-[minmax(180px,2fr)_minmax(110px,1fr)_minmax(110px,1fr)_minmax(110px,1fr)_96px_180px] items-center gap-3 px-4 py-2 text-[11px] uppercase tracking-[0.16em] text-slate-400">
                          <div>Name</div>
                          <div>Agency</div>
                          <div>Position</div>
                          <div>Shift</div>
                          <div className="text-center">Start Time</div>
                          <div className="text-right">Actions</div>
                        </div>
                        <div className="h-px bg-white/10" />
                        {filteredNewHireRequests.map((row) => (
                          <div key={row.staff_id} className="grid grid-cols-[minmax(180px,2fr)_minmax(110px,1fr)_minmax(110px,1fr)_minmax(110px,1fr)_96px_180px] items-center gap-3 px-4 py-4">
                            <div className="min-w-0 text-sm text-slate-100">
                              <span className="block truncate">{String(row.name ?? '').trim() || '-'}</span>
                            </div>
                            <div>
                              <span className="inline-flex max-w-full items-center rounded-full border border-cyan-400/35 bg-cyan-500/10 px-3 py-1 text-sm text-cyan-200">
                                <span className="truncate">{row.agency || '-'}</span>
                              </span>
                            </div>
                            <div>
                              <span className={[
                                'inline-flex items-center rounded-full border px-3 py-1 text-sm',
                                positionChipClass(row.position)
                              ].join(' ')}>
                                {row.position || '-'}
                              </span>
                            </div>
                            <div>
                              <span className={[
                                'inline-flex items-center rounded-full border px-3 py-1 text-sm',
                                shiftChipClass(row.shift)
                              ].join(' ')}>
                                {shiftLabel(row.shift)}
                              </span>
                            </div>
                            <div className="text-center font-mono text-sm text-slate-300">
                              {formatNewHireStartTime(row.start_time)}
                            </div>
                            <div className="flex items-center justify-end gap-2">
                              <button type="button" className={buttonClass} disabled={busy || !canOperateAgency} onClick={() => openEditNewHire(row)}>
                                Edit
                              </button>
                              {row.can_delete ? (
                              <button
                                type="button"
                                className="inline-flex h-10 items-center justify-center rounded-2xl border border-rose-300/30 bg-rose-500/10 px-4 text-sm font-medium text-rose-200 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={busy || !canOperateAgency}
                                onClick={() => void deleteNewHire(row)}
                              >
                                Delete
                              </button>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </section>

            <section className={cardClass}>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
                <h2 className="font-display text-3xl tracking-[0.04em] text-white">Employees</h2>
                {user ? (
                  <div className="flex w-full flex-wrap items-center gap-3 md:w-auto md:justify-end">
                    <input
                      type="date"
                      value={selectedDate}
                      onChange={(event) => setSelectedDate(event.target.value)}
                      className={[inputClass, 'w-full min-w-0 md:w-[196px] md:shrink-0'].join(' ')}
                    />
                    <button
                      type="button"
                      onClick={exportSelectedDateWorkList}
                      className={buttonClass}
                      disabled={busy || !canViewAgency || selectedDateWorkExportRows.length === 0}
                    >
                      Export Work List
                    </button>
                    <button type="button" onClick={() => void refreshBoard()} className={buttonClass} disabled={busy || !canViewAgency}>
                      Refresh
                    </button>
                    <button type="button" onClick={() => void doLogout()} className={buttonClass} disabled={busy}>
                      Logout
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search Name / USID"
                  className={inputClass}
                />
                <select value={agencyFilter} onChange={(event) => setAgencyFilter(event.target.value)} className={inputClass}>
                  <option value="all">All Agency</option>
                  {agencyOptions.map((agency) => (
                    <option key={agency} value={agency}>
                      {agency}
                    </option>
                  ))}
                </select>
                <select value={positionFilter} onChange={(event) => setPositionFilter(event.target.value)} className={inputClass}>
                  <option value="all">All Position</option>
                  {positionOptions.map((position) => (
                    <option key={position} value={position}>
                      {position}
                    </option>
                  ))}
                </select>
                <select value={shiftFilter} onChange={(event) => setShiftFilter((event.target.value as 'all' | 'early' | 'late') || 'all')} className={inputClass}>
                  <option value="all">All Shift</option>
                  <option value="early">Morning</option>
                  <option value="late">Night</option>
                </select>
              </div>
              <div className="mb-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Users className="h-4 w-4 text-cyan-200" />
                    <span>Driver Groups</span>
                  </div>
                  <button
                    type="button"
                    className={neonButtonClass}
                    disabled={busy || !canOperateAgency || driverGroupEmployeeOptions.length < 2}
                    onClick={() => openDriverGroupModal()}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    New
                  </button>
                </div>
                {driverGroupWarnings.length > 0 ? (
                  <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                    {driverGroupWarnings.map((warning) => (
                      <div key={warning.code}>{warning.message} {warning.staffIds.join(', ')}</div>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {driverGroupSummaries.length > 0 ? (
                    driverGroupSummaries.map((group) => (
                      <div key={group.code} className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/25 px-3 py-2">
                        <button
                          type="button"
                          className="text-sm font-semibold text-white transition hover:text-cyan-100"
                          disabled={!canOperateAgency}
                          onClick={() => openDriverGroupModal(group.code)}
                        >
                          Group {group.code}
                        </button>
                        <span className="text-xs text-slate-400">{group.activeMemberCount}</span>
                        <button
                          type="button"
                          className="rounded-lg p-1 text-slate-400 transition hover:bg-white/10 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={busy || !canOperateAgency}
                          onClick={() => requestDeleteDriverGroup(group.code)}
                          aria-label={`Delete driver group ${group.code}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-slate-400">No groups.</div>
                  )}
                </div>
              </div>
              <div className={[
                'overflow-x-auto rounded-2xl border border-white/10 bg-black/30 py-1',
                compactScheduleView ? 'px-2' : ''
              ].join(' ')}>
                <table className={[compactScheduleView ? 'min-w-full' : 'min-w-[1600px]', 'w-full table-fixed text-left text-xs leading-tight'].join(' ')}>
                  <thead className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/95 text-[10px] uppercase tracking-[0.16em] text-slate-400 backdrop-blur">
                    <tr>
                      {showIdColumn ? <th className="w-[104px] py-2 pl-4 pr-1">ID</th> : null}
                      <th className={[compactScheduleView ? 'w-[206px]' : 'w-[184px]', 'px-1 py-2'].join(' ')}>Name</th>
                      {showAgencyColumn ? <th className="w-[92px] px-1 py-2">Agency</th> : null}
                      {showDriverGroupColumn ? <th className="w-[80px] px-1 py-2 text-center">Group</th> : null}
                      {showNoteColumn ? <th className="w-[180px] px-1 py-2">Note</th> : null}
                      <th className={[compactScheduleView ? 'w-[88px]' : 'w-[96px]', 'px-1 py-2'].join(' ')}>Position</th>
                      <th className={[compactScheduleView ? 'w-[66px]' : 'w-[72px]', 'px-1 py-2 text-center'].join(' ')}>Shift</th>
                      <th className={[compactScheduleView ? 'w-[128px]' : 'w-[152px]', 'px-1 py-2 text-center'].join(' ')}>Status</th>
                      {showStartTimeColumn ? <th className="w-[86px] px-1 py-2 text-center">Start time</th> : null}
                      {visibleWeekDates.map((workDate) => (
                        <th
                          key={workDate}
                          className={[
                            compactScheduleView ? 'w-[78px] px-0.5 py-2 text-center' : 'w-[86px] px-0.5 py-2 text-center',
                            workDate === selectedDate
                              ? selectedDateHeaderColumnClass
                              : ''
                          ].join(' ')}
                        >
                              <div className="flex flex-col items-center gap-1">
                                <span className={workDate === selectedDate ? selectedDateHeaderLabelClass : ''}>{formatWeekLabel(workDate, weekDates.indexOf(workDate))}</span>
                                <span className="text-[11px] font-semibold normal-case tracking-normal text-[#9eff00]">
                              Work {dailyCountsByDate.get(workDate)?.work ?? 0}
                                </span>
                              </div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.length === 0 ? (
                      <tr>
                        <td colSpan={fixedScheduleColumnCount + visibleWeekDates.length} className="px-4 py-8 text-center text-sm text-slate-400">
                          No matches.
                        </td>
                      </tr>
                    ) : null}
                    {visibleFilteredEmployees.map((employee, employeeIndex) => {
                      const weekEmployee = weekEmployeeByStaffId.get(employee.staff_id);
                      const isPendingTermination = employee.termination_status === 'pending' || weekEmployee?.termination_status === 'pending';
                      const isSavingNote = savingNoteStaffIds.has(employee.staff_id);
                      const isLastEmployeeRow = employeeIndex === visibleFilteredEmployees.length - 1;
                      const rowClass = isPendingTermination
                        ? 'border-b border-white/5 bg-slate-800/60 transition-colors hover:bg-slate-800/70 last:border-b-0'
                        : 'border-b border-white/5 transition-colors hover:bg-white/[0.04] last:border-b-0';
                      return (
                      <tr key={employee.staff_id} className={rowClass}>
                        {showIdColumn ? <td className="py-2 pl-4 pr-1 font-mono text-slate-200">{employee.staff_id}</td> : null}
                        <td className="px-1 py-2 text-slate-200">
                          <div className="truncate font-medium" title={employee.agency_note ? `${employee.name || '-'}\n${employee.agency_note}` : employee.name || '-'}>
                            {employee.name || '-'}
                          </div>
                          <div className="mt-1 flex min-h-[38px] flex-col items-start justify-center gap-1">
                            {isPendingTermination ? (
                              <>
                                <button
                                  type="button"
                                  className="rounded-md border border-amber-400/40 bg-amber-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200 transition hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                                  disabled={busy || !canOperateAgency}
                                  onClick={() => requestCancelTermination(employee)}
                                >
                                  Withdraw
                                </button>
                                <span className="text-[10px] uppercase tracking-[0.16em] text-slate-400">Pending departure</span>
                              </>
                            ) : canOperateAgency ? (
                              <button
                                type="button"
                                className="text-[10px] uppercase tracking-[0.16em] text-rose-300 transition hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
                                disabled={busy}
                                onClick={() => openTerminationModal(employee)}
                              >
                                Depart
                              </button>
                            ) : null}
                          </div>
                        </td>
                        {showAgencyColumn ? <td className="truncate px-1 py-2 text-slate-300">{employee.agency || '-'}</td> : null}
                        {showDriverGroupColumn ? (
                          <td className="px-1 py-2 text-center">
                            <select
                              value={employee.driver_group_code ? `group:${employee.driver_group_code}` : 'individual'}
                              className={[
                                'h-8 max-w-32 rounded-full border px-2 text-[10px] font-semibold outline-none transition disabled:cursor-not-allowed disabled:opacity-50',
                                employee.driver_group_role === 'driver'
                                  ? 'border-cyan-300/40 bg-cyan-500/15 text-cyan-100'
                                  : employee.driver_group_label
                                    ? 'border-white/12 bg-white/[0.05] text-slate-200'
                                    : 'border-emerald-300/25 bg-emerald-500/10 text-emerald-100'
                              ].join(' ')}
                              disabled={!canOperateAgency || busy}
                              onChange={(event) => void selectEmployeeDriverGroup(employee, event.target.value)}
                              title={employee.driver_group_label ? `Group ${employee.driver_group_label}` : 'Individual'}
                            >
                              <option value="individual">Individual</option>
                              {driverGroupSummaries.map((group) => (
                                <option key={group.code} value={`group:${group.code}`}>
                                  {group.labels.length > 0 ? group.labels.join(' / ') : `Group ${group.code}`}
                                </option>
                              ))}
                              <option value="new">New group</option>
                            </select>
                          </td>
                        ) : null}
                        {showNoteColumn ? (
                          <td className="px-1 py-2">
                              <button
                                type="button"
                                className={[
                                  'inline-flex h-8 max-w-full items-center justify-center rounded-lg border px-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
                                  employee.agency_note
                                    ? 'border-cyan-300/30 bg-cyan-500/10 text-cyan-100 hover:bg-cyan-500/15'
                                    : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                                ].join(' ')}
                                disabled={isSavingNote}
                                onClick={() => openNoteModal(employee)}
                                title={employee.agency_note || 'Note'}
                              >
                                <span className="truncate">{employee.agency_note ? 'View' : 'Add'}</span>
                              </button>
                          </td>
                        ) : null}
                        <td className="px-1 py-2">
                          <span className={['inline-flex max-w-full items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]', positionChipClass(employee.position)].join(' ')}>
                            <span className="truncate">{employee.position || '-'}</span>
                          </span>
                        </td>
                        <td className="px-1 py-2 text-center">
                          <span className={['inline-flex items-center justify-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold', shiftChipClass(employee.shift)].join(' ')}>
                            {shiftLabel(employee.shift)}
                          </span>
                        </td>
                        <td className="px-1 py-2 text-center">
                          <span
                            className={[
                              'inline-flex items-center justify-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[0.04em]',
                              agencyStatusChipClass(employee.agencyStatus)
                            ].join(' ')}
                          >
                            {employee.agencyStatus === 'ready' ? <Check className="h-3.5 w-3.5" /> : <Hourglass className="h-3.5 w-3.5" />}
                            <span>{agencyStatusLabel(employee.agencyStatus)}</span>
                          </span>
                        </td>
                        {showStartTimeColumn ? (
                          <td className="px-1 py-2 text-center font-mono text-slate-300">
                            {formatStartTime(employee.start_time)}
                          </td>
                        ) : null}
                        {visibleWeekDates.map((workDate) => {
                          const cell = scheduleCellByStaffDate.get(`${employee.staff_id}__${workDate}`);
                          const state = scheduleStateOverrides.get(`${employee.staff_id}__${workDate}`) ?? cell?.state ?? 'rest';
                          const hasAbsentMark = absentMarkKeys.has(`${employee.staff_id}__${workDate}`);
                          const showLiveAbsent = shouldShowAgencyLiveAbsent({
                            shift: employee.shift,
                            workDate,
                            state,
                            operationalDate: operationalNowContext.operationalDate,
                            currentMinutes: operationalNowContext.minutes,
                            hasPunch: currentOperationalPunchStaffIds.has(employee.staff_id)
                          });
                          const baseState = cell?.base_state ?? state;
                          const isSelectedWorkDate = workDate === selectedDate;
                          const cellOptions = canOperateAgency ? getCellOptions(employee, state, baseState, workDate) : [];
                          const canEditCell = cellOptions.length > 0;
                          const isDeadlineLocked = isAgencyDeadlineLockedState(employee.shift, workDate, newYorkNowContext);
                          return (
                            <ScheduleCell
                              key={`${employee.staff_id}__${workDate}`}
                              staffId={employee.staff_id}
                              employeeName={employee.name || '-'}
                              workDate={workDate}
                              state={state}
                              showAbsent={hasAbsentMark || showLiveAbsent}
                              isSelectedWorkDate={isSelectedWorkDate}
                              isLastEmployeeRow={isLastEmployeeRow}
                              cellOptions={cellOptions}
                              canEditCell={canEditCell}
                              isDeadlineLocked={isDeadlineLocked}
                              busy={busy}
                              selectedDateColumnClass={selectedDateColumnToneClass}
                              selectedDateLastRowClass={selectedDateLastRowClass}
                              onCellClick={handleScheduleCellClick}
                            />
                          );
                        })}
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
              {filteredEmployees.length > 0 ? (
                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-400">
                  <div>
                    Showing {visibleFilteredEmployees.length} / {filteredEmployees.length} employees
                  </div>
                  {hasMoreEmployees ? (
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={busy}
                      onClick={() => setVisibleEmployeeCount((current) => current + EMPLOYEE_RENDER_PAGE_SIZE)}
                    >
                      Load 80 more
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>

          </>
        ) : null}

      </div>

      {schedulePicker.open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            data-agency-schedule-popover="true"
            className="fixed z-[90] w-44 -translate-x-1/2 rounded-xl border border-white/10 bg-slate-950/95 p-1.5 shadow-2xl backdrop-blur"
            style={{ left: schedulePicker.anchorLeft, top: schedulePicker.anchorTop }}
          >
            {schedulePicker.options.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => void submitScheduleState(schedulePicker.staffId, schedulePicker.workDate, option.key)}
                className={[
                  'mb-1 flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs font-semibold transition hover:brightness-110 last:mb-0',
                  option.cls,
                  schedulePicker.currentState === option.key ? 'ring-2 ring-white/70' : ''
                ].join(' ')}
              >
                <span>{option.label}</span>
                {schedulePicker.currentState === option.key ? <span className="text-[10px] uppercase tracking-[0.16em]">Now</span> : null}
              </button>
            ))}
          </div>,
          document.body
        )}

      <Modal open={modal === 'new_hire'} title={selectedNewHire ? 'Edit NEW' : 'NEW'}>
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <input
              type="text"
              value={newHireForm.employeeName}
              onChange={(event) => setNewHireForm((prev) => ({ ...prev, employeeName: event.target.value }))}
              placeholder="Employee Name *"
              className={inputClass}
            />
            {newHireForm.lockedAgency && String(newHireForm.agency ?? '').trim() ? (
              <div className={[inputClass, 'flex items-center pl-3'].join(' ')}>
                <span className="text-white">{newHireForm.agency || '-'}</span>
              </div>
            ) : (
              <select
                value={newHireForm.agency}
                onChange={(event) => setNewHireForm((prev) => ({ ...prev, agency: event.target.value }))}
                className={inputClass}
              >
                {newHireAgencyOptions.map((agency) => (
                  <option key={agency} value={agency}>
                    {normalizeAgencyValue(agency) || '-'}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {newHireForm.lockedPosition ? (
              <div className={[inputClass, 'flex items-center pl-3'].join(' ')}>
                <span className="text-white">{newHireForm.position}</span>
              </div>
            ) : (
              <select
                value={newHireForm.position}
                onChange={(event) => setNewHireForm((prev) => ({ ...prev, position: event.target.value }))}
                className={inputClass}
              >
                {newHirePositionOptions.map((position) => (
                  <option key={position} value={position}>
                    {position}
                  </option>
                ))}
              </select>
            )}
            {newHireForm.lockedShift ? (
              <div className={[inputClass, 'flex items-center pl-3'].join(' ')}>
                <span className="text-white">{shiftLabel(newHireForm.shift)}</span>
              </div>
            ) : (
              <select
                value={newHireForm.shift}
                onChange={(event) => setNewHireForm((prev) => ({ ...prev, shift: event.target.value as AgencyShift }))}
                className={inputClass}
              >
                {newHireShiftOptions.map((shift) => (
                  <option key={shift} value={shift}>
                    {shiftLabel(shift)}
                  </option>
                ))}
              </select>
            )}
            <input
              value="09:00"
              type="text"
              className={inputClass}
              readOnly
              aria-label="Entry time"
            />
            {newHireForm.lockedWorkDate ? (
              <div className={[inputClass, 'flex items-center pl-3'].join(' ')}>
                <span className="text-white">{newHireForm.workDate}</span>
              </div>
            ) : (
              <input
                value={newHireForm.workDate}
                type="date"
                onChange={(event) => setNewHireForm((prev) => ({ ...prev, workDate: event.target.value }))}
                className={inputClass}
              />
            )}
          </div>
          {!selectedNewHire ? (
            <div className="text-xs text-slate-400">
              Available GAP for this selection:{' '}
              <span className={newHireSelectedOpenSlots > 0 ? 'text-emerald-300' : 'text-rose-300'}>{newHireSelectedOpenSlots}</span>
            </div>
          ) : null}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={closeModal} className={buttonClass}>Close</button>
          <button
            type="button"
            onClick={() => void submitNewHire()}
            className={neonButtonClass}
            disabled={
              busy ||
              !String(newHireForm.agency ?? '').trim() ||
              !String(newHireForm.position ?? '').trim() ||
              !String(newHireForm.employeeName ?? '').trim() ||
              (!selectedNewHire && newHireSelectedOpenSlots <= 0)
            }
          >
            Save
          </button>
        </div>
      </Modal>

      <Modal open={modal === 'termination'} title="Termination Request">
        <div className="space-y-4">
          <textarea value={terminationReason} onChange={(event) => setTerminationReason(event.target.value)} rows={4} className={[inputClass, 'h-auto py-3'].join(' ')} placeholder="Reason" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className={buttonClass}>Close</button>
            <button type="button" onClick={() => void submitTermination()} className={neonButtonClass} disabled={busy || !terminationReason.trim()}>
              Submit
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={modal === 'employee_note'} title="Note">
        <div className="space-y-4">
          <div className="text-sm font-semibold text-white">
            {selectedNoteEmployee ? `${selectedNoteEmployee.name || selectedNoteEmployee.staff_id} (${selectedNoteEmployee.staff_id})` : '-'}
          </div>
          <textarea
            value={selectedNoteDraft}
            maxLength={500}
            rows={7}
            disabled={!canOperateAgency || selectedNoteSaving}
            onChange={(event) => {
              const value = event.target.value;
              if (!selectedNoteStaffId) return;
              setNoteDrafts((previous) => ({ ...previous, [selectedNoteStaffId]: value }));
            }}
            className={[inputClass, 'h-auto resize-none py-3 leading-6'].join(' ')}
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeModal} className={buttonClass} disabled={selectedNoteSaving}>
              Close
            </button>
            <button
              type="button"
              onClick={() => {
                if (selectedNoteEmployee) void submitEmployeeNote(selectedNoteEmployee);
              }}
              className={neonButtonClass}
              disabled={!canOperateAgency || selectedNoteSaving || !selectedNoteDirty}
            >
              <Save className="mr-2 h-4 w-4" />
              Save
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={modal === 'driver_group'} title="Driver Group">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <input
              type="text"
              value={driverGroupForm.code}
              onChange={(event) => setDriverGroupForm((prev) => ({ ...prev, code: event.target.value.trim() }))}
              placeholder="Group"
              className={inputClass}
            />
            <select
              value={driverGroupForm.driverStaffId}
              onChange={(event) => {
                const driverStaffId = event.target.value;
                setDriverGroupForm((prev) => ({
                  ...prev,
                  driverStaffId,
                  memberStaffIds: Array.from(new Set([...prev.memberStaffIds, driverStaffId].filter(Boolean)))
                }));
              }}
              className={inputClass}
            >
              <option value="">Driver</option>
              {driverGroupEmployeeOptions.map((employee) => (
                <option key={employee.staffId} value={employee.staffId}>
                  {employee.label}
                </option>
              ))}
            </select>
          </div>
          <select
            multiple
            value={driverGroupForm.memberStaffIds}
            onChange={(event) => {
              const selected = Array.from(event.currentTarget.selectedOptions).map((option) => option.value);
              setDriverGroupForm((prev) => ({
                ...prev,
                memberStaffIds: Array.from(new Set([...selected, prev.driverStaffId].filter(Boolean)))
              }));
            }}
            className={[inputClass, 'h-56 py-3'].join(' ')}
          >
            {driverGroupEmployeeOptions.map((employee) => (
              <option key={employee.staffId} value={employee.staffId}>
                {employee.label}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {canSetSelectedDriverGroupIndividual ? (
            <button
              type="button"
              onClick={() => void submitDriverGroupIndividual()}
              className={buttonClass}
              disabled={busy || !canOperateAgency}
            >
              Individual
            </button>
          ) : null}
          <button type="button" onClick={closeModal} className={buttonClass}>Close</button>
          <button
            type="button"
            onClick={() => void submitDriverGroup()}
            className={neonButtonClass}
            disabled={busy || !driverGroupForm.code.trim() || !driverGroupForm.driverStaffId || driverGroupForm.memberStaffIds.length < 2}
          >
            Save
          </button>
        </div>
      </Modal>

      <Modal open={deleteNewHireConfirm !== null} title="Delete NEW">
        <div className="space-y-5">
          <p className="text-sm text-slate-300">
            Delete NEW request for{' '}
            <span className="font-semibold text-white">
              {deleteNewHireConfirm ? `${deleteNewHireConfirm.displayName} (${deleteNewHireConfirm.staffId})` : ''}
            </span>
            ?
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeDeleteNewHireConfirm} className={buttonClass} disabled={busy}>
              Close
            </button>
            <button type="button" onClick={() => void confirmDeleteNewHire()} className={neonButtonClass} disabled={busy}>
              Delete
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={deleteDriverGroupConfirm !== null} title="Delete Group">
        <div className="space-y-5">
          <p className="text-sm text-slate-300">
            Delete driver group{' '}
            <span className="font-semibold text-white">{deleteDriverGroupConfirm?.code ?? ''}</span>
            ?
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeDeleteDriverGroupConfirm} className={buttonClass} disabled={busy}>
              Close
            </button>
            <button type="button" onClick={() => void confirmDeleteDriverGroup()} className={neonButtonClass} disabled={busy}>
              Delete
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={cancelTerminationConfirm !== null} title="Withdraw Termination">
        <div className="space-y-5">
          <p className="text-sm text-slate-300">
            Withdraw termination request for{' '}
            <span className="font-semibold text-white">
              {cancelTerminationConfirm ? `${cancelTerminationConfirm.displayName} (${cancelTerminationConfirm.staffId})` : ''}
            </span>
            ?
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={closeCancelTerminationConfirm} className={buttonClass} disabled={busy}>
              Close
            </button>
            <button type="button" onClick={() => void confirmCancelTermination()} className={neonButtonClass} disabled={busy}>
              Withdraw
            </button>
          </div>
        </div>
      </Modal>

      {notice ? (
        <div className="fixed right-5 top-5 z-[105] w-[min(420px,calc(100vw-2.5rem))]">
          <div className="rounded-[24px] border border-rose-400/20 bg-slate-950/88 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.45)] backdrop-blur-xl">
            <div className="flex items-start gap-3">
              <div className="mt-1 h-2.5 w-2.5 rounded-full bg-rose-300 shadow-[0_0_18px_rgba(253,164,175,0.65)]" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white">{notice.title}</div>
                <div className="mt-1 text-sm leading-6 text-slate-300">{notice.message}</div>
              </div>
              <button type="button" onClick={() => setNotice(null)} className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 transition hover:text-white">
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <LoadingOverlay open={busy} label={busyLabel || 'Syncing board'} />
    </div>
  );
}
