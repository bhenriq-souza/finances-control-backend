import { z } from 'zod';
import { IsNull, type FindOptionsWhere } from 'typeorm';

/** `?archived=true` inclui os arquivados; o padrão esconde-os (spec 0014). */
export const listQuerySchema = z
    .object({
        archived: z.enum(['true', 'false']).optional(),
    })
    .strict();

export const archivedFilter = (query: {
    archived?: 'true' | 'false';
}): FindOptionsWhere<{ archivedAt: Date | null }> =>
    query.archived === 'true' ? {} : { archivedAt: IsNull() };

/** Arquivar o que já está arquivado é um pedido já atendido (ERR-0014-14). */
export const needsArchiveChange = (archivedAt: Date | null, archived: boolean): boolean =>
    (archivedAt !== null) !== archived;
