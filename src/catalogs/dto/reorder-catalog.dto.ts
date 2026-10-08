import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsUUID } from 'class-validator';

/**
 * Full ordered id list of one catalog dimension (D-02). No size constraints:
 * [] is valid on an empty dimension and the SPEC sets no cap. @IsUUID keeps
 * non-UUIDs away from the $1::uuid[] cast, which would otherwise be a 500.
 */
export class ReorderCatalogDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description: 'Ids de la dimensión en el orden deseado',
  })
  @IsArray({ message: 'ids debe ser una lista' })
  @IsUUID('all', { each: true, message: 'Cada id debe ser un UUID' })
  ids!: string[];
}
