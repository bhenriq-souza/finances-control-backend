import { inject, injectable } from 'tsyringe';

import { businessToday, type JobQueue, type JobRegistrar } from '../platform';
import { ExpenseServiceSymbol } from './expenses.symbols';
import type { ExpenseService } from './expense.service';

export const ExpenseJobsSymbol = Symbol.for('ExpenseJobs');

/** Rotina diária de varredura de despesas vencidas (spec 0017): 00h15 no fuso de negócio. */
@injectable()
export class ExpenseJobs implements JobRegistrar {
    constructor(@inject(ExpenseServiceSymbol) private readonly expenses: ExpenseService) {}

    register(queue: JobQueue): void {
        queue.register('expenses.mark-overdue', async () => {
            await this.expenses.markOverdue(new Date(`${businessToday()}T12:00:00.000Z`));
        });
        queue.schedule('expenses.mark-overdue', '15 0 * * *');
    }
}
