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

    it('handleGetHelloName depende só do nome (INV-0023-02)', () => {
        const run = () => {
            const json = jest.fn();
            const res = { status: jest.fn().mockReturnValue({ json }) } as unknown as Response;
            new HelloController().handleGetHelloName(
                { params: { name: 'Maria-José' } } as unknown as Request,
                res,
            );
            return json.mock.calls[0];
        };

        expect(run()).toEqual([{ data: { message: 'hello Maria-José' } }]);
        expect(run()).toEqual(run());
    });

    it('handleGetHelloUpper depende só do nome (INV-0024-02)', () => {
        const run = () => {
            const json = jest.fn();
            const res = { status: jest.fn().mockReturnValue({ json }) } as unknown as Response;
            new HelloController().handleGetHelloUpper(
                { params: { name: 'Maria-José' } } as unknown as Request,
                res,
            );
            return json.mock.calls[0];
        };

        expect(run()).toEqual([{ data: { message: 'HELLO MARIA-JOSÉ' } }]);
        expect(run()).toEqual(run());
    });

    it('handleGetHelloLength depende só do nome (INV-0024-02)', () => {
        const run = () => {
            const json = jest.fn();
            const res = { status: jest.fn().mockReturnValue({ json }) } as unknown as Response;
            new HelloController().handleGetHelloLength(
                { params: { name: 'Maria-José' } } as unknown as Request,
                res,
            );
            return json.mock.calls[0];
        };

        expect(run()).toEqual([{ data: { length: 10 } }]);
        expect(run()).toEqual(run());
    });
});

describe('HelloController.handleGetHelloSlug', () => {
    it('depende só do nome (INV-0025-02)', () => {
        const run = () => {
            const json = jest.fn();
            const res = { status: jest.fn().mockReturnValue({ json }) } as unknown as Response;
            new HelloController().handleGetHelloSlug(
                { params: { name: 'João da Silva' } } as unknown as Request,
                res,
            );
            return json.mock.calls[0];
        };

        expect(run()).toEqual([{ data: { slug: 'joao-da-silva' } }]);
        expect(run()).toEqual(run());
    });
});
