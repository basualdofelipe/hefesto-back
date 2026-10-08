/**
 * Auth demo mode over HTTP (R8, D-13, D-14).
 *
 * Proves, through the real app wiring (global prefix, ValidationPipe,
 * HttpExceptionFilter, ResponseInterceptor), that the demo switch closes the
 * Google login path server-side and keeps the pinned demo login working —
 * independent of whether the front hides the Google button.
 *
 * The demo flag is read at call time (isDemoMode), so each test sets it and
 * afterEach restores it. The app is compiled with demo mode OFF so the Google
 * client exists and the demo-off case exercises the real verify path.
 *
 * NETWORK: the demo-off case stubs only OAuth2Client.getFederatedSignonCertsAsync
 * (Google's certificate download, the HTTP boundary). The real verification
 * then rejects the malformed token offline, so the case is deterministic.
 *
 * REQUIREMENT: the test database on port 5433 (setup-e2e.ts) must be running:
 *   cd hefesto-back && docker compose up -d --wait postgres-test
 * The demo user is seeded by the SeedDemoUser migration (migrationsRun: true).
 *
 * HYGIENE: no rows are created; demo-login only reads the seeded demo user.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OAuth2Client } from 'google-auth-library';
// CertificateFormat is not re-exported from the package root (10.6.1).
import { CertificateFormat } from 'google-auth-library/build/src/auth/oauth2client';
import helmet from 'helmet';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { LoggingInterceptor } from '../src/common/interceptors/logging.interceptor';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { getDemoEmail } from '../src/constants/branding';

const GOOGLE_DISABLED_MESSAGE = 'Login con Google no disponible';
const INVALID_GOOGLE_TOKEN_MESSAGE = 'Token de Google invalido';
const DEMO_DISABLED_MESSAGE = 'Demo login no disponible';
const MALFORMED_ID_TOKEN = 'not-a-real-token';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
}

interface AuthSuccessBody {
  data: {
    accessToken: string;
    user: { email: string };
  };
}

describe('Auth demo mode (real Postgres)', () => {
  let app: INestApplication<App>;
  let suiteDemoFlag: string | undefined;
  let testDemoFlag: string | undefined;

  beforeAll(async () => {
    suiteDemoFlag = process.env.DEMO_LOGIN_ENABLED;
    // Demo mode off at construction: AuthService builds its Google client.
    process.env.DEMO_LOGIN_ENABLED = 'false';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Mirror main.ts configuration (same as app.e2e-spec.ts)
    app.setGlobalPrefix('api');
    app.use(helmet());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(
      new ResponseInterceptor(),
      new LoggingInterceptor(),
    );

    await app.init();
  });

  beforeEach(() => {
    testDemoFlag = process.env.DEMO_LOGIN_ENABLED;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (testDemoFlag === undefined) {
      delete process.env.DEMO_LOGIN_ENABLED;
    } else {
      process.env.DEMO_LOGIN_ENABLED = testDemoFlag;
    }
  });

  afterAll(async () => {
    if (suiteDemoFlag === undefined) {
      delete process.env.DEMO_LOGIN_ENABLED;
    } else {
      process.env.DEMO_LOGIN_ENABLED = suiteDemoFlag;
    }
    await app.close();
  });

  describe('POST /api/auth/google', () => {
    it('demo on: refuses any token with 401 "Login con Google no disponible"', async () => {
      process.env.DEMO_LOGIN_ENABLED = 'true';

      const res = await request(app.getHttpServer())
        .post('/api/auth/google')
        .send({ idToken: MALFORMED_ID_TOKEN })
        .expect(401);

      expect((res.body as ErrorBody).message).toBe(GOOGLE_DISABLED_MESSAGE);
    });

    it('demo off: verifies the token as today and rejects a malformed one with 401 "Token de Google invalido"', async () => {
      process.env.DEMO_LOGIN_ENABLED = 'false';
      jest
        .spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync')
        .mockResolvedValue({ certs: {}, format: CertificateFormat.PEM });

      const res = await request(app.getHttpServer())
        .post('/api/auth/google')
        .send({ idToken: MALFORMED_ID_TOKEN })
        .expect(401);

      expect((res.body as ErrorBody).message).toBe(
        INVALID_GOOGLE_TOKEN_MESSAGE,
      );
    });

    it('demo on: an empty body is rejected by validation (400) before the service', async () => {
      process.env.DEMO_LOGIN_ENABLED = 'true';

      await request(app.getHttpServer())
        .post('/api/auth/google')
        .send({})
        .expect(400);
    });
  });

  describe('POST /api/auth/demo-login', () => {
    it('demo on: logs in the pinned demo account (200 with an access token)', async () => {
      process.env.DEMO_LOGIN_ENABLED = 'true';

      const res = await request(app.getHttpServer())
        .post('/api/auth/demo-login')
        .send({ email: getDemoEmail() })
        .expect(200);

      const body = res.body as AuthSuccessBody;
      expect(typeof body.data.accessToken).toBe('string');
      expect(body.data.accessToken.length).toBeGreaterThan(0);
      expect(body.data.user.email).toBe(getDemoEmail());
    });

    it('demo off: refuses with 401 "Demo login no disponible"', async () => {
      process.env.DEMO_LOGIN_ENABLED = 'false';

      const res = await request(app.getHttpServer())
        .post('/api/auth/demo-login')
        .send({ email: getDemoEmail() })
        .expect(401);

      expect((res.body as ErrorBody).message).toBe(DEMO_DISABLED_MESSAGE);
    });
  });
});
