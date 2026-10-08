import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, QueryFailedError, Repository } from 'typeorm';
import { Product } from './entities/product.entity';
import { SuppliesPerProductHistory } from './entities/supplies-per-product-history.entity';
import { ProductPriceHistory } from './entities/product-price-history.entity';
import { ProductType } from '../catalogs/entities/product-type.entity';
import { ProductName } from '../catalogs/entities/product-name.entity';
import { ProductFinish } from '../catalogs/entities/product-finish.entity';
import { ProductColor } from '../catalogs/entities/product-color.entity';
import { ProductSize } from '../catalogs/entities/product-size.entity';
import { Supply } from '../supplies/entities/supply.entity';
import { CreateProductDto } from './dto/create-product.dto';
import { CreateBatchProductsDto } from './dto/create-batch-products.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateBomDto } from './dto/update-bom.dto';
import { CreateProductPriceDto } from './dto/create-product-price.dto';
import { BatchProductPriceDto } from './dto/batch-product-price.dto';
import { BatchBomDto } from './dto/batch-bom.dto';
import { CATALOG_ITEM_ORDER } from '../catalogs/catalog-order';
import { PRODUCT_CATALOG_ORDER } from './product-order';

export interface ProductWithPrice extends Product {
  currentPrice: string | null;
  lastPriceUpdate: Date | null;
}

@Injectable()
export class ProductsService {
  constructor(
    @InjectRepository(Product)
    private readonly productRepo: Repository<Product>,
    @InjectRepository(SuppliesPerProductHistory)
    private readonly bomRepo: Repository<SuppliesPerProductHistory>,
    @InjectRepository(ProductPriceHistory)
    private readonly priceHistoryRepo: Repository<ProductPriceHistory>,
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
    @InjectRepository(Supply)
    private readonly supplyRepo: Repository<Supply>,
    private readonly entityManager: EntityManager,
  ) {}

  private generateSkuCode(
    type: ProductType,
    name: ProductName,
    finish: ProductFinish,
    color: ProductColor,
    size: ProductSize,
  ): string {
    return `${type.skuCode}.${name.skuCode}.${finish.skuCode}.${color.skuCode}.${size.skuCode}`;
  }

  async findAll(includeInactive: boolean = false): Promise<ProductWithPrice[]> {
    const where = includeInactive ? {} : { isActive: true };
    const products = await this.productRepo.find({
      where,
      order: PRODUCT_CATALOG_ORDER,
    });

    if (products.length === 0) {
      return [];
    }

    // Batch-fetch latest price per product using DISTINCT ON
    const latestPrices: {
      product_id: string;
      price: string;
      created_at: Date;
    }[] = await this.priceHistoryRepo.query(
      `SELECT DISTINCT ON (product_id) product_id, price, created_at
         FROM product_price_history
         ORDER BY product_id, created_at DESC`,
    );

    const priceMap = new Map<string, { price: string; createdAt: Date }>();
    for (const row of latestPrices) {
      priceMap.set(row.product_id, {
        price: row.price,
        createdAt: row.created_at,
      });
    }

    return products.map((product) => {
      const priceData = priceMap.get(product.id);
      return Object.assign(product, {
        currentPrice: priceData?.price ?? null,
        lastPriceUpdate: priceData?.createdAt ?? null,
      });
    });
  }

  async findOne(id: string): Promise<Product> {
    const product = await this.productRepo.findOne({
      where: { id },
    });

    if (!product) {
      throw new NotFoundException('Producto no encontrado');
    }

    return product;
  }

  async findOneWithPrice(id: string): Promise<ProductWithPrice> {
    const product = await this.findOne(id);

    const latestPrice: { price: string; created_at: Date }[] =
      await this.priceHistoryRepo.query(
        `SELECT price, created_at
         FROM product_price_history
         WHERE product_id = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [id],
      );

    return Object.assign(product, {
      currentPrice: latestPrice[0]?.price ?? null,
      lastPriceUpdate: latestPrice[0]?.created_at ?? null,
    });
  }

  async create(dto: CreateProductDto): Promise<Product> {
    const { type, name, finish, color, size } = await this.loadDimensions(dto);

    const skuCode = this.generateSkuCode(type, name, finish, color, size);

    try {
      const product = this.productRepo.create({
        skuCode,
        type,
        name,
        finish,
        color,
        size,
      });
      return await this.productRepo.save(product);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === '23505'
      ) {
        throw new ConflictException(
          'Ya existe un producto activo con esa combinacion',
        );
      }
      throw error;
    }
  }

  async createBatch(dto: CreateBatchProductsDto): Promise<Product[]> {
    const type = await this.productTypeRepo.findOne({
      where: { id: dto.typeId },
    });
    if (!type) {
      throw new NotFoundException('Tipo de producto no encontrado');
    }

    const name = await this.productNameRepo.findOne({
      where: { id: dto.nameId },
    });
    if (!name) {
      throw new NotFoundException('Nombre de producto no encontrado');
    }

    const finish = await this.productFinishRepo.findOne({
      where: { id: dto.finishId },
    });
    if (!finish) {
      throw new NotFoundException('Terminacion no encontrada');
    }

    // Fetched in catalog order so the colors × sizes loop below emits the
    // batch in product catalog order (type, name and finish are fixed).
    const colors = await this.productColorRepo.find({
      where: { id: In(dto.colorIds) },
      order: CATALOG_ITEM_ORDER,
    });
    if (colors.length !== dto.colorIds.length) {
      throw new NotFoundException('Uno o mas colores no fueron encontrados');
    }

    const sizes = await this.productSizeRepo.find({
      where: { id: In(dto.sizeIds) },
      order: CATALOG_ITEM_ORDER,
    });
    if (sizes.length !== dto.sizeIds.length) {
      throw new NotFoundException('Uno o mas talles no fueron encontrados');
    }

    try {
      return await this.entityManager.transaction(async (manager) => {
        const products: Product[] = [];

        for (const color of colors) {
          for (const size of sizes) {
            const skuCode = this.generateSkuCode(
              type,
              name,
              finish,
              color,
              size,
            );
            const product = manager.create(Product, {
              skuCode,
              type,
              name,
              finish,
              color,
              size,
            });
            products.push(product);
          }
        }

        return manager.save(Product, products);
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === '23505'
      ) {
        throw new ConflictException(
          'Una o mas combinaciones de producto ya existen como activas',
        );
      }
      throw error;
    }
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    const product = await this.findOne(id);

    const { type, name, finish, color, size } = await this.loadDimensions(dto);

    product.type = type;
    product.name = name;
    product.finish = finish;
    product.color = color;
    product.size = size;
    product.skuCode = this.generateSkuCode(type, name, finish, color, size);

    try {
      return await this.productRepo.save(product);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === '23505'
      ) {
        throw new ConflictException(
          'Ya existe un producto activo con esa combinacion',
        );
      }
      throw error;
    }
  }

  async toggleStatus(id: string): Promise<Product> {
    const product = await this.findOne(id);
    product.isActive = !product.isActive;
    return this.productRepo.save(product);
  }

  // ─── BOM Methods ───────────────────────────────────────────────

  async getBom(productId: string): Promise<SuppliesPerProductHistory[]> {
    await this.findOne(productId);

    return this.bomRepo.find({
      where: { product: { id: productId }, isActive: true },
    });
  }

  async updateBom(
    productId: string,
    dto: UpdateBomDto,
  ): Promise<SuppliesPerProductHistory[]> {
    return this.entityManager.transaction(async (manager) => {
      // Verify product exists
      const product = await manager.findOne(Product, {
        where: { id: productId },
      });
      if (!product) {
        throw new NotFoundException('Producto no encontrado');
      }

      // Verify all supplies exist and are active
      if (dto.items.length > 0) {
        const supplyIds = dto.items.map((item) => item.supplyId);
        const supplies = await manager.find(Supply, {
          where: { id: In(supplyIds) },
        });

        if (supplies.length !== supplyIds.length) {
          const foundIds = new Set(supplies.map((s) => s.id));
          const missing = supplyIds.find((id) => !foundIds.has(id));
          throw new NotFoundException(`Insumo no encontrado: ${missing}`);
        }

        const inactiveSupply = supplies.find((s) => !s.isActive);
        if (inactiveSupply) {
          throw new ConflictException(
            `El insumo "${inactiveSupply.name}" esta inactivo y no puede agregarse al BOM`,
          );
        }
      }

      // Deactivate current BOM entries
      await manager.update(
        SuppliesPerProductHistory,
        { product: { id: productId }, isActive: true },
        { isActive: false },
      );

      // Insert new BOM entries
      if (dto.items.length === 0) {
        return [];
      }

      const newEntries = dto.items.map((item) =>
        manager.create(SuppliesPerProductHistory, {
          product: { id: productId } as Product,
          supply: { id: item.supplyId } as Supply,
          quantity: String(item.quantity),
          isActive: true,
        }),
      );

      await manager.save(SuppliesPerProductHistory, newEntries);

      // Reload with eager supply relation
      return manager.find(SuppliesPerProductHistory, {
        where: { product: { id: productId }, isActive: true },
      });
    });
  }

  async batchUpdateBom(dto: BatchBomDto): Promise<void> {
    await this.entityManager.transaction(async (manager) => {
      // Verify all products exist
      const products = await manager.find(Product, {
        where: { id: In(dto.productIds) },
      });
      if (products.length !== dto.productIds.length) {
        throw new NotFoundException(
          'Uno o mas productos no fueron encontrados',
        );
      }

      // Verify all supplies exist and are active
      if (dto.items.length > 0) {
        const supplyIds = dto.items.map((item) => item.supplyId);
        const supplies = await manager.find(Supply, {
          where: { id: In(supplyIds) },
        });

        if (supplies.length !== supplyIds.length) {
          throw new NotFoundException(
            'Uno o mas insumos no fueron encontrados',
          );
        }

        const inactiveSupply = supplies.find((s) => !s.isActive);
        if (inactiveSupply) {
          throw new ConflictException(
            `El insumo "${inactiveSupply.name}" esta inactivo`,
          );
        }
      }

      for (const productId of dto.productIds) {
        // Deactivate current BOM
        await manager.update(
          SuppliesPerProductHistory,
          { product: { id: productId }, isActive: true },
          { isActive: false },
        );

        // Insert new entries
        if (dto.items.length > 0) {
          const newEntries = dto.items.map((item) =>
            manager.create(SuppliesPerProductHistory, {
              product: { id: productId } as Product,
              supply: { id: item.supplyId } as Supply,
              quantity: String(item.quantity),
              isActive: true,
            }),
          );
          await manager.save(SuppliesPerProductHistory, newEntries);
        }
      }
    });
  }

  // ─── Price History Methods ─────────────────────────────────────

  async getPriceHistory(productId: string): Promise<ProductPriceHistory[]> {
    await this.findOne(productId);

    return this.priceHistoryRepo.find({
      where: { product: { id: productId } },
      order: { createdAt: 'DESC' },
    });
  }

  async addPrice(
    productId: string,
    dto: CreateProductPriceDto,
  ): Promise<ProductPriceHistory> {
    const product = await this.findOne(productId);

    const priceRecord = this.priceHistoryRepo.create({
      product,
      price: String(dto.price),
    });

    return this.priceHistoryRepo.save(priceRecord);
  }

  async batchAddPrice(
    dto: BatchProductPriceDto,
  ): Promise<ProductPriceHistory[]> {
    return this.entityManager.transaction(async (manager) => {
      const products = await manager.find(Product, {
        where: { id: In(dto.productIds) },
      });

      if (products.length !== dto.productIds.length) {
        throw new NotFoundException(
          'Uno o mas productos no fueron encontrados',
        );
      }

      const priceRecords = products.map((product) =>
        manager.create(ProductPriceHistory, {
          product,
          price: String(dto.price),
        }),
      );

      return manager.save(ProductPriceHistory, priceRecords);
    });
  }

  // ─── Private Helpers ───────────────────────────────────────────

  private async loadDimensions(dto: {
    typeId: string;
    nameId: string;
    finishId: string;
    colorId: string;
    sizeId: string;
  }): Promise<{
    type: ProductType;
    name: ProductName;
    finish: ProductFinish;
    color: ProductColor;
    size: ProductSize;
  }> {
    const type = await this.productTypeRepo.findOne({
      where: { id: dto.typeId },
    });
    if (!type) {
      throw new NotFoundException('Tipo de producto no encontrado');
    }

    const name = await this.productNameRepo.findOne({
      where: { id: dto.nameId },
    });
    if (!name) {
      throw new NotFoundException('Nombre de producto no encontrado');
    }

    const finish = await this.productFinishRepo.findOne({
      where: { id: dto.finishId },
    });
    if (!finish) {
      throw new NotFoundException('Terminacion no encontrada');
    }

    const color = await this.productColorRepo.findOne({
      where: { id: dto.colorId },
    });
    if (!color) {
      throw new NotFoundException('Color no encontrado');
    }

    const size = await this.productSizeRepo.findOne({
      where: { id: dto.sizeId },
    });
    if (!size) {
      throw new NotFoundException('Talle no encontrado');
    }

    return { type, name, finish, color, size };
  }
}
