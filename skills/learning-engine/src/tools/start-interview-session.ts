#!/usr/bin/env bun
/**
 * start_interview_session — Create a new INTERVIEW session
 * Input: { module_id }
 * Output: { status, session_id }
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
const { module_id } = input;

if (!module_id) {
  console.log(JSON.stringify({ status: "error", message: "Missing required field: module_id" }));
  process.exit(1);
}

const sqlite = new Database(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");

const session_id = crypto.randomUUID();
const now = new Date().toISOString();

sqlite.prepare(
  `INSERT INTO sessions (id, session_type, status, current_module_id, version, created_at, updated_at)
   VALUES (?, 'INTERVIEW', 'INTERVIEW_PREP', ?, 1, ?, ?)`
).run(session_id, module_id, now, now);

sqlite.close();

console.log(JSON.stringify({ status: "ok", session_id }));
