import request from 'supertest';

import { Earning } from '../../../src/earnings';
import { BILLER, MISSING, useEarningFixtures } from './earning-fixtures.helper';

describe('alteração e exclusão de receita (spec 0014, AC-0014-09, INV-0014-07, ERR-0014-10, ERR-0014-11)', () => {
    const fx = useEarningFixtures('test_earnings_update_delete');

    const patch = (id: string, body: Record<string, unknown>) =>
        request(fx.ctx.app).patch(`/earnings/${id}`).set('Authorization', BILLER).send(body);
    const del = (id: string) =>
        request(fx.ctx.app).delete(`/earnings/${id}`).set('Authorization', BILLER);
    const setStatus = (id: string, status: string) =>
        request(fx.ctx.app)
            .patch(`/earnings/${id}/status`)
            .set('Authorization', BILLER)
            .send({ status });

    it('AC-0014-09: trocar a conta de receita OPEN não move o saldo de nenhuma das duas', async () => {
        const other = await fx.makeAccount('2-2');
        const id = await fx.seed('OPEN');

        const response = await patch(id, { bankAccountId: other.id });

        expect(response.status).toBe(200);
        expect(response.body.data.bankAccountId).toBe(other.id);
        expect(await fx.balanceOf(fx.accountId)).toBe(1000);
        expect(await fx.balanceOf(other.id)).toBe(1000);
    });

    it('altera descrição, tipo, data, valor e notas de receita não recebida', async () => {
        const [type] = (await fx.ctx.dataSource.query(
            "INSERT INTO earning_types (name) VALUES ('Teste Outro') RETURNING id",
        )) as Array<{ id: string }>;
        const id = await fx.seed('FORECAST');

        const response = await patch(id, {
            description: 'Novo',
            earningTypeId: type!.id,
            occurredOn: '2026-04-01',
            amountCents: 7000,
            notes: 'obs',
        });

        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({
            description: 'Novo',
            occurredOn: '2026-04-01',
            amountCents: 7000,
            notes: 'obs',
            earningType: { id: type!.id },
        });
        expect(await fx.balanceOf(fx.accountId)).toBe(1000);
        expect((await patch(id, { notes: null })).body.data.notes).toBeNull();
    });

    it('receita recebida aceita descrição e data', async () => {
        const id = await fx.seed('RECEIVED');

        const response = await patch(id, { description: 'Ajustada', occurredOn: '2026-03-07' });

        expect(response.status).toBe(200);
        expect(response.body.data.description).toBe('Ajustada');
    });

    it('INV-0014-07: alterar amountCents de receita recebida é 409 EARNING_ALREADY_RECEIVED', async () => {
        const id = await fx.seed('RECEIVED');

        const response = await patch(id, { amountCents: 9000 });

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('EARNING_ALREADY_RECEIVED');
        expect(await fx.balanceOf(fx.accountId)).toBe(1000);
    });

    it('INV-0014-07: alterar bankAccountId de receita recebida é 409 EARNING_ALREADY_RECEIVED', async () => {
        const other = await fx.makeAccount('3-3');
        const id = await fx.seed('RECEIVED');

        const response = await patch(id, { bankAccountId: other.id });

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('EARNING_ALREADY_RECEIVED');
        expect(await fx.balanceOf(other.id)).toBe(1000);
    });

    it.each(['status', 'kind', 'receivedOn', 'installmentTotal', 'installmentGroupId'])(
        'ERR-0014-11: campo imutável %s é 400 citando o campo',
        async (field) => {
            const id = await fx.seed('OPEN');

            const response = await patch(id, { description: 'x', [field]: 'OPEN' });

            expect(response.status).toBe(400);
            expect(response.body.error.code).toBe('VALIDATION_ERROR');
            expect(JSON.stringify(response.body.error)).toContain(field);
        },
    );

    it('corpo vazio, valor inválido e id malformado são 400', async () => {
        const id = await fx.seed('OPEN');

        expect((await patch(id, {})).status).toBe(400);
        expect((await patch(id, { amountCents: 0 })).status).toBe(400);
        expect((await patch(id, { amountCents: 10.5 })).status).toBe(400);
        expect((await patch('not-a-uuid', { notes: 'x' })).status).toBe(400);
    });

    it('ERR-0014-02: id inexistente é 404 EARNING_NOT_FOUND no PATCH e no DELETE', async () => {
        const patched = await patch(MISSING, { description: 'x' });
        const deleted = await del(MISSING);

        expect(patched.status).toBe(404);
        expect(patched.body.error.code).toBe('EARNING_NOT_FOUND');
        expect(deleted.status).toBe(404);
        expect(deleted.body.error.code).toBe('EARNING_NOT_FOUND');
    });

    it('conta inexistente é 404, arquivada é 409 BANK_ACCOUNT_ARCHIVED', async () => {
        const archived = await fx.makeAccount('4-4', new Date());
        const id = await fx.seed('OPEN');

        const missing = await patch(id, { bankAccountId: MISSING });
        const response = await patch(id, { bankAccountId: archived.id });

        expect(missing.status).toBe(404);
        expect(missing.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('BANK_ACCOUNT_ARCHIVED');
    });

    it('tipo inexistente é 404, arquivado é 409 EARNING_TYPE_ARCHIVED', async () => {
        const [type] = (await fx.ctx.dataSource.query(
            "INSERT INTO earning_types (name, archived_at) VALUES ('Teste Arq', now()) RETURNING id",
        )) as Array<{ id: string }>;
        const id = await fx.seed('OPEN');

        const missing = await patch(id, { earningTypeId: MISSING });
        const response = await patch(id, { earningTypeId: type!.id });

        expect(missing.status).toBe(404);
        expect(missing.body.error.code).toBe('EARNING_TYPE_NOT_FOUND');
        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('EARNING_TYPE_ARCHIVED');
    });

    it.each(['OPEN', 'FORECAST', 'OVERDUE', 'VERIFYING'] as const)(
        'exclui receita %s com 204 sem mover o saldo',
        async (status) => {
            const id = await fx.seed(status);

            const response = await del(id);

            expect(response.status).toBe(204);
            expect(await fx.ctx.dataSource.getRepository(Earning).countBy({ id })).toBe(0);
            expect(await fx.balanceOf(fx.accountId)).toBe(1000);
        },
    );

    it('INV-0014-07: excluir receita recebida é 409 EARNING_ALREADY_RECEIVED', async () => {
        const id = await fx.seed('RECEIVED');

        const response = await del(id);

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('EARNING_ALREADY_RECEIVED');
        expect(await fx.ctx.dataSource.getRepository(Earning).countBy({ id })).toBe(1);
    });

    it('desfazer o recebimento libera a exclusão e devolve o saldo', async () => {
        const id = await fx.seed('OPEN');
        await setStatus(id, 'RECEIVED');
        expect(await fx.balanceOf(fx.accountId)).toBe(6000);

        await setStatus(id, 'OPEN');

        expect((await del(id)).status).toBe(204);
        expect(await fx.balanceOf(fx.accountId)).toBe(1000);
    });
});
