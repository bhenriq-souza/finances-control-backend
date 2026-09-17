import { BANK_ACCOUNT_TYPES, isBankAccountType } from '../../src/accounts/bank-account-type';

describe('BankAccountType', () => {
    it('tem exatamente os três tipos do F002', () => {
        expect(BANK_ACCOUNT_TYPES).toEqual(['CHECKING', 'SAVINGS', 'INVESTMENT']);
    });

    it.each([...BANK_ACCOUNT_TYPES])('reconhece %s', (type) => {
        expect(isBankAccountType(type)).toBe(true);
    });

    it.each(['checking', 'CORRENTE', '', null, undefined, 7, {}])('recusa %p', (value) => {
        expect(isBankAccountType(value)).toBe(false);
    });
});
