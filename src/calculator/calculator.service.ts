import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  TiendanubeConfigService,
  TiendanubeConfigAll,
  ParsedGatewayRate,
  ParsedInstallmentRate,
  ParsedPlan,
} from '../tiendanube-config/tiendanube-config.service';
import {
  TN_GATEWAY_PAGO_NUBE,
  TN_PLAN_ESENCIAL,
} from '../constants/tiendanube';
import { CostsService } from '../costs/costs.service';
import { ProductsService } from '../products/products.service';
import {
  CalcResult,
  CalcInverseResult,
  CalcBatchItem,
  CalcError,
} from './dto/calc-result.dto';

export const PRODUCT_COST_REQUIRED_MESSAGE =
  'Definí el costo del producto primero';

// Price span of the two-point slope: calcForward rounds profit to cents, so the
// slope is quantized to 1e-8 — decisive for any configurable rate
const INVERSE_SLOPE_SPAN = 1_000_000;
// First upper bound of the search before expansion
const INVERSE_INITIAL_CEILING = 100_000;
// Cap on the initial bound and its expansion: keeps the cent-level bisection
// inside double precision (the cent snap needs price * 100 < 2^53)
const INVERSE_MAX_PRICE = 1e12;

interface ResolvedRates {
  gatewayRate: number;
  installmentRate: number;
  ivaRate: number;
  iibbRate: number;
  cptRate: number;
}

interface CalcForwardParams {
  sellingPrice: number;
  shippingCharged: number;
  shippingCost: number;
  productCost: number;
  gatewaySlug: string;
  paymentMethod: string;
  withdrawalDays: number;
  installments: number;
  planSlug?: string;
  config: TiendanubeConfigAll;
}

interface CalcInverseParams {
  targetProfit: number;
  shippingCharged: number;
  shippingCost: number;
  productCost: number;
  gatewaySlug: string;
  paymentMethod: string;
  withdrawalDays: number;
  installments: number;
  planSlug?: string;
  config: TiendanubeConfigAll;
}

@Injectable()
export class CalculatorService {
  constructor(
    private readonly tiendanubeConfigService: TiendanubeConfigService,
    private readonly costsService: CostsService,
    private readonly productsService: ProductsService,
  ) {}

  // ─── Private: resolve rates from config ─────────────────────────

  private resolveRates(
    config: TiendanubeConfigAll,
    gatewaySlug: string,
    paymentMethod: string,
    withdrawalDays: number,
    installments: number,
    planSlug?: string,
  ): ResolvedRates {
    // Null check: taxConfig can be null from getAll()
    if (!config.taxConfig) {
      throw new NotFoundException(
        'Tax config not found. Configure IVA/IIBB in Configuracion > Tiendanube first.',
      );
    }

    // Plan first: the gateway rate depends on it. Omitted = Esencial, the same
    // default ScenariosService and the front use (not plans[0], which is Escala).
    const effectivePlanSlug = planSlug ?? TN_PLAN_ESENCIAL;
    const plan = config.plans.find(
      (p: ParsedPlan) => p.slug === effectivePlanSlug,
    );

    if (!plan) {
      throw new NotFoundException(`Plan not found: ${effectivePlanSlug}`);
    }

    // Plan-specific row wins; the null-plan row is the "applies to every plan"
    // fallback (D-05) that also serves gateways without per-plan fees.
    const matchesTuple = (rate: ParsedGatewayRate): boolean =>
      rate.gateway?.slug === gatewaySlug &&
      rate.paymentMethod === paymentMethod &&
      rate.withdrawalDays === withdrawalDays;

    const matchedRate =
      config.rates.find((r) => matchesTuple(r) && r.planId === plan.id) ??
      config.rates.find((r) => matchesTuple(r) && r.planId === null);

    if (!matchedRate) {
      throw new NotFoundException(
        `Gateway rate not found for ${gatewaySlug}/${paymentMethod}/${withdrawalDays}d`,
      );
    }

    const gatewayRatePercent = matchedRate.ratePercent;

    // Find matching installment rate
    const matchedInstallment = config.installments.find(
      (inst: ParsedInstallmentRate) => inst.installments === installments,
    );

    if (!matchedInstallment) {
      throw new NotFoundException(
        `Installment rate not found for ${installments} installments`,
      );
    }

    const installmentRatePercent = matchedInstallment.ratePercent;

    // CPT depends on gateway: pago_nube uses cptPagoNube, others use cptOtherGateways
    const cptRate =
      gatewaySlug === TN_GATEWAY_PAGO_NUBE
        ? plan.cptPagoNube
        : plan.cptOtherGateways;

    // IVA/IIBB are stored as percentages; the formula needs fractions
    return {
      gatewayRate: gatewayRatePercent, // stays as percentage -- divided by 100 in formula
      installmentRate: installmentRatePercent, // stays as percentage -- divided by 100 in formula
      ivaRate: config.taxConfig.ivaRate / 100,
      iibbRate: config.taxConfig.iibbRate / 100,
      cptRate, // stays as percentage -- divided by 100 in formula
    };
  }

  // ─── resolveProductCost: the single place a product cost comes from (R8, D-09) ──

  /**
   * Resolves the product cost used by forward/inverse. The stored cost wins over
   * a manual one; a product that exists but has no BOM cannot be priced yet.
   * Not used by calcBatch, which lists cost-less products with `result: null`
   * (a batch must not fail because one product has no BOM).
   */
  async resolveProductCost(
    productId?: string,
    productCost?: number,
  ): Promise<number> {
    if (productId === undefined && productCost === undefined) {
      throw new BadRequestException(
        'Indicá un producto o un costo de producto',
      );
    }

    if (productId === undefined) {
      // The DTO already rejects negative values
      return productCost as number;
    }

    // Throws NotFoundException('Producto no encontrado') for an unknown id
    await this.productsService.findOne(productId);

    const costData = await this.costsService.calculateForProduct(productId);
    if (!costData) {
      throw new BadRequestException(PRODUCT_COST_REQUIRED_MESSAGE);
    }

    return costData.cost;
  }

  // ─── calcForward: price -> profit ───────────────────────────────

  calcForward(params: CalcForwardParams): CalcResult {
    const {
      sellingPrice,
      shippingCharged,
      shippingCost,
      productCost,
      gatewaySlug,
      paymentMethod,
      withdrawalDays,
      installments,
      planSlug,
      config,
    } = params;

    const rates = this.resolveRates(
      config,
      gatewaySlug,
      paymentMethod,
      withdrawalDays,
      installments,
      planSlug,
    );

    // Step 1: Total paid by the customer (shipping charged enters every fee base)
    const customerTotal = sellingPrice + shippingCharged;

    // Step 2: Gateway base rate
    const baseRate = rates.gatewayRate;

    // Step 3: Rate with IVA (ivaRate is already a fraction)
    const rateWithIva = baseRate * (1 + rates.ivaRate);

    // Step 4: Gateway fee
    const gatewayFee = customerTotal * (rateWithIva / 100);

    // Step 5: Installment financing cost (rate applied as configured)
    const installmentRate = rates.installmentRate;
    const financingCost = customerTotal * (installmentRate / 100);

    // Step 6: CPT (Tiendanube transaction cost, rate applied as configured)
    const cpt = customerTotal * (rates.cptRate / 100);

    // Step 7: IVA -- shipping cost is paid with IVA, so its IVA is a fiscal credit
    const taxableBase = customerTotal / (1 + rates.ivaRate);
    const ivaDebit = customerTotal - taxableBase;
    const ivaCreditProduct = productCost * rates.ivaRate;
    const ivaCreditGatewayFee =
      gatewayFee * (rates.ivaRate / (1 + rates.ivaRate));
    const ivaCreditShipping =
      shippingCost * (rates.ivaRate / (1 + rates.ivaRate));
    const ivaNet =
      ivaDebit - ivaCreditProduct - ivaCreditGatewayFee - ivaCreditShipping;

    // Step 8: IIBB withholding (iibbRate is already a fraction)
    const iibbWithholding = customerTotal * rates.iibbRate;

    // Step 9: Net received from the gateway
    const netReceived =
      customerTotal - gatewayFee - financingCost - iibbWithholding - cpt;

    // Step 10: Product cost with IVA
    const productCostWithIva = productCost * (1 + rates.ivaRate);

    // Step 11: Real profit -- the full shipping cost is a cost; its IVA comes back via ivaNet
    const realProfit = netReceived - productCostWithIva - shippingCost - ivaNet;

    // Step 12: Margin over the selling price (shipping excluded)
    const marginPercent =
      sellingPrice > 0 ? (realProfit / sellingPrice) * 100 : 0;

    // Round once at the end of the chain; intermediates stay exact
    return {
      customerTotal,
      baseRate,
      rateWithIva,
      gatewayFee,
      installmentRate,
      financingCost,
      cpt,
      taxableBase,
      ivaDebit,
      ivaCreditProduct,
      ivaCreditGatewayFee,
      ivaCreditShipping,
      ivaNet,
      iibbWithholding,
      netReceived,
      productCostWithIva,
      shippingCost,
      realProfit: Math.round(realProfit * 100) / 100,
      marginPercent: Math.round(marginPercent * 100) / 100,
    };
  }

  // ─── calcInverse: profit -> price (expand-and-bisect) ───────────

  calcInverse(params: CalcInverseParams): CalcInverseResult | CalcError {
    const { targetProfit, productCost } = params;

    if (productCost <= 0) {
      return { error: true, message: PRODUCT_COST_REQUIRED_MESSAGE };
    }

    if (targetProfit < 0) {
      return {
        error: true,
        message: 'La ganancia deseada no puede ser negativa',
      };
    }

    // The only way the inverse observes profit: no rate arithmetic in here
    const profitAt = (sellingPrice: number): number =>
      this.calcForward({ ...params, sellingPrice }).realProfit;

    // Profit is affine in the price, so:
    // 1. the sign of the slope alone decides whether any target is reachable;
    // 2. a target already met at price 0 has no positive price to return;
    // 3. the upper bound starts at and expands to at most INVERSE_MAX_PRICE, so
    //    the search always ends and bisection stays inside double precision
    //    (a target unreachable under the cap is a range error, never a hang);
    // 4. bisection on [0, high] narrows the price to a cent, and the snap picks
    //    the cent whose profit matches the target, so the answer depends only
    //    on the target and the returned breakdown is the one for that price.
    const profitAtZero = profitAt(0);
    const slope =
      (profitAt(INVERSE_SLOPE_SPAN) - profitAtZero) / INVERSE_SLOPE_SPAN;
    if (slope <= 0) {
      return {
        error: true,
        message: 'Ganancia inalcanzable con estas tasas',
      };
    }

    if (profitAtZero >= targetProfit) {
      return {
        error: true,
        message: 'La ganancia deseada ya se supera con precio 0',
      };
    }

    let low = 0;
    let high = Math.min(
      Math.max(productCost * 20, INVERSE_INITIAL_CEILING),
      INVERSE_MAX_PRICE,
    );

    while (profitAt(high) < targetProfit) {
      if (high >= INVERSE_MAX_PRICE) {
        return {
          error: true,
          message: 'La ganancia deseada excede el rango de cálculo',
        };
      }
      high = Math.min(high * 2, INVERSE_MAX_PRICE);
    }

    let iterations = 0;
    while (high - low > 0.01 && iterations < 100) {
      const mid = (low + high) / 2;

      if (profitAt(mid) < targetProfit) {
        low = mid;
      } else {
        high = mid;
      }
      iterations++;
    }

    const firstCent = Math.floor(low * 100);
    const lastCent = Math.min(Math.ceil(high * 100), firstCent + 2);
    let bestPrice = firstCent / 100;
    let bestResult: CalcResult = this.calcForward({
      ...params,
      sellingPrice: bestPrice,
    });

    for (let cents = firstCent + 1; cents <= lastCent; cents++) {
      const price = cents / 100;
      const candidate = this.calcForward({ ...params, sellingPrice: price });

      if (
        Math.abs(candidate.realProfit - targetProfit) <
        Math.abs(bestResult.realProfit - targetProfit)
      ) {
        bestPrice = price;
        bestResult = candidate;
      }
    }

    return {
      ...bestResult,
      requiredSellingPrice: bestPrice,
    };
  }

  // ─── calcBatch: all products margins ────────────────────────────

  async calcBatch(dto: {
    gatewaySlug: string;
    paymentMethod: string;
    withdrawalDays: number;
    installments: number;
    planSlug?: string;
  }): Promise<CalcBatchItem[]> {
    // Load TN config once (1 query via getAll)
    const config = await this.tiendanubeConfigService.getAll();

    // Load all product costs (2 queries via calculateAll)
    const costMap = await this.costsService.calculateAll();

    // Load all products with prices (2 queries via findAll)
    const products = await this.productsService.findAll();

    const results: CalcBatchItem[] = [];

    for (const product of products) {
      // No BOM = no cost: the row still lists the product (cost 0, like the
      // no-price case) but is never priced, or the batch would report a
      // near-100 % margin for it (the same silent zero R8 removed from
      // forward/inverse).
      const costData = costMap.get(product.id);
      const cost = costData?.cost ?? 0;

      // currentPrice is a string: TypeORM returns decimal columns as strings
      const currentPriceRaw = product.currentPrice;
      const currentPrice =
        currentPriceRaw !== null && currentPriceRaw !== undefined
          ? parseFloat(currentPriceRaw as string)
          : null;

      // Build display name: type + name + finish
      const productName = [
        product.type?.name,
        product.name?.name,
        product.finish?.name,
      ]
        .filter(Boolean)
        .join(' ');

      let calcResult: CalcResult | null = null;

      if (
        costData !== undefined &&
        currentPrice !== null &&
        !isNaN(currentPrice) &&
        currentPrice > 0
      ) {
        calcResult = this.calcForward({
          sellingPrice: currentPrice,
          shippingCharged: config.shipping?.defaultShippingCharged ?? 0,
          shippingCost: config.shipping?.defaultShippingCost ?? 0,
          productCost: cost,
          gatewaySlug: dto.gatewaySlug,
          paymentMethod: dto.paymentMethod,
          withdrawalDays: dto.withdrawalDays,
          installments: dto.installments,
          planSlug: dto.planSlug,
          config,
        });
      }

      results.push({
        productId: product.id,
        productName,
        cost,
        currentPrice,
        result: calcResult,
      });
    }

    return results;
  }
}
