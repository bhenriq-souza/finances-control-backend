import { QueryFailedError } from 'typeorm';
import { CustomError } from '@bhs-dev/typescript-common-errors';

import { asConflict } from '../../src/accounts/unique-violation';

const CONFLICTS = {
    uq_banks_febraban_code: { code: 'BANK_ALREADY_EXISTS', message: 'já existe' },
};

const violation = (constraint: string): QueryFailedError =>
    new QueryFailedError(
        'INSERT ...',
        [],
        Object.assign(new Error('duplicate key'), { code: '23505', constraint }),
    );

describe('asConflict', () => {
    it('devolve o resultado quando não há conflito', async () => {
        await expect(asConflict(Promise.resolve('ok'), CONFLICTS)).resolves.toBe('ok');
    });

    it('traduz a constraint conhecida em 409 com o código de domínio', async () => {
        const error = await asConflict(
            Promise.reject(violation('uq_banks_febraban_code')),
            CONFLICTS,
        ).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(CustomError);
        expect(error).toMatchObject({ status: 409, code: 'BANK_ALREADY_EXISTS' });
        expect((error as CustomError).exposeMessage).toBe(true);
    });

    it('relança violação de outra constraint: não é o conflito esperado', async () => {
        const original = violation('uq_banks_outra_coisa');

        await expect(asConflict(Promise.reject(original), CONFLICTS)).rejects.toBe(original);
    });

    it('relança erro que não vem do banco', async () => {
        const original = new Error('conexão caiu');

        await expect(asConflict(Promise.reject(original), CONFLICTS)).rejects.toBe(original);
    });

    it('relança violação sem nome de constraint', async () => {
        const original = new QueryFailedError('SELECT 1', [], new Error('sem constraint'));

        await expect(asConflict(Promise.reject(original), CONFLICTS)).rejects.toBe(original);
    });
});
