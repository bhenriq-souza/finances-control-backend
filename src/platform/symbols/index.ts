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

/**
 * Autorização: o contrato é da plataforma, a implementação é do `identity`
 * (spec 0010). Assim qualquer módulo de domínio protege suas rotas sem importar
 * outro módulo — o que o ADR-0003, regra 2, proíbe.
 */
export const RequireAuthenticationSymbol = Symbol.for('RequireAuthentication');
export const RequireProfileSymbol = Symbol.for('RequireProfile');

export const DatabaseConnectionSymbol = Symbol.for('DatabaseConnection');
export const HealthServiceSymbol = Symbol.for('HealthService');
export const HealthControllerSymbol = Symbol.for('HealthController');
export const HealthRoutesSymbol = Symbol.for('HealthRoutes');
