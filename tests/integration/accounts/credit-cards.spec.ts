import request from 'supertest';

import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_accounts_credit_cards';
const ADMIN = 'Bearer uid-admin';

describe('rotas de /credit-cards (spec 0011)', () => {
    let ctx: TestApp;
    let bankId: string;

    const createBank = async (febrabanCode: string, name: string): Promise<string> => {
        const { body } = await request(ctx.app)
            .post('/banks')
            .set('Authorization', ADMIN)
            .send({ febrabanCode, name });

        return body.data.id as string;
    };

    const createCard = (overrides: Record<string, unknown> = {}, auth = ADMIN) =>
        request(ctx.app)
            .post('/credit-cards')
            .set('Authorization', auth)
            .send({
                bankId,
                name: 'Platinum',
                creditLimitCents: 500000,
                closingDay: 28,
                dueDay: 5,
                ...overrides,
            });

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        await request(ctx.app).get('/users/me').set('Authorization', ADMIN);
        await ctx.setProfile('uid-admin', 'ADMIN');
        bankId = await createBank('260', 'Nu Pagamentos');
    });

    afterEach(async () => {
        await ctx.dataSource.query('DELETE FROM credit_cards');
        await ctx.dataSource.query('DELETE FROM banks');
    });

    describe('POST /credit-cards (AC-0011-01)', () => {
        it('cria com 201 e o corpo previsto', async () => {
            const response = await createCard();

            expect(response.status).toBe(201);
            expect(Object.keys(response.body.data)).toEqual([
                'id',
                'bank',
                'name',
                'creditLimitCents',
                'availableLimitCents',
                'closingDay',
                'dueDay',
                'currentCycle',
                'archivedAt',
                'createdAt',
            ]);
        });

        it('o limite disponível nasce igual ao total', async () => {
            const response = await createCard({ creditLimitCents: 123456 });

            expect(response.body.data).toMatchObject({
                creditLimitCents: 123456,
                availableLimitCents: 123456,
            });
        });

        it('já nasce operante, com o ciclo completo (AC-0011-04, INV-0011-06)', async () => {
            const response = await createCard();

            expect(Object.keys(response.body.data.currentCycle)).toEqual([
                'startsOn',
                'closesOn',
                'dueOn',
            ]);
            for (const value of Object.values(response.body.data.currentCycle)) {
                expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            }
        });

        it('o vencimento do ciclo é sempre posterior ao fechamento', async () => {
            const { body } = await createCard({ closingDay: 28, dueDay: 5 });
            const { closesOn, dueOn } = body.data.currentCycle;

            expect(new Date(dueOn).getTime()).toBeGreaterThan(new Date(closesOn).getTime());
        });

        it('recusa o limite disponível na entrada (INV-0011-04)', async () => {
            const response = await createCard({ availableLimitCents: 999 });

            expect(response.status).toBe(400);
            expect(JSON.stringify(response.body)).toContain('availableLimitCents');
        });

        it.each([0, -1])('recusa limite %i (ERR-0011-09)', async (creditLimitCents) => {
            const response = await createCard({ creditLimitCents });

            expect(response.status).toBe(400);
        });

        it('recusa limite com fração de centavo', async () => {
            const response = await createCard({ creditLimitCents: 1000.5 });

            expect(response.status).toBe(400);
        });

        it.each([0, 32, 1.5])('recusa dia %p (ERR-0011-08)', async (day) => {
            await expect(createCard({ closingDay: day })).resolves.toMatchObject({ status: 400 });
            await expect(createCard({ dueDay: day })).resolves.toMatchObject({ status: 400 });
        });

        it('recusa o mesmo nome no mesmo banco com 409 (ERR-0011-04)', async () => {
            await createCard({ name: 'Platinum' });

            const response = await createCard({ name: 'Platinum' });

            expect(response.status).toBe(409);
            expect(response.body.error.code).toBe('CREDIT_CARD_ALREADY_EXISTS');
        });

        it('aceita o mesmo nome em bancos diferentes', async () => {
            await createCard({ name: 'Platinum' });
            const outro = await createBank('341', 'Itaú');

            const response = await createCard({ bankId: outro, name: 'Platinum' });

            expect(response.status).toBe(201);
        });

        it('recusa banco arquivado com 409 (ERR-0011-07)', async () => {
            await ctx.dataSource.query('UPDATE banks SET archived_at = now() WHERE id = $1', [
                bankId,
            ]);

            const response = await createCard();

            expect(response.status).toBe(409);
            expect(response.body.error.code).toBe('BANK_ARCHIVED');
        });
    });

    describe('GET /credit-cards', () => {
        it('lista ordenado por nome, com banco e ciclo', async () => {
            await createCard({ name: 'Zeta' });
            await createCard({ name: 'Alfa' });

            const response = await request(ctx.app)
                .get('/credit-cards')
                .set('Authorization', ADMIN);

            expect(response.status).toBe(200);
            expect(response.body.data.map((card: { name: string }) => card.name)).toEqual([
                'Alfa',
                'Zeta',
            ]);
            expect(response.body.data[0].bank.febrabanCode).toBe('260');
            expect(response.body.data[0].currentCycle.closesOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });

        it('responde 404 para cartão inexistente (ERR-0011-06)', async () => {
            const response = await request(ctx.app)
                .get('/credit-cards/00000000-0000-4000-8000-000000000000')
                .set('Authorization', ADMIN);

            expect(response.status).toBe(404);
            expect(response.body.error.code).toBe('CREDIT_CARD_NOT_FOUND');
        });
    });

    describe('PATCH /credit-cards/:id (AC-0011-08)', () => {
        it('altera nome e dias do ciclo', async () => {
            const { body } = await createCard();

            const response = await request(ctx.app)
                .patch(`/credit-cards/${body.data.id}`)
                .set('Authorization', ADMIN)
                .send({ name: 'Black', closingDay: 10, dueDay: 20 });

            expect(response.status).toBe(200);
            expect(response.body.data).toMatchObject({ name: 'Black', closingDay: 10, dueDay: 20 });
        });

        it('alterar os dias muda o ciclo derivado na hora', async () => {
            const { body } = await createCard({ closingDay: 28, dueDay: 5 });
            const antes = body.data.currentCycle.closesOn;

            const response = await request(ctx.app)
                .patch(`/credit-cards/${body.data.id}`)
                .set('Authorization', ADMIN)
                .send({ closingDay: 10 });

            expect(response.body.data.currentCycle.closesOn).not.toBe(antes);
            expect(response.body.data.currentCycle.closesOn.slice(-2)).toBe('10');
        });

        it('recusa alterar o limite disponível', async () => {
            const { body } = await createCard();

            const response = await request(ctx.app)
                .patch(`/credit-cards/${body.data.id}`)
                .set('Authorization', ADMIN)
                .send({ availableLimitCents: 1 });

            expect(response.status).toBe(400);
            expect(JSON.stringify(response.body)).toContain('availableLimitCents');
        });

        describe('alterar o limite total move o disponível na mesma medida', () => {
            const gastar = async (cardId: string, cents: number) => {
                await ctx.dataSource.query(
                    'UPDATE credit_cards SET available_limit_cents = available_limit_cents - $1 WHERE id = $2',
                    [cents / 100, cardId],
                );
            };

            it('aumentar o limite preserva o quanto já foi gasto', async () => {
                const { body } = await createCard({ creditLimitCents: 500000 });
                await gastar(body.data.id, 300000);

                const response = await request(ctx.app)
                    .patch(`/credit-cards/${body.data.id}`)
                    .set('Authorization', ADMIN)
                    .send({ creditLimitCents: 800000 });

                expect(response.body.data).toMatchObject({
                    creditLimitCents: 800000,
                    availableLimitCents: 500000,
                });
            });

            it('reduzir abaixo do que já foi gasto deixa o disponível negativo', async () => {
                const { body } = await createCard({ creditLimitCents: 500000 });
                await gastar(body.data.id, 300000);

                const response = await request(ctx.app)
                    .patch(`/credit-cards/${body.data.id}`)
                    .set('Authorization', ADMIN)
                    .send({ creditLimitCents: 100000 });

                expect(response.body.data.availableLimitCents).toBe(-200000);
            });

            it('alterar só o nome não mexe no disponível', async () => {
                const { body } = await createCard({ creditLimitCents: 500000 });
                await gastar(body.data.id, 300000);

                const response = await request(ctx.app)
                    .patch(`/credit-cards/${body.data.id}`)
                    .set('Authorization', ADMIN)
                    .send({ name: 'Outro' });

                expect(response.body.data.availableLimitCents).toBe(200000);
            });
        });

        it('responde 404 para cartão inexistente', async () => {
            const response = await request(ctx.app)
                .patch('/credit-cards/00000000-0000-4000-8000-000000000000')
                .set('Authorization', ADMIN)
                .send({ name: 'Fantasma' });

            expect(response.status).toBe(404);
        });
    });

    describe('autorização (AC-0011-12)', () => {
        it.each(['BILLER', 'VIEWER'] as const)('%s lê, mas não escreve', async (profile) => {
            await request(ctx.app).get('/users/me').set('Authorization', 'Bearer uid-comum');
            await ctx.setProfile('uid-comum', profile);

            const leitura = await request(ctx.app)
                .get('/credit-cards')
                .set('Authorization', 'Bearer uid-comum');
            expect(leitura.status).toBe(200);

            const escrita = await createCard({}, 'Bearer uid-comum');
            expect(escrita.status).toBe(403);
        });
    });
});
