import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { stopApp, type TestApp } from '../app.helper';
import type { ReportingFixture } from './reporting-fixtures.helper';

type Profile = 'ADMIN' | 'BILLER' | 'VIEWER' | null;

type ErrorBody = { error: { code?: string; message: string; details?: unknown } };

/**
 * Validação comum dos parâmetros e autorização de um relatório (spec 0015, AC-0015-10,
 * AC-0015-11, ERR-0015-01 a ERR-0015-04). Cada `describe` abre o seu próprio app, em schema
 * próprio, para o arquivo poder receber os de outros relatórios sem depender de ordem.
 */
const describeReport = (
    route: string,
    schema: string,
    options: { includeForecast: boolean; bankAccountId: boolean },
): void => {
    describe(`validação e autorização de ${route}`, () => {
        let ctx: TestApp;

        const as = async (profile: Profile): Promise<string> => {
            const uid = `uid-${profile ?? 'pending'}-reports`;

            await request(ctx.app).get('/users/me').set('Authorization', `Bearer ${uid}`);
            await ctx.setProfile(uid, profile);

            return `Bearer ${uid}`;
        };

        const get = async (query: string, profile: Profile = 'ADMIN') =>
            request(ctx.app)
                .get(`${route}${query}`)
                .set('Authorization', await as(profile));

        beforeAll(async () => {
            // O container é um singleton de módulo e os serviços guardam o `DataSource`: cada
            // describe carrega o seu próprio, para não reusar o banco já derrubado de outro.
            await jest.isolateModulesAsync(async () => {
                const helper = await import('../app.helper');

                ctx = await helper.startApp(schema);
            });
        });

        afterAll(async () => {
            await stopApp(ctx, schema);
        });

        describe('janela from/to (AC-0015-10, ERR-0015-01, ERR-0015-02)', () => {
            it.each([
                ['from ausente', '?to=2026-03', 'from'],
                ['to ausente', '?from=2026-03', 'to'],
                ['mês malformado', '?from=2026-3&to=2026-03', 'from'],
                ['mês 13', '?from=2026-03&to=2026-13', 'to'],
                ['data completa', '?from=2026-03-01&to=2026-03', 'from'],
                ['from depois de to', '?from=2026-04&to=2026-03', 'from'],
            ])('%s recebe 400 VALIDATION_ERROR citando o campo', async (_name, query, field) => {
                const res = await get(query);

                expect(res.status).toBe(400);
                expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
                expect(JSON.stringify(res.body)).toContain(field);
            });

            it('janela de 121 meses recebe 400 e a de 120 meses passa', async () => {
                const tooLong = await get('?from=2026-01&to=2036-01');
                const limit = await get('?from=2026-01&to=2035-12');

                expect(tooLong.status).toBe(400);
                expect((tooLong.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
                expect(limit.status).toBe(200);
            });

            it('parâmetro desconhecido recebe 400', async () => {
                const res = await get('?from=2026-03&to=2026-03&foo=1');

                expect(res.status).toBe(400);
                expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
            });
        });

        if (options.includeForecast) {
            it('includeForecast fora de true/false recebe 400 (ERR-0015-04)', async () => {
                for (const value of ['yes', '1', 'TRUE', '']) {
                    const res = await get(`?from=2026-03&to=2026-03&includeForecast=${value}`);

                    expect(res.status).toBe(400);
                    expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
                }

                const ok = await get('?from=2026-03&to=2026-03&includeForecast=false');

                expect(ok.status).toBe(200);
            });
        }

        if (options.bankAccountId) {
            it('bankAccountId inexistente recebe 404 BANK_ACCOUNT_NOT_FOUND (ERR-0015-03)', async () => {
                const res = await get(`?from=2026-03&to=2026-03&bankAccountId=${randomUUID()}`);

                expect(res.status).toBe(404);
                expect((res.body as ErrorBody).error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
            });

            it('bankAccountId que não é UUID recebe 400', async () => {
                const res = await get('?from=2026-03&to=2026-03&bankAccountId=abc');

                expect(res.status).toBe(400);
                expect((res.body as ErrorBody).error.code).toBe('VALIDATION_ERROR');
            });
        }

        describe('autorização (AC-0015-11)', () => {
            it.each(['ADMIN', 'BILLER', 'VIEWER'] as const)(
                '%s lê o relatório',
                async (profile) => {
                    const res = await get('?from=2026-03&to=2026-03', profile);

                    expect(res.status).toBe(200);
                },
            );

            it('sem perfil recebe 403 PROFILE_PENDING', async () => {
                const res = await get('?from=2026-03&to=2026-03', null);

                expect(res.status).toBe(403);
                expect((res.body as ErrorBody).error.code).toBe('PROFILE_PENDING');
            });

            it('sem token recebe 401', async () => {
                const res = await request(ctx.app).get(`${route}?from=2026-03&to=2026-03`);

                expect(res.status).toBe(401);
            });
        });
    });
};

describeReport('/reports/expenses-by-type', 'test_reporting_validation_expenses', {
    includeForecast: true,
    bankAccountId: false,
});

describeReport('/reports/earnings-by-type', 'test_reporting_validation_earnings', {
    includeForecast: true,
    bankAccountId: false,
});

describeReport('/reports/cash-flow', 'test_reporting_validation_cash_flow', {
    includeForecast: false,
    bankAccountId: true,
});

describe('GET /reports/balance', () => {
    const SCHEMA = 'test_reporting_balance_validation';
    const ADMIN = 'Bearer uid-admin';
    let fx: ReportingFixture;
    let stop: () => Promise<void>;

    const get = (query: string, auth: string = ADMIN) =>
        request(fx.ctx.app).get(`/reports/balance${query}`).set('Authorization', auth);

    const as = async (profile: 'VIEWER' | null): Promise<string> => {
        const uid = `uid-${profile ?? 'pending'}-balance`;

        await request(fx.ctx.app).get('/users/me').set('Authorization', `Bearer ${uid}`);
        await fx.ctx.setProfile(uid, profile);

        return `Bearer ${uid}`;
    };

    // Each top-level describe of this file opens its own app in an isolated module registry:
    // the singletons of the first app are bound to the DataSource the first teardown drops.
    beforeAll(async () => {
        await jest.isolateModulesAsync(async () => {
            const helpers = await import('./reporting-fixtures.helper');
            const app = await import('../app.helper');

            fx = await helpers.seedReporting(SCHEMA, 100000);
            stop = () => app.stopApp(fx.ctx, SCHEMA);
        });
    });

    afterAll(async () => {
        await stop?.();
    });

    it('AC-0015-10: from > to, mês malformado, ausente e janela de 121 meses recebem 400', async () => {
        const rejected = [
            '?from=2026-05&to=2026-03',
            '?from=2026-13&to=2026-14',
            '?from=2026-3&to=2026-04',
            '?to=2026-04',
            '?from=2026-01',
            '?from=2020-01&to=2030-01',
            '?from=2026-01&to=2026-02&bankAccountId=not-a-uuid',
        ];

        for (const query of rejected) {
            const res = await get(query);

            expect([query, res.status]).toEqual([query, 400]);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
        }
    });

    it('AC-0015-10: a janela de 120 meses é aceita', async () => {
        const res = await get('?from=2026-01&to=2035-12');

        expect(res.status).toBe(200);
        expect(res.body.data.points).toHaveLength(120);
    });

    it('AC-0015-10: bankAccountId inexistente recebe 404 BANK_ACCOUNT_NOT_FOUND', async () => {
        const res = await get(`?from=2026-01&to=2026-02&bankAccountId=${randomUUID()}`);

        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
    });

    it('AC-0015-11: VIEWER lê; sem perfil recebe 403 PROFILE_PENDING; sem token, 401', async () => {
        const viewer = await get('?from=2026-01&to=2026-02', await as('VIEWER'));
        const pending = await get('?from=2026-01&to=2026-02', await as(null));
        const anonymous = await request(fx.ctx.app).get('/reports/balance?from=2026-01&to=2026-02');

        expect(viewer.status).toBe(200);
        expect(pending.status).toBe(403);
        expect(pending.body.error.code).toBe('PROFILE_PENDING');
        expect(anonymous.status).toBe(401);
    });
});
