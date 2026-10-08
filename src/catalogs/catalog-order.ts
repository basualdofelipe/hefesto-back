import { FindOptionsOrder } from 'typeorm';
import { CatalogItemEntity } from './entities/catalog-item.entity';

/**
 * The single per-level catalog order: manual sortOrder first, name as the
 * tiebreak (D-01, D-11). Key order is SQL order. Reused as-is for GET
 * catalogs and as a relation entry inside product/supply orders.
 */
export const CATALOG_ITEM_ORDER = {
  sortOrder: 'ASC',
  name: 'ASC',
} as const satisfies FindOptionsOrder<CatalogItemEntity>;
