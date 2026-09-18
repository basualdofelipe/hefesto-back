import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TnPaymentGateway } from './entities/tn-payment-gateway.entity';
import { TnGatewayRate } from './entities/tn-gateway-rate.entity';
import { TnInstallmentRate } from './entities/tn-installment-rate.entity';
import { TnTaxConfig } from './entities/tn-tax-config.entity';
import { TnPlan } from './entities/tn-plan.entity';
import { TnShippingConfig } from './entities/tn-shipping-config.entity';
import { UpdateGatewayRateDto } from './dto/update-gateway-rate.dto';
import { UpdateInstallmentRateDto } from './dto/update-installment-rate.dto';
import { UpdateTaxConfigDto } from './dto/update-tax-config.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { UpdateShippingConfigDto } from './dto/update-shipping-config.dto';

export interface ParsedGatewayRate extends Omit<TnGatewayRate, 'ratePercent'> {
  ratePercent: number;
}

export interface ParsedInstallmentRate extends Omit<
  TnInstallmentRate,
  'ratePercent'
> {
  ratePercent: number;
}

export interface ParsedTaxConfig extends Omit<
  TnTaxConfig,
  'ivaRate' | 'iibbRate'
> {
  ivaRate: number;
  iibbRate: number;
}

export interface ParsedPlan extends Omit<
  TnPlan,
  'cptPagoNube' | 'cptOtherGateways'
> {
  cptPagoNube: number;
  cptOtherGateways: number;
}

export interface ParsedShippingConfig extends Omit<
  TnShippingConfig,
  'defaultShippingCost' | 'defaultShippingCharged'
> {
  defaultShippingCost: number;
  defaultShippingCharged: number;
}

export interface TiendanubeConfigAll {
  gateways: TnPaymentGateway[];
  rates: ParsedGatewayRate[];
  installments: ParsedInstallmentRate[];
  taxConfig: ParsedTaxConfig | null;
  plans: ParsedPlan[];
  shipping: ParsedShippingConfig | null;
}

@Injectable()
export class TiendanubeConfigService {
  constructor(
    @InjectRepository(TnPaymentGateway)
    private readonly gatewayRepo: Repository<TnPaymentGateway>,
    @InjectRepository(TnGatewayRate)
    private readonly gatewayRateRepo: Repository<TnGatewayRate>,
    @InjectRepository(TnInstallmentRate)
    private readonly installmentRateRepo: Repository<TnInstallmentRate>,
    @InjectRepository(TnTaxConfig)
    private readonly taxConfigRepo: Repository<TnTaxConfig>,
    @InjectRepository(TnPlan)
    private readonly planRepo: Repository<TnPlan>,
    @InjectRepository(TnShippingConfig)
    private readonly shippingConfigRepo: Repository<TnShippingConfig>,
  ) {}

  // --- Decimal parsing helpers ---

  private parseGatewayRate(rate: TnGatewayRate): ParsedGatewayRate {
    return {
      ...rate,
      ratePercent: parseFloat(rate.ratePercent as string),
    };
  }

  private parseInstallmentRate(rate: TnInstallmentRate): ParsedInstallmentRate {
    return {
      ...rate,
      ratePercent: parseFloat(rate.ratePercent as string),
    };
  }

  private parseTaxConfig(config: TnTaxConfig): ParsedTaxConfig {
    return {
      ...config,
      ivaRate: parseFloat(config.ivaRate as string),
      iibbRate: parseFloat(config.iibbRate as string),
    };
  }

  private parsePlan(plan: TnPlan): ParsedPlan {
    return {
      ...plan,
      cptPagoNube: parseFloat(plan.cptPagoNube as string),
      cptOtherGateways: parseFloat(plan.cptOtherGateways as string),
    };
  }

  private parseShippingConfig(config: TnShippingConfig): ParsedShippingConfig {
    return {
      ...config,
      defaultShippingCost: parseFloat(config.defaultShippingCost as string),
      defaultShippingCharged: parseFloat(
        config.defaultShippingCharged as string,
      ),
    };
  }

  // --- Public methods ---

  async getAll(): Promise<TiendanubeConfigAll> {
    const [gateways, rates, installments, taxConfig, plans, shipping] =
      await Promise.all([
        this.gatewayRepo.find({
          where: { isActive: true },
          order: { slug: 'ASC' },
        }),
        this.getLatestGatewayRates(),
        this.getInstallmentRates(),
        this.getTaxConfig(),
        this.getPlans(),
        this.getShippingConfig(),
      ]);

    return { gateways, rates, installments, taxConfig, plans, shipping };
  }

  async getGatewaysWithRates(): Promise<
    (TnPaymentGateway & { rates: ParsedGatewayRate[] })[]
  > {
    const gateways = await this.gatewayRepo.find({
      where: { isActive: true },
      order: { slug: 'ASC' },
    });

    const rates = await this.getLatestGatewayRates();

    return gateways.map((gateway) => ({
      ...gateway,
      rates: rates.filter((r) => r.gateway?.id === gateway.id),
    }));
  }

  async updateGatewayRate(
    gatewayId: string,
    dto: UpdateGatewayRateDto,
  ): Promise<ParsedGatewayRate> {
    const gateway = await this.gatewayRepo.findOne({
      where: { id: gatewayId },
    });

    if (!gateway) {
      throw new NotFoundException('Pasarela de pago no encontrada');
    }

    const newRate = this.gatewayRateRepo.create({
      gateway,
      paymentMethod: dto.paymentMethod,
      withdrawalDays: dto.withdrawalDays,
      ratePercent: String(dto.ratePercent),
    });

    const saved = await this.gatewayRateRepo.save(newRate);
    return this.parseGatewayRate(saved);
  }

  async getInstallmentRates(): Promise<ParsedInstallmentRate[]> {
    const rows: TnInstallmentRate[] = await this.installmentRateRepo.query(
      `SELECT DISTINCT ON (installments)
        id,
        installments,
        rate_percent AS "ratePercent",
        is_active AS "isActive",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM tn_installment_rates
      WHERE is_active = true
      ORDER BY installments, created_at DESC`,
    );

    return rows.map((r) => this.parseInstallmentRate(r));
  }

  async updateInstallmentRate(
    installments: number,
    dto: UpdateInstallmentRateDto,
  ): Promise<ParsedInstallmentRate> {
    const newRate = this.installmentRateRepo.create({
      installments,
      ratePercent: String(dto.ratePercent),
    });

    const saved = await this.installmentRateRepo.save(newRate);
    return this.parseInstallmentRate(saved);
  }

  async getTaxConfig(): Promise<ParsedTaxConfig | null> {
    const config = await this.taxConfigRepo.findOne({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    return config ? this.parseTaxConfig(config) : null;
  }

  async updateTaxConfig(dto: UpdateTaxConfigDto): Promise<ParsedTaxConfig> {
    const newConfig = this.taxConfigRepo.create({
      ivaRate: String(dto.ivaRate),
      iibbRate: String(dto.iibbRate),
    });

    const saved = await this.taxConfigRepo.save(newConfig);
    return this.parseTaxConfig(saved);
  }

  async getShippingConfig(): Promise<ParsedShippingConfig | null> {
    const config = await this.shippingConfigRepo.findOne({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    return config ? this.parseShippingConfig(config) : null;
  }

  async updateShippingConfig(
    dto: UpdateShippingConfigDto,
  ): Promise<ParsedShippingConfig> {
    const newConfig = this.shippingConfigRepo.create({
      defaultShippingCost: String(dto.defaultShippingCost),
      defaultShippingCharged: String(dto.defaultShippingCharged),
    });

    const saved = await this.shippingConfigRepo.save(newConfig);
    return this.parseShippingConfig(saved);
  }

  async getPlans(): Promise<ParsedPlan[]> {
    const plans = await this.planRepo.find({
      where: { isActive: true },
      order: { slug: 'ASC' },
    });

    return plans.map((p) => this.parsePlan(p));
  }

  async updatePlan(id: string, dto: UpdatePlanDto): Promise<ParsedPlan> {
    const plan = await this.planRepo.findOne({ where: { id } });

    if (!plan) {
      throw new NotFoundException('Plan no encontrado');
    }

    if (dto.cptPagoNube !== undefined) {
      plan.cptPagoNube = String(dto.cptPagoNube);
    }
    if (dto.cptOtherGateways !== undefined) {
      plan.cptOtherGateways = String(dto.cptOtherGateways);
    }

    const saved = await this.planRepo.save(plan);
    return this.parsePlan(saved);
  }

  // --- Private helpers ---

  private async getLatestGatewayRates(): Promise<ParsedGatewayRate[]> {
    const rows: TnGatewayRate[] = await this.gatewayRateRepo.query(
      `SELECT DISTINCT ON (gr.gateway_id, gr.payment_method, gr.withdrawal_days)
        gr.id,
        gr.payment_method AS "paymentMethod",
        gr.withdrawal_days AS "withdrawalDays",
        gr.rate_percent AS "ratePercent",
        gr.is_active AS "isActive",
        gr.created_at AS "createdAt",
        gr.updated_at AS "updatedAt",
        gr.gateway_id AS "gatewayId",
        json_build_object(
          'id', gw.id,
          'slug', gw.slug,
          'label', gw.label,
          'isActive', gw.is_active
        ) AS gateway
      FROM tn_gateway_rates gr
      JOIN tn_payment_gateways gw ON gw.id = gr.gateway_id
      WHERE gr.is_active = true
      ORDER BY gr.gateway_id, gr.payment_method, gr.withdrawal_days, gr.created_at DESC`,
    );

    return rows.map((r) => this.parseGatewayRate(r));
  }
}
