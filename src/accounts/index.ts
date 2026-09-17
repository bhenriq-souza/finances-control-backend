/**
 * Interface pública do módulo `accounts`. Outros módulos importam daqui — nunca
 * de caminho interno (ADR-0003, regra 1; gate `boundaries`).
 */
export { BANK_ACCOUNT_TYPES, isBankAccountType, type BankAccountType } from './bank-account-type';
export { Bank } from './bank.entity';
export { BankAccount } from './bank-account.entity';
export { CreditCard } from './credit-card.entity';
