import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

@Injectable()
export class AddressService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.address.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async create(userId: string, dto: CreateAddressDto) {
    const count = await this.prisma.address.count({ where: { userId, deletedAt: null } });
    const makeDefault = dto.isDefault || count === 0;
    return this.prisma.$transaction(async (tx) => {
      if (makeDefault) {
        await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      }
      return tx.address.create({ data: { ...dto, userId, isDefault: makeDefault } });
    });
  }

  private async owned(userId: string, id: string) {
    const addr = await this.prisma.address.findFirst({ where: { id, deletedAt: null } });
    if (!addr) throw new NotFoundException('Adres bulunamadı');
    if (addr.userId !== userId) throw new ForbiddenException('Bu adres size ait değil');
    return addr;
  }

  async update(userId: string, id: string, dto: UpdateAddressDto) {
    await this.owned(userId, id);
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      }
      return tx.address.update({ where: { id }, data: dto });
    });
  }

  async setDefault(userId: string, id: string) {
    await this.owned(userId, id);
    return this.prisma.$transaction(async (tx) => {
      await tx.address.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
      return tx.address.update({ where: { id }, data: { isDefault: true } });
    });
  }

  async remove(userId: string, id: string) {
    const addr = await this.owned(userId, id);
    await this.prisma.address.update({ where: { id }, data: { deletedAt: new Date(), isDefault: false } });
    if (addr.isDefault) {
      const next = await this.prisma.address.findFirst({
        where: { userId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      if (next) await this.prisma.address.update({ where: { id: next.id }, data: { isDefault: true } });
    }
    return { deleted: true };
  }
}
