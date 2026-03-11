/**
 * schema_resolver.ts — Maps semantic keys to Notion column names.
 * Uses cached schemas from config.ts with runtime session-cache overlay.
 */

import { ADS_SCHEMA, ODS_SCHEMA, DWD_SCHEMA, DWS_SCHEMA } from "./config.ts";

type DbName = "ODS" | "DWD" | "DWS" | "ADS";

const FILE_SCHEMAS: Record<DbName, Record<string, string>> = {
  ADS: { ...ADS_SCHEMA },
  ODS: { ...ODS_SCHEMA },
  DWD: { ...DWD_SCHEMA },
  DWS: { ...DWS_SCHEMA },
};

// Session-level cache — updated at runtime without modifying config.ts
const sessionCache: Record<string, Record<string, string>> = {};

/** Get merged schema: file cache overlaid with session cache. */
function getSchema(db: DbName): Record<string, string> {
  return { ...FILE_SCHEMAS[db], ...sessionCache[db] };
}

/** Resolve a single semantic key to its Notion column name. */
export function resolve(db: DbName, key: string): string {
  const schema = getSchema(db);
  const col = schema[key];
  if (!col) throw new Error(`Unknown key "${key}" in ${db} schema`);
  return col;
}

/** Batch-build a Notion properties object from semantic key-value pairs. */
export function buildProps(
  db: DbName,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const schema = getSchema(db);
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(values)) {
    const col = schema[key];
    if (!col) throw new Error(`Unknown key "${key}" in ${db} schema`);
    out[col] = val;
  }
  return out;
}

/** Update session cache from a freshly-fetched schema object. */
export function refreshFromFetch(
  db: DbName,
  fetchedProps: Record<string, string>,
): void {
  sessionCache[db] = { ...fetchedProps, _lastSynced: new Date().toISOString().slice(0, 10) };
}

/** Check if a schema's _lastSynced is older than maxDays (default 7). */
export function isStale(db: DbName, maxDays = 7): boolean {
  const schema = getSchema(db);
  const synced = schema._lastSynced;
  if (!synced) return true; // never synced → stale
  const diff = Date.now() - new Date(synced).getTime();
  return diff > maxDays * 86_400_000;
}

/** Protocol string for SKILL.md to reference when schema drift is detected. */
export const REFRESH_PROTOCOL = `When schema drift detected:
 1. notion-fetch(id=<data_source_id>) to get current schema
 2. Call refreshFromFetch(db, newSchema) to update session cache
 3. Retry the failed operation
 4. Inform user: ⚠️ 检测到 XX 库 schema 变更：列名 A→B，建议我更新 config.ts 吗？`;
