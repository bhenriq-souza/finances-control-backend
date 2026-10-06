import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Tipo de receita. A unicidade de `name` é case-insensitive, por índice único
 * funcional sobre `lower(name)` declarado na migration — o TypeORM não o
 * descreve, daí `synchronize: false`.
 */
@Entity('earning_types')
@Index('uq_earning_types_name', { synchronize: false })
export class EarningType {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'text' })
    name!: string;

    /** Registro financeiro não se apaga: encerrar é arquivar. */
    @Column({ type: 'timestamptz', nullable: true })
    archivedAt!: Date | null;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    createdAt!: Date;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    updatedAt!: Date;
}
