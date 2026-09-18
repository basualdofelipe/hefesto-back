import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, QueryRunner, Repository } from 'typeorm';
import { Scenario } from './entities/scenario.entity';
import { ScenarioOverride } from './entities/scenario-override.entity';
import { CreateScenarioDto } from './dto/create-scenario.dto';
import { UpdateScenarioDto } from './dto/update-scenario.dto';
import { UpsertOverridesDto } from './dto/upsert-overrides.dto';
import {
  ScenarioCalcResponse,
  ScenarioProductResult,
} from './dto/scenario-response.dto';
import { CalculatorService } from '../calculator/calculator.service';
import { CostsService } from '../costs/costs.service';
import { ProductsService } from '../products/products.service';
import { TiendanubeConfigService } from '../tiendanube-config/tiendanube-config.service';
import type { Permissions } from '../common/types/permission';
import { User } from '../users/entities/user.entity';
import { TnPlan } from '../tiendanube-config/entities/tn-plan.entity';
import { Product } from '../products/entities/product.entity';
import { CalcResult } from '../calculator/dto/calc-result.dto';
import {
  TN_GATEWAY_PAGO_NUBE,
  TN_PAYMENT_TARJETA,
  TN_PLAN_ESENCIAL,
} from '../constants/tiendanube';

@Injectable()
export class ScenariosService {
  constructor(
    @InjectRepository(Scenario)
    private readonly scenarioRepo: Repository<Scenario>,
    @InjectRepository(ScenarioOverride)
    private readonly overrideRepo: Repository<ScenarioOverride>,
    private readonly calculatorService: CalculatorService,
    private readonly costsService: CostsService,
    private readonly productsService: ProductsService,
    private readonly tiendanubeConfigService: TiendanubeConfigService,
  ) {}

  // ─── Create scenario with name uniqueness per user ────────────

  async create(dto: CreateScenarioDto, userId: string): Promise<Scenario> {
    // Check name uniqueness for this user
    const existing = await this.scenarioRepo.findOne({
      where: { name: dto.name, user: { id: userId } },
    });

    if (existing) {
      throw new ConflictException('Ya existe un escenario con ese nombre');
    }

    const scenario = this.scenarioRepo.create({
      name: dto.name,
      user: { id: userId } as User,
      isPublic: dto.isPublic ?? false,
      gatewaySlug: dto.gatewaySlug ?? null,
      paymentMethod: dto.paymentMethod ?? null,
      withdrawalDays: dto.withdrawalDays ?? null,
      installments: dto.installments ?? null,
      plan: dto.planId ? ({ id: dto.planId } as TnPlan) : null,
    });

    return this.scenarioRepo.save(scenario);
  }

  // ─── List own scenarios + public from others ──────────────────

  async findAll(userId: string): Promise<Scenario[]> {
    const own = await this.scenarioRepo.find({
      where: { user: { id: userId } },
      relations: ['user', 'plan'],
      order: { updatedAt: 'DESC' },
    });

    const publicOthers = await this.scenarioRepo.find({
      where: { isPublic: true, user: { id: Not(userId) } },
      relations: ['user', 'plan'],
      order: { updatedAt: 'DESC' },
    });

    return [...own, ...publicOthers];
  }

  // ─── Get one scenario with overrides (owner or public) ────────

  async findOne(id: string, userId: string): Promise<Scenario> {
    const scenario = await this.scenarioRepo.findOne({
      where: [
        { id, user: { id: userId } },
        { id, isPublic: true },
      ],
      relations: [
        'user',
        'plan',
        'overrides',
        'overrides.product',
        'overrides.product.type',
        'overrides.product.name',
        'overrides.product.finish',
        'overrides.product.color',
        'overrides.product.size',
      ],
    });

    if (!scenario) {
      throw new NotFoundException('Escenario no encontrado');
    }

    return scenario;
  }

  // ─── Update scenario metadata (owner only) ────────────────────

  async update(
    id: string,
    dto: UpdateScenarioDto,
    userId: string,
  ): Promise<Scenario> {
    const scenario = await this.scenarioRepo.findOne({
      where: { id, user: { id: userId } },
    });

    if (!scenario) {
      throw new NotFoundException('Escenario no encontrado');
    }

    // Check name uniqueness if name changed
    if (dto.name !== undefined && dto.name !== scenario.name) {
      const duplicate = await this.scenarioRepo.findOne({
        where: { name: dto.name, user: { id: userId }, id: Not(id) },
      });

      if (duplicate) {
        throw new ConflictException('Ya existe un escenario con ese nombre');
      }

      scenario.name = dto.name;
    }

    if (dto.gatewaySlug !== undefined) {
      scenario.gatewaySlug = dto.gatewaySlug ?? null;
    }

    if (dto.paymentMethod !== undefined) {
      scenario.paymentMethod = dto.paymentMethod ?? null;
    }

    if (dto.withdrawalDays !== undefined) {
      scenario.withdrawalDays = dto.withdrawalDays ?? null;
    }

    if (dto.installments !== undefined) {
      scenario.installments = dto.installments ?? null;
    }

    if (dto.planId !== undefined) {
      scenario.plan = dto.planId ? ({ id: dto.planId } as TnPlan) : null;
    }

    if (dto.isPublic !== undefined) {
      scenario.isPublic = dto.isPublic;
    }

    return this.scenarioRepo.save(scenario);
  }

  // ─── Delete scenario and all overrides (owner or admin) ──────

  async remove(
    id: string,
    userId: string,
    permissions: Permissions,
  ): Promise<void> {
    // Admin bypass: users with can_manage_users (system admins) can delete any scenario
    // to allow cleanup of scenarios belonging to deactivated or removed users.
    // Note: canManageUsers is intentionally used here (not canManageScenarios) because
    // only full system admins should be able to delete scenarios they don't own.
    const isAdmin = permissions.canManageUsers;
    const where = isAdmin ? { id } : { id, user: { id: userId } };
    const scenario = await this.scenarioRepo.findOne({ where });

    if (!scenario) {
      throw new NotFoundException('Escenario no encontrado');
    }

    await this.scenarioRepo.remove(scenario);
  }

  // ─── Toggle public visibility (owner only) ────────────────────

  async togglePublic(id: string, userId: string): Promise<Scenario> {
    const scenario = await this.scenarioRepo.findOne({
      where: { id, user: { id: userId } },
    });

    if (!scenario) {
      throw new NotFoundException('Escenario no encontrado');
    }

    scenario.isPublic = !scenario.isPublic;

    return this.scenarioRepo.save(scenario);
  }

  // ─── Bulk upsert overrides (transactional, owner only) ────────

  async upsertOverrides(
    id: string,
    dto: UpsertOverridesDto,
    userId: string,
  ): Promise<ScenarioOverride[]> {
    const scenario = await this.scenarioRepo.findOne({
      where: { id, user: { id: userId } },
    });

    if (!scenario) {
      throw new NotFoundException('Escenario no encontrado');
    }

    // Delete + insert in one transaction so a failed insert never leaves the scenario without overrides
    const queryRunner =
      this.scenarioRepo.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.delete(ScenarioOverride, {
        scenario: { id },
      });

      const entities = dto.overrides.map((item) =>
        this.overrideRepo.create({
          scenario: { id } as Scenario,
          product: { id: item.productId } as Product,
          overridePrice: item.overridePrice.toString(),
        }),
      );

      const saved = await queryRunner.manager.save(ScenarioOverride, entities);

      await queryRunner.commitTransaction();

      return saved;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  // ─── Calculate margins for all products in scenario ───────────

  async calculate(id: string, userId: string): Promise<ScenarioCalcResponse> {
    // Load scenario with overrides
    const scenario = await this.findOne(id, userId);

    // Load TN config
    const config = await this.tiendanubeConfigService.getAll();

    // Load all product costs
    const costMap = await this.costsService.calculateAll();

    // Include inactive products: a scenario may override a product deactivated after it was saved
    const products = await this.productsService.findAll(true);

    // Build override map: productId -> overridePrice (number)
    const overrideMap = new Map<string, number>(
      scenario.overrides.map((o) => [
        o.product.id,
        parseFloat(o.overridePrice as string),
      ]),
    );

    // Resolve scenario gateway config (use defaults if null)
    const gatewaySlug = scenario.gatewaySlug ?? TN_GATEWAY_PAGO_NUBE;
    const paymentMethod = scenario.paymentMethod ?? TN_PAYMENT_TARJETA;
    const withdrawalDays = scenario.withdrawalDays ?? 1;
    const installments = scenario.installments ?? 1;
    const planSlug = scenario.plan?.slug ?? TN_PLAN_ESENCIAL;

    const results: ScenarioProductResult[] = [];

    for (const product of products) {
      const cost = costMap.get(product.id)?.cost ?? 0;

      // currentPrice is a string: TypeORM returns decimal columns as strings
      const realPrice =
        product.currentPrice !== null && product.currentPrice !== undefined
          ? parseFloat(product.currentPrice as string)
          : null;

      const overridePrice = overrideMap.get(product.id) ?? null;
      const effectivePrice = overridePrice ?? realPrice;

      // Build product display name
      const productName = [
        product.type?.name,
        product.name?.name,
        product.finish?.name,
        product.color?.name,
      ]
        .filter(Boolean)
        .join(' ');

      const productType = product.type?.name ?? '';

      let simResult: CalcResult | null = null;
      let realResult: CalcResult | null = null;

      if (effectivePrice !== null && effectivePrice > 0) {
        try {
          simResult = this.calculatorService.calcForward({
            sellingPrice: effectivePrice,
            shippingCharged: 0,
            shippingCost: 0,
            productCost: cost,
            gatewaySlug,
            paymentMethod,
            withdrawalDays,
            installments,
            planSlug,
            config,
          });
        } catch {
          simResult = null; // per-product failure -- don't crash the loop
        }
      }

      if (realPrice !== null && realPrice > 0) {
        try {
          realResult = this.calculatorService.calcForward({
            sellingPrice: realPrice,
            shippingCharged: 0,
            shippingCost: 0,
            productCost: cost,
            gatewaySlug,
            paymentMethod,
            withdrawalDays,
            installments,
            planSlug,
            config,
          });
        } catch {
          realResult = null;
        }
      }

      results.push({
        productId: product.id,
        productName,
        productType,
        cost,
        realPrice,
        overridePrice,
        effectivePrice,
        simResult,
        realResult,
        isActive: product.isActive,
      });
    }

    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      gatewaySlug,
      planSlug,
      paymentMethod,
      withdrawalDays,
      installments,
      results,
    };
  }

  // ─── Cross-module: transfer scenarios to a new owner ──────────
  //
  // Called by UsersService.remove inside a transaction. Moves all scenarios
  // owned by `victimId` to `newOwnerId`, appending `suffix` to each name and
  // truncating to varchar(200). NEVER calls qr.commit/rollback/release — the
  // caller owns the transaction lifecycle. If execute() fails, the error is
  // propagated for the caller to rollback.
  //
  // SQL injection safety: `suffix` is bound via setParameter (not string
  // concatenation). The arrow function in .set() is the only way TypeORM
  // accepts raw SQL with parametrization (see TypeORM issue #1580).
  async transferOwnership(
    victimId: string,
    newOwnerId: string,
    suffix: string,
    qr: QueryRunner,
  ): Promise<void> {
    // Truncate the BASE name to (200 - suffix.length) BEFORE
    // concatenation so the discriminator (` - <name> #<shortId>`) is never
    // cut by the final LEFT(..., 200). Otherwise two scenarios whose names
    // share a long prefix can collide after truncation.
    //
    // suffix.length is known at JS time and clamped here defensively: if the
    // suffix would itself overflow 200 chars (impossible with the current
    // ` - <name capped to 255> #<8 hex>` shape, but defensive against future
    // suffix changes), we throw rather than producing a silently truncated
    // discriminator that breaks uniqueness.
    if (suffix.length >= 200) {
      throw new Error(
        `transferOwnership: suffix length ${suffix.length} >= 200 (varchar(200) overflow)`,
      );
    }
    const baseMax = 200 - suffix.length;

    // Use the PROPERTY name `updatedAt` (not the column name `updated_at`) in the .set() object.
    // TypeORM QueryBuilder .set() resolves keys by entity PROPERTY names and
    // throws EntityPropertyNotFoundError if it receives the column name.
    // The expression `() => 'NOW()'` (raw SQL) bypasses the @UpdateDateColumn subscriber
    // (which only fires through repo.save / manager.save, not execute()).
    await qr.manager
      .createQueryBuilder()
      .update(Scenario)
      .set({
        name: () => `LEFT(COALESCE(name, ''), ${baseMax}) || :suffix`,
        user: { id: newOwnerId },
        updatedAt: () => 'NOW()',
      })
      .where('user_id = :victimId', { victimId })
      .setParameter('suffix', suffix)
      .execute();
  }
}
