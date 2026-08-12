export function slugify(input: string): string {
  const map: Record<string, string> = {
    ç: 'c', Ç: 'c', ğ: 'g', Ğ: 'g', ı: 'i', İ: 'i', ö: 'o', Ö: 'o',
    ş: 's', Ş: 's', ü: 'u', Ü: 'u',
  };
  const govde = input
    .split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .toLowerCase()
    // Dogrusal: tek karakter sinifi + tek nicelik belirteci, geri izleme yok.
    .replace(/[^a-z0-9]+/g, '-');

  // Bas/son tire kirpma REGEX ILE YAPILMIYOR.
  //
  // Eski hali `.replace(/^-+|-+$/g, '')` idi ve bu desen polinomsal (O(n^2)):
  // `-+$` dizenin BASINA bagli degil, bu yuzden motor her konumdan basliyor,
  // tireleri aclikla yutup `$` icin tek tek geri iziliyor. Yerelde olculdu -
  // "a" + "-"*n + "x" girdisiyle n iki katina ciktikca sure ~4x artiyor:
  // n=2.000 -> 1,8ms · n=8.000 -> 28,9ms · n=32.000 -> 435,1ms.
  //
  // Bu kod yolunda SOMURULEBILIR DEGILDI: yukaridaki replace her non-alfanumerik
  // DIZISINI tek tireye indirdigi icin ara dizede asla "--" olusamiyor (200.000
  // rastgele girdilik fuzz'da sifir ornek), dolayisiyla `-+` en fazla 1 karakter
  // esliyordu ve slugify butun olarak dogrusal kaliyordu. Ayrica cagiranlarin
  // hepsi DTO'da @MaxLength(100/120/160) ile sinirli.
  //
  // Yine de degistiriliyor: guvenlik iki dolayli kosula yaslanmamali. Birisi iki
  // replace'in sirasini degistirse ya da bu deseni baska yerde kullansa acik
  // gercege donusurdu. JavaScript'te atomic group / possessive quantifier YOK,
  // o yuzden dogru cozum regex'i tamamen birakmak.
  let bas = 0;
  let son = govde.length;
  while (bas < son && govde.charCodeAt(bas) === 45) bas++; // 45 = '-'
  while (son > bas && govde.charCodeAt(son - 1) === 45) son--;

  return govde.slice(bas, son).slice(0, 80);
}

export function randomSuffix(len = 4): string {
  return Math.random().toString(36).slice(2, 2 + len);
}
