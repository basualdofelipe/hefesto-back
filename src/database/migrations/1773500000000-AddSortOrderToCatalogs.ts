import { MigrationInterface, QueryRunner } from 'typeorm';
import { backfillSortOrder } from '../backfill-sort-order';

const TABLES_WITHOUT_SORT_ORDER = [
  'product_types',
  'product_names',
  'product_finishes',
  'product_colors',
  'supply_types',
  'expense_categories',
] as const;

/**
 * Persisted manual order for every catalog dimension (Phase 15, R1, D-01/D-03).
 *
 * Adds `sort_order` to the six catalogs that lack it and backfills all seven
 * densely (0..n-1) with the ORDER BY the catalog GET used until now, so the
 * visible order is identical before and after. Inserts no rows.
 */
export class AddSortOrderToCatalogs1773500000000 implements MigrationInterface {
  name = 'AddSortOrderToCatalogs1773500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of TABLES_WITHOUT_SORT_ORDER) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN "sort_order" SMALLINT NOT NULL DEFAULT 0`,
      );
      await backfillSortOrder(queryRunner, table, '"name"');
    }

    // product_sizes already has sort_order (sparse 5/10/20...): densify it,
    // keeping its sort_order-then-name order.
    await backfillSortOrder(
      queryRunner,
      'product_sizes',
      '"sort_order", "name"',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // One-way for product_sizes: it keeps its pre-existing column, and its old
    // sparse values cannot be restored after the dense backfill (D-03).
    for (const table of TABLES_WITHOUT_SORT_ORDER) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN "sort_order"`,
      );
    }
  }
}
