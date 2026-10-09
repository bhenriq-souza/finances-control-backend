import { randomUUID } from 'node:crypto';

import { inject, injectable } from 'tsyringe';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import { In, type EntityManager, type FindOptionsWhere } from 'typeorm';
import { ZodError } from 'zod';

import {
    BankAccountServiceSymbol,
    CreditCardServiceSymbol,
    type BankAccountService,
    type CreditCardService,
} from '../accounts';
import { EXPENSE_CREATED, EXPENSE_PAID, type ExpenseCreated } from '../events';
import {
    TransactionRunnerSymbol,
    businessToday,
    monthlyInstallmentDates,
    splitCents,
    type TransactionRunner,
} from '../platform';
import { ExpenseType } from './expense-type.entity';
import { Expense } from './expense.entity';
import type { CardExpenseSummary } from './card-expense-summary';
import type { ExpenseStatus } from './expense-status';
import { StatementPeriodGuardSymbol, type StatementPeriodGuard } from './statement-period-guard';
import type {
    ChangeExpenseStatus,
    ChangePaymentMethod,
    CreateExpense,
    ListExpensesQuery,
    UpdateExpense,
} from './expense.schemas';

export type ExpenseWithType = Expense & { expenseType: ExpenseType };

/** Janela de `postedOn`, inclusiva nas duas pontas (spec 0013). */
export type PostingWindow = { from: Date; to: Date };

/** Transições aceitas por `PATCH /expenses/:id/status`; todo outro par é ERR-0012-08. */
const ALLOWED_TRANSITIONS: Record<string, readonly ExpenseStatus[]> = {
    FORECAST: ['OPEN'],
    OPEN: ['VERIFYING', 'PAID'],
    OVERDUE: ['VERIFYING', 'PAID'],
    VERIFYING: ['OPEN', 'PAID'],
    PAID: ['OPEN'],
};

const expenseNotFound = (): CustomError =>
    CustomError.notFound('Expense not found', 'EXPENSE_NOT_FOUND', { exposeMessage: true });

const alreadyPaid = (): CustomError =>
    new CustomError(
        409,
        'EXPENSE_ALREADY_PAID',
        'Paid expenses cannot change amount nor be deleted; undo the payment first',
        { exposeMessage: true },
    );

const DAY_MS = 24 * 60 * 60 * 1000;

/** The day after a `YYYY-MM-DD` date. */
const nextDay = (iso: string): string =>
    new Date(new Date(`${iso}T00:00:00.000Z`).getTime() + DAY_MS).toISOString().slice(0, 10);

/** ERR-0013-08: the write would change the total of a closed statement window. */
const statementClosed = (closedThrough: string): CustomError =>
    new CustomError(
        409,
        'STATEMENT_CLOSED',
        `The statement window is closed through ${closedThrough}`,
        { exposeMessage: true },
    );

/** Estados em que a despesa de cartão está abatida do limite (INV-0012-03). */
const LIMIT_CONSUMING: readonly ExpenseStatus[] = ['OPEN', 'OVERDUE', 'VERIFYING'];

@injectable()
export class ExpenseService {
    constructor(
        @inject(TransactionRunnerSymbol) private readonly runner: TransactionRunner,
        @inject(BankAccountServiceSymbol) private readonly bankAccounts: BankAccountService,
        @inject(CreditCardServiceSymbol) private readonly creditCards: CreditCardService,
        @inject(StatementPeriodGuardSymbol) private readonly guard: StatementPeriodGuard,
    ) {}

    /** Last closed day of the card as `YYYY-MM-DD` (spec 0013, A janela fechada). */
    private async closedThrough(manager: EntityManager, creditCardId: string): Promise<string> {
        return businessToday(await this.guard.closedThrough(manager, creditCardId));
    }

    /**
     * Cria uma despesa de uma linha (`FIXED`/`VARIABLE`) numa única transação: valida
     * tipo e conta/cartão, grava, abate o limite do cartão quando a despesa já é
     * compromisso e publica `ExpenseCreated` (INV-0012-03, INV-0012-04, AC-0012-19).
     * Saldo e limite nunca barram o lançamento (INV-0012-09).
     */
    create(data: CreateExpense): Promise<ExpenseWithType[]> {
        return this.runner.run(async (scope) => {
            const { manager } = scope;

            await this.assertTypeIsUsable(manager, data.expenseTypeId);
            await this.assertPaymentMethodIsUsable(data);

            let postedOn: string | null = null;

            if (data.creditCardId) {
                const closedThrough = await this.closedThrough(manager, data.creditCardId);

                if (data.postedOn !== undefined && data.postedOn <= closedThrough) {
                    throw statementClosed(closedThrough);
                }

                const earliestOpen = nextDay(closedThrough);

                postedOn =
                    data.postedOn ??
                    (data.occurredOn > earliestOpen ? data.occurredOn : earliestOpen);
            }

            // INSTALLMENT: `installmentTotal` linhas rateadas por `splitCents`, datas mensais com
            // o dia original preservado; a de cartão segue o `postedOn` da primeira (INV-0012-06).
            const isInstallment = data.kind === 'INSTALLMENT';
            const total = isInstallment ? (data.installmentTotal as number) : 1;
            const groupId = isInstallment ? randomUUID() : null;
            const amounts = splitCents(data.amountCents, total);
            const occurredDates = monthlyInstallmentDates(data.occurredOn, total);
            const postedDates = postedOn === null ? null : monthlyInstallmentDates(postedOn, total);

            const repository = manager.getRepository(Expense);
            const ids: string[] = [];

            for (let index = 0; index < total; index += 1) {
                const saved = await repository.save(
                    repository.create({
                        description: data.description,
                        expenseTypeId: data.expenseTypeId,
                        kind: data.kind,
                        status: data.status,
                        amountCents: amounts[index] as number,
                        occurredOn: occurredDates[index] as string,
                        paidOn: null,
                        bankAccountId: data.bankAccountId ?? null,
                        creditCardId: data.creditCardId ?? null,
                        postedOn: postedDates === null ? null : (postedDates[index] as string),
                        installmentGroupId: groupId,
                        installmentNumber: groupId === null ? null : index + 1,
                        installmentTotal: groupId === null ? null : total,
                        notes: data.notes ?? null,
                    }),
                );

                scope.publish({
                    name: EXPENSE_CREATED,
                    payload: {
                        expenseId: saved.id,
                        kind: saved.kind,
                        status: saved.status as ExpenseCreated['payload']['status'],
                        amountCents: saved.amountCents,
                        occurredOn: saved.occurredOn,
                        bankAccountId: saved.bankAccountId,
                        creditCardId: saved.creditCardId,
                        postedOn: saved.postedOn,
                        installmentGroupId: saved.installmentGroupId,
                    },
                });
                ids.push(saved.id);
            }

            // Conta: despesa aberta é compromisso, não saída; só cartão consome limite, e
            // consome o total de uma vez.
            if (data.creditCardId && data.status !== 'FORECAST') {
                await this.creditCards.applyAvailableLimitDelta(
                    manager,
                    data.creditCardId,
                    -data.amountCents,
                );
            }

            const loaded = await repository.find({
                where: { id: In(ids) },
                relations: { expenseType: true },
            });
            const byId = new Map(loaded.map((row) => [row.id, row]));

            return ids.map((id) => byId.get(id) as ExpenseWithType);
        });
    }

    /**
     * Aplica uma transição da máquina de status numa única transação (AC-0012-05,
     * AC-0012-12). Pagar ou desfazer move o saldo da conta e `paid_on` junto;
     * `FORECAST → OPEN` de cartão abate o limite. Despesa de cartão nunca é paga
     * por aqui (ERR-0012-09).
     */
    changeStatus(id: string, change: ChangeExpenseStatus): Promise<ExpenseWithType> {
        return this.runner.run(async (scope) => {
            const { manager } = scope;
            const repository = manager.getRepository(Expense);
            // FOR NO KEY UPDATE: serializa mudanças da mesma despesa sem conflitar com o
            // KEY SHARE que a FK de uma fatura toma sobre a linha.
            const expense = await repository.findOne({
                where: { id },
                lock: { mode: 'for_no_key_update' },
            });

            if (!expense) {
                throw CustomError.notFound('Expense not found', 'EXPENSE_NOT_FOUND', {
                    exposeMessage: true,
                });
            }

            const from = expense.status;
            const to = change.status;

            if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
                throw new CustomError(
                    409,
                    'EXPENSE_STATUS_TRANSITION_NOT_ALLOWED',
                    `Transition from ${from} to ${to} is not allowed`,
                    { exposeMessage: true },
                );
            }

            if (from === 'FORECAST' && to === 'OPEN' && expense.creditCardId) {
                const closedThrough = await this.closedThrough(manager, expense.creditCardId);

                if (expense.postedOn !== null && expense.postedOn <= closedThrough) {
                    throw statementClosed(closedThrough);
                }
            }

            const touchesPayment = to === 'PAID' || from === 'PAID';

            if (touchesPayment && expense.creditCardId) {
                throw new CustomError(
                    409,
                    'CREDIT_CARD_EXPENSE_PAID_BY_STATEMENT',
                    'Credit card expenses are paid through the statement',
                    { exposeMessage: true },
                );
            }

            if (to === 'PAID') {
                const paidOn = change.paidOn ?? businessToday();

                await this.bankAccounts.applyBalanceDelta(
                    manager,
                    expense.bankAccountId as string,
                    -expense.amountCents,
                );
                await repository.update({ id }, { status: 'PAID', paidOn });
                scope.publish({
                    name: EXPENSE_PAID,
                    payload: {
                        expenseId: id,
                        amountCents: expense.amountCents,
                        bankAccountId: expense.bankAccountId as string,
                        paidOn,
                    },
                });
            } else if (from === 'PAID') {
                await this.bankAccounts.applyBalanceDelta(
                    manager,
                    expense.bankAccountId as string,
                    expense.amountCents,
                );
                await repository.update({ id }, { status: 'OPEN', paidOn: null });
            } else {
                if (from === 'FORECAST' && expense.creditCardId) {
                    await this.creditCards.applyAvailableLimitDelta(
                        manager,
                        expense.creditCardId,
                        -expense.amountCents,
                    );
                }

                await repository.update({ id }, { status: to });
            }

            return (await repository.findOneOrFail({
                where: { id },
                relations: { expenseType: true },
            })) as ExpenseWithType;
        });
    }

    /** ERR-0012-02 para `:id` inexistente. */
    async findById(id: string): Promise<ExpenseWithType> {
        const expense = await this.runner.run((scope) =>
            scope.manager.getRepository(Expense).findOne({
                where: { id },
                relations: { expenseType: true },
            }),
        );

        if (!expense) throw expenseNotFound();

        return expense as ExpenseWithType;
    }

    /** AC-0012-16: filtros combinados por E; `from`/`to` inclusivos sobre `occurredOn`. */
    list(query: ListExpensesQuery = {}): Promise<ExpenseWithType[]> {
        return this.runner.run(async (scope) => {
            const qb = scope.manager
                .getRepository(Expense)
                .createQueryBuilder('e')
                .innerJoinAndSelect('e.expenseType', 't')
                .orderBy('e.occurredOn', 'ASC')
                .addOrderBy('e.createdAt', 'ASC')
                .addOrderBy('e.id', 'ASC');

            if (query.from !== undefined) qb.andWhere('e.occurredOn >= :from', query);
            if (query.to !== undefined) qb.andWhere('e.occurredOn <= :to', query);
            if (query.status !== undefined) qb.andWhere('e.status = :status', query);
            if (query.kind !== undefined) qb.andWhere('e.kind = :kind', query);
            if (query.expenseTypeId !== undefined) {
                qb.andWhere('e.expenseTypeId = :expenseTypeId', query);
            }
            if (query.bankAccountId !== undefined) {
                qb.andWhere('e.bankAccountId = :bankAccountId', query);
            }
            if (query.creditCardId !== undefined) {
                qb.andWhere('e.creditCardId = :creditCardId', query);
            }
            if (query.installmentGroupId !== undefined) {
                qb.andWhere('e.installmentGroupId = :installmentGroupId', query);
            }

            return (await qb.getMany()) as ExpenseWithType[];
        });
    }

    /**
     * Despesas de um cartão com `posted_on` na janela (inclusiva, em datas de negócio),
     * para a fatura; leitura. Ordem: `posted_on`, criação (spec 0013). Com `manager`, lê na
     * transação do chamador; sem ele, abre a própria.
     */
    async listByCreditCard(
        creditCardId: string,
        window: PostingWindow,
        manager?: EntityManager,
    ): Promise<CardExpenseSummary[]> {
        const from = businessToday(window.from);
        const to = businessToday(window.to);
        const read = async (em: EntityManager): Promise<CardExpenseSummary[]> => {
            const expenses = await em
                .getRepository(Expense)
                .createQueryBuilder('e')
                .innerJoinAndSelect('e.expenseType', 't')
                .where('e.creditCardId = :creditCardId', { creditCardId })
                .andWhere('e.postedOn >= :from', { from })
                .andWhere('e.postedOn <= :to', { to })
                .orderBy('e.postedOn', 'ASC')
                .addOrderBy('e.createdAt', 'ASC')
                .addOrderBy('e.id', 'ASC')
                .getMany();

            return expenses.map((expense) => ({
                id: expense.id,
                description: expense.description,
                occurredOn: expense.occurredOn,
                postedOn: expense.postedOn!,
                amountCents: expense.amountCents,
                status: expense.status,
                expenseType: { id: expense.expenseType!.id, name: expense.expenseType!.name },
                installment:
                    expense.installmentGroupId !== null &&
                    expense.installmentNumber !== null &&
                    expense.installmentTotal !== null
                        ? {
                              groupId: expense.installmentGroupId,
                              number: expense.installmentNumber,
                              total: expense.installmentTotal,
                          }
                        : null,
            }));
        };

        return manager ? read(manager) : this.runner.run((scope) => read(scope.manager));
    }

    /**
     * Altera uma despesa (a parcela, só ela). `amountCents` de despesa paga é recusado
     * (INV-0012-11); em cartão abatido do limite, move a diferença na mesma transação
     * (AC-0012-13). `postedOn` só existe em cartão (ERR-0012-17).
     */
    update(id: string, changes: UpdateExpense): Promise<ExpenseWithType> {
        return this.runner.run(async (scope) => {
            const { manager } = scope;
            const repository = manager.getRepository(Expense);
            const expense = await repository.findOne({
                where: { id },
                lock: { mode: 'for_no_key_update' },
            });

            if (!expense) throw expenseNotFound();

            if (changes.postedOn !== undefined && expense.creditCardId === null) {
                throw this.invalidPostedOn('postedOn is only allowed for credit card expenses');
            }

            if (changes.amountCents !== undefined && expense.status === 'PAID') {
                throw alreadyPaid();
            }

            if (
                changes.expenseTypeId !== undefined &&
                changes.expenseTypeId !== expense.expenseTypeId
            ) {
                await this.assertTypeIsUsable(manager, changes.expenseTypeId);
            }

            const closedThrough =
                expense.creditCardId !== null
                    ? await this.closedThrough(manager, expense.creditCardId)
                    : null;
            const inClosedWindow =
                closedThrough !== null &&
                expense.postedOn !== null &&
                expense.postedOn <= closedThrough;

            if (
                inClosedWindow &&
                ((changes.amountCents !== undefined &&
                    changes.amountCents !== expense.amountCents) ||
                    (changes.occurredOn !== undefined &&
                        changes.occurredOn !== expense.occurredOn) ||
                    (changes.postedOn !== undefined && changes.postedOn !== expense.postedOn))
            ) {
                throw statementClosed(closedThrough);
            }

            const occurredOn = changes.occurredOn ?? expense.occurredOn;
            const patch: Partial<Expense> = {};

            if (changes.description !== undefined) patch.description = changes.description;
            if (changes.expenseTypeId !== undefined) patch.expenseTypeId = changes.expenseTypeId;
            if (changes.occurredOn !== undefined) patch.occurredOn = changes.occurredOn;
            if (changes.amountCents !== undefined) patch.amountCents = changes.amountCents;
            if (changes.notes !== undefined) patch.notes = changes.notes;

            if (expense.creditCardId !== null) {
                // Mudar a data de compra sem dizer o lançamento recalcula o default.
                const earliestOpen = nextDay(closedThrough as string);
                const postedOn =
                    changes.postedOn ??
                    (changes.occurredOn !== undefined
                        ? occurredOn > earliestOpen
                            ? occurredOn
                            : earliestOpen
                        : expense.postedOn);

                if (postedOn !== null && postedOn < occurredOn) {
                    throw this.invalidPostedOn('postedOn must not be before occurredOn');
                }

                if (
                    changes.postedOn !== undefined &&
                    changes.postedOn !== expense.postedOn &&
                    changes.postedOn <= (closedThrough as string)
                ) {
                    throw statementClosed(closedThrough as string);
                }

                if (postedOn !== expense.postedOn) patch.postedOn = postedOn;
            }

            if (
                expense.creditCardId !== null &&
                changes.amountCents !== undefined &&
                changes.amountCents !== expense.amountCents &&
                LIMIT_CONSUMING.includes(expense.status)
            ) {
                await this.creditCards.applyAvailableLimitDelta(
                    manager,
                    expense.creditCardId,
                    -(changes.amountCents - expense.amountCents),
                );
            }

            if (Object.keys(patch).length > 0) await repository.update({ id }, patch);

            return (await repository.findOneOrFail({
                where: { id },
                relations: { expenseType: true },
            })) as ExpenseWithType;
        });
    }

    /**
     * Troca a forma de pagamento de uma despesa não paga (spec 0012, Troca de forma de
     * pagamento). Numa parcela, vale para todas as parcelas do grupo que não estão pagas
     * nem em fatura fechada. Limite de origem e de destino movem na mesma transação
     * (INV-0012-15); saldo de conta nunca (INV-0012-04). Devolve as despesas movidas, em
     * ordem de parcela; destino igual à origem responde sem efeito.
     */
    changePaymentMethod(id: string, change: ChangePaymentMethod): Promise<ExpenseWithType[]> {
        return this.runner.run(async (scope) => {
            const { manager } = scope;
            const repository = manager.getRepository(Expense);

            // Leitura sem trava só para descobrir o grupo; a trava do grupo vem em ordem de
            // `id`, como na exclusão, para que duas trocas concorrentes nunca se travem
            // em ordem cruzada.
            const probe = await repository.findOne({ where: { id } });

            if (!probe) throw expenseNotFound();

            const locked = await repository.find({
                where:
                    probe.installmentGroupId !== null
                        ? { installmentGroupId: probe.installmentGroupId }
                        : { id },
                order: { id: 'ASC' },
                lock: { mode: 'for_no_key_update' },
            });
            const target = locked.find((row) => row.id === id);

            if (!target) throw expenseNotFound();
            if (target.status === 'PAID') throw alreadyPaid();

            const destCardId = change.creditCardId ?? null;
            const destAccountId = change.bankAccountId ?? null;
            const reload = async (ids: string[]): Promise<ExpenseWithType[]> => {
                const rows = await repository.find({
                    where: { id: In(ids) },
                    relations: { expenseType: true },
                });

                return (rows as ExpenseWithType[]).sort(
                    (a, b) =>
                        (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0) ||
                        a.createdAt.getTime() - b.createdAt.getTime(),
                );
            };
            const sameDestination = (row: Expense): boolean =>
                destCardId !== null
                    ? row.creditCardId === destCardId
                    : row.bankAccountId === destAccountId;

            if (sameDestination(target)) return reload([id]);

            if (destCardId !== null) {
                if ((await this.creditCards.findById(destCardId)).archivedAt) {
                    throw new CustomError(409, 'CREDIT_CARD_ARCHIVED', 'This card is archived', {
                        exposeMessage: true,
                    });
                }
            } else if ((await this.bankAccounts.findById(destAccountId as string)).archivedAt) {
                throw new CustomError(409, 'BANK_ACCOUNT_ARCHIVED', 'This account is archived', {
                    exposeMessage: true,
                });
            }

            const destClosedThrough =
                destCardId !== null ? await this.closedThrough(manager, destCardId) : null;

            if (
                change.postedOn !== undefined &&
                destClosedThrough !== null &&
                change.postedOn <= destClosedThrough
            ) {
                throw statementClosed(destClosedThrough);
            }

            if (change.postedOn !== undefined && change.postedOn < target.occurredOn) {
                throw this.invalidPostedOn('postedOn must not be before occurredOn');
            }

            // Window closed for the card of origin: a counting row there stays put (spec 0013).
            const sourceClosedThrough = new Map<string, string>();

            for (const row of locked) {
                if (row.creditCardId !== null && !sourceClosedThrough.has(row.creditCardId)) {
                    sourceClosedThrough.set(
                        row.creditCardId,
                        await this.closedThrough(manager, row.creditCardId),
                    );
                }
            }

            const isClosed = (row: Expense): boolean =>
                row.creditCardId !== null &&
                row.status !== 'FORECAST' &&
                row.postedOn !== null &&
                row.postedOn <= (sourceClosedThrough.get(row.creditCardId) as string);

            if (isClosed(target)) {
                throw statementClosed(
                    sourceClosedThrough.get(target.creditCardId as string) as string,
                );
            }

            const moved = locked.filter(
                (row) =>
                    row.id === id ||
                    (row.status !== 'PAID' && !isClosed(row) && !sameDestination(row)),
            );
            const limitDeltas = new Map<string, number>();
            const addDelta = (cardId: string, cents: number): void => {
                limitDeltas.set(cardId, (limitDeltas.get(cardId) ?? 0) + cents);
            };
            const earliestOpen = destClosedThrough !== null ? nextDay(destClosedThrough) : null;

            for (const row of moved) {
                const consumes = LIMIT_CONSUMING.includes(row.status);

                if (row.creditCardId !== null && consumes) {
                    addDelta(row.creditCardId, row.amountCents);
                }

                if (destCardId !== null) {
                    // O vencida de conta chega ao cartão como OPEN (INV-0012-08).
                    const status = row.status === 'OVERDUE' ? 'OPEN' : row.status;
                    const defaultPostedOn =
                        row.occurredOn > (earliestOpen as string)
                            ? row.occurredOn
                            : (earliestOpen as string);

                    if (status !== 'FORECAST') addDelta(destCardId, -row.amountCents);

                    await repository.update(
                        { id: row.id },
                        {
                            bankAccountId: null,
                            creditCardId: destCardId,
                            postedOn:
                                row.id === id
                                    ? (change.postedOn ?? defaultPostedOn)
                                    : defaultPostedOn,
                            status,
                        },
                    );
                } else {
                    await repository.update(
                        { id: row.id },
                        { bankAccountId: destAccountId, creditCardId: null, postedOn: null },
                    );
                }
            }

            for (const cardId of [...limitDeltas.keys()].sort()) {
                const delta = limitDeltas.get(cardId) as number;

                if (delta !== 0)
                    await this.creditCards.applyAvailableLimitDelta(manager, cardId, delta);
            }

            return reload(moved.map((row) => row.id));
        });
    }

    /**
     * Exclui uma despesa não paga e devolve o limite do cartão (AC-0012-14). Numa parcela,
     * exclui todas as parcelas não pagas do grupo na mesma transação; as pagas ficam
     * (INV-0012-13). Excluir a própria paga é ERR-0012-10 (INV-0012-11).
     */
    delete(id: string): Promise<void> {
        return this.runner.run(async (scope) => {
            const { manager } = scope;
            const repository = manager.getRepository(Expense);

            // Leitura sem trava só para descobrir o grupo; a trava vem a seguir, sobre o
            // grupo inteiro em ordem de `id`, para que duas exclusões de parcelas do mesmo
            // grupo nunca se travem em ordem cruzada.
            const probe = await repository.findOne({ where: { id } });

            if (!probe) throw expenseNotFound();

            const where: FindOptionsWhere<Expense> =
                probe.installmentGroupId !== null
                    ? { installmentGroupId: probe.installmentGroupId }
                    : { id };
            const locked = await repository.find({
                where,
                order: { id: 'ASC' },
                lock: { mode: 'for_no_key_update' },
            });
            const target = locked.find((row) => row.id === id);

            if (!target) throw expenseNotFound();
            if (target.status === 'PAID') throw alreadyPaid();

            // Window closed for the card: a counting row there is as good as paid (spec 0013).
            const closedThrough =
                target.creditCardId !== null
                    ? await this.closedThrough(manager, target.creditCardId)
                    : null;
            const isClosed = (row: Expense): boolean =>
                closedThrough !== null &&
                row.status !== 'FORECAST' &&
                row.postedOn !== null &&
                row.postedOn <= closedThrough;

            if (isClosed(target)) throw statementClosed(closedThrough as string);

            const doomed = locked.filter((row) => row.status !== 'PAID' && !isClosed(row));
            const releasedByCard = new Map<string, number>();

            for (const row of doomed) {
                if (row.creditCardId !== null && LIMIT_CONSUMING.includes(row.status)) {
                    releasedByCard.set(
                        row.creditCardId,
                        (releasedByCard.get(row.creditCardId) ?? 0) + row.amountCents,
                    );
                }
            }

            for (const [cardId, cents] of releasedByCard) {
                await this.creditCards.applyAvailableLimitDelta(manager, cardId, cents);
            }

            await repository.delete({ id: In(doomed.map((row) => row.id)) });
        });
    }

    /**
     * Varredura de vencidas: um único `UPDATE` leva a `OVERDUE` toda despesa de conta
     * `OPEN` com `occurred_on` anterior a `asOf` (data de negócio de `asOf`), e devolve
     * quantas mudou. Idempotente; despesa de cartão nunca vence (INV-0012-08).
     */
    markOverdue(asOf: Date): Promise<number> {
        const cutoff = businessToday(asOf);

        return this.runner.run(async ({ manager }) => {
            const result = await manager
                .createQueryBuilder()
                .update(Expense)
                .set({ status: 'OVERDUE' })
                .where('status = :open', { open: 'OPEN' })
                .andWhere('bank_account_id IS NOT NULL')
                .andWhere('occurred_on < :cutoff', { cutoff })
                .execute();

            return result.affected ?? 0;
        });
    }

    private invalidPostedOn(message: string): ZodError {
        return new ZodError([{ code: 'custom', path: ['postedOn'], message, input: undefined }]);
    }

    /** Tipo inexistente é 404 (ERR-0012-04); arquivado não recebe despesa nova (ERR-0012-06). */
    private async assertTypeIsUsable(manager: EntityManager, id: string): Promise<void> {
        const type = await manager.getRepository(ExpenseType).findOne({ where: { id } });

        if (!type) {
            throw CustomError.notFound('Expense type not found', 'EXPENSE_TYPE_NOT_FOUND', {
                exposeMessage: true,
            });
        }

        if (type.archivedAt) {
            throw new CustomError(409, 'EXPENSE_TYPE_ARCHIVED', 'This expense type is archived', {
                exposeMessage: true,
            });
        }
    }

    /** Conta ou cartão: inexistente é 404 (ERR-0012-04), arquivado é 409 (ERR-0012-05). */
    private async assertPaymentMethodIsUsable(data: CreateExpense): Promise<void> {
        if (data.bankAccountId) {
            const account = await this.bankAccounts.findById(data.bankAccountId);

            if (account.archivedAt) {
                throw new CustomError(409, 'BANK_ACCOUNT_ARCHIVED', 'This account is archived', {
                    exposeMessage: true,
                });
            }
        } else if (data.creditCardId) {
            const card = await this.creditCards.findById(data.creditCardId);

            if (card.archivedAt) {
                throw new CustomError(409, 'CREDIT_CARD_ARCHIVED', 'This card is archived', {
                    exposeMessage: true,
                });
            }
        }
    }

    /**
     * Quita as despesas de cartão do cartão com `posted_on` na janela e status `OPEN` ou
     * `VERIFYING` (spec 0013): passam a `PAID` com `paidOn`. Escreve com o `manager`
     * recebido, não abre transação (INV-0004-03), não publica evento e não toca saldo
     * nem limite. Devolve quantas mudou.
     */
    async markPaidByStatement(
        manager: EntityManager,
        creditCardId: string,
        window: PostingWindow,
        paidOn: Date,
    ): Promise<{ count: number }> {
        const result = await manager
            .createQueryBuilder()
            .update(Expense)
            .set({ status: 'PAID', paidOn: businessToday(paidOn) })
            .where('credit_card_id = :creditCardId', { creditCardId })
            .andWhere('posted_on >= :from', { from: businessToday(window.from) })
            .andWhere('posted_on <= :to', { to: businessToday(window.to) })
            .andWhere('status IN (:...statuses)', { statuses: ['OPEN', 'VERIFYING'] })
            .execute();

        return { count: result.affected ?? 0 };
    }

    /**
     * Desfaz a quitação: as despesas de cartão do cartão com `posted_on` na janela e status
     * `PAID` voltam a `OPEN` com `paid_on` nulo (spec 0013, Desfazer). Mesmas regras do
     * `markPaidByStatement`: usa o `manager` recebido, não abre transação, não publica
     * evento e não toca saldo nem limite. Devolve quantas mudou.
     */
    async markUnpaidByStatement(
        manager: EntityManager,
        creditCardId: string,
        window: PostingWindow,
    ): Promise<{ count: number }> {
        const result = await manager
            .createQueryBuilder()
            .update(Expense)
            .set({ status: 'OPEN', paidOn: null })
            .where('credit_card_id = :creditCardId', { creditCardId })
            .andWhere('posted_on >= :from', { from: businessToday(window.from) })
            .andWhere('posted_on <= :to', { to: businessToday(window.to) })
            .andWhere('status = :status', { status: 'PAID' })
            .execute();

        return { count: result.affected ?? 0 };
    }

    /**
     * A despesa de cartão `id`, lida com o `manager` recebido; `null` para despesa
     * inexistente ou de conta (spec 0013, Interface pública).
     */
    async findCardExpense(
        manager: EntityManager,
        id: string,
    ): Promise<{ id: string; creditCardId: string; amountCents: number } | null> {
        const expense = await manager.getRepository(Expense).findOne({ where: { id } });

        if (!expense || expense.creditCardId === null) return null;

        return {
            id: expense.id,
            creditCardId: expense.creditCardId,
            amountCents: expense.amountCents,
        };
    }
}
