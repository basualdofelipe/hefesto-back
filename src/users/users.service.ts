import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  EntityManager,
  QueryFailedError,
  QueryRunner,
  Repository,
} from 'typeorm';
import { Role } from '../roles/entities/role.entity';
import { ScenariosService } from '../scenarios/scenarios.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    private readonly scenariosService: ScenariosService,
  ) {}

  async findActiveByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { email, isActive: true },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { email },
    });
  }

  async findAll(): Promise<User[]> {
    return this.usersRepository.find();
  }

  async findById(id: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { id },
    });
  }

  async create(dto: CreateUserDto): Promise<User> {
    if (dto.roleId) {
      const roleExists = await this.roleRepository.findOne({
        where: { id: dto.roleId },
      });
      if (!roleExists) {
        throw new NotFoundException('Rol no encontrado');
      }
    }

    const user = this.usersRepository.create({
      email: dto.email,
      name: dto.name,
      role: dto.roleId ? ({ id: dto.roleId } as Role) : undefined,
    });
    // Catch the @Unique(['email']) constraint violation and surface it as 409 ConflictException.
    // The controller's pre-check (findByEmail before create) is a TOCTOU race -- under concurrent
    // POST /users with the same email both requests pass the pre-check,
    // both call create(), and the loser gets a raw 500 instead of 409.
    // Catching the DB constraint guarantees the right status code
    // regardless of timing. Pattern mirrors products.service.ts:149-159.
    try {
      return await this.usersRepository.save(user);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === '23505'
      ) {
        throw new ConflictException('Email ya registrado');
      }
      throw error;
    }
  }

  async updateGoogleProfile(
    id: string,
    data: { name: string | null; pictureUrl: string | null; googleId: string },
  ): Promise<void> {
    await this.usersRepository.update(id, {
      name: data.name,
      pictureUrl: data.pictureUrl,
      googleId: data.googleId,
    });
  }

  // ─── Helper: count OTHER active admins inside a transaction ───
  //
  // PostgreSQL prohibits FOR UPDATE with aggregate functions (COUNT), so
  // combining .setLock('pessimistic_write') with .getCount() is illegal and
  // causes a 500 ROLLBACK. The row-lock on the aggregate is also redundant:
  // update() and remove() both start a SERIALIZABLE transaction, which
  // already serializes concurrent demote/deactivate/delete requests on the
  // "penultimate" admin — no pessimistic_write lock on the COUNT query is
  // needed to guarantee safety.
  // Note: SERIALIZABLE enforces this by raising serialization_failure (40001)
  // on the losing txn; callers must map/retry that — see error handling in
  // update()/remove(), which maps 40001 to a 409 ConflictException.
  private async countOtherActiveAdmins(
    manager: EntityManager,
    excludeId: string,
  ): Promise<number> {
    return manager
      .createQueryBuilder(User, 'u')
      .innerJoin('u.role', 'r')
      .where('u.isActive = :active', { active: true })
      .andWhere('r.canManageUsers = :flag', { flag: true })
      .andWhere('u.id != :id', { id: excludeId })
      .getCount();
  }

  async update(
    id: string,
    dto: UpdateUserDto,
    callerId: string,
  ): Promise<User> {
    // Explicit guard — roleId null bypasses @IsUUID + @IsOptional
    // upstream, so the DTO can arrive with roleId === null. Reject it here
    // before any DB I/O instead of producing the misleading
    // "No puedes cambiar tu propio rol" further down.
    if (dto.roleId === null) {
      throw new BadRequestException('roleId no puede ser null');
    }

    // Wrap the entire read → guard → write sequence in a
    // SERIALIZABLE transaction with a pessimistic_write lock on the victim
    // row (and on the admin rows the guard reads). This closes the TOCTOU
    // window where two concurrent demote/delete requests could both pass
    // the last-admin guard.
    const queryRunner: QueryRunner =
      this.usersRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('SERIALIZABLE');

    try {
      const victim = await queryRunner.manager
        .createQueryBuilder(User, 'u')
        .innerJoinAndSelect('u.role', 'r')
        .setLock('pessimistic_write')
        .where('u.id = :id', { id })
        .getOne();

      if (!victim) {
        throw new NotFoundException('Usuario no encontrado');
      }

      // Defensive: User.role is technically nullable at the DB layer (the
      // @ManyToOne decorator does not enforce non-null in TypeORM). Null-coalesce
      // the id and permission lookups so a user without a role does not crash
      // with TypeError -- callers get well-formed 400/404 responses instead.
      const victimRoleId = victim.role?.id ?? null;

      // Guard 1: self-role-edit
      if (
        id === callerId &&
        dto.roleId !== undefined &&
        dto.roleId !== victimRoleId
      ) {
        throw new BadRequestException('No puedes cambiar tu propio rol');
      }

      // Guard 2: self-deactivate (idempotent — only block when this
      // PATCH would actually change isActive from true → false).
      if (
        id === callerId &&
        dto.isActive === false &&
        victim.isActive === true
      ) {
        throw new BadRequestException('No puedes desactivar tu propia cuenta');
      }

      // Resolve new role if changed
      let newRole: Role | null = victim.role ?? null;
      if (dto.roleId !== undefined && dto.roleId !== victimRoleId) {
        const found = await queryRunner.manager.findOne(Role, {
          where: { id: dto.roleId },
        });
        if (!found) {
          throw new NotFoundException('Rol no encontrado');
        }
        newRole = found;
      }

      // Guard 3: last-active-admin (computed after candidate write)
      const willBeActive = dto.isActive ?? victim.isActive;
      const willBeAdmin = newRole?.canManageUsers ?? false;
      const wasAdminActive =
        victim.isActive && (victim.role?.canManageUsers ?? false);
      const willNoLongerBeAdminActive =
        wasAdminActive && !(willBeActive && willBeAdmin);
      if (willNoLongerBeAdminActive) {
        const otherActiveAdmins = await this.countOtherActiveAdmins(
          queryRunner.manager,
          id,
        );
        if (otherActiveAdmins === 0) {
          throw new BadRequestException(
            'No se puede dejar el sistema sin administradores activos',
          );
        }
      }

      // Apply changes field-by-field (defense-in-depth: no repo.merge)
      if (dto.name !== undefined) {
        victim.name = dto.name;
      }
      // Only mutate role when it actually changed. Reassigning the
      // same role makes TypeORM emit the FK in the UPDATE and bumps
      // updated_at for no reason.
      if (dto.roleId !== undefined && dto.roleId !== victimRoleId && newRole) {
        victim.role = newRole;
      }
      if (dto.isActive !== undefined) {
        victim.isActive = dto.isActive;
      }

      const saved = await queryRunner.manager.save(User, victim);
      await queryRunner.commitTransaction();
      return saved;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      // SERIALIZABLE serializes the last-admin guard by ABORTING the
      // losing txn with serialization_failure (40001), not by blocking. Map
      // that raw QueryFailedError to a clean 409 instead of letting it surface
      // as an opaque 500. Mirrors the 23505 handling in create().
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === '40001'
      ) {
        throw new ConflictException(
          'Operación concurrente detectada, reintentá la acción',
        );
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async remove(id: string, callerId: string): Promise<void> {
    // Wrap the entire read → guard → transfer → delete sequence in a
    // SERIALIZABLE transaction with pessimistic_write locks. The self-delete
    // check moves AFTER the existence check so a caller whose own
    // row was concurrently deleted gets a clean 404 instead of "No puedes
    // borrarte a vos mismo".
    const queryRunner =
      this.usersRepository.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction('SERIALIZABLE');

    try {
      const victim = await queryRunner.manager
        .createQueryBuilder(User, 'u')
        .innerJoinAndSelect('u.role', 'r')
        .setLock('pessimistic_write')
        .where('u.id = :id', { id })
        .getOne();

      if (!victim) {
        throw new NotFoundException('Usuario no encontrado');
      }

      // Self-delete check AFTER existence check (mirrors update()
      // ordering and avoids misleading messages when the caller's own row
      // was concurrently deleted by another admin).
      if (id === callerId) {
        throw new BadRequestException('No puedes borrarte a vos mismo');
      }

      // Guard: last-active-admin (null-safe on victim.role). Inside the
      // transaction so two concurrent deletes of the penultimate admin
      // serialize on the pessimistic_write lock.
      if (victim.isActive && (victim.role?.canManageUsers ?? false)) {
        const otherActiveAdmins = await this.countOtherActiveAdmins(
          queryRunner.manager,
          id,
        );
        if (otherActiveAdmins === 0) {
          throw new BadRequestException(
            'No se puede dejar el sistema sin administradores activos',
          );
        }
      }

      // Atomic transfer + delete. Order matters: transferOwnership BEFORE
      // manager.delete so the ON DELETE CASCADE never fires against the
      // victim's scenarios.
      //
      // Defensive: victim.name can be '' or whitespace (frontend may submit
      // empty string). ?? only fires on null/undefined, so trim first and fall
      // back to 'usuario borrado' for any falsy/whitespace value.
      const trimmedName = victim.name?.trim();
      const baseLabel = trimmedName ? trimmedName : 'usuario borrado';
      // Include a short slice of the victim's UUID in the suffix so
      // bulk-renamed scenarios stay unique against the caller's existing
      // scenarios (the (user_id, name) constraint is enforced in code only,
      // and two victims with the same name would collide otherwise).
      const shortId = id.slice(0, 8);
      const suffix = ` - ${baseLabel} #${shortId}`;
      await this.scenariosService.transferOwnership(
        id,
        callerId,
        suffix,
        queryRunner,
      );
      await queryRunner.manager.delete(User, id);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      // SERIALIZABLE serializes the last-admin guard by ABORTING the
      // losing txn with serialization_failure (40001), not by blocking. Map
      // that raw QueryFailedError to a clean 409 instead of letting it surface
      // as an opaque 500. Mirrors the 23505 handling in create().
      if (
        error instanceof QueryFailedError &&
        (error as QueryFailedError & { code?: string }).code === '40001'
      ) {
        throw new ConflictException(
          'Operación concurrente detectada, reintentá la acción',
        );
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
