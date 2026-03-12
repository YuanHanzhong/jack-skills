import { eq } from "drizzle-orm";
import { db, readDb } from "../db.ts";
import { withBusyRetry } from "../busy-retry.ts";
import { interview_packs } from "../schema/tables.ts";

export const packRepo = {
  findById(id: string) {
    return readDb
      .select()
      .from(interview_packs)
      .where(eq(interview_packs.id, id))
      .get();
  },

  findByModule(moduleId: string) {
    return readDb
      .select()
      .from(interview_packs)
      .where(eq(interview_packs.module_id, moduleId))
      .all();
  },

  create(data: typeof interview_packs.$inferInsert) {
    return withBusyRetry(() => db.insert(interview_packs).values(data).run());
  },

  update(id: string, data: Partial<typeof interview_packs.$inferInsert>) {
    return withBusyRetry(() =>
      db
        .update(interview_packs)
        .set(data)
        .where(eq(interview_packs.id, id))
        .run()
    );
  },
};
