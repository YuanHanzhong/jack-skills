#!/usr/bin/env bun
/**
 * verify-db.ts — 校验数据库完整性
 */
import { Database } from "bun:sqlite";
import { resolve } from "path";
import { existsSync } from "fs";

const DB_PATH = resolve(process.cwd(), ".learning-engine/state/engine.db");

if (!existsSync(DB_PATH)) {
  console.error("[verify-db] Database not found. Run `bun run db:init` first.");
  process.exit(1);
}

const sqlite = new Database(DB_PATH, { readonly: true });
sqlite.exec("PRAGMA busy_timeout = 5000;");
sqlite.exec("PRAGMA foreign_keys = ON;");

const EXPECTED_TABLES = [
  "sessions", "materials", "modules", "concepts", "cards", "stories",
  "interview_packs", "problems", "material_chunks", "concept_relations",
  "test_questions", "answer_attempts", "scoring_results", "story_links",
  "review_queue", "pending_questions", "coverage_rails", "weakness_rails",
  "session_snapshots", "jobs", "_schema_meta",
];

let errors = 0;

// Check tables exist
const tables = sqlite
  .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
  .all()
  .map((r: any) => r.name);

for (const t of EXPECTED_TABLES) {
  if (!tables.includes(t)) {
    console.error(`[verify-db] MISSING TABLE: ${t}`);
    errors++;
  }
}

// Check schema version
const meta = sqlite.query("SELECT value FROM _schema_meta WHERE key = 'schema_version'").get() as any;
if (!meta) {
  console.error("[verify-db] Missing schema_version in _schema_meta");
  errors++;
} else {
  console.log(`[verify-db] Schema version: ${meta.value}`);
}

// Foreign key integrity check
const fkErrors = sqlite.query("PRAGMA foreign_key_check").all();
if (fkErrors.length > 0) {
  console.error(`[verify-db] Foreign key violations: ${fkErrors.length}`);
  errors += fkErrors.length;
}

// Integrity check
const integrity = sqlite.query("PRAGMA integrity_check").get() as any;
if (integrity?.integrity_check !== "ok") {
  console.error(`[verify-db] Integrity check failed: ${JSON.stringify(integrity)}`);
  errors++;
}

// Table row counts
console.log("\n[verify-db] Table row counts:");
for (const t of EXPECTED_TABLES.filter((t) => t !== "_schema_meta")) {
  const count = sqlite.query(`SELECT COUNT(*) as c FROM ${t}`).get() as any;
  console.log(`  ${t}: ${count.c}`);
}

sqlite.close();

if (errors > 0) {
  console.error(`\n[verify-db] FAILED: ${errors} error(s) found.`);
  process.exit(1);
} else {
  console.log("\n[verify-db] All checks passed.");
}
