import { describe, expect, it } from 'vitest';
import { formatAgencyPayrate, normalizeAgencyPayrateInput } from '../../src/agency/payrate';

describe('agency payrate', () => {
  it('normalizes valid payrates to two decimals', () => {
    expect(normalizeAgencyPayrateInput('18')).toBe('18.00');
    expect(normalizeAgencyPayrateInput('$18.5')).toBe('18.50');
    expect(normalizeAgencyPayrateInput('1,234.56')).toBe('1234.56');
  });

  it('rejects invalid or unsafe payrates', () => {
    expect(normalizeAgencyPayrateInput('')).toBe('');
    expect(normalizeAgencyPayrateInput('-1')).toBe('');
    expect(normalizeAgencyPayrateInput('18.555')).toBe('');
    expect(normalizeAgencyPayrateInput('10000')).toBe('');
    expect(normalizeAgencyPayrateInput('abc')).toBe('');
  });

  it('formats missing payrates as an empty table value', () => {
    expect(formatAgencyPayrate(null)).toBe('-');
    expect(formatAgencyPayrate('21')).toBe('21.00');
  });
});
