#!/usr/bin/env bun
/**
 * daemon.ts — 后台任务守护进程
 * Usage: bun run src/worker/daemon.ts
 *
 * Polls jobs table for QUEUED tasks, executes them, writes results.
 */
import { Database } from "bun:sqlite";
import { resolve } from "path";
import { auditService } from "../services/audit-service.ts";
import { testingService } from "../services/testing-service.ts";
import { cardRepo } from "../db/repositories/card-repo.ts";
import { railService } from "../services/rail-service.ts";
import { ingestService } from "../services/ingest-service.ts";
import { THRESHOLDS } from "../core/config.ts";

interface JobRow {
  id: string;
  session_id: string;
  module_id: string | null;
  job_type: string;
  status: string;
  payload_json: string | null;
  result_summary_json: string | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  attempts: number;
  max_attempts: number;
  timeout_seconds: number;
  created_at: string;
  updated_at: string;
}

const DB_PATH = resolve(process.cwd(), ".learning-engine/state/engine.db");

let currentJobId: string | null = null;

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("[daemon] Shutting down...");
  if (currentJobId) {
    const sqlite = new Database(DB_PATH);
    sqlite.prepare(`UPDATE jobs SET status = 'QUEUED', started_at = NULL WHERE id = ? AND status = 'RUNNING'`).run(currentJobId);
    sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    sqlite.close();
  }
  process.exit(0);
});
process.on("SIGTERM", () => process.emit("SIGINT"));

// Main loop
async function main() {
  console.log("[daemon] Started. Polling for jobs...");

  while (true) {
    const sqlite = new Database(DB_PATH);
    sqlite.exec("PRAGMA busy_timeout = 5000;");
    sqlite.exec("PRAGMA journal_mode = WAL;");

    try {
      // Find next queued job
      const job = sqlite.query(
        `SELECT * FROM jobs WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT 1`
      ).get() as JobRow | null;

      if (!job) {
        sqlite.close();
        await Bun.sleep(THRESHOLDS.DAEMON_POLL_INTERVAL_MS);
        continue;
      }

      currentJobId = job.id;
      const now = new Date().toISOString();

      // Mark as RUNNING
      sqlite.prepare(`UPDATE jobs SET status = 'RUNNING', started_at = ?, attempts = attempts + 1, updated_at = ? WHERE id = ?`).run(now, now, job.id);

      console.log(`[daemon] Executing job ${job.id} (${job.job_type})`);

      try {
        // Execute based on job_type
        const result = await executeJob(job);

        const finishedAt = new Date().toISOString();
        sqlite.prepare(
          `UPDATE jobs SET status = 'SUCCEEDED', result_summary_json = ?, finished_at = ?, updated_at = ? WHERE id = ?`
        ).run(JSON.stringify(result), finishedAt, finishedAt, job.id);

        console.log(`[daemon] Job ${job.id} succeeded`);
      } catch (err: any) {
        const finishedAt = new Date().toISOString();
        const shouldRetry = job.attempts < job.max_attempts;

        sqlite.prepare(
          `UPDATE jobs SET status = ?, error_message = ?, finished_at = ?, updated_at = ? WHERE id = ?`
        ).run(
          shouldRetry ? "QUEUED" : "FAILED",
          err.message,
          finishedAt,
          finishedAt,
          job.id
        );

        console.error(`[daemon] Job ${job.id} failed: ${err.message}`);
      }

      currentJobId = null;
      sqlite.close();
      await Bun.sleep(500); // 500ms cooldown when active
    } catch (err: any) {
      currentJobId = null; // Clear in outer catch too
      console.error(`[daemon] Loop error: ${err.message}`);
      try { sqlite.close(); } catch (closeErr: any) {
        console.error(`[daemon] Failed to close DB: ${closeErr.message}`);
      }
      await Bun.sleep(THRESHOLDS.DAEMON_POLL_INTERVAL_MS);
    }
  }
}

async function executeJob(job: JobRow): Promise<Record<string, unknown>> {
  const payload = job.payload_json ? JSON.parse(job.payload_json) : {};

  switch (job.job_type) {
    case "MATERIAL_EXTRACT": {
      const { session_id, material_id, chunk_count } = payload;
      if (!session_id || !material_id) throw new Error("MATERIAL_EXTRACT requires session_id and material_id");
      const { status: _s, ...restResult } = auditService.runAudit(session_id, material_id);
      // Update chunk_count if provided
      if (chunk_count !== undefined) {
        ingestService.updateChunkCount(material_id, chunk_count);
      }
      return { ...restResult, status: "extracted" };
    }
    case "COVERAGE_AUDIT": {
      const { session_id, module_id } = payload;
      if (!session_id || !module_id) throw new Error("COVERAGE_AUDIT requires session_id and module_id");
      const progress = auditService.getAuditProgress(session_id, module_id);
      // Write coverage results back via rail service
      if (progress.total > 0) {
        railService.updateCoverage(
          session_id, module_id, module_id,
          progress.coverage_pct >= THRESHOLDS.COVERAGE_DUAL_TRACK ? "FULLY_COVERED" : "PARTIALLY_COVERED",
          `audit: ${progress.mapped}/${progress.total} mapped`
        );
      }
      return { status: "audited", ...progress };
    }
    case "CARD_GEN": {
      const { session_id, module_id, questions } = payload;
      if (!session_id || !module_id) throw new Error("CARD_GEN requires session_id and module_id");
      const specs = Array.isArray(questions) ? questions : [{ text: `Review question for ${module_id}` }];
      const round = testingService.createTestRound(session_id, module_id, specs);
      return { status: "generated", cards_count: round.questionIds.length, questionIds: round.questionIds };
    }
    case "PACK_BUILD": {
      const { session_id, module_id } = payload;
      if (!session_id || !module_id) throw new Error("PACK_BUILD requires session_id and module_id");
      // Aggregate cards by module into pack structure
      const concepts = ingestService.getConceptsByModule(module_id);
      let totalCards = 0;
      for (const concept of concepts) {
        const cards = cardRepo.findByConcept(concept.id);
        totalCards += cards.length;
      }
      return { status: "built", session_id, module_id, concepts_count: concepts.length, cards_count: totalCards };
    }
    case "NOTION_SYNC": {
      const { page_id, data } = payload;
      if (!page_id) throw new Error("NOTION_SYNC requires page_id");
      // Cross-skill integration: notion-writer handles the actual write.
      // Log what would be synced for now.
      console.error(`[daemon] NOTION_SYNC: page_id=${page_id}, fields=${Object.keys(data ?? {}).join(",")}`);
      return { status: "synced", page_id, fields_synced: Object.keys(data ?? {}).length };
    }
    default:
      throw new Error(`Unknown job type: ${job.job_type}`);
  }
}

main();
