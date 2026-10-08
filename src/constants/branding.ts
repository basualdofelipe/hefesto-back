/**
 * Branding constants for the back-end.
 *
 * All values are read from process.env with a neutral fallback so the app
 * boots and operates correctly even when no branding env vars are set.
 *
 * NOTE: this module intentionally does NOT use ConfigService — migrations
 * run outside Nest's DI container and rely on `import 'dotenv/config'`
 * (already present in data-source.ts:1) to populate process.env.
 */

export const APP_NAME: string = process.env.APP_NAME ?? 'Hefesto';
export const ADMIN_EMAIL: string =
  process.env.ADMIN_EMAIL ?? 'admin@hefesto.com';
export const ADMIN_NAME: string = process.env.ADMIN_NAME ?? 'Admin';

/**
 * Returns the configured demo login email, read from process.env at
 * call-time (not frozen at module load) so Jest env overrides take effect
 * without jest.resetModules().
 *
 * Security rationale (preserved from auth.service.ts):
 * The demo-login endpoint is hard-pinned to this single email address.
 * Setting DEMO_EMAIL only changes *which* email is the single allowed one —
 * it NEVER opens the endpoint to arbitrary emails. Even with
 * DEMO_LOGIN_ENABLED=true, any address that is not exactly getDemoEmail()
 * is rejected with 401.
 */
export const getDemoEmail = (): string =>
  process.env.DEMO_EMAIL ?? 'demo@hefesto.com';

/**
 * Whether this instance runs in demo mode, read from process.env at call-time
 * (not frozen at module load) so Jest env overrides take effect without
 * jest.resetModules().
 *
 * This is the single reader of the demo switch in the back-end (D-13). Demo
 * mode enables the pinned demo login, turns Google login off (R8) and makes
 * the Google credentials optional at boot (R9).
 */
export const isDemoMode = (): boolean =>
  process.env.DEMO_LOGIN_ENABLED === 'true';
