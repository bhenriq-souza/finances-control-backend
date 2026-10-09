import { inject, injectable } from 'tsyringe';

import { businessToday, type JobQueue, type JobRegistrar } from '../platform';
import { EarningServiceSymbol } from './earnings.symbols';
import type { EarningService } from './earning.service';
import {
    EarningRecurrenceServiceSymbol,
    type EarningRecurrenceService,
} from './earning-recurrence.service';

export const EarningJobsSymbol = Symbol.for('EarningJobs');

/**
 * Rotinas diárias de receitas (spec 0017), às 00h15 no fuso de negócio: varredura de
 * vencidas e, da série, extensão até o horizonte e promoção de `FORECAST` a `OPEN`.
 */
@injectable()
export class EarningJobs implements JobRegistrar {
    constructor(
        @inject(EarningServiceSymbol) private readonly earnings: EarningService,
        @inject(EarningRecurrenceServiceSymbol)
        private readonly recurrences: EarningRecurrenceService,
    ) {}

    register(queue: JobQueue): void {
        queue.register('earnings.mark-overdue', async () => {
            await this.earnings.markOverdue(new Date(`${businessToday()}T12:00:00.000Z`));
        });
        queue.schedule('earnings.mark-overdue', '15 0 * * *');

        queue.register('earnings.extend-recurrences', async () => {
            await this.recurrences.extend(new Date(`${businessToday()}T12:00:00.000Z`));
        });
        queue.schedule('earnings.extend-recurrences', '15 0 * * *');

        queue.register('earnings.promote-recurrences', async () => {
            await this.recurrences.promote(new Date(`${businessToday()}T12:00:00.000Z`));
        });
        queue.schedule('earnings.promote-recurrences', '15 0 * * *');
    }
}
