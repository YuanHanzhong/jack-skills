import { eq, and } from "drizzle-orm";
import { db, readDb } from "../db.ts";
import { withBusyRetry } from "../busy-retry.ts";
import { pending_questions } from "../schema/tables.ts";

export const pendingRepo = {
  findById(id: string) {
    return readDb
      .select()
      .from(pending_questions)
      .where(eq(pending_questions.id, id))
      .get();
  },

  findBySession(sessionId: string) {
    return readDb
      .select()
      .from(pending_questions)
      .where(eq(pending_questions.session_id, sessionId))
      .all();
  },

  findPendingBySession(sessionId: string) {
    return readDb
      .select()
      .from(pending_questions)
      .where(
        and(
          eq(pending_questions.session_id, sessionId),
          eq(pending_questions.status, "PENDING")
        )
      )
      .all();
  },

  create(data: typeof pending_questions.$inferInsert) {
    return withBusyRetry(() =>
      db.insert(pending_questions).values(data).run()
    );
  },

  update(id: string, data: Partial<typeof pending_questions.$inferInsert>) {
    return withBusyRetry(() =>
      db
        .update(pending_questions)
        .set(data)
        .where(eq(pending_questions.id, id))
        .run()
    );
  },
};
