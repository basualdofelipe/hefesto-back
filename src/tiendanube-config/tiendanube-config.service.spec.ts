import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TiendanubeConfigService } from './tiendanube-config.service';
import { TnPaymentGateway } from './entities/tn-payment-gateway.entity';
import { TnGatewayRate } from './entities/tn-gateway-rate.entity';
import { TnInstallmentRate } from './entities/tn-installment-rate.entity';
import { TnTaxConfig } from './entities/tn-tax-config.entity';
import { TnPlan } from './entities/tn-plan.entity';
import { TnShippingConfig } from './entities/tn-shipping-config.entity';

const GATEWAY_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const RATE_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const TAX_CONFIG_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
const SHIPPING_CONFIG_ID = 'd4e5f6a7-b8c9-0123-def0-234567890123';
const PLAN_ID = 'e5f6a7b8-c9d0-4123-8f01-345678901234';
const MP_GATEWAY_ID = 'f6a7b8c9-d0e1-4234-9012-456789012345';

const mockGateway = {
  id: GATEWAY_ID,
  slug: 'pago_nube',
  label: 'Pago Nube',
  isActive: true,
} as TnPaymentGateway;

const mockMercadoPagoGateway = {
  id: MP_GATEWAY_ID,
  slug: 'mercado_pago',
  label: 'Mercado Pago',
  isActive: true,
} as TnPaymentGateway;

// NOTE: No EntityManager — TiendanubeConfigService only injects 6 repos
const mockGatewayRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  query: jest.fn(),
};
const mockGatewayRateRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  query: jest.fn(),
};
const mockInstallmentRateRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  query: jest.fn(),
};
const mockTaxConfigRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};
const mockPlanRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
};
const mockShippingConfigRepo = {
  findOne: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
};

const rawShippingConfig = {
  id: SHIPPING_CONFIG_ID,
  defaultShippingCost: '7315.00', // TypeORM DECIMAL as string
  defaultShippingCharged: '7315.00',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as TnShippingConfig;

describe('TiendanubeConfigService', () => {
  let service: TiendanubeConfigService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TiendanubeConfigService,
        {
          provide: getRepositoryToken(TnPaymentGateway),
          useValue: mockGatewayRepo,
        },
        {
          provide: getRepositoryToken(TnGatewayRate),
          useValue: mockGatewayRateRepo,
        },
        {
          provide: getRepositoryToken(TnInstallmentRate),
          useValue: mockInstallmentRateRepo,
        },
        {
          provide: getRepositoryToken(TnTaxConfig),
          useValue: mockTaxConfigRepo,
        },
        {
          provide: getRepositoryToken(TnPlan),
          useValue: mockPlanRepo,
        },
        {
          provide: getRepositoryToken(TnShippingConfig),
          useValue: mockShippingConfigRepo,
        },
      ],
    }).compile();

    service = module.get<TiendanubeConfigService>(TiendanubeConfigService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ---------------------------------------------------------------
  // updateGatewayRate — NotFoundException + string→number parsing
  // ---------------------------------------------------------------
  describe('updateGatewayRate', () => {
    it('throws NotFoundException when gateway is not found', async () => {
      mockGatewayRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateGatewayRate(GATEWAY_ID, {
          paymentMethod: 'tarjeta_debito_credito',
          withdrawalDays: 1,
          ratePercent: 2.5,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mockGatewayRateRepo.save).not.toHaveBeenCalled();
    });

    it('parses ratePercent string to number and appends a new rate record', async () => {
      mockGatewayRepo.findOne.mockResolvedValue(mockGateway);

      const rawRate = {
        id: RATE_ID,
        gateway: mockGateway,
        paymentMethod: 'tarjeta_debito_credito',
        withdrawalDays: 1,
        ratePercent: '2.5', // TypeORM returns DECIMAL as string
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as TnGatewayRate;

      mockGatewayRateRepo.create.mockReturnValue(rawRate);
      mockGatewayRateRepo.save.mockResolvedValue(rawRate);

      const result = await service.updateGatewayRate(GATEWAY_ID, {
        paymentMethod: 'tarjeta_debito_credito',
        withdrawalDays: 1,
        ratePercent: 2.5,
      });

      // parseGatewayRate converts string → number
      expect(typeof result.ratePercent).toBe('number');
      expect(result.ratePercent).toBe(2.5);
      // A new record was appended (save was called)
      expect(mockGatewayRateRepo.save).toHaveBeenCalledWith(rawRate);
    });

    describe('plan-scoped rates (D-06)', () => {
      const baseDto = {
        paymentMethod: 'tarjeta_debito_credito',
        withdrawalDays: 14,
        ratePercent: 2.99,
      };
      const savedRate = {
        id: RATE_ID,
        gateway: mockGateway,
        paymentMethod: 'tarjeta_debito_credito',
        withdrawalDays: 14,
        ratePercent: '2.99',
        isActive: true,
        plan: { id: PLAN_ID },
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as TnGatewayRate;

      beforeEach(() => {
        mockGatewayRateRepo.create.mockReturnValue(savedRate);
        mockGatewayRateRepo.save.mockResolvedValue(savedRate);
      });

      it('attaches the plan for Pago Nube when planId is given and exposes planId on the result', async () => {
        mockGatewayRepo.findOne.mockResolvedValue(mockGateway);
        mockPlanRepo.findOne.mockResolvedValue({ id: PLAN_ID, slug: 'escala' });

        const result = await service.updateGatewayRate(GATEWAY_ID, {
          ...baseDto,
          planId: PLAN_ID,
        });

        expect(mockPlanRepo.findOne).toHaveBeenCalledWith({
          where: { id: PLAN_ID },
        });
        expect(mockGatewayRateRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({
            plan: expect.objectContaining({ id: PLAN_ID }),
          }),
        );
        expect(result.planId).toBe(PLAN_ID);
      });

      it('throws NotFoundException("Plan no encontrado") for an unknown planId on Pago Nube', async () => {
        mockGatewayRepo.findOne.mockResolvedValue(mockGateway);
        mockPlanRepo.findOne.mockResolvedValue(null);

        await expect(
          service.updateGatewayRate(GATEWAY_ID, {
            ...baseDto,
            planId: PLAN_ID,
          }),
        ).rejects.toThrow(new NotFoundException('Plan no encontrado'));

        expect(mockGatewayRateRepo.save).not.toHaveBeenCalled();
      });

      it('ignores planId for a gateway whose fee does not vary by plan (mercado_pago): plan null, plan repo untouched', async () => {
        mockGatewayRepo.findOne.mockResolvedValue(mockMercadoPagoGateway);

        await service.updateGatewayRate(MP_GATEWAY_ID, {
          ...baseDto,
          planId: PLAN_ID,
        });

        expect(mockPlanRepo.findOne).not.toHaveBeenCalled();
        expect(mockGatewayRateRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ plan: null }),
        );
      });

      it('stores plan null when the dto carries no planId', async () => {
        mockGatewayRepo.findOne.mockResolvedValue(mockGateway);

        await service.updateGatewayRate(GATEWAY_ID, baseDto);

        expect(mockPlanRepo.findOne).not.toHaveBeenCalled();
        expect(mockGatewayRateRepo.create).toHaveBeenCalledWith(
          expect.objectContaining({ plan: null }),
        );
      });
    });
  });

  // ---------------------------------------------------------------
  // getTaxConfig — returns null when no active config exists
  // ---------------------------------------------------------------
  describe('getTaxConfig', () => {
    it('returns null when no active tax config exists', async () => {
      mockTaxConfigRepo.findOne.mockResolvedValue(null);

      const result = await service.getTaxConfig();

      expect(result).toBeNull();
      expect(mockTaxConfigRepo.findOne).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { createdAt: 'DESC' },
      });
    });

    it('returns parsed tax config with numeric ivaRate and iibbRate when active config exists', async () => {
      const rawConfig = {
        id: TAX_CONFIG_ID,
        ivaRate: '21', // TypeORM DECIMAL as string
        iibbRate: '3.5',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as TnTaxConfig;
      mockTaxConfigRepo.findOne.mockResolvedValue(rawConfig);

      const result = await service.getTaxConfig();

      expect(result).not.toBeNull();
      expect(typeof result!.ivaRate).toBe('number');
      expect(result!.ivaRate).toBe(21);
      expect(typeof result!.iibbRate).toBe('number');
      expect(result!.iibbRate).toBe(3.5);
    });
  });

  // ---------------------------------------------------------------
  // updateTaxConfig — append-only, prior record untouched
  // ---------------------------------------------------------------
  describe('updateTaxConfig', () => {
    it('appends a new tax config record without modifying any prior record', async () => {
      const newConfig = {
        id: TAX_CONFIG_ID,
        ivaRate: '21',
        iibbRate: '3.5',
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as TnTaxConfig;

      mockTaxConfigRepo.create.mockReturnValue(newConfig);
      mockTaxConfigRepo.save.mockResolvedValue(newConfig);

      const result = await service.updateTaxConfig({
        ivaRate: 21,
        iibbRate: 3.5,
      });

      // A new record was created (not updated — append-only)
      expect(mockTaxConfigRepo.create).toHaveBeenCalledWith({
        ivaRate: '21',
        iibbRate: '3.5',
      });
      expect(mockTaxConfigRepo.save).toHaveBeenCalledWith(newConfig);
      // Result has numeric parsed values
      expect(result.ivaRate).toBe(21);
      expect(result.iibbRate).toBe(3.5);
    });
  });

  // ---------------------------------------------------------------
  // getShippingConfig — latest active row, decimals parsed to numbers
  // ---------------------------------------------------------------
  describe('getShippingConfig', () => {
    it('returns null when no shipping config row exists', async () => {
      mockShippingConfigRepo.findOne.mockResolvedValue(null);

      const result = await service.getShippingConfig();

      expect(result).toBeNull();
      expect(mockShippingConfigRepo.findOne).toHaveBeenCalledWith({
        where: { isActive: true },
        order: { createdAt: 'DESC' },
      });
    });

    it('returns the latest active row with numeric defaultShippingCost and defaultShippingCharged', async () => {
      mockShippingConfigRepo.findOne.mockResolvedValue(rawShippingConfig);

      const result = await service.getShippingConfig();

      expect(result).not.toBeNull();
      expect(typeof result!.defaultShippingCost).toBe('number');
      expect(result!.defaultShippingCost).toBe(7315);
      expect(typeof result!.defaultShippingCharged).toBe('number');
      expect(result!.defaultShippingCharged).toBe(7315);
    });
  });

  // ---------------------------------------------------------------
  // updateShippingConfig — append-only, prior record untouched
  // ---------------------------------------------------------------
  describe('updateShippingConfig', () => {
    it('appends a new shipping config record (create + save) and returns parsed numbers', async () => {
      const created = {
        ...rawShippingConfig,
        defaultShippingCost: '7315',
        defaultShippingCharged: '0',
      } as unknown as TnShippingConfig;
      mockShippingConfigRepo.create.mockReturnValue(created);
      mockShippingConfigRepo.save.mockResolvedValue(created);

      const result = await service.updateShippingConfig({
        defaultShippingCost: 7315,
        defaultShippingCharged: 0,
      });

      expect(mockShippingConfigRepo.create).toHaveBeenCalledWith({
        defaultShippingCost: '7315',
        defaultShippingCharged: '0',
      });
      expect(mockShippingConfigRepo.save).toHaveBeenCalledWith(created);
      expect(result.defaultShippingCost).toBe(7315);
      expect(result.defaultShippingCharged).toBe(0);
    });

    it('never calls a repository update (append-only history)', async () => {
      const repoWithUpdate = mockShippingConfigRepo as unknown as {
        update?: jest.Mock;
      };
      repoWithUpdate.update = jest.fn();
      mockShippingConfigRepo.create.mockReturnValue(rawShippingConfig);
      mockShippingConfigRepo.save.mockResolvedValue(rawShippingConfig);

      await service.updateShippingConfig({
        defaultShippingCost: 7315,
        defaultShippingCharged: 7315,
      });

      expect(repoWithUpdate.update).not.toHaveBeenCalled();
      delete repoWithUpdate.update;
    });
  });

  // ---------------------------------------------------------------
  // getAll — carries the shipping default as its sixth member
  // ---------------------------------------------------------------
  describe('getAll', () => {
    beforeEach(() => {
      mockGatewayRepo.find.mockResolvedValue([mockGateway]);
      mockGatewayRateRepo.query.mockResolvedValue([]);
      mockInstallmentRateRepo.query.mockResolvedValue([]);
      mockTaxConfigRepo.findOne.mockResolvedValue(null);
      mockPlanRepo.find.mockResolvedValue([]);
    });

    it('returns shipping equal to the parsed latest shipping config row', async () => {
      mockShippingConfigRepo.findOne.mockResolvedValue(rawShippingConfig);

      const result = await service.getAll();

      expect(result.shipping).toEqual(
        expect.objectContaining({
          defaultShippingCost: 7315,
          defaultShippingCharged: 7315,
        }),
      );
    });

    it('returns shipping null when no shipping config row exists', async () => {
      mockShippingConfigRepo.findOne.mockResolvedValue(null);

      const result = await service.getAll();

      expect(result.shipping).toBeNull();
      expect(result.gateways).toEqual([mockGateway]);
    });

    it('selects the latest gateway rate per (gateway, method, days, plan) — DISTINCT ON and ORDER BY include gr.plan_id', async () => {
      mockShippingConfigRepo.findOne.mockResolvedValue(null);

      await service.getAll();

      expect(mockGatewayRateRepo.query).toHaveBeenCalledWith(
        expect.stringContaining(
          'DISTINCT ON (gr.gateway_id, gr.payment_method, gr.withdrawal_days, gr.plan_id)',
        ),
      );
      expect(mockGatewayRateRepo.query).toHaveBeenCalledWith(
        expect.stringContaining('gr.plan_id AS "planId"'),
      );
      expect(mockGatewayRateRepo.query).toHaveBeenCalledWith(
        expect.stringContaining(
          'ORDER BY gr.gateway_id, gr.payment_method, gr.withdrawal_days, gr.plan_id, gr.created_at DESC',
        ),
      );
    });

    it('exposes planId on every rate row (null for all-plan rows, the plan uuid for plan-scoped rows)', async () => {
      mockShippingConfigRepo.findOne.mockResolvedValue(null);
      mockGatewayRateRepo.query.mockResolvedValue([
        {
          id: RATE_ID,
          paymentMethod: 'tarjeta_debito_credito',
          withdrawalDays: 14,
          ratePercent: '3.49',
          isActive: true,
          planId: null,
          gateway: mockGateway,
        },
        {
          id: 'c0ffee00-0000-4000-8000-000000000001',
          paymentMethod: 'tarjeta_debito_credito',
          withdrawalDays: 14,
          ratePercent: '2.99',
          isActive: true,
          planId: PLAN_ID,
          gateway: mockGateway,
        },
      ]);

      const result = await service.getAll();

      expect(result.rates.map((r) => [r.planId, r.ratePercent])).toEqual([
        [null, 3.49],
        [PLAN_ID, 2.99],
      ]);
    });
  });

  // ---------------------------------------------------------------
  // getGatewaysWithRates — same plan-aware query
  // ---------------------------------------------------------------
  describe('getGatewaysWithRates', () => {
    it('uses the plan-aware DISTINCT ON query', async () => {
      mockGatewayRepo.find.mockResolvedValue([mockGateway]);
      mockGatewayRateRepo.query.mockResolvedValue([]);

      await service.getGatewaysWithRates();

      expect(mockGatewayRateRepo.query).toHaveBeenCalledWith(
        expect.stringContaining(
          'DISTINCT ON (gr.gateway_id, gr.payment_method, gr.withdrawal_days, gr.plan_id)',
        ),
      );
    });
  });
});
