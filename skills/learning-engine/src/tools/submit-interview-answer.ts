#!/usr/bin/env bun
/**
 * submit_interview_answer — Record an interview practice answer
 * Input: { session_id, answer }
 * Output: { status, attempt_id }
 *
 * Stores in answer_attempts (reuses the same table as test answers)
 */
import { Database } from "bun:sqlite";
import { resolve } from "path";

const DB_PATH = resolve(process.cwd(), ".learning-engine/state/engine.db");

// Named constants for interview answer placeholders
const INTERVIEW_QUESTION_TEXT = "面试陪练回答";
const INTERVIEW_DIFFICULTY = "L2";
const INTERVIEW_QUESTION_TYPE = "INTERVIEW";
const INTERVIEW_SEQUENCE = 0;

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
const { session_id, answer } = input;

if (!session_id || answer === undefined) {
  console.log(JSON.stringify({ status: "error", message: "Missing required fields: session_id, answer" }));
  process.exit(1);
}

const sqlite = new Database(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");

const attempt_id = crypto.randomUUID();
const now = new Date().toISOString();

// Get session's current module (required FK for test_questions)
interface SessionRow { current_module_id: string | null; }
const session = sqlite.query("SELECT current_module_id FROM sessions WHERE id = ?").get(session_id) as SessionRow | null;
if (!session) {
  sqlite.close();
  console.log(JSON.stringify({ status: "error", message: `Session not found: ${session_id}` }));
  process.exit(1);
}

const module_id = session.current_module_id;
if (!module_id) {
  sqlite.close();
  console.log(JSON.stringify({ status: "error", message: "Session has no active module. Cannot record interview answer without a module context." }));
  process.exit(1);
}

// Create a placeholder question for interview answers
const question_id = crypto.randomUUID();
sqlite.prepare(
  `INSERT INTO test_questions (id, session_id, module_id, question_text, difficulty, question_type, sequence, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
).run(question_id, session_id, module_id, INTERVIEW_QUESTION_TEXT, INTERVIEW_DIFFICULTY, INTERVIEW_QUESTION_TYPE, INTERVIEW_SEQUENCE, now);

sqlite.prepare(
  `INSERT INTO answer_attempts (id, question_id, session_id, user_answer, created_at)
   VALUES (?, ?, ?, ?, ?)`
).run(attempt_id, question_id, session_id, answer, now);

sqlite.close();

console.log(JSON.stringify({ status: "ok", attempt_id }));
