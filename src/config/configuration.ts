export default () => ({
  api: { port: parseInt(process.env.API_PORT ?? '4000', 10) },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '180d',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh',
    refreshTtlDays: parseInt(process.env.JWT_REFRESH_TTL_DAYS ?? '180', 10),
  },
  otp: {
    ttlSeconds: parseInt(process.env.OTP_TTL_SECONDS ?? '180', 10),
    length: parseInt(process.env.OTP_LENGTH ?? '6', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS ?? '5', 10),
    resendCooldownSeconds: parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS ?? '60', 10),
  },
  sms: { provider: process.env.SMS_PROVIDER ?? 'console' },
});
