import { describe, expect, test } from 'vitest';
import {
  buildEffectiveModuleMap,
  canManageAdminAccess,
  canReviewTerminationRequests,
  filterRowsByPositionAccess,
  getDefaultModuleAccess,
  hasPositionAccess,
  hasModuleAccess,
  normalizeAdminAccessContext,
  normalizeAdminRole,
  normalizePositionScopesForContext
} from '../../src/shared/adminAccess';

describe('adminAccess', () => {
  test('falls back to level1 for default owner email', () => {
    expect(normalizeAdminRole('', 'lnchen4201@gmail.com')).toBe('level1');
  });

  test('defaults unspecified accounts to level3', () => {
    expect(normalizeAdminRole('', 'user@example.com')).toBe('level3');
    expect(normalizeAdminAccessContext({ user_id: 'u0', modules: [] }).role).toBe('level3');
  });

  test('applies role defaults and explicit overrides', () => {
    const map = buildEffectiveModuleMap('agency', [
      { module_key: 'agency', access_level: 'operate' },
      { module_key: 'audit', access_level: 'view' }
    ]);
    expect(map.agency).toBe('operate');
    expect(map.audit).toBe('view');
    expect(map.schedule).toBe('hidden');
  });

  test('level3 defaults to view-only', () => {
    expect(getDefaultModuleAccess('level3', 'schedule')).toBe('view');
  });

  test('agency keeps permissions page visible by default', () => {
    expect(getDefaultModuleAccess('agency', 'permissions')).toBe('view');
  });

  test('checks view and operate access correctly', () => {
    const map = buildEffectiveModuleMap('agency', [{ module_key: 'agency', access_level: 'operate' }]);
    expect(hasModuleAccess(map, 'agency', 'view')).toBe(true);
    expect(hasModuleAccess(map, 'agency', 'operate')).toBe(true);
    expect(hasModuleAccess(map, 'audit', 'view')).toBe(false);
  });

  test('normalizes rpc payload to complete context', () => {
    const context = normalizeAdminAccessContext({
      user_id: 'u1',
      role: 'agency',
      managed_agencies: ['A1'],
      modules: [{ module_key: 'agency', access_level: 'operate' }]
    });

    expect(context.user_id).toBe('u1');
    expect(context.managed_agencies).toEqual(['A1']);
    expect(context.modules.find((item) => item.module_key === 'agency')?.access_level).toBe('operate');
    expect(context.modules.find((item) => item.module_key === 'schedule')?.access_level).toBe('hidden');
  });

  test('only level1 with permissions operate can manage admin access', () => {
    const level1 = normalizeAdminAccessContext({
      user_id: 'u1',
      role: 'level1',
      modules: []
    });
    const level2 = normalizeAdminAccessContext({
      user_id: 'u2',
      role: 'level2',
      modules: []
    });
    const level1WithoutPermission = normalizeAdminAccessContext({
      user_id: 'u3',
      role: 'level1',
      modules: [{ module_key: 'permissions', access_level: 'hidden' }]
    });

    expect(canManageAdminAccess(level1)).toBe(true);
    expect(canManageAdminAccess(level2)).toBe(false);
    expect(canManageAdminAccess(level1WithoutPermission)).toBe(false);
  });

  test('termination review requires schedule operate', () => {
    const readonlyLevel3 = normalizeAdminAccessContext({
      user_id: 'u3',
      role: 'level3',
      modules: []
    });
    const overriddenLevel3 = normalizeAdminAccessContext({
      user_id: 'u4',
      role: 'level3',
      modules: [{ module_key: 'schedule', access_level: 'operate' }]
    });

    expect(canReviewTerminationRequests(readonlyLevel3)).toBe(false);
    expect(canReviewTerminationRequests(overriddenLevel3)).toBe(true);
  });

  test('normalizes missing position scopes to all access for scoped modules', () => {
    const context = normalizeAdminAccessContext({
      user_id: 'u5',
      role: 'level3',
      modules: []
    });

    expect(context.position_scopes.employees.mode).toBe('all');
    expect(context.position_scopes.schedule.mode).toBe('all');
    expect(context.position_scopes.timecard.mode).toBe('all');
    expect(hasPositionAccess(context, 'employees', 'Pick', 'view')).toBe(true);
  });

  test('enforces selected position scope and module access together', () => {
    const context = normalizeAdminAccessContext({
      user_id: 'u6',
      role: 'level3',
      modules: [
        { module_key: 'employees', access_level: 'operate' },
        { module_key: 'schedule', access_level: 'view' }
      ],
      position_scopes: {
        employees: {
          mode: 'selected',
          positions: [
            { position: 'Pick', access_level: 'view' },
            { position: 'Pack', access_level: 'operate' }
          ]
        },
        schedule: {
          mode: 'selected',
          positions: [{ position: 'Pick', access_level: 'operate' }]
        }
      }
    });

    expect(hasPositionAccess(context, 'employees', 'Pick', 'view')).toBe(true);
    expect(hasPositionAccess(context, 'employees', 'Pick', 'operate')).toBe(false);
    expect(hasPositionAccess(context, 'employees', 'Pack', 'operate')).toBe(true);
    expect(hasPositionAccess(context, 'employees', 'Rebin', 'view')).toBe(false);
    expect(hasPositionAccess(context, 'schedule', 'Pick', 'operate')).toBe(false);
  });

  test('filters rows by selected position scope', () => {
    const context = normalizeAdminAccessContext({
      user_id: 'u7',
      role: 'level3',
      modules: [{ module_key: 'employees', access_level: 'operate' }],
      position_scopes: {
        employees: {
          mode: 'selected',
          positions: [{ position: 'Pick', access_level: 'view' }]
        }
      }
    });
    const rows = [
      { staff_id: 'US1', position: 'Pick' },
      { staff_id: 'US2', position: 'Pack' },
      { staff_id: 'US3', Position: 'pick' }
    ];

    expect(filterRowsByPositionAccess(context, 'employees', rows, (row) => row.position ?? row.Position)).toEqual([
      rows[0],
      rows[2]
    ]);
  });

  test('normalizes malformed position scopes to all access', () => {
    expect(normalizePositionScopesForContext('not-json').employees.mode).toBe('all');
    expect(
      normalizePositionScopesForContext({
        employees: {
          mode: 'selected',
          positions: [{ position: '  Pick  ', access_level: 'operate' }, { position: '', access_level: 'operate' }]
        }
      }).employees.positions
    ).toEqual([{ position: 'Pick', access_level: 'operate' }]);
  });
});
