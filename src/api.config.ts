import { ScopeTypes } from '@bhs-dev/typescript-common-types';

import type { ApiModule } from './platform/api/register-api-modules';
import { HealthController } from './platform/health/health.controller';
import { HealthRoutes } from './platform/health/health.routes';
import { HealthService } from './platform/health/health.service';
import {
    HealthControllerSymbol,
    HealthRoutesSymbol,
    HealthServiceSymbol,
} from './platform/symbols';
import {
    BankAccountController,
    BankAccountControllerSymbol,
    BankAccountRoutes,
    BankAccountRoutesSymbol,
    BankAccountService,
    BankAccountServiceSymbol,
    BankController,
    CreditCardController,
    CreditCardControllerSymbol,
    CreditCardRoutes,
    CreditCardRoutesSymbol,
    CreditCardService,
    CreditCardServiceSymbol,
    BankControllerSymbol,
    BankRoutes,
    BankRoutesSymbol,
    BankService,
    BankServiceSymbol,
    BankTransferController,
    BankTransferControllerSymbol,
    BankTransferRoutes,
    BankTransferRoutesSymbol,
    BankTransferService,
    BankTransferServiceSymbol,
} from './accounts';
import {
    UserController,
    UserControllerSymbol,
    UserRoutes,
    UserRoutesSymbol,
    UserService,
    UserServiceSymbol,
} from './identity';
import {
    ExpenseController,
    ExpenseControllerSymbol,
    ExpenseRecurrenceController,
    ExpenseRecurrenceControllerSymbol,
    ExpenseRecurrenceRoutes,
    ExpenseRecurrenceRoutesSymbol,
    ExpenseJobs,
    ExpenseJobsSymbol,
    ExpenseRoutes,
    ExpenseRoutesSymbol,
    ExpenseRecurrenceService,
    ExpenseRecurrenceServiceSymbol,
    ExpenseService,
    ExpenseServiceSymbol,
    ExpenseTypeController,
    ExpenseTypeControllerSymbol,
    ExpenseTypeRoutes,
    ExpenseTypeRoutesSymbol,
    ExpenseTypeService,
    ExpenseTypeServiceSymbol,
} from './expenses';
import {
    EarningTypeController,
    EarningTypeControllerSymbol,
    EarningTypeRoutes,
    EarningTypeRoutesSymbol,
    EarningTypeService,
    EarningTypeServiceSymbol,
    EarningController,
    EarningControllerSymbol,
    EarningJobs,
    EarningJobsSymbol,
    EarningRoutes,
    EarningRoutesSymbol,
    EarningRecurrenceController,
    EarningRecurrenceControllerSymbol,
    EarningRecurrenceRoutes,
    EarningRecurrenceRoutesSymbol,
    EarningRecurrenceService,
    EarningRecurrenceServiceSymbol,
    EarningService,
    EarningServiceSymbol,
} from './earnings';
import {
    CreditCardRefundController,
    CreditCardRefundControllerSymbol,
    CreditCardRefundRoutes,
    CreditCardRefundRoutesSymbol,
    CreditCardRefundService,
    CreditCardRefundServiceSymbol,
    StatementController,
    StatementControllerSymbol,
    StatementJobs,
    StatementJobsSymbol,
    StatementRoutes,
    StatementRoutesSymbol,
    StatementService,
} from './statements';
import {
    BalanceReportService,
    BalanceReportServiceSymbol,
    ByTypeReportService,
    ByTypeReportServiceSymbol,
    CardDebtService,
    CardDebtServiceSymbol,
    CashFlowReportService,
    CashFlowReportServiceSymbol,
    ForecastBalanceService,
    ForecastBalanceServiceSymbol,
    RealizedBalanceService,
    RealizedBalanceServiceSymbol,
    ReportController,
    ReportControllerSymbol,
    ReportRoutes,
    ReportRoutesSymbol,
} from './reporting';

/**
 * Módulos publicados pela API. Cada módulo de domínio (ADR-0003) entra aqui com
 * seu prefixo e suas dependências.
 *
 * Esta lista vive na raiz de `src/`, e não em `platform/`, porque é composição:
 * ela precisa conhecer os módulos de domínio, e `platform` não pode conhecê-los
 * (ADR-0003, regra verificada pelo gate `boundaries`).
 */
export const apiModules: ApiModule[] = [
    {
        path: '/health',
        route: { token: HealthRoutesSymbol, clazz: HealthRoutes },
        provides: [
            { token: HealthServiceSymbol, clazz: HealthService, scope: ScopeTypes.SINGLETON },
            { token: HealthControllerSymbol, clazz: HealthController, scope: ScopeTypes.SINGLETON },
        ],
    },
    {
        path: '/users',
        route: { token: UserRoutesSymbol, clazz: UserRoutes },
        provides: [
            { token: UserServiceSymbol, clazz: UserService, scope: ScopeTypes.SINGLETON },
            { token: UserControllerSymbol, clazz: UserController, scope: ScopeTypes.SINGLETON },
        ],
    },
    {
        path: '/banks',
        route: { token: BankRoutesSymbol, clazz: BankRoutes },
        provides: [
            { token: BankServiceSymbol, clazz: BankService, scope: ScopeTypes.SINGLETON },
            { token: BankControllerSymbol, clazz: BankController, scope: ScopeTypes.SINGLETON },
        ],
    },
    {
        path: '/bank-accounts',
        route: { token: BankAccountRoutesSymbol, clazz: BankAccountRoutes },
        provides: [
            {
                token: BankAccountServiceSymbol,
                clazz: BankAccountService,
                scope: ScopeTypes.SINGLETON,
            },
            {
                token: BankAccountControllerSymbol,
                clazz: BankAccountController,
                scope: ScopeTypes.SINGLETON,
            },
        ],
    },
    {
        path: '/credit-cards',
        route: { token: CreditCardRoutesSymbol, clazz: CreditCardRoutes },
        provides: [
            {
                token: CreditCardServiceSymbol,
                clazz: CreditCardService,
                scope: ScopeTypes.SINGLETON,
            },
            {
                token: CreditCardControllerSymbol,
                clazz: CreditCardController,
                scope: ScopeTypes.SINGLETON,
            },
        ],
    },
    {
        path: '/expense-types',
        route: { token: ExpenseTypeRoutesSymbol, clazz: ExpenseTypeRoutes },
        provides: [
            {
                token: ExpenseTypeServiceSymbol,
                clazz: ExpenseTypeService,
                scope: ScopeTypes.SINGLETON,
            },
            {
                token: ExpenseTypeControllerSymbol,
                clazz: ExpenseTypeController,
                scope: ScopeTypes.SINGLETON,
            },
        ],
    },
    {
        path: '/earning-types',
        route: { token: EarningTypeRoutesSymbol, clazz: EarningTypeRoutes },
        provides: [
            {
                token: EarningTypeServiceSymbol,
                clazz: EarningTypeService,
                scope: ScopeTypes.SINGLETON,
            },
            {
                token: EarningTypeControllerSymbol,
                clazz: EarningTypeController,
                scope: ScopeTypes.SINGLETON,
            },
        ],
    },
    {
        path: '/expenses',
        route: { token: ExpenseRoutesSymbol, clazz: ExpenseRoutes },
        provides: [
            { token: ExpenseServiceSymbol, clazz: ExpenseService, scope: ScopeTypes.SINGLETON },
            {
                token: ExpenseRecurrenceServiceSymbol,
                clazz: ExpenseRecurrenceService,
                scope: ScopeTypes.SINGLETON,
            },
            {
                token: ExpenseControllerSymbol,
                clazz: ExpenseController,
                scope: ScopeTypes.SINGLETON,
            },
        ],
        jobs: [{ token: ExpenseJobsSymbol, clazz: ExpenseJobs }],
    },
    {
        path: '/expense-recurrences',
        route: { token: ExpenseRecurrenceRoutesSymbol, clazz: ExpenseRecurrenceRoutes },
        provides: [
            {
                token: ExpenseRecurrenceControllerSymbol,
                clazz: ExpenseRecurrenceController,
                scope: ScopeTypes.SINGLETON,
            },
        ],
    },
    {
        path: '/earnings',
        route: { token: EarningRoutesSymbol, clazz: EarningRoutes },
        provides: [
            { token: EarningServiceSymbol, clazz: EarningService, scope: ScopeTypes.SINGLETON },
            {
                token: EarningRecurrenceServiceSymbol,
                clazz: EarningRecurrenceService,
                scope: ScopeTypes.SINGLETON,
            },
            {
                token: EarningControllerSymbol,
                clazz: EarningController,
                scope: ScopeTypes.SINGLETON,
            },
        ],
        jobs: [{ token: EarningJobsSymbol, clazz: EarningJobs }],
    },
    {
        path: '/earning-recurrences',
        route: { token: EarningRecurrenceRoutesSymbol, clazz: EarningRecurrenceRoutes },
        provides: [
            {
                token: EarningRecurrenceControllerSymbol,
                clazz: EarningRecurrenceController,
                scope: ScopeTypes.SINGLETON,
            },
        ],
    },
    {
        path: '/statements',
        route: { token: StatementRoutesSymbol, clazz: StatementRoutes },
        provides: [
            { token: StatementService, clazz: StatementService, scope: ScopeTypes.SINGLETON },
            {
                token: StatementControllerSymbol,
                clazz: StatementController,
                scope: ScopeTypes.SINGLETON,
            },
        ],
        jobs: [{ token: StatementJobsSymbol, clazz: StatementJobs }],
    },
    {
        path: '/bank-transfers',
        route: { token: BankTransferRoutesSymbol, clazz: BankTransferRoutes },
        provides: [
            {
                token: BankTransferServiceSymbol,
                clazz: BankTransferService,
                scope: ScopeTypes.SINGLETON,
            },
            {
                token: BankTransferControllerSymbol,
                clazz: BankTransferController,
                scope: ScopeTypes.SINGLETON,
            },
        ],
    },
    {
        path: '/credit-card-refunds',
        route: { token: CreditCardRefundRoutesSymbol, clazz: CreditCardRefundRoutes },
        provides: [
            {
                token: CreditCardRefundServiceSymbol,
                clazz: CreditCardRefundService,
                scope: ScopeTypes.SINGLETON,
            },
            {
                token: CreditCardRefundControllerSymbol,
                clazz: CreditCardRefundController,
                scope: ScopeTypes.SINGLETON,
            },
        ],
    },
    {
        path: '/reports',
        route: { token: ReportRoutesSymbol, clazz: ReportRoutes },
        provides: [
            {
                token: RealizedBalanceServiceSymbol,
                clazz: RealizedBalanceService,
                scope: ScopeTypes.SINGLETON,
            },
            {
                token: ByTypeReportServiceSymbol,
                clazz: ByTypeReportService,
                scope: ScopeTypes.SINGLETON,
            },
            {
                token: ForecastBalanceServiceSymbol,
                clazz: ForecastBalanceService,
                scope: ScopeTypes.SINGLETON,
            },
            {
                token: CardDebtServiceSymbol,
                clazz: CardDebtService,
                scope: ScopeTypes.SINGLETON,
            },
            {
                token: BalanceReportServiceSymbol,
                clazz: BalanceReportService,
                scope: ScopeTypes.SINGLETON,
            },
            {
                token: CashFlowReportServiceSymbol,
                clazz: CashFlowReportService,
                scope: ScopeTypes.SINGLETON,
            },
            {
                token: ReportControllerSymbol,
                clazz: ReportController,
                scope: ScopeTypes.SINGLETON,
            },
        ],
    },
];
