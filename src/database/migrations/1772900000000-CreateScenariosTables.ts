import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateScenariosTables1772900000000 implements MigrationInterface {
  name = 'CreateScenariosTables1772900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Create scenarios table
    await queryRunner.query(
      `CREATE TABLE "scenarios" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "name" character varying(200) NOT NULL,
        "user_id" uuid NOT NULL,
        "is_public" boolean NOT NULL DEFAULT false,
        "gateway_slug" character varying(50),
        "payment_method" character varying(50),
        "withdrawal_days" integer,
        "installments" integer,
        "plan_id" uuid,
        CONSTRAINT "PK_scenarios_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_scenarios_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_scenarios_plan" FOREIGN KEY ("plan_id") REFERENCES "tn_plans"("id") ON DELETE SET NULL
      )`,
    );

    // Index on user_id for fast user-scoped queries
    await queryRunner.query(
      `CREATE INDEX "IDX_scenarios_user" ON "scenarios" ("user_id")`,
    );

    // 2. Create scenario_overrides table
    await queryRunner.query(
      `CREATE TABLE "scenario_overrides" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "scenario_id" uuid NOT NULL,
        "product_id" uuid NOT NULL,
        "override_price" decimal(12,2) NOT NULL,
        CONSTRAINT "PK_scenario_overrides_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_scenario_overrides_scenario_product" UNIQUE ("scenario_id", "product_id"),
        CONSTRAINT "FK_scenario_overrides_scenario" FOREIGN KEY ("scenario_id") REFERENCES "scenarios"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_scenario_overrides_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE
      )`,
    );

    // Index on scenario_id for fast scenario override lookups
    await queryRunner.query(
      `CREATE INDEX "IDX_scenario_overrides_scenario" ON "scenario_overrides" ("scenario_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_scenario_overrides_scenario"`,
    );
    await queryRunner.query(`DROP TABLE "scenario_overrides"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_scenarios_user"`);
    await queryRunner.query(`DROP TABLE "scenarios"`);
  }
}
