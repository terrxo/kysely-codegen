import type { TableMetadata as KyselyTableMetadata } from 'kysely';
import { EnumCollection } from '../../enum-collection';
import type { IntrospectOptions } from '../../introspector';
import { Introspector } from '../../introspector';
import { DatabaseMetadata } from '../../metadata/database-metadata';

// Simple SQL parser for CHECK constraints with IN clauses
class CheckConstraintParser {
  static parseEnumConstraints(
    sql: string,
  ): { column: string; values: string[] }[] {
    const constraints: { column: string; values: string[] }[] = [];

    // Normalize the SQL by removing extra whitespace and converting to lowercase for parsing
    const normalizedSql = sql.replaceAll(/\s+/g, ' ').toLowerCase();

    // Find all CHECK constraints
    let searchIndex = 0;
    while (true) {
      const checkIndex = normalizedSql.indexOf('check', searchIndex);
      if (checkIndex === -1) break;

      // Find the opening parenthesis after CHECK
      const openParenIndex = normalizedSql.indexOf('(', checkIndex);
      if (openParenIndex === -1) break;

      // Find the matching closing parenthesis
      const constraintContent = this.extractParenthesesContent(
        normalizedSql,
        openParenIndex,
      );
      if (!constraintContent) {
        searchIndex = openParenIndex + 1;
        continue;
      }

      // Parse the constraint content for IN clauses
      const enumConstraint = this.parseInConstraint(constraintContent);
      if (enumConstraint) {
        constraints.push(enumConstraint);
      }

      searchIndex = openParenIndex + constraintContent.length + 2; // +2 for the parentheses
    }

    return constraints;
  }

  private static extractParenthesesContent(
    sql: string,
    startIndex: number,
  ): string | null {
    let depth = 0;
    let content = '';

    for (let i = startIndex; i < sql.length; i++) {
      const char = sql[i];

      if (char === '(') {
        depth++;
        if (depth > 1) content += char;
      } else if (char === ')') {
        depth--;
        if (depth === 0) {
          return content;
        }
        content += char;
      } else if (depth > 0) content += char;
    }

    return null; // Unmatched parentheses
  }

  private static parseInConstraint(
    constraintContent: string,
  ): { column: string; values: string[] } | null {
    // Look for pattern: column_name IN (value1, value2, ...)
    const inMatch = constraintContent.match(
      /^\s*([A-Z_a-z]\w*)\s+in\s*\(\s*(.+?)\s*\)\s*$/,
    );
    if (!inMatch?.[1] || !inMatch[2]) return null;

    const columnName = inMatch[1];
    const valuesString = inMatch[2];

    // Parse the comma-separated values
    const values = this.parseValueList(valuesString);

    return values.length > 0 ? { column: columnName, values } : null;
  }

  private static parseValueList(valuesString: string): string[] {
    const values: string[] = [];
    let currentValue = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < valuesString.length; i++) {
      const char = valuesString[i];

      if (!inQuotes && (char === '"' || char === "'")) {
        inQuotes = true;
        quoteChar = char;
      } else if (inQuotes && char === quoteChar) {
        // Check for escaped quote
        if (i + 1 < valuesString.length && valuesString[i + 1] === quoteChar) {
          currentValue += char;
          i++; // Skip the next quote
        } else {
          inQuotes = false;
          quoteChar = '';
        }
      } else if (!inQuotes && char === ',') {
        const trimmed = currentValue.trim();
        if (trimmed) values.push(trimmed);
        currentValue = '';
      } else {
        currentValue += char;
      }
    }

    // Add the last value
    const trimmed = currentValue.trim();
    if (trimmed) values.push(trimmed);

    return values;
  }
}

export class SqliteIntrospector extends Introspector<any> {
  createDatabaseMetadata({
    enums,
    tables: rawTables,
  }: {
    enums: EnumCollection;
    tables: KyselyTableMetadata[];
  }) {
    const tables = rawTables.map((table) => ({
      ...table,
      columns: table.columns.map((column) => {
        const enumKey = `${table.name}.${column.name}`;
        const enumValues = enums.get(enumKey);
        return {
          ...column,
          enumValues,
        };
      }),
    }));
    return new DatabaseMetadata({ tables });
  }

  async introspect(options: IntrospectOptions<any>) {
    const tables = await this.getTables(options);
    const enums = await this.introspectCheckConstraintEnums(options.db);
    return this.createDatabaseMetadata({ enums, tables });
  }

  private async introspectCheckConstraintEnums(db: any) {
    const enums = new EnumCollection();

    // Query sqlite_master to get CREATE TABLE statements
    const rows = await db
      .withoutPlugins()
      .selectFrom('sqlite_master')
      .select(['name', 'sql'])
      .where('type', '=', 'table')
      .where('sql', 'is not', null)
      .execute();

    for (const row of rows) {
      if (!row.sql) continue;

      // Parse CHECK constraints from the CREATE TABLE statement
      const constraints = CheckConstraintParser.parseEnumConstraints(row.sql);

      for (const constraint of constraints) {
        const key = `${row.name}.${constraint.column}`;
        // Sort the enum values for consistency
        const sortedValues = [...constraint.values].sort();
        enums.set(key, sortedValues);
      }
    }

    return enums;
  }
}
