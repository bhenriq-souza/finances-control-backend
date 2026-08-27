/**
 * Symbols de injeção de dependência.
 *
 * Os transversais vêm de `@bhs-dev/typescript-common-types` e são reexportados
 * aqui para que o resto do código importe de um lugar só.
 */
export {
    EnvListSymbol,
    EnvServiceSymbol,
    HttpResponsesSymbol,
    LoggerServiceSymbol,
    ProcessEnvSymbol,
    RequestContextSymbol,
} from '@bhs-dev/typescript-common-types';

/** Symbols próprios da plataforma. */
export const HealthServiceSymbol = Symbol.for('HealthService');
export const HealthControllerSymbol = Symbol.for('HealthController');
export const HealthRoutesSymbol = Symbol.for('HealthRoutes');
