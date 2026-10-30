import { z } from 'zod';

import { USER_PROFILES } from './user-profile';

/**
 * `:id` validado como uuid antes de chegar ao banco: sem isso, um id malformado
 * viraria erro de sintaxe do PostgreSQL — um 500 para o que é 400.
 */
export const userIdParamsSchema = z.object({
    id: z.uuid(),
});

/** Nome de espaço: 1 a 80 caracteres sem espaço nas pontas (spec 0021, ERR-0021-11). */
export const workspaceNameSchema = z.string().trim().min(1).max(80);

/**
 * Corpo de `PATCH /users/:id/profile` (spec 0021): `{ profile }`,
 * `{ profile, workspaceId }` ou `{ profile: 'ADMIN', newWorkspace: { name } }`.
 * O que depende do estado do usuário (pendente ou membro) é decidido no serviço.
 */
export const grantProfileBodySchema = z
    .object({
        profile: z.enum(USER_PROFILES),
        workspaceId: z.uuid().optional(),
        newWorkspace: z.object({ name: workspaceNameSchema }).strict().optional(),
    })
    .strict()
    .superRefine((body, ctx) => {
        if (body.workspaceId !== undefined && body.newWorkspace !== undefined) {
            ctx.addIssue({
                code: 'custom',
                path: ['workspaceId'],
                message: 'Send either workspaceId or newWorkspace, not both',
            });
        }

        if (body.newWorkspace !== undefined && body.profile !== 'ADMIN') {
            ctx.addIssue({
                code: 'custom',
                path: ['profile'],
                message: 'profile must be ADMIN when creating a workspace',
            });
        }
    });

export type GrantProfileBody = z.infer<typeof grantProfileBodySchema>;

export const renameWorkspaceBodySchema = z.object({ name: workspaceNameSchema }).strict();
