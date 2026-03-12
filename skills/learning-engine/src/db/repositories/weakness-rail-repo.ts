import { eq, and } from "drizzle-orm";
import { db, readDb } from "../db.ts";
import { withBusyRetry } from "../busy-retry.ts";
import { weakness_rails } from "../schema/tables.ts";

export const weaknessRailRepo = {
  findById(id: string) {
    return readDb
      .select()
      .from(weakness_rails)
      .where(eq(weakness_rails.id, id))
      .get();
  },

  findBySessionModule(sessionId: string, moduleId: string) {
    return readDb
      .select()
      .from(weakness_rails)
      .where(
        and(
          eq(weakness_rails.session_id, sessionId),
          eq(weakness_rails.module_id, moduleId)
        )
      )
      .all();
  },

  findIdentified(sessionId: string, moduleId: string) {
    return readDb
      .select()
      .from(weakness_rails)
      .where(
        and(
          eq(weakness_rails.session_id, sessionId),
          eq(weakness_rails.module_id, moduleId),
          eq(weakness_rails.status, "IDENTIFIED")
        )
      )
      .all();
  },

  create(data: typeof weakness_rails.$inferInsert) {
    return withBusyRetry(() => db.insert(weakness_rails).values(data).run());
  },

  update(id: string, data: Partial<typeof weakness_rails.$inferInsert>) {
    return withBusyRetry(() =>
      db
        .update(weakness_rails)
        .set(data)
        .where(eq(weakness_rails.id, id))
        .run()
    );
  },
};
