import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CatalogsService } from './catalogs.service';
import { CreateCatalogItemDto } from './dto/create-catalog-item.dto';
import { ExpenseCategory } from './entities/expense-category.entity';
import { ProductColor } from './entities/product-color.entity';
import { ProductFinish } from './entities/product-finish.entity';
import { ProductName } from './entities/product-name.entity';
import { ProductSize } from './entities/product-size.entity';
import { ProductType } from './entities/product-type.entity';
import { SupplyType } from './entities/supply-type.entity';

/** What the driver may return for a MAX() aggregate: number, numeric string or null. */
type RawMax = number | string | null;

interface CreatedItem {
  name: string;
  skuCode?: number;
  sortOrder?: number;
}

interface FakeQueryBuilder {
  select(expression: string, alias: string): FakeQueryBuilder;
  getRawOne(): Promise<{ [alias: string]: RawMax | undefined }>;
}

interface FakeCatalogRepo {
  createQueryBuilder(): FakeQueryBuilder;
  create(data: CreatedItem): CreatedItem;
  save(item: CreatedItem): Promise<CreatedItem>;
}

/**
 * In-memory fake of the repository surface CatalogsService.create uses.
 * The query builder answers `MAX(...)` by the alias the service selects, so the
 * fake does not depend on how many aggregates create() reads or in what order.
 */
const makeFakeRepo = (rawByAlias: Map<string, RawMax>): FakeCatalogRepo => ({
  createQueryBuilder: (): FakeQueryBuilder => {
    let selectedAlias = '';
    const qb: FakeQueryBuilder = {
      select: (_expression: string, alias: string): FakeQueryBuilder => {
        selectedAlias = alias;
        return qb;
      },
      getRawOne: () =>
        Promise.resolve({ [selectedAlias]: rawByAlias.get(selectedAlias) }),
    };
    return qb;
  },
  create: (data: CreatedItem): CreatedItem => ({ ...data }),
  save: (item: CreatedItem): Promise<CreatedItem> => Promise.resolve(item),
});

const CATALOG_ENTITIES = [
  ProductType,
  ProductName,
  ProductFinish,
  ProductColor,
  ProductSize,
  SupplyType,
  ExpenseCategory,
];

describe('CatalogsService.create — new items land last', () => {
  let service: CatalogsService;
  let rawByAlias: Map<string, RawMax>;

  beforeEach(async () => {
    rawByAlias = new Map<string, RawMax>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CatalogsService,
        ...CATALOG_ENTITIES.map((entity) => ({
          provide: getRepositoryToken(entity),
          useValue: makeFakeRepo(rawByAlias),
        })),
      ],
    }).compile();

    service = module.get<CatalogsService>(CatalogsService);
  });

  it('gives sortOrder 0 in an empty dimension (MAX is null)', async () => {
    rawByAlias.set('maxSortOrder', null);

    const item = await service.create('supply-types', { name: 'x' });

    expect(item.sortOrder).toBe(0);
  });

  it('gives MAX(sort_order) + 1 when the driver returns a number', async () => {
    rawByAlias.set('maxSortOrder', 4);

    const item = await service.create('supply-types', { name: 'x' });

    expect(item.sortOrder).toBe(5);
  });

  it('gives MAX(sort_order) + 1 when the driver returns a numeric string', async () => {
    rawByAlias.set('maxSortOrder', '4');

    const item = await service.create('expense-categories', { name: 'x' });

    expect(item.sortOrder).toBe(5);
  });

  it('keeps assigning skuCode MAX + 1 on SKU dimensions alongside sortOrder', async () => {
    rawByAlias.set('maxCode', '7');
    rawByAlias.set('maxSortOrder', 2);

    const item = (await service.create('product-sizes', {
      name: 'x',
    })) as CreatedItem;

    expect(item.skuCode).toBe(8);
    expect(item.sortOrder).toBe(3);
  });

  it('never writes sortOrder onto the incoming DTO', async () => {
    rawByAlias.set('maxSortOrder', 4);
    const dto: CreateCatalogItemDto = { name: 'x' };

    await service.create('supply-types', dto);

    expect(Object.keys(dto)).not.toContain('sortOrder');
  });
});
