export enum Permission {
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
}
