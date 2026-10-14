import { CustomError } from '@bhs-dev/typescript-common-errors';

/** Tipos aceitos para a foto do usuário (INV-0010-12). SVG fica de fora: é código, não imagem. */
export const AVATAR_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type AvatarContentType = (typeof AVATAR_CONTENT_TYPES)[number];

/** 512 KiB: o frontend já envia a imagem recortada e reduzida (spec 0010). */
export const AVATAR_MAX_BYTES = 524288;

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0): boolean =>
    bytes.length >= offset + signature.length &&
    signature.every((byte, index) => bytes[offset + index] === byte);

/**
 * O tipo da imagem pelos primeiros bytes, e não pelo que o cliente declarou.
 * Nulo quando não é nenhum dos aceitos.
 */
export function detectAvatarType(bytes: Uint8Array): AvatarContentType | null {
    if (startsWith(bytes, PNG)) return 'image/png';
    if (startsWith(bytes, JPEG)) return 'image/jpeg';
    // WebP é `RIFF` + tamanho (4 bytes) + `WEBP`.
    if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return 'image/webp';

    return null;
}

/** `image/PNG; charset=x` → `image/png`: só o media type conta. */
export function normalizeMediaType(contentType: string | undefined): string {
    const [mediaType = ''] = (contentType ?? '').split(';');

    return mediaType.trim().toLowerCase();
}

/**
 * Valida a foto antes de gravar (INV-0010-12): tamanho dentro do limite, tipo
 * declarado entre os aceitos e bytes que batem com ele. Devolve o tipo a gravar.
 */
export function assertValidAvatar(
    declaredContentType: string | undefined,
    content: Uint8Array,
): AvatarContentType {
    if (content.length > AVATAR_MAX_BYTES) throw avatarTooLarge();

    const declared = normalizeMediaType(declaredContentType);
    const detected = detectAvatarType(content);

    if (detected === null || detected !== declared) throw avatarUnsupportedType();

    return detected;
}

/** ERR-0010-12. Também usado pelo parser do corpo, que recusa antes de ler tudo. */
export const avatarTooLarge = (): CustomError =>
    new CustomError(
        413,
        'AVATAR_TOO_LARGE',
        `Avatar must be at most ${AVATAR_MAX_BYTES} bytes (512 KiB)`,
        { exposeMessage: true },
    );

/** ERR-0010-13. */
export const avatarUnsupportedType = (): CustomError =>
    new CustomError(
        415,
        'AVATAR_UNSUPPORTED_TYPE',
        `Avatar must be ${AVATAR_CONTENT_TYPES.join(', ')}, and its bytes must match the declared Content-Type`,
        { exposeMessage: true },
    );
