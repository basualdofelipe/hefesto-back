import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, QueryFailedError, Repository } from 'typeorm';
import { CreateSupplyDto } from './dto/create-supply.dto';
import { CreateSupplyPriceDto } from './dto/create-supply-price.dto';
import { UpdateSupplyDto } from './dto/update-supply.dto';
import { Supply } from './entities/supply.entity';
import { SupplyPriceHistory } from './entities/supply-price-history.entity';
import { SupplyType } from '../catalogs/entities/supply-type.entity';
import { Supplier } from '../suppliers/entities/supplier.entity';
import { SuppliesPerProductHistory } from '../products/entities/supplies-per-product-history.entity';
import { CATALOG_ITEM_ORDER } from '../catalogs/catalog-order';

export interface SupplyWithPrice extends Supply {
  currentPrice: string | null;
  lastPriceUpdate: Date | null;
}

@Injectable()
export class SuppliesService {
  constructor(
    @InjectRepository(Supply)
    private readonly supplyRepo: Repository<Supply>,
    @InjectRepository(SupplyPriceHistory)
    private readonly priceHistoryRepo: Repository<SupplyPriceHistory>,
    @InjectRepository(SupplyType)
    private readonly supplyTypeRepo: Repository<SupplyType>,
    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
    @InjectRepository(SuppliesPerProductHistory)
    private readonly bomRepo: Repository<SuppliesPerProductHistory>,
    private readonly entityManager: EntityManager,
  ) {}

  async findAll(includeInactive: boolean = false): Promise<SupplyWithPrice[]> {
    const where = includeInactive ? {} : { isActive: true };
    const supplies = await this.supplyRepo.find({
      where,
      relations: ['type', 'supplier'],
      // Grouped by supply type in catalog order; supplies themselves are not
      // a catalog, so inside a type they stay by name (D-11).
      order: { type: CATALOG_ITEM_ORDER, name: 'ASC' },
    });

    if (supplies.length === 0) {
      return [];
    }

    // Batch-fetch latest price per supply using DISTINCT ON
    const latestPrices: {
      supply_id: string;
      price: string;
      created_at: Date;
    }[] = await this.priceHistoryRepo.query(
      `SELECT DISTINCT ON (supply_id) supply_id, price, created_at
         FROM supply_price_history
         ORDER BY supply_id, created_at DESC`,
    );

    const priceMap = new Map<string, { price: string; createdAt: Date }>();
    for (const row of latestPrices) {
      priceMap.set(row.supply_id, {
        price: row.price,
        createdAt: row.created_at,
      });
    }

    return supplies.map((supply) => {
      const priceData = priceMap.get(supply.id);
      return Object.assign(supply, {
        currentPrice: priceData?.price ?? null,
        lastPriceUpdate: priceData?.createdAt ?? null,
      });
    });
  }

  async findOne(id: string): Promise<SupplyWithPrice> {
    const supply = await this.supplyRepo.findOne({
      where: { id },
      relations: ['type', 'supplier'],
    });

    if (!supply) {
      throw new NotFoundException('Insumo no encontrado');
    }

    // Fetch current price
    const latestPrice = await this.priceHistoryRepo.findOne({
      where: { supply: { id } },
      order: { createdAt: 'DESC' },
    });

    return Object.assign(supply, {
      currentPrice: latestPrice?.price ?? null,
      lastPriceUpdate: latestPrice?.createdAt ?? null,
    });
  }

  async create(dto: CreateSupplyDto): Promise<SupplyWithPrice> {
    // Validate FK existence
    const supplyType = await this.supplyTypeRepo.findOne({
      where: { id: dto.typeId },
    });
    if (!supplyType) {
      throw new NotFoundException('Tipo de insumo no encontrado');
    }

    const supplier = await this.supplierRepo.findOne({
      where: { id: dto.supplierId },
    });
    if (!supplier) {
      throw new NotFoundException('Proveedor no encontrado');
    }

    try {
      if (dto.initialPrice !== undefined) {
        // Transaction: create supply + initial price atomically
        return await this.entityManager.transaction(async (manager) => {
          const supply = manager.create(Supply, {
            name: dto.name,
            type: supplyType,
            supplier,
            unitType: dto.unitType,
            notes: dto.notes ?? null,
          });
          const savedSupply = await manager.save(Supply, supply);

          const priceRecord = manager.create(SupplyPriceHistory, {
            supply: savedSupply,
            price: String(dto.initialPrice),
          });
          const savedPrice = await manager.save(
            SupplyPriceHistory,
            priceRecord,
          );

          return Object.assign(savedSupply, {
            currentPrice: savedPrice.price,
            lastPriceUpdate: savedPrice.createdAt,
          });
        });
      }

      const supply = this.supplyRepo.create({
        name: dto.name,
        type: supplyType,
        supplier,
        unitType: dto.unitType,
        notes: dto.notes ?? null,
      });
      const savedSupply = await this.supplyRepo.save(supply);

      return Object.assign(savedSupply, {
        currentPrice: null,
        lastPriceUpdate: null,
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === '23505'
      ) {
        throw new ConflictException(
          'Ya existe un insumo activo con ese nombre para este proveedor',
        );
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateSupplyDto): Promise<SupplyWithPrice> {
    const supply = await this.findOne(id);

    try {
      // Handle typeId separately since it's a relation
      if (dto.typeId) {
        const supplyType = await this.supplyTypeRepo.findOne({
          where: { id: dto.typeId },
        });
        if (!supplyType) {
          throw new NotFoundException('Tipo de insumo no encontrado');
        }
        supply.type = supplyType;
      }

      const { typeId: _typeId, ...rest } = dto;
      const merged = this.supplyRepo.merge(supply, rest);
      const savedSupply = await this.supplyRepo.save(merged);

      return Object.assign(savedSupply, {
        currentPrice: supply.currentPrice,
        lastPriceUpdate: supply.lastPriceUpdate,
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === '23505'
      ) {
        throw new ConflictException(
          'Ya existe un insumo activo con ese nombre para este proveedor',
        );
      }
      throw error;
    }
  }

  async toggleStatus(id: string): Promise<Supply> {
    const supply = await this.supplyRepo.findOne({
      where: { id },
      relations: ['type', 'supplier'],
    });

    if (!supply) {
      throw new NotFoundException('Insumo no encontrado');
    }

    // Block reactivation if supplier is inactive
    if (!supply.isActive && !supply.supplier.isActive) {
      throw new ConflictException(
        'No se puede activar un insumo cuyo proveedor esta inactivo',
      );
    }

    // Block deactivation if supply is in any active BOM
    if (supply.isActive) {
      const bomUsage = await this.bomRepo.count({
        where: { supply: { id }, isActive: true },
      });
      if (bomUsage > 0) {
        throw new ConflictException(
          `Este insumo esta en uso por ${bomUsage} producto(s). Elimina el insumo de todos los BOM antes de desactivarlo.`,
        );
      }
    }

    supply.isActive = !supply.isActive;
    return this.supplyRepo.save(supply);
  }

  async addPrice(
    supplyId: string,
    dto: CreateSupplyPriceDto,
  ): Promise<SupplyPriceHistory> {
    const supply = await this.supplyRepo.findOne({
      where: { id: supplyId },
    });

    if (!supply) {
      throw new NotFoundException('Insumo no encontrado');
    }

    const priceRecord = this.priceHistoryRepo.create({
      supply,
      price: String(dto.price),
    });

    return this.priceHistoryRepo.save(priceRecord);
  }

  async getPriceHistory(supplyId: string): Promise<SupplyPriceHistory[]> {
    const supply = await this.supplyRepo.findOne({
      where: { id: supplyId },
    });

    if (!supply) {
      throw new NotFoundException('Insumo no encontrado');
    }

    return this.priceHistoryRepo.find({
      where: { supply: { id: supplyId } },
      order: { createdAt: 'DESC' },
    });
  }
}
