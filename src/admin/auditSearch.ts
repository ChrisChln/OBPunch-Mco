import { normalizeStaffId } from '../lib/staffId';
import { matchesLooseSearch } from '../lib/textSearch';
import type { AuditRow } from './types';

const collectSearchParts = (value: unknown, parts: string[], depth = 0) => {
  if (value === null || value === undefined || depth > 4) return;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    if (text) parts.push(text);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSearchParts(item, parts, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (key.trim()) parts.push(key);
      collectSearchParts(nestedValue, parts, depth + 1);
    }
  }
};

export type AuditSearchContext = {
  employeeName?: string;
  actionLabel?: string;
  detailSummary?: string;
  detailValues?: string[];
};

export const buildAuditSearchText = (row: AuditRow, context: AuditSearchContext = {}) => {
  const parts = [
    normalizeStaffId(String(row.staff_id ?? '').trim()),
    context.employeeName ?? '',
    String(row.actor ?? '').trim(),
    String((row as AuditRow & { actor_raw?: string | null }).actor_raw ?? '').trim(),
    String(row.action ?? '').trim(),
    context.actionLabel ?? '',
    String(row.target ?? '').trim(),
    context.detailSummary ?? '',
    ...(context.detailValues ?? [])
  ];
  collectSearchParts(row.payload, parts);
  return parts.filter(Boolean).join(' ');
};

export const matchesAuditSearch = (row: AuditRow, searchValue: string, context: AuditSearchContext = {}) =>
  matchesLooseSearch(buildAuditSearchText(row, context), searchValue);
