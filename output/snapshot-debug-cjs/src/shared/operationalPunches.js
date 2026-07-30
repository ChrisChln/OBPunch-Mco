"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isExactOperationalCutoffOut = void 0;
const isExactOperationalCutoffOut = (atRaw, actionRaw, cutoffHour) => {
    const at = new Date(atRaw);
    if (Number.isNaN(at.getTime()))
        return false;
    const action = String(actionRaw ?? '').trim().toUpperCase();
    return action === 'OUT' && at.getHours() === cutoffHour && at.getMinutes() === 0 && at.getSeconds() === 0;
};
exports.isExactOperationalCutoffOut = isExactOperationalCutoffOut;
