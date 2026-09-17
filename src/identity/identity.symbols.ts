/**
 * Symbols de injeção do módulo `identity`.
 *
 * `RequireAuthenticationSymbol` e `RequireProfileSymbol` **não** estão aqui: o
 * contrato dos dois é da plataforma, para que outros módulos os injetem sem
 * importar este (ADR-0003, regra 2).
 */
export const TokenVerifierSymbol = Symbol.for('TokenVerifier');
export const UserProvisioningServiceSymbol = Symbol.for('UserProvisioningService');
export const UserServiceSymbol = Symbol.for('UserService');
export const UserControllerSymbol = Symbol.for('UserController');
export const UserRoutesSymbol = Symbol.for('UserRoutes');
