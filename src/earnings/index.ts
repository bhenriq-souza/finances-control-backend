/**
 * Interface pública do módulo `earnings`. Outros módulos importam daqui — nunca
 * de caminho interno (ADR-0003, regra 1; gate `boundaries`).
 */
export { EARNING_KINDS, type EarningKind } from './earning-kind';
export { EARNING_STATUSES, type EarningStatus } from './earning-status';
export { Earning } from './earning.entity';
export { EarningType } from './earning-type.entity';
export { EarningTypeService } from './earning-type.service';
export { EarningTypeController } from './earning-type.controller';
export { EarningTypeRoutes } from './earning-type.routes';
export { toEarningTypeResponse, type EarningTypeResponse } from './earning-type.response';
export * from './earnings.symbols';
export { EarningService } from './earning.service';
export { EarningController } from './earning.controller';
export { EarningRoutes } from './earning.routes';
export { toEarningResponse, type EarningResponse } from './earning.response';
