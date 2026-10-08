import { Column, Entity } from 'typeorm';
import { CatalogItemEntity } from './catalog-item.entity';

@Entity('product_types')
export class ProductType extends CatalogItemEntity {
  @Column({ name: 'sku_code', type: 'smallint', unique: true })
  skuCode!: number;
}
