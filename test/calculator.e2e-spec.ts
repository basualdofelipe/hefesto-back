/**
 * calculator.e2e-spec.ts
 *
 * WHY THIS SPEC EXISTS
 * --------------------
 * calculator.service.spec.ts pins the formula with mocked config. Three things
 * only happen in the real HTTP pipeline against a real database:
 *
 *   - DTO validation (ValidationPipe + class-validator) — the 400s for a missing
 *     shippingCharged, a negative shippingCost or a negative targetProfit.
 *   - Guards — JwtAuthGuard (401) and PermissionsGuard (403 on PUT shipping for
 *     a role without can_manage_config), which re-read the role from the DB.
 *   - The plan-aware DISTINCT ON query that serves the per-plan seed rows: the
 *     Escala 14 d rate (2.99) must come from tn_gateway_rates, not from a mock.
 *
 * The app is wired exactly like main.ts / app.e2e-spec.ts, so every status code
 * asserted here is the one a client gets in production.
 *
 * REQUIREMENT: the test database on port 5433 (setup-e2e.ts) must be running:
 *   cd hefesto-back && docker compose up -d postgres-test
 * migrationsRun: true applies every migration (incl. CreateTnShippingConfig and
 * AddPlanToGatewayRates) on app init. Run with:
 *   npm run test:e2e -- --testPathPatterns=calculator
 *
 * NOTE: supertest requests carry no CF-Connecting-IP, so the global
 * ThrottlerGuard never limits them.
 *
 * HYGIENE: fixture users are e2e-calc-admin@test.com / e2e-calc-user@test.com
 * (prefix TEST_PREFIX); tn_shipping_config rows are tracked by id. Both are
 * removed in afterEach/afterAll and beforeAll sweeps leftovers from a crashed
 * predecessor run. The pre-phase seed rows are never touched.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import helmet from 'helmet';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { LoggingInterceptor } from '../src/common/interceptors/logging.interceptor';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { extractPermissions } from '../src/common/types/permission';
import { Role } from '../src/roles/entities/role.entity';
import { User } from '../src/users/entities/user.entity';
import {
  TN_GATEWAY_PAGO_NUBE,
  TN_PAYMENT_TARJETA,
  TN_PLAN_ESENCIAL,
} from '../src/constants/tiendanube';

// Unique prefix for all test-created users — makes cleanup safe and targeted.
const TEST_PREFIX = 'e2e-calc-';
const TN_PLAN_ESCALA = 'escala';
const TN_GATEWAY_MERCADO_PAGO = 'mercado_pago';
const TN_PAYMENT_TODOS_LOS_MEDIOS = 'todos_los_medios';

// A v4 UUID that no seeded or test row can carry.
const UNKNOWN_PRODUCT_ID = '00000000-0000-4000-8000-000000000000';

// SPEC case A: 87000 / shipping 7315 charged / 7315 cost, Esencial, 14 d, 1 installment
const CASE_A = {
  productCost: 6534.48,
  sellingPrice: 87000,
  shippingCharged: 7315,
  shippingCost: 7315,
  gatewaySlug: TN_GATEWAY_PAGO_NUBE,
  paymentMethod: TN_PAYMENT_TARJETA,
  withdrawalDays: 14,
  installments: 1,
  planSlug: TN_PLAN_ESENCIAL,
};

// Same inputs for the inverse endpoint; each test states its own targetProfit
const { sellingPrice: _caseASellingPrice, ...CASE_A_INVERSE } = CASE_A;

// The tuple behind UAT Test 1 (G-14-1): the front's default selection is
// activeGateways[0] by slug ASC → mercado_pago, its lowest withdrawal days 0
// (6.29 %), plus CPT Esencial 2 % for non-Pago-Nube gateways. Forward at the
// old fixed ceiling 100000 gives 66601.10 < 70000, so before the fix this
// request returned 400 'Ganancia inalcanzable con estas tasas'.
const UAT_G141_INVERSE = {
  productCost: 4550,
  shippingCharged: 8000,
  shippingCost: 6500,
  targetProfit: 70000,
  gatewaySlug: TN_GATEWAY_MERCADO_PAGO,
  paymentMethod: TN_PAYMENT_TODOS_LOS_MEDIOS,
  withdrawalDays: 0,
  installments: 1,
  planSlug: TN_PLAN_ESENCIAL,
};

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
}

interface DataBody<T> {
  data: T;
}

interface CalcResultBody {
  realProfit: number;
  marginPercent: number;
  shippingCost: number;
}

interface CalcInverseResultBody extends CalcResultBody {
  requiredSellingPrice: number;
}

interface ShippingConfigBody {
  id: string;
  defaultShippingCost: number;
  defaultShippingCharged: number;
}

interface TnConfigAllBody {
  shipping: ShippingConfigBody | null;
}

describe('Calculator HTTP contract (real Postgres)', () => {
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;
  let dataSource: DataSource;
  let userRepo: Repository<User>;
  let roleRepo: Repository<Role>;

  let adminToken: string;
  let userToken: string;

  // tn_shipping_config rows inserted by this suite's own PUTs; removed in afterEach
  const createdShippingIds: string[] = [];

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
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

    dataSource = moduleFixture.get(DataSource);
    const jwtService = moduleFixture.get(JwtService);
    userRepo = dataSource.getRepository(User);
    roleRepo = dataSource.getRepository(Role);

    // Sweep leftovers from a crashed predecessor run before creating fixtures
    await dataSource.query(`DELETE FROM users WHERE email LIKE $1`, [
      `${TEST_PREFIX}%`,
    ]);

    // Seeded system roles: ADMIN (can_manage_config) and USER (can_use_calculator only)
    const adminRole = await roleRepo.findOneOrFail({
      where: { canManageConfig: true, isSystem: true },
    });
    const userRole = await roleRepo.findOneOrFail({
      where: { canManageConfig: false, isSystem: true },
    });

    const admin = await userRepo.save(
      userRepo.create({
        email: `${TEST_PREFIX}admin@test.com`,
        name: 'e2e calc admin',
        role: adminRole,
        isActive: true,
      }),
    );
    const user = await userRepo.save(
      userRepo.create({
        email: `${TEST_PREFIX}user@test.com`,
        name: 'e2e calc user',
        role: userRole,
        isActive: true,
      }),
    );

    // JwtStrategy.validate re-reads the user by email and derives permissions
    // from the DB role, so these tokens exercise the real guards.
    adminToken = jwtService.sign({
      sub: admin.id,
      email: admin.email,
      permissions: extractPermissions(adminRole),
    });
    userToken = jwtService.sign({
      sub: user.id,
      email: user.email,
      permissions: extractPermissions(userRole),
    });
  });

  afterEach(async () => {
    if (createdShippingIds.length > 0) {
      await dataSource.query(
        `DELETE FROM tn_shipping_config WHERE id = ANY($1::uuid[])`,
        [createdShippingIds],
      );
      createdShippingIds.length = 0;
    }
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM users WHERE email LIKE $1`, [
      `${TEST_PREFIX}%`,
    ]);
    await app.close();
  });

  const forward = (): request.Test =>
    request(app.getHttpServer())
      .post('/api/calculator/forward')
      .set('Authorization', `Bearer ${adminToken}`);

  const inverse = (): request.Test =>
    request(app.getHttpServer())
      .post('/api/calculator/inverse')
      .set('Authorization', `Bearer ${adminToken}`);

  // ─── Success paths: the formula and the per-plan seed over real HTTP ───────

  describe('POST /api/calculator/forward', () => {
    it('returns the SPEC case A literals for Esencial (200)', async () => {
      const res = await forward().send(CASE_A).expect(200);
      const body = res.body as DataBody<CalcResultBody>;

      expect(body.data.realProfit).toBe(58773.73);
      expect(body.data.marginPercent).toBe(67.56);
      expect(body.data.shippingCost).toBe(7315);
    });

    it('serves the per-plan Escala 14 d seed row (2.99) through the real DISTINCT ON query (200)', async () => {
      const res = await forward()
        .send({ ...CASE_A, planSlug: TN_PLAN_ESCALA })
        .expect(200);
      const body = res.body as DataBody<CalcResultBody>;

      expect(body.data.realProfit).toBe(59245.3);
    });
  });

  // ─── DTO validation: 400 from the ValidationPipe, never from the service ───

  describe('shipping validation (R1 compat / boundary)', () => {
    it('forward without shippingCharged → 400 naming the missing field', async () => {
      const { shippingCharged: _omitted, ...withoutShippingCharged } = CASE_A;

      const res = await forward().send(withoutShippingCharged).expect(400);
      const body = res.body as ErrorBody;

      expect(body.statusCode).toBe(400);
      expect(Array.isArray(body.message)).toBe(true);
      expect(
        (body.message as string[]).some((m) => m.includes('shippingCharged')),
      ).toBe(true);
    });

    it('forward with shippingCost -1 → 400', async () => {
      const res = await forward()
        .send({ ...CASE_A, shippingCost: -1 })
        .expect(400);

      expect((res.body as ErrorBody).statusCode).toBe(400);
    });

    it('inverse with shippingCost -1 → 400', async () => {
      const res = await inverse()
        .send({ ...CASE_A_INVERSE, targetProfit: 0, shippingCost: -1 })
        .expect(400);

      expect((res.body as ErrorBody).statusCode).toBe(400);
    });
  });

  describe('POST /api/calculator/inverse targetProfit boundary (R7)', () => {
    it('targetProfit -1 → 400', async () => {
      const res = await inverse()
        .send({ ...CASE_A_INVERSE, targetProfit: -1 })
        .expect(400);

      expect((res.body as ErrorBody).statusCode).toBe(400);
    });

    it('targetProfit 0 (break-even) → 200 with |realProfit| <= 0.01', async () => {
      const res = await inverse()
        .send({ ...CASE_A_INVERSE, targetProfit: 0 })
        .expect(200);
      const body = res.body as DataBody<CalcInverseResultBody>;

      expect(Math.abs(body.data.realProfit)).toBeLessThanOrEqual(0.01);
    });
  });

  describe('G-14-1 regression — target above the old fixed ceiling', () => {
    it('mercado_pago default tuple (4550 / 8000 / 6500 / 70000) → 200 with realProfit 70000 and a price above the old ceiling', async () => {
      const res = await inverse().send(UAT_G141_INVERSE).expect(200);
      const body = res.body as DataBody<CalcInverseResultBody>;

      expect(body.data.realProfit).toBe(70000);
      expect(body.data.requiredSellingPrice).toBeCloseTo(104797, 1);
    });
  });

  // ─── Product cost resolution (R8): 400 without any cost, 404 unknown product ──

  describe('product cost resolution (R8)', () => {
    const { productCost: _omittedForward, ...CASE_A_NO_COST } = CASE_A;
    const { productCost: _omittedInverse, ...CASE_A_INVERSE_NO_COST } =
      CASE_A_INVERSE;

    it('forward without productId and without productCost → 400', async () => {
      const res = await forward().send(CASE_A_NO_COST).expect(400);

      expect((res.body as ErrorBody).statusCode).toBe(400);
    });

    it('inverse without productId and without productCost → 400', async () => {
      const res = await inverse()
        .send({ ...CASE_A_INVERSE_NO_COST, targetProfit: 0 })
        .expect(400);

      expect((res.body as ErrorBody).statusCode).toBe(400);
    });

    it('forward with an unknown productId → 404', async () => {
      const res = await forward()
        .send({ ...CASE_A_NO_COST, productId: UNKNOWN_PRODUCT_ID })
        .expect(404);

      expect((res.body as ErrorBody).statusCode).toBe(404);
    });

    it('inverse with an unknown productId → 404', async () => {
      const res = await inverse()
        .send({
          ...CASE_A_INVERSE_NO_COST,
          targetProfit: 0,
          productId: UNKNOWN_PRODUCT_ID,
        })
        .expect(404);

      expect((res.body as ErrorBody).statusCode).toBe(404);
    });
  });

  // ─── Auth ─────────────────────────────────────────────────────────────────

  describe('authentication', () => {
    it('forward without Authorization header → 401', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/calculator/forward')
        .send(CASE_A)
        .expect(401);

      expect((res.body as ErrorBody).statusCode).toBe(401);
    });
  });

  // ─── Shipping default: only can_manage_config may write it (R2, prohibition 3) ──

  describe('PUT /api/tiendanube-config/shipping', () => {
    const shippingPut = (token: string): request.Test =>
      request(app.getHttpServer())
        .put('/api/tiendanube-config/shipping')
        .set('Authorization', `Bearer ${token}`);

    it('USER role (can_use_calculator, no can_manage_config) → 403', async () => {
      const res = await shippingPut(userToken)
        .send({ defaultShippingCost: 100, defaultShippingCharged: 100 })
        .expect(403);

      expect((res.body as ErrorBody).statusCode).toBe(403);
    });

    it('admin with a negative defaultShippingCost → 400', async () => {
      const res = await shippingPut(adminToken)
        .send({ defaultShippingCost: -1, defaultShippingCharged: 7315 })
        .expect(400);

      expect((res.body as ErrorBody).statusCode).toBe(400);
    });

    it('admin with 7315/7315 → 200, and GET /all reports the new row as the current shipping', async () => {
      const putRes = await shippingPut(adminToken)
        .send({ defaultShippingCost: 7315, defaultShippingCharged: 7315 })
        .expect(200);
      const putBody = putRes.body as DataBody<ShippingConfigBody>;

      expect(putBody.data.defaultShippingCost).toBe(7315);
      createdShippingIds.push(putBody.data.id);

      // The row just inserted is the newest one, so "latest wins" holds
      // regardless of what other rows the table already had.
      const allRes = await request(app.getHttpServer())
        .get('/api/tiendanube-config/all')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const allBody = allRes.body as DataBody<TnConfigAllBody>;

      expect(allBody.data.shipping?.defaultShippingCharged).toBe(7315);
      expect(allBody.data.shipping?.defaultShippingCost).toBe(7315);
    });
  });

  // ─── Seed presence (D-07): per-plan row added, pre-phase null-plan row kept ──

  describe('AddPlanToGatewayRates seed on the migrated test DB', () => {
    it('pago_nube / tarjeta / 14 d has an Escala row at 2.99 and keeps at least one null-plan row', async () => {
      const escalaRows = (await dataSource.query(
        `SELECT gr.rate_percent AS "ratePercent"
           FROM tn_gateway_rates gr
           JOIN tn_payment_gateways gw ON gw.id = gr.gateway_id
           JOIN tn_plans pl ON pl.id = gr.plan_id
          WHERE gw.slug = $1
            AND gr.payment_method = $2
            AND gr.withdrawal_days = $3
            AND pl.slug = $4
          ORDER BY gr.created_at DESC
          LIMIT 1`,
        [TN_GATEWAY_PAGO_NUBE, TN_PAYMENT_TARJETA, 14, TN_PLAN_ESCALA],
      )) as Array<{ ratePercent: string }>;

      // decimal columns come back as strings from pg
      expect(escalaRows).toHaveLength(1);
      expect(escalaRows[0].ratePercent).toBe('2.99');

      const nullPlanRows = (await dataSource.query(
        `SELECT COUNT(*)::int AS "count"
           FROM tn_gateway_rates gr
           JOIN tn_payment_gateways gw ON gw.id = gr.gateway_id
          WHERE gw.slug = $1
            AND gr.payment_method = $2
            AND gr.withdrawal_days = $3
            AND gr.plan_id IS NULL`,
        [TN_GATEWAY_PAGO_NUBE, TN_PAYMENT_TARJETA, 14],
      )) as Array<{ count: number }>;

      // >= 1 (not = 1): the pre-phase seed row survives; a leftover from an
      // interrupted run must not fail this hygiene check.
      expect(nullPlanRows[0].count).toBeGreaterThanOrEqual(1);
    });
  });
});
