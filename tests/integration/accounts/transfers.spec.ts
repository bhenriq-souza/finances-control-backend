import request from 'supertest';
import type { DataSource } from 'typeorm';

import { BankAccount } from '../../../src/accounts';
import { startApp, stopApp, type TestApp } from '../app.helper';

const SCHEMA = 'test_accounts_transfers';
const BILLER = 'Bearer uid-biller';
const MISSING = '00000000-0000-4000-8000-000000000000';

describe('criação e status de /bank-transfers (spec 0018)', () => {
    let ctx: TestApp;
    let dataSource: DataSource;
    let accountA: string;
    let accountB: string;

    beforeAll(async () => {
        ctx = await startApp(SCHEMA);
        dataSource = ctx.dataSource;
    });

    afterAll(async () => {
        await stopApp(ctx, SCHEMA);
    });

    beforeEach(async () => {
        await request(ctx.app).get('/users/me').set('Authorization', BILLER);
        await ctx.setProfile('uid-biller', 'BILLER');

        const [bank] = await dataSource.query<{ id: string }[]>(
            "INSERT INTO banks (febraban_code, name) VALUES ('260', 'Nu Pagamentos') RETURNING id",
        );
        const repository = dataSource.getRepository(BankAccount);
        const make = (accountNumber: string, balance: number) =>
            repository.save(
                repository.create({
                    bankId: bank!.id,
                    type: 'CHECKING',
                    accountNumber,
                    description: accountNumber,
                    openingBalanceCents: balance,
                    currentBalanceCents: balance,
                    overdraftLimitCents: 0,
                    archivedAt: null,
                }),
            );

        accountA = (await make('A', 100000)).id;
        accountB = (await make('B', 5000)).id;
    });

    afterEach(async () => {
        await dataSource.query('DELETE FROM bank_transfers');
        await dataSource.query('DELETE FROM bank_accounts');
        await dataSource.query('DELETE FROM banks');
    });

    const balanceOf = async (id: string): Promise<number> =>
        (await dataSource.getRepository(BankAccount).findOneByOrFail({ id })).currentBalanceCents;

    const transfer = (body: Record<string, unknown> = {}) =>
        request(ctx.app)
            .post('/bank-transfers')
            .set('Authorization', BILLER)
            .send({
                fromBankAccountId: accountA,
                toBankAccountId: accountB,
                amountCents: 30000,
                occurredOn: '2026-03-10',
                description: 'Reserva',
                ...body,
            });

    const changeStatus = (id: string, body: Record<string, unknown>) =>
        request(ctx.app)
            .patch(`/bank-transfers/${id}/status`)
            .set('Authorization', BILLER)
            .send(body);

    it('devolve o corpo previsto, com o default COMPLETED e completedOn = occurredOn', async () => {
        const response = await transfer({ notes: 'obs' });

        expect(response.status).toBe(201);
        expect(Object.keys(response.body.data)).toEqual([
            'id',
            'fromBankAccountId',
            'toBankAccountId',
            'amountCents',
            'occurredOn',
            'status',
            'completedOn',
            'description',
            'notes',
            'createdAt',
            'updatedAt',
        ]);
        expect(response.body.data).toMatchObject({
            status: 'COMPLETED',
            completedOn: '2026-03-10',
            occurredOn: '2026-03-10',
            notes: 'obs',
        });
    });

    it('AC-0018-07: transferir de conta arquivada recebe 409 BANK_ACCOUNT_ARCHIVED, e para ela também', async () => {
        await dataSource.query('UPDATE bank_accounts SET archived_at = now() WHERE id = $1', [
            accountA,
        ]);

        const fromArchived = await transfer();

        expect(fromArchived.status).toBe(409);
        expect(fromArchived.body.error.code).toBe('BANK_ACCOUNT_ARCHIVED');

        await dataSource.query('UPDATE bank_accounts SET archived_at = NULL');
        await dataSource.query('UPDATE bank_accounts SET archived_at = now() WHERE id = $1', [
            accountB,
        ]);

        const toArchived = await transfer();

        expect(toArchived.status).toBe(409);
        expect(toArchived.body.error.code).toBe('BANK_ACCOUNT_ARCHIVED');
        expect(await balanceOf(accountA)).toBe(100000);
    });

    it('AC-0018-07: saldo insuficiente é aceito e a origem fica negativa', async () => {
        const response = await transfer({ amountCents: 150000 });

        expect(response.status).toBe(201);
        expect(await balanceOf(accountA)).toBe(-50000);
        expect(await balanceOf(accountB)).toBe(155000);
    });

    it('concluir e desfazer com conta arquivada é aceito', async () => {
        const created = await transfer({ status: 'SCHEDULED' });
        const id = created.body.data.id as string;

        await dataSource.query('UPDATE bank_accounts SET archived_at = now()');

        expect((await changeStatus(id, { status: 'COMPLETED' })).status).toBe(200);
        expect((await changeStatus(id, { status: 'SCHEDULED' })).status).toBe(200);
        expect(await balanceOf(accountA)).toBe(100000);
    });

    it('ERR-0018-01: origem igual ao destino é 400 citando os dois campos', async () => {
        const response = await transfer({ toBankAccountId: accountA });

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
        expect(JSON.stringify(response.body.error)).toContain('fromBankAccountId');
        expect(JSON.stringify(response.body.error)).toContain('toBankAccountId');
    });

    it('ERR-0018-02: status de transferência inexistente é 404 BANK_TRANSFER_NOT_FOUND', async () => {
        const response = await changeStatus(MISSING, { status: 'COMPLETED' });

        expect(response.status).toBe(404);
        expect(response.body.error.code).toBe('BANK_TRANSFER_NOT_FOUND');
    });

    it('ERR-0018-03: conta inexistente é 404 BANK_ACCOUNT_NOT_FOUND', async () => {
        const fromMissing = await transfer({ fromBankAccountId: MISSING });
        const toMissing = await transfer({ toBankAccountId: MISSING });

        expect(fromMissing.status).toBe(404);
        expect(fromMissing.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
        expect(toMissing.status).toBe(404);
        expect(toMissing.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');
    });

    it.each([
        ['zero', { amountCents: 0 }, 'amountCents'],
        ['negativo', { amountCents: -5 }, 'amountCents'],
        ['fracionário', { amountCents: 10.5 }, 'amountCents'],
        [
            'completedOn com SCHEDULED',
            { status: 'SCHEDULED', completedOn: '2026-03-10' },
            'completedOn',
        ],
    ])('ERR-0018-05: %s é 400 citando o campo', async (_name, body, field) => {
        const response = await transfer(body);

        expect(response.status).toBe(400);
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
        expect(JSON.stringify(response.body.error)).toContain(field);
    });

    it('ERR-0018-05: completedOn com SCHEDULED também é 400 em …/status', async () => {
        const created = await transfer({ status: 'SCHEDULED' });
        const response = await changeStatus(created.body.data.id as string, {
            status: 'SCHEDULED',
            completedOn: '2026-03-10',
        });

        expect(response.status).toBe(400);
        expect(JSON.stringify(response.body.error)).toContain('completedOn');
    });

    it('ERR-0018-07: repetir o status atual é 409 BANK_TRANSFER_STATUS_UNCHANGED e não move saldo', async () => {
        const created = await transfer();
        const id = created.body.data.id as string;

        const same = await changeStatus(id, { status: 'COMPLETED' });

        expect(same.status).toBe(409);
        expect(same.body.error.code).toBe('BANK_TRANSFER_STATUS_UNCHANGED');
        expect(await balanceOf(accountA)).toBe(70000);

        const scheduled = await transfer({ status: 'SCHEDULED' });
        const again = await changeStatus(scheduled.body.data.id as string, {
            status: 'SCHEDULED',
        });

        expect(again.status).toBe(409);
        expect(again.body.error.code).toBe('BANK_TRANSFER_STATUS_UNCHANGED');
    });

    it('status simultâneos na mesma transferência movem o saldo uma vez só', async () => {
        const created = await transfer({ status: 'SCHEDULED' });
        const id = created.body.data.id as string;

        const responses = await Promise.all([
            changeStatus(id, { status: 'COMPLETED' }),
            changeStatus(id, { status: 'COMPLETED' }),
        ]);

        expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
        expect(await balanceOf(accountA)).toBe(70000);
    });

    describe('consulta, alteração e exclusão (T-0018-02)', () => {
        const get = (path: string) => request(ctx.app).get(path).set('Authorization', BILLER);
        const patch = (id: string, body: Record<string, unknown>) =>
            request(ctx.app).patch(`/bank-transfers/${id}`).set('Authorization', BILLER).send(body);
        const remove = (id: string) =>
            request(ctx.app).delete(`/bank-transfers/${id}`).set('Authorization', BILLER);
        const descriptions = (response: request.Response): string[] =>
            response.body.data.map((t: { description: string }) => t.description);

        it('AC-0018-11: bankAccountId lista as que saem e as que entram, em ordem de data', async () => {
            const repository = dataSource.getRepository(BankAccount);
            const { bankId } = await repository.findOneByOrFail({ id: accountA });
            const third = await repository.save(
                repository.create({
                    bankId,
                    type: 'CHECKING',
                    accountNumber: 'C',
                    description: 'C',
                    openingBalanceCents: 0,
                    currentBalanceCents: 0,
                    overdraftLimitCents: 0,
                    archivedAt: null,
                }),
            );

            await transfer({ occurredOn: '2026-03-12', description: 'saida' });
            await transfer({
                fromBankAccountId: third.id,
                toBankAccountId: accountA,
                occurredOn: '2026-03-05',
                description: 'entrada',
            });
            await transfer({
                fromBankAccountId: third.id,
                toBankAccountId: accountB,
                description: 'alheia',
            });

            const response = await get(`/bank-transfers?bankAccountId=${accountA}`);

            expect(response.status).toBe(200);
            expect(descriptions(response)).toEqual(['entrada', 'saida']);
        });

        it('filtra por status e por intervalo inclusivo de occurredOn', async () => {
            await transfer({ occurredOn: '2026-03-01', description: 'a' });
            await transfer({ occurredOn: '2026-03-10', status: 'SCHEDULED', description: 'b' });
            await transfer({ occurredOn: '2026-03-31', description: 'c' });

            expect(descriptions(await get('/bank-transfers?status=SCHEDULED'))).toEqual(['b']);
            expect(
                descriptions(await get('/bank-transfers?from=2026-03-10&to=2026-03-31')),
            ).toEqual(['b', 'c']);
        });

        it('ERR-0018-09: from > to é 400', async () => {
            const response = await get('/bank-transfers?from=2026-04-01&to=2026-03-01');

            expect(response.status).toBe(400);
            expect(response.body.error.code).toBe('VALIDATION_ERROR');
        });

        it('GET /:id devolve a transferência; ERR-0018-02 para id inexistente', async () => {
            const created = await transfer();

            const found = await get(`/bank-transfers/${created.body.data.id}`);
            expect(found.status).toBe(200);
            expect(found.body.data).toEqual(created.body.data);

            const missing = await get(`/bank-transfers/${MISSING}`);
            expect(missing.status).toBe(404);
            expect(missing.body.error.code).toBe('BANK_TRANSFER_NOT_FOUND');
        });

        it('AC-0018-06: concluída recusa valor, contas, data e exclusão, mas aceita description', async () => {
            const { id } = (await transfer()).body.data;

            for (const body of [
                { amountCents: 100 },
                { occurredOn: '2026-03-11' },
                { fromBankAccountId: accountB, toBankAccountId: accountA },
            ]) {
                const response = await patch(id, body);
                expect(response.status).toBe(409);
                expect(response.body.error.code).toBe('BANK_TRANSFER_ALREADY_COMPLETED');
            }

            const deleted = await remove(id);
            expect(deleted.status).toBe(409);
            expect(deleted.body.error.code).toBe('BANK_TRANSFER_ALREADY_COMPLETED');

            const ok = await patch(id, { description: 'Nova', notes: 'obs' });
            expect(ok.status).toBe(200);
            expect(ok.body.data).toMatchObject({
                description: 'Nova',
                notes: 'obs',
                amountCents: 30000,
            });
            expect(await balanceOf(accountA)).toBe(70000);
            expect(await balanceOf(accountB)).toBe(35000);
        });

        it('AC-0018-06: agendada aceita alterar valor e contas sem mover saldo, e se exclui', async () => {
            const { id } = (await transfer({ status: 'SCHEDULED' })).body.data;

            const changed = await patch(id, {
                amountCents: 12345,
                occurredOn: '2026-04-01',
                fromBankAccountId: accountB,
                toBankAccountId: accountA,
            });
            expect(changed.status).toBe(200);
            expect(changed.body.data).toMatchObject({
                amountCents: 12345,
                occurredOn: '2026-04-01',
                fromBankAccountId: accountB,
                toBankAccountId: accountA,
            });
            expect(await balanceOf(accountA)).toBe(100000);
            expect(await balanceOf(accountB)).toBe(5000);

            expect((await remove(id)).status).toBe(204);
            expect((await get(`/bank-transfers/${id}`)).status).toBe(404);
            expect(await balanceOf(accountA)).toBe(100000);
        });

        it('INV-0018-06: desfazer e então excluir devolve os saldos', async () => {
            const { id } = (await transfer()).body.data;

            await changeStatus(id, { status: 'SCHEDULED' });
            expect((await remove(id)).status).toBe(204);
            expect(await balanceOf(accountA)).toBe(100000);
            expect(await balanceOf(accountB)).toBe(5000);
        });

        it.each(['status', 'completedOn'])(
            'ERR-0018-08: PATCH com %s é 400 citando o campo',
            async (field) => {
                const { id } = (await transfer({ status: 'SCHEDULED' })).body.data;

                const response = await patch(id, {
                    description: 'x',
                    [field]: field === 'status' ? 'COMPLETED' : '2026-03-10',
                });

                expect(response.status).toBe(400);
                expect(response.body.error.code).toBe('VALIDATION_ERROR');
                expect(JSON.stringify(response.body)).toContain(field);
            },
        );

        it('ERR-0018-01/03/04 e 404 na alteração de agendada', async () => {
            const { id } = (await transfer({ status: 'SCHEDULED' })).body.data;

            const same = await patch(id, { toBankAccountId: accountA });
            expect(same.status).toBe(400);
            expect(JSON.stringify(same.body)).toContain('fromBankAccountId');
            expect(JSON.stringify(same.body)).toContain('toBankAccountId');

            const ghost = await patch(id, { toBankAccountId: MISSING });
            expect(ghost.status).toBe(404);
            expect(ghost.body.error.code).toBe('BANK_ACCOUNT_NOT_FOUND');

            await dataSource.query('UPDATE bank_accounts SET archived_at = now() WHERE id = $1', [
                accountB,
            ]);
            const archived = await patch(id, { toBankAccountId: accountB });
            expect(archived.status).toBe(409);
            expect(archived.body.error.code).toBe('BANK_ACCOUNT_ARCHIVED');

            expect((await patch(MISSING, { description: 'x' })).status).toBe(404);
            expect((await remove(MISSING)).status).toBe(404);
            expect((await patch(id, { amountCents: 0 })).status).toBe(400);
        });
    });
});
