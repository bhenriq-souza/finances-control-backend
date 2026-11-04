import type { Request, Response } from 'express';
import { injectable } from 'tsyringe';

import { HttpResponses } from '../http/http-responses';

@injectable()
export class HelloController {
    handleGetHello(_req: Request, res: Response): Response {
        return HttpResponses.ok(res, { message: 'hello world' });
    }
}
