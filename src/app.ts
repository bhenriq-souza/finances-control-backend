import fs from 'node:fs';
import path from 'node:path';

import express, { type Express } from 'express';
import yaml from 'js-yaml';
import swaggerUi from 'swagger-ui-express';
import type { ILogger } from '@bhs-dev/typescript-common-types';

import { container } from './container';
import { apiModules } from './platform/config/api.config';
import { sortMiddlewares, type MiddlewareEntry } from './platform/config/middlewares.config';
import { RequestContext } from './platform/context/request-context';
import { HttpResponses } from './platform/http/http-responses';
import { registerApiModules } from './platform/api/register-api-modules';
import { createAccessLogMiddleware } from './platform/middlewares/access-log.middleware';
import { createCorrelationIdMiddleware } from './platform/middlewares/correlation-id.middleware';
import { createErrorHandlerMiddleware } from './platform/middlewares/error-handler.middleware';
import { createRequestContextMiddleware } from './platform/middlewares/request-context.middleware';
import { LoggerServiceSymbol, RequestContextSymbol } from './platform/symbols';

const OPENAPI_PATH = path.resolve(process.cwd(), 'docs', 'openapi.yaml');

export class App {
    private app?: Express;

    private loadOpenApiSpec(logger: ILogger): object {
        try {
            if (fs.existsSync(OPENAPI_PATH)) {
                return yaml.load(fs.readFileSync(OPENAPI_PATH, 'utf8')) as object;
            }
            logger.warn('openapi spec not found; serving an empty document', {
                path: OPENAPI_PATH,
            });
        } catch (error) {
            logger.error('failed to load openapi spec', error instanceof Error ? error : undefined);
        }

        return {
            openapi: '3.0.3',
            info: { title: 'Finances Control API', version: '0.0.0' },
            paths: {},
        };
    }

    private middlewares(logger: ILogger, requestContext: RequestContext): MiddlewareEntry[] {
        return [
            {
                name: 'correlation-id',
                order: 1,
                handler: createCorrelationIdMiddleware(),
            },
            {
                name: 'request-context',
                order: 2,
                handler: createRequestContextMiddleware({ requestContext }),
            },
            {
                name: 'access-log',
                order: 3,
                handler: createAccessLogMiddleware({ logger }),
            },
            {
                name: 'error-handler',
                order: 99,
                handler: createErrorHandlerMiddleware({ logger, httpResponses: HttpResponses }),
                isErrorHandler: true,
            },
        ];
    }

    build(): Express {
        if (this.app) return this.app;

        const logger = container.resolve<ILogger>(LoggerServiceSymbol);
        const requestContext = container.resolve<RequestContext>(RequestContextSymbol);

        const app = express();
        app.disable('x-powered-by');
        app.use(express.json());

        const { preRoute, errorHandlers } = sortMiddlewares(
            this.middlewares(logger, requestContext),
        );

        for (const entry of preRoute) {
            app.use(entry.handler as express.RequestHandler);
        }

        app.use('/docs', swaggerUi.serve, swaggerUi.setup(this.loadOpenApiSpec(logger)));

        registerApiModules(app, apiModules);

        for (const entry of errorHandlers) {
            app.use(entry.handler as express.ErrorRequestHandler);
        }

        this.app = app;
        return app;
    }
}
