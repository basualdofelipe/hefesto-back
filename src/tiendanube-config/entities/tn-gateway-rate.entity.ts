import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';
import { TnPaymentGateway } from './tn-payment-gateway.entity';
import { TnPlan } from './tn-plan.entity';

@Entity('tn_gateway_rates')
@Index('IDX_tn_gateway_rates_lookup', [
  'gateway',
  'paymentMethod',
  'withdrawalDays',
  'createdAt',
])
/**
 * Mirrors the column set only: the DB index created by the migration orders
 * `created_at DESC`, which @Index cannot express (same as the lookup index above).
 */
@Index('IDX_tn_gateway_rates_plan_lookup', [
  'gateway',
  'paymentMethod',
  'withdrawalDays',
  'plan',
  'createdAt',
])
export class TnGatewayRate extends BaseEntity {
  @ManyToOne(() => TnPaymentGateway, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'gateway_id' })
  gateway!: TnPaymentGateway;

  /**
   * null = the rate applies to every plan (Mercado Pago / MODO, and the
   * pre-plan Pago Nube rows that act as the fallback when no plan-specific
   * row exists for the same gateway / payment method / withdrawal days).
   */
  @ManyToOne(() => TnPlan, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'plan_id' })
  plan!: TnPlan | null;

  @Column({
    name: 'payment_method',
    type: 'varchar',
    length: 50,
    nullable: false,
  })
  paymentMethod!: string;

  @Column({
    name: 'withdrawal_days',
    type: 'integer',
    nullable: false,
  })
  withdrawalDays!: number;

  @Column({
    name: 'rate_percent',
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: false,
  })
  ratePercent!: string;

  @Column({
    name: 'is_active',
    type: 'boolean',
    default: true,
    nullable: false,
  })
  isActive!: boolean;
}
