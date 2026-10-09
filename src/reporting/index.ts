/**
 * Interface pública do módulo `reporting` (somente leitura). Nenhum outro módulo
 * o importa (ADR-0003, regra 5).
 */
export { COMPOSITION } from './composition';
export { RealizedBalanceService } from './realized-balance.service';
export { RealizedBalanceServiceSymbol } from './reporting.symbols';
