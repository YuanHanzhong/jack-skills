#!/usr/bin/env bun
/**
 * export_mastery_map — Export all concepts with mastery scores for a session
 * Input: { session_id }
 * Output: { status, session_id, concepts[] }
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
const { session_id } = input;

if (!session_id) {
  console.log(JSON.stringify({ status: "error", message: "Missing required field: session_id" }));
  process.exit(1);
}

const sqlite = new Database(DB_PATH, { readonly: true });
sqlite.exec("PRAGMA busy_timeout = 5000;");

const concepts = sqlite.query(
  `SELECT c.id, c.name, c.description, c.module_id, c.target_tier,
          c.mastery_status, c.mastery_score, c.is_core,
          m.title AS module_title, m.sequence AS module_sequence
   FROM concepts c
   JOIN modules m ON c.module_id = m.id
   WHERE m.session_id = ?
   ORDER BY m.sequence, c.name`
).all(session_id) as Record<string, unknown>[];

sqlite.close();

console.log(JSON.stringify({ status: "ok", session_id, concepts }));
