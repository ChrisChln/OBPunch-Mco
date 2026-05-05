import { describe, expect, test } from 'vitest';

import { isExactOperationalCutoffOut } from '../../src/shared/operationalPunches';

describe('operationalPunches', () => {
  test('treats an OUT exactly at the operational cutoff as previous-day activity', () => {
    expect(isExactOperationalCutoffOut('2026-05-05T05:00:00', 'OUT', 5)).toBe(true);
  });

  test('does not exclude non-cutoff or non-OUT punches', () => {
    expect(isExactOperationalCutoffOut('2026-05-05T05:00:01', 'OUT', 5)).toBe(false);
    expect(isExactOperationalCutoffOut('2026-05-05T05:00:00', 'IN', 5)).toBe(false);
  });
});
