/**
 * Interface pública da plataforma. Módulos de domínio importam daqui —
 * nunca de caminhos internos (ADR-0003, regra 1; gate `boundaries`).
 */
export { BaseRoute } from './http/base.route';
export { HttpResponses, type HttpResponsesType, type ErrorPayload } from './http/http-responses';
export { RequestContext, type RequestStore } from './context/request-context';
export { LoggerService } from './logging/logger.service';
export { registerApiModules, type ApiModule, type ApiProvider } from './api/register-api-modules';
export { sortMiddlewares, type MiddlewareEntry } from './config/middlewares.config';
export { envList } from './config/env.list';
export { apiModules } from './config/api.config';
export { CORRELATION_ID_HEADER } from './middlewares/correlation-id.middleware';
export * from './symbols';
