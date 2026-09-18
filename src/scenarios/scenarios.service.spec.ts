import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';

// These imports will resolve after Task 1 creates the files
import { ScenariosService } from './scenarios.service';
import { Scenario } from './entities/scenario.entity';
import { ScenarioOverride } from './entities/scenario-override.entity';
import { CalculatorService } from '../calculator/calculator.service';
import { CostsService } from '../costs/costs.service';
import { ProductsService } from '../products/products.service';
import { TiendanubeConfigService } from '../tiendanube-config/tiendanube-config.service';

describe('ScenariosService', () => {
  let service: ScenariosService;

  const mockScenarioRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    remove: jest.fn(),
    manager: { connection: { createQueryRunner: jest.fn() } },
  };

  const mockOverrideRepo = {
    create: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
  };

  const mockCalculatorService = {
    calcForward: jest.fn(),
  };

  const mockCostsService = {
    calculateAll: jest.fn(),
  };

  const mockProductsService = {
    findAll: jest.fn(),
  };

  const mockTiendanubeConfigService = {
    getAll: jest.fn(),
  };

  const USER_ID = 'user-uuid-1';
  const OTHER_USER_ID = 'user-uuid-2';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScenariosService,
        {
          provide: getRepositoryToken(Scenario),
          useValue: mockScenarioRepo,
        },
        {
          provide: getRepositoryToken(ScenarioOverride),
          useValue: mockOverrideRepo,
        },
        {
          provide: CalculatorService,
          useValue: mockCalculatorService,
        },
        {
          provide: CostsService,
          useValue: mockCostsService,
        },
        {
          provide: ProductsService,
          useValue: mockProductsService,
        },
        {
          provide: TiendanubeConfigService,
          useValue: mockTiendanubeConfigService,
        },
      ],
    }).compile();

    service = module.get<ScenariosService>(ScenariosService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // SCEN-01: Create scenario + name uniqueness
  describe('create', () => {
    it('should create a scenario with valid data', async () => {
      const dto = { name: 'Aumento Enero 2027', gatewaySlug: 'pago_nube' };
      const created = {
        id: 'scenario-1',
        ...dto,
        user: { id: USER_ID },
        isPublic: false,
      };

      mockScenarioRepo.findOne.mockResolvedValue(null); // no duplicate
      mockScenarioRepo.create.mockReturnValue(created);
      mockScenarioRepo.save.mockResolvedValue(created);

      const result = await service.create(dto as never, USER_ID);
      expect(result).toEqual(created);
      expect(mockScenarioRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: dto.name, user: { id: USER_ID } },
        }),
      );
    });

    it('should throw ConflictException when name is duplicate for same user', async () => {
      const dto = { name: 'Duplicate Name' };
      mockScenarioRepo.findOne.mockResolvedValue({
        id: 'existing',
        name: dto.name,
      });

      await expect(service.create(dto as never, USER_ID)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  // SCEN-04: User scoping -- own + public visibility
  describe('findAll', () => {
    it('should return own scenarios and public scenarios from other users', async () => {
      const ownScenario = {
        id: 's1',
        name: 'Mine',
        user: { id: USER_ID },
        isPublic: false,
      };
      const publicOther = {
        id: 's2',
        name: 'Shared',
        user: { id: OTHER_USER_ID },
        isPublic: true,
      };

      mockScenarioRepo.find
        .mockResolvedValueOnce([ownScenario]) // own query
        .mockResolvedValueOnce([publicOther]); // public others query

      const result = await service.findAll(USER_ID);
      expect(result).toHaveLength(2);
      expect(result).toEqual(
        expect.arrayContaining([ownScenario, publicOther]),
      );
    });
  });

  // SCEN-04: Only owner can edit
  describe('update', () => {
    it('should throw NotFoundException when non-owner tries to update', async () => {
      mockScenarioRepo.findOne.mockResolvedValue(null); // owner check fails

      await expect(
        service.update(
          'scenario-1',
          { name: 'New Name' } as never,
          OTHER_USER_ID,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // SCEN-03: Calculate delegates to calcForward and includes inactive products
  describe('calculate', () => {
    it('should call calculadoraService.calcForward for each product with effective price', async () => {
      // Arrange
      const scenario = {
        id: 'scenario-1',
        name: 'Test',
        gatewaySlug: 'pago_nube',
        paymentMethod: 'tarjeta_debito_credito',
        withdrawalDays: 1,
        installments: 1,
        plan: { slug: 'esencial' },
        overrides: [{ product: { id: 'prod-1' }, overridePrice: '95000' }],
        user: { id: USER_ID },
        isPublic: false,
      };

      // Mock findOne to return scenario (via the service's own findOne)
      mockScenarioRepo.findOne.mockResolvedValue(scenario);

      mockTiendanubeConfigService.getAll.mockResolvedValue({
        gateways: [],
        rates: [],
        installments: [],
        taxConfig: null,
        plans: [],
      });

      mockCostsService.calculateAll.mockResolvedValue(
        new Map([['prod-1', { cost: 30000 }]]),
      );

      // NOTE: findAll(true) -- includes inactive products (review fix)
      mockProductsService.findAll.mockResolvedValue([
        {
          id: 'prod-1',
          currentPrice: '80000',
          isActive: true,
          type: { name: 'Billetera' },
          name: { name: 'Hefesto' },
          finish: { name: 'Lisa' },
          color: { name: 'Marron' },
          size: null,
        },
      ]);

      const mockCalcResult = { realProfit: 50000, marginPercent: 52.6 };
      mockCalculatorService.calcForward.mockReturnValue(mockCalcResult);

      // Act
      const result = await service.calculate('scenario-1', USER_ID);

      // Assert
      expect(mockCalculatorService.calcForward).toHaveBeenCalled();
      expect(mockProductsService.findAll).toHaveBeenCalledWith(true); // includes inactive
      expect(result.results).toHaveLength(1);
      expect(result.results[0].overridePrice).toBe(95000);
      expect(result.results[0].effectivePrice).toBe(95000); // override takes precedence
      expect(result.results[0].simResult).toEqual(mockCalcResult);
    });

    it('should handle calcForward errors per product without crashing the loop', async () => {
      const scenario = {
        id: 'scenario-1',
        name: 'Test',
        gatewaySlug: 'pago_nube',
        paymentMethod: 'tarjeta_debito_credito',
        withdrawalDays: 1,
        installments: 1,
        plan: { slug: 'esencial' },
        overrides: [],
        user: { id: USER_ID },
        isPublic: false,
      };

      mockScenarioRepo.findOne.mockResolvedValue(scenario);
      mockTiendanubeConfigService.getAll.mockResolvedValue({
        gateways: [],
        rates: [],
        installments: [],
        taxConfig: null,
        plans: [],
      });
      mockCostsService.calculateAll.mockResolvedValue(
        new Map([
          ['prod-1', { cost: 30000 }],
          ['prod-2', { cost: 20000 }],
        ]),
      );
      mockProductsService.findAll.mockResolvedValue([
        {
          id: 'prod-1',
          currentPrice: '80000',
          isActive: true,
          type: { name: 'Billetera' },
          name: { name: 'Hefesto' },
          finish: { name: 'Lisa' },
          color: { name: 'Marron' },
          size: null,
        },
        {
          id: 'prod-2',
          currentPrice: '50000',
          isActive: true,
          type: { name: 'Cinturon' },
          name: { name: 'Ares' },
          finish: { name: 'Lisa' },
          color: { name: 'Negro' },
          size: null,
        },
      ]);

      // Call order: sim(prod-1), real(prod-1), sim(prod-2), real(prod-2)
      // prod-1 sim throws, prod-1 real also throws, prod-2 sim succeeds, prod-2 real succeeds
      mockCalculatorService.calcForward
        .mockImplementationOnce(() => {
          throw new Error('bad config');
        })
        .mockImplementationOnce(() => {
          throw new Error('bad config');
        })
        .mockReturnValueOnce({ realProfit: 20000, marginPercent: 40 })
        .mockReturnValueOnce({ realProfit: 20000, marginPercent: 40 });

      const result = await service.calculate('scenario-1', USER_ID);

      expect(result.results).toHaveLength(2);
      expect(result.results[0].simResult).toBeNull(); // error product gets null
      expect(result.results[0].realResult).toBeNull(); // error product real also null
      expect(result.results[1].simResult).toEqual({
        realProfit: 20000,
        marginPercent: 40,
      }); // other product OK
    });
  });

  // 12.4-02: Cross-module ownership transfer (called by UsersService.remove)
  describe('transferOwnership', () => {
    const mockUpdateBuilder = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 2 }),
    };

    const mockQueryRunner = {
      manager: {
        createQueryBuilder: jest.fn(() => mockUpdateBuilder),
      },
    };

    beforeEach(() => {
      mockUpdateBuilder.update.mockClear().mockReturnThis();
      mockUpdateBuilder.set.mockClear().mockReturnThis();
      mockUpdateBuilder.where.mockClear().mockReturnThis();
      mockUpdateBuilder.setParameter.mockClear().mockReturnThis();
      mockUpdateBuilder.execute.mockClear().mockResolvedValue({ affected: 2 });
      mockQueryRunner.manager.createQueryBuilder
        .mockClear()
        .mockReturnValue(mockUpdateBuilder);
    });

    it('aplica el sufijo y mueve scenarios al nuevo owner', async () => {
      await service.transferOwnership(
        'victim-uuid',
        'caller-uuid',
        ' - Juan',
        mockQueryRunner as unknown as QueryRunner,
      );

      expect(mockUpdateBuilder.update).toHaveBeenCalledWith(Scenario);
      // WR-A8 (corrected for UAT Test 6 gap closure): assert that .set()
      // includes `updatedAt` (PROPERTY name on BaseEntity), not `updated_at`
      // (DB column name). TypeORM QueryBuilder .set() resolves by property name
      // and throws EntityPropertyNotFoundError when given the column name.
      // The value is a raw SQL arrow function (() => 'NOW()') so the bulk
      // UPDATE bypasses the @UpdateDateColumn subscriber (which only fires via
      // repo.save / manager.save) and the transferred scenarios surface at the
      // top of the new owner's list (sorted by updatedAt DESC).
      expect(mockUpdateBuilder.set).toHaveBeenCalledWith(
        expect.objectContaining({
          name: expect.any(Function),
          user: { id: 'caller-uuid' },
          updatedAt: expect.any(Function),
        }),
      );
      expect(mockUpdateBuilder.where).toHaveBeenCalledWith(
        'user_id = :victimId',
        { victimId: 'victim-uuid' },
      );
      expect(mockUpdateBuilder.setParameter).toHaveBeenCalledWith(
        'suffix',
        ' - Juan',
      );
      expect(mockUpdateBuilder.execute).toHaveBeenCalledTimes(1);
    });

    // WR-A7: the base name is truncated BEFORE concatenation with the
    // suffix, so the discriminator (` - <name> #<shortId>`) cannot be cut
    // by the final varchar(200) limit. Verified by inspecting the raw SQL
    // emitted by the name-set arrow function.
    it('WR-A7: trunca el name base ANTES de concatenar para preservar el sufijo intacto', async () => {
      const suffix = ' - Maria #ab12cd34'; // 18 chars
      await service.transferOwnership(
        'victim-uuid',
        'caller-uuid',
        suffix,
        mockQueryRunner as unknown as QueryRunner,
      );

      const setArg = mockUpdateBuilder.set.mock.calls[0][0] as {
        name: () => string;
      };
      const sql = setArg.name();
      // Expected: LEFT(COALESCE(name, ''), 182) || :suffix
      // The 200 cap is enforced by varchar(200) at the DB layer; we only
      // need to ensure the JS-side truncation leaves room for the suffix.
      expect(sql).toBe(
        `LEFT(COALESCE(name, ''), ${200 - suffix.length}) || :suffix`,
      );
    });

    // WR-A7: defensive throw when the caller supplies a suffix as long as
    // (or longer than) the column itself -- otherwise baseMax would be <= 0
    // and the SQL would silently produce an empty base.
    it('WR-A7: throws cuando suffix.length >= 200 (overflow defensivo)', async () => {
      const overflowSuffix = ' '.repeat(200);
      await expect(
        service.transferOwnership(
          'victim-uuid',
          'caller-uuid',
          overflowSuffix,
          mockQueryRunner as unknown as QueryRunner,
        ),
      ).rejects.toThrow(/suffix length 200 >= 200/);
      expect(mockUpdateBuilder.execute).not.toHaveBeenCalled();
    });

    it('ejecuta el UPDATE incluso cuando victim no tiene scenarios (idempotent: affected=0 no rompe)', async () => {
      // The implementation always runs the bulk UPDATE; when the
      // victim has zero scenarios, execute() returns affected=0 and the
      // method resolves to undefined (no error). This test does not assert
      // any "skip the query" optimization -- it asserts that a zero-rows
      // result is non-fatal (matches the documented contract that the
      // caller does not need to pre-check for emptiness).
      mockUpdateBuilder.execute.mockResolvedValueOnce({ affected: 0 });

      await expect(
        service.transferOwnership(
          'victim',
          'caller',
          ' - X',
          mockQueryRunner as unknown as QueryRunner,
        ),
      ).resolves.toBeUndefined();

      expect(mockUpdateBuilder.execute).toHaveBeenCalledTimes(1);
    });
  });
});
