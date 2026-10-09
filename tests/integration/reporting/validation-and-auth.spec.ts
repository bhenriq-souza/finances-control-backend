import { randomUUID } from 'node:crypto';

import request from 'supertest';

import type { ReportingFixture } from './reporting-fixtures.helper';

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
