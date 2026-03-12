/**
 * stop.ts — Stop Hook Handler
 * Two modes:
 * 1. Normal stop: snapshot to SQLite, no blocking
 * 2. Stage close stop: dual-track validation, can block
 */
import { existsSync, unlinkSync } from "fs";
import { resolve } from "path";

const DB_PATH = resolve(process.cwd(), ".learning-engine/state/engine.db");
const PANORAMA_FLAG = resolve(process.cwd(), ".learning-engine/state/panorama-active");

interface StopInput {
  stop_reason?: string;
}

export async function handleStop(input: StopInput): Promise<{ result?: string } | null> {
  // Clean up panorama flag on every stop (prevents stale flags across conversations)
  try { if (existsSync(PANORAMA_FLAG)) unlinkSync(PANORAMA_FLAG); } catch { /* ok */ }

  if (!existsSync(DB_PATH)) return null;

  const { Database } = await import("bun:sqlite");
  const sqlite = new Database(DB_PATH);
  sqlite.exec("PRAGMA busy_timeout = 5000;");

  try {
    const session = sqlite
      .query(
        `SELECT id, status, current_module_id, module_cursor
         FROM sessions WHERE status != 'DONE' AND status != 'FAILED'
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get() as any;

    if (!session) return null;

    const now = new Date().toISOString();
    const snapshotId = crypto.randomUUID();

    // Always save snapshot
    sqlite
      .prepare(
        `INSERT INTO session_snapshots (id, session_id, reason, state_json, created_at)
         VALUES (?, ?, 'STOP', ?, ?)`
      )
      .run(
        snapshotId,
        session.id,
        JSON.stringify({
          status: session.status,
          module_id: session.current_module_id,
          module_cursor: session.module_cursor,
          stop_reason: input.stop_reason,
        }),
        now
      );

    // Update session timestamp
    sqlite
      .prepare("UPDATE sessions SET last_event_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, session.id);

    return { result: `[学习引擎] 快照已保存 (${session.status})` };
  } finally {
    sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    sqlite.close();
  }
}
