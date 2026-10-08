import { QueryFailedError } from 'typeorm';
import { CustomError } from '@bhs-dev/typescript-common-errors';

/**
 * Traduz violação de unicidade em conflito de domínio.
 *
 * A checagem é feita pelo erro do banco, e não por um `SELECT` antes do
 * `INSERT`: entre a consulta e a escrita cabe outra requisição, e a constraint é
 * a única que não tem essa janela.
 */
export async function asConflict<T>(
    operation: Promise<T>,
    conflicts: Record<string, { code: string; message: string }>,
): Promise<T> {
    try {
        return await operation;
    } catch (error) {
        const constraint = constraintOf(error);
        const conflict = constraint ? conflicts[constraint] : undefined;

        if (!conflict) throw error;

        throw new CustomError(409, conflict.code, conflict.message, { exposeMessage: true });
    }
}

function constraintOf(error: unknown): string | undefined {
    if (!(error instanceof QueryFailedError)) return undefined;

    const driverError = error.driverError as { constraint?: string } | undefined;

    return driverError?.constraint;
}
