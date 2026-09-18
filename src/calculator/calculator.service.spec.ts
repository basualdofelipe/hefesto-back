import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
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

// ─── Mock config matching the runtime shape of TiendanubeConfigService.getAll() ──

const GATEWAY_UUID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PLAN_ESENCIAL_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const mockConfig: TiendanubeConfigAll = {
  gateways: [
    {
      id: GATEWAY_UUID,
      slug: TN_GATEWAY_PAGO_NUBE,
      label: 'Pago Nube',
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as TiendanubeConfigAll['gateways'][number],
  ],
  rates: [
    {
      id: 'rate-1',
      gateway: {
        id: GATEWAY_UUID,
        slug: TN_GATEWAY_PAGO_NUBE,
        label: 'Pago Nube',
        isActive: true,
      },
      paymentMethod: TN_PAYMENT_TARJETA,
      withdrawalDays: 14,
      ratePercent: 3.49,
      isActive: true,
    } as unknown as TiendanubeConfigAll['rates'][number],
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
  plans: [
    {
      id: PLAN_ESENCIAL_UUID,
      slug: TN_PLAN_ESENCIAL,
      label: 'Esencial',
      cptPagoNube: 0,
      cptOtherGateways: 1.5,
      isActive: true,
      onlyPagoNube: false,
    } as unknown as TiendanubeConfigAll['plans'][number],
  ],
};

const mockConfigIva105: TiendanubeConfigAll = {
  ...mockConfig,
  taxConfig: {
    ivaRate: 10.5,
    iibbRate: 3.5,
  } as TiendanubeConfigAll['taxConfig'],
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
          },
        },
      ],
    }).compile();

    service = module.get<CalculatorService>(CalculatorService);
    costsService = module.get(CostsService);
    productsService = module.get(ProductsService);
  });

  // ─── calcForward: SPEC reference cases A–D (literals copied from the SPEC table) ──

  describe('calcForward reference cases', () => {
    test.each([
      {
        name: 'A: 87000 / shipping 7315 charged / 7315 cost',
        input: CASE_A,
        realProfit: 58773.73,
        marginPercent: 67.56,
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
        intermediates: {
          ivaCreditShipping: 0,
          ivaNet: 13089.3098,
          netReceived: 80281.077,
        },
        shippingCost: 0,
      },
    ])(
      'case $name',
      ({ input, realProfit, marginPercent, intermediates, shippingCost }) => {
        const result: CalcResult = service.calcForward({ ...BASE, ...input });

        expect(result.realProfit).toBe(realProfit);
        expect(result.marginPercent).toBe(marginPercent);

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

    it('returns the case-D profit for the 87000 product (batch has zero shipping)', async () => {
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
