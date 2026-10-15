import {
    Check,
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    OneToOne,
    PrimaryColumn,
    Unique,
} from 'typeorm';

import { USER_PROFILES, type UserProfile } from './user-profile';
import { User } from './user.entity';
import { Workspace } from './workspace.entity';

/**
 * Vínculo de um usuário com um espaço, com o perfil que vale dentro dele (spec
 * 0021). O único em `user_id` limita a um espaço por usuário (INV-0021-02).
 */
@Entity('workspace_members')
@Unique('uq_workspace_members_user_id', ['userId'])
@Check('ck_workspace_members_profile', `profile IN ('${USER_PROFILES.join("', '")}')`)
export class WorkspaceMember {
    @PrimaryColumn({ type: 'uuid' })
    workspaceId!: string;

    @ManyToOne(() => Workspace, { nullable: false, onDelete: 'RESTRICT' })
    @JoinColumn({
        name: 'workspace_id',
        foreignKeyConstraintName: 'fk_workspace_members_workspace_id',
    })
    workspace?: Workspace;

    @PrimaryColumn({ type: 'uuid' })
    userId!: string;

    @ManyToOne(() => User, { nullable: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'fk_workspace_members_user_id' })
    user?: User;

    @Column({ type: 'text' })
    profile!: UserProfile;

    @Column({ type: 'timestamptz' })
    grantedAt!: Date;

    /** Nulo quando a concessão veio do sistema (bootstrap), não de uma pessoa. */
    @Column({ name: 'granted_by', type: 'uuid', nullable: true })
    grantedById!: string | null;

    @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
    @JoinColumn({
        name: 'granted_by',
        foreignKeyConstraintName: 'fk_workspace_members_granted_by',
    })
    grantedBy?: User | null;
}
