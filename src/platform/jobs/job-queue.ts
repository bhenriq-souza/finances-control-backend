import type { JsonObject } from '../events/domain-event';

/** O que o handler recebe: `attempt` começa em 1 (a primeira tentativa). */
export type JobHandler<TPayload extends JsonObject = JsonObject> = (job: {
    id: string;
    name: string;
    payload: TPayload;
    attempt: number;
}) => Promise<void>;

/**
 * Porta de jobs (spec 0017). Módulos dependem desta interface e do
 * `JobQueueSymbol`, nunca do `pg-boss` (INV-0017-03).
 */
export interface JobQueue {
    register<TPayload extends JsonObject>(name: string, handler: JobHandler<TPayload>): void;
    /** Expressão cron no fuso `BUSINESS_TIME_ZONE`; agendar o mesmo nome substitui o agendamento. */
    schedule(name: string, cron: string): void;
    /** Com `singletonKey`, não enfileira um segundo job da mesma chave enquanto o primeiro não terminou. */
    enqueue<TPayload extends JsonObject>(
        name: string,
        payload: TPayload,
        options?: { singletonKey?: string },
    ): Promise<string>;
}

/**
 * Contrato que um módulo exporta na sua interface pública para registrar os seus jobs e
 * agendamentos; é declarado em `jobs` de `ApiModule` e chamado uma vez (spec 0017).
 */
export interface JobRegistrar {
    register(queue: JobQueue): void;
}

/** `up`: iniciado; `down`: falhou ao iniciar, ainda não iniciou ou parou; `disabled`: `JOBS_ENABLED=false`. */
export type JobsStatus = 'up' | 'down' | 'disabled';

/** Ciclo de vida do worker, usado pelo boot e pelo readiness — fora da porta usada pelos módulos. */
export interface JobsLifecycle {
    start(): Promise<void>;
    stop(): Promise<void>;
    getStatus(): JobsStatus;
}

/** `<módulo>.<ação-em-kebab-case>`, como `expenses.mark-overdue`. */
export const JOB_NAME_PATTERN = /^[a-z][a-z0-9]*\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
