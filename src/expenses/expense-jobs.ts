import { inject, injectable } from 'tsyringe';

import { businessToday, type JobQueue, type JobRegistrar } from '../platform';
import { ExpenseServiceSymbol } from './expenses.symbols';
import type { ExpenseService } from './expense.service';
import {
    ExpenseRecurrenceServiceSymbol,
    type ExpenseRecurrenceService,
} from './expense-recurrence.service';

export const ExpenseJobsSymbol = Symbol.for('ExpenseJobs');

/**
 * Rotinas diárias de despesas (spec 0017), às 00h15 no fuso de negócio: varredura de
 * vencidas e, da série, extensão até o horizonte e promoção de `FORECAST` a `OPEN`.
 */
@injectable()
export class ExpenseJobs implements JobRegistrar {
    constructor(
        @inject(ExpenseServiceSymbol) private readonly expenses: ExpenseService,
        @inject(ExpenseRecurrenceServiceSymbol)
        private readonly recurrences: ExpenseRecurrenceService,
    ) {}

    register(queue: JobQueue): void {
        queue.register('expenses.mark-overdue', async () => {
            await this.expenses.markOverdue(new Date(`${businessToday()}T12:00:00.000Z`));
        });
        queue.schedule('expenses.mark-overdue', '15 0 * * *');

        queue.register('expenses.extend-recurrences', async () => {
            await this.recurrences.extend(new Date(`${businessToday()}T12:00:00.000Z`));
        });
        queue.schedule('expenses.extend-recurrences', '15 0 * * *');

        queue.register('expenses.promote-recurrences', async () => {
            await this.recurrences.promote(new Date(`${businessToday()}T12:00:00.000Z`));
        });
        queue.schedule('expenses.promote-recurrences', '15 0 * * *');
    }
}
