import { v2 as cloudinary } from 'cloudinary';

// src/load/cloudinary.util.ts'ten TASINDI. Icerigi degismedi: klasor zaten
// parametreydi, kimlik bilgileri ortam degiskeninden okunuyordu - Load'a ozgu
// tek bir sabit yoktu, parametrelestirilecek bir sey cikmadi.
//
// Tasima ZORUNLUYDU, tercih degil: scripts/check-boundaries.js'te "load" izole
// bir birim, "market" ise ticaret kumesinde. market'in ../load/... import etmesi
// dogrudan birim siniri ihlalidir ve CI'da kirmizi verirdi. Cekirdek
// (src/common) her birim tarafindan tuketilebilir; dogru yer burasi.

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export function cloudinaryUpload(buffer: Buffer, klasor: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: klasor, resource_type: 'auto' },
      (error, result) => {
        if (error) return reject(error);
        if (!result) return reject(new Error('Yükleme başarısız'));
        resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}