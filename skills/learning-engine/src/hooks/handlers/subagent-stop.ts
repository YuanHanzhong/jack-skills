/**
 * subagent-stop.ts — SubagentStop Hook Handler
 * Validates sub-agent output against Zod contracts
 */
import { CardBatchSchema } from "../../schemas/card-candidate.schema.ts";
import { AuditBatchResultSchema } from "../../schemas/audit-result.schema.ts";
import { ScoreResultSchema } from "../../schemas/score-result.schema.ts";
import { InterviewPackSchema } from "../../schemas/interview-pack.schema.ts";
import { ConceptMapSchema } from "../../schemas/concept-map.schema.ts";
import type { ZodTypeAny } from "zod";

interface SubagentInput {
  agent_name?: string;
  output?: string;
}

type Decision = { decision: "approve" } | { decision: "deny"; reason: string };

const AGENT_SCHEMA_MAP: Record<string, ZodTypeAny> = {
  card_gen_agent: CardBatchSchema,
  audit_agent: AuditBatchResultSchema,
  scoring_agent: ScoreResultSchema,
  interview_pack_agent: InterviewPackSchema,
  concept_map_agent: ConceptMapSchema,
};

export async function handleSubagentStop(input: SubagentInput): Promise<Decision> {
  const { agent_name, output } = input;

  if (!agent_name || !output) {
    return { decision: "approve" };
  }

  // Validate that output is parseable JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return {
      decision: "deny",
      reason: `子 Agent ${agent_name} 输出不是有效 JSON，请重新生成`,
    };
  }

  // Agent-specific Zod validation
  const schema = AGENT_SCHEMA_MAP[agent_name];
  if (schema) {
    const result = schema.safeParse(parsed);
    if (!result.success) {
      return {
        decision: "deny",
        reason: `子 Agent ${agent_name} 输出 schema 校验失败：${result.error.message}`,
      };
    }
  }

  return { decision: "approve" };
}
