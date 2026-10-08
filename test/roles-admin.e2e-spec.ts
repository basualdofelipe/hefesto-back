/**
 * roles-admin.e2e-spec.ts
 *
 * WHY THIS SPEC EXISTS
 * --------------------
 * R10 / D-18 / D-19: the roles API serves ADMIN with its effective permissions
 * (all 11 true, whatever its stored flags say) plus a server-computed
 * `permissionsLocked`, on GET, POST and PATCH alike, because the roles screen
 * replaces its row with the PATCH reply. A PATCH that tries to change any ADMIN
 * permission is refused; sending the effective values (all true) or no
 * permission keys at all follows the usual rules. Together with R8 (no Google
 * login in demo) this keeps a demo visitor from stripping ADMIN through the API.
 *
 * REQUIREMENT: the test database on port 5433 (setup-e2e.ts) must be running:
 *   cd hefesto-back && docker compose up -d --wait postgres-test
 * Run with:
 *   npx jest --config ./test/jest-e2e.json --runInBand test/roles-admin.e2e-spec.ts
 *
 * HYGIENE: the ADMIN role row is shared by every suite (unique by name). This
 * suite self-heals ADMIN's 11 flags to the seeded `true` in beforeAll, snapshots
 * ADMIN's id and description, restores name, description and flags by id in
 * afterAll, and wraps every flag flip in a finally. Fixture users and the custom
 * role carry TEST_PREFIX and are swept before and after.
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
  ALL_PERMISSIONS,
  extractPermissions,
  NO_PERMISSIONS,
  Permissions,
} from '../src/common/types/permission';
import { Role } from '../src/roles/entities/role.entity';
import { User } from '../src/users/entities/user.entity';

const TEST_PREFIX = 'e2e-roles-';
const USER_ROLE_NAME = 'USER';
const ADMIN_LOCK_MESSAGE = 'No se pueden modificar los permisos del rol ADMIN';

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

type RoleBody = Permissions & {
  id: string;
  name: string;
  description: string | null;
  permissionsLocked: boolean;
  userCount: number;
};

interface ErrorBody {
  statusCode: number;
  message: string | string[];
}

const pickPermissions = (role: RoleBody): Permissions => {
  const picked = { ...NO_PERMISSIONS };
  for (const field of Object.keys(NO_PERMISSIONS) as (keyof Permissions)[]) {
    picked[field] = role[field];
  }
  return picked;
};

describe('Roles API ADMIN lock (real Postgres)', () => {
  let app: INestApplication<App>;
  let moduleFixture: TestingModule;
  let dataSource: DataSource;
  let adminToken: string;
  let adminRoleId: string;
  let adminDescription: string | null;

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

  const sweepFixtures = async (): Promise<void> => {
    await dataSource.query(`DELETE FROM users WHERE email LIKE $1`, [
      `${TEST_PREFIX}%`,
    ]);
    await dataSource.query(`DELETE FROM roles WHERE name LIKE $1`, [
      `${TEST_PREFIX}%`,
    ]);
  };

  const patchRole = (id: string, body: object): request.Test =>
    request(app.getHttpServer())
      .patch(`/api/roles/${id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body);

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
    await sweepFixtures();

    const adminRole = await roleRepo.findOneByOrFail({ name: ADMIN_ROLE_NAME });
    // TypeORM drops an undefined condition, so pin that we got the ADMIN row
    expect(adminRole.name).toBe(ADMIN_ROLE_NAME);
    adminRoleId = adminRole.id;
    adminDescription = adminRole.description;

    const admin = await userRepo.save(
      userRepo.create({
        email: `${TEST_PREFIX}admin@test.com`,
        name: 'e2e roles admin',
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
      // Restore by id so even a rename that slipped through is undone
      const assignments = PERMISSION_COLUMNS.map((c) => `${c} = true`).join(
        ', ',
      );
      await dataSource.query(
        `UPDATE roles SET name = $2, description = $3, ${assignments} WHERE id = $1`,
        [adminRoleId, ADMIN_ROLE_NAME, adminDescription],
      );
      await sweepFixtures();
      expect(await readAdminFlags()).toEqual(
        PERMISSION_COLUMNS.map(() => true),
      );
    } finally {
      await app.close();
    }
  });

  it('GET serves ADMIN with all 11 effective permissions and locked, even with its stored flags false', async () => {
    await setAdminFlags(false);
    try {
      expect(await readAdminFlags()).toEqual(
        PERMISSION_COLUMNS.map(() => false),
      );

      const res = await request(app.getHttpServer())
        .get('/api/roles')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const roles = (res.body as { data: RoleBody[] }).data;
      const adminView = roles.find((r) => r.name === ADMIN_ROLE_NAME);
      const userView = roles.find((r) => r.name === USER_ROLE_NAME);

      expect(adminView).toBeDefined();
      expect(pickPermissions(adminView!)).toEqual(ALL_PERMISSIONS);
      expect(adminView!.permissionsLocked).toBe(true);

      expect(userView).toBeDefined();
      expect(userView!.permissionsLocked).toBe(false);
      expect(roles.filter((r) => r.permissionsLocked)).toHaveLength(1);
    } finally {
      await setAdminFlags(true);
    }
  });

  it('PATCH ADMIN turning off a permission -> 400 with the lock message', async () => {
    const res = await patchRole(adminRoleId, { canManageConfig: false }).expect(
      400,
    );

    expect((res.body as ErrorBody).message).toBe(ADMIN_LOCK_MESSAGE);
    expect(await readAdminFlags()).toEqual(PERMISSION_COLUMNS.map(() => true));
  });

  it('PATCH ADMIN with an explicit null permission -> 400 (null becomes false in the DTO)', async () => {
    const res = await patchRole(adminRoleId, { canManageUsers: null }).expect(
      400,
    );

    expect((res.body as ErrorBody).message).toBe(ADMIN_LOCK_MESSAGE);
  });

  it('PATCH ADMIN with unchanged name and all 11 true -> 200, locked, stored flags untouched', async () => {
    // Stored flags false: a 200 that wrote the body would flip them to true
    await setAdminFlags(false);
    try {
      const res = await patchRole(adminRoleId, {
        name: ADMIN_ROLE_NAME,
        description: `${TEST_PREFIX}desc`,
        ...ALL_PERMISSIONS,
      }).expect(200);

      const view = (res.body as { data: RoleBody }).data;
      expect(view.description).toBe(`${TEST_PREFIX}desc`);
      expect(view.permissionsLocked).toBe(true);
      expect(pickPermissions(view)).toEqual(ALL_PERMISSIONS);

      // Permission keys were stripped before merge: the DB flags stay false
      expect(await readAdminFlags()).toEqual(
        PERMISSION_COLUMNS.map(() => false),
      );
    } finally {
      await setAdminFlags(true);
    }
  });

  it('PATCH ADMIN with only a description -> 200 (missing permission keys stay undefined)', async () => {
    const res = await patchRole(adminRoleId, {
      description: `${TEST_PREFIX}only`,
    }).expect(200);

    const view = (res.body as { data: RoleBody }).data;
    expect(view.description).toBe(`${TEST_PREFIX}only`);
    expect(view.permissionsLocked).toBe(true);
    expect(pickPermissions(view)).toEqual(ALL_PERMISSIONS);
  });

  // The roles screen replaces its row with the PATCH reply, so the reply must
  // carry the same userCount the GET served, not drop it.
  it('PATCH ADMIN replies with the same userCount as GET', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const listed = (list.body as { data: RoleBody[] }).data.find(
      (role) => role.id === adminRoleId,
    );
    expect(listed).toBeDefined();
    // At least the admin user this suite created holds ADMIN
    expect(listed!.userCount).toBeGreaterThanOrEqual(1);

    const res = await patchRole(adminRoleId, {
      description: `${TEST_PREFIX}count`,
    }).expect(200);

    expect((res.body as { data: RoleBody }).data.userCount).toBe(
      listed!.userCount,
    );
  });

  it('PATCH ADMIN rename -> 400 (system role rule kept)', async () => {
    const res = await patchRole(adminRoleId, {
      name: `${TEST_PREFIX}RENAMED`,
    }).expect(400);

    expect((res.body as ErrorBody).message).toBe(
      'No se puede cambiar el nombre de un rol de sistema',
    );
  });

  it('custom role: POST -> 201 unlocked, PATCH can change its permissions', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `${TEST_PREFIX}custom`, canViewProducts: true })
      .expect(201);

    const createdView = (created.body as { data: RoleBody }).data;
    expect(createdView.permissionsLocked).toBe(false);
    expect(createdView.canViewProducts).toBe(true);
    expect(createdView.userCount).toBe(0);

    const updated = await patchRole(createdView.id, {
      canViewProducts: false,
    }).expect(200);

    const updatedView = (updated.body as { data: RoleBody }).data;
    expect(updatedView.canViewProducts).toBe(false);
    expect(updatedView.permissionsLocked).toBe(false);
    expect(updatedView.userCount).toBe(0);
  });
});
