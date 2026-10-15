import 'reflect-metadata';
import type { DataSource } from 'typeorm';

import { EnvService } from '@bhs-dev/typescript-common-env';

import { container } from '../../../src/container';
import { StatementPaymentService } from '../../../src/statements';
import { businessToday } from '../../../src/platform';
import { composeLoad, LOAD_ENV_LIST, type LoadServices } from '../../../src/load/compose';
import type { LoadPlan } from '../../../src/load/plan';
import { validateLoad, type LoadFiles } from '../../../src/load/validate';
import { writePlan } from '../../../src/load/write';
import { fixtureFiles, withReplaced } from '../../load/load-fixtures';
import { createIsolatedDataSource, dropIsolatedDataSource } from '../database.helper';

const SCHEMA = 'test_load_initial';

const planOf = (files: LoadFiles = fixtureFiles()): LoadPlan => {
    const validation = validateLoad(files);
    expect(validation.errors).toEqual([]);
    return validation.plan;
};

describe('carga inicial: gravação pelos serviços (spec 0019)', () => {
    let dataSource: DataSource;
    let services: LoadServices;

    const count = async (table: string): Promise<number> => {
        const rows = (await dataSource.query(`SELECT count(*) AS n FROM ${table}`)) as [
            { n: string },
        ];
        return Number(rows[0].n);
    };

    beforeAll(async () => {
        dataSource = await createIsolatedDataSource(SCHEMA);
        await dataSource.runMigrations();
        services = await composeLoad(dataSource);
    });

    afterAll(async () => {
        await dropIsolatedDataSource(dataSource, SCHEMA);
    });

    it('AC-0019-10: o ambiente da carga só exige DATABASE_URL', () => {
        expect(LOAD_ENV_LIST.filter((variable) => variable.required).map((v) => v.key)).toEqual([
            'DATABASE_URL',
        ]);
        expect(
            () => new EnvService({ DATABASE_URL: 'postgres://x@localhost/db' }, LOAD_ENV_LIST),
        ).not.toThrow();
    });

    it('ERR-0019-03: tipo de receita que não existe no sistema barra tudo antes da primeira escrita', async () => {
        const plan = planOf(withReplaced('recebimentos.csv', 'Bônus,Outros', 'Bônus,Inexistente'));

        const result = await writePlan(plan, services, { dryRun: false });

        expect(result.errors).toEqual([
            expect.objectContaining({
                code: 'ERR-0019-03',
                file: 'recebimentos.csv',
                line: 4,
                column: 'tipo_receita',
            }),
        ]);
        expect(await count('banks')).toBe(0);
    });

    it('AC-0019-03: --dry-run conta o que seria criado e não grava nada', async () => {
        const predefinedTypes = await count('expense_types');

        const result = await writePlan(planOf(), services, { dryRun: true });

        expect(result.errors).toEqual([]);
        expect(result.sections).toMatchObject({
            bancos: { created: 2, existing: 0 },
            contas: { created: 3, existing: 0 },
            cartoes: { created: 2, existing: 0 },
            despesas: { created: 4, existing: 0 },
            faturas_em_aberto: { created: 1, existing: 0 },
            recebimentos: { created: 3, existing: 0 },
        });
        // `Saúde` é pré-definido (spec 0012): reaproveitado; os outros pré-definidos, arquivados.
        expect(result.sections.tipos_despesa).toEqual({
            created: 2,
            existing: 1,
            archived: predefinedTypes - 1,
        });
        expect(await count('banks')).toBe(0);
        expect(await count('expense_types')).toBe(predefinedTypes);
    });

    describe('gravação real', () => {
        let dryRun: Awaited<ReturnType<typeof writePlan>>;
        let real: Awaited<ReturnType<typeof writePlan>>;

        beforeAll(async () => {
            dryRun = await writePlan(planOf(), services, { dryRun: true });
            real = await writePlan(planOf(), services, { dryRun: false });
        });

        it('AC-0019-01, AC-0019-03: grava tudo, com as mesmas contagens da simulação', () => {
            expect(real.errors).toEqual([]);
            expect(real.sections).toEqual(dryRun.sections);
        });

        it('AC-0019-01: contas e cartões com os campos do contrato', async () => {
            const accounts = await services.accounts.list();
            const alfa = accounts.find((account) => account.description === 'Alfa CC')!;
            const cards = await services.cards.list();
            const black = cards.find((card) => card.name === 'Alfa Black')!;

            expect(alfa).toMatchObject({
                type: 'CHECKING',
                accountNumber: '111-1',
                openingBalanceCents: 125050,
                overdraftLimitCents: 100000,
            });
            expect(black).toMatchObject({
                creditLimitCents: 1000000,
                closingDay: 9,
                dueDay: 16,
                paymentBankAccountId: alfa.id,
            });
        });

        it('AC-0019-09, INV-0019-05: o saldo de cada conta é o saldo_inicial', async () => {
            const accounts = await services.accounts.list();

            expect(
                accounts.map((account) => [account.description, account.currentBalanceCents]),
            ).toEqual(
                expect.arrayContaining([
                    ['Alfa CC', 125050],
                    ['Alfa Poupança', 30000],
                    ['Beta CC', 62],
                ]),
            );
        });

        it('AC-0019-08, INV-0019-06: os tipos ativos são exatamente os da planilha', async () => {
            const active = await services.expenseTypes.list();

            expect(active.map((type) => type.name).sort()).toEqual(
                ['Cartão de Crédito', 'Casa', 'Saúde'].sort(),
            );
        });

        it('AC-0019-06: parcelada vira um grupo cuja soma é o total, com a numeração original', async () => {
            const rows = (await services.expenses.list()).filter((expense) =>
                expense.description.startsWith('Geladeira'),
            );

            expect(rows).toHaveLength(8);
            expect(rows.reduce((sum, row) => sum + row.amountCents, 0)).toBe(25000 * 8);
            expect(new Set(rows.map((row) => row.description))).toEqual(
                new Set(['Geladeira (3–10/10)']),
            );
            expect(new Set(rows.map((row) => row.installmentGroupId)).size).toBe(1);

            const single = (await services.expenses.list()).filter(
                (expense) => expense.description === 'Consulta (4/4)',
            );
            expect(single).toEqual([
                expect.objectContaining({ kind: 'VARIABLE', amountCents: 12000 }),
            ]);
        });

        it('AC-0019-01: despesa fixa vira série com fim e notas; receitas com pagante nas notas', async () => {
            const rent = (await services.expenses.list()).filter(
                (expense) => expense.description === 'Aluguel',
            );
            const earnings = await services.earnings.list();

            expect(rent[0]).toMatchObject({
                kind: 'FIXED',
                amountCents: 150000,
                occurredOn: '2026-11-05',
                notes: 'Reajuste em agosto',
            });
            expect(
                earnings.filter((row) => row.description === 'Empréstimo amigo (3–6/6)'),
            ).toHaveLength(4);
            expect(earnings.find((row) => row.description === 'Salário')).toMatchObject({
                kind: 'FIXED',
                notes: 'Empresa X',
            });
        });

        it('AC-0019-07: a fatura em aberto consome o limite, e o pagamento antecipado o devolve', async () => {
            const card = (await services.cards.list()).find((row) => row.name === 'Alfa Black')!;
            const entry = (await services.expenses.list({ creditCardId: card.id })).find((row) =>
                row.description.startsWith('Fatura anterior'),
            )!;

            expect(entry).toMatchObject({
                description: 'Fatura anterior Alfa Black (vence 2026-10-16)',
                kind: 'VARIABLE',
                status: 'OPEN',
                amountCents: 234567,
                occurredOn: businessToday(),
            });

            const before = await services.cards.findById(card.id);
            const account = await services.accounts.findById(card.paymentBankAccountId!);
            await container.resolve(StatementPaymentService).payEarly({
                creditCardId: card.id,
                amountCents: 234567,
            });

            expect((await services.cards.findById(card.id)).availableLimitCents).toBe(
                before.availableLimitCents + 234567,
            );
            expect((await services.accounts.findById(account.id)).currentBalanceCents).toBe(
                account.currentBalanceCents - 234567,
            );
        });

        it('AC-0019-04, INV-0019-03: a segunda execução não cria nada', async () => {
            const again = await writePlan(planOf(), services, { dryRun: false });

            expect(again.errors).toEqual([]);
            for (const section of Object.values(again.sections)) {
                expect(section.created).toBe(0);
            }
            expect(again.sections.bancos.existing).toBe(2);
            expect(again.sections.despesas.existing).toBe(4);
            expect(again.sections.faturas_em_aberto.existing).toBe(1);
            expect(again.sections.recebimentos.existing).toBe(3);
            expect(again.sections.tipos_despesa.archived).toBe(0);
        });

        it('ERR-0019-07: o serviço recusa uma linha, a carga para nela e a seguinte continua', async () => {
            const files = fixtureFiles();
            files['recebimentos.csv'] +=
                'Prêmio,Outros,VARIABLE,100,Alfa CC,2026-12-24,,,,,FORECAST,,sim,\n';
            files['recebimentos.csv'] +=
                'Prêmio 2,Outros,VARIABLE,100,Alfa CC,2026-12-25,,,,,FORECAST,,sim,\n';
            const refusing: LoadServices = {
                ...services,
                earnings: Object.assign(Object.create(services.earnings) as object, {
                    create: () => Promise.reject(new Error('serviço fora do ar')),
                }) as unknown as LoadServices['earnings'],
            };

            const stopped = await writePlan(planOf(files), refusing, { dryRun: false });

            expect(stopped.errors).toEqual([
                {
                    code: 'ERR-0019-07',
                    file: 'recebimentos.csv',
                    line: 5,
                    message: 'serviço fora do ar',
                },
            ]);
            expect(stopped.sections.recebimentos.created).toBe(0);

            const resumed = await writePlan(planOf(files), services, { dryRun: false });

            expect(resumed.errors).toEqual([]);
            expect(resumed.sections.recebimentos).toEqual({ created: 2, existing: 3 });
        });

        it('ERR-0019-07: cita o código do erro de domínio', async () => {
            const files = fixtureFiles();
            files['despesas_fixas.csv'] += 'Nova,Casa,10,Alfa CC,,2026-12-01,,OPEN,sim,\n';
            const refusing: LoadServices = {
                ...services,
                expenses: Object.assign(Object.create(services.expenses) as object, {
                    create: () =>
                        Promise.reject(
                            Object.assign(new Error('conta arquivada'), {
                                code: 'BANK_ACCOUNT_ARCHIVED',
                            }),
                        ),
                }) as unknown as LoadServices['expenses'],
            };

            const stopped = await writePlan(planOf(files), refusing, { dryRun: false });

            expect(stopped.errors[0]?.message).toBe('BANK_ACCOUNT_ARCHIVED: conta arquivada');
        });
    });
});
