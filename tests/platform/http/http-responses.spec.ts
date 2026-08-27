import type { Response } from 'express';

import { HttpResponses } from '../../../src/platform/http/http-responses';

describe('HttpResponses', () => {
    const buildRes = () => {
        const json = jest.fn();
        const send = jest.fn();
        const res = { status: jest.fn().mockReturnValue({ json, send }) } as unknown as Response;
        return { res, json, send };
    };

    it('ok envolve o payload em data com status 200', () => {
        const { res, json } = buildRes();
        HttpResponses.ok(res, { id: 1 });

        expect(res.status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({ data: { id: 1 } });
    });

    it('created responde 201', () => {
        const { res, json } = buildRes();
        HttpResponses.created(res, { id: 2 });

        expect(res.status).toHaveBeenCalledWith(201);
        expect(json).toHaveBeenCalledWith({ data: { id: 2 } });
    });

    it('noContent responde 204 sem corpo', () => {
        const { res, send } = buildRes();
        HttpResponses.noContent(res);

        expect(res.status).toHaveBeenCalledWith(204);
        expect(send).toHaveBeenCalledWith();
    });

    it('fail envolve o erro e aceita code e details', () => {
        const { res, json } = buildRes();
        HttpResponses.fail(res, 422, 'Invalid', { code: 'X', details: { field: 'value' } });

        expect(res.status).toHaveBeenCalledWith(422);
        expect(json).toHaveBeenCalledWith({
            error: { message: 'Invalid', code: 'X', details: { field: 'value' } },
        });
    });

    it('fail funciona sem extras', () => {
        const { res, json } = buildRes();
        HttpResponses.fail(res, 400, 'Bad');

        expect(json).toHaveBeenCalledWith({ error: { message: 'Bad' } });
    });
});
