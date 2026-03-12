import { eq, and } from "drizzle-orm";
import { db, readDb } from "../db.ts";
import { withBusyRetry } from "../busy-retry.ts";
import { concepts, concept_relations } from "../schema/tables.ts";

export const conceptRepo = {
  findById(id: string) {
    return readDb.select().from(concepts).where(eq(concepts.id, id)).get();
  },

  findByModule(moduleId: string) {
    return readDb
      .select()
      .from(concepts)
      .where(eq(concepts.module_id, moduleId))
      .all();
  },

  findCore(moduleId: string) {
    return readDb
      .select()
      .from(concepts)
      .where(and(eq(concepts.module_id, moduleId), eq(concepts.is_core, 1)))
      .all();
  },

  create(data: typeof concepts.$inferInsert) {
    return withBusyRetry(() => db.insert(concepts).values(data).run());
  },

  update(id: string, data: Partial<typeof concepts.$inferInsert>) {
    return withBusyRetry(() =>
      db.update(concepts).set(data).where(eq(concepts.id, id)).run()
    );
  },

  createRelation(data: typeof concept_relations.$inferInsert) {
    return withBusyRetry(() =>
      db.insert(concept_relations).values(data).run()
    );
  },

  findRelations(conceptId: string) {
    return readDb
      .select()
      .from(concept_relations)
      .where(eq(concept_relations.source_concept_id, conceptId))
      .all();
  },
};
