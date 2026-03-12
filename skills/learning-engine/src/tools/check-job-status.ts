#!/usr/bin/env bun
/**
 * check_job_status — Poll job status until terminal or timeout
 * Input: { job_id }
 * Output: { status, job_id, result_summary_json? } or { status: "RUNNING", message }
 *
 * CRITICAL: Contains internal Bun.sleep() blocking poll loop (2s × 20 = ~40s max).
 */
import { Database } from "bun:sqlite";
import { resolve } from "path";
import { THRESHOLDS } from "../core/config.ts";

const DB_PATH = resolve(process.cwd(), ".learning-engine/state/engine.db");
const MAX_POLLS = THRESHOLDS.DAEMON_MAX_POLLS;
const POLL_INTERVAL_MS = THRESHOLDS.DAEMON_POLL_INTERVAL_MS;

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
const { job_id } = input;

if (!job_id) {
  console.log(JSON.stringify({ status: "error", message: "Missing required field: job_id" }));
  process.exit(1);
}

const sqlite = new Database(DB_PATH, { readonly: true });
sqlite.exec("PRAGMA busy_timeout = 5000;");

try {
  for (let i = 0; i < MAX_POLLS; i++) {
    interface JobRow { id: string; status: string; job_type: string; result_summary_json: string | null; error_message: string | null; }
    const job = sqlite.query(`SELECT * FROM jobs WHERE id = ?`).get(job_id) as JobRow | null;

    if (!job) {
      console.log(JSON.stringify({ status: "error", message: `Job not found: ${job_id}` }));
      process.exit(1);
    }

    if (job.status === "SUCCEEDED" || job.status === "FAILED") {
      console.log(JSON.stringify({
        status: job.status,
        job_id,
        job_type: job.job_type,
        result_summary_json: job.result_summary_json ? (() => { try { return JSON.parse(job.result_summary_json!); } catch { return job.result_summary_json; } })() : null,
        error_message: job.error_message ?? null,
      }));
      process.exit(0);
    }

    if (i < MAX_POLLS - 1) {
      await Bun.sleep(POLL_INTERVAL_MS);
    }
  }

  console.log(JSON.stringify({ status: "RUNNING", job_id, message: "再调一次" }));
} finally {
  sqlite.close();
}
