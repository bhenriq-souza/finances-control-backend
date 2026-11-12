/** Normaliza texto para busca: trim, sem acentos (`\p{M}`) e em minúsculas. */
export const normalizeSearchText = (value: string): string =>
    value.trim().normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
