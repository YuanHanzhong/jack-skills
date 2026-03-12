import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { resolve, dirname } from "path";
import { mkdirSync } from "fs";

const DB_PATH = resolve(process.cwd(), ".learning-engine/state/engine.db");

let _rawSqlite: Database | null = null;

function createWriteDb(): ReturnType<typeof drizzle> {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  let sqlite: Database;
  try {
    sqlite = new Database(DB_PATH);
  } catch (e) {
    throw new Error(`Failed to open write database at "${DB_PATH}": ${e instanceof Error ? e.message : String(e)}`);
  }
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
  `);
  _rawSqlite = sqlite;
  return drizzle({ client: sqlite });
}

function createReadDb(): ReturnType<typeof drizzle> {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  let sqlite: Database;
  try {
    sqlite = new Database(DB_PATH, { readonly: true });
  } catch (e) {
    throw new Error(`Failed to open read-only database at "${DB_PATH}": ${e instanceof Error ? e.message : String(e)}`);
  }
  sqlite.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
  `);
  return drizzle({ client: sqlite });
}

let _db: ReturnType<typeof drizzle> | null = null;
let _readDb: ReturnType<typeof drizzle> | null = null;

/** Lazy-initialized write DB. */
export function getDb(): ReturnType<typeof drizzle> {
  return (_db ??= createWriteDb());
}

/** Lazy-initialized read-only DB. */
export function getReadDb(): ReturnType<typeof drizzle> {
  return (_readDb ??= createReadDb());
}

// Legacy aliases for backwards compat during migration
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});
export const readDb = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop, receiver) {
    return Reflect.get(getReadDb(), prop, receiver);
  },
});

/** Get raw sqlite handle for pragma operations. */
export function getRawSqlite(): Database {
  if (!_rawSqlite) {
    // Force init via getDb()
    getDb();
  }
  return _rawSqlite!;
}
