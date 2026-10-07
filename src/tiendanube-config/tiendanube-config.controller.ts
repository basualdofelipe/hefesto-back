import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import {
  ParsedGatewayRate,
  ParsedInstallmentRate,
  ParsedPlan,
  ParsedShippingConfig,
  ParsedTaxConfig,
  TiendanubeConfigAll,
  TiendanubeConfigService,
} from './tiendanube-config.service';
import { TnPaymentGateway } from './entities/tn-payment-gateway.entity';
import { UpdateGatewayRateDto } from './dto/update-gateway-rate.dto';
import { UpdateInstallmentRateDto } from './dto/update-installment-rate.dto';
import { UpdateTaxConfigDto } from './dto/update-tax-config.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { UpdateShippingConfigDto } from './dto/update-shipping-config.dto';

@ApiTags('Tiendanube Config')
@ApiBearerAuth()
@Controller('tiendanube-config')
export class TiendanubeConfigController {
  constructor(private readonly configService: TiendanubeConfigService) {}

  @Get('all')
  @ApiOperation({
    summary: 'Obtener toda la configuracion de Tiendanube',
    description: 'Requires: authenticated user (no specific permission)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Configuracion completa (gateways, tasas, cuotas, impuestos, planes)',
  })
  async getAll(): Promise<TiendanubeConfigAll> {
    return this.configService.getAll();
  }

  @Get('gateways')
  @ApiOperation({
    summary: 'Obtener pasarelas de pago con tasas actuales',
    description: 'Requires: authenticated user (no specific permission)',
  })
  @ApiResponse({
    status: 200,
    description: 'Pasarelas con tasas agrupadas',
  })
  async getGateways(): Promise<
    (TnPaymentGateway & { rates: ParsedGatewayRate[] })[]
  > {
    return this.configService.getGatewaysWithRates();
  }

  @Put('gateway-rates/:gatewayId')
  @RequirePermission('can_manage_config')
  @ApiOperation({
    summary: 'Actualizar tasa de una pasarela (crea nuevo registro historico)',
    description: 'Requires: can_manage_config',
  })
  @ApiResponse({ status: 200, description: 'Tasa actualizada exitosamente' })
  @ApiResponse({ status: 404, description: 'Pasarela no encontrada' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — requiere permiso can_manage_config',
  })
  async updateGatewayRate(
    @Param('gatewayId', ParseUUIDPipe) gatewayId: string,
    @Body() dto: UpdateGatewayRateDto,
  ): Promise<ParsedGatewayRate> {
    return this.configService.updateGatewayRate(gatewayId, dto);
  }

  @Get('installments')
  @ApiOperation({
    summary: 'Obtener tasas de cuotas actuales',
    description: 'Requires: authenticated user (no specific permission)',
  })
  @ApiResponse({
    status: 200,
    description: 'Tasas de cuotas (ultima por cantidad de cuotas)',
  })
  async getInstallments(): Promise<ParsedInstallmentRate[]> {
    return this.configService.getInstallmentRates();
  }

  @Put('installment-rates/:installments')
  @RequirePermission('can_manage_config')
  @ApiOperation({
    summary: 'Actualizar tasa de cuotas (crea nuevo registro historico)',
    description: 'Requires: can_manage_config',
  })
  @ApiResponse({ status: 200, description: 'Tasa de cuotas actualizada' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — requiere permiso can_manage_config',
  })
  async updateInstallmentRate(
    @Param('installments', ParseIntPipe) installments: number,
    @Body() dto: UpdateInstallmentRateDto,
  ): Promise<ParsedInstallmentRate> {
    return this.configService.updateInstallmentRate(installments, dto);
  }

  @Get('taxes')
  @ApiOperation({
    summary: 'Obtener configuracion de impuestos actual',
    description: 'Requires: authenticated user (no specific permission)',
  })
  @ApiResponse({
    status: 200,
    description: 'Configuracion de impuestos (IVA, IIBB)',
  })
  async getTaxes(): Promise<ParsedTaxConfig | null> {
    return this.configService.getTaxConfig();
  }

  @Put('taxes')
  @RequirePermission('can_manage_config')
  @ApiOperation({
    summary:
      'Actualizar configuracion de impuestos (crea nuevo registro historico)',
    description: 'Requires: can_manage_config',
  })
  @ApiResponse({
    status: 200,
    description: 'Configuracion de impuestos actualizada',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — requiere permiso can_manage_config',
  })
  async updateTaxConfig(
    @Body() dto: UpdateTaxConfigDto,
  ): Promise<ParsedTaxConfig> {
    return this.configService.updateTaxConfig(dto);
  }

  @Get('shipping')
  @ApiOperation({
    summary: 'Obtener envío por defecto vigente',
    description: 'Requires: authenticated user (no specific permission)',
  })
  @ApiResponse({
    status: 200,
    description: 'Envío por defecto (costo con IVA y cobrado al cliente)',
  })
  async getShipping(): Promise<ParsedShippingConfig | null> {
    return this.configService.getShippingConfig();
  }

  @Put('shipping')
  @RequirePermission('can_manage_config')
  @ApiOperation({
    summary: 'Actualizar envío por defecto (crea nuevo registro histórico)',
    description: 'Requires: can_manage_config',
  })
  @ApiResponse({
    status: 200,
    description: 'Envío por defecto actualizado',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — requiere permiso can_manage_config',
  })
  async updateShippingConfig(
    @Body() dto: UpdateShippingConfigDto,
  ): Promise<ParsedShippingConfig> {
    return this.configService.updateShippingConfig(dto);
  }

  @Get('plans')
  @ApiOperation({
    summary: 'Obtener planes de Tiendanube activos',
    description: 'Requires: authenticated user (no specific permission)',
  })
  @ApiResponse({
    status: 200,
    description: 'Lista de planes activos',
  })
  async getPlans(): Promise<ParsedPlan[]> {
    return this.configService.getPlans();
  }

  @Put('plans/:id')
  @RequirePermission('can_manage_config')
  @ApiOperation({
    summary: 'Actualizar tasas CPT de un plan',
    description: 'Requires: can_manage_config',
  })
  @ApiResponse({ status: 200, description: 'Plan actualizado' })
  @ApiResponse({ status: 404, description: 'Plan no encontrado' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden — requiere permiso can_manage_config',
  })
  async updatePlan(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
  ): Promise<ParsedPlan> {
    return this.configService.updatePlan(id, dto);
  }
}
