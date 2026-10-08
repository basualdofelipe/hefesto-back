import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import {
  extractPermissions,
  isAdminRole,
  PERMISSION_TO_CAMEL,
  Permissions,
} from '../common/types/permission';
import { User } from '../users/entities/user.entity';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { Role } from './entities/role.entity';

/** Role as served by the roles API: effective permissions plus the server-computed lock (D-19). */
export type RoleView = Role & { permissionsLocked: boolean };

const PERMISSION_FIELDS: readonly (keyof Permissions)[] =
  Object.values(PERMISSION_TO_CAMEL);

@Injectable()
export class RolesService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  async findAll(): Promise<RoleView[]> {
    const roles = await this.withUserCount()
      .orderBy('role.isSystem', 'DESC')
      .addOrderBy('role.name', 'ASC')
      .getMany();
    return roles.map((role) => this.toView(role));
  }

  async findOne(id: string): Promise<Role> {
    const role = await this.roleRepo.findOne({ where: { id } });
    if (!role) {
      throw new NotFoundException('Rol no encontrado');
    }
    return role;
  }

  async create(dto: CreateRoleDto): Promise<RoleView> {
    const existing = await this.roleRepo.findOne({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException('Ya existe un rol con ese nombre');
    }
    const role = this.roleRepo.create(dto);
    const saved = await this.roleRepo.save(role);
    return this.findView(saved.id);
  }

  async update(id: string, dto: UpdateRoleDto): Promise<RoleView> {
    const role = await this.findOne(id);

    if (role.isSystem && dto.name !== undefined && dto.name !== role.name) {
      throw new BadRequestException(
        'No se puede cambiar el nombre de un rol de sistema',
      );
    }

    // D-18: ADMIN always has every permission. Sending the effective values
    // (all true) is allowed; anything else is a change attempt. An explicit
    // null arrives as false through the DTO @Transform, so it is refused too.
    const isAdmin = isAdminRole(role);
    if (isAdmin) {
      const attempted = PERMISSION_FIELDS.filter(
        (field) => dto[field] !== undefined && dto[field] !== true,
      );
      if (attempted.length > 0) {
        throw new BadRequestException(
          'No se pueden modificar los permisos del rol ADMIN',
        );
      }
    }

    if (dto.name && dto.name !== role.name) {
      const conflict = await this.roleRepo.findOne({
        where: { name: dto.name },
      });
      if (conflict) {
        throw new ConflictException('Ya existe un rol con ese nombre');
      }
    }

    // ADMIN's stored flags are never written: they are ignored anyway (D-18)
    // and the SPEC rules out a flag migration.
    this.roleRepo.merge(role, isAdmin ? this.withoutPermissions(dto) : dto);
    const saved = await this.roleRepo.save(role);
    return this.findView(saved.id);
  }

  async remove(id: string): Promise<void> {
    const role = await this.findOne(id);

    if (role.isSystem) {
      throw new BadRequestException('No se puede eliminar un rol de sistema');
    }

    const count = await this.userRepo.count({ where: { role: { id } } });
    if (count > 0) {
      throw new BadRequestException(
        'No se puede eliminar un rol con usuarios asignados',
      );
    }

    await this.roleRepo.delete(id);
  }

  /** Roles with `userCount` loaded: every RoleView the API serves carries it. */
  private withUserCount(): SelectQueryBuilder<Role> {
    return this.roleRepo
      .createQueryBuilder('role')
      .loadRelationCountAndMap('role.userCount', 'role.users');
  }

  /**
   * The view of one role, re-read with its user count: the roles screen
   * replaces its row with the POST/PATCH reply (D-19), and `save()` alone
   * does not load the count.
   */
  private async findView(id: string): Promise<RoleView> {
    const role = await this.withUserCount()
      .where('role.id = :id', { id })
      .getOne();
    if (!role) {
      throw new NotFoundException('Rol no encontrado');
    }
    return this.toView(role);
  }

  private toView(role: Role): RoleView {
    return {
      ...role,
      ...extractPermissions(role),
      permissionsLocked: isAdminRole(role),
    };
  }

  private withoutPermissions(dto: UpdateRoleDto): UpdateRoleDto {
    const changes: UpdateRoleDto = { ...dto };
    for (const field of PERMISSION_FIELDS) {
      delete changes[field];
    }
    return changes;
  }
}
