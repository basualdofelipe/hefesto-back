/**
 * catalog-order-lists.e2e-spec.ts
 *
 * WHY THIS SPEC EXISTS
 * --------------------
 * Phase 15 (R4, D-11): the API returns its lists already in catalog order, and
 * the front only preserves arrival order. Only a real Postgres proves it:
 *
 *   - Products: tipo → nombre → terminación → color → talle, each level by its
 *     catalog sort_order with the name as the tiebreak at that level
 *     (PRODUCT_CATALOG_ORDER). The SPEC acceptance case is sizes XS, S, M, L,
 *     XL, whose names sort alphabetically as L, M, S, XL, XS.
 *   - POST /api/products/batch returns its created variants in that order too.
 *   - Supplies: grouped by supply type in catalog order (type sort_order, then
 *     type name), by supply name inside a type — supplies are not a catalog.
 *
 * FIXTURE TECHNIQUE: catalog rows are created through the API (the real path),
 * then given crafted sort_order values with parameterized UPDATEs on their own
 * ids. Assertions compare only the relative order of fixture rows, never names
 * sorted in JS, so they do not depend on DB collation or on seeded data.
 *
 * REQUIREMENT: the test database on port 5433 (setup-e2e.ts) must be running:
 *   cd hefesto-back && docker compose up -d --wait postgres-test
 * Run with:
 *   npx jest --config ./test/jest-e2e.json --runInBand test/catalog-order-lists.e2e-spec.ts
 *
 * HYGIENE: every fixture row carries TEST_PREFIX. beforeAll sweeps leftovers
 * from a crashed predecessor run, then renumbers every dimension this suite
 * touches densely (current order kept), so the crafted 29980–30010 values can
 * never ratchet MAX+1 toward the SMALLINT limit across runs. afterAll removes
 * children before parents.
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
import { backfillSortOrder } from '../src/database/backfill-sort-order';
import { Role } from '../src/roles/entities/role.entity';
import { User } from '../src/users/entities/user.entity';

// Unique prefix for every test-created row — makes cleanup safe and targeted.
const TEST_PREFIX = 'e2e-lists-';

// Product dimensions: API path → table. Order matters for cleanup only.
const PRODUCT_DIMENSIONS = [
  { path: 'product-types', table: 'product_types', fk: 'product_type_id' },
  { path: 'product-names', table: 'product_names', fk: 'product_name_id' },
  {
    path: 'product-finishes',
    table: 'product_finishes',
    fk: 'product_finish_id',
  },
  { path: 'product-colors', table: 'product_colors', fk: 'product_color_id' },
  { path: 'product-sizes', table: 'product_sizes', fk: 'product_size_id' },
] as const;

type ProductDimensionPath = (typeof PRODUCT_DIMENSIONS)[number]['path'];
type CatalogTable =
  | (typeof PRODUCT_DIMENSIONS)[number]['table']
  | 'supply_types';

// Every table whose sort_order this suite writes; renumbered in beforeAll.
const RENUMBERED_TABLES: readonly CatalogTable[] = [
  ...PRODUCT_DIMENSIONS.map((dimension) => dimension.table),
  'supply_types',
];

interface SupplyBody {
  id: string;
  name: string;
  type: CatalogItemBody;
}

interface DataBody<T> {
  data: T;
}

interface CatalogItemBody {
  id: string;
  name: string;
  sortOrder: number;
}

interface ProductBody {
  id: string;
  type: CatalogItemBody;
  name: CatalogItemBody;
  finish: CatalogItemBody;
  color: CatalogItemBody;
  size: CatalogItemBody;
}

describe('Catalog order in product and supply lists (real Postgres)', () => {
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;
  let dataSource: DataSource;
  let userRepo: Repository<User>;
  let roleRepo: Repository<Role>;

  let adminToken: string;

  // Products created by this suite; removed in afterAll before catalog rows.
  const createdProductIds: string[] = [];

  const sweepFixtures = async (): Promise<void> => {
    const prefix = `${TEST_PREFIX}%`;

    // Children first: products that reference any prefixed catalog row.
    const productFilter = PRODUCT_DIMENSIONS.map(
      (dimension) =>
        `"${dimension.fk}" IN (SELECT "id" FROM "${dimension.table}" WHERE "name" LIKE $1)`,
    ).join(' OR ');
    await dataSource.query(`DELETE FROM "products" WHERE ${productFilter}`, [
      prefix,
    ]);

    await dataSource.query(
      `DELETE FROM "supplies"
        WHERE "name" LIKE $1
           OR "type_id" IN (SELECT "id" FROM "supply_types" WHERE "name" LIKE $1)
           OR "supplier_id" IN (SELECT "id" FROM "suppliers" WHERE "name" LIKE $1)`,
      [prefix],
    );
    await dataSource.query(`DELETE FROM "suppliers" WHERE "name" LIKE $1`, [
      prefix,
    ]);

    for (const table of RENUMBERED_TABLES) {
      await dataSource.query(`DELETE FROM "${table}" WHERE "name" LIKE $1`, [
        prefix,
      ]);
    }

    await dataSource.query(`DELETE FROM users WHERE email LIKE $1`, [prefix]);
  };

  const renumberDensely = async (): Promise<void> => {
    const queryRunner = dataSource.createQueryRunner();
    try {
      for (const table of RENUMBERED_TABLES) {
        await backfillSortOrder(queryRunner, table, '"sort_order", "name"');
      }
    } finally {
      await queryRunner.release();
    }
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
    userRepo = dataSource.getRepository(User);
    roleRepo = dataSource.getRepository(Role);

    await sweepFixtures();
    await renumberDensely();

    const adminRole = await roleRepo.findOneOrFail({
      where: { canManageConfig: true, isSystem: true },
    });
    const admin = await userRepo.save(
      userRepo.create({
        email: `${TEST_PREFIX}admin@test.com`,
        name: 'e2e lists admin',
        role: adminRole,
        isActive: true,
      }),
    );

    // JwtStrategy.validate re-reads the user by email and derives permissions
    // from the DB role, so this token exercises the real guards.
    adminToken = jwtService.sign({
      sub: admin.id,
      email: admin.email,
      permissions: extractPermissions(adminRole),
    });
  });

  afterAll(async () => {
    if (createdProductIds.length > 0) {
      await dataSource.query(
        `DELETE FROM "products" WHERE "id" = ANY($1::uuid[])`,
        [createdProductIds],
      );
    }
    await sweepFixtures();
    await app.close();
  });

  // ─── Helpers ────────────────────────────────────────────────────────────────

  const createCatalogItem = async (
    dimension: ProductDimensionPath | 'supply-types',
    suffix: string,
  ): Promise<CatalogItemBody> => {
    const res = await request(app.getHttpServer())
      .post(`/api/catalogs/${dimension}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `${TEST_PREFIX}${suffix}` })
      .expect(201);
    return (res.body as DataBody<CatalogItemBody>).data;
  };

  // Crafted order on fixture ids only, with bound parameters (T-15-28).
  const setSortOrder = async (
    table: CatalogTable,
    id: string,
    sortOrder: number,
  ): Promise<void> => {
    await dataSource.query(
      `UPDATE "${table}" SET "sort_order" = $1 WHERE "id" = $2`,
      [sortOrder, id],
    );
  };

  const createBatch = async (body: {
    typeId: string;
    nameId: string;
    finishId: string;
    colorIds: string[];
    sizeIds: string[];
  }): Promise<ProductBody[]> => {
    const res = await request(app.getHttpServer())
      .post('/api/products/batch')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(201);
    const created = (res.body as DataBody<ProductBody[]>).data;
    createdProductIds.push(...created.map((product) => product.id));
    return created;
  };

  // GET /api/products, keeping only the given products, in arrival order.
  const listProducts = async (ids: string[]): Promise<ProductBody[]> => {
    const wanted = new Set(ids);
    const res = await request(app.getHttpServer())
      .get('/api/products')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    return (res.body as DataBody<ProductBody[]>).data.filter((product) =>
      wanted.has(product.id),
    );
  };

  // ─── Products: 5-level catalog order ────────────────────────────────────────

  describe('GET /api/products and POST /api/products/batch', () => {
    let type: CatalogItemBody;
    let productName: CatalogItemBody;
    let finish: CatalogItemBody;
    let color: CatalogItemBody;
    // Created in an order that is neither the catalog nor the alphabetical one.
    const sizesBySuffix = new Map<string, CatalogItemBody>();
    const catalogSizeOrder = ['xs', 's', 'm', 'l', 'xl'];

    let batchResponse: ProductBody[];

    const sizeId = (suffix: string): string => {
      const size = sizesBySuffix.get(suffix);
      if (!size) throw new TypeError(`missing size fixture ${suffix}`);
      return size.id;
    };

    beforeAll(async () => {
      type = await createCatalogItem('product-types', 'tipo');
      productName = await createCatalogItem('product-names', 'nombre');
      finish = await createCatalogItem('product-finishes', 'terminacion');
      color = await createCatalogItem('product-colors', 'color');

      for (const suffix of ['xl', 'l', 'm', 's', 'xs']) {
        sizesBySuffix.set(
          suffix,
          await createCatalogItem('product-sizes', suffix),
        );
      }
      // Written last-to-first: Postgres appends each updated row version, so
      // the physical order ends up XL..XS and an unordered read cannot pass
      // these tests by accident.
      for (const [index, suffix] of [...catalogSizeOrder.entries()].reverse()) {
        await setSortOrder('product_sizes', sizeId(suffix), 30000 + index);
      }

      // Sizes sent in creation order (xl first), not catalog order.
      batchResponse = await createBatch({
        typeId: type.id,
        nameId: productName.id,
        finishId: finish.id,
        colorIds: [color.id],
        sizeIds: ['xl', 'l', 'm', 's', 'xs'].map(sizeId),
      });
    });

    const expectedSizeNames = (): string[] =>
      catalogSizeOrder.map((suffix) => `${TEST_PREFIX}${suffix}`);

    it('lists one family by size catalog order XS, S, M, L, XL, not by size name', async () => {
      const listed = await listProducts(batchResponse.map((p) => p.id));

      expect(listed.map((product) => product.size.name)).toEqual(
        expectedSizeNames(),
      );
    });

    it('returns the batch-created variants in size catalog order', () => {
      expect(batchResponse.map((product) => product.size.name)).toEqual(
        expectedSizeNames(),
      );
    });

    it('puts the products of the type that comes first in the catalog first', async () => {
      const zeta = await createCatalogItem('product-types', 'zeta');
      const alfa = await createCatalogItem('product-types', 'alfa');
      await setSortOrder('product_types', zeta.id, 29990);
      await setSortOrder('product_types', alfa.id, 29991);

      const [alfaProduct] = await createBatch({
        typeId: alfa.id,
        nameId: productName.id,
        finishId: finish.id,
        colorIds: [color.id],
        sizeIds: [sizeId('xs')],
      });
      const [zetaProduct] = await createBatch({
        typeId: zeta.id,
        nameId: productName.id,
        finishId: finish.id,
        colorIds: [color.id],
        sizeIds: [sizeId('xs')],
      });

      const listed = await listProducts([alfaProduct.id, zetaProduct.id]);

      expect(listed.map((product) => product.id)).toEqual([
        zetaProduct.id,
        alfaProduct.id,
      ]);
    });

    it('breaks a sort_order tie at one level by name, in GET and in the batch response', async () => {
      // c-b created and written first, so it is also first physically.
      const colorB = await createCatalogItem('product-colors', 'c-b');
      const colorA = await createCatalogItem('product-colors', 'c-a');
      await setSortOrder('product_colors', colorB.id, 30010);
      await setSortOrder('product_colors', colorA.id, 30010);

      const created = await createBatch({
        typeId: type.id,
        nameId: productName.id,
        finishId: finish.id,
        colorIds: [colorB.id, colorA.id],
        sizeIds: [sizeId('xs')],
      });

      const listed = await listProducts(created.map((product) => product.id));

      expect(created.map((product) => product.color.id)).toEqual([
        colorA.id,
        colorB.id,
      ]);
      expect(listed.map((product) => product.color.id)).toEqual([
        colorA.id,
        colorB.id,
      ]);
    });
  });

  // ─── Supplies: grouped by supply type in catalog order ──────────────────────

  describe('GET /api/supplies', () => {
    const createSupply = async (
      suffix: string,
      typeId: string,
      supplierId: string,
    ): Promise<SupplyBody> => {
      const res = await request(app.getHttpServer())
        .post('/api/supplies')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: `${TEST_PREFIX}${suffix}`,
          typeId,
          supplierId,
          unitType: 'unidad',
        })
        .expect(201);
      return (res.body as DataBody<SupplyBody>).data;
    };

    it('groups supplies by supply type catalog order, then by supply name', async () => {
      const supplierRes = await request(app.getHttpServer())
        .post('/api/suppliers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: `${TEST_PREFIX}supplier` })
        .expect(201);
      const supplierId = (supplierRes.body as DataBody<{ id: string }>).data.id;

      // zeta sorts after alfa by name but comes first in the catalog.
      const zeta = await createCatalogItem('supply-types', 'st-zeta');
      const alfa = await createCatalogItem('supply-types', 'st-alfa');
      await setSortOrder('supply_types', alfa.id, 29981);
      await setSortOrder('supply_types', zeta.id, 29980);

      // s3 created before s2 so the name order inside zeta is not insertion order.
      const s1 = await createSupply('s1', alfa.id, supplierId);
      const s3 = await createSupply('s3', zeta.id, supplierId);
      const s2 = await createSupply('s2', zeta.id, supplierId);
      const wanted = new Set([s1.id, s2.id, s3.id]);

      const res = await request(app.getHttpServer())
        .get('/api/supplies')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const listed = (res.body as DataBody<SupplyBody[]>).data.filter(
        (supply) => wanted.has(supply.id),
      );

      expect(listed.map((supply) => supply.id)).toEqual([s2.id, s3.id, s1.id]);
    });
  });
});
