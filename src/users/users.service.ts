import { Injectable, NotFoundException } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { UpdateUserDto } from './dto/update-user.dto';

interface Actor { actorId?: string; ip?: string }

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Kullanıcı bulunamadı');
    return user;
  }

  list(skip = 0, take = 50) {
    return this.prisma.user.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      skip,
      take: Math.min(take, 100),
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findById(id);
    return this.prisma.user.update({ where: { id }, data: dto });
  }

  async assignRoles(id: string, roles: Role[], actor?: Actor) {
    const before = await this.findById(id);
    const updated = await this.prisma.user.update({ where: { id }, data: { roles } });
    await this.audit.record({
      actorId: actor?.actorId,
      action: 'user.role.assign',
      entity: 'User',
      entityId: id,
      ip: actor?.ip,
      metadata: { from: before.roles, to: roles },
    });
    return updated;
  }

  async setStatus(id: string, status: UserStatus, actor?: Actor) {
    const before = await this.findById(id);
    const updated = await this.prisma.user.update({ where: { id }, data: { status } });
    await this.audit.record({
      actorId: actor?.actorId,
      action: 'user.status.change',
      entity: 'User',
      entityId: id,
      ip: actor?.ip,
      metadata: { from: before.status, to: status },
    });
    return updated;
  }
}
