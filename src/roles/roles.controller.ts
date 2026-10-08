import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { RolesService, RoleView } from './roles.service';

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @Get()
  @RequirePermission('can_manage_users')
  @ApiOperation({ summary: 'List all roles with user counts (ADMIN only)' })
  @ApiResponse({
    status: 200,
    description:
      'List of all roles with effective permissions; permissionsLocked is true for ADMIN, whose permissions cannot be edited',
  })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findAll(): Promise<RoleView[]> {
    return this.rolesService.findAll();
  }

  @Post()
  @RequirePermission('can_manage_users')
  @ApiOperation({ summary: 'Create a new role (ADMIN only)' })
  @ApiResponse({ status: 201, description: 'Role created successfully' })
  @ApiResponse({ status: 409, description: 'Role name already exists' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async create(@Body() dto: CreateRoleDto): Promise<RoleView> {
    return this.rolesService.create(dto);
  }

  @Patch(':id')
  @RequirePermission('can_manage_users')
  @ApiOperation({ summary: 'Update a role (ADMIN only)' })
  @ApiResponse({ status: 200, description: 'Role updated successfully' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<RoleView> {
    return this.rolesService.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('can_manage_users')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a role (ADMIN only)' })
  @ApiResponse({ status: 204, description: 'Role deleted successfully' })
  @ApiResponse({
    status: 400,
    description: 'Cannot delete system role or role with users',
  })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.rolesService.remove(id);
  }
}
