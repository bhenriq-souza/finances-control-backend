import { inject, injectable } from 'tsyringe';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import { IsNull, MoreThan, MoreThanOrEqual, Or, type EntityManager } from 'typeorm';
import { ZodError } from 'zod';

import { EARNING_CREATED, type EarningCreated } from '../events';
import { TransactionRunnerSymbol, businessToday, type TransactionRunner } from '../platform';
import { recurrenceHorizon, seriesDates } from './earning-recurrence.dates';
import { EarningRecurrence } from './earning-recurrence.entity';
import type { EarningRecurrenceView } from './earning-recurrence.response';
import { Earning } from './earning.entity';
import { EarningServiceSymbol } from './earnings.symbols';
import type { EndRecurrence, ListRecurrencesQuery } from './earning.schemas';
import type { EarningService } from './earning.service';

export const EarningRecurrenceServiceSymbol = Symbol.for('EarningRecurrenceService');

const recurrenceNotFound = (): CustomError =>
    CustomError.notFound('Earning recurrence not found', 'EARNING_RECURRENCE_NOT_FOUND', {
        exposeMessage: true,
    });

/**
 * A série de receitas `FIXED` (spec 0017): extensão até o horizonte e promoção de
 * `FORECAST` a `OPEN`. A criação da série vive em `EarningService.create`, na mesma
 * transação da primeira ocorrência.
 */
@injectable()
export class EarningRecurrenceService {
    constructor(
        @inject(TransactionRunnerSymbol) private readonly runner: TransactionRunner,
        @inject(EarningServiceSymbol) private readonly earnings: EarningService,
    ) {}

    /**
     * Cria, para toda série sem `ends_on` ou com `ends_on` futuro, as ocorrências que faltam
     * até o horizonte de `asOf`, como `FORECAST`, copiando o modelo atual da série.
     * Idempotente: um mês que já tem ocorrência nunca recebe outra. Cada série é estendida
     * numa transação própria. Devolve quantas criou.
     */
    async extend(asOf: Date): Promise<number> {
        const today = businessToday(asOf);
        const horizon = recurrenceHorizon(today);
        const series = await this.runner.run(({ manager }) =>
            manager.getRepository(EarningRecurrence).find({
                select: { id: true },
                where: { endsOn: Or(IsNull(), MoreThan(today)) },
                order: { id: 'ASC' },
            }),
        );
        let created = 0;

        for (const { id } of series) {
            created += await this.extendSeries(id, horizon);
        }

        return created;
    }

    /**
     * Passa a `OPEN` toda ocorrência de série em `FORECAST` com `occurred_on <= asOf`, pela
     * transição `FORECAST → OPEN` da spec 0014. Devolve quantas promoveu.
     */
    async promote(asOf: Date): Promise<number> {
        const today = businessToday(asOf);
        const due = await this.runner.run(({ manager }) =>
            manager
                .getRepository(Earning)
                .createQueryBuilder('e')
                .select('e.id', 'id')
                .where('e.recurrenceId IS NOT NULL')
                .andWhere("e.status = 'FORECAST'")
                .andWhere('e.occurredOn <= :today', { today })
                .orderBy('e.occurredOn', 'ASC')
                .addOrderBy('e.id', 'ASC')
                .getRawMany<{ id: string }>(),
        );

        for (const { id } of due) {
            await this.earnings.changeStatus(id, { status: 'OPEN' });
        }

        return due.length;
    }

    /** As séries, da mais recente para a mais antiga; `active` tira as de `ends_on` passado. */
    list(query: ListRecurrencesQuery = {}): Promise<EarningRecurrenceView[]> {
        const today = businessToday(new Date());

        return this.runner.run(async ({ manager }) => {
            const rows = await manager.getRepository(EarningRecurrence).find({
                where: query.active ? { endsOn: Or(IsNull(), MoreThanOrEqual(today)) } : undefined,
                order: { createdAt: 'DESC', id: 'ASC' },
            });

            return this.withNextOccurrence(manager, rows, today);
        });
    }

    findById(id: string): Promise<EarningRecurrenceView> {
        const today = businessToday(new Date());

        return this.runner.run(async ({ manager }) => {
            const series = await manager
                .getRepository(EarningRecurrence)
                .findOne({ where: { id } });

            if (!series) throw recurrenceNotFound();

            return (
                await this.withNextOccurrence(manager, [series], today)
            )[0] as EarningRecurrenceView;
        });
    }

    /**
     * Encerra a série em `endsOn` (spec 0017): exclui as ocorrências `FORECAST` posteriores;
     * as demais ficam. `endsOn` antes de `starts_on` é ERR-0017-03.
     */
    end(id: string, change: EndRecurrence): Promise<EarningRecurrenceView> {
        const today = businessToday(new Date());

        return this.runner.run(async ({ manager }) => {
            const recurrences = manager.getRepository(EarningRecurrence);
            const series = await recurrences.findOne({
                where: { id },
                lock: { mode: 'for_no_key_update' },
            });

            if (!series) throw recurrenceNotFound();

            if (change.endsOn < series.startsOn) {
                throw new ZodError([
                    {
                        code: 'custom',
                        path: ['endsOn'],
                        message: 'endsOn must not be before startsOn',
                        input: undefined,
                    },
                ]);
            }

            await manager.getRepository(Earning).delete({
                recurrenceId: id,
                status: 'FORECAST',
                occurredOn: MoreThan(change.endsOn),
            });
            await recurrences.update({ id }, { endsOn: change.endsOn });

            const updated = await recurrences.findOneOrFail({ where: { id } });

            return (
                await this.withNextOccurrence(manager, [updated], today)
            )[0] as EarningRecurrenceView;
        });
    }

    private async withNextOccurrence(
        manager: EntityManager,
        series: EarningRecurrence[],
        today: string,
    ): Promise<EarningRecurrenceView[]> {
        if (series.length === 0) return [];

        const next = await manager
            .getRepository(Earning)
            .createQueryBuilder('e')
            .select('e.recurrenceId', 'id')
            .addSelect('MIN(e.occurredOn)::text', 'next')
            .where('e.recurrenceId IN (:...ids)', { ids: series.map((row) => row.id) })
            .andWhere('e.occurredOn >= :today', { today })
            .groupBy('e.recurrenceId')
            .getRawMany<{ id: string; next: string }>();
        const byId = new Map(next.map((row) => [row.id, row.next]));

        return series.map((row) =>
            Object.assign(row, { nextOccurrenceOn: byId.get(row.id) ?? null }),
        );
    }

    private extendSeries(id: string, horizon: string): Promise<number> {
        return this.runner.run(async (scope) => {
            const { manager } = scope;
            const repository = manager.getRepository(Earning);
            const recurrence = await manager.getRepository(EarningRecurrence).findOne({
                where: { id },
                lock: { mode: 'for_no_key_update' },
            });

            if (!recurrence) return 0;

            const existing = new Set(
                (
                    await repository.find({
                        select: { occurredOn: true },
                        where: { recurrenceId: id },
                    })
                ).map((row) => row.occurredOn),
            );
            const missing = seriesDates(recurrence.startsOn, recurrence.endsOn, horizon).filter(
                (date) => !existing.has(date),
            );

            for (const date of missing) {
                const saved = await repository.save(
                    repository.create({
                        description: recurrence.description,
                        earningTypeId: recurrence.earningTypeId,
                        kind: 'FIXED',
                        status: 'FORECAST',
                        amountCents: recurrence.amountCents,
                        occurredOn: date,
                        receivedOn: null,
                        bankAccountId: recurrence.bankAccountId,
                        installmentGroupId: null,
                        installmentNumber: null,
                        installmentTotal: null,
                        recurrenceId: id,
                        notes: recurrence.notes,
                    }),
                );

                scope.publish({
                    name: EARNING_CREATED,
                    payload: {
                        earningId: saved.id,
                        kind: saved.kind,
                        status: saved.status as EarningCreated['payload']['status'],
                        amountCents: saved.amountCents,
                        occurredOn: saved.occurredOn,
                        bankAccountId: saved.bankAccountId,
                        installmentGroupId: saved.installmentGroupId,
                    },
                });
            }

            return missing.length;
        });
    }
}
