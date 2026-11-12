import slugify from 'slugify';

/** Função pura, sem `locale`, para independer do ambiente (INV-0025-02). */
export function toSlug(name: string): string {
    return slugify(name, { lower: true, strict: true, trim: true });
}
