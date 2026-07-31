import { SetMetadata } from '@nestjs/common';

// Bilerek herkese acik uc isaretcisi. Global JWT guard olmadigindan davranissal etkisi yoktur;
// CI guard-denetimi (scripts/check-guards.js) bu uclari "korumasiz" saymaz.
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
