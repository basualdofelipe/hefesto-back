import { QueryRunner } from 'typeorm';

/**
 * ORDER BY clauses the backfill accepts: the exact orders the catalog GET used
 * before sort_order existed on every dimension (sizes: sort_order then name;
 * the other six: name). Backfilling with the same ORDER BY keeps the visible
 * order identical (D-03).
 */
export type BackfillOrderBy = '"name"' | '"sort_order", "name"';

/** Runtime allowlist — the literal union above is compile-time only. */
export const ALLOWED_BACKFILL_ORDER_BY: readonly BackfillOrderBy[] = [
  '"name"',
  '"sort_order", "name"',
];

const TABLE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Rewrites `sort_order` of every row in `table` to a dense 0..n-1 sequence
 * following `orderBy`, so the visible order is unchanged.
 *
 * Lives outside `migrations/` on purpose: TypeORM loads every exported
 * function of a file in the migrations glob as a migration class, so exporting
 * this helper from the migration file would break app boot. The migration and
 * the e2e suite both import it from here.
 *
 * `table` and `orderBy` are interpolated as SQL identifiers, so both are
 * checked at runtime before any query runs. Callers pass module constants or
 * temp-table names only — never request data.
 */
export async function backfillSortOrder(
  queryRunner: QueryRunner,
  table: string,
  orderBy: BackfillOrderBy,
): Promise<void> {
  if (!TABLE_IDENTIFIER.test(table)) {
    throw new TypeError(
      `backfillSortOrder: table "${table}" is not a plain lower-case SQL identifier`,
    );
  }
  if (!ALLOWED_BACKFILL_ORDER_BY.includes(orderBy)) {
    throw new TypeError(
      `backfillSortOrder: orderBy "${orderBy}" is not one of ${ALLOWED_BACKFILL_ORDER_BY.join(' | ')}`,
    );
  }

  await queryRunner.query(
    `UPDATE "${table}" AS c
        SET "sort_order" = (r.rn - 1)::smallint
       FROM (SELECT "id", ROW_NUMBER() OVER (ORDER BY ${orderBy}) AS rn
               FROM "${table}") r
      WHERE c."id" = r."id"`,
  );
}
