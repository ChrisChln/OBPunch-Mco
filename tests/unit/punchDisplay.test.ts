import { describe, expect, test } from 'vitest';

import { formatPunchFailureSummary } from '../../src/lib/punchDisplay';

describe('punch display', () => {
  test('shows the API failure detail in the last punch card', () => {
    expect(formatPunchFailureSummary('Employee not registered: US018867')).toBe('Punch failed: Employee not registered: US018867');
  });

  test('falls back when the API failure detail is empty', () => {
    expect(formatPunchFailureSummary('')).toBe('Punch failed');
  });
});
