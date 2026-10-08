import { BadRequestException } from '@nestjs/common';
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

/**
 * R2 exact-set rule for a reorder: the requested ids must be exactly the
 * dimension's current ids — same size, no duplicates, nothing unknown, nothing
 * missing. Stale client state (an item created or deleted after the client's
 * GET) is the main real-world trigger. Throws a 400 before any write.
 */
export function assertSameSet(
  currentIds: readonly string[],
  requested: readonly string[],
): void {
  const requestedSet = new Set(requested);
  const sameSet =
    requested.length === currentIds.length &&
    requestedSet.size === requested.length &&
    currentIds.every((id) => requestedSet.has(id));

  if (!sameSet) {
    throw new BadRequestException(
      'El orden enviado no coincide con los ítems actuales del catálogo',
    );
  }
}
