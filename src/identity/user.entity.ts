import {
    Check,
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    Unique,
} from 'typeorm';

import { USER_PROFILES, type UserProfile } from './user-profile';

/**
 * Registro local do usuário, vinculado ao UID do Firebase (ADR-0006). A senha e
 * os provedores de login ficam no Firebase; o que vive aqui é o vínculo e o
 * perfil, que é lido a cada requisição para decidir autorização.
 */
@Entity('users')
@Unique('uq_users_firebase_uid', ['firebaseUid'])
@Unique('uq_users_email', ['email'])
@Check('ck_users_profile', `profile IN ('${USER_PROFILES.join("', '")}')`)
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

    /** Nulo é o estado normal de quem acabou de se cadastrar, não dado faltando. */
    @Column({ type: 'text', nullable: true })
    profile!: UserProfile | null;

    @Column({ type: 'timestamptz', nullable: true })
    profileGrantedAt!: Date | null;

    /**
     * Nulo quando a concessão veio do bootstrap: foi o sistema, não uma pessoa.
     * O nome da coluna é declarado porque a spec 0010 o fixa como
     * `profile_granted_by` — sem o sufixo que a estratégia de nomes daria.
     */
    @Column({ name: 'profile_granted_by', type: 'uuid', nullable: true })
    profileGrantedById!: string | null;

    @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
    @JoinColumn({
        name: 'profile_granted_by',
        foreignKeyConstraintName: 'fk_users_profile_granted_by',
    })
    profileGrantedBy?: User | null;

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
