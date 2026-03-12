#!/usr/bin/env bun
/**
 * submit_answer — Submit a test answer
 * Input: { question_id, session_id, user_answer }
 * Output: { status, attempt_id }
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
const { question_id, session_id, user_answer } = input;

if (!question_id || !session_id || user_answer === undefined) {
  console.log(JSON.stringify({ status: "error", message: "Missing required fields: question_id, session_id, user_answer" }));
  process.exit(1);
}

const sqlite = new Database(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");

const attempt_id = crypto.randomUUID();
const now = new Date().toISOString();

sqlite.prepare(
  `INSERT INTO answer_attempts (id, question_id, session_id, user_answer, created_at)
   VALUES (?, ?, ?, ?, ?)`
).run(attempt_id, question_id, session_id, user_answer, now);

sqlite.close();

console.log(JSON.stringify({ status: "ok", attempt_id }));
