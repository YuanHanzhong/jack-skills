import { eq, and } from "drizzle-orm";
import { db, readDb } from "../db.ts";
import { withBusyRetry } from "../busy-retry.ts";
import { modules } from "../schema/tables.ts";

export const moduleRepo = {
  findById(id: string) {
    return readDb.select().from(modules).where(eq(modules.id, id)).get();
  },

  findBySession(sessionId: string) {
    return readDb
      .select()
      .from(modules)
      .where(eq(modules.session_id, sessionId))
      .all();
  },

  findBySequence(sessionId: string, seq: number) {
    return readDb
      .select()
      .from(modules)
      .where(and(eq(modules.session_id, sessionId), eq(modules.sequence, seq)))
      .get();
  },

  create(data: typeof modules.$inferInsert) {
    return withBusyRetry(() => db.insert(modules).values(data).run());
  },

  update(id: string, data: Partial<typeof modules.$inferInsert>) {
    return withBusyRetry(() =>
      db.update(modules).set(data).where(eq(modules.id, id)).run()
    );
  },
};
