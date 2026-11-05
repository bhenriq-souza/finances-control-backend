import type { Request, Response } from 'express';
import { injectable } from 'tsyringe';

import { HttpResponses } from '../http/http-responses';
import { nameParamsSchema } from './hello.schemas';

@injectable()
export class HelloController {
    handleGetHello(_req: Request, res: Response): Response {
        return HttpResponses.ok(res, { message: 'hello world' });
    }

    handleGetHelloName(req: Request, res: Response): Response {
        const { name } = nameParamsSchema.parse(req.params);
        return HttpResponses.ok(res, { message: `hello ${name}` });
    }

    handleGetHelloUpper(req: Request, res: Response): Response {
        const { name } = nameParamsSchema.parse(req.params);
        return HttpResponses.ok(res, { message: `HELLO ${name.toUpperCase()}` });
    }
}
