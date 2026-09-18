import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class UpdateGatewayRateDto {
  @ApiProperty({
    description:
      'Medio de pago (ej: tarjeta_debito_credito, billetera_virtual)',
    example: 'tarjeta_debito_credito',
  })
  @IsString({ message: 'El medio de pago es obligatorio' })
  @IsNotEmpty({ message: 'El medio de pago es obligatorio' })
  paymentMethod!: string;

  @ApiProperty({
    description: 'Dias de retiro (ej: 0, 1, 7, 14)',
    example: 7,
  })
  @IsNumber({}, { message: 'Los dias de retiro son obligatorios' })
  @Min(0, { message: 'Los dias de retiro no pueden ser negativos' })
  withdrawalDays!: number;

  @ApiProperty({
    description: 'Tasa de comision en porcentaje (ej: 4.39)',
    example: 4.39,
  })
  @IsNumber({}, { message: 'La tasa es obligatoria' })
  @Min(0, { message: 'La tasa no puede ser negativa' })
  @Max(100, { message: 'La tasa no puede superar 100%' })
  ratePercent!: number;

  @ApiPropertyOptional({
    description:
      'Plan UUID — only honored for gateways whose fee varies by plan (Pago Nube); omitted or other gateways store null',
    example: 'e5f6a7b8-c9d0-4123-8f01-345678901234',
  })
  @IsOptional()
  @IsUUID(undefined, { message: 'El plan debe ser un UUID valido' })
  planId?: string;
}
