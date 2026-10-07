import { Module } from '@nestjs/common';
import { TiendanubeConfigModule } from '../tiendanube-config/tiendanube-config.module';
import { CostsModule } from '../costs/costs.module';
import { ProductsModule } from '../products/products.module';
import { CalculatorController } from './calculator.controller';
import { CalculatorService } from './calculator.service';

@Module({
  imports: [TiendanubeConfigModule, CostsModule, ProductsModule],
  controllers: [CalculatorController],
  providers: [CalculatorService],
  exports: [CalculatorService],
})
export class CalculatorModule {}
