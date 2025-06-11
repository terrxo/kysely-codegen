import Database from 'better-sqlite3';
import { Kysely, SqliteDialect, sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { SqliteIntrospector } from './sqlite-introspector';

describe('SqliteIntrospector', () => {
  it('should introspect CHECK constraints as enum values', async () => {
    // Create an in-memory SQLite database
    const db = new Kysely({
      dialect: new SqliteDialect({
        database: new Database(':memory:'),
      }),
    });

    // Create tables with CHECK constraints that look like enums
    await sql`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT CHECK (status IN ('public', 'restricted', 'private')) NOT NULL DEFAULT 'restricted',
        role TEXT CHECK (role IN ('admin', 'user', 'guest')) NOT NULL DEFAULT 'user'
      )
    `.execute(db);

    await sql`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        visibility TEXT CHECK (visibility IN ('draft', 'published', 'archived')) NOT NULL DEFAULT 'draft'
      )
    `.execute(db);

    // Test the introspector
    const introspector = new SqliteIntrospector();
    const metadata = await introspector.introspect({ db });

    // Verify table metadata includes enum values
    const usersTable = metadata.tables.find((t) => t.name === 'users');
    expect(usersTable).toBeDefined();

    const statusColumn = usersTable?.columns.find((c) => c.name === 'status');
    expect(statusColumn?.enumValues).toEqual([
      'private',
      'public',
      'restricted',
    ]); // sorted

    const roleColumn = usersTable?.columns.find((c) => c.name === 'role');
    expect(roleColumn?.enumValues).toEqual(['admin', 'guest', 'user']); // sorted

    const postsTable = metadata.tables.find((t) => t.name === 'posts');
    expect(postsTable).toBeDefined();

    const visibilityColumn = postsTable?.columns.find(
      (c) => c.name === 'visibility',
    );
    expect(visibilityColumn?.enumValues).toEqual([
      'archived',
      'draft',
      'published',
    ]); // sorted

    await db.destroy();
  });

  it('should handle tables without CHECK constraints', async () => {
    const db = new Kysely({
      dialect: new SqliteDialect({
        database: new Database(':memory:'),
      }),
    });

    await sql`
      CREATE TABLE simple_table (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      )
    `.execute(db);

    const introspector = new SqliteIntrospector();
    const metadata = await introspector.introspect({ db });

    // Columns should not have enum values
    const table = metadata.tables.find((t) => t.name === 'simple_table');
    expect(table).toBeDefined();

    for (const column of table!.columns) {
      expect(column.enumValues).toBeNull();
    }

    await db.destroy();
  });

  it('should handle complex CHECK constraints', async () => {
    const db = new Kysely({
      dialect: new SqliteDialect({
        database: new Database(':memory:'),
      }),
    });

    await sql`
      CREATE TABLE complex_table (
        id INTEGER PRIMARY KEY,
        status TEXT CHECK (status IN ('active', 'inactive', 'pending')) NOT NULL,
        priority INTEGER CHECK (priority BETWEEN 1 AND 5),
        category TEXT CHECK (category IN ('urgent', 'normal', 'low'))
      )
    `.execute(db);

    const introspector = new SqliteIntrospector();
    const metadata = await introspector.introspect({ db });

    const table = metadata.tables.find((t) => t.name === 'complex_table');
    expect(table).toBeDefined();

    // Should only extract enum-like CHECK constraints (IN clauses)
    const statusColumn = table?.columns.find((c) => c.name === 'status');
    expect(statusColumn?.enumValues).toEqual(['active', 'inactive', 'pending']); // sorted

    const categoryColumn = table?.columns.find((c) => c.name === 'category');
    expect(categoryColumn?.enumValues).toEqual(['low', 'normal', 'urgent']); // sorted

    // Should not extract non-enum CHECK constraints
    const priorityColumn = table?.columns.find((c) => c.name === 'priority');
    expect(priorityColumn?.enumValues).toBeNull();

    await db.destroy();
  });
});
