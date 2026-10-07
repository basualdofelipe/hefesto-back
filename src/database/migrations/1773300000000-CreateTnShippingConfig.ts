import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTnShippingConfig1773300000000 implements MigrationInterface {
  name = 'CreateTnShippingConfig1773300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Append-only history of the default shipping pair (same shape as tn_tax_config).
    await queryRunner.query(
      `CREATE TABLE "tn_shipping_config" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "default_shipping_cost" decimal(12,2) NOT NULL,
        "default_shipping_charged" decimal(12,2) NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_tn_shipping_config_id" PRIMARY KEY ("id")
      )`,
    );

    // Seed: no shipping by default, so batch and scenarios keep their pre-existing results.
    await queryRunner.query(
      `INSERT INTO "tn_shipping_config" ("default_shipping_cost", "default_shipping_charged")
        VALUES (0.00, 0.00)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "tn_shipping_config"`);
  }
}
