import { Column } from 'typeorm';
import { BaseEntity } from '../../common/entities/base.entity';

/**
 * Shared shape of the 7 catalog dimensions (D-01). `sortOrder` is the manual
 * order a user sets; GET returns items by sortOrder, then name (D-03).
 */
export abstract class CatalogItemEntity extends BaseEntity {
  @Column({ type: 'varchar', length: 100, unique: true })
  name!: string;

  @Column({ name: 'sort_order', type: 'smallint', default: 0 })
  sortOrder!: number;
}
