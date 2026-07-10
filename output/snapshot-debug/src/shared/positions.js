import { LABEL_TONE_KEYS } from '../lib/labelTone';
export const POSITION_DEPARTMENTS = ['OB', 'IB', 'INV', 'hidden'];
export const DEFAULT_POSITION_NAMES = ['Pick', 'Pack', 'Rebin', 'Preship', 'Transfer', 'Water Spider', 'FLEX TEAM'];
export const normalizePositionName = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
export const normalizePositionDepartment = (value) => {
    const text = String(value ?? '').trim().toLowerCase();
    if (text === 'ob')
        return 'OB';
    if (text === 'ib')
        return 'IB';
    if (text === 'inv' || text === 'inventory')
        return 'INV';
    if (text === 'hidden' || text === 'hide' || text === '隐藏')
        return 'hidden';
    return 'OB';
};
export const isHiddenPositionDepartment = (value) => normalizePositionDepartment(value) === 'hidden';
export const normalizePositionTone = (value) => {
    const tone = String(value ?? '').trim();
    return LABEL_TONE_KEYS.includes(tone) ? tone : 'slate';
};
export const resolvePositionName = (value, positionNames) => {
    const trimmed = normalizePositionName(value);
    if (!trimmed)
        return null;
    const direct = positionNames.find((position) => normalizePositionName(position).toLowerCase() === trimmed.toLowerCase());
    if (direct)
        return normalizePositionName(direct);
    const normalized = trimmed.toLowerCase();
    if (normalized === 'water spider' || normalized === 'waterspider' || normalized === 'water-spider') {
        return positionNames.find((position) => normalizePositionName(position).toLowerCase() === 'water spider') ?? null;
    }
    if (normalized === '兜底组' ||
        normalized === '兜底' ||
        normalized === 'flex team（机动组）' ||
        normalized === 'flex team' ||
        normalized === 'flexteam' ||
        normalized === 'wrap-up team' ||
        normalized === 'wrap up team' ||
        normalized === 'wrapup team' ||
        normalized === 'fallback' ||
        normalized === 'backup') {
        return positionNames.find((position) => normalizePositionName(position).toLowerCase() === 'flex team') ?? null;
    }
    return null;
};
export const buildActivePositionNames = (positions) => positions
    .filter((position) => position.is_active && normalizePositionName(position.name))
    .sort((left, right) => {
    const orderDiff = Number(left.display_order ?? 0) - Number(right.display_order ?? 0);
    if (orderDiff !== 0)
        return orderDiff;
    return normalizePositionName(left.name).localeCompare(normalizePositionName(right.name), 'en-US');
})
    .map((position) => normalizePositionName(position.name));
export const buildAttendanceTrackedPositionNames = (positions) => buildActivePositionNames(positions.filter((position) => !isHiddenPositionDepartment(position.department)));
