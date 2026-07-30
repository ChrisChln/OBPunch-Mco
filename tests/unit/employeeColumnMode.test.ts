import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

describe('employee canonical columns', () => {
  test('selects canonical lowercase employee metadata columns', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'admin', 'AdminAppPage.tsx'), 'utf8');
    const builderStart = source.indexOf('const buildEmployeeSelectColumns =');
    const builderEnd = source.indexOf('const normalizePositionKey', builderStart);
    const builderSource = source.slice(builderStart, builderEnd);

    expect(builderStart).toBeGreaterThanOrEqual(0);
    expect(builderEnd).toBeGreaterThan(builderStart);
    expect(builderSource).toContain('agency, position');
    expect(builderSource).not.toContain('"Agency"');
    expect(builderSource).not.toContain('"Position"');
  });

  test('creates employees with canonical lowercase metadata columns', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'admin', 'AdminAppPage.tsx'), 'utf8');
    const addStart = source.indexOf('const addEmployeeRow = async');
    const addEnd = source.indexOf('const deleteEmployeeRow = async', addStart);
    const addSource = source.slice(addStart, addEnd);

    expect(addStart).toBeGreaterThanOrEqual(0);
    expect(addEnd).toBeGreaterThan(addStart);
    expect(addSource).toContain('agency,');
    expect(addSource).toContain('position: normalizedPos');
    expect(addSource).not.toContain('isGeneratedEmployeeColumnWriteError');
    expect(addSource).not.toContain('employeeColumnModeRef');
  });
});
