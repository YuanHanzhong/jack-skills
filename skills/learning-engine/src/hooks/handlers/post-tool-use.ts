/**
 * post-tool-use.ts — PostToolUse Hook Handler
 * - Log tool usage for observability
 * - Observation hook: does not block conversation flow
 */

interface PostToolInput {
  tool_name: string;
  tool_input: Record<string, any>;
  tool_result: string;
}

export async function handlePostToolUse(input: PostToolInput): Promise<{ result?: string } | null> {
  const { tool_name, tool_result } = input;

  // Only process learning engine domain tools
  const DOMAIN_TOOLS = [
    "submit_answer", "confirm_concept_map", "request_interruption",
    "execute_pending_tasks", "start_interview_session", "submit_interview_answer",
    "trigger_review", "export_mastery_map", "check_job_status", "sync_notion",
  ];

  if (!DOMAIN_TOOLS.includes(tool_name)) {
    return null;
  }

  // Parse tool result
  let result: any;
  try {
    result = typeof tool_result === "string" ? JSON.parse(tool_result) : tool_result;
  } catch {
    return { result: `[PostToolUse] 工具 ${tool_name} 返回了非 JSON 结果` };
  }

  // Log tool execution for observability
  const logFields: Record<string, unknown> = { tool: tool_name, status: result?.status };
  if (result?.attempt_id) logFields.attempt_id = result.attempt_id;
  if (result?.job_id) logFields.job_id = result.job_id;
  if (result?.modules_written !== undefined) logFields.modules_written = result.modules_written;
  if (result?.concepts_written !== undefined) logFields.concepts_written = result.concepts_written;
  console.error(`[PostToolUse] ${JSON.stringify(logFields)}`);

  // State advancement is handled by tool implementations directly
  return null;
}
