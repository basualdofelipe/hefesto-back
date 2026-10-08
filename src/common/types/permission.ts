export type Permission =
  | 'can_view_products'
  | 'can_edit_products'
  | 'can_view_supplies'
  | 'can_edit_supplies'
  | 'can_view_expenses'
  | 'can_edit_expenses'
  | 'can_use_calculator'
  | 'can_manage_scenarios'
  | 'can_view_dashboard'
  | 'can_manage_config'
  | 'can_manage_users';

export const PERMISSIONS: readonly Permission[] = [
  'can_view_products',
  'can_edit_products',
  'can_view_supplies',
  'can_edit_supplies',
  'can_view_expenses',
  'can_edit_expenses',
  'can_use_calculator',
  'can_manage_scenarios',
  'can_view_dashboard',
  'can_manage_config',
  'can_manage_users',
] as const;

export interface Permissions {
  canViewProducts: boolean;
  canEditProducts: boolean;
  canViewSupplies: boolean;
  canEditSupplies: boolean;
  canViewExpenses: boolean;
  canEditExpenses: boolean;
  canUseCalculator: boolean;
  canManageScenarios: boolean;
  canViewDashboard: boolean;
  canManageConfig: boolean;
  canManageUsers: boolean;
}

export const NO_PERMISSIONS: Permissions = {
  canViewProducts: false,
  canEditProducts: false,
  canViewSupplies: false,
  canEditSupplies: false,
  canViewExpenses: false,
  canEditExpenses: false,
  canUseCalculator: false,
  canManageScenarios: false,
  canViewDashboard: false,
  canManageConfig: false,
  canManageUsers: false,
};

export const ALL_PERMISSIONS: Permissions = {
  canViewProducts: true,
  canEditProducts: true,
  canViewSupplies: true,
  canEditSupplies: true,
  canViewExpenses: true,
  canEditExpenses: true,
  canUseCalculator: true,
  canManageScenarios: true,
  canViewDashboard: true,
  canManageConfig: true,
  canManageUsers: true,
};

/** The seeded system role that always has every permission; system-role names are immutable. */
export const ADMIN_ROLE_NAME = 'ADMIN';

/** Single place that decides whether a role is ADMIN (exact, case-sensitive name match). */
export function isAdminRole(
  role: { name?: unknown } | null | undefined,
): boolean {
  return role?.name === ADMIN_ROLE_NAME;
}

export const PERMISSION_TO_CAMEL: Record<Permission, keyof Permissions> = {
  can_view_products: 'canViewProducts',
  can_edit_products: 'canEditProducts',
  can_view_supplies: 'canViewSupplies',
  can_edit_supplies: 'canEditSupplies',
  can_view_expenses: 'canViewExpenses',
  can_edit_expenses: 'canEditExpenses',
  can_use_calculator: 'canUseCalculator',
  can_manage_scenarios: 'canManageScenarios',
  can_view_dashboard: 'canViewDashboard',
  can_manage_config: 'canManageConfig',
  can_manage_users: 'canManageUsers',
};

export function extractPermissions(role: unknown): Permissions {
  if (role == null || typeof role !== 'object') {
    return NO_PERMISSIONS;
  }

  // D-18: ADMIN has every permission whatever its stored flags say
  if (isAdminRole(role as { name?: unknown })) {
    return { ...ALL_PERMISSIONS };
  }

  const r = role as Record<string, unknown>;

  return {
    canViewProducts: Boolean(r['canViewProducts']),
    canEditProducts: Boolean(r['canEditProducts']),
    canViewSupplies: Boolean(r['canViewSupplies']),
    canEditSupplies: Boolean(r['canEditSupplies']),
    canViewExpenses: Boolean(r['canViewExpenses']),
    canEditExpenses: Boolean(r['canEditExpenses']),
    canUseCalculator: Boolean(r['canUseCalculator']),
    canManageScenarios: Boolean(r['canManageScenarios']),
    canViewDashboard: Boolean(r['canViewDashboard']),
    canManageConfig: Boolean(r['canManageConfig']),
    canManageUsers: Boolean(r['canManageUsers']),
  };
}
