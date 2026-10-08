/**
 * E2E Test Setup
 *
 * Overrides DATABASE_URL to point to the test database (port 5433)
 * before any test modules are loaded.
 *
 * Requires: docker compose up -d (postgres-test on port 5433)
 */
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ??
  'postgresql://hefesto:hefesto_test@localhost:5433/hefesto_test';
process.env.NODE_ENV = 'test';
process.env.FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:3000';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-for-e2e';
process.env.GOOGLE_CLIENT_ID =
  process.env.GOOGLE_CLIENT_ID ?? 'test-google-client-id';
// Deterministic demo default regardless of the developer's .env (Pitfall 11);
// demo-mode suites set and restore it per test.
process.env.DEMO_LOGIN_ENABLED = process.env.DEMO_LOGIN_ENABLED ?? 'false';
