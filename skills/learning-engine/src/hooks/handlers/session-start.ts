/**
 * session-start.ts — SessionStart Hook Handler
 * - Read SQLite for latest active session
 * - Recover orphan PENDING states
 * - Inject context into conversation
 */
import { existsSync } from "fs";
import { resolve } from "path";

const DB_PATH = resolve(process.cwd(), ".learning-engine/state/engine.db");

export async function handleSessionStart(): Promise<{ result: string } | null> {
  // If no DB yet, nothing to restore
  if (!existsSync(DB_PATH)) {
    return { result: "[学习引擎] 数据库未初始化。使用 `bun run db:init` 创建数据库。" };
  }

  const { Database } = await import("bun:sqlite");
  const sqlite = new Database(DB_PATH, { readonly: true });
  sqlite.exec("PRAGMA busy_timeout = 5000;");

  try {
    // Find latest active session
    const session = sqlite
      .query(
        `SELECT id, session_type, status, current_module_id, module_cursor, current_phase_scope, current_cursor
         FROM sessions WHERE status != 'DONE' AND status != 'FAILED'
         ORDER BY updated_at DESC LIMIT 1`
      )
      .get() as any;

    if (!session) {
      return { result: "[学习引擎] 无活跃会话。" };
    }

    // Check for orphan PENDING states
    if (session.status?.endsWith("_PENDING")) {
      const baseState = session.status.replace("_PENDING", "");

      // Check if there are partial results for this pending task
      const pendingJob = sqlite
        .query(
          `SELECT id, status, result_summary_json FROM jobs
           WHERE session_id = ? AND status IN ('QUEUED', 'RUNNING')
           ORDER BY created_at DESC LIMIT 1`
        )
        .get(session.id) as any;

      let recoveryNote: string;
      if (pendingJob) {
        recoveryNote = `上次任务 (job: ${pendingJob.id}) 未完成（状态: ${pendingJob.status}），需要重新执行。`;
      } else {
        recoveryNote = `上次 ${session.status} 状态异常中断，已回退到 ${baseState}。`;
        // Write connection needed for recovery - use separate connection
        const writeDb = new Database(DB_PATH);
        try {
          writeDb.exec("PRAGMA busy_timeout = 5000;");
          writeDb.prepare(
            `UPDATE sessions SET status = ?, updated_at = datetime('now') WHERE id = ?`
          ).run(baseState, session.id);
          session.status = baseState;
        } catch (writeErr: any) {
          recoveryNote += ` (回退写入失败: ${writeErr.message}，状态未变更)`;
        } finally {
          writeDb.close();
        }
      }

      return {
        result: `[学习引擎] 会话恢复 (${session.id})\n状态: ${session.status} | 类型: ${session.session_type}\n${recoveryNote}`,
      };
    }

    // Normal session resume
    const parts = [`[学习引擎] 会话恢复 (${session.id})`, `状态: ${session.status} | 类型: ${session.session_type}`];

    if (session.current_module_id) {
      const mod = sqlite
        .query("SELECT title, sequence FROM modules WHERE id = ?")
        .get(session.current_module_id) as { title: string | null; sequence: number | null } | null;
      if (mod) {
        const title = mod.title ?? "(未命名)";
        const seq = mod.sequence != null ? mod.sequence : "?";
        parts.push(`当前模块: ${title} (序号 ${seq})`);
      }
    }

    if (session.current_phase_scope) {
      parts.push(`阶段范围: ${session.current_phase_scope}`);
    }

    return { result: parts.join("\n") };
  } finally {
    sqlite.close();
  }
}
