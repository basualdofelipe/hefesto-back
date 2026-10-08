import { Column, Entity } from 'typeorm';
import { CatalogItemEntity } from './catalog-item.entity';

@Entity('product_sizes')
export class ProductSize extends CatalogItemEntity {
  @Column({ name: 'sku_code', type: 'smallint', unique: true })
  skuCode!: number;
}
