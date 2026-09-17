import { Check, Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** Banco no padrão FEBRABAN: três dígitos com zeros à esquerda (`001`, `237`). */
@Entity('banks')
@Unique('uq_banks_febraban_code', ['febrabanCode'])
@Check('ck_banks_febraban_code', "febraban_code ~ '^[0-9]{3}$'")
export class Bank {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'text' })
    febrabanCode!: string;

    @Column({ type: 'text' })
    name!: string;

    /** Registro financeiro não se apaga: encerrar é arquivar (INV-0011-03). */
    @Column({ type: 'timestamptz', nullable: true })
    archivedAt!: Date | null;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    createdAt!: Date;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    updatedAt!: Date;
}
