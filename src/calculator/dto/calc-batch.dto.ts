import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CalcBatchDto {
  @ApiProperty({ description: 'Gateway slug', example: 'pago_nube' })
  @IsString()
  gatewaySlug!: string;

  @ApiProperty({
    description: 'Payment method',
    example: 'tarjeta_debito_credito',
  })
  @IsString()
  paymentMethod!: string;

  @ApiProperty({ description: 'Withdrawal days', example: 14 })
  @IsNumber()
  @Min(0)
  withdrawalDays!: number;

  @ApiProperty({
    description: 'Number of installments',
    example: 1,
    default: 1,
  })
  @IsNumber()
  @Min(1)
  installments: number = 1;

  @ApiPropertyOptional({
    description: 'Plan slug override',
    example: 'esencial',
  })
  @IsOptional()
  @IsString()
  planSlug?: string;
}
