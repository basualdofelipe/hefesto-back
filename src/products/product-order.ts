import type { FindOptionsOrder } from 'typeorm';
import { CATALOG_ITEM_ORDER } from '../catalogs/catalog-order';
import type { Product } from './entities/product.entity';

/**
 * The single definition of product catalog order (D-11): tipo → nombre →
 * terminación → color → talle, each level by its manual sort_order with the
 * name as the tiebreak at that level — the same per-level rule GET /catalogs
 * uses, so product order always equals catalog order.
 *
 * Key order is SQL order (TypeORM builds ORDER BY in key insertion order).
 * Every endpoint that returns a product list orders with this constant.
 */
export const PRODUCT_CATALOG_ORDER: FindOptionsOrder<Product> = {
  type: CATALOG_ITEM_ORDER,
  name: CATALOG_ITEM_ORDER,
  finish: CATALOG_ITEM_ORDER,
  color: CATALOG_ITEM_ORDER,
  size: CATALOG_ITEM_ORDER,
};
