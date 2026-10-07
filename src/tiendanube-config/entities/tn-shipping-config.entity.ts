import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

/**
 * Default shipping pair used by the dashboard batch and the scenarios.
 *
 * Append-only history: every change inserts a new row; the current value is
 * the latest active row (ordered by created_at DESC). `default_shipping_cost`
 * is the amount paid to the carrier, IVA included; `default_shipping_charged`
 * is what the customer pays for shipping.
 */
@Entity('tn_shipping_config')
export class TnShippingConfig extends BaseEntity {
  @Column({
    name: 'default_shipping_cost',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: false,
  })
  defaultShippingCost!: string;

  @Column({
    name: 'default_shipping_charged',
    type: 'decimal',
    precision: 12,
    scale: 2,
    nullable: false,
  })
  defaultShippingCharged!: string;

  @Column({
    name: 'is_active',
    type: 'boolean',
    default: true,
    nullable: false,
  })
  isActive!: boolean;
}
