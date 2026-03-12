import { eq } from "drizzle-orm";
import { db, readDb } from "../db.ts";
import { withBusyRetry } from "../busy-retry.ts";
import { materials } from "../schema/tables.ts";

export const materialRepo = {
  findById(id: string) {
    return readDb.select().from(materials).where(eq(materials.id, id)).get();
  },

  findByChecksum(hash: string) {
    return readDb
      .select()
      .from(materials)
      .where(eq(materials.content_hash, hash))
      .get();
  },

  create(data: typeof materials.$inferInsert) {
    return withBusyRetry(() => db.insert(materials).values(data).run());
  },

  update(id: string, data: Partial<typeof materials.$inferInsert>) {
    return withBusyRetry(() =>
      db.update(materials).set(data).where(eq(materials.id, id)).run()
    );
  },
};
