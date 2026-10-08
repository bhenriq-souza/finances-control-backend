import request from 'supertest';

import { Earning } from '../../../src/earnings';
import { container } from '../../../src/container';
import { EARNING_CREATED, type EarningCreated } from '../../../src/events';
import { DomainEventDispatcherSymbol, type DomainEventDispatcher } from '../../../src/platform';
import { BILLER, MISSING, useEarningFixtures } from './earning-fixtures.helper';

type Row = {
    id: string;
    kind: string;
    notes: string | null;
    amountCents: number;
    occurredOn: string;
    status: string;
    bankAccountId: string;
    installment: { groupId: string; number: number; total: number } | null;
};

describe('receita parcelada (spec 0014, AC-0014-14 a AC-0014-17, INV-0014-09, INV-0014-10)', () => {
    const fx = useEarningFixtures('test_earnings_installments');

    const post = (extra: Record<string, unknown> = {}) =>
        request(fx.ctx.app)
            .post('/earnings')
            .set('Authorization', BILLER)
            .send({
                description: 'Notebook — Júnior',
                earningTypeId: fx.typeId,
                kind: 'INSTALLMENT',
                amountCents: 10000,
                occurredOn: '2026-01-31',
                bankAccountId: fx.accountId,
                installmentTotal: 3,
                notes: 'Reembolso',
                ...extra,
            });
    const patch = (id: string, path: string, body: Record<string, unknown>) =>
        request(fx.ctx.app).patch(`/earnings/${id}${path}`).set('Authorization', BILLER).send(body);
    const del = (id: string) =>
        request(fx.ctx.app).delete(`/earnings/${id}`).set('Authorization', BILLER);
    const rowsOf = (): Promise<Earning[]> =>
        fx.ctx.dataSource.getRepository(Earning).find({ order: { installmentNumber: 'ASC' } });
    const fieldsOf = (response: request.Response): string[] =>
        (response.body.error.details as { path: string[] }[]).map((issue) => issue.path.join('.'));

    it('AC-0014-14: 10000 em 3 parcelas rateia 3334/3333/3333, em 31/01, 28/02 e 31/03', async () => {
        const response = await post();
        const data = response.body.data as Row[];

        expect(response.status).toBe(201);
        expect(data.map((row) => row.amountCents)).toEqual([3334, 3333, 3333]);
        expect(data.map((row) => row.occurredOn)).toEqual([
            '2026-01-31',
            '2026-02-28',
            '2026-03-31',
        ]);
        expect(data.map((row) => row.installment?.number)).toEqual([1, 2, 3]);
        expect(new Set(data.map((row) => row.installment?.groupId)).size).toBe(1);
        expect(data.every((row) => row.installment?.total === 3 && row.status === 'OPEN')).toBe(
            true,
        );
        expect(data[0]).toMatchObject({ kind: 'INSTALLMENT', notes: 'Reembolso' });
        expect(data.reduce((sum, row) => sum + row.amountCents, 0)).toBe(10000);
        expect(await fx.balanceOf(fx.accountId)).toBe(1000);
    });

    it('AC-0014-14: em ano bissexto a segunda parcela cai em 29/02', async () => {
        const response = await post({ occurredOn: '2028-01-31' });

        expect((response.body.data as Row[]).map((row) => row.occurredOn)).toEqual([
            '2028-01-31',
            '2028-02-29',
            '2028-03-31',
        ]);
    });

    it('as parcelas nascem com o status informado', async () => {
        const response = await post({ status: 'FORECAST' });

        expect((response.body.data as Row[]).map((row) => row.status)).toEqual([
            'FORECAST',
            'FORECAST',
            'FORECAST',
        ]);
    });

    describe('eventos', () => {
        let received: EarningCreated[];
        let unsubscribe: () => void;

        beforeEach(() => {
            received = [];
            unsubscribe = container
                .resolve<DomainEventDispatcher>(DomainEventDispatcherSymbol)
                .subscribe<EarningCreated>(EARNING_CREATED, (event) => {
                    received.push(event);
                });
        });

        afterEach(() => unsubscribe());

        it('AC-0014-14: publica três EarningCreated, um por parcela', async () => {
            const data = (await post()).body.data as Row[];

            expect(received.map((event) => event.payload.earningId)).toEqual(
                data.map((row) => row.id),
            );
            expect(received.map((event) => event.payload.amountCents)).toEqual([3334, 3333, 3333]);
            expect(received.every((event) => event.payload.kind === 'INSTALLMENT')).toBe(true);
            expect(received[0]!.payload.installmentGroupId).toBe(data[0]!.installment!.groupId);
        });

        it('AC-0014-15: falha numa parcela não deixa parcela nem evento', async () => {
            await fx.ctx.dataSource.query(
                'ALTER TABLE earnings ADD CONSTRAINT ck_tmp_fail CHECK (installment_number IS DISTINCT FROM 3)',
            );

            try {
                const response = await post();

                expect(response.status).toBeGreaterThanOrEqual(400);
                expect(await rowsOf()).toHaveLength(0);
                expect(received).toHaveLength(0);
            } finally {
                await fx.ctx.dataSource.query('ALTER TABLE earnings DROP CONSTRAINT ck_tmp_fail');
            }
        });
    });

    it('AC-0014-16: receber a parcela 1 soma 3334 ao saldo e deixa as demais OPEN', async () => {
        const data = (await post()).body.data as Row[];

        const response = await patch(data[0]!.id, '/status', { status: 'RECEIVED' });

        expect(response.status).toBe(200);
        expect(await fx.balanceOf(fx.accountId)).toBe(1000 + 3334);
        expect((await rowsOf()).map((row) => row.status)).toEqual(['RECEIVED', 'OPEN', 'OPEN']);
    });

    it('AC-0014-16: excluir a parcela 2 exclui 2 e 3 e mantém a 1 recebida', async () => {
        const data = (await post()).body.data as Row[];
        await patch(data[0]!.id, '/status', { status: 'RECEIVED' });

        const response = await del(data[1]!.id);

        expect(response.status).toBe(204);
        expect((await rowsOf()).map((row) => row.installmentNumber)).toEqual([1]);
        expect(await fx.balanceOf(fx.accountId)).toBe(1000 + 3334);
    });

    it('excluir uma parcela recebida é 409 e nada some do grupo', async () => {
        const data = (await post()).body.data as Row[];
        await patch(data[0]!.id, '/status', { status: 'RECEIVED' });

        const response = await del(data[0]!.id);

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('EARNING_ALREADY_RECEIVED');
        expect(await rowsOf()).toHaveLength(3);
    });

    it('excluir parcela inexistente é 404', async () => {
        expect((await del(MISSING)).status).toBe(404);
    });

    it('AC-0014-16: trocar a conta da parcela 2 troca a de 2 e 3 e mantém a da 1 recebida', async () => {
        const other = await fx.makeAccount('2-2');
        const data = (await post()).body.data as Row[];
        await patch(data[0]!.id, '/status', { status: 'RECEIVED' });

        const response = await patch(data[1]!.id, '', { bankAccountId: other.id });

        expect(response.status).toBe(200);
        expect((await rowsOf()).map((row) => row.bankAccountId)).toEqual([
            fx.accountId,
            other.id,
            other.id,
        ]);
        expect(await fx.balanceOf(fx.accountId)).toBe(1000 + 3334);
        expect(await fx.balanceOf(other.id)).toBe(1000);
    });

    it('os demais campos alteram só aquela parcela', async () => {
        const data = (await post()).body.data as Row[];

        const response = await patch(data[1]!.id, '', {
            amountCents: 4000,
            occurredOn: '2026-03-01',
            description: 'Outra',
        });

        expect(response.status).toBe(200);
        const rows = await rowsOf();
        expect(rows.map((row) => row.amountCents)).toEqual([3334, 4000, 3333]);
        expect(rows.map((row) => row.description)).toEqual([
            'Notebook — Júnior',
            'Outra',
            'Notebook — Júnior',
        ]);
    });

    it('trocar a conta de parcela para conta arquivada é 409 e nenhuma muda', async () => {
        const archived = await fx.makeAccount('3-3', new Date());
        const data = (await post()).body.data as Row[];

        const response = await patch(data[1]!.id, '', { bankAccountId: archived.id });

        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe('BANK_ACCOUNT_ARCHIVED');
        expect((await rowsOf()).every((row) => row.bankAccountId === fx.accountId)).toBe(true);
    });

    it('INV-0014-10: exclusões concorrentes de parcelas do mesmo grupo não travam', async () => {
        const data = (await post({ installmentTotal: 6, amountCents: 6000 })).body.data as Row[];

        const responses = await Promise.all(
            [5, 1, 3, 0, 4, 2].map((index) => del(data[index]!.id)),
        );

        expect(responses.every((response) => [204, 404].includes(response.status))).toBe(true);
        expect(await rowsOf()).toHaveLength(0);
    }, 30000);

    describe('ERR-0014-07 e AC-0014-17', () => {
        it.each([1, 121])('installmentTotal %p recebe 400 citando o campo', async (total) => {
            const response = await post({ installmentTotal: total });

            expect(response.status).toBe(400);
            expect(response.body.error.code).toBe('VALIDATION_ERROR');
            expect(fieldsOf(response)).toContain('installmentTotal');
        });

        it('INSTALLMENT sem installmentTotal recebe 400', async () => {
            const response = await post({ installmentTotal: undefined });

            expect(response.status).toBe(400);
            expect(fieldsOf(response)).toContain('installmentTotal');
        });

        it('installmentTotal em VARIABLE recebe 400', async () => {
            const response = await post({ kind: 'VARIABLE' });

            expect(response.status).toBe(400);
            expect(fieldsOf(response)).toContain('installmentTotal');
        });

        it('PATCH com installmentTotal recebe 400 citando o campo', async () => {
            const data = (await post()).body.data as Row[];

            const response = await patch(data[0]!.id, '', { installmentTotal: 5 });

            expect(response.status).toBe(400);
            expect(JSON.stringify(response.body.error)).toContain('installmentTotal');
        });
    });
});
