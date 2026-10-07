import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

// Upper bound keeps every accepted value inside the decimal(12,2) column
// (max 9,999,999,999.99) so an oversized value fails as a 400, not a DB 500.
const MAX_SHIPPING = 1000000000;

export class UpdateShippingConfigDto {
  @ApiProperty({
    description: 'Costo de envío por defecto pagado al correo, IVA incluido',
    example: 7315,
  })
  @IsNumber({}, { message: 'El costo de envío por defecto es obligatorio' })
  @Min(0, { message: 'El envío por defecto no puede ser negativo' })
  @Max(MAX_SHIPPING, { message: 'El envío no puede superar 1.000.000.000' })
  defaultShippingCost!: number;

  @ApiProperty({
    description: 'Envío por defecto cobrado al cliente',
    example: 7315,
  })
  @IsNumber({}, { message: 'El envío cobrado por defecto es obligatorio' })
  @Min(0, { message: 'El envío por defecto no puede ser negativo' })
  @Max(MAX_SHIPPING, { message: 'El envío no puede superar 1.000.000.000' })
  defaultShippingCharged!: number;
}
