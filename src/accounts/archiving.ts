import { z } from 'zod';
import { IsNull, type FindOptionsWhere } from 'typeorm';

/**
 * Arquivar é o encerramento de um registro financeiro: ele sai da listagem
 * padrão e continua sustentando o histórico que o referencia (INV-0011-03).
 * Nada aqui é apagado.
 */
export const listQuerySchema = z
    .object({
        archived: z.enum(['true', 'false']).optional(),
    })
    .strict();

/** `?archived=true` inclui os arquivados; o padrão esconde-os. */
export const archivedFilter = (query: {
    archived?: 'true' | 'false';
}): FindOptionsWhere<{ archivedAt: Date | null }> =>
    query.archived === 'true' ? {} : { archivedAt: IsNull() };

/**
 * Arquivar o que já está arquivado não é erro, é um pedido já atendido
 * (ERR-0011-12): responde 200 e não escreve — nem sequer mexe no `updated_at`.
 */
export const needsArchiveChange = (archivedAt: Date | null, archived: boolean): boolean =>
    (archivedAt !== null) !== archived;
