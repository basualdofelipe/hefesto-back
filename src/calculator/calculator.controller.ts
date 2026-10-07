import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { TiendanubeConfigService } from '../tiendanube-config/tiendanube-config.service';
import { CalculatorService } from './calculator.service';
import { CalcForwardDto } from './dto/calc-forward.dto';
import { CalcInverseDto } from './dto/calc-inverse.dto';
import { CalcBatchDto } from './dto/calc-batch.dto';
import {
  CalcResult,
  CalcInverseResult,
  CalcBatchItem,
  CalcError,
} from './dto/calc-result.dto';

@ApiTags('calculator')
@ApiBearerAuth()
@Controller('calculator')
export class CalculatorController {
  constructor(
    private readonly calculatorService: CalculatorService,
    private readonly tiendanubeConfigService: TiendanubeConfigService,
  ) {}

  @Post('forward')
  @HttpCode(200)
  @RequirePermission('can_use_calculator')
  @ApiOperation({
    summary: 'Calcular ganancia real a partir de precio de venta (forward)',
    description: 'Requires: can_use_calculator',
  })
  @ApiResponse({
    status: 200,
    description: 'Desglose completo de la operacion',
  })
  @ApiResponse({
    status: 400,
    description:
      'Falta productId/productCost, producto sin costo, o datos inválidos',
  })
  @ApiResponse({
    status: 404,
    description:
      'Product, gateway rate, installment rate, or tax config not found',
  })
  async forward(@Body() dto: CalcForwardDto): Promise<CalcResult> {
    const config = await this.tiendanubeConfigService.getAll();
    const productCost = await this.calculatorService.resolveProductCost(
      dto.productId,
      dto.productCost,
    );

    // Return CalcResult directly -- ResponseInterceptor wraps to { data: CalcResult }
    return this.calculatorService.calcForward({
      sellingPrice: dto.sellingPrice,
      shippingCharged: dto.shippingCharged,
      shippingCost: dto.shippingCost,
      productCost,
      gatewaySlug: dto.gatewaySlug,
      paymentMethod: dto.paymentMethod,
      withdrawalDays: dto.withdrawalDays,
      installments: dto.installments,
      planSlug: dto.planSlug,
      config,
    });
  }

  @Post('inverse')
  @HttpCode(200)
  @RequirePermission('can_use_calculator')
  @ApiOperation({
    summary:
      'Calcular precio de venta necesario para ganancia deseada (inverse)',
    description: 'Requires: can_use_calculator',
  })
  @ApiResponse({
    status: 200,
    description: 'Precio de venta calculado con desglose completo',
  })
  @ApiResponse({
    status: 400,
    description:
      'Falta productId/productCost, producto sin costo, ganancia negativa o inalcanzable',
  })
  @ApiResponse({
    status: 404,
    description:
      'Product, gateway rate, installment rate, or tax config not found',
  })
  async inverse(@Body() dto: CalcInverseDto): Promise<CalcInverseResult> {
    const config = await this.tiendanubeConfigService.getAll();
    const productCost = await this.calculatorService.resolveProductCost(
      dto.productId,
      dto.productCost,
    );

    const result = this.calculatorService.calcInverse({
      targetProfit: dto.targetProfit,
      shippingCharged: dto.shippingCharged,
      shippingCost: dto.shippingCost,
      productCost,
      gatewaySlug: dto.gatewaySlug,
      paymentMethod: dto.paymentMethod,
      withdrawalDays: dto.withdrawalDays,
      installments: dto.installments,
      planSlug: dto.planSlug,
      config,
    });

    // On CalcError, throw BadRequestException
    if ((result as CalcError).error) {
      throw new BadRequestException((result as CalcError).message);
    }

    // Return CalcInverseResult directly -- ResponseInterceptor wraps to { data: CalcInverseResult }
    return result as CalcInverseResult;
  }

  @Post('batch')
  @HttpCode(200)
  @RequirePermission('can_use_calculator')
  @ApiOperation({
    summary: 'Calcular margenes de todos los productos (batch)',
    description: 'Requires: can_use_calculator',
  })
  @ApiResponse({
    status: 200,
    description: 'Array de productos con su resultado de calculo',
  })
  @ApiResponse({
    status: 404,
    description: 'Gateway rate, installment rate, or tax config not found',
  })
  async batch(@Body() dto: CalcBatchDto): Promise<CalcBatchItem[]> {
    // Return CalcBatchItem[] directly -- ResponseInterceptor wraps to { data: CalcBatchItem[] }
    return this.calculatorService.calcBatch({
      gatewaySlug: dto.gatewaySlug,
      paymentMethod: dto.paymentMethod,
      withdrawalDays: dto.withdrawalDays,
      installments: dto.installments,
      planSlug: dto.planSlug,
    });
  }
}
