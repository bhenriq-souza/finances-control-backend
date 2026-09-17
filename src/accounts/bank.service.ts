import { inject, injectable } from 'tsyringe';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import type { DataSource, Repository } from 'typeorm';

import { DatabaseConnectionSymbol } from '../platform';
import { Bank } from './bank.entity';
import { asConflict } from './unique-violation';

const CONFLICTS = {
    uq_banks_febraban_code: {
        code: 'BANK_ALREADY_EXISTS',
        message: 'A bank with this FEBRABAN code is already registered',
    },
};

@injectable()
export class BankService {
    constructor(@inject(DatabaseConnectionSymbol) private readonly dataSource: DataSource) {}

    private get banks(): Repository<Bank> {
        return this.dataSource.getRepository(Bank);
    }

    list(): Promise<Bank[]> {
        return this.banks.find({ order: { name: 'ASC' } });
    }

    async findById(id: string): Promise<Bank> {
        const bank = await this.banks.findOne({ where: { id } });

        if (!bank) throw bankNotFound();

        return bank;
    }

    async create(data: { febrabanCode: string; name: string }): Promise<Bank> {
        const created = await asConflict(
            this.banks.save(this.banks.create({ ...data, archivedAt: null })),
            CONFLICTS,
        );

        // Recarrega porque `created_at` é do banco e o INSERT do ORM não a traz.
        return this.banks.findOneByOrFail({ id: created.id });
    }

    async update(id: string, changes: { name: string }): Promise<Bank> {
        await this.findById(id);
        await asConflict(this.banks.update({ id }, changes), CONFLICTS);

        return this.banks.findOneByOrFail({ id });
    }
}

const bankNotFound = (): CustomError =>
    CustomError.notFound('Bank not found', 'BANK_NOT_FOUND', { exposeMessage: true });
