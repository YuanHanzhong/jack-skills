import { eq, sql } from "drizzle-orm";
import { db, readDb } from "../db.ts";
import { withBusyRetry } from "../busy-retry.ts";
import { cards } from "../schema/tables.ts";

export const cardRepo = {
  findById(id: string) {
    return readDb.select().from(cards).where(eq(cards.id, id)).get();
  },

  findByConcept(conceptId: string) {
    return readDb
      .select()
      .from(cards)
      .where(eq(cards.concept_id, conceptId))
      .all();
  },

  findByDedupKey(key: string) {
    return readDb
      .select()
      .from(cards)
      .where(eq(cards.dedup_key, key))
      .get();
  },

  countByConcept(conceptId: string): number {
    const result = readDb
      .select({ count: sql<number>`count(*)` })
      .from(cards)
      .where(eq(cards.concept_id, conceptId))
      .get();
    return result?.count ?? 0;
  },

  create(data: typeof cards.$inferInsert) {
    return withBusyRetry(() => db.insert(cards).values(data).run());
  },

  update(id: string, data: Partial<typeof cards.$inferInsert>) {
    return withBusyRetry(() =>
      db.update(cards).set(data).where(eq(cards.id, id)).run()
    );
  },
};
