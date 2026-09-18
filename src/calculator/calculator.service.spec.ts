import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  CalculatorService,
  PRODUCT_COST_REQUIRED_MESSAGE,
} from './calculator.service';
import {
  TiendanubeConfigService,
  TiendanubeConfigAll,
} from '../tiendanube-config/tiendanube-config.service';
import { CostsService } from '../costs/costs.service';
import {
  ProductsService,
  ProductWithPrice,
} from '../products/products.service';
import {
  TN_GATEWAY_PAGO_NUBE,
  TN_PAYMENT_TARJETA,
  TN_PLAN_ESENCIAL,
} from '../constants/tiendanube';
import {
  CalcResult,
  CalcError,
  CalcBatchItem,
  CalcInverseResult,
} from './dto/calc-result.dto';
import { ProductCostData } from '../costs/dto/product-with-cost.dto';
import { Product } from '../products/entities/product.entity';

// ─── Mock config matching the runtime shape of TiendanubeConfigService.getAll() ──

const GATEWAY_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MP_GATEWAY_UUID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const PLAN_ESENCIAL_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLAN_ESCALA_UUID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TN_PLAN_ESCALA = 'escala';
const TN_GATEWAY_MERCADO_PAGO = 'mercado_pago';
const TN_PAYMENT_TODOS_LOS_MEDIOS = 'todos_los_medios';

type MockRate = TiendanubeConfigAll['rates'][number];

const pagoNubeGateway = {
  id: GATEWAY_UUID,
  slug: TN_GATEWAY_PAGO_NUBE,
  label: 'Pago Nube',
  isActive: true,
};
const mercadoPagoGateway = {
  id: MP_GATEWAY_UUID,
  slug: TN_GATEWAY_MERCADO_PAGO,
  label: 'Mercado Pago',
  isActive: true,
};

// Pago Nube tarjeta 14 d: one row per plan plus the null-plan fallback (D-05)
const PN_TARJETA_14_ESENCIAL = {
  id: 'rate-pn-14-esencial',
  gateway: pagoNubeGateway,
  paymentMethod: TN_PAYMENT_TARJETA,
  withdrawalDays: 14,
  ratePercent: 3.49,
  isActive: true,
  planId: PLAN_ESENCIAL_UUID,
} as unknown as MockRate;
const PN_TARJETA_14_ESCALA = {
  id: 'rate-pn-14-escala',
  gateway: pagoNubeGateway,
  paymentMethod: TN_PAYMENT_TARJETA,
  withdrawalDays: 14,
  ratePercent: 2.99,
  isActive: true,
  planId: PLAN_ESCALA_UUID,
} as unknown as MockRate;
const PN_TARJETA_14_ALL_PLANS = {
  id: 'rate-pn-14-null',
  gateway: pagoNubeGateway,
  paymentMethod: TN_PAYMENT_TARJETA,
  withdrawalDays: 14,
  ratePercent: 3.49,
  isActive: true,
  planId: null,
} as unknown as MockRate;
// Mercado Pago has no per-plan fee: a single null-plan row
const MP_TODOS_14_ALL_PLANS = {
  id: 'rate-mp-14-null',
  gateway: mercadoPagoGateway,
  paymentMethod: TN_PAYMENT_TODOS_LOS_MEDIOS,
  withdrawalDays: 14,
  ratePercent: 4.5,
  isActive: true,
  planId: null,
} as unknown as MockRate;

const mockConfig: TiendanubeConfigAll = {
  gateways: [
    {
      ...pagoNubeGateway,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as TiendanubeConfigAll['gateways'][number],
    {
      ...mercadoPagoGateway,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as TiendanubeConfigAll['gateways'][number],
  ],
  // Escala first on purpose: a tuple-only match or plans[0] would pick Escala
  rates: [
    PN_TARJETA_14_ESCALA,
    PN_TARJETA_14_ESENCIAL,
    PN_TARJETA_14_ALL_PLANS,
    MP_TODOS_14_ALL_PLANS,
  ],
  installments: [
    {
      id: 'inst-1',
      installments: 1,
      ratePercent: 0,
      isActive: true,
    } as unknown as TiendanubeConfigAll['installments'][number],
  ],
  taxConfig: {
    ivaRate: 21,
    iibbRate: 3.5,
  } as TiendanubeConfigAll['taxConfig'],
  // Runtime order (getPlans sorts by slug ASC): Escala before Esencial
  plans: [
    {
      id: PLAN_ESCALA_UUID,
      slug: TN_PLAN_ESCALA,
      label: 'Escala',
      cptPagoNube: 0,
      cptOtherGateways: 0.7,
      isActive: true,
      onlyPagoNube: false,
    } as unknown as TiendanubeConfigAll['plans'][number],
    {
      id: PLAN_ESENCIAL_UUID,
      slug: TN_PLAN_ESENCIAL,
      label: 'Esencial',
      cptPagoNube: 0,
      cptOtherGateways: 2,
      isActive: true,
      onlyPagoNube: false,
    } as unknown as TiendanubeConfigAll['plans'][number],
  ],
  shipping: null,
};

const mockConfigIva105: TiendanubeConfigAll = {
  ...mockConfig,
  taxConfig: {
    ivaRate: 10.5,
    iibbRate: 3.5,
  } as TiendanubeConfigAll['taxConfig'],
};

// Configured shipping default 7315 / 7315 (case A shipping applied to the batch)
const mockConfigShipping7315: TiendanubeConfigAll = {
  ...mockConfig,
  shipping: {
    defaultShippingCost: 7315,
    defaultShippingCharged: 7315,
  } as TiendanubeConfigAll['shipping'],
};

// Shared params for the SPEC reference cases (PN tarjeta 14 d, 1 installment, Esencial)
const BASE = {
  productCost: 6534.48,
  gatewaySlug: TN_GATEWAY_PAGO_NUBE,
  paymentMethod: TN_PAYMENT_TARJETA,
  withdrawalDays: 14,
  installments: 1,
  planSlug: TN_PLAN_ESENCIAL,
  config: mockConfig,
};

const CASE_A = {
  sellingPrice: 87000,
  shippingCharged: 7315,
  shippingCost: 7315,
};

describe('CalculatorService', () => {
  let service: CalculatorService;
  let costsService: jest.Mocked<CostsService>;
  let productsService: jest.Mocked<ProductsService>;
  let tiendanubeConfigService: jest.Mocked<TiendanubeConfigService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalculatorService,
        {
          provide: TiendanubeConfigService,
          useValue: {
            getAll: jest.fn().mockResolvedValue(mockConfig),
          },
        },
        {
          provide: CostsService,
          useValue: {
            calculateAll: jest.fn(),
            calculateForProduct: jest.fn(),
          },
        },
        {
          provide: ProductsService,
          useValue: {
            findAll: jest.fn(),
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<CalculatorService>(CalculatorService);
    costsService = module.get(CostsService);
    productsService = module.get(ProductsService);
    tiendanubeConfigService = module.get(TiendanubeConfigService);
  });

  // ─── calcForward: SPEC reference cases A–D (literals copied from the SPEC table) ──

  describe('calcForward reference cases', () => {
    test.each([
      {
        name: 'A: 87000 / shipping 7315 charged / 7315 cost',
        input: CASE_A,
        realProfit: 58773.73,
        marginPercent: 67.56,
        baseRate: 3.49,
        intermediates: {
          customerTotal: 94315,
          gatewayFee: 3982.8281,
          taxableBase: 77946.281,
          ivaDebit: 16368.719,
          ivaCreditProduct: 1372.2408,
          ivaCreditGatewayFee: 691.2346,
          ivaCreditShipping: 1269.5455,
          ivaNet: 13035.6981,
          iibbWithholding: 3301.025,
          netReceived: 87031.1469,
          productCostWithIva: 7906.7208,
        },
        shippingCost: 7315,
      },
      {
        name: 'B: 80000 / shipping 1000000 charged / 1000000 cost (shipping > total)',
        input: {
          sellingPrice: 80000,
          shippingCharged: 1000000,
          shippingCost: 1000000,
        },
        realProfit: -15910.78,
        marginPercent: -19.89,
        baseRate: 3.49,
        intermediates: {
          customerTotal: 1080000,
          gatewayFee: 45607.32,
          ivaCreditShipping: 173553.719,
          ivaNet: 4596.7367,
          iibbWithholding: 37800,
          netReceived: 996592.68,
        },
        shippingCost: 1000000,
      },
      {
        name: 'C: 87000 / free shipping (0 charged / 7315 cost)',
        input: { sellingPrice: 87000, shippingCharged: 0, shippingCost: 7315 },
        realProfit: 53239.59,
        marginPercent: 61.19,
        baseRate: 3.49,
        intermediates: {
          customerTotal: 87000,
          gatewayFee: 3673.923,
          ivaCreditShipping: 1269.5455,
          ivaNet: 11819.7643,
          netReceived: 80281.077,
        },
        shippingCost: 7315,
      },
      {
        name: 'D: 87000 / no shipping (0 / 0)',
        input: { sellingPrice: 87000, shippingCharged: 0, shippingCost: 0 },
        realProfit: 59285.05,
        marginPercent: 68.14,
        baseRate: 3.49,
        intermediates: {
          ivaCreditShipping: 0,
          ivaNet: 13089.3098,
          netReceived: 80281.077,
        },
        shippingCost: 0,
      },
      {
        name: 'E: 87000 / shipping 7315 / 7315, plan Escala (rate 2.99)',
        input: { ...CASE_A, planSlug: TN_PLAN_ESCALA },
        realProfit: 59245.3,
        marginPercent: 68.1,
        baseRate: 2.99,
        intermediates: {
          rateWithIva: 3.6179,
          gatewayFee: 3412.2224,
          ivaCreditGatewayFee: 592.2039,
          ivaNet: 13134.7289,
          netReceived: 87601.7526,
        },
        shippingCost: 7315,
      },
    ])(
      'case $name',
      ({
        input,
        realProfit,
        marginPercent,
        baseRate,
        intermediates,
        shippingCost,
      }) => {
        const result: CalcResult = service.calcForward({ ...BASE, ...input });

        expect(result.realProfit).toBe(realProfit);
        expect(result.marginPercent).toBe(marginPercent);
        expect(result.baseRate).toBe(baseRate);

        for (const [key, expected] of Object.entries(intermediates)) {
          expect(result[key as keyof CalcResult]).toBeCloseTo(expected, 2);
        }

        expect(result.shippingCost).toBe(shippingCost);
        // 1 installment (0 %) and CPT Pago Nube 0 % -> both cost rows are exactly 0
        expect(result.financingCost).toBe(0);
        expect(result.cpt).toBe(0);
      },
    );

    it('computes ivaCreditShipping from the configured IVA rate (10.5 vs 21)', () => {
      const result = service.calcForward({
        ...BASE,
        ...CASE_A,
        config: mockConfigIva105,
      });

      expect(result.ivaCreditShipping).toBeCloseTo(695.0905, 2);
      expect(result.realProfit).not.toBe(58773.73);
    });
  });

  // ─── calcForward: resolveRates 404s ──────────────────────────────

  describe('calcForward rate resolution', () => {
    it('throws NotFoundException for an unknown gateway slug', () => {
      expect(() =>
        service.calcForward({ ...BASE, ...CASE_A, gatewaySlug: 'unknown' }),
      ).toThrow(NotFoundException);
    });

    it('throws NotFoundException for an unknown installment count', () => {
      expect(() =>
        service.calcForward({ ...BASE, ...CASE_A, installments: 5 }),
      ).toThrow(NotFoundException);
    });

    it('throws NotFoundException when taxConfig is null', () => {
      expect(() =>
        service.calcForward({
          ...BASE,
          ...CASE_A,
          config: { ...mockConfig, taxConfig: null },
        }),
      ).toThrow(NotFoundException);
    });

    it('throws NotFoundException for an unknown planSlug', () => {
      expect(() =>
        service.calcForward({ ...BASE, ...CASE_A, planSlug: 'premium' }),
      ).toThrow(new NotFoundException('Plan not found: premium'));
    });
  });

  // ─── calcForward: per-plan rate resolution (R5, D-05) ────────────

  describe('calcForward per-plan rates', () => {
    it('defaults to Esencial when planSlug is omitted (case A numbers, not Escala)', () => {
      const result = service.calcForward({
        ...BASE,
        ...CASE_A,
        planSlug: undefined,
      });

      expect(result.realProfit).toBe(58773.73);
      expect(result.baseRate).toBe(3.49);
    });

    it("falls back to the null-plan row when the plan has no specific row (another plan's row is ignored)", () => {
      const result = service.calcForward({
        ...BASE,
        ...CASE_A,
        planSlug: TN_PLAN_ESENCIAL,
        config: {
          ...mockConfig,
          rates: [
            PN_TARJETA_14_ESCALA,
            PN_TARJETA_14_ALL_PLANS,
            MP_TODOS_14_ALL_PLANS,
          ],
        },
      });

      expect(result.baseRate).toBe(3.49);
      expect(result.realProfit).toBe(58773.73);
    });

    it('throws the tuple 404 when neither the plan row nor the null-plan row exists', () => {
      expect(() =>
        service.calcForward({
          ...BASE,
          ...CASE_A,
          planSlug: TN_PLAN_ESCALA,
          config: {
            ...mockConfig,
            rates: [PN_TARJETA_14_ESENCIAL, MP_TODOS_14_ALL_PLANS],
          },
        }),
      ).toThrow(
        new NotFoundException(
          'Gateway rate not found for pago_nube/tarjeta_debito_credito/14d',
        ),
      );
    });

    it('Mercado Pago (null-plan row) charges the same fee on Esencial and Escala; only the CPT differs', () => {
      const MP = {
        ...BASE,
        ...CASE_A,
        gatewaySlug: TN_GATEWAY_MERCADO_PAGO,
        paymentMethod: TN_PAYMENT_TODOS_LOS_MEDIOS,
      };

      const esencial = service.calcForward({
        ...MP,
        planSlug: TN_PLAN_ESENCIAL,
      });
      const escala = service.calcForward({ ...MP, planSlug: TN_PLAN_ESCALA });

      expect(esencial.baseRate).toBe(4.5);
      expect(escala.baseRate).toBe(esencial.baseRate);
      expect(escala.gatewayFee).toBe(esencial.gatewayFee);
      // CPT for other gateways: Esencial 2 % vs Escala 0.7 % of the 94315 customer total
      expect(esencial.cpt).toBeCloseTo(1886.3, 2);
      expect(escala.cpt).toBeCloseTo(660.205, 2);
    });
  });

  // ─── calcInverse ─────────────────────────────────────────────────

  describe('calcInverse', () => {
    const INVERSE_A = {
      ...BASE,
      shippingCharged: CASE_A.shippingCharged,
      shippingCost: CASE_A.shippingCost,
    };

    it('round-trips case A: targetProfit 58773.73 recovers 87000 within 0.01', () => {
      const inverse = service.calcInverse({
        ...INVERSE_A,
        targetProfit: 58773.73,
      });

      expect((inverse as CalcError).error).toBeUndefined();
      const { requiredSellingPrice } = inverse as CalcInverseResult;
      expect(Math.abs(requiredSellingPrice - 87000)).toBeLessThanOrEqual(0.01);

      const forward = service.calcForward({
        ...BASE,
        ...CASE_A,
        sellingPrice: requiredSellingPrice,
      });
      expect(Math.abs(forward.realProfit - 58773.73)).toBeLessThanOrEqual(0.01);
    });

    it('accepts targetProfit 0 (break-even) and returns a price whose profit is within 0.01 of 0', () => {
      const inverse = service.calcInverse({ ...INVERSE_A, targetProfit: 0 });

      expect((inverse as CalcError).error).toBeUndefined();
      const { requiredSellingPrice } = inverse as CalcInverseResult;
      // The bracket starts at productCost, so the break-even price must sit above it
      expect(requiredSellingPrice > 6534.48).toBe(true);

      const forward = service.calcForward({
        ...BASE,
        ...CASE_A,
        sellingPrice: requiredSellingPrice,
      });
      expect(Math.abs(forward.realProfit)).toBeLessThanOrEqual(0.01);
    });

    it('returns the product-cost-required error when productCost is 0 and targetProfit is 0', () => {
      const result = service.calcInverse({
        ...INVERSE_A,
        productCost: 0,
        targetProfit: 0,
      });

      expect(result).toEqual({
        error: true,
        message: 'Definí el costo del producto primero',
      });
      expect(PRODUCT_COST_REQUIRED_MESSAGE).toBe(
        'Definí el costo del producto primero',
      );
    });

    it('rejects a negative targetProfit', () => {
      const result = service.calcInverse({ ...INVERSE_A, targetProfit: -1 });

      expect(result).toEqual({
        error: true,
        message: 'La ganancia deseada no puede ser negativa',
      });
    });

    it('returns the unreachable error when targetProfit exceeds the upper bound', () => {
      const result = service.calcInverse({ ...INVERSE_A, targetProfit: 1e12 });

      expect(result).toEqual({
        error: true,
        message: 'Ganancia inalcanzable con estas tasas',
      });
    });
  });

  // ─── resolveProductCost: 400 / 404 / 400 "Definí…" / productId wins (R8, D-09) ──

  describe('resolveProductCost', () => {
    const KNOWN_PRODUCT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const UNKNOWN_PRODUCT_ID = '00000000-0000-4000-8000-000000000000';

    it('rejects with BadRequestException when neither productId nor productCost is given', async () => {
      await expect(
        service.resolveProductCost(undefined, undefined),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('returns productCost as-is when there is no productId, without touching products or costs', async () => {
      await expect(
        service.resolveProductCost(undefined, 6534.48),
      ).resolves.toBe(6534.48);

      expect(productsService.findOne).not.toHaveBeenCalled();
      expect(costsService.calculateForProduct).not.toHaveBeenCalled();
    });

    it('propagates NotFoundException for an unknown productId and never asks for its cost', async () => {
      productsService.findOne.mockRejectedValue(
        new NotFoundException('Producto no encontrado'),
      );

      await expect(
        service.resolveProductCost(UNKNOWN_PRODUCT_ID, undefined),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(costsService.calculateForProduct).not.toHaveBeenCalled();
    });

    it('rejects with the product-cost-required message when the product exists but has no BOM', async () => {
      productsService.findOne.mockResolvedValue({
        id: KNOWN_PRODUCT_ID,
      } as unknown as Product);
      costsService.calculateForProduct.mockResolvedValue(null);

      await expect(
        service.resolveProductCost(KNOWN_PRODUCT_ID, undefined),
      ).rejects.toThrow(new BadRequestException(PRODUCT_COST_REQUIRED_MESSAGE));
    });

    it('lets the DB cost win when both productId and productCost are given', async () => {
      productsService.findOne.mockResolvedValue({
        id: KNOWN_PRODUCT_ID,
      } as unknown as Product);
      costsService.calculateForProduct.mockResolvedValue({
        cost: 6534.48,
        costBreakdown: [],
        costWarnings: [],
      });

      await expect(
        service.resolveProductCost(KNOWN_PRODUCT_ID, 1),
      ).resolves.toBe(6534.48);
    });
  });

  // ─── calcBatch ───────────────────────────────────────────────────

  describe('calcBatch', () => {
    const productIds = [
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      'cccccccc-cccc-cccc-cccc-cccccccccccc',
      'dddddddd-dddd-dddd-dddd-dddddddddddd',
    ];

    beforeEach(() => {
      // currentPrice is a string: TypeORM returns decimal columns as strings
      productsService.findAll.mockResolvedValue([
        {
          id: productIds[0],
          type: { name: 'Billetera' },
          name: { name: 'Hefesto' },
          finish: { name: 'Lisa' },
          currentPrice: '87000.00',
          lastPriceUpdate: new Date(),
        } as unknown as ProductWithPrice,
        {
          id: productIds[1],
          type: { name: 'Cinturon' },
          name: { name: 'Ares' },
          finish: { name: 'Grabada' },
          currentPrice: '45000.00',
          lastPriceUpdate: new Date(),
        } as unknown as ProductWithPrice,
        {
          id: productIds[2],
          type: { name: 'Bolso' },
          name: { name: 'Atenea' },
          finish: { name: 'Lisa' },
          currentPrice: null,
          lastPriceUpdate: null,
        } as unknown as ProductWithPrice,
      ]);

      const costMap = new Map<string, ProductCostData>();
      costMap.set(productIds[0], {
        cost: 6534.48,
        costBreakdown: [],
        costWarnings: [],
      });
      costMap.set(productIds[1], {
        cost: 3200,
        costBreakdown: [],
        costWarnings: [],
      });
      costMap.set(productIds[2], {
        cost: 9800,
        costBreakdown: [],
        costWarnings: [],
      });
      costsService.calculateAll.mockResolvedValue(costMap);
    });

    it('returns the case-D profit for the 87000 product when no shipping default is configured (shipping null → 0/0)', async () => {
      const results: CalcBatchItem[] = await service.calcBatch({
        gatewaySlug: TN_GATEWAY_PAGO_NUBE,
        paymentMethod: TN_PAYMENT_TARJETA,
        withdrawalDays: 14,
        installments: 1,
        planSlug: TN_PLAN_ESENCIAL,
      });

      expect(results).toHaveLength(3);

      const hefesto = results[0];
      expect(hefesto.productName).toBe('Billetera Hefesto Lisa');
      expect(hefesto.currentPrice).toBe(87000);
      expect(hefesto.cost).toBe(6534.48);
      expect(hefesto.result?.realProfit).toBe(59285.05);
      expect(hefesto.result?.marginPercent).toBe(68.14);
      expect(hefesto.result?.shippingCost).toBe(0);
    });

    it('applies the configured default shipping 7315/7315: the 87000 product returns the case-A profit 58773.73', async () => {
      tiendanubeConfigService.getAll.mockResolvedValue(mockConfigShipping7315);

      const results: CalcBatchItem[] = await service.calcBatch({
        gatewaySlug: TN_GATEWAY_PAGO_NUBE,
        paymentMethod: TN_PAYMENT_TARJETA,
        withdrawalDays: 14,
        installments: 1,
        planSlug: TN_PLAN_ESENCIAL,
      });

      const hefesto = results[0];
      expect(hefesto.result?.realProfit).toBe(58773.73);
      expect(hefesto.result?.marginPercent).toBe(67.56);
      expect(hefesto.result?.shippingCost).toBe(7315);
    });

    it('parses string prices to numbers and returns null result for products without a price', async () => {
      const results = await service.calcBatch({
        gatewaySlug: TN_GATEWAY_PAGO_NUBE,
        paymentMethod: TN_PAYMENT_TARJETA,
        withdrawalDays: 14,
        installments: 1,
        planSlug: TN_PLAN_ESENCIAL,
      });

      expect(results[1].currentPrice).toBe(45000);
      expect(results[1].cost).toBe(3200);
      expect(typeof results[1].currentPrice).toBe('number');

      expect(results[2].currentPrice).toBeNull();
      expect(results[2].result).toBeNull();
    });
  });
});
