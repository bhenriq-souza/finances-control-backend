import { CustomError } from '@bhs-dev/typescript-common-errors';
import { inject, injectable } from 'tsyringe';
import { QueryFailedError, type DataSource, type Repository } from 'typeorm';
import type { IEnvService } from '@bhs-dev/typescript-common-types';

import { DatabaseConnectionSymbol, EnvServiceSymbol } from '../platform';
import { normalizeEmail } from './email';
import type { VerifiedToken } from './token-verifier';
import { User } from './user.entity';

/**
 * Traz o usuário do Firebase para dentro da plataforma (spec 0010).
 *
 * Não existe endpoint de cadastro: o usuário nasce no Firebase, e o registro
 * local aparece na primeira requisição autenticada — sem perfil, que é o estado
 * normal de quem acabou de se cadastrar, e sem acesso a dado financeiro nenhum
 * até que um Admin decida o contrário.
 */
@injectable()
export class UserProvisioningService {
    constructor(
        @inject(DatabaseConnectionSymbol) private readonly dataSource: DataSource,
        @inject(EnvServiceSymbol) private readonly env: IEnvService,
    ) {}

    async provision(token: VerifiedToken): Promise<User> {
        const normalized: VerifiedToken = { ...token, email: normalizeEmail(token.email) };

        try {
            return await this.runInTransaction(normalized);
        } catch (error) {
            // O frontend dispara várias chamadas autenticadas ao carregar, e as
            // primeiras podem chegar juntas: as duas leem "não existe" e as duas
            // tentam inserir. Quem perder a corrida relê e segue o fluxo normal.
            if (!isFirebaseUidConflict(error)) throw error;

            return this.runInTransaction(normalized);
        }
    }

    private runInTransaction(token: VerifiedToken): Promise<User> {
        return this.dataSource.transaction(async (manager) => {
            const users = manager.getRepository(User);
            const existing = await users.findOne({ where: { firebaseUid: token.uid } });

            if (existing) return this.refresh(users, existing, token);

            // UID desconhecido, mas o email já é de alguém: o usuário voltou com
            // outro UID (outro projeto Firebase, conta recriada). Só um email
            // verificado autoriza assumir a linha (INV-0010-11).
            const sameEmail = await users.findOne({ where: { email: token.email } });

            if (sameEmail) return this.relink(users, sameEmail, token);

            return this.create(users, token);
        });
    }

    private async relink(
        users: Repository<User>,
        existing: User,
        token: VerifiedToken,
    ): Promise<User> {
        if (!token.emailVerified) {
            throw new CustomError(
                403,
                'EMAIL_NOT_VERIFIED',
                'Verify your email address before signing in, then try again',
                { exposeMessage: true },
            );
        }

        await users.update({ id: existing.id }, { firebaseUid: token.uid });

        return this.refresh(users, { ...existing, firebaseUid: token.uid }, token);
    }

    private async create(users: Repository<User>, token: VerifiedToken): Promise<User> {
        const bootstrap = this.isBootstrapAdmin(token);

        const created = await users.save(
            users.create({
                firebaseUid: token.uid,
                email: token.email,
                // `name` é NOT NULL e o Firebase não obriga display name: quem entra
                // com email e senha costuma não ter nenhum. O email é um marcador
                // honesto, melhor do que inventar um nome.
                name: token.name ?? token.email,
                emailVerified: token.emailVerified,
                profile: bootstrap ? 'ADMIN' : null,
                profileGrantedAt: bootstrap ? new Date() : null,
                // Concessão do sistema, não de uma pessoa.
                profileGrantedById: null,
            }),
        );

        // Recarrega porque `created_at` e `updated_at` são do banco, e o INSERT do
        // ORM não as escreve nem as traz de volta (spec 0003).
        return users.findOneByOrFail({ id: created.id });
    }

    private async refresh(
        users: Repository<User>,
        existing: User,
        token: VerifiedToken,
    ): Promise<User> {
        const changes: Partial<User> = {};

        if (existing.email !== token.email) changes.email = token.email;

        if (existing.emailVerified !== token.emailVerified) {
            changes.emailVerified = token.emailVerified;
        }

        // Só sobrescreve o nome quando o Firebase de fato tem um: caso contrário,
        // um usuário que já tinha nome voltaria a se chamar pelo email.
        if (token.name && token.name !== existing.name) changes.name = token.name;

        // O bootstrap **só promove** (INV-0010-04). Quem já é ADMIN não é tocado,
        // e assim uma concessão feita por gente preserva o seu `profileGrantedById`
        // (AC-0010-04). O perfil nunca muda por outro caminho aqui.
        if (this.isBootstrapAdmin(token) && existing.profile !== 'ADMIN') {
            changes.profile = 'ADMIN';
            changes.profileGrantedAt = new Date();
            changes.profileGrantedById = null;
        }

        if (Object.keys(changes).length === 0) return existing;

        await users.update({ id: existing.id }, changes);

        return users.findOneByOrFail({ id: existing.id });
    }

    /** Só promove quem tem o email verificado (INV-0010-10). */
    private isBootstrapAdmin(token: VerifiedToken): boolean {
        const configured = this.bootstrapAdminEmail();

        return token.emailVerified && configured !== null && configured === token.email;
    }

    /** Ausente desliga o bootstrap — é o estado esperado depois do primeiro Admin. */
    private bootstrapAdminEmail(): string | null {
        // A assinatura de `getEnv` promete `string`, mas variável opcional sem
        // default simplesmente não existe em `process.env`.
        const raw: string | undefined = this.env.getEnv('IDENTITY_BOOTSTRAP_ADMIN_EMAIL');

        return raw?.trim() ? normalizeEmail(raw) : null;
    }
}

/** O conflito só interessa quando é o UID: outra violação é problema de verdade. */
function isFirebaseUidConflict(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;

    const driverError = error.driverError as { constraint?: string } | undefined;

    return (
        driverError?.constraint === 'uq_users_firebase_uid' ||
        error.message.includes('uq_users_firebase_uid')
    );
}
