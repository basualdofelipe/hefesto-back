/**
 * admin-permissions.e2e-spec.ts
 *
 * WHY THIS SPEC EXISTS
 * --------------------
 * R10 / D-18: a user with the ADMIN role has every permission on every request,
 * whatever the role's stored flags say. A demo visitor can edit those flags
 * through /roles; this proves that turning them all off cannot lock ADMIN out.
 *
 * JwtStrategy.validate re-reads the user and role from the DB on each request
 * and PermissionsGuard checks extractPermissions(role), so the guard sees the
 * flipped flags immediately. Every route-backed permission gets one request:
 * reads must answer 200, writes with an empty body must answer 400. Nest runs
 * guards before pipes, so a 400 means the permission guard already let the
 * request through; a 403 would mean it did not. can_view_dashboard has no
 * route yet and is covered by src/common/types/permission.spec.ts.
 *
 * REQUIREMENT: the test database on port 5433 (setup-e2e.ts) must be running:
 *   cd hefesto-back && docker compose up -d --wait postgres-test
 * Run with:
 *   npx jest --config ./test/jest-e2e.json --runInBand test/admin-permissions.e2e-spec.ts
 *
 * HYGIENE: the ADMIN role row is shared by every suite (unique by name). This
 * suite restores all 11 ADMIN flags to the seeded `true` in beforeAll (self-heal
 * after a crashed predecessor), in a finally around the flip, and in afterAll.
 * The fixture user carries TEST_PREFIX and is swept before and after.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import helmet from 'helmet';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { LoggingInterceptor } from '../src/common/interceptors/logging.interceptor';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import {
  ADMIN_ROLE_NAME,
  extractPermissions,
} from '../src/common/types/permission';
import { Role } from '../src/roles/entities/role.entity';
import { User } from '../src/users/entities/user.entity';

const TEST_PREFIX = 'e2e-adminperm-';

const PERMISSION_COLUMNS = [
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

type HttpMethod = 'get' | 'post' | 'put';

interface RouteCheck {
  permission: string;
  method: HttpMethod;
  path: string;
  expected: 200 | 400;
}

// One request per route-backed permission (plus the catalogs routes, which
// share can_view_products / can_edit_products). Writes send {}: every DTO here
// has required fields, so validation rejects it after the guard passed.
const ROUTE_CHECKS: readonly RouteCheck[] = [
  {
    permission: 'can_view_products',
    method: 'get',
    path: '/api/products',
    expected: 200,
  },
  {
    permission: 'can_edit_products',
    method: 'post',
    path: '/api/products',
    expected: 400,
  },
  {
    permission: 'can_view_supplies',
    method: 'get',
    path: '/api/supplies',
    expected: 200,
  },
  {
    permission: 'can_edit_supplies',
    method: 'post',
    path: '/api/supplies',
    expected: 400,
  },
  {
    permission: 'can_view_expenses',
    method: 'get',
    path: '/api/expenses',
    expected: 200,
  },
  {
    permission: 'can_edit_expenses',
    method: 'post',
    path: '/api/expenses',
    expected: 400,
  },
  {
    permission: 'can_use_calculator',
    method: 'post',
    path: '/api/calculator/forward',
    expected: 400,
  },
  {
    permission: 'can_manage_scenarios',
    method: 'get',
    path: '/api/scenarios',
    expected: 200,
  },
  {
    permission: 'can_manage_config',
    method: 'put',
    path: '/api/tiendanube-config/shipping',
    expected: 400,
  },
  {
    permission: 'can_manage_users',
    method: 'get',
    path: '/api/users',
    expected: 200,
  },
  {
    permission: 'can_view_products',
    method: 'get',
    path: '/api/catalogs/product-types',
    expected: 200,
  },
  {
    permission: 'can_edit_products',
    method: 'post',
    path: '/api/catalogs/product-types',
    expected: 400,
  },
];

describe('ADMIN role has every permission regardless of stored flags (R10, D-18)', () => {
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;
  let dataSource: DataSource;
  let adminToken: string;

  const setAdminFlags = async (value: boolean): Promise<void> => {
    const assignments = PERMISSION_COLUMNS.map((c) => `${c} = $2`).join(', ');
    await dataSource.query(`UPDATE roles SET ${assignments} WHERE name = $1`, [
      ADMIN_ROLE_NAME,
      value,
    ]);
  };

  const readAdminFlags = async (): Promise<boolean[]> => {
    const rows: Record<(typeof PERMISSION_COLUMNS)[number], boolean>[] =
      await dataSource.query(
        `SELECT ${PERMISSION_COLUMNS.join(', ')} FROM roles WHERE name = $1`,
        [ADMIN_ROLE_NAME],
      );
    expect(rows).toHaveLength(1);
    return PERMISSION_COLUMNS.map((c) => rows[0][c]);
  };

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Mirror main.ts configuration (same as calculator.e2e-spec.ts)
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

    dataSource = moduleFixture.get(DataSource);
    const jwtService = moduleFixture.get(JwtService);
    const userRepo = dataSource.getRepository(User);
    const roleRepo = dataSource.getRepository(Role);

    // Self-heal: a crashed predecessor may have left ADMIN's flags false
    await setAdminFlags(true);
    await dataSource.query(`DELETE FROM users WHERE email LIKE $1`, [
      `${TEST_PREFIX}%`,
    ]);

    const adminRole = await roleRepo.findOneByOrFail({ name: ADMIN_ROLE_NAME });
    // TypeORM drops an undefined condition, so pin that we got the ADMIN row
    expect(adminRole.name).toBe(ADMIN_ROLE_NAME);
    const admin = await userRepo.save(
      userRepo.create({
        email: `${TEST_PREFIX}admin@test.com`,
        name: 'e2e adminperm admin',
        role: adminRole,
        isActive: true,
      }),
    );

    // The payload's permissions are informational: JwtStrategy re-derives
    // them from the DB role on every request.
    adminToken = jwtService.sign({
      sub: admin.id,
      email: admin.email,
      permissions: extractPermissions(adminRole),
    });
  });

  afterAll(async () => {
    try {
      await setAdminFlags(true);
      await dataSource.query(`DELETE FROM users WHERE email LIKE $1`, [
        `${TEST_PREFIX}%`,
      ]);
      expect(await readAdminFlags()).toEqual(
        PERMISSION_COLUMNS.map(() => true),
      );
    } finally {
      await app.close();
    }
  });

  it('reaches every guarded route family with all 11 ADMIN flags false', async () => {
    await setAdminFlags(false);
    try {
      expect(await readAdminFlags()).toEqual(
        PERMISSION_COLUMNS.map(() => false),
      );

      const server = app.getHttpServer();
      const actual: Record<string, number> = {};
      const expected: Record<string, number> = {};

      for (const check of ROUTE_CHECKS) {
        const label = `${check.method.toUpperCase()} ${check.path} (${check.permission})`;
        const agent = request(server);
        const req = agent[check.method](check.path).set(
          'Authorization',
          `Bearer ${adminToken}`,
        );
        const res = check.method === 'get' ? await req : await req.send({});
        actual[label] = res.status;
        expected[label] = check.expected;
      }

      // One assertion over the whole matrix so a failure shows every row
      expect(actual).toEqual(expected);
    } finally {
      await setAdminFlags(true);
    }
  });
});
