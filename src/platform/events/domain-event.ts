export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/**
 * Envelope de um evento de domínio. `occurredAt` e `correlationId` são
 * preenchidos pelo escopo de transação no `publish`, nunca pelo módulo.
 * O payload é JSON: só identificadores e escalares (INV-0004-06).
 *
 * `workspaceId` é o espaço do registro que gerou o evento, preenchido por quem
 * publica a partir da linha, nunca do contexto; o handler usa este, e não o da
 * requisição (spec 0021, INV-0021-06). Nulo só para evento que não é de espaço.
 */
export type DomainEvent<TName extends string = string, TPayload extends JsonObject = JsonObject> = {
    readonly name: TName;
    readonly occurredAt: Date;
    readonly correlationId: string | null;
    readonly workspaceId: string | null;
    readonly payload: TPayload;
};
