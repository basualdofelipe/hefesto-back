import { Column, Entity } from 'typeorm';
import { CatalogItemEntity } from './catalog-item.entity';

@Entity('product_names')
export class ProductName extends CatalogItemEntity {
  @Column({ name: 'sku_code', type: 'smallint', unique: true })
  skuCode!: number;
}
