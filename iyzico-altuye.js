const Iyzipay = require("iyzipay");
const iyzipay = new Iyzipay({ apiKey: "sandbox-lCrZ6fjx5q1XSeWVD45HGgQwmrkU122N", secretKey: "sandbox-ikefGvEYHZaqjmo09n491Pgbma4F7GqF", uri: "https://sandbox-api.iyzipay.com" });
const istek = {
  locale: Iyzipay.LOCALE.TR,
  conversationId: "altuye-001",
  subMerchantExternalId: "bani-satici-test-001",
  subMerchantType: Iyzipay.SUB_MERCHANT_TYPE.PRIVATE_COMPANY,
  address: "Tece Mah. Test Sok. No:1 Mezitli Mersin",
  taxOffice: "Mersin VD",
  legalCompanyTitle: "Bani Test Sahis Isletmesi",
  email: "test-satici@banigroup.com.tr",
  gsmNumber: "+905350000000",
  name: "Bani Test Saticisi",
  iban: "TR180006200119000006672315",
  identityNumber: "11111111111",
  currency: Iyzipay.CURRENCY.TRY
};
iyzipay.subMerchant.create(istek, function (err, result) {
  if (err) { console.error("HATA:", err); return; }
  if (result.status === "success") { console.log("=== ALT UYE KAYDI BASARILI ==="); console.log("subMerchantKey:", result.subMerchantKey); }
  else { console.log("Basarisiz:", result.errorCode, result.errorMessage); }
});