#!/usr/bin/env bun
/**
 * execute_pending_tasks — Queue a background job (returns immediately)
 * Input: { session_id, job_type, payload? }
 * Output: { status: "task_queued", job_id }
 */
import { Database } from "bun:sqlite";
import { resolve } from "path";

const DB_PATH = resolve(process.cwd(), ".learning-engine/state/engine.db");

const VALID_JOB_TYPES = ["MATERIAL_EXTRACT", "COVERAGE_AUDIT", "CARD_GEN", "PACK_BUILD", "NOTION_SYNC"];

function readInput(): any {
  const arg = process.argv[2];
  if (arg) return JSON.parse(arg);
  try {
    return JSON.parse(require("fs").readFileSync(process.stdin.fd, "utf8"));
  } catch {
    console.log(JSON.stringify({ status: "error", message: "Invalid JSON input" }));
    process.exit(1);
  }
}

const input = readInput();
const { session_id, job_type, payload } = input;

if (!session_id || !job_type) {
  console.log(JSON.stringify({ status: "error", message: "Missing required fields: session_id, job_type" }));
  process.exit(1);
}

if (!VALID_JOB_TYPES.includes(job_type)) {
  console.log(JSON.stringify({ status: "error", message: `Invalid job_type. Must be one of: ${VALID_JOB_TYPES.join(", ")}` }));
  process.exit(1);
}

const sqlite = new Database(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");

const job_id = crypto.randomUUID();
const now = new Date().toISOString();

sqlite.prepare(
  `INSERT INTO jobs (id, session_id, job_type, status, payload_json, attempts, max_attempts, created_at, updated_at)
   VALUES (?, ?, ?, 'QUEUED', ?, 0, 3, ?, ?)`
).run(job_id, session_id, job_type, payload ? JSON.stringify(payload) : null, now, now);

sqlite.close();

console.log(JSON.stringify({ status: "task_queued", job_id }));
