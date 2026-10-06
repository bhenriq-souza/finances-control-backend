/**
 * Interface pública do módulo `earnings`. Outros módulos importam daqui — nunca
 * de caminho interno (ADR-0003, regra 1; gate `boundaries`).
 */
export { EARNING_KINDS, type EarningKind } from './earning-kind';
export { EARNING_STATUSES, type EarningStatus } from './earning-status';
export { Earning } from './earning.entity';
export { EarningType } from './earning-type.entity';
