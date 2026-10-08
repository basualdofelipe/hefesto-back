/**
 * catalogs-reorder.e2e-spec.ts
 *
 * WHY THIS SPEC EXISTS
 * --------------------
 * PUT /api/catalogs/:dimension/order (Phase 15, R2, D-02) is the only write
 * path for manual catalog order. These only exist against a real Postgres:
 *
 *   - Route order: 'order' must never reach PUT :dimension/:id's
 *     ParseUUIDPipe (RESEARCH Pitfall 1).
 *   - Atomicity: every rejected request (set mismatch, stale client state)
 *     leaves the stored order untouched.
 *   - Concurrency: two valid reorders of one dimension queue on the row locks
 *     (taken in id order) instead of deadlocking, and the last one wins.
 *   - R4: moving an expense category changes its position in the list the
 *     /finanzas/gastos selectors render.
 *
 * Empty and single-item dimensions cannot be held over HTTP (all seven are
 * seeded and referenced); those boundaries are unit-tested on assertSameSet.
 *
 * The app is wired exactly like main.ts / calculator.e2e-spec.ts, but it
 * binds its own ephemeral port: supertest otherwise calls listen(0)/close()
 * per request, which races when two requests run concurrently.
 *
 * REQUIREMENT: the test database on port 5433 (setup-e2e.ts) must be running:
 *   cd hefesto-back && docker compose up -d --wait postgres-test
 * Run with:
 *   npx jest --config ./test/jest-e2e.json --runInBand test/catalogs-reorder.e2e-spec.ts
 *
 * HYGIENE: fixture rows and users carry TEST_PREFIX and are swept in beforeAll
 * (crashed predecessor run) and afterAll. The product-finishes order is
 * snapshotted in beforeAll and restored densely in afterAll with a
 * parameterized UPDATE; the expense-categories case restores its own snapshot
 * in a finally, and afterAll re-checks it.
 */

import { randomUUID } from 'crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import helmet from 'helmet';
import request, { Response } from 'supertest';
import { App } from 'supertest/types';
import { DataSource, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { LoggingInterceptor } from '../src/common/interceptors/logging.interceptor';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import { extractPermissions } from '../src/common/types/permission';
import { Role } from '../src/roles/entities/role.entity';
import { User } from '../src/users/entities/user.entity';

// Unique prefix for every test-created row — makes cleanup safe and targeted.
const TEST_PREFIX = 'e2e-reord-';

const DIMENSION = 'product-finishes';
const DIMENSION_TABLE = 'product_finishes';
const EXPENSE_DIMENSION = 'expense-categories';
const EXPENSE_TABLE = 'expense_categories';

const MISMATCH_MESSAGE =
  'El orden enviado no coincide con los ítems actuales del catálogo';

interface DataBody<T> {
  data: T;
}

interface CatalogItemBody {
  id: string;
  name: string;
  sortOrder: number;
}

interface ErrorBody {
  statusCode: number;
  message: string | string[];
}

describe('Catalog reorder HTTP contract (real Postgres)', () => {
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;
  let dataSource: DataSource;
  let userRepo: Repository<User>;
  let roleRepo: Repository<Role>;

  let adminToken: string;
  let userToken: string;

  // Order of the dimensions this suite writes to, taken after the sweep.
  let originalFinishIds: string[];
  let originalExpenseIds: string[];

  const sweepFixtures = async (): Promise<void> => {
    await dataSource.query(
      `DELETE FROM "${DIMENSION_TABLE}" WHERE name LIKE $1`,
      [`${TEST_PREFIX}%`],
    );
    await dataSource.query(`DELETE FROM users WHERE email LIKE $1`, [
      `${TEST_PREFIX}%`,
    ]);
  };

  // Dense 0..n-1 in the given order; independent of the endpoint under test.
  const writeOrder = async (table: string, ids: string[]): Promise<void> => {
    await dataSource.query(
      `UPDATE "${table}" AS t SET "sort_order" = (v.ord - 1)::smallint
         FROM unnest($1::uuid[]) WITH ORDINALITY AS v(id, ord)
        WHERE t."id" = v.id`,
      [ids],
    );
  };

  const readIdsInOrder = async (table: string): Promise<string[]> => {
    const rows = (await dataSource.query(
      `SELECT "id" FROM "${table}" ORDER BY "sort_order", "name"`,
    )) as { id: string }[];
    return rows.map((row) => row.id);
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
    await app.listen(0);

    dataSource = moduleFixture.get(DataSource);
    const jwtService = moduleFixture.get(JwtService);
    userRepo = dataSource.getRepository(User);
    roleRepo = dataSource.getRepository(Role);

    await sweepFixtures();
    originalFinishIds = await readIdsInOrder(DIMENSION_TABLE);
    originalExpenseIds = await readIdsInOrder(EXPENSE_TABLE);

    // Seeded system roles: ADMIN (can_edit_products) and USER (without it)
    const adminRole = await roleRepo.findOneOrFail({
      where: { canManageConfig: true, isSystem: true },
    });
    const userRole = await roleRepo.findOneOrFail({
      where: { canManageConfig: false, isSystem: true },
    });

    const admin = await userRepo.save(
      userRepo.create({
        email: `${TEST_PREFIX}admin@test.com`,
        name: 'e2e reord admin',
        role: adminRole,
        isActive: true,
      }),
    );
    const user = await userRepo.save(
      userRepo.create({
        email: `${TEST_PREFIX}user@test.com`,
        name: 'e2e reord user',
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

  afterAll(async () => {
    await sweepFixtures();
    await writeOrder(DIMENSION_TABLE, originalFinishIds);
    const restoredExpenseIds = await readIdsInOrder(EXPENSE_TABLE);
    await app.close();

    expect(restoredExpenseIds).toEqual(originalExpenseIds);
  });

  const getIds = async (dimension: string): Promise<string[]> => {
    const res = await request(app.getHttpServer())
      .get(`/api/catalogs/${dimension}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    return (res.body as DataBody<CatalogItemBody[]>).data.map(
      (item) => item.id,
    );
  };

  const putOrder = (
    dimension: string,
    body: object,
    token: string = adminToken,
  ): Promise<Response> =>
    request(app.getHttpServer())
      .put(`/api/catalogs/${dimension}/order`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const createFinish = async (suffix: string): Promise<CatalogItemBody> => {
    const res = await request(app.getHttpServer())
      .post(`/api/catalogs/${DIMENSION}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `${TEST_PREFIX}${suffix}` })
      .expect(201);
    return (res.body as DataBody<CatalogItemBody>).data;
  };

  const expectMismatch = (res: Response): void => {
    expect(res.status).toBe(400);
    expect((res.body as ErrorBody).message).toBe(MISMATCH_MESSAGE);
  };

  // ─── Valid reorder ──────────────────────────────────────────────────────────

  it('applies a valid permutation: 200, the list in the requested order, persisted', async () => {
    const reversed = [...(await getIds(DIMENSION))].reverse();

    const res = await putOrder(DIMENSION, { ids: reversed });

    expect(res.status).toBe(200);
    const data = (res.body as DataBody<CatalogItemBody[]>).data;
    expect(data.map((item) => item.id)).toEqual(reversed);
    expect(data.map((item) => item.sortOrder)).toEqual(
      reversed.map((_id, index) => index),
    );
    expect(await getIds(DIMENSION)).toEqual(reversed);
  });

  // ─── Set mismatches: 400, nothing changes ───────────────────────────────────

  it.each<[string, (ids: string[]) => string[]]>([
    ['an empty list on a non-empty dimension', () => []],
    ['an unknown id', (ids) => [...ids.slice(0, -1), randomUUID()]],
    ['a duplicate id at equal length', (ids) => [...ids.slice(0, -1), ids[0]]],
    ['a missing id', (ids) => ids.slice(0, -1)],
    ['an extra id', (ids) => [...ids, randomUUID()]],
  ])(
    'rejects %s with 400 and leaves the order unchanged',
    async (_label, mutate) => {
      const before = await getIds(DIMENSION);

      const res = await putOrder(DIMENSION, { ids: mutate(before) });

      expectMismatch(res);
      expect(await getIds(DIMENSION)).toEqual(before);
    },
  );

  // ─── DTO validation (not ParseUUIDPipe) ─────────────────────────────────────

  // The messages are ReorderCatalogDto's own: a shadowing PUT :dimension/:id
  // would answer with ParseUUIDPipe's or UpdateCatalogItemDto's instead.
  it('rejects a non-UUID id in the DTO, not in ParseUUIDPipe', async () => {
    const res = await putOrder(DIMENSION, { ids: ['not-a-uuid'] });

    expect(res.status).toBe(400);
    const message = JSON.stringify((res.body as ErrorBody).message);
    expect(message).toContain('Cada id debe ser un UUID');
    expect(message).not.toContain('uuid is expected');
  });

  it('rejects a body without ids with 400 from the DTO', async () => {
    const res = await putOrder(DIMENSION, {});

    expect(res.status).toBe(400);
    expect(JSON.stringify((res.body as ErrorBody).message)).toContain(
      'ids debe ser una lista',
    );
  });

  // ─── Stale client state ─────────────────────────────────────────────────────

  it('rejects ids read before a create with 400; the order is unchanged', async () => {
    const staleIds = await getIds(DIMENSION);
    const created = await createFinish('stale-create');

    const res = await putOrder(DIMENSION, { ids: [...staleIds].reverse() });

    expectMismatch(res);
    expect(await getIds(DIMENSION)).toEqual([...staleIds, created.id]);
  });

  it('rejects ids read before a delete with 400; the order is unchanged', async () => {
    const created = await createFinish('stale-delete');
    const staleIds = await getIds(DIMENSION);
    await request(app.getHttpServer())
      .delete(`/api/catalogs/${DIMENSION}/${created.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const res = await putOrder(DIMENSION, { ids: [...staleIds].reverse() });

    expectMismatch(res);
    expect(await getIds(DIMENSION)).toEqual(
      staleIds.filter((id) => id !== created.id),
    );
  });

  // ─── Sequential and concurrent valid reorders ───────────────────────────────

  it('lets the last of two valid reorders win', async () => {
    const current = await getIds(DIMENSION);
    const orderA = [...current].reverse();
    const orderB = [...current.slice(1), current[0]];

    expect((await putOrder(DIMENSION, { ids: orderA })).status).toBe(200);
    expect((await putOrder(DIMENSION, { ids: orderB })).status).toBe(200);

    expect(await getIds(DIMENSION)).toEqual(orderB);
  });

  it('serves two concurrent valid reorders without a deadlock; one wins in full', async () => {
    const current = await getIds(DIMENSION);
    const orderA = [...current].reverse();
    const orderB = [current[current.length - 1], ...current.slice(0, -1)];

    const [resA, resB] = await Promise.all([
      putOrder(DIMENSION, { ids: orderA }),
      putOrder(DIMENSION, { ids: orderB }),
    ]);

    expect([resA.status, resB.status]).toEqual([200, 200]);
    expect([orderA, orderB]).toContainEqual(await getIds(DIMENSION));
  });

  // ─── Authorization and unknown dimension ────────────────────────────────────

  it('rejects a user without can_edit_products with 403', async () => {
    const ids = await getIds(DIMENSION);

    const res = await putOrder(DIMENSION, { ids }, userToken);

    expect(res.status).toBe(403);
  });

  it('rejects an unknown dimension with 404', async () => {
    const res = await putOrder('nope', { ids: [randomUUID()] });

    expect(res.status).toBe(404);
  });

  // ─── R4: expense categories feed the /finanzas/gastos selectors ─────────────

  it('moves an expense category to the front of the list the gastos selectors render', async () => {
    const snapshot = await getIds(EXPENSE_DIMENSION);
    expect(snapshot.length).toBeGreaterThanOrEqual(2);
    const moved = snapshot[snapshot.length - 1];
    const requested = [moved, ...snapshot.slice(0, -1)];

    try {
      const res = await putOrder(EXPENSE_DIMENSION, { ids: requested });
      expect(res.status).toBe(200);

      const after = await getIds(EXPENSE_DIMENSION);
      expect(after[0]).toBe(moved);
      expect(after.slice(1)).toEqual(snapshot.slice(0, -1));
    } finally {
      await putOrder(EXPENSE_DIMENSION, { ids: snapshot });
    }
  });
});
