import type { Request, Response } from 'express';
import { inject, injectable } from 'tsyringe';
import type { IEnvService } from '@bhs-dev/typescript-common-types';

import { HttpResponses } from '../http/http-responses';
import { EnvServiceSymbol } from '../symbols';

@injectable()
export class VersionController {
    constructor(@inject(EnvServiceSymbol) private readonly env: IEnvService) {}

    handleGetVersion(_req: Request, res: Response): Response {
        return HttpResponses.ok(res, { version: this.env.getEnv('APPLICATION_VERSION') });
    }
}
