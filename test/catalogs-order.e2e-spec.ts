/**
 * catalogs-order.e2e-spec.ts
 *
 * WHY THIS SPEC EXISTS
 * --------------------
 * Catalog order is persisted data (Phase 15, R1): every catalog dimension
 * carries `sort_order`, GET orders by `sort_order, name`, and new items land
 * last. Three things here only exist against a real Postgres:
 *
 *   - The one-way backfill (AddSortOrderToCatalogs1773500000000) must keep the
 *     visible order identical and produce dense 0..n-1 values. It is proven on
 *     TEMP tables with crafted rows (sparse 5/10/20 values, ties at 0, empty),
 *     so seeded catalogs are never touched by the proof.
 *   - The ORDER BY the GET query emits, with ties broken by name.
 *   - The ValidationPipe rejecting a client-sent sortOrder (whitelist +
 *     forbidNonWhitelisted), so order only changes through the reorder endpoint.
 *
 * The app is wired exactly like main.ts / calculator.e2e-spec.ts.
 *
 * REQUIREMENT: the test database on port 5433 (setup-e2e.ts) must be running:
 *   cd hefesto-back && docker compose up -d --wait postgres-test
 * Run with:
 *   npx jest --config ./test/jest-e2e.json --runInBand test/catalogs-order.e2e-spec.ts
 *
 * HYGIENE: fixture rows and the admin user carry TEST_PREFIX and are swept in
 * beforeAll (crashed predecessor run) and afterAll. After the sweep, beforeAll
 * renumbers the dimensions this suite writes to densely (current order kept),
 * so leftovers of a crashed run cannot ratchet MAX(sort_order)+1 toward the
 * SMALLINT limit. Temp tables live on one dedicated QueryRunner connection and
 * are dropped before it is released.
 */

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import helmet from 'helmet';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, QueryRunner, Repository } from 'typeorm';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { LoggingInterceptor } from '../src/common/interceptors/logging.interceptor';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor';
import {
  ADMIN_ROLE_NAME,
  extractPermissions,
} from '../src/common/types/permission';
import {
  BackfillOrderBy,
  backfillSortOrder,
} from '../src/database/backfill-sort-order';
import { Role } from '../src/roles/entities/role.entity';
import { User } from '../src/users/entities/user.entity';

// Unique prefix for every test-created row — makes cleanup safe and targeted.
const TEST_PREFIX = 'e2e-catord-';

const ALL_DIMENSIONS = [
  'product-types',
  'product-names',
  'product-finishes',
  'product-colors',
  'product-sizes',
  'supply-types',
  'expense-categories',
] as const;

// Tables this suite inserts into; swept and renumbered in beforeAll.
const TOUCHED_TABLES = ['product_colors', 'product_finishes'] as const;

// Temp tables (session-local to the dedicated QueryRunner connection).
const TMP_SIZES = 'tmp_catord_sizes';
const TMP_NAMES = 'tmp_catord_names';
const TMP_EMPTY = 'tmp_catord_empty';
const TMP_GUARD = 'tmp_catord_guard';
const TEMP_TABLES = [TMP_SIZES, TMP_NAMES, TMP_EMPTY, TMP_GUARD] as const;

// High enough to sort after every dense seeded value, below SMALLINT max (32767).
const HIGH_SORT_ORDER = 30000;

interface DataBody<T> {
  data: T;
}

interface CatalogItemBody {
  id: string;
  name: string;
  sortOrder: number;
}

interface NameSortRow {
  name: string;
  sort_order: number;
}

interface CountRow {
  count: string;
}

describe('Catalog sort order (real Postgres)', () => {
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;
  let dataSource: DataSource;
  let queryRunner: QueryRunner;
  let userRepo: Repository<User>;
  let roleRepo: Repository<Role>;

  let adminToken: string;

  const sweepFixtures = async (): Promise<void> => {
    for (const table of TOUCHED_TABLES) {
      await dataSource.query(`DELETE FROM "${table}" WHERE name LIKE $1`, [
        `${TEST_PREFIX}%`,
      ]);
    }
    await dataSource.query(`DELETE FROM users WHERE email LIKE $1`, [
      `${TEST_PREFIX}%`,
    ]);
  };

  const readNamesInOrder = async (table: string): Promise<NameSortRow[]> =>
    queryRunner.query(
      `SELECT "name", "sort_order" FROM "${table}" ORDER BY "sort_order", "name"`,
    ) as Promise<NameSortRow[]>;

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
    userRepo = dataSource.getRepository(User);
    roleRepo = dataSource.getRepository(Role);

    queryRunner = dataSource.createQueryRunner();
    await queryRunner.connect();

    // Sweep leftovers from a crashed predecessor run, then renumber densely
    await sweepFixtures();
    for (const table of TOUCHED_TABLES) {
      await backfillSortOrder(queryRunner, table, '"sort_order", "name"');
    }

    // By name, not by stored flags: other suites flip ADMIN's flags (D-18
    // ignores them), and a crashed run would leave them flipped.
    const adminRole = await roleRepo.findOneByOrFail({ name: ADMIN_ROLE_NAME });
    // TypeORM drops an undefined condition, so pin that we got the ADMIN row
    expect(adminRole.name).toBe(ADMIN_ROLE_NAME);
    const admin = await userRepo.save(
      userRepo.create({
        email: `${TEST_PREFIX}admin@test.com`,
        name: 'e2e catord admin',
        role: adminRole,
        isActive: true,
      }),
    );

    adminToken = jwtService.sign({
      sub: admin.id,
      email: admin.email,
      permissions: extractPermissions(adminRole),
    });
  });

  afterAll(async () => {
    for (const table of TEMP_TABLES) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
    await queryRunner.release();
    await sweepFixtures();
    await app.close();
  });

  const getDimension = async (
    dimension: string,
  ): Promise<CatalogItemBody[]> => {
    const res = await request(app.getHttpServer())
      .get(`/api/catalogs/${dimension}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    return (res.body as DataBody<CatalogItemBody[]>).data;
  };

  const createItem = async (
    dimension: string,
    name: string,
  ): Promise<CatalogItemBody> => {
    const res = await request(app.getHttpServer())
      .post(`/api/catalogs/${dimension}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name })
      .expect(201);
    return (res.body as DataBody<CatalogItemBody>).data;
  };

  // ─── Backfill (migration helper) on temp tables ─────────────────────────────

  describe('backfillSortOrder', () => {
    it('sizes shape: keeps the sort_order, name order and makes values dense 0..n-1', async () => {
      await queryRunner.query(
        `CREATE TEMP TABLE "${TMP_SIZES}" (LIKE product_sizes INCLUDING DEFAULTS)`,
      );
      await queryRunner.query(
        `INSERT INTO "${TMP_SIZES}" ("name", "sku_code", "sort_order") VALUES
          ('xl', 1, 50), ('l', 2, 30), ('m', 3, 20), ('s', 4, 10),
          ('xs', 5, 5), ('unico', 6, 0), ('grande', 7, 0)`,
      );
      const before = (await readNamesInOrder(TMP_SIZES)).map((r) => r.name);
      expect(before).toEqual(['grande', 'unico', 'xs', 's', 'm', 'l', 'xl']);

      await backfillSortOrder(queryRunner, TMP_SIZES, '"sort_order", "name"');

      const after = await readNamesInOrder(TMP_SIZES);
      expect(after.map((r) => r.name)).toEqual(before);
      expect(after.map((r) => Number(r.sort_order))).toEqual([
        0, 1, 2, 3, 4, 5, 6,
      ]);
    });

    it('name shape: orders all-zero rows by name with values 0..n-1', async () => {
      await queryRunner.query(
        `CREATE TEMP TABLE "${TMP_NAMES}" (LIKE product_types INCLUDING DEFAULTS)`,
      );
      await queryRunner.query(
        `INSERT INTO "${TMP_NAMES}" ("name", "sku_code", "sort_order") VALUES
          ('delta', 1, 0), ('alfa', 2, 0), ('charlie', 3, 0), ('bravo', 4, 0)`,
      );

      await backfillSortOrder(queryRunner, TMP_NAMES, '"name"');

      const after = (await queryRunner.query(
        `SELECT "name", "sort_order" FROM "${TMP_NAMES}" ORDER BY "sort_order"`,
      )) as NameSortRow[];
      expect(after.map((r) => r.name)).toEqual([
        'alfa',
        'bravo',
        'charlie',
        'delta',
      ]);
      expect(after.map((r) => Number(r.sort_order))).toEqual([0, 1, 2, 3]);
    });

    it('empty table: resolves and the table stays empty', async () => {
      await queryRunner.query(
        `CREATE TEMP TABLE "${TMP_EMPTY}" (LIKE product_types INCLUDING DEFAULTS)`,
      );

      await expect(
        backfillSortOrder(queryRunner, TMP_EMPTY, '"name"'),
      ).resolves.toBeUndefined();

      const [{ count }] = (await queryRunner.query(
        `SELECT COUNT(*) AS count FROM "${TMP_EMPTY}"`,
      )) as CountRow[];
      expect(Number(count)).toBe(0);
    });

    it('rejects a table name that is not a plain identifier with a TypeError', async () => {
      await expect(
        backfillSortOrder(queryRunner, 'product_types; drop', '"name"'),
      ).rejects.toThrow(TypeError);
    });

    it('rejects an orderBy outside the allowlist with a TypeError before any SQL runs', async () => {
      await queryRunner.query(
        `CREATE TEMP TABLE "${TMP_GUARD}" (LIKE product_types INCLUDING DEFAULTS)`,
      );
      await queryRunner.query(
        `INSERT INTO "${TMP_GUARD}" ("name", "sku_code", "sort_order") VALUES
          ('b', 1, 9), ('a', 2, 4)`,
      );

      await expect(
        backfillSortOrder(
          queryRunner,
          TMP_GUARD,
          '"name"; select 1' as BackfillOrderBy,
        ),
      ).rejects.toThrow(TypeError);

      const rows = (await queryRunner.query(
        `SELECT "name", "sort_order" FROM "${TMP_GUARD}" ORDER BY "name"`,
      )) as NameSortRow[];
      expect(rows.map((r) => [r.name, Number(r.sort_order)])).toEqual([
        ['a', 4],
        ['b', 9],
      ]);
    });
  });

  // ─── GET /api/catalogs/:dimension ordering ──────────────────────────────────

  describe('GET /api/catalogs/:dimension', () => {
    it('orders by sort_order, then name on ties', async () => {
      const b = await createItem('product-colors', `${TEST_PREFIX}b`);
      const a = await createItem('product-colors', `${TEST_PREFIX}a`);
      const z = await createItem('product-colors', `${TEST_PREFIX}z`);

      await dataSource.query(
        `UPDATE product_colors SET sort_order = $1 WHERE id = ANY($2::uuid[])`,
        [HIGH_SORT_ORDER, [a.id, b.id]],
      );
      await dataSource.query(
        `UPDATE product_colors SET sort_order = $1 WHERE id = $2`,
        [HIGH_SORT_ORDER - 1, z.id],
      );

      const fixtureIds = new Set([a.id, b.id, z.id]);
      const items = await getDimension('product-colors');
      const fixtureOrder = items
        .filter((item) => fixtureIds.has(item.id))
        .map((item) => item.id);

      expect(fixtureOrder).toEqual([z.id, a.id, b.id]);
    });

    it.each(ALL_DIMENSIONS)(
      '%s returns items with a numeric, non-decreasing sortOrder',
      async (dimension) => {
        const items = await getDimension(dimension);

        for (const item of items) {
          expect(typeof item.sortOrder).toBe('number');
        }
        for (let i = 1; i < items.length; i++) {
          expect(items[i].sortOrder).toBeGreaterThanOrEqual(
            items[i - 1].sortOrder,
          );
        }
      },
    );
  });

  // ─── POST /api/catalogs/:dimension: new items land last ─────────────────────

  describe('POST /api/catalogs/:dimension', () => {
    it('puts the created item last in GET', async () => {
      const created = await createItem('product-finishes', `${TEST_PREFIX}new`);

      const items = await getDimension('product-finishes');

      expect(items[items.length - 1].id).toBe(created.id);
    });

    it('rejects a client-sent sortOrder with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/catalogs/product-finishes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `${TEST_PREFIX}bad`, sortOrder: 0 })
        .expect(400);
    });
  });
});
