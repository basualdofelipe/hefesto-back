import { Entity } from 'typeorm';
import { CatalogItemEntity } from './catalog-item.entity';

@Entity('supply_types')
export class SupplyType extends CatalogItemEntity {}
