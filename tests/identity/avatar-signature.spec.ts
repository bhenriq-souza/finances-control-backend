import {
    AVATAR_MAX_BYTES,
    assertValidAvatar,
    detectAvatarType,
    normalizeMediaType,
} from '../../src/identity/avatar-signature';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const WEBP = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0x24, 0x00, 0x00, 0x00]),
    Buffer.from('WEBPVP8 '),
]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');

const codeOf = (fn: () => unknown): unknown => {
    try {
        fn();
    } catch (error) {
        return (error as { code?: unknown; status?: unknown }).code;
    }

    return undefined;
};

describe('assinatura da foto (spec 0010, INV-0010-12)', () => {
    describe('detectAvatarType', () => {
        it.each([
            ['PNG', PNG, 'image/png'],
            ['JPEG', JPEG, 'image/jpeg'],
            ['WebP', WEBP, 'image/webp'],
        ])('reconhece %s pelos primeiros bytes', (_name, bytes, expected) => {
            expect(detectAvatarType(bytes)).toBe(expected);
        });

        it.each([
            ['SVG', SVG],
            ['texto', Buffer.from('não sou imagem')],
            ['vazio', Buffer.alloc(0)],
            ['PNG truncado', PNG.subarray(0, 7)],
            [
                'RIFF que não é WebP',
                Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE')]),
            ],
            ['GIF', Buffer.from('GIF89a')],
        ])('recusa %s', (_name, bytes) => {
            expect(detectAvatarType(bytes)).toBeNull();
        });
    });

    describe('normalizeMediaType', () => {
        it.each([
            ['image/png', 'image/png'],
            ['IMAGE/PNG', 'image/png'],
            [' image/jpeg ; charset=binary', 'image/jpeg'],
            [undefined, ''],
        ])('%p vira %p', (input, expected) => {
            expect(normalizeMediaType(input)).toBe(expected);
        });
    });

    describe('assertValidAvatar', () => {
        it('aceita bytes que batem com o tipo declarado e devolve o tipo a gravar', () => {
            expect(assertValidAvatar('image/png', PNG)).toBe('image/png');
            expect(assertValidAvatar('image/jpeg; q=1', JPEG)).toBe('image/jpeg');
            expect(assertValidAvatar('image/webp', WEBP)).toBe('image/webp');
        });

        it('aceita exatamente o limite de 524288 bytes', () => {
            const atLimit = Buffer.concat([PNG, Buffer.alloc(AVATAR_MAX_BYTES - PNG.length)]);

            expect(assertValidAvatar('image/png', atLimit)).toBe('image/png');
        });

        it('recusa um byte acima do limite com 413 AVATAR_TOO_LARGE (ERR-0010-12)', () => {
            const tooLarge = Buffer.concat([PNG, Buffer.alloc(AVATAR_MAX_BYTES + 1 - PNG.length)]);

            expect(codeOf(() => assertValidAvatar('image/png', tooLarge))).toBe('AVATAR_TOO_LARGE');
        });

        it.each([
            ['SVG declarado como SVG', 'image/svg+xml', SVG],
            ['texto declarado como PNG', 'image/png', Buffer.from('não sou imagem')],
            ['JPEG declarado como PNG', 'image/png', JPEG],
            ['PNG sem Content-Type', undefined, PNG],
            ['corpo vazio', 'image/png', Buffer.alloc(0)],
        ])('recusa %s com 415 AVATAR_UNSUPPORTED_TYPE (ERR-0010-13)', (_name, declared, bytes) => {
            expect(codeOf(() => assertValidAvatar(declared, bytes))).toBe(
                'AVATAR_UNSUPPORTED_TYPE',
            );
        });

        it('o texto do 415 lista os tipos aceitos, e o do 413 traz o limite', () => {
            let unsupported: Error | undefined;
            let tooLarge: Error | undefined;

            try {
                assertValidAvatar('image/svg+xml', SVG);
            } catch (error) {
                unsupported = error as Error;
            }

            try {
                assertValidAvatar('image/png', Buffer.alloc(AVATAR_MAX_BYTES + 1));
            } catch (error) {
                tooLarge = error as Error;
            }

            expect(unsupported?.message).toContain('image/jpeg, image/png, image/webp');
            expect(tooLarge?.message).toContain('524288');
        });
    });
});
