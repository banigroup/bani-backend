import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CartService } from './cart.service';
import { AddItemDto } from './dto/add-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';
import { dikeyCoz } from '../common/domain/dikey-domain';

// SEPET DIKEYE KILITLI (bkz. schema.prisma Cart @@unique([userId, businessUnit])).
// Hangi dikeyin sepetiyle calisildigi su sirayla cozulur:
//   1. Origin markali bir domainse (banimarket.com.tr) -> otoriter kaynak odur
//   2. Ana domainden (banigroup.com.tr/market) gelen istekte origin dikeyi
//      soylemez; istemci X-Bani-Dikey basligiyla bildirir
//   3. Hicbiri yoksa CartService gecis kuralini uygular (en son dokunulan sepet)
// Urun EKLEMEDE bu cozum kullanilmaz: orada dikeyi urunun magazasi belirler.
@Controller('cart')
@UseGuards(JwtAuthGuard)
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  view(
    @CurrentUser() user: AuthUser,
    @Headers('origin') origin?: string,
    @Headers('x-bani-dikey') dikeyBaslik?: string,
  ) {
    return this.cart.view(user.id, dikeyCoz(origin, dikeyBaslik));
  }

  @Post('items')
  add(@CurrentUser() user: AuthUser, @Body() dto: AddItemDto) {
    return this.cart.addItem(user.id, dto);
  }

  @Patch('items/:id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateItemDto) {
    return this.cart.updateItem(user.id, id, dto.quantity);
  }

  @Delete('items/:id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cart.removeItem(user.id, id);
  }

  @Delete()
  clear(
    @CurrentUser() user: AuthUser,
    @Headers('origin') origin?: string,
    @Headers('x-bani-dikey') dikeyBaslik?: string,
  ) {
    return this.cart.clear(user.id, dikeyCoz(origin, dikeyBaslik));
  }
}
