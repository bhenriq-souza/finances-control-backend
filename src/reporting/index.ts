/**
 * Interface pública do módulo `reporting` (somente leitura). Nenhum outro módulo
 * o importa (ADR-0003, regra 5).
 */
export { COMPOSITION } from './composition';
export { RealizedBalanceService } from './realized-balance.service';
export { ByTypeReportService } from './by-type.service';
export { ReportController } from './report.controller';
export { ReportRoutes } from './report.routes';
export {
    ByTypeReportServiceSymbol,
    RealizedBalanceServiceSymbol,
    ReportControllerSymbol,
    ReportRoutesSymbol,
} from './reporting.symbols';
