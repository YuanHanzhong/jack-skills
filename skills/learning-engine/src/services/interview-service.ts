import { sessionRepo } from "../db/repositories/session-repo.ts";
import { pendingRepo } from "../db/repositories/pending-repo.ts";

function startInterview(sessionId: string, moduleId: string) {
  sessionRepo.update(sessionId, {
    current_module_id: moduleId,
    updated_at: new Date().toISOString(),
  });

  return { sessionId, moduleId, status: "INTERVIEW_STARTED" };
}

function recordInterviewAnswer(sessionId: string, answer: string) {
  const id = crypto.randomUUID();
  pendingRepo.create({
    id,
    session_id: sessionId,
    question_text: answer, // stores the answer text; pending_questions reuses question_text column for answer content
    source_type: "IN_MODULE",
    status: "PENDING",
    created_at: new Date().toISOString(),
  });

  return { id, status: "RECORDED" };
}

export const interviewService = { startInterview, recordInterviewAnswer };
