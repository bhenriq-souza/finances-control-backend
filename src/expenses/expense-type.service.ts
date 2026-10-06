import { inject, injectable } from 'tsyringe';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import type { DataSource, Repository } from 'typeorm';

import { DatabaseConnectionSymbol } from '../platform';
import { archivedFilter, needsArchiveChange } from './archiving';
import { ExpenseType } from './expense-type.entity';
import { asConflict } from './unique-violation';

const CONFLICTS = {
    uq_expense_types_name: {
        code: 'EXPENSE_TYPE_ALREADY_EXISTS',
        message: 'An expense type with this name already exists',
    },
};

@injectable()
export class ExpenseTypeService {
    constructor(@inject(DatabaseConnectionSymbol) private readonly dataSource: DataSource) {}

    private get types(): Repository<ExpenseType> {
        return this.dataSource.getRepository(ExpenseType);
    }

    list(query: { archived?: 'true' | 'false' } = {}): Promise<ExpenseType[]> {
        return this.types.find({ where: archivedFilter(query), order: { name: 'ASC' } });
    }

    async findById(id: string): Promise<ExpenseType> {
        const type = await this.types.findOne({ where: { id } });

        if (!type) {
            throw CustomError.notFound('Expense type not found', 'EXPENSE_TYPE_NOT_FOUND', {
                exposeMessage: true,
            });
        }

        return type;
    }

    async create(data: { name: string }): Promise<ExpenseType> {
        const created = await asConflict(
            this.types.save(this.types.create({ name: data.name, archivedAt: null })),
            CONFLICTS,
        );

        return this.findById(created.id);
    }

    async update(id: string, changes: { name: string }): Promise<ExpenseType> {
        await this.findById(id);

        await asConflict(this.types.update({ id }, { name: changes.name }), CONFLICTS);

        return this.findById(id);
    }

    async setArchived(id: string, archived: boolean): Promise<ExpenseType> {
        const type = await this.findById(id);

        if (!needsArchiveChange(type.archivedAt, archived)) return type;

        await this.types.update({ id }, { archivedAt: archived ? new Date() : null });

        return this.findById(id);
    }
}
