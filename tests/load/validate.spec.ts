import { validateLoad, type LoadError } from '../../src/load/validate';
import { fixtureFiles, withReplaced, withTab } from './load-fixtures';

const codes = (errors: LoadError[]): string[] =>
    errors.map((error) => `${error.file}:${error.line ?? ''} ${error.column ?? ''} ${error.code}`);

describe('carga inicial: validação (spec 0019)', () => {
    describe('arquivos completos e válidos', () => {
        const validation = validateLoad(fixtureFiles());
        const { plan } = validation;

        it('não tem erro e conta o que entra e o que fica de fora por aba', () => {
            expect(validation.errors).toEqual([]);
            expect(validation.warnings).toEqual([]);
            expect(validation.tabs).toEqual([
                { file: 'bancos.csv', toImport: 2, ignored: 1 },
                { file: 'contas.csv', toImport: 3, ignored: 1 },
                { file: 'cartoes.csv', toImport: 2, ignored: 0 },
                { file: 'tipos_despesa.csv', toImport: 3, ignored: 1 },
                { file: 'despesas_fixas.csv', toImport: 2, ignored: 1 },
                { file: 'despesas_parceladas.csv', toImport: 2, ignored: 0 },
                { file: 'faturas_em_aberto.csv', toImport: 1, ignored: 0 },
                { file: 'recebimentos.csv', toImport: 3, ignored: 0 },
            ]);
        });

        it('mapeia bancos, contas e cartões pelo contrato, com referências por nome', () => {
            expect(plan.banks.map((bank) => [bank.name, bank.febrabanCode])).toEqual([
                ['Banco Alfa', '900'],
                ['Banco Beta', '901'],
            ]);
            expect(plan.accounts[0]).toMatchObject({
                febrabanCode: '900',
                description: 'Alfa CC',
                type: 'CHECKING',
                accountNumber: '111-1',
                openingBalanceCents: 125050,
                overdraftLimitCents: 100000,
            });
            expect(plan.accounts[1]).toMatchObject({ overdraftLimitCents: 0 });
            expect(plan.cards[0]).toMatchObject({
                febrabanCode: '900',
                name: 'Alfa Black',
                creditLimitCents: 1000000,
                closingDay: 9,
                dueDay: 16,
                paymentAccount: 'Alfa CC',
            });
        });

        it('AC-0019-08: o plano de tipos é exatamente o da planilha com sim', () => {
            expect(plan.expenseTypes.map((type) => type.name)).toEqual([
                'Casa',
                'Saúde',
                'Cartão de Crédito',
            ]);
        });

        it('despesa fixa vira FIXED com fim da série e observação nas notas', () => {
            expect(plan.expenses[0]).toMatchObject({
                description: 'Aluguel',
                kind: 'FIXED',
                amountCents: 150000,
                occurredOn: '2026-11-05',
                recurrenceEndsOn: '2027-10-05',
                status: 'OPEN',
                account: 'Alfa CC',
                notes: 'Reajuste em agosto',
            });
            expect(plan.expenses[1]).toMatchObject({ card: 'Alfa Black', status: 'FORECAST' });
            expect(plan.expenses[1]).not.toHaveProperty('recurrenceEndsOn');
        });

        it('AC-0019-06, INV-0019-04: parcelada vira INSTALLMENT com o total exato e a numeração original', () => {
            expect(plan.expenses[2]).toMatchObject({
                description: 'Geladeira (3–10/10)',
                kind: 'INSTALLMENT',
                amountCents: 25000 * 8,
                installmentTotal: 8,
                occurredOn: '2026-10-20',
                card: 'Alfa Black',
                status: 'OPEN',
            });
        });

        it('AC-0019-06: com uma parcela restante vira VARIABLE', () => {
            expect(plan.expenses[3]).toMatchObject({
                description: 'Consulta (4/4)',
                kind: 'VARIABLE',
                amountCents: 12000,
                account: 'Beta CC',
            });
            expect(plan.expenses[3]).not.toHaveProperty('installmentTotal');
        });

        it('fatura em aberto leva cartão, tipo, valor, vencimento e a conta do pagamento', () => {
            expect(plan.openStatements).toEqual([
                {
                    file: 'faturas_em_aberto.csv',
                    line: 2,
                    description: 'Fatura anterior Alfa Black (vence 2026-10-16)',
                    card: 'Alfa Black',
                    expenseType: 'Cartão de Crédito',
                    amountCents: 234567,
                    dueOn: '2026-10-16',
                    paymentAccount: 'Alfa CC',
                },
            ]);
        });

        it('receitas: pagante nas notas, parcelas pelo total e fim só em FIXED', () => {
            expect(plan.earnings).toEqual([
                expect.objectContaining({
                    description: 'Salário',
                    kind: 'FIXED',
                    amountCents: 800000,
                    recurrenceEndsOn: '2027-12-31',
                    notes: 'Empresa X',
                    account: 'Alfa CC',
                    status: 'FORECAST',
                }),
                expect.objectContaining({
                    description: 'Empréstimo amigo (3–6/6)',
                    kind: 'INSTALLMENT',
                    amountCents: 80000,
                    installmentTotal: 4,
                    notes: 'Fulano — confere',
                }),
                expect.objectContaining({ description: 'Bônus', kind: 'VARIABLE' }),
            ]);
            expect(plan.earnings[2]).not.toHaveProperty('notes');
        });
    });

    it('AC-0019-02, INV-0019-01: erros em três abas saem juntos, sem plano utilizável', () => {
        const files = {
            ...fixtureFiles(),
            ...withReplaced('contas.csv', '"1,250.50"', '"1.250,50"'),
        };
        files['cartoes.csv'] = files['cartoes.csv'].replace('Alfa CC,sim', 'Gama CC,sim');
        files['recebimentos.csv'] = files['recebimentos.csv'].replace('FIXED', 'MENSAL');

        const { errors } = validateLoad(files);

        expect(codes(errors)).toEqual([
            'contas.csv:2 saldo_inicial ERR-0019-02',
            'cartoes.csv:2 conta_pagadora ERR-0019-03',
            'recebimentos.csv:2 ocorrencia ERR-0019-02',
        ]);
    });

    describe('ERR-0019-01: estrutura', () => {
        it('arquivo ausente', () => {
            const files = fixtureFiles() as Partial<ReturnType<typeof fixtureFiles>>;
            delete files['recebimentos.csv'];

            expect(validateLoad(files).errors).toEqual([
                { code: 'ERR-0019-01', file: 'recebimentos.csv', message: 'arquivo ausente' },
            ]);
        });

        it('coluna ausente, uma por erro, e nada além da estrutura é conferido', () => {
            const { errors, tabs } = validateLoad(
                withTab('contas.csv', 'banco,descricao,tipo\nBanco Alfa,X,CHECKING\n'),
            );

            expect(errors.map((error) => error.column)).toEqual([
                'numero_conta',
                'saldo_inicial',
                'data_saldo',
                'limite_cheque_especial',
                'importar',
            ]);
            expect(new Set(errors.map((error) => error.code))).toEqual(new Set(['ERR-0019-01']));
            expect(tabs.map((tab) => tab.file)).not.toContain('contas.csv');
        });

        it('arquivo vazio é coluna ausente', () => {
            const { errors } = validateLoad(withTab('bancos.csv', ''));

            expect(errors).toHaveLength(3);
        });

        it('colunas em outra ordem e colunas a mais são aceitas', () => {
            const { errors, plan } = validateLoad(
                withTab(
                    'bancos.csv',
                    'extra,importar,codigo_febraban,nome\nx,sim,900,Banco Alfa\nx,sim,901,Banco Beta\n',
                ),
            );

            expect(errors).toEqual([]);
            expect(plan.banks.map((bank) => bank.febrabanCode)).toEqual(['900', '901']);
        });
    });

    describe('ERR-0019-02: formato', () => {
        it.each([
            ['bancos.csv', '900,sim', '9000,sim', 'codigo_febraban'],
            [
                'contas.csv',
                '111-1,"1,250.50",2026-10-14',
                '111-1,"1,250.50",14/10/2026',
                'data_saldo',
            ],
            ['contas.csv', 'Alfa CC,CHECKING', 'Alfa CC,CORRENTE', 'tipo'],
            ['cartoes.csv', '"10,000",9,16', '"10,000",nove,16', 'dia_fechamento'],
            ['despesas_fixas.csv', '"1,500.00"', '-1500', 'valor'],
            ['despesas_fixas.csv', 'OPEN,sim,Reajuste', 'ABERTA,sim,Reajuste', 'situacao'],
            ['tipos_despesa.csv', 'Casa,sim', 'Casa,talvez', 'importar'],
        ] as const)('%s: %s → %s', (file, from, to, column) => {
            const { errors } = validateLoad(withReplaced(file, from, to));

            // The first error, in tab order, is the root cause; a row that cannot be referenced
            // (no name, or an unreadable importar) also fails the rows that use it.
            expect(errors[0]).toEqual(
                expect.objectContaining({ code: 'ERR-0019-02', file, line: 2, column }),
            );
        });
    });

    describe('ERR-0019-03: referência', () => {
        it('para linha com importar = não', () => {
            const { errors } = validateLoad(
                withReplaced('despesas_fixas.csv', 'Aluguel,Casa', 'Aluguel,Lazer'),
            );

            expect(errors).toEqual([
                expect.objectContaining({
                    code: 'ERR-0019-03',
                    column: 'tipo_despesa',
                    message: '"Lazer" não está em tipos_despesa',
                }),
            ]);
        });

        it('banco, cartão e conta que não existem', () => {
            const files = {
                ...withReplaced('contas.csv', 'Banco Beta,Beta CC', 'Banco Zeta,Beta CC'),
            };
            const { errors } = validateLoad(files);

            // A conta com banco inválido continua referenciável: o erro aponta só a causa.
            expect(codes(errors)).toEqual(['contas.csv:4 banco ERR-0019-03']);
        });

        it('compara nomes sem diferença de maiúsculas', () => {
            const { errors } = validateLoad(
                withReplaced(
                    'despesas_fixas.csv',
                    'Aluguel,Casa,"1,500.00",Alfa CC',
                    'Aluguel,casa,"1,500.00",ALFA cc',
                ),
            );

            expect(errors).toEqual([]);
        });
    });

    it('ERR-0019-04: despesa com conta e cartão, ou com nenhum', () => {
        const files = fixtureFiles();
        files['despesas_fixas.csv'] = files['despesas_fixas.csv']
            .replace('Alfa CC,,2026-11-05', 'Alfa CC,Alfa Black,2026-11-05')
            .replace(',,Alfa Black,2026-11-04', ',,,2026-11-04');

        expect(codes(validateLoad(files).errors)).toEqual([
            'despesas_fixas.csv:2  ERR-0019-04',
            'despesas_fixas.csv:3  ERR-0019-04',
        ]);
    });

    describe('ERR-0019-05: chave repetida', () => {
        it('numero_conta do mesmo banco e descrição de conta', () => {
            const files = fixtureFiles();
            files['contas.csv'] += 'Banco Alfa,Outra,CHECKING,111-1,0,2026-10-14,,sim,\n';
            files['contas.csv'] += 'Banco Beta,Alfa CC,CHECKING,999,0,2026-10-14,,sim,\n';

            expect(codes(validateLoad(files).errors)).toEqual([
                'contas.csv:6 numero_conta ERR-0019-05',
                'contas.csv:7 descricao ERR-0019-05',
            ]);
        });

        it('nome de cartão repetido entre bancos, código e nome de banco, tipo', () => {
            const files = fixtureFiles();
            files['cartoes.csv'] += 'Banco Beta,Alfa Black,100,1,10,Beta CC,sim,\n';
            files['bancos.csv'] += 'Outro,900,sim,\n';
            files['tipos_despesa.csv'] += 'CASA,sim,\n';

            expect(codes(validateLoad(files).errors)).toEqual([
                'bancos.csv:5 codigo_febraban ERR-0019-05',
                'cartoes.csv:4 nome ERR-0019-05',
                'tipos_despesa.csv:6 nome ERR-0019-05',
            ]);
        });

        it('despesa, fatura e receita repetidas na mesma aba', () => {
            const files = fixtureFiles();
            files['despesas_parceladas.csv'] +=
                'Geladeira,Casa,250.00,,Alfa Black,2026-10-20,3,10,8,sim,\n';
            files['faturas_em_aberto.csv'] += 'Alfa Black,2026-10-16,10,sim,,Cartão de Crédito\n';
            files['recebimentos.csv'] +=
                'Bônus,Outros,VARIABLE,500,Alfa CC,2026-12-20,,,,,FORECAST,,sim,\n';

            expect(codes(validateLoad(files).errors)).toEqual([
                'despesas_parceladas.csv:4 descricao ERR-0019-05',
                'faturas_em_aberto.csv:3 cartao ERR-0019-05',
                'recebimentos.csv:5 descricao ERR-0019-05',
            ]);
        });
    });

    describe('ERR-0019-06: regras do contrato de criação', () => {
        it.each([
            ['bancos.csv', 'Banco Alfa,900', ',900', 'nome', 2],
            ['cartoes.csv', '"10,000",9,16', '0,9,16', 'limite', 2],
            ['cartoes.csv', '"10,000",9,16', '"10,000",9,32', 'dia_vencimento', 2],
            ['despesas_fixas.csv', '2026-11-05,2027-10-05', '2026-11-05,2026-10-05', 'data_fim', 2],
            ['despesas_parceladas.csv', '3,10,8,sim', '3,10,0,sim', 'parcelas_restantes', 2],
            ['despesas_parceladas.csv', '3,10,8,sim', '3,10,121,sim', 'parcelas_restantes', 2],
            ['recebimentos.csv', '3,6,4,OPEN', '3,6,1,OPEN', 'parcelas_restantes', 3],
            [
                'recebimentos.csv',
                '2027-12-31,,,,FORECAST',
                '2027-12-31,1,,,FORECAST',
                'parcela_proxima',
                2,
            ],
            [
                'recebimentos.csv',
                '2026-12-20,,,,,FORECAST',
                '2026-12-20,2027-01-01,,,,FORECAST',
                'data_fim',
                4,
            ],
            ['recebimentos.csv', '2026-11-05,2027-12-31', '2026-11-05,2026-01-01', 'data_fim', 2],
            ['recebimentos.csv', 'Salário,Salário', 'Salário,', 'tipo_receita', 2],
        ] as const)('%s: %s → %s', (file, from, to, column, line) => {
            const { errors } = validateLoad(withReplaced(file, from, to));

            expect(errors[0]).toEqual(
                expect.objectContaining({ code: 'ERR-0019-06', file, line, column }),
            );
        });

        it('descrição e notas acima do limite', () => {
            const files = fixtureFiles();
            files['despesas_fixas.csv'] = files['despesas_fixas.csv']
                .replace('Aluguel', 'A'.repeat(201))
                .replace('Reajuste em agosto', 'x'.repeat(1001));

            expect(codes(validateLoad(files).errors)).toEqual([
                'despesas_fixas.csv:2 observacao ERR-0019-06',
                'despesas_fixas.csv:2 descricao ERR-0019-06',
            ]);
        });
    });

    it('aviso, sem erro, quando a numeração da parcelada não fecha com o total', () => {
        const validation = validateLoad(
            withReplaced('despesas_parceladas.csv', '3,10,8,sim', '21,60,38,sim'),
        );

        expect(validation.errors).toEqual([]);
        expect(validation.warnings).toEqual([
            {
                file: 'despesas_parceladas.csv',
                line: 2,
                message:
                    'parcela_proxima (21) + parcelas_restantes (38) − 1 difere de parcelas_total (60)',
            },
        ]);
    });
});
