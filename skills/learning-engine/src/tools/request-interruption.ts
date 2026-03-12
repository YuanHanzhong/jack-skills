#!/usr/bin/env bun
/**
 * request_interruption — Write a pending question for human clarification
 * Input: { session_id, question_text, source_type }
 * Output: { status, question_id }
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
const { session_id, question_text, source_type } = input;

if (!session_id || !question_text || !source_type) {
  console.log(JSON.stringify({ status: "error", message: "Missing required fields: session_id, question_text, source_type" }));
  process.exit(1);
}

const sqlite = new Database(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");

const question_id = crypto.randomUUID();
const now = new Date().toISOString();

sqlite.prepare(
  `INSERT INTO pending_questions (id, session_id, question_text, source_type, status, created_at)
   VALUES (?, ?, ?, ?, 'PENDING', ?)`
).run(question_id, session_id, question_text, source_type, now);

sqlite.close();

console.log(JSON.stringify({ status: "ok", question_id }));
