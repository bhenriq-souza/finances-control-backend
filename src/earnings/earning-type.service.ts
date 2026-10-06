import { inject, injectable } from 'tsyringe';
import { CustomError } from '@bhs-dev/typescript-common-errors';
import type { DataSource, Repository } from 'typeorm';

import { DatabaseConnectionSymbol } from '../platform';
import { archivedFilter, needsArchiveChange } from './archiving';
import { EarningType } from './earning-type.entity';
import { asConflict } from './unique-violation';

const CONFLICTS = {
    uq_earning_types_name: {
        code: 'EARNING_TYPE_ALREADY_EXISTS',
        message: 'An earning type with this name already exists',
    },
};

@injectable()
export class EarningTypeService {
    constructor(@inject(DatabaseConnectionSymbol) private readonly dataSource: DataSource) {}

    private get types(): Repository<EarningType> {
        return this.dataSource.getRepository(EarningType);
    }

    list(query: { archived?: 'true' | 'false' } = {}): Promise<EarningType[]> {
        return this.types.find({ where: archivedFilter(query), order: { name: 'ASC' } });
    }

    async findById(id: string): Promise<EarningType> {
        const type = await this.types.findOne({ where: { id } });

        if (!type) throw earningTypeNotFound();

        return type;
    }

    async create(data: { name: string }): Promise<EarningType> {
        const created = await asConflict(
            this.types.save(this.types.create({ ...data, archivedAt: null })),
            CONFLICTS,
        );

        // Recarrega porque `created_at` é do banco e o INSERT do ORM não a traz.
        return this.types.findOneByOrFail({ id: created.id });
    }

    async update(id: string, changes: { name: string }): Promise<EarningType> {
        await this.findById(id);
        await asConflict(this.types.update({ id }, changes), CONFLICTS);

        return this.types.findOneByOrFail({ id });
    }

    async setArchived(id: string, archived: boolean): Promise<EarningType> {
        const type = await this.findById(id);

        if (!needsArchiveChange(type.archivedAt, archived)) return type;

        await this.types.update({ id }, { archivedAt: archived ? new Date() : null });

        return this.types.findOneByOrFail({ id });
    }
}

const earningTypeNotFound = (): CustomError =>
    CustomError.notFound('Earning type not found', 'EARNING_TYPE_NOT_FOUND', {
        exposeMessage: true,
    });
