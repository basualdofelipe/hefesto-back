import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto';
import { UpdateCatalogItemDto } from './dto/update-catalog-item.dto';
import { ProductColor } from './entities/product-color.entity';
import { ProductFinish } from './entities/product-finish.entity';
import { ProductName } from './entities/product-name.entity';
import { ProductSize } from './entities/product-size.entity';
import { ProductType } from './entities/product-type.entity';
import { SupplyType } from './entities/supply-type.entity';
import { ExpenseCategory } from './entities/expense-category.entity';
import { CatalogItemEntity } from './entities/catalog-item.entity';
import { CATALOG_ITEM_ORDER } from './catalog-order';

const VALID_DIMENSIONS = [
  'product-types',
  'product-names',
  'product-finishes',
  'product-colors',
  'product-sizes',
  'supply-types',
  'expense-categories',
] as const;

export type CatalogDimension = (typeof VALID_DIMENSIONS)[number];

@Injectable()
export class CatalogsService {
  private readonly DIMENSIONS_WITH_SKU: ReadonlySet<string> = new Set([
    'product-types',
    'product-names',
    'product-finishes',
    'product-colors',
    'product-sizes',
  ]);

  private readonly dimensionMap: Record<
    CatalogDimension,
    Repository<CatalogItemEntity>
  >;

  constructor(
    @InjectRepository(ProductType)
    private readonly productTypeRepo: Repository<ProductType>,
    @InjectRepository(ProductName)
    private readonly productNameRepo: Repository<ProductName>,
    @InjectRepository(ProductFinish)
    private readonly productFinishRepo: Repository<ProductFinish>,
    @InjectRepository(ProductColor)
    private readonly productColorRepo: Repository<ProductColor>,
    @InjectRepository(ProductSize)
    private readonly productSizeRepo: Repository<ProductSize>,
    @InjectRepository(SupplyType)
    private readonly supplyTypeRepo: Repository<SupplyType>,
    @InjectRepository(ExpenseCategory)
    private readonly expenseCategoryRepo: Repository<ExpenseCategory>,
  ) {
    this.dimensionMap = {
      'product-types': this.productTypeRepo,
      'product-names': this.productNameRepo,
      'product-finishes': this.productFinishRepo,
      'product-colors': this.productColorRepo,
      'product-sizes': this.productSizeRepo,
      'supply-types': this.supplyTypeRepo,
      'expense-categories': this.expenseCategoryRepo,
    };
  }

  getValidDimensions(): readonly string[] {
    return VALID_DIMENSIONS;
  }

  private getRepository(dimension: string): Repository<CatalogItemEntity> {
    const repo = this.dimensionMap[dimension as CatalogDimension];

    if (!repo) {
      throw new NotFoundException(`Dimension "${dimension}" no encontrada`);
    }

    return repo;
  }

  async findAll(dimension: string): Promise<CatalogItemEntity[]> {
    return this.getRepository(dimension).find({ order: CATALOG_ITEM_ORDER });
  }

  async findOne(dimension: string, id: string): Promise<CatalogItemEntity> {
    const repo = this.getRepository(dimension);
    const item = await repo.findOne({ where: { id } });

    if (!item) {
      throw new NotFoundException('Item no encontrado');
    }

    return item;
  }

  async create(
    dimension: string,
    dto: CreateCatalogItemDto,
  ): Promise<CatalogItemEntity> {
    const repo = this.getRepository(dimension);

    try {
      if (this.DIMENSIONS_WITH_SKU.has(dimension) && dto.skuCode == null) {
        const result = await repo
          .createQueryBuilder('item')
          .select('COALESCE(MAX(item.skuCode), 0)', 'maxCode')
          .getRawOne();
        dto.skuCode = (parseInt(result.maxCode, 10) || 0) + 1;
      }

      const sortOrder = await this.nextSortOrder(repo);
      const item = repo.create({ ...dto, sortOrder });
      return await repo.save(item);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === '23505'
      ) {
        throw new ConflictException('Ya existe un item con ese nombre');
      }
      throw error;
    }
  }

  /**
   * New items land last: MAX(sort_order) + 1, or 0 in an empty dimension (D-03).
   * Concurrent creates may share a value; the name tiebreak keeps the order
   * deterministic and the next reorder normalizes it (dismissed in the SPEC).
   */
  private async nextSortOrder(
    repo: Repository<CatalogItemEntity>,
  ): Promise<number> {
    const result = await repo
      .createQueryBuilder('item')
      .select('MAX(item.sortOrder)', 'maxSortOrder')
      .getRawOne<{ maxSortOrder: number | string | null }>();
    const maxSortOrder = result?.maxSortOrder;

    return maxSortOrder == null ? 0 : Number(maxSortOrder) + 1;
  }

  async update(
    dimension: string,
    id: string,
    dto: UpdateCatalogItemDto,
  ): Promise<CatalogItemEntity> {
    const item = await this.findOne(dimension, id);
    const repo = this.getRepository(dimension);

    try {
      const merged = repo.merge(item, dto);
      return await repo.save(merged);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === '23505'
      ) {
        throw new ConflictException('Ya existe un item con ese nombre');
      }
      throw error;
    }
  }

  async remove(dimension: string, id: string): Promise<void> {
    const item = await this.findOne(dimension, id);
    const repo = this.getRepository(dimension);

    try {
      await repo.remove(item);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === '23503'
      ) {
        throw new ConflictException(
          'No se puede eliminar: este item esta siendo usado por otros registros',
        );
      }
      throw error;
    }
  }
}
