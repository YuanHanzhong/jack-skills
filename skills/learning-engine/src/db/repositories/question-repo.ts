import { eq } from "drizzle-orm";
import { db, readDb } from "../db.ts";
import { withBusyRetry } from "../busy-retry.ts";
import { test_questions, answer_attempts } from "../schema/tables.ts";

export const questionRepo = {
  findById(id: string) {
    return readDb
      .select()
      .from(test_questions)
      .where(eq(test_questions.id, id))
      .get();
  },

  findBySession(sessionId: string) {
    return readDb
      .select()
      .from(test_questions)
      .where(eq(test_questions.session_id, sessionId))
      .all();
  },

  create(data: typeof test_questions.$inferInsert) {
    return withBusyRetry(() => db.insert(test_questions).values(data).run());
  },

  createAttempt(data: typeof answer_attempts.$inferInsert) {
    return withBusyRetry(() => db.insert(answer_attempts).values(data).run());
  },

  findAttemptsByQuestion(questionId: string) {
    return readDb
      .select()
      .from(answer_attempts)
      .where(eq(answer_attempts.question_id, questionId))
      .all();
  },
};
