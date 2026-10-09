import request from 'supertest';

import { stopApp } from '../app.helper';
import { ADMIN, seedReporting, type ReportingFixture } from './reporting-fixtures.helper';

const SCHEMA = 'test_reporting_by_type';

type ByTypeBody = {
    data: {
        from: string;
        to: string;
        includeForecast: boolean;
        months: Array<{
            month: string;
            totalCents: number;
            refundsCents?: number;
            byType: Array<{ typeId: string; name: string; totalCents: number }>;
        }>;
    };
};

describe('relatórios por tipo (spec 0015, AC-0015-07, AC-0015-08, INV-0015-07)', () => {
    let fx: ReportingFixture;
    let otherExpenseTypeId: string;
    let otherEarningTypeId: string;

    const get = (path: string) => request(fx.ctx.app).get(path).set('Authorization', ADMIN);

    const insertExpense = (
        typeId: string,
        status: string,
        cents: number,
        occurredOn: string,
        card = false,
    ) =>
        fx.ctx.dataSource.query(
            `INSERT INTO expenses (description, expense_type_id, kind, status, amount_cents,
                                   occurred_on, paid_on, bank_account_id, credit_card_id, posted_on)
             VALUES ('Despesa', $1, 'VARIABLE', $2, $3::numeric / 100, $4,
                     CASE WHEN $2 = 'PAID' THEN $4::date END,
                     CASE WHEN $5 THEN NULL ELSE $6::uuid END,
                     CASE WHEN $5 THEN $7::uuid END,
                     CASE WHEN $5 THEN $4::date END)`,
            [typeId, status, cents, occurredOn, card, fx.accountId, fx.cardId],
        );

    const insertEarning = (typeId: string, status: string, cents: number, occurredOn: string) =>
        fx.ctx.dataSource.query(
            `INSERT INTO earnings (description, earning_type_id, kind, status, amount_cents,
                                   occurred_on, received_on, bank_account_id)
             VALUES ('Receita', $1, 'VARIABLE', $2, $3::numeric / 100, $4,
                     CASE WHEN $2 = 'RECEIVED' THEN $4::date END, $5)`,
            [typeId, status, cents, occurredOn, fx.accountId],
        );

    beforeAll(async () => {
        fx = await seedReporting(SCHEMA, 0);

        const expenseType = await request(fx.ctx.app)
            .post('/expense-types')
            .set('Authorization', ADMIN)
            .send({ name: 'T-Lazer' });
        const earningType = await request(fx.ctx.app)
            .post('/earning-types')
            .set('Authorization', ADMIN)
            .send({ name: 'T-Freela' });

        otherExpenseTypeId = (expenseType.body as { data: { id: string } }).data.id;
        otherEarningTypeId = (earningType.body as { data: { id: string } }).data.id;

        // Março: Mercado 1000 (PAID) + 250,50 (OPEN, cartão) + 30 (OVERDUE); Lazer 5000 (VERIFYING).
        await insertExpense(fx.expenseTypeId, 'PAID', 100000, '2026-03-05');
        await insertExpense(fx.expenseTypeId, 'OPEN', 25050, '2026-03-20', true);
        await insertExpense(fx.expenseTypeId, 'OVERDUE', 3000, '2026-03-31');
        await insertExpense(otherExpenseTypeId, 'VERIFYING', 500000, '2026-03-10');
        // FORECAST de março (700) só entra com includeForecast.
        await insertExpense(fx.expenseTypeId, 'FORECAST', 70000, '2026-03-15');
        // Fora da janela de março.
        await insertExpense(fx.expenseTypeId, 'PAID', 99900, '2026-02-28');
        await insertExpense(fx.expenseTypeId, 'PAID', 88800, '2026-04-01');
        // Maio: só FORECAST.
        await insertExpense(otherExpenseTypeId, 'FORECAST', 12345, '2026-05-10');

        // Estornos de cartão: um em março (410,05) e outro em abril.
        await fx.ctx.dataSource.query(
            `INSERT INTO credit_card_refunds (credit_card_id, description, amount_cents, occurred_on, posted_on)
             VALUES ($1, 'Estorno', 41005::numeric / 100, '2026-03-12', '2026-03-12'),
                    ($1, 'Estorno', 1000::numeric / 100, '2026-04-02', '2026-04-02')`,
            [fx.cardId],
        );

        // Receitas: março Salário 3000 (RECEIVED) + 500 (OPEN), Freela 800 (OVERDUE), FORECAST 900.
        await insertEarning(fx.earningTypeId, 'RECEIVED', 300000, '2026-03-01');
        await insertEarning(fx.earningTypeId, 'OPEN', 50000, '2026-03-25');
        await insertEarning(otherEarningTypeId, 'OVERDUE', 80000, '2026-03-02');
        await insertEarning(otherEarningTypeId, 'FORECAST', 90000, '2026-03-18');
        await insertEarning(fx.earningTypeId, 'RECEIVED', 11100, '2026-02-10');
    });

    afterAll(async () => {
        await stopApp(fx?.ctx, SCHEMA);
    });

    describe('expenses-by-type', () => {
        it('soma as despesas comprometidas por occurredOn e exclui FORECAST por padrão', async () => {
            const res = await get('/reports/expenses-by-type?from=2026-03&to=2026-03');

            expect(res.status).toBe(200);

            const body = (res.body as ByTypeBody).data;

            expect(body).toMatchObject({ from: '2026-03', to: '2026-03', includeForecast: false });
            expect(body.months).toHaveLength(1);
            expect(body.months[0]).toMatchObject({
                month: '2026-03',
                totalCents: 628050,
                refundsCents: 41005,
            });
            expect(body.months[0]!.byType).toEqual([
                { typeId: otherExpenseTypeId, name: 'T-Lazer', totalCents: 500000 },
                { typeId: fx.expenseTypeId, name: 'T-Mercado', totalCents: 128050 },
            ]);
        });

        it('inclui FORECAST com includeForecast=true', async () => {
            const res = await get(
                '/reports/expenses-by-type?from=2026-03&to=2026-03&includeForecast=true',
            );
            const month = (res.body as ByTypeBody).data.months[0]!;

            expect(res.status).toBe(200);
            expect((res.body as ByTypeBody).data.includeForecast).toBe(true);
            expect(month.totalCents).toBe(698050);
            expect(month.byType.find((t) => t.typeId === fx.expenseTypeId)?.totalCents).toBe(
                198050,
            );
        });

        it('o estorno aparece em refundsCents sem abater o tipo', async () => {
            const month = (
                (await get('/reports/expenses-by-type?from=2026-03&to=2026-03')).body as ByTypeBody
            ).data.months[0]!;

            expect(month.refundsCents).toBe(41005);
            expect(month.byType.find((t) => t.typeId === fx.expenseTypeId)?.totalCents).toBe(
                128050,
            );
        });

        it('devolve todos os meses da janela, os vazios com total 0 e estornos pelo mês do estorno', async () => {
            const res = await get('/reports/expenses-by-type?from=2026-02&to=2026-05');
            const months = (res.body as ByTypeBody).data.months;

            expect(months.map((m) => m.month)).toEqual([
                '2026-02',
                '2026-03',
                '2026-04',
                '2026-05',
            ]);
            expect(months[0]).toMatchObject({ totalCents: 99900, refundsCents: 0 });
            expect(months[2]).toMatchObject({ totalCents: 88800, refundsCents: 1000 });
            // Maio só tem FORECAST: vazio por padrão.
            expect(months[3]).toEqual({
                month: '2026-05',
                totalCents: 0,
                refundsCents: 0,
                byType: [],
            });
        });

        it('a soma de byType é igual ao total de cada mês (INV-0015-07)', async () => {
            const res = await get(
                '/reports/expenses-by-type?from=2026-01&to=2026-06&includeForecast=true',
            );

            for (const month of (res.body as ByTypeBody).data.months) {
                expect(month.byType.reduce((sum, t) => sum + t.totalCents, 0)).toBe(
                    month.totalCents,
                );
            }
        });

        it('desempata tipos de mesmo total pelo nome', async () => {
            await insertExpense(fx.expenseTypeId, 'PAID', 1000, '2026-07-01');
            await insertExpense(otherExpenseTypeId, 'PAID', 1000, '2026-07-02');

            const month = (
                (await get('/reports/expenses-by-type?from=2026-07&to=2026-07')).body as ByTypeBody
            ).data.months[0]!;

            expect(month.byType.map((t) => t.name)).toEqual(['T-Lazer', 'T-Mercado']);
        });
    });

    describe('earnings-by-type', () => {
        it('agrupa as receitas comprometidas por tipo e mês, sem FORECAST por padrão', async () => {
            const res = await get('/reports/earnings-by-type?from=2026-02&to=2026-03');

            expect(res.status).toBe(200);

            const months = (res.body as ByTypeBody).data.months;

            expect(months[0]).toMatchObject({ month: '2026-02', totalCents: 11100 });
            expect(months[1]).toMatchObject({ month: '2026-03', totalCents: 430000 });
            expect(months[1]!.byType).toEqual([
                { typeId: fx.earningTypeId, name: 'T-Salário', totalCents: 350000 },
                { typeId: otherEarningTypeId, name: 'T-Freela', totalCents: 80000 },
            ]);
            expect(months[1]).not.toHaveProperty('refundsCents');
        });

        it('inclui FORECAST com includeForecast=true e a soma das partes bate o total', async () => {
            const res = await get(
                '/reports/earnings-by-type?from=2026-03&to=2026-03&includeForecast=true',
            );
            const month = (res.body as ByTypeBody).data.months[0]!;

            expect(month.totalCents).toBe(520000);
            expect(month.byType.reduce((sum, t) => sum + t.totalCents, 0)).toBe(month.totalCents);
        });
    });

    describe('validação', () => {
        it.each([
            ['from ausente', '?to=2026-03'],
            ['mês malformado', '?from=2026-3&to=2026-03'],
            ['mês 13', '?from=2026-13&to=2026-13'],
            ['from > to', '?from=2026-04&to=2026-03'],
            ['janela de 121 meses', '?from=2016-01&to=2026-01'],
            ['includeForecast inválido', '?from=2026-03&to=2026-03&includeForecast=yes'],
        ])('%s dá 400 VALIDATION_ERROR', async (_label, query) => {
            for (const path of ['expenses-by-type', 'earnings-by-type']) {
                const res = await get(`/reports/${path}${query}`);

                expect(res.status).toBe(400);
                expect((res.body as { error: { code: string } }).error.code).toBe(
                    'VALIDATION_ERROR',
                );
            }
        });

        it('aceita uma janela de exatamente 120 meses', async () => {
            const res = await get('/reports/expenses-by-type?from=2016-02&to=2026-01');

            expect(res.status).toBe(200);
            expect((res.body as ByTypeBody).data.months).toHaveLength(120);
        });

        it('exige autenticação', async () => {
            const res = await request(fx.ctx.app).get(
                '/reports/expenses-by-type?from=2026-03&to=2026-03',
            );

            expect(res.status).toBe(401);
        });
    });
});
