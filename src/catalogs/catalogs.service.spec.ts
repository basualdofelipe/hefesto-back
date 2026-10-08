import { NotFoundException } from '@nestjs/common';
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

interface StoredItem {
  id: string;
  name: string;
  sortOrder: number;
  skuCode?: number;
}

type ItemPatch = Partial<StoredItem>;

interface FakeRowRepo {
  findOne(options: { where: { id: string } }): Promise<StoredItem | null>;
  create(data: ItemPatch): ItemPatch;
  merge(target: ItemPatch, ...sources: ItemPatch[]): ItemPatch;
  save(entity: ItemPatch): Promise<ItemPatch>;
  update(
    criteria: { id: string },
    patch: ItemPatch,
  ): Promise<{ affected: number }>;
}

/** The props of a patch that are not `undefined`; TypeORM skips the rest. */
const definedProps = (patch: ItemPatch): ItemPatch =>
  Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as ItemPatch;

/**
 * In-memory fake of the repository surface CatalogsService.update uses.
 * `findOne` hands out a snapshot (a copy), like a real read. `save` and
 * `update` mirror TypeORM: both write only the props that are not
 * `undefined`. `save` INSERTs when no row has the id (sort_order DEFAULT 0);
 * `update` touches only an existing row and reports how many it matched.
 * `afterFirstRead` runs once, right after the first snapshot is taken, to play
 * a write committed by another request.
 */
const makeRowRepo = (
  rows: Map<string, StoredItem>,
  afterFirstRead: () => void,
): FakeRowRepo => {
  let pendingHook: (() => void) | null = afterFirstRead;

  return {
    findOne: ({ where: { id } }): Promise<StoredItem | null> => {
      const stored = rows.get(id);
      const snapshot = stored ? { ...stored } : null;
      const hook = pendingHook;
      pendingHook = null;
      hook?.();
      return Promise.resolve(snapshot);
    },
    create: (data: ItemPatch): ItemPatch => ({ ...data }),
    merge: (target: ItemPatch, ...sources: ItemPatch[]): ItemPatch =>
      Object.assign(target, ...sources) as ItemPatch,
    save: (entity: ItemPatch): Promise<ItemPatch> => {
      const id = entity.id;
      if (!id) {
        return Promise.reject(new Error('fake save: no id'));
      }
      const base: StoredItem = rows.get(id) ?? { id, name: '', sortOrder: 0 };
      rows.set(id, { ...base, ...definedProps(entity) });
      return Promise.resolve(entity);
    },
    update: (
      { id }: { id: string },
      patch: ItemPatch,
    ): Promise<{ affected: number }> => {
      const stored = rows.get(id);
      if (!stored) {
        return Promise.resolve({ affected: 0 });
      }
      rows.set(id, { ...stored, ...definedProps(patch) });
      return Promise.resolve({ affected: 1 });
    },
  };
};

/** A CatalogsService whose 7 repositories share one in-memory row fake. */
const compileWithRowRepo = async (
  rows: Map<string, StoredItem>,
  afterFirstRead: () => void,
): Promise<CatalogsService> => {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      CatalogsService,
      ...CATALOG_ENTITIES.map((entity) => ({
        provide: getRepositoryToken(entity),
        useValue: makeRowRepo(rows, afterFirstRead),
      })),
    ],
  }).compile();

  return module.get<CatalogsService>(CatalogsService);
};

describe('CatalogsService.update — a rename never writes sort_order back', () => {
  const ITEM_ID = '00000000-0000-4000-8000-000000000001';
  const LOADED_SORT_ORDER = 3;
  const REORDERED_SORT_ORDER = 7;

  let service: CatalogsService;
  let rows: Map<string, StoredItem>;

  beforeEach(async () => {
    rows = new Map<string, StoredItem>([
      [
        ITEM_ID,
        { id: ITEM_ID, name: 'Lisa', sortOrder: LOADED_SORT_ORDER, skuCode: 4 },
      ],
    ]);
    // A reorder that commits between the rename's read and its save.
    const concurrentReorder = (): void => {
      const stored = rows.get(ITEM_ID);
      if (stored) {
        rows.set(ITEM_ID, { ...stored, sortOrder: REORDERED_SORT_ORDER });
      }
    };

    service = await compileWithRowRepo(rows, concurrentReorder);
  });

  it('keeps a sort_order committed by a concurrent reorder', async () => {
    await service.update('product-finishes', ITEM_ID, { name: 'Lisa mate' });

    expect(rows.get(ITEM_ID)).toEqual({
      id: ITEM_ID,
      name: 'Lisa mate',
      sortOrder: REORDERED_SORT_ORDER,
      skuCode: 4,
    });
  });

  it('returns the row as stored after the rename', async () => {
    const updated = await service.update('product-finishes', ITEM_ID, {
      name: 'Lisa mate',
    });

    expect(updated).toMatchObject({
      name: 'Lisa mate',
      sortOrder: REORDERED_SORT_ORDER,
    });
  });

  it('still answers 404 for an unknown id', async () => {
    await expect(
      service.update(
        'product-finishes',
        '00000000-0000-4000-8000-000000000099',
        { name: 'x' },
      ),
    ).rejects.toThrow('Item no encontrado');
  });
});

describe('CatalogsService.update — a rename racing a delete never re-inserts the row', () => {
  const ITEM_ID = '00000000-0000-4000-8000-000000000002';

  let service: CatalogsService;
  let rows: Map<string, StoredItem>;

  beforeEach(async () => {
    rows = new Map<string, StoredItem>([
      [ITEM_ID, { id: ITEM_ID, name: 'Hilo', sortOrder: 5 }],
    ]);
    // A delete that commits between the rename's read and its write.
    const concurrentDelete = (): void => {
      rows.delete(ITEM_ID);
    };

    service = await compileWithRowRepo(rows, concurrentDelete);
  });

  it('answers 404 and leaves no row with that id', async () => {
    await expect(
      service.update('supply-types', ITEM_ID, { name: 'Hilo encerado' }),
    ).rejects.toThrow(NotFoundException);

    expect(rows.has(ITEM_ID)).toBe(false);
  });
});
