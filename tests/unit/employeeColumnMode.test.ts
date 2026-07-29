import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('employee column mode detection', () => {
  test('prefers canonical lowercase columns when both schemas are available', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'admin', 'AdminAppPage.tsx'), 'utf8');
    const resolverStart = source.indexOf('const resolveEmployeeColumnMode = async');
    const resolverEnd = source.indexOf('const normalizePositionKey', resolverStart);
    const resolverSource = source.slice(resolverStart, resolverEnd);

    const lowerProbe = resolverSource.indexOf("select('staff_id, agency, position')");
    const legacyProbe = resolverSource.indexOf('select(\'staff_id, "Agency", "Position"\')');

    expect(resolverStart).toBeGreaterThanOrEqual(0);
    expect(resolverEnd).toBeGreaterThan(resolverStart);
    expect(lowerProbe).toBeGreaterThanOrEqual(0);
    expect(legacyProbe).toBeGreaterThanOrEqual(0);
    expect(lowerProbe).toBeLessThan(legacyProbe);
  });

  test('retries employee creation with the alternate mode when a selected column is generated', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'admin', 'AdminAppPage.tsx'), 'utf8');
    const addStart = source.indexOf('const addEmployeeRow = async');
    const addEnd = source.indexOf('const deleteEmployeeRow = async', addStart);
    const addSource = source.slice(addStart, addEnd);

    expect(addStart).toBeGreaterThanOrEqual(0);
    expect(addEnd).toBeGreaterThan(addStart);
    expect(addSource).toContain('isGeneratedEmployeeColumnWriteError');
    expect(addSource).toContain('employeeColumnModeRef.current = fallbackMode');
    expect(addSource).toContain('await upsertEmployeePayload(buildPayload(fallbackMode))');
  });
});
