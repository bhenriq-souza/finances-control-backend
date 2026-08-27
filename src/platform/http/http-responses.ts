import type { Response } from 'express';

export type ErrorPayload = {
    code?: string;
    message: string;
    details?: unknown;
};

/**
 * Formato único de resposta da API. Manter um envelope só evita que cada módulo
 * invente o seu e que o cliente precise saber de qual endpoint veio a resposta.
 */
export const HttpResponses = {
    ok<T>(res: Response, data: T): Response {
        return res.status(200).json({ data });
    },

    created<T>(res: Response, data: T): Response {
        return res.status(201).json({ data });
    },

    noContent(res: Response): Response {
        return res.status(204).send();
    },

    fail(
        res: Response,
        status: number,
        message: string,
        extra: Omit<ErrorPayload, 'message'> = {},
    ) {
        return res.status(status).json({ error: { message, ...extra } });
    },
};

export type HttpResponsesType = typeof HttpResponses;
