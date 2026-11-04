import 'reflect-metadata';
import type { Request, Response } from 'express';

import { HelloController } from '../../../src/platform/hello/hello.controller';

describe('HelloController', () => {
    const call = () => {
        const json = jest.fn();
        const res = { status: jest.fn().mockReturnValue({ json }) } as unknown as Response;
        new HelloController().handleGetHello({} as Request, res);
        return { res, json };
    };

    it('responde 200 com a mensagem fixa (INV-0022-02)', () => {
        const { res, json } = call();

        expect(res.status).toHaveBeenCalledWith(200);
        expect(json).toHaveBeenCalledWith({ data: { message: 'hello world' } });
    });

    it('devolve corpos idênticos em chamadas repetidas (INV-0022-02)', () => {
        expect(call().json.mock.calls[0]).toEqual(call().json.mock.calls[0]);
    });
});
