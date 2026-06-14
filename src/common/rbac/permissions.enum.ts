export enum Permission {
  // Faz 1
  USER_READ = 'user:read',
  USER_WRITE = 'user:write',
  USER_ROLE_ASSIGN = 'user:role:assign',
  USER_SUSPEND = 'user:suspend',
  ADDRESS_READ = 'address:read',
  ADDRESS_WRITE = 'address:write',
  WALLET_READ = 'wallet:read',
  WALLET_TOPUP = 'wallet:topup',
  WALLET_WITHDRAW = 'wallet:withdraw',
  TRANSACTION_READ = 'transaction:read',
  TRANSACTION_REVERSE = 'transaction:reverse',
  AUDIT_READ = 'audit:read',

  // Faz 2 — Market / Katalog
  STORE_READ = 'store:read',
  STORE_WRITE = 'store:write',
  STORE_MANAGE_ALL = 'store:manage:all',
  PRODUCT_READ = 'product:read',
  PRODUCT_WRITE = 'product:write',
  CATEGORY_WRITE = 'category:write',

  // Faz 3 — Sipariş / Ödeme
  ORDER_READ = 'order:read',
  ORDER_WRITE = 'order:write',
  ORDER_MANAGE = 'order:manage',
}
