import type { Request, Response } from 'express';
import { injectable } from 'tsyringe';
import { ZodError } from 'zod';

import { HttpResponses } from '../http/http-responses';
import { nameParamsSchema, slugNameParamsSchema } from './hello.schemas';
import { toSlug } from './hello.slug';

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

    handleGetHelloLength(req: Request, res: Response): Response {
        const { name } = nameParamsSchema.parse(req.params);
        return HttpResponses.ok(res, { length: [...name].length });
    }

    handleGetHelloSlug(req: Request, res: Response): Response {
        const { name } = slugNameParamsSchema.parse(req.params);
        const slug = toSlug(name);
        if (slug === '') {
            throw new ZodError([{ code: 'custom', path: ['name'], message: 'Invalid name' }]);
        }
        return HttpResponses.ok(res, { slug });
    }
}
