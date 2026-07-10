import type { AgencyScheduleState } from './types';
import type { AgencyShift } from '../shared/agencyShared';
import { isAgencyWorklikeState } from './boardMetrics';

const LATE_SHIFT_LEGACY_ABSENT_MINUTES = 16 * 60 + 30;

const parseClockMinutes = (value: string) => {
  const match = String(value ?? '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
};

const resolveAbsentVisibleMinutes = ({
  shift,
  startTime,
  earlyShiftFallbackMinutes
}: {
  shift: AgencyShift | '';
  startTime: string;
  earlyShiftFallbackMinutes: number;
}) => {
  const startMinutes = parseClockMinutes(startTime);
  if (startMinutes !== null) return startMinutes;
  if (shift === 'late') return LATE_SHIFT_LEGACY_ABSENT_MINUTES;
  return earlyShiftFallbackMinutes;
};

export const shouldShowAgencyLiveAbsent = ({
  shift,
  startTime,
  workDate,
  state,
  operationalDate,
  currentMinutes,
  hasPunch,
  earlyShiftFallbackMinutes
}: {
  shift: AgencyShift | '';
  startTime: string;
  workDate: string;
  state: AgencyScheduleState;
  operationalDate: string;
  currentMinutes: number;
  hasPunch: boolean;
  earlyShiftFallbackMinutes: number;
}) => {
  if (!isAgencyWorklikeState(state)) return false;
  if (workDate !== operationalDate) return false;
  if (hasPunch) return false;
  return currentMinutes >= resolveAbsentVisibleMinutes({ shift, startTime, earlyShiftFallbackMinutes });
};

