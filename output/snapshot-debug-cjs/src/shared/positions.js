"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAttendanceTrackedPositionNames = exports.buildActivePositionNames = exports.resolvePositionName = exports.normalizePositionTone = exports.isHiddenPositionDepartment = exports.normalizePositionDepartment = exports.normalizePositionName = exports.DEFAULT_POSITION_NAMES = exports.POSITION_DEPARTMENTS = void 0;
const labelTone_1 = require("../lib/labelTone");
exports.POSITION_DEPARTMENTS = ['OB', 'IB', 'INV', 'hidden'];
exports.DEFAULT_POSITION_NAMES = ['Pick', 'Pack', 'Rebin', 'Preship', 'Transfer', 'Water Spider', 'FLEX TEAM'];
const normalizePositionName = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');
exports.normalizePositionName = normalizePositionName;
const normalizePositionDepartment = (value) => {
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
exports.normalizePositionDepartment = normalizePositionDepartment;
const isHiddenPositionDepartment = (value) => (0, exports.normalizePositionDepartment)(value) === 'hidden';
exports.isHiddenPositionDepartment = isHiddenPositionDepartment;
const normalizePositionTone = (value) => {
    const tone = String(value ?? '').trim();
    return labelTone_1.LABEL_TONE_KEYS.includes(tone) ? tone : 'slate';
};
exports.normalizePositionTone = normalizePositionTone;
const resolvePositionName = (value, positionNames) => {
    const trimmed = (0, exports.normalizePositionName)(value);
    if (!trimmed)
        return null;
    const direct = positionNames.find((position) => (0, exports.normalizePositionName)(position).toLowerCase() === trimmed.toLowerCase());
    if (direct)
        return (0, exports.normalizePositionName)(direct);
    const normalized = trimmed.toLowerCase();
    if (normalized === 'water spider' || normalized === 'waterspider' || normalized === 'water-spider') {
        return positionNames.find((position) => (0, exports.normalizePositionName)(position).toLowerCase() === 'water spider') ?? null;
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
        return positionNames.find((position) => (0, exports.normalizePositionName)(position).toLowerCase() === 'flex team') ?? null;
    }
    return null;
};
exports.resolvePositionName = resolvePositionName;
const buildActivePositionNames = (positions) => positions
    .filter((position) => position.is_active && (0, exports.normalizePositionName)(position.name))
    .sort((left, right) => {
    const orderDiff = Number(left.display_order ?? 0) - Number(right.display_order ?? 0);
    if (orderDiff !== 0)
        return orderDiff;
    return (0, exports.normalizePositionName)(left.name).localeCompare((0, exports.normalizePositionName)(right.name), 'en-US');
})
    .map((position) => (0, exports.normalizePositionName)(position.name));
exports.buildActivePositionNames = buildActivePositionNames;
const buildAttendanceTrackedPositionNames = (positions) => (0, exports.buildActivePositionNames)(positions.filter((position) => !(0, exports.isHiddenPositionDepartment)(position.department)));
exports.buildAttendanceTrackedPositionNames = buildAttendanceTrackedPositionNames;
