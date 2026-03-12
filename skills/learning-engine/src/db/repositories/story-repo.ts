import { eq } from "drizzle-orm";
import { db, readDb } from "../db.ts";
import { withBusyRetry } from "../busy-retry.ts";
import { stories, story_links } from "../schema/tables.ts";

export const storyRepo = {
  findById(id: string) {
    return readDb.select().from(stories).where(eq(stories.id, id)).get();
  },

  create(data: typeof stories.$inferInsert) {
    return withBusyRetry(() => db.insert(stories).values(data).run());
  },

  update(id: string, data: Partial<typeof stories.$inferInsert>) {
    return withBusyRetry(() =>
      db.update(stories).set(data).where(eq(stories.id, id)).run()
    );
  },

  linkConcept(data: typeof story_links.$inferInsert) {
    return withBusyRetry(() => db.insert(story_links).values(data).run());
  },

  findLinkedStories(conceptId: string) {
    return readDb
      .select()
      .from(story_links)
      .where(eq(story_links.concept_id, conceptId))
      .all();
  },

  updateLink(id: string, data: Partial<typeof story_links.$inferInsert>) {
    return withBusyRetry(() =>
      db.update(story_links).set(data).where(eq(story_links.id, id)).run()
    );
  },
};
