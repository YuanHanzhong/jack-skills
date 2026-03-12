import { questionRepo } from "../db/repositories/question-repo.ts";

export interface QuestionSpec {
  text: string;
  difficulty?: "L1" | "L2" | "L3";
  type?: "OPEN" | "MCQ" | "TRUE_FALSE";
}

function createTestRound(sessionId: string, moduleId: string, specs: QuestionSpec[]) {
  if (!specs.length) throw new Error("createTestRound requires at least one question spec");

  const questions: string[] = [];

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i]!;
    const qId = crypto.randomUUID();
    questionRepo.create({
      id: qId,
      session_id: sessionId,
      module_id: moduleId,
      question_text: spec.text,
      difficulty: spec.difficulty ?? "L1",
      question_type: spec.type ?? "OPEN",
      sequence: i + 1,
      created_at: new Date().toISOString(),
    });
    questions.push(qId);
  }

  return { questionIds: questions };
}

function recordAnswer(questionId: string, sessionId: string, answer: string) {
  questionRepo.createAttempt({
    id: crypto.randomUUID(),
    question_id: questionId,
    session_id: sessionId,
    user_answer: answer,
    created_at: new Date().toISOString(),
  });

  return { questionId, status: "RECORDED" };
}

export const testingService = { createTestRound, recordAnswer };
