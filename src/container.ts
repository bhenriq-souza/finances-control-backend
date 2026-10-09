import 'reflect-metadata';
import { container, instanceCachingFactory } from 'tsyringe';
import type { RequestHandler } from 'express';

import { EnvService } from '@bhs-dev/typescript-common-env';

import {
    FirebaseTokenVerifier,
    TokenVerifierSymbol,
    UserProvisioningServiceSymbol,
    createAuthenticationMiddleware,
    createRequireProfile,
    UserProvisioningService,
    type TokenVerifier,
} from './identity';
import { StatementPeriodGuardSymbol } from './expenses';
import { StatementPeriodGuardService } from './statements';
import { envList } from './platform/config/env.list';
import { AppDataSource } from './platform/database/data-source';
import { RequestContext } from './platform/context/request-context';
import { HttpResponses } from './platform/http/http-responses';
import { InProcessDomainEventDispatcher } from './platform/events/in-process-domain-event-dispatcher';
import { DataSourceTransactionRunner } from './platform/events/transaction-runner';
import { PgBossJobQueue } from './platform/jobs/pg-boss-job-queue';
import { LoggerService } from './platform/logging/logger.service';
import {
    DatabaseConnectionSymbol,
    DomainEventDispatcherSymbol,
    EnvListSymbol,
    JobQueueSymbol,
    RequireAuthenticationSymbol,
    RequireProfileSymbol,
    EnvServiceSymbol,
    HttpResponsesSymbol,
    LoggerServiceSymbol,
    ProcessEnvSymbol,
    RequestContextSymbol,
    TransactionRunnerSymbol,
} from './platform/symbols';

/* ambiente — resolvido primeiro: o boot falha aqui se faltar variável obrigatória */
container.register(EnvListSymbol, { useValue: envList });
container.registerInstance(ProcessEnvSymbol, process.env);
container.registerSingleton(EnvServiceSymbol, EnvService);

/* persistência — uma conexão por processo, resolvida por injeção (INV-0003-01) */
container.registerInstance(DatabaseConnectionSymbol, AppDataSource);

/* observabilidade */
container.registerSingleton(LoggerServiceSymbol, LoggerService);
container.registerSingleton(RequestContextSymbol, RequestContext);

/* eventos de domínio — dispatcher e runner são singletons (spec 0004, INV-0004-09) */
container.registerSingleton(DomainEventDispatcherSymbol, InProcessDomainEventDispatcher);
container.registerSingleton(TransactionRunnerSymbol, DataSourceTransactionRunner);

/* jobs — worker no mesmo processo; só `platform/jobs` conhece o pg-boss (spec 0017) */
container.registerSingleton(JobQueueSymbol, PgBossJobQueue);

/* janela fechada — `statements` implementa a porta que `expenses` declara (spec 0013) */
container.registerSingleton(StatementPeriodGuardSymbol, StatementPeriodGuardService);

/* helpers de resposta */
container.register(HttpResponsesSymbol, { useValue: HttpResponses });

/* identidade — quem chama e o que pode (spec 0010) */
container.registerSingleton(TokenVerifierSymbol, FirebaseTokenVerifier);
container.registerSingleton(UserProvisioningServiceSymbol, UserProvisioningService);

container.register(RequireAuthenticationSymbol, {
    useFactory: instanceCachingFactory<RequestHandler>((c) =>
        createAuthenticationMiddleware({
            tokenVerifier: c.resolve<TokenVerifier>(TokenVerifierSymbol),
            provisioning: c.resolve<UserProvisioningService>(UserProvisioningServiceSymbol),
            requestContext: c.resolve<RequestContext>(RequestContextSymbol),
            logger: c.resolve<LoggerService>(LoggerServiceSymbol),
        }),
    ),
});

container.register(RequireProfileSymbol, {
    useFactory: instanceCachingFactory((c) =>
        createRequireProfile(c.resolve<RequestContext>(RequestContextSymbol)),
    ),
});

export { container };
