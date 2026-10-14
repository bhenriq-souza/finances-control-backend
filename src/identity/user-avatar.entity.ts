import { Check, Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from 'typeorm';

import { AVATAR_CONTENT_TYPES, AVATAR_MAX_BYTES, type AvatarContentType } from './avatar-signature';
import { User } from './user.entity';

/**
 * Foto do usuário (spec 0010, revisão de 2026-10-13). Fica fora de `users` para
 * que ler um usuário, o que acontece em toda requisição, não carregue os bytes
 * (INV-0010-14).
 */
@Entity('user_avatars')
@Check('ck_user_avatars_content_type', `content_type IN ('${AVATAR_CONTENT_TYPES.join("', '")}')`)
@Check('ck_user_avatars_size_bytes', `size_bytes BETWEEN 1 AND ${AVATAR_MAX_BYTES}`)
export class UserAvatar {
    @PrimaryColumn({ type: 'uuid' })
    userId!: string;

    @OneToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'fk_user_avatars_user_id' })
    user?: User;

    /**
     * `select: false`: os bytes só saem quando pedidos pelo nome, na leitura da
     * própria foto. Nenhuma consulta comum os arrasta por acidente (INV-0010-14).
     */
    @Column({ type: 'bytea', select: false })
    content!: Buffer;

    @Column({ type: 'text' })
    contentType!: AvatarContentType;

    @Column({ type: 'integer' })
    sizeBytes!: number;

    /** Mantida pelo trigger `set_updated_at()` (spec 0003), como em `users`. */
    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    updatedAt!: Date;
}
