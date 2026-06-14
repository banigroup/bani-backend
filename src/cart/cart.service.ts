import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AddItemDto } from './dto/add-item.dto';

@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  private async getOrCreate(userId: string) {
    const existing = await this.prisma.cart.findUnique({ where: { userId } });
    if (existing) return existing;
    return this.prisma.cart.create({ data: { userId } });
  }

  async view(userId: string) {
    const cart = await this.getOrCreate(userId);
    const items = await this.prisma.cartItem.findMany({
      where: { cartId: cart.id },
      orderBy: { createdAt: 'asc' },
      include: { product: { select: { id: true, name: true, imageUrl: true, price: true, stock: true, isActive: true } } },
    });

    let subtotal = 0n;
    const lines = items.map((it) => {
      const lineTotal = it.unitPrice * BigInt(it.quantity);
      subtotal += lineTotal;
      return {
        id: it.id,
        productId: it.productId,
        name: it.product.name,
        imageUrl: it.product.imageUrl,
        unitPrice: it.unitPrice,
        quantity: it.quantity,
        lineTotal,
      };
    });

    return {
      cartId: cart.id,
      storeId: cart.storeId,
      itemCount: lines.reduce((n, l) => n + l.quantity, 0),
      subtotal,
      items: lines,
    };
  }

  async addItem(userId: string, dto: AddItemDto) {
    const cart = await this.getOrCreate(userId);
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, deletedAt: null, isActive: true },
    });
    if (!product) throw new NotFoundException('Ürün bulunamadı veya pasif');

    const qty = dto.quantity ?? 1;

    // Sepet farklı bir mağazaya aitse, yeni mağaza için sepeti sıfırla
    if (cart.storeId && cart.storeId !== product.storeId) {
      await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
      await this.prisma.cart.update({ where: { id: cart.id }, data: { storeId: product.storeId } });
    } else if (!cart.storeId) {
      await this.prisma.cart.update({ where: { id: cart.id }, data: { storeId: product.storeId } });
    }

    const existing = await this.prisma.cartItem.findUnique({
      where: { cartId_productId: { cartId: cart.id, productId: product.id } },
    });

    if (existing) {
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { quantity: existing.quantity + qty, unitPrice: product.price },
      });
    } else {
      await this.prisma.cartItem.create({
        data: { cartId: cart.id, productId: product.id, quantity: qty, unitPrice: product.price },
      });
    }

    return this.view(userId);
  }

  async updateItem(userId: string, itemId: string, quantity: number) {
    const cart = await this.getOrCreate(userId);
    const item = await this.prisma.cartItem.findUnique({ where: { id: itemId } });
    if (!item || item.cartId !== cart.id) throw new NotFoundException('Sepet kalemi bulunamadı');

    if (quantity <= 0) {
      await this.prisma.cartItem.delete({ where: { id: itemId } });
    } else {
      await this.prisma.cartItem.update({ where: { id: itemId }, data: { quantity } });
    }
    return this.view(userId);
  }

  async removeItem(userId: string, itemId: string) {
    const cart = await this.getOrCreate(userId);
    const item = await this.prisma.cartItem.findUnique({ where: { id: itemId } });
    if (!item || item.cartId !== cart.id) throw new NotFoundException('Sepet kalemi bulunamadı');
    await this.prisma.cartItem.delete({ where: { id: itemId } });
    return this.view(userId);
  }

  async clear(userId: string) {
    const cart = await this.getOrCreate(userId);
    await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
    await this.prisma.cart.update({ where: { id: cart.id }, data: { storeId: null } });
    return this.view(userId);
  }
}
