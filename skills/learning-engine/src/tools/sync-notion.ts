#!/usr/bin/env bun
/**
 * sync_notion — Queue a NOTION_SYNC background job
 * Input: { session_id, sync_type? }
 * Output: { status: "task_queued", job_id }
 */
import { Database } from "bun:sqlite";
import { resolve } from "path";

const DB_PATH = resolve(process.cwd(), ".learning-engine/state/engine.db");

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
const { session_id, sync_type } = input;

if (!session_id) {
  console.log(JSON.stringify({ status: "error", message: "Missing required field: session_id" }));
  process.exit(1);
}

const sqlite = new Database(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");

const job_id = crypto.randomUUID();
const now = new Date().toISOString();
const payload = sync_type ? JSON.stringify({ sync_type }) : null;

sqlite.prepare(
  `INSERT INTO jobs (id, session_id, job_type, status, payload_json, attempts, max_attempts, created_at, updated_at)
   VALUES (?, ?, 'NOTION_SYNC', 'QUEUED', ?, 0, 3, ?, ?)`
).run(job_id, session_id, payload, now, now);

sqlite.close();

console.log(JSON.stringify({ status: "task_queued", job_id }));
