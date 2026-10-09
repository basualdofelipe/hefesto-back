import { isDemoMode } from '../constants/branding';
import { envValidationSchema } from './env.validation';

/**
 * GOOGLE_CLIENT_ID is required only outside demo mode (R9, D-15).
 * Options mirror ConfigModule.forRoot: allowUnknown (process.env carries
 * every OS variable) and abortEarly false (app.module.ts).
 */
describe('envValidationSchema — GOOGLE_CLIENT_ID vs demo mode', () => {
  const REQUIRED_MESSAGE = '"GOOGLE_CLIENT_ID" is required';

  // Neutral values for the other required keys, so only the rule under test can fail.
  const BASE_ENV = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5433/env_spec',
    FRONTEND_URL: 'http://localhost:3000',
    JWT_SECRET: 'env-spec-secret',
  };

  const validate = (
    env: NodeJS.ProcessEnv,
  ): ReturnType<typeof envValidationSchema.validate> =>
    envValidationSchema.validate(env, {
      allowUnknown: true,
      abortEarly: false,
    });

  it('rejects a missing GOOGLE_CLIENT_ID when the demo flag is absent', () => {
    const { error } = validate({ ...BASE_ENV });

    expect(error?.message).toContain(REQUIRED_MESSAGE);
  });

  it('accepts a missing GOOGLE_CLIENT_ID in demo mode', () => {
    const { error } = validate({ ...BASE_ENV, DEMO_LOGIN_ENABLED: 'true' });

    expect(error).toBeUndefined();
  });

  it('rejects a missing GOOGLE_CLIENT_ID with demo mode off', () => {
    const { error } = validate({ ...BASE_ENV, DEMO_LOGIN_ENABLED: 'false' });

    expect(error?.message).toContain(REQUIRED_MESSAGE);
  });

  it('accepts a present GOOGLE_CLIENT_ID in demo mode (ignored, not rejected)', () => {
    const { error } = validate({
      ...BASE_ENV,
      DEMO_LOGIN_ENABLED: 'true',
      GOOGLE_CLIENT_ID: 'test-google-client-id',
    });

    expect(error).toBeUndefined();
  });

  it('accepts a blank GOOGLE_CLIENT_ID in demo mode (a bare `GOOGLE_CLIENT_ID=` line)', () => {
    const { error } = validate({
      ...BASE_ENV,
      DEMO_LOGIN_ENABLED: 'true',
      GOOGLE_CLIENT_ID: '',
    });

    expect(error).toBeUndefined();
  });

  it('rejects a blank GOOGLE_CLIENT_ID with demo mode off', () => {
    const { error } = validate({
      ...BASE_ENV,
      DEMO_LOGIN_ENABLED: 'false',
      GOOGLE_CLIENT_ID: '',
    });

    expect(error?.message).toContain('GOOGLE_CLIENT_ID');
  });
});

describe('envValidationSchema — DATABASE_SSL', () => {
  const BASE_ENV = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5433/env_spec',
    FRONTEND_URL: 'http://localhost:3000',
    JWT_SECRET: 'env-spec-secret',
    GOOGLE_CLIENT_ID: 'test-google-client-id',
  };

  const validate = (
    env: NodeJS.ProcessEnv,
  ): ReturnType<typeof envValidationSchema.validate> =>
    envValidationSchema.validate(env, {
      allowUnknown: true,
      abortEarly: false,
    });

  it('defaults to "false" when unset', () => {
    const { error, value } = validate({ ...BASE_ENV });

    expect(error).toBeUndefined();
    expect((value as { DATABASE_SSL: string }).DATABASE_SSL).toBe('false');
  });

  it.each(['true', 'false'])('accepts "%s"', (flag) => {
    const { error } = validate({ ...BASE_ENV, DATABASE_SSL: flag });

    expect(error).toBeUndefined();
  });

  it.each(['yes', '1', 'TRUE', ''])('rejects "%s"', (flag) => {
    const { error } = validate({ ...BASE_ENV, DATABASE_SSL: flag });

    expect(error?.message).toContain('DATABASE_SSL');
  });
});

describe('isDemoMode', () => {
  let originalDemoFlag: string | undefined;

  beforeEach(() => {
    originalDemoFlag = process.env.DEMO_LOGIN_ENABLED;
  });

  afterEach(() => {
    if (originalDemoFlag === undefined) {
      delete process.env.DEMO_LOGIN_ENABLED;
    } else {
      process.env.DEMO_LOGIN_ENABLED = originalDemoFlag;
    }
  });

  it('is true when the flag is "true"', () => {
    process.env.DEMO_LOGIN_ENABLED = 'true';

    expect(isDemoMode()).toBe(true);
  });

  it('is false when the flag is "false"', () => {
    process.env.DEMO_LOGIN_ENABLED = 'false';

    expect(isDemoMode()).toBe(false);
  });

  it('is false when the flag is unset', () => {
    delete process.env.DEMO_LOGIN_ENABLED;

    expect(isDemoMode()).toBe(false);
  });

  it('reads the flag at call time, not at module load', () => {
    process.env.DEMO_LOGIN_ENABLED = 'true';
    expect(isDemoMode()).toBe(true);

    process.env.DEMO_LOGIN_ENABLED = 'false';
    expect(isDemoMode()).toBe(false);
  });
});
