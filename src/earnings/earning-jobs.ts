import { inject, injectable } from 'tsyringe';

import { businessToday, type JobQueue, type JobRegistrar } from '../platform';
import { EarningServiceSymbol } from './earnings.symbols';
import type { EarningService } from './earning.service';

export const EarningJobsSymbol = Symbol.for('EarningJobs');

/** Rotina diária de varredura de receitas vencidas (spec 0017): 00h15 no fuso de negócio. */
@injectable()
export class EarningJobs implements JobRegistrar {
    constructor(@inject(EarningServiceSymbol) private readonly earnings: EarningService) {}

    register(queue: JobQueue): void {
        queue.register('earnings.mark-overdue', async () => {
            await this.earnings.markOverdue(new Date(`${businessToday()}T12:00:00.000Z`));
        });
        queue.schedule('earnings.mark-overdue', '15 0 * * *');
    }
}
