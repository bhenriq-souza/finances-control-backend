import type { EarningType } from './earning-type.entity';

export type EarningTypeResponse = {
    id: string;
    name: string;
    archivedAt: string | null;
    createdAt: string;
};

export const toEarningTypeResponse = (type: EarningType): EarningTypeResponse => ({
    id: type.id,
    name: type.name,
    archivedAt: type.archivedAt?.toISOString() ?? null,
    createdAt: type.createdAt.toISOString(),
});
