import { OpenPeriodGuard } from '../../src/expenses';
import { businessToday } from '../../src/platform';

describe('OpenPeriodGuard (spec 0013, A janela fechada)', () => {
    it('não fecha nada: o último dia fechado é anterior a qualquer lançamento', async () => {
        const closedThrough = await new OpenPeriodGuard().closedThrough();

        expect(businessToday(closedThrough) < '2000-01-01').toBe(true);
    });
});
