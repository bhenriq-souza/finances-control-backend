import { createHash } from 'node:crypto';
import { DefaultNamingStrategy } from 'typeorm';
import type { NamingStrategyInterface, Table, View } from 'typeorm';

/** Limite de identificador do PostgreSQL: além disso o servidor trunca em silêncio. */
const MAX_IDENTIFIER_LENGTH = 63;

const toSnakeCase = (value: string): string =>
    value
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .toLowerCase();

const nameOf = (tableOrName: Table | View | string): string =>
    typeof tableOrName === 'string' ? tableOrName : tableOrName.name;

/** Trunca preservando o prefixo, que é o que identifica o tipo do objeto. */
const limit = (identifier: string): string =>
    identifier.length <= MAX_IDENTIFIER_LENGTH
        ? identifier
        : identifier.slice(0, MAX_IDENTIFIER_LENGTH);

/**
 * Convenções de nome da spec 0003: tabelas e colunas em `snake_case`, objetos de
 * schema prefixados pelo tipo (`pk_`, `fk_`, `uq_`, `idx_`, `ck_`).
 *
 * A estratégia não pluraliza nomes de tabela — pluralização automática erra em
 * irregulares. A tabela declara seu nome no `@Entity('bank_accounts')`, e o que
 * sobra para a estratégia é o `snake_case` de tudo o que não foi declarado.
 */
export class SnakeCaseNamingStrategy
    extends DefaultNamingStrategy
    implements NamingStrategyInterface
{
    override tableName(targetName: string, userSpecifiedName: string | undefined): string {
        return userSpecifiedName ?? toSnakeCase(targetName);
    }

    override columnName(
        propertyName: string,
        customName: string | undefined,
        embeddedPrefixes: string[],
    ): string {
        const name = customName ?? toSnakeCase(propertyName);

        return [...embeddedPrefixes.map(toSnakeCase), name].join('_');
    }

    override relationName(propertyName: string): string {
        return toSnakeCase(propertyName);
    }

    override joinColumnName(relationName: string, referencedColumnName: string): string {
        return limit(`${toSnakeCase(relationName)}_${toSnakeCase(referencedColumnName)}`);
    }

    override joinTableName(
        firstTableName: string,
        secondTableName: string,
        firstPropertyName: string,
        _secondPropertyName: string,
    ): string {
        return limit(`${firstTableName}_${toSnakeCase(firstPropertyName)}_${secondTableName}`);
    }

    override joinTableColumnName(
        tableName: string,
        propertyName: string,
        columnName?: string,
    ): string {
        return limit(`${tableName}_${toSnakeCase(columnName ?? propertyName)}`);
    }

    override primaryKeyName(tableOrName: Table | string, _columnNames: string[]): string {
        return limit(`pk_${nameOf(tableOrName)}`);
    }

    override uniqueConstraintName(tableOrName: Table | string, columnNames: string[]): string {
        return limit(`uq_${nameOf(tableOrName)}_${columnNames.join('_')}`);
    }

    override foreignKeyName(tableOrName: Table | string, columnNames: string[]): string {
        return limit(`fk_${nameOf(tableOrName)}_${columnNames.join('_')}`);
    }

    override indexName(tableOrName: Table | View | string, columns: string[]): string {
        return limit(`idx_${nameOf(tableOrName)}_${columns.join('_')}`);
    }

    override checkConstraintName(tableOrName: Table | string, expression: string): string {
        // A expressão não vira nome legível; um hash curto mantém o nome estável
        // entre gerações. Migration escrita à mão deve nomear o check explicitamente.
        const digest = createHash('sha1').update(expression).digest('hex').slice(0, 8);

        return limit(`ck_${nameOf(tableOrName)}_${digest}`);
    }
}
