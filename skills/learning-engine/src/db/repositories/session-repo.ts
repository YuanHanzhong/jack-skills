import { eq, ne, and, desc } from "drizzle-orm";
import { db, readDb } from "../db.ts";
import { withBusyRetry } from "../busy-retry.ts";
import { sessions } from "../schema/tables.ts";

export const sessionRepo = {
  findById(id: string) {
    return readDb.select().from(sessions).where(eq(sessions.id, id)).get();
  },

  findActive() {
    return readDb
      .select()
      .from(sessions)
      .where(and(ne(sessions.status, "DONE"), ne(sessions.status, "FAILED")))
      .orderBy(desc(sessions.updated_at))
      .get();
  },

  create(data: typeof sessions.$inferInsert) {
    return withBusyRetry(() => db.insert(sessions).values(data).run());
  },

  update(id: string, data: Partial<typeof sessions.$inferInsert>) {
    return withBusyRetry(() =>
      db.update(sessions).set(data).where(eq(sessions.id, id)).run()
    );
  },

  updateWithVersion(
    id: string,
    version: number,
    data: Partial<typeof sessions.$inferInsert>
  ) {
    return withBusyRetry(() =>
      db
        .update(sessions)
        .set({ ...data, version: version + 1 })
        .where(and(eq(sessions.id, id), eq(sessions.version, version)))
        .run()
    );
  },
};
