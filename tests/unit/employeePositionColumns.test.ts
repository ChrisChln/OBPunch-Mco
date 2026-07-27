import { describe, expect, test } from 'vitest';

import { buildEmployeeEditWritePayload } from '../../src/admin/employeePositionColumns';

describe('employee metadata writes', () => {
  test('writes canonical lowercase agency and position columns only', () => {
    const payload = buildEmployeeEditWritePayload({
      staffId: 'US018637',
      name: 'Kristi Marmol',
      agency: 'Prime',
      position: 'Pick',
      employmentType: 'FT',
      shift: 'early',
      shiftTime: '07:00',
      label: 'Lead',
      workAccount: 'KristiMarmol',
      workPassword: 'Mco123456'
    });

    expect(payload).toMatchObject({
      staff_id: 'US018637',
      agency: 'Prime',
      position: 'Pick'
    });
    expect(payload).not.toHaveProperty('Agency');
    expect(payload).not.toHaveProperty('Position');
  });
});
