import { QueryFailedError } from 'typeorm';
import { CustomError } from '@bhs-dev/typescript-common-errors';

/**
 * Traduz violação de unicidade em conflito de domínio, pelo erro do banco e não
 * por um `SELECT` prévio: a constraint é a única sem janela de corrida.
 */
export async function asConflict<T>(
    operation: Promise<T>,
    conflicts: Record<string, { code: string; message: string }>,
): Promise<T> {
    try {
        return await operation;
    } catch (error) {
        const constraint =
            error instanceof QueryFailedError
                ? (error.driverError as { constraint?: string } | undefined)?.constraint
                : undefined;
        const conflict = constraint ? conflicts[constraint] : undefined;

        if (!conflict) throw error;

        throw new CustomError(409, conflict.code, conflict.message, { exposeMessage: true });
    }
}
