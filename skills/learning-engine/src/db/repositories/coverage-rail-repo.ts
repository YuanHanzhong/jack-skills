import { eq, and } from "drizzle-orm";
import { db, readDb } from "../db.ts";
import { withBusyRetry } from "../busy-retry.ts";
import { coverage_rails } from "../schema/tables.ts";

export const coverageRailRepo = {
  findById(id: string) {
    return readDb
      .select()
      .from(coverage_rails)
      .where(eq(coverage_rails.id, id))
      .get();
  },

  findBySessionModule(sessionId: string, moduleId: string) {
    return readDb
      .select()
      .from(coverage_rails)
      .where(
        and(
          eq(coverage_rails.session_id, sessionId),
          eq(coverage_rails.module_id, moduleId)
        )
      )
      .all();
  },

  create(data: typeof coverage_rails.$inferInsert) {
    return withBusyRetry(() => db.insert(coverage_rails).values(data).run());
  },

  update(id: string, data: Partial<typeof coverage_rails.$inferInsert>) {
    return withBusyRetry(() =>
      db
        .update(coverage_rails)
        .set(data)
        .where(eq(coverage_rails.id, id))
        .run()
    );
  },

  upsert(data: typeof coverage_rails.$inferInsert) {
    return withBusyRetry(() =>
      db
        .insert(coverage_rails)
        .values(data)
        .onConflictDoUpdate({
          target: [
            coverage_rails.session_id,
            coverage_rails.module_id,
            coverage_rails.concept_id,
          ],
          set: {
            status: data.status,
            coverage_evidence: data.coverage_evidence,
            updated_at: data.updated_at,
          },
        })
        .run()
    );
  },
};
