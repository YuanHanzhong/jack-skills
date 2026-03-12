import { eq, desc } from "drizzle-orm";
import { db, readDb } from "../db.ts";
import { withBusyRetry } from "../busy-retry.ts";
import { session_snapshots, jobs } from "../schema/tables.ts";

export const snapshotRepo = {
  findById(id: string) {
    return readDb
      .select()
      .from(session_snapshots)
      .where(eq(session_snapshots.id, id))
      .get();
  },

  findLatestSnapshot(sessionId: string) {
    return readDb
      .select()
      .from(session_snapshots)
      .where(eq(session_snapshots.session_id, sessionId))
      .orderBy(desc(session_snapshots.created_at))
      .get();
  },

  createSnapshot(data: typeof session_snapshots.$inferInsert) {
    return withBusyRetry(() =>
      db.insert(session_snapshots).values(data).run()
    );
  },

  createJob(data: typeof jobs.$inferInsert) {
    return withBusyRetry(() => db.insert(jobs).values(data).run());
  },

  findQueuedJobs() {
    return readDb
      .select()
      .from(jobs)
      .where(eq(jobs.status, "QUEUED"))
      .orderBy(jobs.created_at)
      .all();
  },

  updateJobStatus(
    id: string,
    status: "SUCCEEDED" | "FAILED",
    result?: { result_summary_json?: string; error_message?: string; finished_at?: string }
  ) {
    return withBusyRetry(() =>
      db
        .update(jobs)
        .set({ status, ...result, updated_at: new Date().toISOString() })
        .where(eq(jobs.id, id))
        .run()
    );
  },
};
