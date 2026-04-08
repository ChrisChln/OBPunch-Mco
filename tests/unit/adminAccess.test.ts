import { describe, expect, test } from 'vitest';
import {
  buildEffectiveModuleMap,
  canManageAdminAccess,
  canReviewTerminationRequests,
  getDefaultModuleAccess,
  hasModuleAccess,
  normalizeAdminAccessContext,
  normalizeAdminRole
} from '../../src/shared/adminAccess';

describe('adminAccess', () => {
  test('falls back to level1 for default owner email', () => {
    expect(normalizeAdminRole('', 'lnchen4201@gmail.com')).toBe('level1');
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

  test('only level1 with accounts operate can manage admin access', () => {
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

    expect(canManageAdminAccess(level1)).toBe(true);
    expect(canManageAdminAccess(level2)).toBe(false);
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
});
