import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { CatalogsModule } from './catalogs/catalogs.module';
import { CostsModule } from './costs/costs.module';
import { ExpensesModule } from './expenses/expenses.module';
import { envValidationSchema } from './config/env.validation';
import { throttlerConfig } from './config/throttler.config';
import { typeOrmConfig } from './config/typeorm.config';
import { ProductsModule } from './products/products.module';
import { SuppliesModule } from './supplies/supplies.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { TiendanubeConfigModule } from './tiendanube-config/tiendanube-config.module';
import { CalculatorModule } from './calculator/calculator.module';
import { RolesModule } from './roles/roles.module';
import { ScenariosModule } from './scenarios/scenarios.module';
import { UsersModule } from './users/users.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    ThrottlerModule.forRoot(throttlerConfig),
    TypeOrmModule.forRoot(typeOrmConfig),
    AuthModule,
    UsersModule,
    RolesModule,
    CatalogsModule,
    SuppliersModule,
    SuppliesModule,
    CostsModule,
    ExpensesModule,
    TiendanubeConfigModule,
    CalculatorModule,
    ScenariosModule,
    ProductsModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    AppService,
  ],
})
export class AppModule {}
