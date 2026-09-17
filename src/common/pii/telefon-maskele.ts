/**
 * TELEFON MASKELEME — log satirlarina tam numara yazilmasin diye.
 *
 * Yalnizca rakamlar sayilir: ilk 2 (ulke kodu) ve son 2 hane gorunur, aradaki
 * her hane '*' olur. "+905550001122" -> "+90********22". Boylece destek
 * tarafinda "hangi hat" sorusu kabaca cevaplanabilir ama numara geri
 * kurulamaz. 5 haneden kisa girdilerde hicbir hane gosterilmez.
 */
export function telefonMaskele(telefon: string | null | undefined): string {
  const rakamlar = (telefon ?? '').replace(/\D/g, '');
  if (rakamlar.length < 5) return '*'.repeat(rakamlar.length) || '[bos]';
  const onEk = (telefon ?? '').trim().startsWith('+') ? '+' : '';
  return onEk + rakamlar.slice(0, 2) + '*'.repeat(rakamlar.length - 4) + rakamlar.slice(-2);
}
