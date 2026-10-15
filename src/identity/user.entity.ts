import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

import type { UserProfile } from './user-profile';

/** O vínculo do usuário com o espaço, como o resto do módulo o lê (spec 0021). */
export type UserMembership = {
    workspaceId: string;
    profile: UserProfile;
    grantedAt: Date;
    grantedById: string | null;
};

/**
 * Registro local do usuário, vinculado ao UID do Firebase (ADR-0006). A senha e
 * os provedores de login ficam no Firebase; o que vive aqui é o vínculo e a
 * marca de admin da plataforma. O perfil mora no membro do espaço (spec 0021), e
 * os dois são lidos a cada requisição para decidir autorização.
 */
@Entity('users')
@Unique('uq_users_firebase_uid', ['firebaseUid'])
@Unique('uq_users_email', ['email'])
export class User {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'text' })
    firebaseUid!: string;

    /** Sempre na forma canônica de `normalizeEmail` (INV-0010-08). */
    @Column({ type: 'text' })
    email!: string;

    @Column({ type: 'text' })
    name!: string;

    /** Espelha a claim `email_verified` do último token do usuário (spec 0010). */
    @Column({ type: 'boolean', default: false })
    emailVerified!: boolean;

    /**
     * Quem aprova usuários, gere espaços e escreve os catálogos globais (spec
     * 0021). Não é perfil: vale independente de o usuário ser membro de um espaço.
     */
    @Column({ type: 'boolean', default: false })
    isPlatformAdmin!: boolean;

    /**
     * O membro do espaço, quando há um; nulo é o usuário pendente (INV-0021-02).
     * Não é coluna nem relação do ORM: `withMembership` o carrega de
     * `workspace_members`, e a relação mora só no membro, para que as duas
     * entidades não dependam uma da outra.
     */
    membership?: UserMembership | null;

    /**
     * Mantidas pelo banco (spec 0003): `created_at` pelo default, `updated_at`
     * pelo trigger `set_updated_at()`. `insert`/`update` falsos mantêm as duas
     * fora dos comandos do ORM, para que o banco siga sendo a única fonte delas.
     *
     * O `default` precisa ser declarado aqui mesmo sem o ORM escrever a coluna:
     * sem ele o `migration:generate` enxerga divergência e emite `DROP DEFAULT`
     * na próxima migration gerada — o que quebraria todo INSERT. Vale para toda
     * entidade nova.
     */
    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    createdAt!: Date;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    updatedAt!: Date;
}
