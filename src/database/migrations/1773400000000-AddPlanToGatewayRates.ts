import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pago Nube per-plan rows (Aug-2026 published rates, "% + IVA").
 * [plan slug, payment method, withdrawal days, rate %]
 *
 * Only the tarjeta tiers that already exist as null-plan rows (7 d and 14 d)
 * plus transferencia 1 d are seeded, so the calculator default (7 d) and the
 * scenarios without withdrawal days keep today's behavior. The 1 d tarjeta
 * tier can be added per plan through the config UI (D-06).
 */
const PAGO_NUBE_PLAN_RATES: ReadonlyArray<
  readonly [string, string, number, number]
> = [
  ['inicial', 'tarjeta_debito_credito', 7, 4.45],
  ['inicial', 'tarjeta_debito_credito', 14, 3.5],
  ['inicial', 'transferencia', 1, 1.5],
  ['esencial', 'tarjeta_debito_credito', 7, 4.39],
  ['esencial', 'tarjeta_debito_credito', 14, 3.49],
  ['esencial', 'transferencia', 1, 1.5],
  ['impulso', 'tarjeta_debito_credito', 7, 4.19],
  ['impulso', 'tarjeta_debito_credito', 14, 3.29],
  ['impulso', 'transferencia', 1, 0.99],
  ['escala', 'tarjeta_debito_credito', 7, 3.89],
  ['escala', 'tarjeta_debito_credito', 14, 2.99],
  ['escala', 'transferencia', 1, 0.85],
];

export class AddPlanToGatewayRates1773400000000 implements MigrationInterface {
  name = 'AddPlanToGatewayRates1773400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nullable: null = the rate applies to every plan (D-05). Existing rows are
    // left untouched and become the fallback for plans without a specific row.
    await queryRunner.query(
      `ALTER TABLE "tn_gateway_rates" ADD COLUMN "plan_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "tn_gateway_rates" ADD CONSTRAINT "FK_tn_gateway_rates_plan" FOREIGN KEY ("plan_id") REFERENCES "tn_plans"("id") ON DELETE RESTRICT`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_tn_gateway_rates_plan_lookup" ON "tn_gateway_rates" ("gateway_id", "payment_method", "withdrawal_days", "plan_id", "created_at" DESC)`,
    );

    for (const [planSlug, method, days, rate] of PAGO_NUBE_PLAN_RATES) {
      await queryRunner.query(
        `INSERT INTO "tn_gateway_rates" ("gateway_id", "plan_id", "payment_method", "withdrawal_days", "rate_percent")
          SELECT gw.id, pl.id, $1, $2, $3
          FROM "tn_payment_gateways" gw, "tn_plans" pl
          WHERE gw."slug" = 'pago_nube' AND pl."slug" = $4`,
        [method, days, rate, planSlug],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Symmetric: plan-scoped rows (seeded here or created through the config UI)
    // cannot survive without the column; null-plan rows are never touched.
    await queryRunner.query(
      `DELETE FROM "tn_gateway_rates" WHERE "plan_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tn_gateway_rates_plan_lookup"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tn_gateway_rates" DROP CONSTRAINT IF EXISTS "FK_tn_gateway_rates_plan"`,
    );
    await queryRunner.query(
      `ALTER TABLE "tn_gateway_rates" DROP COLUMN "plan_id"`,
    );
  }
}
