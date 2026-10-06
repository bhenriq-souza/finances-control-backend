export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/**
 * Envelope de um evento de domínio. `occurredAt` e `correlationId` são
 * preenchidos pelo escopo de transação no `publish`, nunca pelo módulo.
 * O payload é JSON: só identificadores e escalares (INV-0004-06).
 */
export type DomainEvent<TName extends string = string, TPayload extends JsonObject = JsonObject> = {
    readonly name: TName;
    readonly occurredAt: Date;
    readonly correlationId: string | null;
    readonly payload: TPayload;
};
