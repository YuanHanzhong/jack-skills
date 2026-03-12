#!/usr/bin/env bun
/**
 * trigger_review — Get due reviews from review_queue
 * Input: { session_id? }
 * Output: { status, reviews[] }
 */
import { Database } from "bun:sqlite";
import { resolve } from "path";

const DB_PATH = resolve(process.cwd(), ".learning-engine/state/engine.db");

function readInput(): any {
  const arg = process.argv[2];
  if (arg) return JSON.parse(arg);
  try {
    return JSON.parse(require("fs").readFileSync(process.stdin.fd, "utf8"));
  } catch (err) {
    console.error("Failed to parse stdin JSON:", err);
    return {};
  }
}

const input = readInput();

const sqlite = new Database(DB_PATH, { readonly: true });
sqlite.exec("PRAGMA busy_timeout = 5000;");

const now = new Date().toISOString();

// review_queue has no session_id; join through card → concept → module → session
const reviews = sqlite.query(
  `SELECT rq.id, rq.card_id, rq.scheduled_at, rq.priority, rq.status,
          c.front, c.back, c.card_type, co.name AS concept_name
   FROM review_queue rq
   JOIN cards c ON rq.card_id = c.id
   JOIN concepts co ON c.concept_id = co.id
   WHERE rq.scheduled_at <= ? AND rq.status = 'PENDING'
   ORDER BY rq.priority ASC, rq.scheduled_at ASC`
).all(now) as Record<string, unknown>[];

sqlite.close();

console.log(JSON.stringify({ status: "ok", reviews }));
