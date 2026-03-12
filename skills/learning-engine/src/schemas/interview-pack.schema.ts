import { z } from "zod";

export const InterviewPackSchema = z.object({
  module_id: z.string(),
  pack_type: z.enum(["MODULE_PACK", "INTERVIEW_SCRIPT"]),
  one_liner: z.string().min(1, "一句话总结不能为空"),
  core_points: z.array(z.string()).min(1, "核心要点至少1条"),
  deep_dive: z.array(z.object({
    topic: z.string(),
    explanation: z.string(),
  })).min(1, "深度展开至少1个话题"),
  project_evidence: z.array(z.object({
    story_id: z.string().optional(),
    evidence_text: z.string(),
  })).min(1, "项目证据至少1条"),
  gotcha_defense: z.array(z.object({
    question: z.string(),
    defense: z.string(),
  })).min(1, "刁钻防御至少1条"),
});

export type InterviewPack = z.infer<typeof InterviewPackSchema>;
