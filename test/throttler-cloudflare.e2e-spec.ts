/**
 * throttler-cloudflare.e2e-spec.ts
 *
 * In production the back sits behind Cloudflare Tunnel, so the TCP peer is the
 * tunnel (or the Docker network), never the real client. The global limiter
 * must therefore count per CF-Connecting-IP value, and a request without that
 * header comes from inside the Docker network (the front's server) and is not
 * limited by design.
 *
 * Each test boots a fresh app so the in-memory throttler store starts empty.
 * Addresses are RFC 5737 documentation ranges.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import helmet from 'helmet';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { LoggingInterceptor } from './../src/common/interceptors/logging.interceptor';
import { ResponseInterceptor } from './../src/common/interceptors/response.interceptor';
import { THROTTLE_LIMIT } from './../src/config/throttler.config';

const TIMEOUT_MS = 30000;
const CF_HEADER = 'CF-Connecting-IP';
const CLIENT_A = '203.0.113.10';
const CLIENT_B = '198.51.100.20';

describe('Throttler keyed on CF-Connecting-IP (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Mirror main.ts configuration
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
  }, TIMEOUT_MS);

  afterEach(async () => {
    await app.close();
  });

  const getHealth = async (
    headers: Record<string, string>,
  ): Promise<number> => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .set(headers);
    return response.status;
  };

  const sendSequential = async (
    count: number,
    headers: Record<string, string>,
  ): Promise<number[]> => {
    const statuses: number[] = [];
    for (let i = 0; i < count; i++) {
      statuses.push(await getHealth(headers));
    }
    return statuses;
  };

  it(
    'limits a single CF-Connecting-IP after THROTTLE_LIMIT requests',
    async () => {
      const statuses = await sendSequential(THROTTLE_LIMIT, {
        [CF_HEADER]: CLIENT_A,
      });

      expect(statuses.every((status) => status === 200)).toBe(true);
      expect(await getHealth({ [CF_HEADER]: CLIENT_A })).toBe(429);
    },
    TIMEOUT_MS,
  );

  it(
    'keeps serving a different CF-Connecting-IP after one is saturated',
    async () => {
      await sendSequential(THROTTLE_LIMIT + 1, { [CF_HEADER]: CLIENT_A });

      expect(await getHealth({ [CF_HEADER]: CLIENT_B })).toBe(200);
    },
    TIMEOUT_MS,
  );

  it(
    'never limits requests without CF-Connecting-IP',
    async () => {
      const statuses = await sendSequential(THROTTLE_LIMIT + 20, {});

      expect(statuses.filter((status) => status !== 200)).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    'treats an empty or whitespace CF-Connecting-IP as absent',
    async () => {
      const emptyStatuses = await sendSequential(THROTTLE_LIMIT + 10, {
        [CF_HEADER]: '',
      });
      const blankStatuses = await sendSequential(10, { [CF_HEADER]: '   ' });

      expect(
        [...emptyStatuses, ...blankStatuses].filter((s) => s !== 200),
      ).toEqual([]);
    },
    TIMEOUT_MS,
  );
});
