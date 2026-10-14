import express, { type RequestHandler } from 'express';

import { AVATAR_MAX_BYTES, avatarTooLarge } from './avatar-signature';

/**
 * Corpo da foto: a imagem crua, lida só nesta rota e com teto próprio (spec 0010).
 *
 * Aceita qualquer `Content-Type` de propósito: quem decide se o tipo serve é a
 * validação por assinatura (INV-0010-12), que responde `415` com a lista dos
 * aceitos — um parser que só lesse `image/*` deixaria o corpo de um SVG sem ler e
 * a resposta viraria outra. O `express.json()` global não interfere: ele só lê
 * `application/json`, e sem ele ter lido o corpo este parser o lê inteiro.
 */
const parseRawBody = express.raw({ type: () => true, limit: AVATAR_MAX_BYTES });

/** O `413` do body-parser vira `AVATAR_TOO_LARGE`, com o limite no texto (ERR-0010-12). */
const isTooLarge = (error: unknown): boolean =>
    typeof error === 'object' &&
    error !== null &&
    (error as { type?: unknown }).type === 'entity.too.large';

export const parseAvatarBody: RequestHandler = (req, res, next) => {
    parseRawBody(req, res, (error?: unknown) => {
        next(isTooLarge(error) ? avatarTooLarge() : error);
    });
};
