export enum Permission {
  // Faz 1
  USER_READ = 'user:read',
  USER_WRITE = 'user:write',
  USER_ROLE_ASSIGN = 'user:role:assign',
  USER_SUSPEND = 'user:suspend',
  ADDRESS_READ = 'address:read',
  ADDRESS_WRITE = 'address:write',
  WALLET_READ = 'wallet:read',
  // WALLET_TOPUP: dogrulamasiz/manuel bakiye yazma - yalnizca SUPER_ADMIN.
  // Musterinin odeme yaparak bakiye yuklemesi PAYMENT_INITIATE iznindedir;
  // ikisi ayri tutulur ki manuel yazma yolu musteriye acilmasin.
  WALLET_TOPUP = 'wallet:topup',
  PAYMENT_INITIATE = 'payment:initiate',
  WALLET_WITHDRAW = 'wallet:withdraw',
  TRANSACTION_READ = 'transaction:read',
  TRANSACTION_REVERSE = 'transaction:reverse',
  AUDIT_READ = 'audit:read',

  // Faz 1 / A2 — izin matrisini panelden degistirme yetkisi.
  // DIKKAT: bu izne sahip olan, KENDI rolune de izin verebilir - yani yetki
  // yukseltmenin anahtaridir. Bu yuzden yalnizca SUPER_ADMIN'de duruyor.
  // ADMIN'e (veya operasyon/IK rollerine) verilecekse once "kendi rolunu
  // duzenleyemez" kurali yazilmali, yoksa ADMIN kendine finance:read verebilir.
  PERMISSION_MANAGE = 'permission:manage',

  // Faz 2 — Market / Katalog
  STORE_READ = 'store:read',
  STORE_WRITE = 'store:write',
  STORE_MANAGE_ALL = 'store:manage:all',
  PRODUCT_READ = 'product:read',
  PRODUCT_WRITE = 'product:write',
  CATEGORY_WRITE = 'category:write',
  PRODUCT_APPROVE = 'product:approve',

  // Faz 3 — Sipariş / Ödeme
  ORDER_READ = 'order:read',
  ORDER_WRITE = 'order:write',
  ORDER_MANAGE = 'order:manage',

  // Faz 4 — Kurye / Teslimat
  DELIVERY_READ = 'delivery:read',
  DELIVERY_CLAIM = 'delivery:claim',
  DELIVERY_MANAGE = 'delivery:manage',

  // Finans — sadece Süper Admin
  FINANCE_READ = 'finance:read',

  // Dikey bazlı P&L raporu. FINANCE_READ'den AYRI tutuluyor: o izin /superadmin
  // controller'ının tamamını da açıyor ve Süper Admin'e özel kalmalı. Rapor ise
  // ADMIN'in (platform operatörü) işi — eskiden uç FINANCE_READ istediği için
  // gövdedeki "ADMIN da geçsin" kontrolü hiçbir zaman çalışmıyordu.
  FINANCE_REPORT_READ = 'finance:report:read',
}
