/**
 * session-end.ts — SessionEnd Hook Handler
 * - Flush all uncommitted state
 * - Write session summary
 * - Queue final sync job
 */
import { existsSync } from "fs";
import { resolve } from "path";

const DB_PATH = resolve(process.cwd(), ".learning-engine/state/engine.db");

export async function handleSessionEnd(): Promise<{ result?: string } | null> {
  if (!existsSync(DB_PATH)) return null;

  const { Database } = await import("bun:sqlite");
  const sqlite = new Database(DB_PATH);
  sqlite.exec("PRAGMA busy_timeout = 5000;");

  try {
    const session = sqlite
      .query(
        `SELECT id, status FROM sessions
         WHERE status != 'DONE' AND status != 'FAILED'
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get() as any;

    if (!session) return null;

    const now = new Date().toISOString();

    // Update session last event
    sqlite
      .prepare("UPDATE sessions SET last_event_at = ?, updated_at = ? WHERE id = ?")
      .run(now, now, session.id);

    // WAL checkpoint for clean state
    sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");

    return { result: `[学习引擎] 会话结束，状态已保存 (${session.status})` };
  } finally {
    sqlite.close();
  }
}
