import { injectable } from 'tsyringe';

import { businessToday, type JobQueue, type JobRegistrar } from '../platform';
import { StatementService } from './statement.service';

export const StatementJobsSymbol = Symbol.for('StatementJobs');

/** Rotina diária de fechamento de fatura (spec 0017): 00h15 no fuso de negócio. */
@injectable()
export class StatementJobs implements JobRegistrar {
    constructor(private readonly statements: StatementService) {}

    register(queue: JobQueue): void {
        queue.register('statements.close-due', async () => {
            await this.statements.closeDue(new Date(`${businessToday()}T12:00:00.000Z`));
        });
        queue.schedule('statements.close-due', '15 0 * * *');
    }
}
