import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CalcForwardDto {
  @ApiPropertyOptional({
    description: 'Product UUID -- if provided, cost fetched from DB',
  })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiProperty({
    description: 'Selling price (without shipping)',
    example: 87000,
  })
  @IsNumber()
  @IsPositive()
  sellingPrice!: number;

  @ApiProperty({
    description: 'Shipping charged to the customer',
    example: 7315,
  })
  @IsNumber()
  @Min(0, { message: 'El envío no puede ser negativo' })
  shippingCharged!: number;

  @ApiProperty({
    description: 'Shipping cost paid to the carrier (with IVA)',
    example: 7315,
  })
  @IsNumber()
  @Min(0, { message: 'El envío no puede ser negativo' })
  shippingCost!: number;

  @ApiPropertyOptional({
    description: 'Product cost (without IVA) -- used if no productId',
    example: 6534.48,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  productCost?: number;

  @ApiProperty({
    description: 'Gateway slug (e.g., pago_nube, mercado_pago, modo)',
    example: 'pago_nube',
  })
  @IsString()
  gatewaySlug!: string;

  @ApiProperty({
    description: 'Payment method (e.g., tarjeta_debito_credito, transferencia)',
    example: 'tarjeta_debito_credito',
  })
  @IsString()
  paymentMethod!: string;

  @ApiProperty({ description: 'Withdrawal days (0, 1, 7, 14)', example: 14 })
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
    description:
      "Tiendanube plan slug. Omitted = 'esencial' (compile-time default, TN_PLAN_ESENCIAL); there is no per-admin current plan.",
    example: 'esencial',
  })
  @IsOptional()
  @IsString()
  planSlug?: string;
}
