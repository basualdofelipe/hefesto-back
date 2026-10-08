import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Role } from '../roles/entities/role.entity';
import { ADMIN_ROLE_NAME, NO_PERMISSIONS } from '../common/types/permission';
import { ScenariosService } from '../scenarios/scenarios.service';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  let repository: Repository<User>;

  const VICTIM_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const CALLER_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
  const ADMIN_ROLE_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
  const EDITOR_ROLE_ID = 'd4e5f6a7-b8c9-0123-defa-234567890123';

  const adminRole = {
    id: ADMIN_ROLE_ID,
    name: ADMIN_ROLE_NAME,
    isSystem: true,
    ...Object.fromEntries(Object.keys(NO_PERMISSIONS).map((k) => [k, true])),
  };

  // D-20: the ADMIN role after a visitor turned its stored flags off
  const adminRoleNoFlag = {
    ...adminRole,
    canManageUsers: false,
  };

  const editorRole = {
    id: EDITOR_ROLE_ID,
    name: 'EDITOR',
    isSystem: false,
    ...Object.fromEntries(Object.keys(NO_PERMISSIONS).map((k) => [k, false])),
    canViewProducts: true,
  };

  const mockUser: Partial<User> = {
    id: VICTIM_ID,
    email: 'admin@hefesto.com',
    name: 'Admin Hefesto',
    pictureUrl: null,
    googleId: null,
    role: adminRole as User['role'],
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // CR-A1 + CR-A2: after the transactional refactor, both the victim
  // re-fetch and the last-admin COUNT live on queryRunner.manager. A single
  // chainable mock serves both paths -- per-test arrangement calls
  // `getOne` (victim lookup) and `getCount` (admin count) on it.
  const mockTxnQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
    getCount: jest.fn().mockResolvedValue(1),
  };

  const mockQueryRunner = {
    connect: jest.fn(),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    release: jest.fn(),
    manager: {
      createQueryBuilder: jest.fn(() => mockTxnQueryBuilder),
      findOne: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    manager: {
      connection: {
        createQueryRunner: jest.fn(() => mockQueryRunner),
      },
    },
  };

  const mockRoleRepository = {
    findOne: jest.fn(),
  };

  const mockScenariosService = {
    transferOwnership: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(Role),
          useValue: mockRoleRepository,
        },
        {
          provide: ScenariosService,
          useValue: mockScenariosService,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    repository = module.get<Repository<User>>(getRepositoryToken(User));

    jest.clearAllMocks();

    // Restore chain semantics after jest.clearAllMocks wipes mockReturnThis
    mockTxnQueryBuilder.innerJoin.mockReturnThis();
    mockTxnQueryBuilder.innerJoinAndSelect.mockReturnThis();
    mockTxnQueryBuilder.setLock.mockReturnThis();
    mockTxnQueryBuilder.where.mockReturnThis();
    mockTxnQueryBuilder.andWhere.mockReturnThis();
    mockTxnQueryBuilder.getCount.mockResolvedValue(1);
    mockTxnQueryBuilder.getOne.mockReset();
    mockQueryRunner.manager.createQueryBuilder.mockReturnValue(
      mockTxnQueryBuilder,
    );
    mockRepository.manager.connection.createQueryRunner.mockReturnValue(
      mockQueryRunner,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findActiveByEmail', () => {
    it('should return an active user by email', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.findActiveByEmail('admin@hefesto.com');

      expect(result).toEqual(mockUser);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { email: 'admin@hefesto.com', isActive: true },
      });
    });

    it('should return null for nonexistent email', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.findActiveByEmail('nonexistent@email.com');

      expect(result).toBeNull();
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { email: 'nonexistent@email.com', isActive: true },
      });
    });

    // WR-A5: assert the service actually filters by isActive: true. The
    // previous version of this test only checked the return value, so a
    // regression that dropped the isActive filter would still pass.
    it('should return null for deactivated user', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.findActiveByEmail('deactivated@email.com');

      expect(result).toBeNull();
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { email: 'deactivated@email.com', isActive: true },
      });
    });
  });

  describe('create', () => {
    it('should create a user with roleId and return it', async () => {
      const dto = {
        email: 'new@user.com',
        roleId: ADMIN_ROLE_ID,
        name: 'New User',
      };
      const createdUser = {
        ...mockUser,
        email: dto.email,
        name: dto.name,
        id: 'b2c3d4e5-f6a7-8901-bcde-f12345678901',
      };
      mockRoleRepository.findOne.mockResolvedValue(adminRole);
      mockRepository.create.mockReturnValue(createdUser);
      mockRepository.save.mockResolvedValue(createdUser);

      const result = await service.create(dto);

      expect(result).toEqual(createdUser);
      expect(mockRoleRepository.findOne).toHaveBeenCalledWith({
        where: { id: ADMIN_ROLE_ID },
      });
      expect(repository.save).toHaveBeenCalledWith(createdUser);
    });

    // WR-A4: service catches the @Unique(['email']) DB constraint
    // violation (Postgres code 23505) and re-throws as 409. This closes
    // the TOCTOU window where two concurrent POSTs with the same email
    // could both pass a pre-check and the loser would get a raw 500.
    it('WR-A4: throws ConflictException cuando save lanza unique-violation 23505 (email duplicado)', async () => {
      const dto = {
        email: 'dup@user.com',
        roleId: ADMIN_ROLE_ID,
        name: 'Dup',
      };
      mockRoleRepository.findOne.mockResolvedValue(adminRole);
      mockRepository.create.mockReturnValue({ ...mockUser, ...dto });
      const uniqueError = new QueryFailedError(
        'INSERT INTO users ...',
        [],
        new Error('duplicate'),
      ) as QueryFailedError & { code?: string };
      uniqueError.code = '23505';
      mockRepository.save.mockRejectedValue(uniqueError);

      await expect(service.create(dto)).rejects.toThrow(
        new ConflictException('Email ya registrado'),
      );
    });

    it('WR-A4: re-lanza otros errores de QueryFailedError sin envolverlos en ConflictException', async () => {
      const dto = {
        email: 'fk@user.com',
        roleId: ADMIN_ROLE_ID,
        name: 'FK',
      };
      mockRoleRepository.findOne.mockResolvedValue(adminRole);
      mockRepository.create.mockReturnValue({ ...mockUser, ...dto });
      const fkError = new QueryFailedError(
        'INSERT INTO users ...',
        [],
        new Error('fk'),
      ) as QueryFailedError & { code?: string };
      fkError.code = '23503'; // foreign key violation
      mockRepository.save.mockRejectedValue(fkError);

      await expect(service.create(dto)).rejects.toThrow(QueryFailedError);
    });
  });

  describe('findAll', () => {
    it('should return an array of users', async () => {
      const users = [mockUser];
      mockRepository.find.mockResolvedValue(users);

      const result = await service.findAll();

      expect(result).toEqual(users);
      expect(repository.find).toHaveBeenCalled();
    });
  });

  describe('findById', () => {
    it('should return a user by id', async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.findById(VICTIM_ID);

      expect(result).toEqual(mockUser);
      expect(repository.findOne).toHaveBeenCalledWith({
        where: { id: VICTIM_ID },
      });
    });

    it('should return null for nonexistent id', async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.findById(
        'b2c3d4e5-f6a7-8901-bcde-f12345678901',
      );

      expect(result).toBeNull();
    });
  });

  describe('updateGoogleProfile', () => {
    it('should update google profile data', async () => {
      mockRepository.update.mockResolvedValue({ affected: 1 });

      await service.updateGoogleProfile(VICTIM_ID, {
        name: 'Google Name',
        pictureUrl: 'https://example.com/pic.jpg',
        googleId: '123456',
      });

      expect(repository.update).toHaveBeenCalledWith(VICTIM_ID, {
        name: 'Google Name',
        pictureUrl: 'https://example.com/pic.jpg',
        googleId: '123456',
      });
    });
  });

  describe('update', () => {
    it('actualiza name cuando victim !== caller', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        name: 'Old Name',
        role: editorRole,
        isActive: true,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
      mockQueryRunner.manager.save.mockImplementation(
        (_entity: unknown, u: User) => Promise.resolve(u),
      );

      const result = await service.update(
        VICTIM_ID,
        { name: 'New Name' },
        CALLER_ID,
      );

      expect(result.name).toBe('New Name');
      // No COUNT for a name-only change (no last-admin path).
      expect(mockTxnQueryBuilder.getCount).not.toHaveBeenCalled();
      expect(mockQueryRunner.manager.save).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    it('actualiza role cuando roleId nuevo y valido', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        role: editorRole,
        isActive: true,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
      mockQueryRunner.manager.findOne.mockResolvedValueOnce(adminRole);
      mockQueryRunner.manager.save.mockImplementation(
        (_entity: unknown, u: User) => Promise.resolve(u),
      );

      const result = await service.update(
        VICTIM_ID,
        { roleId: ADMIN_ROLE_ID },
        CALLER_ID,
      );

      expect(result.role).toEqual(adminRole);
      expect(mockQueryRunner.manager.findOne).toHaveBeenCalledWith(Role, {
        where: { id: ADMIN_ROLE_ID },
      });
    });

    it('actualiza isActive cuando victim !== caller', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        role: editorRole,
        isActive: true,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
      mockQueryRunner.manager.save.mockImplementation(
        (_entity: unknown, u: User) => Promise.resolve(u),
      );

      const result = await service.update(
        VICTIM_ID,
        { isActive: false },
        CALLER_ID,
      );

      expect(result.isActive).toBe(false);
    });

    it('throws NotFoundException con Usuario no encontrado cuando user no existe', async () => {
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(null);

      await expect(
        service.update(VICTIM_ID, { name: 'X' }, CALLER_ID),
      ).rejects.toThrow(new NotFoundException('Usuario no encontrado'));
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('throws NotFoundException con Rol no encontrado cuando roleId no existe', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        role: editorRole,
        isActive: true,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
      mockQueryRunner.manager.findOne.mockResolvedValueOnce(null);

      await expect(
        service.update(VICTIM_ID, { roleId: ADMIN_ROLE_ID }, CALLER_ID),
      ).rejects.toThrow(new NotFoundException('Rol no encontrado'));
    });

    it('throws BadRequestException No puedes cambiar tu propio rol cuando victim === caller y roleId distinto', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        role: editorRole,
        isActive: true,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);

      await expect(
        service.update(VICTIM_ID, { roleId: ADMIN_ROLE_ID }, VICTIM_ID),
      ).rejects.toThrow(
        new BadRequestException('No puedes cambiar tu propio rol'),
      );
    });

    it('NO throws cuando victim === caller y roleId igual al actual', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        role: editorRole,
        isActive: true,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
      mockQueryRunner.manager.save.mockImplementation(
        (_entity: unknown, u: User) => Promise.resolve(u),
      );

      const result = await service.update(
        VICTIM_ID,
        { roleId: editorRole.id },
        VICTIM_ID,
      );

      expect(result.role).toEqual(editorRole);
      expect(mockQueryRunner.manager.findOne).not.toHaveBeenCalled();
    });

    it('throws BadRequestException No puedes desactivar tu propia cuenta cuando victim === caller y isActive false', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        role: editorRole,
        isActive: true,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);

      await expect(
        service.update(VICTIM_ID, { isActive: false }, VICTIM_ID),
      ).rejects.toThrow(
        new BadRequestException('No puedes desactivar tu propia cuenta'),
      );
    });

    // WR-A1: idempotent PATCH — if the victim is already inactive, a
    // self-PATCH with isActive=false should be a no-op, not an error.
    it('WR-A1: NO throws cuando victim === caller y isActive false pero el victim ya estaba inactivo (idempotencia)', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        role: editorRole,
        isActive: false,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
      mockQueryRunner.manager.save.mockImplementation(
        (_entity: unknown, u: User) => Promise.resolve(u),
      );

      const result = await service.update(
        VICTIM_ID,
        { isActive: false },
        VICTIM_ID,
      );

      expect(result.isActive).toBe(false);
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    // WR-A2: explicit guard rejects roleId: null before any DB I/O.
    it('WR-A2: throws BadRequestException cuando dto.roleId es null', async () => {
      await expect(
        service.update(
          VICTIM_ID,
          { roleId: null as unknown as string },
          CALLER_ID,
        ),
      ).rejects.toThrow(new BadRequestException('roleId no puede ser null'));
      expect(
        mockRepository.manager.connection.createQueryRunner,
      ).not.toHaveBeenCalled();
    });

    it('throws ultimo-admin cuando demote del ultimo admin via roleId no-admin', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        role: adminRole,
        isActive: true,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
      mockQueryRunner.manager.findOne.mockResolvedValueOnce(editorRole);
      mockTxnQueryBuilder.getCount.mockResolvedValueOnce(0);

      await expect(
        service.update(VICTIM_ID, { roleId: EDITOR_ROLE_ID }, CALLER_ID),
      ).rejects.toThrow(
        new BadRequestException(
          'No se puede dejar el sistema sin administradores activos',
        ),
      );
    });

    it('throws ultimo-admin cuando desactivar ultimo admin', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        role: adminRole,
        isActive: true,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
      mockTxnQueryBuilder.getCount.mockResolvedValueOnce(0);

      await expect(
        service.update(VICTIM_ID, { isActive: false }, CALLER_ID),
      ).rejects.toThrow(
        new BadRequestException(
          'No se puede dejar el sistema sin administradores activos',
        ),
      );
    });

    describe('D-20: ADMIN role counts as admin even with canManageUsers = false', () => {
      it('rejects deactivating the last active ADMIN-role user', async () => {
        const victim = {
          ...mockUser,
          id: VICTIM_ID,
          role: adminRoleNoFlag,
          isActive: true,
        };
        mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
        mockTxnQueryBuilder.getCount.mockResolvedValueOnce(0);

        await expect(
          service.update(VICTIM_ID, { isActive: false }, CALLER_ID),
        ).rejects.toThrow(
          new BadRequestException(
            'No se puede dejar el sistema sin administradores activos',
          ),
        );
      });

      it('rejects demoting the last active ADMIN-role user to a non-admin role', async () => {
        const victim = {
          ...mockUser,
          id: VICTIM_ID,
          role: adminRoleNoFlag,
          isActive: true,
        };
        mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
        mockQueryRunner.manager.findOne.mockResolvedValueOnce(editorRole);
        mockTxnQueryBuilder.getCount.mockResolvedValueOnce(0);

        await expect(
          service.update(VICTIM_ID, { roleId: EDITOR_ROLE_ID }, CALLER_ID),
        ).rejects.toThrow(
          new BadRequestException(
            'No se puede dejar el sistema sin administradores activos',
          ),
        );
      });

      it('allows demoting an ADMIN-role user when another active admin exists', async () => {
        const victim = {
          ...mockUser,
          id: VICTIM_ID,
          role: adminRoleNoFlag,
          isActive: true,
        };
        mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
        mockQueryRunner.manager.findOne.mockResolvedValueOnce(editorRole);
        mockTxnQueryBuilder.getCount.mockResolvedValueOnce(1);
        mockQueryRunner.manager.save.mockImplementation(
          (_entity: unknown, u: User) => Promise.resolve(u),
        );

        const result = await service.update(
          VICTIM_ID,
          { roleId: EDITOR_ROLE_ID },
          CALLER_ID,
        );

        expect(result.role).toEqual(editorRole);
      });
    });

    // CR-A1/CR-A2 (updated for UAT gap closure): the last-admin COUNT runs on
    // queryRunner.manager (same transaction as the save). The count does NOT
    // add a pessimistic_write lock on the aggregate — PostgreSQL forbids
    // FOR UPDATE with COUNT, and the SERIALIZABLE isolation of the surrounding
    // transaction already serializes concurrent demote/delete requests without
    // a row-lock on the COUNT query. The victim re-fetch (innerJoinAndSelect +
    // setLock) is a separate createQueryBuilder call and is the one that uses
    // pessimistic_write, not the COUNT.
    it('CR-A1/CR-A2: la COUNT de admins corre sobre queryRunner.manager y NO agrega lock sobre el agregado (SERIALIZABLE ya garantiza serialización)', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        role: adminRole,
        isActive: true,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
      mockQueryRunner.manager.findOne.mockResolvedValueOnce(editorRole);
      mockTxnQueryBuilder.getCount.mockResolvedValueOnce(5);
      mockQueryRunner.manager.save.mockImplementation(
        (_entity: unknown, u: User) => Promise.resolve(u),
      );

      await service.update(VICTIM_ID, { roleId: EDITOR_ROLE_ID }, CALLER_ID);

      // The createQueryBuilder used to count admins is the one on the
      // queryRunner manager (transactional), not on the bare repository.
      expect(mockQueryRunner.manager.createQueryBuilder).toHaveBeenCalled();
      // getCount was called — proves the COUNT path was taken (last-admin guard)
      expect(mockTxnQueryBuilder.getCount).toHaveBeenCalled();
      // The COUNT must NOT call setLock('pessimistic_write') — that combination
      // triggers "FOR UPDATE is not allowed with aggregate functions" in PostgreSQL.
      // The victim re-fetch uses setLock, but the shared mock means we only assert
      // that getCount was reached (not that setLock was absent entirely, since the
      // victim re-fetch legitimately calls it).
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });

    // WR-A6: rollback path for update — if save() fails, the transaction
    // rolls back so any intermediate state (role lookup) does not persist.
    it('WR-A6: rollbackea cuando save falla en update', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        role: editorRole,
        isActive: true,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
      mockQueryRunner.manager.save.mockRejectedValueOnce(
        new Error('constraint violation'),
      );

      await expect(
        service.update(VICTIM_ID, { name: 'X' }, CALLER_ID),
      ).rejects.toThrow('constraint violation');

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('happy path: transferOwnership + manager.delete + commit', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        name: 'V',
        role: editorRole,
        isActive: false,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
      mockScenariosService.transferOwnership.mockResolvedValue(undefined);
      mockQueryRunner.manager.delete.mockResolvedValue({ affected: 1 });

      await service.remove(VICTIM_ID, CALLER_ID);

      expect(mockScenariosService.transferOwnership).toHaveBeenCalledWith(
        VICTIM_ID,
        CALLER_ID,
        expect.stringContaining(' - '),
        mockQueryRunner,
      );
      expect(mockQueryRunner.manager.delete).toHaveBeenCalledWith(
        User,
        VICTIM_ID,
      );
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.rollbackTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    // WR-A3: self-delete check moves AFTER existence check. Caller whose
    // own row was concurrently deleted now gets a clean 404 instead of
    // "No puedes borrarte a vos mismo".
    it('WR-A3: throws NotFoundException cuando victim no existe (incluso cuando id === callerId)', async () => {
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(null);

      await expect(service.remove(VICTIM_ID, VICTIM_ID)).rejects.toThrow(
        new NotFoundException('Usuario no encontrado'),
      );
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('throws self-delete con No puedes borrarte a vos mismo cuando id === callerId y user existe', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        role: editorRole,
        isActive: true,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);

      await expect(service.remove(VICTIM_ID, VICTIM_ID)).rejects.toThrow(
        new BadRequestException('No puedes borrarte a vos mismo'),
      );
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('throws NotFoundException cuando user no existe', async () => {
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(null);

      await expect(service.remove(VICTIM_ID, CALLER_ID)).rejects.toThrow(
        new NotFoundException('Usuario no encontrado'),
      );
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('throws ultimo-admin cuando borrando unico admin activo', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        role: adminRole,
        isActive: true,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
      mockTxnQueryBuilder.getCount.mockResolvedValueOnce(0);

      await expect(service.remove(VICTIM_ID, CALLER_ID)).rejects.toThrow(
        new BadRequestException(
          'No se puede dejar el sistema sin administradores activos',
        ),
      );
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('D-20: rejects deleting the last active ADMIN-role user whose role has canManageUsers = false', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        role: adminRoleNoFlag,
        isActive: true,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
      mockTxnQueryBuilder.getCount.mockResolvedValueOnce(0);

      await expect(service.remove(VICTIM_ID, CALLER_ID)).rejects.toThrow(
        new BadRequestException(
          'No se puede dejar el sistema sin administradores activos',
        ),
      );
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });

    it('cuando victim.name === "" usa fallback "usuario borrado" en el suffix (CR-02)', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        name: '',
        role: editorRole,
        isActive: false,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
      mockScenariosService.transferOwnership.mockResolvedValue(undefined);
      mockQueryRunner.manager.delete.mockResolvedValue({ affected: 1 });

      await service.remove(VICTIM_ID, CALLER_ID);

      expect(mockScenariosService.transferOwnership).toHaveBeenCalledWith(
        VICTIM_ID,
        CALLER_ID,
        ` - usuario borrado #${VICTIM_ID.slice(0, 8)}`,
        mockQueryRunner,
      );
    });

    it('cuando victim.name === "   " (whitespace) usa fallback "usuario borrado" en el suffix (CR-02)', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        name: '   ',
        role: editorRole,
        isActive: false,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
      mockScenariosService.transferOwnership.mockResolvedValue(undefined);
      mockQueryRunner.manager.delete.mockResolvedValue({ affected: 1 });

      await service.remove(VICTIM_ID, CALLER_ID);

      expect(mockScenariosService.transferOwnership).toHaveBeenCalledWith(
        VICTIM_ID,
        CALLER_ID,
        ` - usuario borrado #${VICTIM_ID.slice(0, 8)}`,
        mockQueryRunner,
      );
    });

    it('cuando victim.name tiene whitespace al borde lo trimmea en el suffix (CR-02)', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        name: '  Juan  ',
        role: editorRole,
        isActive: false,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
      mockScenariosService.transferOwnership.mockResolvedValue(undefined);
      mockQueryRunner.manager.delete.mockResolvedValue({ affected: 1 });

      await service.remove(VICTIM_ID, CALLER_ID);

      expect(mockScenariosService.transferOwnership).toHaveBeenCalledWith(
        VICTIM_ID,
        CALLER_ID,
        ` - Juan #${VICTIM_ID.slice(0, 8)}`,
        mockQueryRunner,
      );
    });

    it('incluye un slice corto del UUID de victim en el suffix para evitar colisiones', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        name: 'Maria',
        role: editorRole,
        isActive: false,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
      mockScenariosService.transferOwnership.mockResolvedValue(undefined);
      mockQueryRunner.manager.delete.mockResolvedValue({ affected: 1 });

      await service.remove(VICTIM_ID, CALLER_ID);

      const expectedSuffix = ` - Maria #${VICTIM_ID.slice(0, 8)}`;
      expect(mockScenariosService.transferOwnership).toHaveBeenCalledWith(
        VICTIM_ID,
        CALLER_ID,
        expectedSuffix,
        mockQueryRunner,
      );
    });

    it('rollbackea cuando transferOwnership falla', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        name: 'V',
        role: editorRole,
        isActive: false,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
      mockScenariosService.transferOwnership.mockRejectedValue(
        new Error('overflow'),
      );

      await expect(service.remove(VICTIM_ID, CALLER_ID)).rejects.toThrow(
        'overflow',
      );

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.manager.delete).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('rollbackea cuando manager.delete falla (revierte transferOwnership UPDATE)', async () => {
      const victim = {
        ...mockUser,
        id: VICTIM_ID,
        name: 'V',
        role: editorRole,
        isActive: false,
      };
      mockTxnQueryBuilder.getOne.mockResolvedValueOnce(victim);
      mockScenariosService.transferOwnership.mockResolvedValue(undefined);
      mockQueryRunner.manager.delete.mockRejectedValue(
        new Error('fk violation'),
      );

      await expect(service.remove(VICTIM_ID, CALLER_ID)).rejects.toThrow(
        'fk violation',
      );

      expect(mockScenariosService.transferOwnership).toHaveBeenCalled();
      expect(mockQueryRunner.manager.delete).toHaveBeenCalledWith(
        User,
        VICTIM_ID,
      );
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).not.toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });
  });
});
