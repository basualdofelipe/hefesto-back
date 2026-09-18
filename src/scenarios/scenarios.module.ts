import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Scenario } from './entities/scenario.entity';
import { ScenarioOverride } from './entities/scenario-override.entity';
import { CalculatorModule } from '../calculator/calculator.module';
import { CostsModule } from '../costs/costs.module';
import { ProductsModule } from '../products/products.module';
import { TiendanubeConfigModule } from '../tiendanube-config/tiendanube-config.module';
import { ScenariosController } from './scenarios.controller';
import { ScenariosService } from './scenarios.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Scenario, ScenarioOverride]),
    CalculatorModule,
    CostsModule,
    ProductsModule,
    TiendanubeConfigModule,
  ],
  controllers: [ScenariosController],
  providers: [ScenariosService],
  exports: [ScenariosService],
})
export class ScenariosModule {}
