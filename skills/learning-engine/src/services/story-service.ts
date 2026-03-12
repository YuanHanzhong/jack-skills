import { storyRepo } from "../db/repositories/story-repo.ts";

function createStory(data: {
  title: string;
  situation?: string;
  task_text?: string;
  action_text?: string;
  result_text?: string;
  takeaway?: string;
  project_name?: string;
  tags_json?: string;
}) {
  const id = crypto.randomUUID();
  storyRepo.create({
    id,
    title: data.title,
    situation: data.situation ?? null,
    task_text: data.task_text ?? null,
    action_text: data.action_text ?? null,
    result_text: data.result_text ?? null,
    takeaway: data.takeaway ?? null,
    project_name: data.project_name ?? null,
    tags_json: data.tags_json ?? null,
    status: "DRAFT",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return { id, status: "CREATED" };
}

function linkToConcept(conceptId: string, storyId: string, relevanceScore: number) {
  storyRepo.linkConcept({
    id: crypto.randomUUID(),
    concept_id: conceptId,
    story_id: storyId,
    relevance_score: relevanceScore,
    selected: 0 as number, // SQLite has no boolean; 0 = false (not selected)
    created_at: new Date().toISOString(),
  });
  return { conceptId, storyId, status: "LINKED" };
}

export const storyService = { createStory, linkToConcept };
