import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  ADMIN_ROLE_NAME,
  ALL_PERMISSIONS,
  PERMISSION_TO_CAMEL,
} from '../common/types/permission';
import { User } from '../users/entities/user.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Role } from './entities/role.entity';
import { RolesService } from './roles.service';

const PERMISSION_FIELDS = Object.values(PERMISSION_TO_CAMEL);

const ADMIN_LOCK_MESSAGE = 'No se pueden modificar los permisos del rol ADMIN';

const makeRole = (overrides: Partial<Role> = {}): Role =>
  ({
    id: 'role-uuid-1',
    name: 'EDITOR',
    description: null,
    isSystem: false,
    canViewProducts: false,
    canEditProducts: false,
    canViewSupplies: false,
    canEditSupplies: false,
    canViewExpenses: false,
    canEditExpenses: false,
    canUseCalculator: false,
    canManageScenarios: false,
    canViewDashboard: false,
    canManageConfig: false,
    canManageUsers: false,
    users: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Role;

describe('RolesService', () => {
  let service: RolesService;

  // QueryBuilder mock — returned by createQueryBuilder()
  const mockQb = {
    loadRelationCountAndMap: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };

  const mockRoleRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQb),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    merge: jest.fn(),
    delete: jest.fn(),
  };

  const mockUserRepo = {
    count: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        {
          provide: getRepositoryToken(Role),
          useValue: mockRoleRepo,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepo,
        },
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);
    jest.clearAllMocks();
    // Re-attach chaining mocks after clearAllMocks
    mockRoleRepo.createQueryBuilder.mockReturnValue(mockQb);
    mockQb.loadRelationCountAndMap.mockReturnThis();
    mockQb.orderBy.mockReturnThis();
    mockQb.addOrderBy.mockReturnThis();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------
  // findAll
  // ---------------------------------------------------------------
  describe('findAll', () => {
    it('builds query with loadRelationCountAndMap userCount, orderBy isSystem DESC and name ASC', async () => {
      const roles = [makeRole()];
      mockQb.getMany.mockResolvedValue(roles);

      const result = await service.findAll();

      expect(mockRoleRepo.createQueryBuilder).toHaveBeenCalledWith('role');
      expect(mockQb.loadRelationCountAndMap).toHaveBeenCalledWith(
        'role.userCount',
        'role.users',
      );
      expect(mockQb.orderBy).toHaveBeenCalledWith('role.isSystem', 'DESC');
      expect(mockQb.addOrderBy).toHaveBeenCalledWith('role.name', 'ASC');
      // D-19: every row carries the server-computed lock
      expect(result).toEqual([{ ...roles[0], permissionsLocked: false }]);
    });

    it('serves ADMIN with all 11 effective permissions and locked, other roles with their stored flags', async () => {
      // ADMIN's stored flags are all false (makeRole default): they must be ignored
      const admin = makeRole({
        id: 'admin-id',
        name: ADMIN_ROLE_NAME,
        isSystem: true,
        userCount: 2,
      });
      const user = makeRole({
        id: 'user-id',
        name: 'USER',
        isSystem: true,
        canUseCalculator: true,
        userCount: 5,
      });
      mockQb.getMany.mockResolvedValue([admin, user]);

      const [adminView, userView] = await service.findAll();

      expect(adminView).toMatchObject({
        id: 'admin-id',
        name: ADMIN_ROLE_NAME,
        userCount: 2,
        ...ALL_PERMISSIONS,
        permissionsLocked: true,
      });
      expect(userView).toEqual({ ...user, permissionsLocked: false });
      expect(userView.canUseCalculator).toBe(true);
      expect(userView.canManageUsers).toBe(false);
    });
  });

  // ---------------------------------------------------------------
  // findOne
  // ---------------------------------------------------------------
  describe('findOne', () => {
    it('returns the role when found', async () => {
      const role = makeRole();
      mockRoleRepo.findOne.mockResolvedValue(role);

      const result = await service.findOne('role-uuid-1');

      expect(result).toEqual(role);
      expect(mockRoleRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'role-uuid-1' },
      });
    });

    it('throws NotFoundException("Rol no encontrado") when role does not exist', async () => {
      mockRoleRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('nonexistent-id')).rejects.toThrow(
        new NotFoundException('Rol no encontrado'),
      );
    });
  });

  // ---------------------------------------------------------------
  // create
  // ---------------------------------------------------------------
  describe('create', () => {
    it('throws ConflictException when a role with the same name already exists', async () => {
      const dto: CreateRoleDto = { name: 'EDITOR' };
      mockRoleRepo.findOne.mockResolvedValue(makeRole({ name: 'EDITOR' }));

      await expect(service.create(dto)).rejects.toThrow(ConflictException);
    });

    it('saves and returns the new role when name is unique', async () => {
      const dto: CreateRoleDto = { name: 'VISOR', canViewProducts: true };
      const created = makeRole({ name: 'VISOR', canViewProducts: true });
      mockRoleRepo.findOne.mockResolvedValue(null);
      mockRoleRepo.create.mockReturnValue(created);
      mockRoleRepo.save.mockResolvedValue(created);

      const result = await service.create(dto);

      expect(mockRoleRepo.create).toHaveBeenCalledWith(dto);
      expect(mockRoleRepo.save).toHaveBeenCalledWith(created);
      expect(result).toEqual({ ...created, permissionsLocked: false });
    });
  });

  // ---------------------------------------------------------------
  // update
  // ---------------------------------------------------------------
  describe('update', () => {
    it('throws BadRequestException when trying to rename a system role', async () => {
      const systemRole = makeRole({ name: 'ADMIN', isSystem: true });
      mockRoleRepo.findOne.mockResolvedValue(systemRole);
      const dto: UpdateRoleDto = { name: 'SUPERADMIN' };

      await expect(service.update('role-uuid-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException (admin-lockout) when ADMIN role has canManageUsers set to false', async () => {
      const adminRole = makeRole({
        name: 'ADMIN',
        isSystem: true,
        canManageUsers: true,
      });
      // findOne called twice — once in update itself, once inside findOne helper
      mockRoleRepo.findOne.mockResolvedValue(adminRole);
      const dto: UpdateRoleDto = { canManageUsers: false };

      await expect(service.update('role-uuid-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws ConflictException when renaming to a name already used by another role', async () => {
      const role = makeRole({ name: 'EDITOR', isSystem: false });
      const conflictRole = makeRole({ id: 'other-id', name: 'VISOR' });
      // findOne called: 1st for findOne(id), 2nd for conflict check
      mockRoleRepo.findOne
        .mockResolvedValueOnce(role)
        .mockResolvedValueOnce(conflictRole);
      const dto: UpdateRoleDto = { name: 'VISOR' };

      await expect(service.update('role-uuid-1', dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('merges dto into role and saves on the happy path', async () => {
      const role = makeRole({ name: 'EDITOR', isSystem: false });
      const saved = makeRole({ name: 'EDITOR', canViewProducts: true });
      // dto has no name change — conflict check branch is skipped entirely,
      // so only one findOne call is made (the findOne(id) inside update).
      mockRoleRepo.findOne.mockResolvedValue(role);
      mockRoleRepo.merge.mockImplementation(
        (target: Role, source: Partial<Role>) => Object.assign(target, source),
      );
      mockRoleRepo.save.mockResolvedValue(saved);
      const dto: UpdateRoleDto = { canViewProducts: true };

      const result = await service.update('role-uuid-1', dto);

      expect(mockRoleRepo.merge).toHaveBeenCalledWith(role, dto);
      expect(mockRoleRepo.save).toHaveBeenCalled();
      expect(result).toEqual({ ...saved, permissionsLocked: false });
    });

    describe('ADMIN permissions are locked (D-18)', () => {
      const makeAdmin = (): Role =>
        makeRole({ id: 'admin-id', name: ADMIN_ROLE_NAME, isSystem: true });

      beforeEach(() => {
        mockRoleRepo.merge.mockImplementation(
          (target: Role, source: Partial<Role>) =>
            Object.assign(target, source),
        );
        mockRoleRepo.save.mockImplementation((role: Role) =>
          Promise.resolve(role),
        );
      });

      it('rejects turning off any ADMIN permission', async () => {
        mockRoleRepo.findOne.mockResolvedValue(makeAdmin());

        await expect(
          service.update('admin-id', { canManageConfig: false }),
        ).rejects.toThrow(new BadRequestException(ADMIN_LOCK_MESSAGE));
        expect(mockRoleRepo.save).not.toHaveBeenCalled();
      });

      it('rejects a change in one permission even when the others are sent unchanged', async () => {
        mockRoleRepo.findOne.mockResolvedValue(makeAdmin());
        const dto: UpdateRoleDto = {
          ...ALL_PERMISSIONS,
          canViewExpenses: false,
        };

        await expect(service.update('admin-id', dto)).rejects.toThrow(
          new BadRequestException(ADMIN_LOCK_MESSAGE),
        );
        expect(mockRoleRepo.save).not.toHaveBeenCalled();
      });

      it('accepts unchanged (all true) permissions and never writes the stored flags', async () => {
        const admin = makeAdmin();
        mockRoleRepo.findOne.mockResolvedValue(admin);
        const dto: UpdateRoleDto = {
          name: ADMIN_ROLE_NAME,
          description: 'x',
          ...ALL_PERMISSIONS,
        };

        const result = await service.update('admin-id', dto);

        expect(mockRoleRepo.merge).toHaveBeenCalledTimes(1);
        const [target, merged] = mockRoleRepo.merge.mock.calls[0] as [
          Role,
          Partial<Role>,
        ];
        expect(target).toBe(admin);
        expect(PERMISSION_FIELDS.filter((field) => field in merged)).toEqual(
          [],
        );
        expect(merged).toEqual({ name: ADMIN_ROLE_NAME, description: 'x' });
        // The stored flags stay as they were (all false); the reply is effective
        expect(admin.canManageConfig).toBe(false);
        expect(result).toMatchObject({
          description: 'x',
          ...ALL_PERMISSIONS,
          permissionsLocked: true,
        });
      });

      it('accepts a description-only PATCH under the usual rules', async () => {
        mockRoleRepo.findOne.mockResolvedValue(makeAdmin());

        const result = await service.update('admin-id', {
          description: 'only',
        });

        expect(mockRoleRepo.merge).toHaveBeenCalledWith(expect.anything(), {
          description: 'only',
        });
        expect(result).toMatchObject({
          description: 'only',
          ...ALL_PERMISSIONS,
          permissionsLocked: true,
        });
      });

      it('still rejects renaming ADMIN (system role rule)', async () => {
        mockRoleRepo.findOne.mockResolvedValue(makeAdmin());

        await expect(
          service.update('admin-id', { name: 'SUPERADMIN' }),
        ).rejects.toThrow(
          new BadRequestException(
            'No se puede cambiar el nombre de un rol de sistema',
          ),
        );
      });

      it('lets a non-ADMIN role change its permissions as before', async () => {
        const editor = makeRole({ name: 'EDITOR', canViewProducts: false });
        mockRoleRepo.findOne.mockResolvedValue(editor);
        const dto: UpdateRoleDto = {
          canViewProducts: true,
          canManageUsers: false,
        };

        const result = await service.update('role-uuid-1', dto);

        expect(mockRoleRepo.merge).toHaveBeenCalledWith(editor, dto);
        expect(result.canViewProducts).toBe(true);
        expect(result.canEditProducts).toBe(false);
        expect(result.permissionsLocked).toBe(false);
      });
    });
  });

  // ---------------------------------------------------------------
  // remove
  // ---------------------------------------------------------------
  describe('remove', () => {
    it('throws BadRequestException when trying to remove a system role', async () => {
      const systemRole = makeRole({ isSystem: true });
      // findOne is called inside remove → findOne(id). Mock must return the role.
      mockRoleRepo.findOne.mockResolvedValue(systemRole);

      await expect(service.remove(systemRole.id)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException("No se puede eliminar un rol con usuarios asignados") when users are assigned', async () => {
      const role = makeRole({ isSystem: false });
      mockRoleRepo.findOne.mockResolvedValue(role);
      mockUserRepo.count.mockResolvedValue(3);

      await expect(service.remove('role-uuid-1')).rejects.toThrow(
        new BadRequestException(
          'No se puede eliminar un rol con usuarios asignados',
        ),
      );
    });

    it('calls roleRepo.delete when role is not system and has no users', async () => {
      const role = makeRole({ isSystem: false });
      mockRoleRepo.findOne.mockResolvedValue(role);
      mockUserRepo.count.mockResolvedValue(0);
      mockRoleRepo.delete.mockResolvedValue({ affected: 1 });

      await service.remove('role-uuid-1');

      expect(mockRoleRepo.delete).toHaveBeenCalledWith('role-uuid-1');
    });
  });
});
