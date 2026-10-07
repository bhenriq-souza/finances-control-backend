/**
 * Catálogo de eventos de domínio (spec 0004, ADR local 0002).
 *
 * Contrato: cada módulo declara os eventos que publica em `src/events/<módulo>.events.ts`
 * (constante com o nome e tipo `DomainEvent<...>`) e os reexporta daqui, único caminho de import.
 * Só tipos e constantes; importa apenas de `src/platform`; nunca de módulo de domínio, e
 * `src/platform` nunca importa daqui (gate `boundaries`). Um módulo publica só os eventos do seu
 * próprio arquivo; qualquer módulo pode consumir.
 *
 * Os arquivos por módulo nascem com as specs que publicam eventos (ex.: 0012).
 */
export * from './expenses.events';
export * from './earnings.events';
