import { Check, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Espaço (spec 0021): a unidade de isolamento, o equivalente a "uma conta no app".
 * Todo registro financeiro pertence a exatamente um espaço.
 */
@Entity('workspaces')
@Check('ck_workspaces_name', 'char_length(name) BETWEEN 1 AND 80 AND name = btrim(name)')
export class Workspace {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'text' })
    name!: string;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    createdAt!: Date;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    updatedAt!: Date;
}
