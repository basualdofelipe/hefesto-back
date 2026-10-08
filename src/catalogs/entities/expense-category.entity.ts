import { Entity } from 'typeorm';
import { CatalogItemEntity } from './catalog-item.entity';

@Entity('expense_categories')
export class ExpenseCategory extends CatalogItemEntity {}
