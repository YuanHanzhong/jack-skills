#!/usr/bin/env bun
/**
 * dispatcher.ts — 统一 Hook 分发器
 * 所有 Hook 事件通过 bun-runner.sh 调用此文件
 * 根据 CLAUDE_HOOK_EVENT_NAME 环境变量分发到具体 handler
 */

import { handleSessionStart } from "./handlers/session-start.ts";
import { handleUserPromptSubmit } from "./handlers/user-prompt-submit.ts";
import { handlePreToolUse } from "./handlers/pre-tool-use.ts";
import { handlePostToolUse } from "./handlers/post-tool-use.ts";
import { handleStop } from "./handlers/stop.ts";
import { handleSubagentStop } from "./handlers/subagent-stop.ts";
import { handlePreCompact } from "./handlers/pre-compact.ts";
import { handleSessionEnd } from "./handlers/session-end.ts";

// Prevent recursive Hook invocation (set by a parent dispatcher process)
if (process.env.LE_HOOK_ACTIVE === "true") {
  process.exit(0);
}
// Mark active so any child processes spawned by handlers won't recurse
process.env.LE_HOOK_ACTIVE = "true";

const hookEvent = process.env.CLAUDE_HOOK_EVENT_NAME;

if (!hookEvent) {
  process.exit(0);
}

// Read stdin for hooks that receive input
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function dispatch() {
  try {
    let input: any = {};

    // Some hooks receive JSON via stdin
    const stdinHooks = [
      "UserPromptSubmit", "PreToolUse", "PostToolUse",
      "Stop", "SubagentStop",
    ];

    if (stdinHooks.includes(hookEvent!)) {
      const raw = await readStdin();
      if (raw.trim()) {
        try {
          input = JSON.parse(raw);
        } catch {
          console.error(`[dispatcher] Invalid JSON on stdin for ${hookEvent}`);
          input = { raw };
        }
      }
    }

    let result: any;

    switch (hookEvent) {
      case "SessionStart":
        result = await handleSessionStart();
        break;
      case "UserPromptSubmit":
        result = await handleUserPromptSubmit(input);
        break;
      case "PreToolUse":
        result = await handlePreToolUse(input);
        break;
      case "PostToolUse":
        result = await handlePostToolUse(input);
        break;
      case "Stop":
        result = await handleStop(input);
        break;
      case "SubagentStop":
        result = await handleSubagentStop(input);
        break;
      case "PreCompact":
        result = await handlePreCompact();
        break;
      case "SessionEnd":
        result = await handleSessionEnd();
        break;
      default:
        console.error(`[dispatcher] Unknown hook event: ${hookEvent}`);
        process.exit(0);
    }

    // Output result as JSON to stdout (the only protocol channel)
    if (result) {
      console.log(JSON.stringify(result));
    }
  } catch (err: any) {
    // Hooks must never block Claude Code — log to stderr and exit cleanly
    console.error(`[dispatcher] Error in ${hookEvent}: ${err?.message ?? err}`);
    if (err?.stack) console.error(err.stack);
    process.exit(0);
  }
}

dispatch();
