/**
 * Interface pública do módulo `reporting` (somente leitura). Nenhum outro módulo
 * o importa (ADR-0003, regra 5).
 */
export { COMPOSITION } from './composition';
export { RealizedBalanceService } from './realized-balance.service';
export { ByTypeReportService } from './by-type.service';
export { ForecastBalanceService } from './forecast-balance.service';
export { CardDebtService } from './card-debt.service';
export { BalanceReportService } from './balance-report.service';
export { CashFlowReportService } from './cash-flow.service';
export { ReportController } from './report.controller';
export { ReportRoutes } from './report.routes';
export {
    BalanceReportServiceSymbol,
    ByTypeReportServiceSymbol,
    CardDebtServiceSymbol,
    CashFlowReportServiceSymbol,
    ForecastBalanceServiceSymbol,
    RealizedBalanceServiceSymbol,
    ReportControllerSymbol,
    ReportRoutesSymbol,
} from './reporting.symbols';
