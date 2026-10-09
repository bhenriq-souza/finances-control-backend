import { randomUUID } from 'node:crypto';

import request from 'supertest';

import { container } from '../../../src/container';
import { EARNING_CREATED, type EarningCreated } from '../../../src/events';
import {
    EarningRecurrenceServiceSymbol,
    type EarningRecurrenceService,
} from '../../../src/earnings';
import { DomainEventDispatcherSymbol, type DomainEventDispatcher } from '../../../src/platform';
import { BILLER, useEarningFixtures } from './earning-fixtures.helper';

const FAKE_ONLY_DATE = [
    'hrtime',
    'nextTick',
    'performance',
    'queueMicrotask',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'requestIdleCallback',
    'cancelIdleCallback',
    'setImmediate',
    'clearImmediate',
    'setInterval',
    'clearInterval',
    'setTimeout',
    'clearTimeout',
] as const;

type Row = { d: string; status: string; amount: number; description: string };

/** A série de receitas `FIXED` (spec 0017, AC-0017-12): `RECEIVED` no papel de `PAID`. */
describe('série de receitas (spec 0017, AC-0017-12)', () => {
    const fx = useEarningFixtures('test_earnings_recurrence');
    let service: EarningRecurrenceService;
    let created: EarningCreated[];
    let unsubscribe: () => void;

    const atDate = async <T>(iso: string, run: () => Promise<T>): Promise<T> => {
        jest.useFakeTimers({
            now: new Date(`${iso}T15:00:00.000Z`),
            doNotFake: [...FAKE_ONLY_DATE],
        });

        try {
            return await run();
        } finally {
            jest.useRealTimers();
        }
    };

    const post = (body: Record<string, unknown>, clock = '2026-03-10') =>
        atDate(clock, () =>
            request(fx.ctx.app)
                .post('/earnings')
                .set('Authorization', BILLER)
                .send({
                    description: 'Salário',
                    earningTypeId: fx.typeId,
                    kind: 'FIXED',
                    amountCents: 500000,
                    occurredOn: '2026-03-10',
                    bankAccountId: fx.accountId,
                    ...body,
                }),
        );

    /** Série criada em 10/03 (13 ocorrências, 10/03/2026 a 10/03/2027); a primeira fica OPEN. */
    const createFixed = async (overrides: Record<string, unknown> = {}): Promise<string> => {
        const res = await post(overrides);

        expect(res.status).toBe(201);

        return (res.body.data as { recurrenceId: string }[])[0]?.recurrenceId as string;
    };

    const rows = async (): Promise<Record<string, Row>> =>
        Object.fromEntries(
            (
                (await fx.ctx.dataSource.query(
                    `SELECT occurred_on::text AS d, status, amount_cents::float * 100 AS amount,
                            description
                       FROM earnings ORDER BY occurred_on`,
                )) as Row[]
            ).map((row) => [row.d, row]),
        );

    const idOf = async (date: string): Promise<string> =>
        (
            (await fx.ctx.dataSource.query('SELECT id FROM earnings WHERE occurred_on = $1::date', [
                date,
            ])) as { id: string }[]
        )[0]?.id as string;

    const setStatus = async (date: string, status: string): Promise<void> => {
        await fx.ctx.dataSource.query(
            'UPDATE earnings SET status = $2, received_on = $3 WHERE occurred_on = $1::date',
            [date, status, status === 'RECEIVED' ? date : null],
        );
    };

    const recurrenceId = async (): Promise<string> =>
        (
            (await fx.ctx.dataSource.query('SELECT id FROM earning_recurrences')) as {
                id: string;
            }[]
        )[0]?.id as string;

    const series = async (): Promise<{ ends_on: string | null; amount: number } | undefined> =>
        (
            (await fx.ctx.dataSource.query(
                'SELECT ends_on::text, amount_cents::float * 100 AS amount FROM earning_recurrences',
            )) as { ends_on: string | null; amount: number }[]
        )[0];

    const patchFollowing = (id: string, body: Record<string, unknown>) =>
        atDate('2026-03-10', () =>
            request(fx.ctx.app)
                .patch(`/earnings/${id}?scope=following`)
                .set('Authorization', BILLER)
                .send(body),
        );

    const remove = (id: string) =>
        atDate('2026-03-10', () =>
            request(fx.ctx.app).delete(`/earnings/${id}`).set('Authorization', BILLER),
        );

    const patchSeries = (id: string, body: Record<string, unknown>, auth = BILLER) =>
        request(fx.ctx.app)
            .patch(`/earning-recurrences/${id}`)
            .set('Authorization', auth)
            .send(body);

    const extendAt = (iso: string): Promise<number> =>
        atDate(iso, () => service.extend(new Date(`${iso}T15:00:00Z`)));

    const promoteAt = (iso: string): Promise<number> =>
        atDate(iso, () => service.promote(new Date(`${iso}T15:00:00Z`)));

    beforeAll(() => {
        service = container.resolve<EarningRecurrenceService>(EarningRecurrenceServiceSymbol);
    });

    beforeEach(() => {
        created = [];
        unsubscribe = container
            .resolve<DomainEventDispatcher>(DomainEventDispatcherSymbol)
            .subscribe<EarningCreated>(EARNING_CREATED, (event) => {
                created.push(event);
            });
    });

    afterEach(() => {
        unsubscribe();
    });

    describe('criação', () => {
        it('AC-0017-12, INV-0017-04, INV-0017-05: cria a série até o horizonte; a primeira leva o status, o resto é FORECAST', async () => {
            const res = await post({ notes: 'obs' });

            expect(res.status).toBe(201);

            const data = res.body.data as {
                occurredOn: string;
                status: string;
                recurrenceId: string;
            }[];

            // 10/03/2026 a 10/03/2027: o horizonte é o fim de março do ano seguinte.
            expect(data).toHaveLength(13);
            expect(data[0]).toMatchObject({ occurredOn: '2026-03-10', status: 'OPEN' });
            expect(data.slice(1).every((row) => row.status === 'FORECAST')).toBe(true);
            expect(new Set(data.map((row) => row.recurrenceId)).size).toBe(1);
            expect(created).toHaveLength(13);

            const recurrence = (await fx.ctx.dataSource.query(
                `SELECT day_of_month, starts_on::text AS s, ends_on, notes, bank_account_id
                   FROM earning_recurrences`,
            )) as { day_of_month: number; s: string; ends_on: null; notes: string }[];

            expect(recurrence).toEqual([
                {
                    day_of_month: 10,
                    s: '2026-03-10',
                    ends_on: null,
                    notes: 'obs',
                    bank_account_id: fx.accountId,
                },
            ]);
        });

        it('a primeira ocorrência respeita o status informado', async () => {
            const res = await post({ status: 'FORECAST' });

            expect(res.status).toBe(201);
            expect((await rows())['2026-03-10']?.status).toBe('FORECAST');
        });

        it('recurrenceEndsOn limita a série e dia 31 cai no último dia dos meses curtos', async () => {
            const limited = await post({ recurrenceEndsOn: '2026-05-31' });

            expect(limited.status).toBe(201);
            expect(limited.body.data).toHaveLength(3);
            expect((await series())?.ends_on).toBe('2026-05-31');

            await fx.ctx.dataSource.query('DELETE FROM earnings');
            await fx.ctx.dataSource.query('DELETE FROM earning_recurrences');

            const end = await post({ occurredOn: '2026-01-31', recurrenceEndsOn: '2026-04-30' });

            expect(end.status).toBe(201);
            expect(
                (end.body.data as { occurredOn: string }[]).map((row) => row.occurredOn),
            ).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
        });

        it('ERR-0017-01: recurrenceEndsOn fora de FIXED ou antes de occurredOn é 400 citando o campo', async () => {
            for (const body of [
                { kind: 'VARIABLE', recurrenceEndsOn: '2026-05-31' },
                { recurrenceEndsOn: '2026-03-09' },
            ]) {
                const res = await post(body);

                expect(res.status).toBe(400);
                expect(res.body.error.code).toBe('VALIDATION_ERROR');
                expect(JSON.stringify(res.body.error)).toContain('recurrenceEndsOn');
            }

            expect(await rows()).toEqual({});
        });
    });

    describe('extensão e promoção', () => {
        it('INV-0017-04: extend um mês depois cria só o novo mês e é idempotente', async () => {
            await createFixed();
            created.length = 0;

            expect(await extendAt('2026-03-10')).toBe(0);
            expect(await extendAt('2026-04-10')).toBe(1);
            expect(Object.keys(await rows())).toHaveLength(14);
            expect((await rows())['2027-04-10']).toMatchObject({ status: 'FORECAST' });
            expect(created).toHaveLength(1);
            expect(await extendAt('2026-04-10')).toBe(0);
        });

        it('extend copia o modelo atual e respeita ends_on', async () => {
            await createFixed();
            await patchFollowing(await idOf('2026-05-10'), { amountCents: 600000 });

            expect(await extendAt('2026-04-10')).toBe(1);
            expect((await rows())['2027-04-10']?.amount).toBe(600000);

            await patchSeries(await recurrenceId(), { endsOn: '2026-12-10' });

            expect(await extendAt('2026-10-10')).toBe(0);
        });

        it('AC-0017-12, INV-0017-05: promote leva a OPEN as FORECAST vencidas e é idempotente', async () => {
            await createFixed();

            expect(await promoteAt('2026-05-10')).toBe(2);

            const state = await rows();

            expect(state['2026-04-10']?.status).toBe('OPEN');
            expect(state['2026-05-10']?.status).toBe('OPEN');
            expect(state['2026-06-10']?.status).toBe('FORECAST');
            expect(await promoteAt('2026-05-10')).toBe(0);
        });

        it('promote não toca FORECAST lançada à mão, sem série', async () => {
            const id = await fx.seed('FORECAST', { occurredOn: '2026-04-01' });

            expect(await promoteAt('2026-05-10')).toBe(0);
            expect(
                (
                    (await fx.ctx.dataSource.query('SELECT status FROM earnings WHERE id = $1', [
                        id,
                    ])) as { status: string }[]
                )[0]?.status,
            ).toBe('FORECAST');
        });

        it('a receita promovida recebe normalmente e move o saldo', async () => {
            await createFixed();
            await promoteAt('2026-04-10');

            const res = await request(fx.ctx.app)
                .patch(`/earnings/${await idOf('2026-04-10')}/status`)
                .set('Authorization', BILLER)
                .send({ status: 'RECEIVED' });

            expect(res.status).toBe(200);
            expect(await fx.balanceOf(fx.accountId)).toBe(1000 + 500000);
        });
    });

    describe('PATCH /earnings/:id?scope=following', () => {
        it('AC-0017-12, INV-0017-07: muda o modelo, a ocorrência e as FORECAST seguintes; nada mais', async () => {
            await createFixed();
            await setStatus('2026-04-10', 'RECEIVED');
            await setStatus('2026-05-10', 'OVERDUE');
            await setStatus('2026-07-10', 'OPEN');
            await setStatus('2026-08-10', 'RECEIVED');

            const res = await patchFollowing(await idOf('2026-06-10'), {
                amountCents: 600000,
                description: 'Salário reajustado',
                notes: 'reajuste',
            });

            expect(res.status).toBe(200);
            expect(res.body.data).toMatchObject({ amountCents: 600000, occurredOn: '2026-06-10' });
            expect(res.body.data.recurrenceId).toEqual(expect.any(String));

            const state = await rows();

            for (const date of ['2026-06-10', '2026-09-10', '2027-03-10']) {
                expect(state[date]).toMatchObject({
                    amount: 600000,
                    description: 'Salário reajustado',
                });
            }

            for (const date of [
                '2026-03-10',
                '2026-04-10',
                '2026-05-10',
                '2026-07-10',
                '2026-08-10',
            ]) {
                expect(state[date]).toMatchObject({ amount: 500000, description: 'Salário' });
            }

            expect(await series()).toMatchObject({ amount: 600000 });
        });

        it('trocar a conta com scope=following vale para o modelo e as FORECAST seguintes', async () => {
            await createFixed();
            await setStatus('2026-07-10', 'OPEN');

            const other = await fx.makeAccount('2-2');
            const res = await patchFollowing(await idOf('2026-06-10'), {
                bankAccountId: other.id,
            });

            expect(res.status).toBe(200);

            const accounts = (await fx.ctx.dataSource.query(
                'SELECT occurred_on::text AS d, bank_account_id AS a FROM earnings ORDER BY occurred_on',
            )) as { d: string; a: string }[];
            const byDate = Object.fromEntries(accounts.map((row) => [row.d, row.a]));

            expect(byDate['2026-06-10']).toBe(other.id);
            expect(byDate['2026-09-10']).toBe(other.id);
            expect(byDate['2026-05-10']).toBe(fx.accountId);
            expect(byDate['2026-07-10']).toBe(fx.accountId);
            expect(
                (
                    (await fx.ctx.dataSource.query(
                        'SELECT bank_account_id FROM earning_recurrences',
                    )) as { bank_account_id: string }[]
                )[0]?.bank_account_id,
            ).toBe(other.id);
        });

        it('sem scope altera só a ocorrência e deixa o modelo', async () => {
            await createFixed();

            const res = await request(fx.ctx.app)
                .patch(`/earnings/${await idOf('2026-06-10')}`)
                .set('Authorization', BILLER)
                .send({ amountCents: 600000 });

            expect(res.status).toBe(200);
            expect((await rows())['2026-07-10']?.amount).toBe(500000);
            expect(await series()).toMatchObject({ amount: 500000 });
        });

        it('ERR-0017-02: scope=following em receita sem série é 400 citando scope', async () => {
            const id = await fx.seed('OPEN');
            const res = await patchFollowing(id, { amountCents: 2000 });

            expect(res.status).toBe(400);
            expect(res.body.error.code).toBe('VALIDATION_ERROR');
            expect(JSON.stringify(res.body.error)).toContain('scope');

            expect(
                (
                    await request(fx.ctx.app)
                        .patch(`/earnings/${id}?scope=all`)
                        .set('Authorization', BILLER)
                        .send({ amountCents: 2000 })
                ).status,
            ).toBe(400);
        });

        it('receita inexistente com scope é 404', async () => {
            const res = await patchFollowing(randomUUID(), { amountCents: 2000 });

            expect(res.status).toBe(404);
            expect(res.body.error.code).toBe('EARNING_NOT_FOUND');
        });
    });

    describe('DELETE /earnings/:id numa ocorrência de série', () => {
        it('AC-0017-12, INV-0017-06: exclui a ocorrência e as seguintes não recebidas; ends_on = 09/06', async () => {
            await createFixed();
            await setStatus('2026-04-10', 'RECEIVED');
            await setStatus('2026-05-10', 'OVERDUE');
            await setStatus('2026-08-10', 'RECEIVED');

            const res = await remove(await idOf('2026-06-10'));

            expect(res.status).toBe(204);
            expect(Object.keys(await rows())).toEqual([
                '2026-03-10',
                '2026-04-10',
                '2026-05-10',
                '2026-08-10',
            ]);
            expect((await series())?.ends_on).toBe('2026-06-09');
        });

        it('a ocorrência recebida não se exclui (409), e nada muda', async () => {
            await createFixed();
            await setStatus('2026-06-10', 'RECEIVED');

            const res = await remove(await idOf('2026-06-10'));

            expect(res.status).toBe(409);
            expect(res.body.error.code).toBe('EARNING_ALREADY_RECEIVED');
            expect(Object.keys(await rows())).toHaveLength(13);
            expect((await series())?.ends_on).toBeNull();
        });

        it('excluir a primeira sem nada que fique remove a série; com recebida posterior, a série encolhe a ela', async () => {
            await createFixed();
            expect((await remove(await idOf('2026-03-10'))).status).toBe(204);
            expect(await rows()).toEqual({});
            expect(await series()).toBeUndefined();

            await createFixed();
            await setStatus('2026-08-10', 'RECEIVED');
            expect((await remove(await idOf('2026-03-10'))).status).toBe(204);
            expect(Object.keys(await rows())).toEqual(['2026-08-10']);
            expect(
                (
                    (await fx.ctx.dataSource.query(
                        'SELECT starts_on::text AS s, ends_on::text AS e FROM earning_recurrences',
                    )) as { s: string; e: string }[]
                )[0],
            ).toEqual({ s: '2026-08-10', e: '2026-08-10' });
        });
    });

    describe('/earning-recurrences', () => {
        it('AC-0017-12: endsOn exclui as FORECAST posteriores e mantém as demais', async () => {
            const id = await createFixed();
            await setStatus('2026-05-10', 'OPEN');
            await setStatus('2026-08-10', 'RECEIVED');

            const res = await patchSeries(id, { endsOn: '2026-05-20' });

            expect(res.status).toBe(200);
            expect(res.body.data).toMatchObject({ id, endsOn: '2026-05-20', dayOfMonth: 10 });
            expect(Object.keys(await rows())).toEqual([
                '2026-03-10',
                '2026-04-10',
                '2026-05-10',
                '2026-08-10',
            ]);
        });

        it('ERR-0017-03: campo além de endsOn, endsOn ausente ou antes de startsOn é 400 citando o campo', async () => {
            const id = await createFixed();

            const extra = await patchSeries(id, { endsOn: '2026-05-20', amountCents: 1 });

            expect(extra.status).toBe(400);
            expect(extra.body.error.code).toBe('VALIDATION_ERROR');
            expect(JSON.stringify(extra.body.error)).toContain('amountCents');

            const empty = await patchSeries(id, {});

            expect(empty.status).toBe(400);
            expect(JSON.stringify(empty.body.error)).toContain('endsOn');

            const early = await patchSeries(id, { endsOn: '2026-03-09' });

            expect(early.status).toBe(400);
            expect(JSON.stringify(early.body.error)).toContain('endsOn');
            expect(Object.keys(await rows())).toHaveLength(13);
        });

        it('ERR-0017-04: série inexistente é 404 EARNING_RECURRENCE_NOT_FOUND', async () => {
            const missing = randomUUID();

            for (const res of [
                await request(fx.ctx.app)
                    .get(`/earning-recurrences/${missing}`)
                    .set('Authorization', BILLER),
                await patchSeries(missing, { endsOn: '2026-05-20' }),
            ]) {
                expect(res.status).toBe(404);
                expect(res.body.error.code).toBe('EARNING_RECURRENCE_NOT_FOUND');
            }
        });

        it('GET devolve a série sem creditCardId e com nextOccurrenceOn; active=true tira as encerradas', async () => {
            const open = await createFixed();
            const ended = await createFixed({ description: 'Freela' });

            await patchSeries(ended, { endsOn: '2026-05-20' });

            const get = await atDate('2026-04-12', () =>
                request(fx.ctx.app)
                    .get(`/earning-recurrences/${open}`)
                    .set('Authorization', BILLER),
            );

            expect(get.status).toBe(200);
            expect(get.body.data).toEqual({
                id: open,
                description: 'Salário',
                typeId: fx.typeId,
                amountCents: 500000,
                dayOfMonth: 10,
                bankAccountId: fx.accountId,
                startsOn: '2026-03-10',
                endsOn: null,
                nextOccurrenceOn: '2026-05-10',
                createdAt: expect.any(String),
                updatedAt: expect.any(String),
            });

            const all = await atDate('2026-08-01', () =>
                request(fx.ctx.app).get('/earning-recurrences').set('Authorization', BILLER),
            );
            const active = await atDate('2026-08-01', () =>
                request(fx.ctx.app)
                    .get('/earning-recurrences?active=true')
                    .set('Authorization', BILLER),
            );

            expect((all.body.data as { id: string }[]).map((row) => row.id).sort()).toEqual(
                [open, ended].sort(),
            );
            expect((active.body.data as { id: string }[]).map((row) => row.id)).toEqual([open]);
            expect(
                (
                    await request(fx.ctx.app)
                        .get('/earning-recurrences?active=maybe')
                        .set('Authorization', BILLER)
                ).status,
            ).toBe(400);
        });

        it('VIEWER lê, mas recebe 403 no PATCH da série', async () => {
            const id = await createFixed();
            const uid = 'uid-viewer-earning-recurrence';

            await request(fx.ctx.app).get('/users/me').set('Authorization', `Bearer ${uid}`);
            await fx.ctx.setProfile(uid, 'VIEWER');

            const viewer = `Bearer ${uid}`;

            expect(
                (
                    await request(fx.ctx.app)
                        .get(`/earning-recurrences/${id}`)
                        .set('Authorization', viewer)
                ).status,
            ).toBe(200);
            expect(
                (await request(fx.ctx.app).get('/earning-recurrences').set('Authorization', viewer))
                    .status,
            ).toBe(200);

            const res = await patchSeries(id, { endsOn: '2026-05-20' }, viewer);

            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe('FORBIDDEN');
            expect(Object.keys(await rows())).toHaveLength(13);
        });
    });
});
