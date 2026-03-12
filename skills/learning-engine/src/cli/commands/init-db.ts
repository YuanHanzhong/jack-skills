#!/usr/bin/env bun
/**
 * init-db.ts — 建库 + 建表 + schema_version
 * Usage: bun run db:init
 */
import { Database } from "bun:sqlite";
import { resolve, dirname } from "path";
import { mkdirSync, existsSync, writeFileSync } from "fs";

const DB_DIR = resolve(process.cwd(), ".learning-engine/state");
const DB_PATH = resolve(DB_DIR, "engine.db");
const CONFIG_DIR = resolve(process.cwd(), ".learning-engine/config");
const SCHEMA_VERSION = 1;

// Ensure directories exist
for (const dir of [DB_DIR, CONFIG_DIR]) {
  mkdirSync(dir, { recursive: true });
}

if (existsSync(DB_PATH)) {
  console.log(`[init-db] Database already exists at ${DB_PATH}`);
  console.log("[init-db] Use db:migrate for schema updates.");
  process.exit(0);
}

const sqlite = new Database(DB_PATH);

sqlite.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  PRAGMA foreign_keys = ON;
  PRAGMA synchronous = NORMAL;
`);

// Create all 20 tables
sqlite.exec(`
  -- Core tables (8)
  -- sessions.material_id and sessions.current_module_id are nullable cursor-tracking
  -- columns. Declaring FK references to materials/modules here would create a circular
  -- dependency (materials -> sessions, modules -> sessions -> materials/modules).
  -- SQLite cannot resolve circular FKs at CREATE TABLE time even with PRAGMA foreign_keys=ON.
  -- Application logic enforces referential integrity for these two nullable columns.
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    session_type TEXT NOT NULL CHECK(session_type IN ('LEARNING', 'INTERVIEW')),
    status TEXT NOT NULL,
    material_id TEXT,
    current_module_id TEXT,
    module_cursor INTEGER,
    current_phase_scope TEXT CHECK(current_phase_scope IN ('MATERIAL', 'MODULE')),
    current_cursor TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    last_event_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE materials (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    title TEXT NOT NULL,
    source_url TEXT,
    content_hash TEXT NOT NULL UNIQUE,
    chunk_count INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('PENDING', 'INGESTED', 'ARCHIVED')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE modules (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    material_id TEXT NOT NULL REFERENCES materials(id),
    title TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('PENDING', 'ACTIVE', 'COMPLETED')),
    concept_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE concepts (
    id TEXT PRIMARY KEY,
    module_id TEXT NOT NULL REFERENCES modules(id),
    name TEXT NOT NULL,
    description TEXT,
    is_core INTEGER NOT NULL DEFAULT 0,
    target_tier TEXT NOT NULL CHECK(target_tier IN ('DWD', 'DWS', 'ADS')),
    mastery_status TEXT NOT NULL CHECK(mastery_status IN ('NOT_STARTED', 'IN_PROGRESS', 'MASTERED')),
    mastery_score REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE cards (
    id TEXT PRIMARY KEY,
    concept_id TEXT NOT NULL REFERENCES concepts(id),
    card_type TEXT NOT NULL CHECK(card_type IN ('COVERAGE', 'CARD_POINT', 'APPLICATION', 'EXPRESSION', 'PROJECT_EVIDENCE')),
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    dedup_key TEXT NOT NULL UNIQUE,
    priority TEXT NOT NULL CHECK(priority IN ('P0', 'P1', 'P2', 'P3')),
    next_review_at TEXT,
    review_count INTEGER NOT NULL DEFAULT 0,
    ease_factor REAL NOT NULL DEFAULT 2.5,
    interval_days INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL CHECK(status IN ('ACTIVE', 'ARCHIVED', 'MERGED')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE stories (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    situation TEXT,
    task_text TEXT,
    action_text TEXT,
    result_text TEXT,
    takeaway TEXT,
    project_name TEXT,
    tags_json TEXT,
    status TEXT NOT NULL CHECK(status IN ('DRAFT', 'REVIEWED', 'FINAL')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE interview_packs (
    id TEXT PRIMARY KEY,
    module_id TEXT NOT NULL REFERENCES modules(id),
    session_id TEXT NOT NULL REFERENCES sessions(id),
    pack_type TEXT NOT NULL CHECK(pack_type IN ('MODULE_PACK', 'INTERVIEW_SCRIPT')),
    one_liner TEXT,
    core_points_json TEXT,
    deep_dive_json TEXT,
    project_evidence_json TEXT,
    gotcha_defense_json TEXT,
    status TEXT NOT NULL CHECK(status IN ('DRAFT', 'VALIDATED', 'FINAL')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE problems (
    id TEXT PRIMARY KEY,
    module_id TEXT NOT NULL REFERENCES modules(id),
    title TEXT NOT NULL,
    description TEXT,
    category TEXT,
    difficulty TEXT NOT NULL CHECK(difficulty IN ('L1', 'L2', 'L3')),
    related_concepts_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Auxiliary tables (8)
  CREATE TABLE material_chunks (
    id TEXT PRIMARY KEY,
    material_id TEXT NOT NULL REFERENCES materials(id),
    sequence INTEGER NOT NULL,
    content TEXT NOT NULL,
    hash TEXT NOT NULL,
    audit_status TEXT NOT NULL CHECK(audit_status IN ('PENDING', 'MAPPED', 'MERGED', 'SKIPPED')),
    mapped_concept_id TEXT REFERENCES concepts(id),
    density_score REAL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE concept_relations (
    id TEXT PRIMARY KEY,
    source_concept_id TEXT NOT NULL REFERENCES concepts(id),
    target_concept_id TEXT NOT NULL REFERENCES concepts(id),
    relation_type TEXT NOT NULL CHECK(relation_type IN ('PREREQUISITE', 'RELATED', 'EXTENDS', 'CONTRADICTS')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE test_questions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    module_id TEXT NOT NULL REFERENCES modules(id),
    concept_id TEXT REFERENCES concepts(id),
    question_text TEXT NOT NULL,
    difficulty TEXT NOT NULL CHECK(difficulty IN ('L1', 'L2', 'L3')),
    question_type TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE answer_attempts (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL REFERENCES test_questions(id),
    session_id TEXT NOT NULL REFERENCES sessions(id),
    user_answer TEXT NOT NULL,
    is_correct INTEGER,
    score REAL,
    feedback TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE scoring_results (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    module_id TEXT NOT NULL REFERENCES modules(id),
    concept_id TEXT NOT NULL REFERENCES concepts(id),
    dimension TEXT NOT NULL CHECK(dimension IN ('RECALL', 'UNDERSTANDING', 'APPLICATION', 'EXPRESSION', 'INSIGHT')),
    score REAL NOT NULL,
    evidence TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE story_links (
    id TEXT PRIMARY KEY,
    concept_id TEXT NOT NULL REFERENCES concepts(id),
    story_id TEXT NOT NULL REFERENCES stories(id),
    relevance_score REAL NOT NULL,
    selected INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(concept_id, story_id)
  );

  CREATE TABLE review_queue (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL REFERENCES cards(id),
    scheduled_at TEXT NOT NULL,
    priority TEXT NOT NULL CHECK(priority IN ('P0', 'P1', 'P2', 'P3')),
    status TEXT NOT NULL CHECK(status IN ('PENDING', 'COMPLETED', 'SKIPPED')),
    completed_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE pending_questions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    question_text TEXT NOT NULL,
    source_type TEXT NOT NULL CHECK(source_type IN ('IN_MODULE', 'CROSS_MODULE', 'PROJECT_EXPRESSION', 'UNRELATED')),
    target_module_id TEXT REFERENCES modules(id),
    status TEXT NOT NULL CHECK(status IN ('PENDING', 'RESOLVED', 'DEFERRED')),
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );

  -- Dual-track tables (2)
  CREATE TABLE coverage_rails (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    module_id TEXT NOT NULL REFERENCES modules(id),
    concept_id TEXT NOT NULL REFERENCES concepts(id),
    status TEXT NOT NULL CHECK(status IN ('NOT_COVERED', 'PARTIALLY_COVERED', 'FULLY_COVERED')),
    coverage_evidence TEXT,
    updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(session_id, module_id, concept_id)
  );

  CREATE TABLE weakness_rails (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    module_id TEXT NOT NULL REFERENCES modules(id),
    concept_id TEXT NOT NULL REFERENCES concepts(id),
    weakness_type TEXT NOT NULL CHECK(weakness_type IN ('RECALL', 'UNDERSTANDING', 'APPLICATION', 'EXPRESSION', 'INSIGHT')),
    status TEXT NOT NULL CHECK(status IN ('IDENTIFIED', 'CARD_GENERATED', 'RESOLVED')),
    evidence TEXT,
    card_id TEXT REFERENCES cards(id),
    updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  -- Snapshot table (1)
  CREATE TABLE session_snapshots (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    reason TEXT NOT NULL CHECK(reason IN ('STOP', 'PRE_COMPACT', 'MODULE_SWITCH', 'CRASH_RECOVERY')),
    state_json TEXT NOT NULL,
    resume_context_pack_json TEXT,
    resume_pack_version INTEGER,
    created_at TEXT NOT NULL
  );

  -- Async job table (1)
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    module_id TEXT REFERENCES modules(id),
    job_type TEXT NOT NULL CHECK(job_type IN ('MATERIAL_EXTRACT', 'COVERAGE_AUDIT', 'CARD_GEN', 'PACK_BUILD', 'NOTION_SYNC')),
    status TEXT NOT NULL CHECK(status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
    payload_json TEXT,
    result_summary_json TEXT,
    error_message TEXT,
    started_at TEXT,
    finished_at TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    timeout_seconds INTEGER NOT NULL DEFAULT 90,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Indexes
  CREATE INDEX sessions_status_updated_at_idx ON sessions(status, updated_at);
  CREATE INDEX modules_session_id_status_idx ON modules(session_id, status);
  CREATE INDEX concepts_module_id_is_core_idx ON concepts(module_id, is_core);
  CREATE INDEX concepts_target_tier_mastery_status_idx ON concepts(target_tier, mastery_status);
  CREATE INDEX material_chunks_material_id_audit_status_idx ON material_chunks(material_id, audit_status);
  CREATE INDEX cards_concept_id_card_type_idx ON cards(concept_id, card_type);
  CREATE INDEX cards_next_review_at_priority_idx ON cards(next_review_at, priority);
  CREATE INDEX review_queue_scheduled_at_priority_idx ON review_queue(scheduled_at, priority);
  CREATE INDEX story_links_concept_id_selected_idx ON story_links(concept_id, selected);
  CREATE INDEX weakness_rails_status_idx ON weakness_rails(session_id, module_id, concept_id, status);
  CREATE INDEX weakness_rails_type_status_idx ON weakness_rails(session_id, module_id, concept_id, weakness_type, status);
  CREATE INDEX session_snapshots_session_reason_idx ON session_snapshots(session_id, reason);
  CREATE INDEX session_snapshots_session_created_idx ON session_snapshots(session_id, created_at);
  CREATE INDEX jobs_session_status_idx ON jobs(session_id, status);
  CREATE INDEX jobs_status_created_idx ON jobs(status, created_at);

  -- Schema version tracking
  CREATE TABLE IF NOT EXISTS _schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  INSERT INTO _schema_meta (key, value) VALUES ('schema_version', '${SCHEMA_VERSION}');
  INSERT INTO _schema_meta (key, value) VALUES ('created_at', datetime('now'));
`);

// Write schema_version config
writeFileSync(
  resolve(CONFIG_DIR, "schema_version.json"),
  JSON.stringify({ schema_version: SCHEMA_VERSION, created_at: new Date().toISOString() }, null, 2)
);

sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
sqlite.close();

console.log(`[init-db] Database created at ${DB_PATH}`);
console.log(`[init-db] Schema version: ${SCHEMA_VERSION}`);
console.log(`[init-db] 20 tables + indexes created successfully.`);
