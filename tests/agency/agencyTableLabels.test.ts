import { describe, expect, test } from 'vitest';

import { getAgencyStatusLabel } from '../../src/agency/AgencyAppPage';

describe('Agency table labels', () => {
  test('uses concise status copy', () => {
    expect(getAgencyStatusLabel('ready')).toBe('Ready');
    expect(getAgencyStatusLabel('wait_confirm')).toBe('Waiting');
  });
});
