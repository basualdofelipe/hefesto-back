import {
  ADMIN_ROLE_NAME,
  ALL_PERMISSIONS,
  NO_PERMISSIONS,
  extractPermissions,
  isAdminRole,
  type Permissions,
} from './permission';

const ALL_FLAGS_FALSE: Permissions = { ...NO_PERMISSIONS };

describe('extractPermissions', () => {
  it('grants every permission to the ADMIN role even when all stored flags are false (D-18)', () => {
    const result = extractPermissions({
      name: ADMIN_ROLE_NAME,
      ...ALL_FLAGS_FALSE,
    });

    const keys = Object.keys(NO_PERMISSIONS) as (keyof Permissions)[];
    expect(keys).toHaveLength(11);
    for (const key of keys) {
      expect(result[key]).toBe(true);
    }
  });

  it('maps the stored flags for any role that is not ADMIN', () => {
    const result = extractPermissions({
      name: 'USER',
      ...ALL_FLAGS_FALSE,
      canUseCalculator: true,
    });

    expect(result).toEqual({ ...NO_PERMISSIONS, canUseCalculator: true });
  });

  it('does not treat a differently-cased name as ADMIN', () => {
    const result = extractPermissions({ name: 'admin', ...ALL_FLAGS_FALSE });

    expect(result).toEqual(NO_PERMISSIONS);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'x'],
  ])('returns no permissions for %s', (_label, role) => {
    expect(extractPermissions(role)).toEqual(NO_PERMISSIONS);
  });

  it('returns a fresh object for ADMIN on every call', () => {
    const adminRole = { name: ADMIN_ROLE_NAME, ...ALL_FLAGS_FALSE };
    const first = extractPermissions(adminRole);
    first.canManageUsers = false;

    const second = extractPermissions(adminRole);

    expect(second.canManageUsers).toBe(true);
    expect(ALL_PERMISSIONS.canManageUsers).toBe(true);
  });
});

describe('isAdminRole', () => {
  it('is true for the ADMIN role name', () => {
    expect(isAdminRole({ name: ADMIN_ROLE_NAME })).toBe(true);
  });

  it('is case-sensitive', () => {
    expect(isAdminRole({ name: 'admin' })).toBe(false);
  });

  it('is false for another role name', () => {
    expect(isAdminRole({ name: 'USER' })).toBe(false);
  });

  it('is false for null and undefined', () => {
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
  });
});

describe('ALL_PERMISSIONS', () => {
  it('has the same keys as NO_PERMISSIONS, all true', () => {
    expect(Object.keys(ALL_PERMISSIONS).sort()).toEqual(
      Object.keys(NO_PERMISSIONS).sort(),
    );
    expect(Object.values(ALL_PERMISSIONS).every((v) => v === true)).toBe(true);
  });
});
