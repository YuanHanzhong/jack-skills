import { eq, and, lte } from "drizzle-orm";
import { db, readDb } from "../db.ts";
import { withBusyRetry } from "../busy-retry.ts";
import { review_queue } from "../schema/tables.ts";

export const reviewRepo = {
  findById(id: string) {
    return readDb
      .select()
      .from(review_queue)
      .where(eq(review_queue.id, id))
      .get();
  },

  findPending() {
    return readDb
      .select()
      .from(review_queue)
      .where(eq(review_queue.status, "PENDING"))
      .all();
  },

  findDue(beforeDate: string) {
    return readDb
      .select()
      .from(review_queue)
      .where(
          and(
          eq(review_queue.status, "PENDING"),
          lte(review_queue.scheduled_at, beforeDate)
        )
      )
      .all();
  },

  create(data: typeof review_queue.$inferInsert) {
    return withBusyRetry(() => db.insert(review_queue).values(data).run());
  },

  update(id: string, data: Partial<typeof review_queue.$inferInsert>) {
    return withBusyRetry(() =>
      db.update(review_queue).set(data).where(eq(review_queue.id, id)).run()
    );
  },
};
