/**
 * pre-compact.ts — PreCompact Hook Handler
 * - Emergency persist current progress to SQLite
 * - Write breakpoint snapshot
 * - Generate compact summary
 */
import { existsSync } from "fs";
import { resolve } from "path";

const DB_PATH = resolve(process.cwd(), ".learning-engine/state/engine.db");

export async function handlePreCompact(): Promise<{ result: string } | null> {
  if (!existsSync(DB_PATH)) return null;

  const { Database } = await import("bun:sqlite");
  const sqlite = new Database(DB_PATH);
  sqlite.exec("PRAGMA busy_timeout = 5000;");

  try {
    const session = sqlite
      .query(
        `SELECT id, status, session_type, current_module_id, module_cursor
         FROM sessions WHERE status != 'DONE' AND status != 'FAILED'
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get() as any;

    if (!session) return null;

    const now = new Date().toISOString();

    // Save pre-compact snapshot
    sqlite
      .prepare(
        `INSERT INTO session_snapshots (id, session_id, reason, state_json, created_at)
         VALUES (?, ?, 'PRE_COMPACT', ?, ?)`
      )
      .run(
        crypto.randomUUID(),
        session.id,
        JSON.stringify({
          status: session.status,
          module_id: session.current_module_id,
          module_cursor: session.module_cursor,
        }),
        now
      );

    // Build resume summary for context injection
    const moduleInfo = session.current_module_id
      ? sqlite.query("SELECT title FROM modules WHERE id = ?").get(session.current_module_id) as { title: string } | null
      : null;

    const summary = [
      `会话: ${session.id}`,
      `状态: ${session.status}`,
      `类型: ${session.session_type}`,
      moduleInfo ? `模块: ${moduleInfo.title}` : null,
      `断点时间: ${now}`,
    ]
      .filter(Boolean)
      .join(" | ");

    return { result: `[学习引擎断点] ${summary}` };
  } finally {
    sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    sqlite.close();
  }
}
