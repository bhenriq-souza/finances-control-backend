import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/**
 * Categoria de despesa. A unicidade de `name` é case-insensitive, por índice
 * funcional `uq_expense_types_name` sobre `lower(name)` — declarado só na migration,
 * pois o TypeORM não modela índice sobre expressão.
 */
@Entity('expense_types')
export class ExpenseType {
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ type: 'text' })
    name!: string;

    @Column({ type: 'timestamptz', nullable: true })
    archivedAt!: Date | null;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    createdAt!: Date;

    @Column({ type: 'timestamptz', insert: false, update: false, default: () => 'now()' })
    updatedAt!: Date;
}
