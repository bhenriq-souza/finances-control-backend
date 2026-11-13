import 'reflect-metadata';
import type { Request, Response } from 'express';
import type { IEnvService } from '@bhs-dev/typescript-common-types';

import { VersionController } from '../../../src/platform/version/version.controller';

describe('VersionController', () => {
    const call = (version = '1.2.3') => {
        const getEnv = jest.fn().mockReturnValue(version);
        const json = jest.fn();
        const res = { status: jest.fn().mockReturnValue({ json }) } as unknown as Response;
        new VersionController({ getEnv } as unknown as IEnvService).handleGetVersion(
            {} as Request,
            res,
        );
        return { getEnv, json };
    };

    it('devolve APPLICATION_VERSION sem transformação, em corpos idênticos (INV-0028-02)', () => {
        const a = call();
        const b = call();

        expect(a.getEnv).toHaveBeenCalledWith('APPLICATION_VERSION');
        expect(a.json).toHaveBeenCalledWith({ data: { version: '1.2.3' } });
        expect(a.json.mock.calls[0]).toEqual(b.json.mock.calls[0]);
    });
});
