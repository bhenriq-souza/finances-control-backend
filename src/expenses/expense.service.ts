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
import { TransactionRunnerSymbol, businessToday, type TransactionRunner } from '../platform';
import { ExpenseType } from './expense-type.entity';
import { Expense } from './expense.entity';
import type { ExpenseStatus } from './expense-status';
import type {
    ChangeExpenseStatus,
    CreateExpense,
    ListExpensesQuery,
    UpdateExpense,
} from './expense.schemas';

export type ExpenseWithType = Expense & { expenseType: ExpenseType };

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

/** Estados em que a despesa de cartão está abatida do limite (INV-0012-03). */
const LIMIT_CONSUMING: readonly ExpenseStatus[] = ['OPEN', 'OVERDUE', 'VERIFYING'];

@injectable()
export class ExpenseService {
    constructor(
        @inject(TransactionRunnerSymbol) private readonly runner: TransactionRunner,
        @inject(BankAccountServiceSymbol) private readonly bankAccounts: BankAccountService,
        @inject(CreditCardServiceSymbol) private readonly creditCards: CreditCardService,
    ) {}

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

            const repository = manager.getRepository(Expense);
            const saved = await repository.save(
                repository.create({
                    description: data.description,
                    expenseTypeId: data.expenseTypeId,
                    kind: data.kind,
                    status: data.status,
                    amountCents: data.amountCents,
                    occurredOn: data.occurredOn,
                    paidOn: null,
                    bankAccountId: data.bankAccountId ?? null,
                    creditCardId: data.creditCardId ?? null,
                    postedOn: data.creditCardId ? (data.postedOn ?? data.occurredOn) : null,
                    installmentGroupId: null,
                    installmentNumber: null,
                    installmentTotal: null,
                    notes: data.notes ?? null,
                }),
            );

            // Conta: despesa aberta é compromisso, não saída; só cartão consome limite.
            if (saved.creditCardId && saved.status !== 'FORECAST') {
                await this.creditCards.applyAvailableLimitDelta(
                    manager,
                    saved.creditCardId,
                    -saved.amountCents,
                );
            }

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

            const loaded = await repository.findOneOrFail({
                where: { id: saved.id },
                relations: { expenseType: true },
            });

            return [loaded as ExpenseWithType];
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
     * para a fatura; leitura. Ordem: `posted_on`, criação.
     */
    listByCreditCard(
        creditCardId: string,
        range: { from: Date; to: Date },
    ): Promise<ExpenseWithType[]> {
        const from = businessToday(range.from);
        const to = businessToday(range.to);

        return this.runner.run(async (scope) => {
            const expenses = await scope.manager
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

            return expenses as ExpenseWithType[];
        });
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

            const occurredOn = changes.occurredOn ?? expense.occurredOn;
            const patch: Partial<Expense> = {};

            if (changes.description !== undefined) patch.description = changes.description;
            if (changes.expenseTypeId !== undefined) patch.expenseTypeId = changes.expenseTypeId;
            if (changes.occurredOn !== undefined) patch.occurredOn = changes.occurredOn;
            if (changes.amountCents !== undefined) patch.amountCents = changes.amountCents;
            if (changes.notes !== undefined) patch.notes = changes.notes;

            if (expense.creditCardId !== null) {
                // Mudar a data de compra sem dizer o lançamento recalcula o default.
                const postedOn =
                    changes.postedOn ??
                    (changes.occurredOn !== undefined ? occurredOn : expense.postedOn);

                if (postedOn !== null && postedOn < occurredOn) {
                    throw this.invalidPostedOn('postedOn must not be before occurredOn');
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

            const doomed = locked.filter((row) => row.status !== 'PAID');
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
}
