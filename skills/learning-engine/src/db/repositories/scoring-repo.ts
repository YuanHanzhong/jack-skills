import { eq, and } from "drizzle-orm";
import { db, readDb } from "../db.ts";
import { withBusyRetry } from "../busy-retry.ts";
import { scoring_results } from "../schema/tables.ts";

export const scoringRepo = {
  findById(id: string) {
    return readDb
      .select()
      .from(scoring_results)
      .where(eq(scoring_results.id, id))
      .get();
  },

  findByConceptAndSession(conceptId: string, sessionId: string) {
    return readDb
      .select()
      .from(scoring_results)
      .where(
        and(
          eq(scoring_results.concept_id, conceptId),
          eq(scoring_results.session_id, sessionId)
        )
      )
      .all();
  },

  findByModuleAndSession(moduleId: string, sessionId: string) {
    return readDb
      .select()
      .from(scoring_results)
      .where(
        and(
          eq(scoring_results.module_id, moduleId),
          eq(scoring_results.session_id, sessionId)
        )
      )
      .all();
  },

  create(data: typeof scoring_results.$inferInsert) {
    return withBusyRetry(() => db.insert(scoring_results).values(data).run());
  },

  update(id: string, data: Partial<typeof scoring_results.$inferInsert>) {
    return withBusyRetry(() =>
      db
        .update(scoring_results)
        .set(data)
        .where(eq(scoring_results.id, id))
        .run()
    );
  },
};
