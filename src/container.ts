import 'reflect-metadata';
import { container } from 'tsyringe';

import { EnvService } from '@bhs-dev/typescript-common-env';

import { envList } from './platform/config/env.list';
import { RequestContext } from './platform/context/request-context';
import { HttpResponses } from './platform/http/http-responses';
import { LoggerService } from './platform/logging/logger.service';
import {
    EnvListSymbol,
    EnvServiceSymbol,
    HttpResponsesSymbol,
    LoggerServiceSymbol,
    ProcessEnvSymbol,
    RequestContextSymbol,
} from './platform/symbols';

/* ambiente — resolvido primeiro: o boot falha aqui se faltar variável obrigatória */
container.register(EnvListSymbol, { useValue: envList });
container.registerInstance(ProcessEnvSymbol, process.env);
container.registerSingleton(EnvServiceSymbol, EnvService);

/* observabilidade */
container.registerSingleton(LoggerServiceSymbol, LoggerService);
container.registerSingleton(RequestContextSymbol, RequestContext);

/* helpers de resposta */
container.register(HttpResponsesSymbol, { useValue: HttpResponses });

export { container };
