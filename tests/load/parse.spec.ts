import { parseCsv } from '../../src/load/csv';
import { formatReais } from '../../src/load/report';
import {
    nameKey,
    parseInteger,
    parseIsoDate,
    parseMoneyCents,
    parseYesNo,
} from '../../src/load/values';

describe('carga inicial: leitura de CSV (spec 0019)', () => {
    it('lê campos com aspas, vírgulas e aspas escapadas (RFC 4180)', () => {
        const records = parseCsv('a,b,c\n"1,5","diz ""oi""",x\n');

        expect(records.map((record) => record.fields)).toEqual([
            ['a', 'b', 'c'],
            ['1,5', 'diz "oi"', 'x'],
        ]);
    });

    it('aceita CRLF e BOM, e ignora linhas em branco mantendo o número da linha', () => {
        const records = parseCsv('﻿nome,valor\r\nA,1\r\n,\r\n\r\nB,2');

        expect(records).toEqual([
            { line: 1, fields: ['nome', 'valor'] },
            { line: 2, fields: ['A', '1'] },
            { line: 5, fields: ['B', '2'] },
        ]);
    });

    it('mantém quebra de linha dentro de aspas e conta a linha seguinte', () => {
        const records = parseCsv('obs,n\n"linha 1\nlinha 2",1\nfim,2\n');

        expect(records[1]).toEqual({ line: 2, fields: ['linha 1\nlinha 2', '1'] });
        expect(records[2]).toEqual({ line: 4, fields: ['fim', '2'] });
    });

    it('arquivo vazio não tem registros', () => {
        expect(parseCsv('')).toEqual([]);
    });
});

describe('carga inicial: valores (spec 0019)', () => {
    it('AC-0019-05, INV-0019-04: converte reais em centavos sem ponto flutuante', () => {
        expect(parseMoneyCents('1,593.00')).toBe(159300);
        expect(parseMoneyCents('1593.00')).toBe(159300);
        expect(parseMoneyCents('1593')).toBe(159300);
        expect(parseMoneyCents('0.62')).toBe(62);
        expect(parseMoneyCents('12,281.01')).toBe(1228101);
        expect(parseMoneyCents(' 18.9 ')).toBe(1890);
        expect(parseMoneyCents('0.29')).toBe(29);
    });

    it('AC-0019-05: recusa o formato brasileiro, negativos e lixo', () => {
        for (const raw of ['1.000,00', '-5', '1,00', '12,34.5', 'R$ 10', '1.234', '']) {
            expect(parseMoneyCents(raw)).toBeUndefined();
        }
    });

    it('datas AAAA-MM-DD só quando o dia existe', () => {
        expect(parseIsoDate('2026-10-14')).toBe('2026-10-14');
        expect(parseIsoDate('2028-02-29')).toBe('2028-02-29');
        expect(parseIsoDate('2026-02-30')).toBeUndefined();
        expect(parseIsoDate('14/10/2026')).toBeUndefined();
        expect(parseIsoDate('2026-1-5')).toBeUndefined();
    });

    it('inteiros só com dígitos', () => {
        expect(parseInteger('12')).toBe(12);
        expect(parseInteger('1.5')).toBeUndefined();
        expect(parseInteger('-1')).toBeUndefined();
        expect(parseInteger('')).toBeUndefined();
    });

    it('importar é sim ou não, sem diferença de maiúsculas', () => {
        expect(parseYesNo('sim')).toBe(true);
        expect(parseYesNo(' SIM ')).toBe(true);
        expect(parseYesNo('não')).toBe(false);
        expect(parseYesNo('nao')).toBe(false);
        expect(parseYesNo('talvez')).toBeUndefined();
    });

    it('compara nomes sem diferença de maiúsculas nem espaços nas pontas', () => {
        expect(nameKey('  Cartão de Crédito ')).toBe(nameKey('cartão de crédito'));
    });

    it('formata centavos em reais para o relatório', () => {
        expect(formatReais(764945)).toBe('R$ 7.649,45');
        expect(formatReais(62)).toBe('R$ 0,62');
        expect(formatReais(123456789)).toBe('R$ 1.234.567,89');
    });
});
