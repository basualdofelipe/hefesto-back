import {
  IsArray,
  ValidateNested,
  IsUUID,
  IsNumber,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class OverrideItemDto {
  @ApiProperty()
  @IsUUID()
  productId!: string;

  @ApiProperty({ example: 95000 })
  @IsNumber()
  @Min(0)
  overridePrice!: number;
}

export class UpsertOverridesDto {
  @ApiProperty({ type: [OverrideItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OverrideItemDto)
  overrides!: OverrideItemDto[];
}
