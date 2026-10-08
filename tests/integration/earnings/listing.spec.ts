import request from 'supertest';

import { BILLER, MISSING, useEarningFixtures } from './earning-fixtures.helper';

describe('consulta e listagem de receitas (spec 0014, AC-0014-10, ERR-0014-02, ERR-0014-13)', () => {
    const fx = useEarningFixtures('test_earnings_listing');

    const list = (query: string) =>
        request(fx.ctx.app).get(`/earnings${query}`).set('Authorization', BILLER);

    const ids = (response: request.Response): string[] => {
        expect(response.status).toBe(200);

        return (response.body.data as Array<{ id: string }>).map((e) => e.id);
    };

    it('AC-0014-10: filtra por conta e janela inclusiva, em ordem de occurredOn', async () => {
        const other = await fx.makeAccount('2-2');
        const late = await fx.seed('OPEN', { occurredOn: '2026-03-31' });
        const early = await fx.seed('OPEN', { occurredOn: '2026-03-01' });
        const mid = await fx.seed('RECEIVED', { occurredOn: '2026-03-15' });
        await fx.seed('OPEN', { occurredOn: '2026-02-28' });
        await fx.seed('OPEN', { occurredOn: '2026-04-01' });
        await fx.seed('OPEN', { occurredOn: '2026-03-10', bankAccountId: other.id });

        const response = await list(`?from=2026-03-01&to=2026-03-31&bankAccountId=${fx.accountId}`);

        expect(ids(response)).toEqual([early, mid, late]);
        expect(response.body.data[0].earningType.name).toBe('Teste Tipo');
    });

    it('desempata por createdAt quando occurredOn é igual', async () => {
        const first = await fx.seed('OPEN');
        const second = await fx.seed('OPEN');

        expect(ids(await list(''))).toEqual([first, second]);
    });

    it('filtra por status, kind, earningTypeId e installmentGroupId, combinados por E', async () => {
        const [type] = (await fx.ctx.dataSource.query(
            "INSERT INTO earning_types (name) VALUES ('Teste Outro') RETURNING id",
        )) as Array<{ id: string }>;
        const groupId = '11111111-1111-4111-8111-111111111111';
        const a = await fx.seed('OPEN', { earningTypeId: type!.id });
        const forecast = await fx.seed('FORECAST', { earningTypeId: type!.id });
        const installment = await fx.seed('OPEN', {
            kind: 'INSTALLMENT',
            installmentGroupId: groupId,
            installmentNumber: 1,
            installmentTotal: 2,
        });
        await fx.seed('RECEIVED');

        expect(ids(await list('?status=FORECAST'))).toEqual([forecast]);
        expect(ids(await list(`?earningTypeId=${type!.id}&status=OPEN`))).toEqual([a]);
        expect(ids(await list('?kind=INSTALLMENT'))).toEqual([installment]);
        expect(ids(await list(`?installmentGroupId=${groupId}`))).toEqual([installment]);
        expect(ids(await list('?status=VERIFYING'))).toEqual([]);
    });

    it.each([
        '?from=2026-04-01&to=2026-03-01',
        '?from=2026-13-01',
        '?status=NOPE',
        '?kind=NOPE',
        '?bankAccountId=abc',
        '?unknown=1',
    ])('ERR-0014-13: filtro inválido %s é 400 VALIDATION_ERROR', async (query) => {
        const response = await list(query);

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('from > to cita os dois campos', async () => {
        const response = await list('?from=2026-04-01&to=2026-03-01');

        const text = JSON.stringify(response.body.error);
        expect(text).toContain('from');
        expect(text).toContain('to');
    });

    it('GET /earnings/:id devolve a receita com o tipo aninhado', async () => {
        const id = await fx.seed('RECEIVED');

        const response = await request(fx.ctx.app)
            .get(`/earnings/${id}`)
            .set('Authorization', BILLER);

        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({
            id,
            status: 'RECEIVED',
            receivedOn: '2026-03-06',
            installment: null,
            earningType: { id: fx.typeId },
        });
    });

    it('ERR-0014-02: id inexistente é 404 EARNING_NOT_FOUND e malformado é 400', async () => {
        const missing = await request(fx.ctx.app)
            .get(`/earnings/${MISSING}`)
            .set('Authorization', BILLER);
        const malformed = await request(fx.ctx.app)
            .get('/earnings/abc')
            .set('Authorization', BILLER);

        expect(missing.status).toBe(404);
        expect(missing.body.error.code).toBe('EARNING_NOT_FOUND');
        expect(malformed.status).toBe(400);
    });
});
