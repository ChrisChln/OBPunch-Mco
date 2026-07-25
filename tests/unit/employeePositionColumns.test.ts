import { describe, expect, test, vi } from 'vitest';

import {
  buildEmployeeEditWritePayload,
  buildEmployeePositionWritePayload,
  probeEmployeePositionColumnMode
} from '../../src/admin/employeePositionColumns';

describe('employee position column compatibility', () => {
  test('detects both physical columns independently', async () => {
    const probe = vi.fn(async () => true);

    await expect(probeEmployeePositionColumnMode(probe)).resolves.toBe('both');
    expect(probe).toHaveBeenNthCalledWith(1, 'position');
    expect(probe).toHaveBeenNthCalledWith(2, 'Position');
  });

  test('writes both position columns when both exist', () => {
    expect(buildEmployeePositionWritePayload('both', 'Shipping')).toEqual({
      position: 'Shipping',
      Position: 'Shipping'
    });
  });

  test('writes only the available position column on legacy schemas', () => {
    expect(buildEmployeePositionWritePayload('lower', 'Pick')).toEqual({ position: 'Pick' });
    expect(buildEmployeePositionWritePayload('cased', 'Pack')).toEqual({ Position: 'Pack' });
  });

  test('builds an employee edit payload with both position columns', () => {
    expect(
      buildEmployeeEditWritePayload({
        employeeColumnMode: 'cased',
        positionColumnMode: 'both',
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
      })
    ).toMatchObject({
      staff_id: 'US018637',
      Agency: 'Prime',
      position: 'Pick',
      Position: 'Pick'
    });
  });
});
