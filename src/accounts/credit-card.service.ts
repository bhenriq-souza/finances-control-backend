import { inject, injectable } from 'tsyringe';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import type { DataSource, EntityManager, Repository } from 'typeorm';

import { DatabaseConnectionSymbol } from '../platform';
import { Bank } from './bank.entity';
import { CreditCard } from './credit-card.entity';
import { asConflict } from './unique-violation';

const CONFLICTS = {
    uq_credit_cards_bank_id_name: {
        code: 'CREDIT_CARD_ALREADY_EXISTS',
        message: 'A card with this name is already registered for this bank',
    },
};

export type CreditCardWithBank = CreditCard & { bank: Bank };

export type CreateCreditCard = {
    bankId: string;
    name: string;
    creditLimitCents: number;
    closingDay: number;
    dueDay: number;
};

export type UpdateCreditCard = Partial<
    Pick<CreditCard, 'name' | 'creditLimitCents' | 'closingDay' | 'dueDay'>
>;

@injectable()
export class CreditCardService {
    constructor(@inject(DatabaseConnectionSymbol) private readonly dataSource: DataSource) {}

    private get cards(): Repository<CreditCard> {
        return this.dataSource.getRepository(CreditCard);
    }

    list(): Promise<CreditCardWithBank[]> {
        return this.cards.find({
            relations: { bank: true },
            order: { name: 'ASC' },
        }) as Promise<CreditCardWithBank[]>;
    }

    async findById(id: string): Promise<CreditCardWithBank> {
        const card = await this.cards.findOne({ where: { id }, relations: { bank: true } });

        if (!card) throw cardNotFound();

        return card as CreditCardWithBank;
    }

    async create(data: CreateCreditCard): Promise<CreditCardWithBank> {
        await this.assertBankIsUsable(data.bankId);

        const created = await asConflict(
            this.cards.save(
                this.cards.create({
                    ...data,
                    // Nasce igual ao limite total: o cartão não tem gasto nenhum.
                    availableLimitCents: data.creditLimitCents,
                    archivedAt: null,
                }),
            ),
            CONFLICTS,
        );

        return this.findById(created.id);
    }

    async update(id: string, changes: UpdateCreditCard): Promise<CreditCardWithBank> {
        if (Object.keys(changes).length === 0) return this.findById(id);

        await this.dataSource.transaction(async (manager) => {
            const card = await this.loadForUpdate(manager, id);

            await asConflict(
                manager
                    .getRepository(CreditCard)
                    .update({ id }, this.withAdjustedLimit(card, changes)),
                CONFLICTS,
            );
        });

        return this.findById(id);
    }

    /**
     * Alterar o limite total move o disponível na mesma medida, e na mesma
     * transação: o que não muda é o quanto já foi gasto. Sem isso, subir o limite
     * de 5.000 para 8.000 deixaria o disponível parado, e o cartão passaria a
     * mentir sobre quanto ainda cabe nele.
     *
     * O disponível pode ficar negativo — um banco de fato reduz limite abaixo do
     * que já está em uso, e o cartão precisa saber dizer isso.
     */
    private withAdjustedLimit(
        card: CreditCard,
        changes: UpdateCreditCard,
    ): UpdateCreditCard & {
        availableLimitCents?: number;
    } {
        if (changes.creditLimitCents === undefined) return changes;

        const delta = changes.creditLimitCents - card.creditLimitCents;

        return { ...changes, availableLimitCents: card.availableLimitCents + delta };
    }

    private async loadForUpdate(manager: EntityManager, id: string): Promise<CreditCard> {
        const card = await manager.getRepository(CreditCard).findOne({ where: { id } });

        if (!card) throw cardNotFound();

        return card;
    }

    /** Banco arquivado não recebe cartão novo (ERR-0011-07). */
    private async assertBankIsUsable(bankId: string): Promise<void> {
        const bank = await this.dataSource.getRepository(Bank).findOne({ where: { id: bankId } });

        if (!bank) {
            throw CustomError.notFound('Bank not found', 'BANK_NOT_FOUND', { exposeMessage: true });
        }

        if (bank.archivedAt) {
            throw new CustomError(409, 'BANK_ARCHIVED', 'This bank is archived', {
                exposeMessage: true,
            });
        }
    }
}

const cardNotFound = (): CustomError =>
    CustomError.notFound('Credit card not found', 'CREDIT_CARD_NOT_FOUND', { exposeMessage: true });
