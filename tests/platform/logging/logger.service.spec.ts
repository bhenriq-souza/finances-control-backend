import 'reflect-metadata';
import type { IEnvService } from '@bhs-dev/typescript-common-types';

import { LoggerService } from '../../../src/platform/logging/logger.service';

describe('LoggerService', () => {
    const env: IEnvService = {
        getEnv: (key: string) =>
            ({
                LOG_LEVEL: 'error',
                APPLICATION_NAME: 'app',
                ENV: 'test',
            })[key] ?? '',
    };

    it('expõe os níveis do contrato ILogger', () => {
        const logger = new LoggerService(env);

        expect(typeof logger.debug).toBe('function');
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.warn).toBe('function');
        expect(typeof logger.error).toBe('function');
    });

    it('cria logger filho preservando o contrato', () => {
        const child = new LoggerService(env).child({ module: 'expenses' });

        expect(typeof child.info).toBe('function');
        expect(typeof child.child).toBe('function');
    });

    it('não lança ao registrar mensagens em cada nível', () => {
        const logger = new LoggerService(env);

        expect(() => {
            logger.debug('debug', { a: 1 });
            logger.info('info');
            logger.warn('warn', { b: 2 });
            logger.error('error', new Error('boom'));
            logger.error('error com meta', { c: 3 });
        }).not.toThrow();
    });
});
