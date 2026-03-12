/**
 * schema_resolver.ts — Maps semantic keys to Notion column names.
 * Uses cached schemas from config.ts with runtime session-cache overlay.
 */

import { ADS_SCHEMA, ODS_SCHEMA, DWD_SCHEMA, DWS_SCHEMA } from "./config.ts";

type DbName = "ODS" | "DWD" | "DWS" | "ADS";

function stripMeta(schema: Record<string, string>): Record<string, string> {
  const { _lastSynced, ...rest } = schema;
  return rest;
}

const FILE_SCHEMAS: Record<DbName, Record<string, string>> = {
  ADS: stripMeta(ADS_SCHEMA),
  ODS: stripMeta(ODS_SCHEMA),
  DWD: stripMeta(DWD_SCHEMA),
  DWS: stripMeta(DWS_SCHEMA),
};

// Session-level cache — updated at runtime without modifying config.ts
const sessionCache: Record<string, Record<string, string>> = {};
const _lastSyncedMeta: Record<string, string> = {};

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

/** Clear the session-level schema cache (e.g. between test runs or forced refresh). */
export function clearCache(): void {
  for (const key of Object.keys(sessionCache)) delete sessionCache[key];
  for (const key of Object.keys(_lastSyncedMeta)) delete _lastSyncedMeta[key];
}

/** Update session cache from a freshly-fetched schema object. */
export function refreshFromFetch(
  db: DbName,
  fetchedProps: Record<string, string>,
): void {
  const { _lastSynced: _, ...cleanProps } = fetchedProps;
  sessionCache[db] = cleanProps;
  _lastSyncedMeta[db] = new Date().toISOString().slice(0, 10);
}

/** Check if a schema's _lastSynced is older than maxDays (default 7). */
export function isStale(db: DbName, maxDays = 7): boolean {
  const origSchemas: Record<DbName, Record<string, string>> = { ADS: ADS_SCHEMA, ODS: ODS_SCHEMA, DWD: DWD_SCHEMA, DWS: DWS_SCHEMA };
  const synced = _lastSyncedMeta[db] ?? origSchemas[db]?._lastSynced;
  if (!synced) return true; // never synced → stale
  const diff = Date.now() - new Date(synced).getTime();
  return diff > maxDays * 86_400_000;
}

/**
 * Check if schema needs refresh and return fetch instruction if so.
 * Returns null if schema is fresh, or an instruction string for Claude to execute.
 */
export function ensureFresh(db: DbName): string | null {
  const idMap: Record<DbName, string> = {
    ODS: "9634cf6c-8c6b-4c19-978a-71c4f33d3294",
    DWD: "78cb3687-2ebf-47f3-8e66-76f1a07f1da0",
    DWS: "0fdba26c-ff3b-45e5-8658-89316783bff2",
    ADS: "1dbff6c4-966e-4184-80b4-9deaf2ea49ff",
  };
  if (!isStale(db) && sessionCache[db]) return null;
  return `⚠️ ${db} schema 需要刷新。请执行 notion-fetch(id="${idMap[db]}") 获取实时 schema，然后调用 refreshFromFetch("${db}", fetchedSchema)。`;
}

/**
 * Validate properties against current schema.
 * Returns { safe, warnings } where safe has invalid keys removed.
 */
export function validateProps(
  db: DbName,
  props: Record<string, unknown>,
): { safe: Record<string, unknown>; warnings: string[] } {
  const schema = getSchema(db);
  const knownCols = new Set(Object.values(schema));
  const safe: Record<string, unknown> = {};
  const warnings: string[] = [];
  for (const [col, val] of Object.entries(props)) {
    if (knownCols.has(col)) {
      safe[col] = val;
    } else {
      warnings.push(`列 "${col}" 不存在于 ${db} schema，已自动过滤`);
    }
  }
  return { safe, warnings };
}

/** Protocol string for SKILL.md to reference when schema drift is detected. */
export const REFRESH_PROTOCOL = `When schema drift detected:
 1. notion-fetch(id=<data_source_id>) to get current schema
 2. Call refreshFromFetch(db, newSchema) to update session cache
 3. Retry the failed operation
 4. Inform user: ⚠️ 检测到 XX 库 schema 变更：列名 A→B，建议我更新 config.ts 吗？`;
