import type { NextFunction, Request, Response } from 'express';

const FORWARDED_PREFIX_HEADER = 'x-forwarded-prefix';
const ALLOWED_PREFIX = '/api';

/**
 * Responde `GET /docs` (sem barra) com `301` para `<prefixo>/docs/`. O prefixo
 * é o `X-Forwarded-Prefix` só quando ele vale exatamente `/api` (INV-0005-05);
 * qualquer outro valor é ignorado, e o redirect nunca manda o navegador para
 * outro lugar.
 */
export const docsRedirectMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET' || req.path !== '/docs') {
        next();
        return;
    }

    const forwarded = req.headers[FORWARDED_PREFIX_HEADER];
    const prefix = forwarded === ALLOWED_PREFIX ? ALLOWED_PREFIX : '';
    const queryIndex = req.originalUrl.indexOf('?');
    const query = queryIndex === -1 ? '' : req.originalUrl.slice(queryIndex);

    res.redirect(301, `${prefix}/docs/${query}`);
};
