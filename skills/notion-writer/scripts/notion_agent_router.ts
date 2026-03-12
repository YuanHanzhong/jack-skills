/**
 * notion_agent_router.ts — notion-ops v3 multi-agent router (SIMPLIFIED: sequential only)
 *
 * Three specialized agents:
 *   🔵 ReaderAgent:       read/search/dedup
 *   🟢 WriterAgent:       create pages / write DWS / write ADS entries
 *   🟡 StateManagerAgent: ADS status writeback / log append / checkpoint
 *
 * SIMPLIFIED: Removed concurrent.futures parallel fan_out. Sequential dispatch only.
 */

import { resolve } from "../_shared/schema_resolver.ts";
import { STATUS_IN_PROGRESS, STATUS_DONE } from "../_shared/constants.ts";
import {
  ADS_DATA_SOURCE_ID, DWS_DATA_SOURCE_ID,
  ROOT_PAGE_ID, METADATA_PAGE_ID, STARTT_TEMPLATE_ID, MONTHLY_LOG_ID, RULE_LIB_ID,
} from "../_shared/config.ts";

// ── Agent role constants (color-coded) ──────────────────────────
export const ROLE_READER = "🔵 reader";
export const ROLE_WRITER = "🟢 writer";
export const ROLE_STATE = "🟡 state_manager";

// ── Intent → Agent mapping ───────────────────────────────────────
export const INTENT_MAP: Record<string, string> = {
  // Reader triggers
  fetch: ROLE_READER,
  search: ROLE_READER,
  "查ADS": ROLE_READER,
  "查重": ROLE_READER,
  "读": ROLE_READER,
  read: ROLE_READER,
  // Writer triggers
  "写DWS文档": ROLE_WRITER,
  "建文档": ROLE_WRITER,
  create: ROLE_WRITER,
  "写ADS": ROLE_WRITER,
  "追加内容": ROLE_WRITER,
  write: ROLE_WRITER,
  // StateManager triggers
  "更新状态": ROLE_STATE,
  "回写": ROLE_STATE,
  "断点": ROLE_STATE,
  "日志": ROLE_STATE,
  update_status: ROLE_STATE,
  log: ROLE_STATE,
};

// ── Common Notion IDs ────────────────────────────────────────────
export const NOTION_IDS: Record<string, string> = {
  root: ROOT_PAGE_ID,
  rule_lib: RULE_LIB_ID,
  meta: METADATA_PAGE_ID,
  ads: ADS_DATA_SOURCE_ID,
  dws: DWS_DATA_SOURCE_ID,
  monthly_log: MONTHLY_LOG_ID,
  startt: STARTT_TEMPLATE_ID,
};

// ── AgentTask interface ──────────────────────────────────────────
export interface AgentTask {
  role: string;
  intent: string;
  payload: Record<string, unknown>;
  status: "pending" | "done" | "failed";
  result: unknown;
  error: string | null;
  elapsed: number;
}

function createTask(
  role: string,
  intent: string,
  payload: Record<string, unknown> = {},
): AgentTask {
  return { role, intent, payload, status: "pending", result: null, error: null, elapsed: 0 };
}

// ── 🔵 Reader Agent ──────────────────────────────────────────────
export class ReaderAgent {
  /**
   * Spec builder only — returns a Notion fetch instruction object.
   * Does NOT execute the fetch; caller (or Claude) must execute it.
   */
  buildDedupSpec(adsId: string = NOTION_IDS.ads): Record<string, unknown> {
    return {
      action: "notion-fetch",
      id: adsId,
      purpose: "dedup_check",
      filter: "状态=进行中",
      instruction: "有进行中任务→必须问用户「追加还是新建？」",
    };
  }

  fetchPage(pageId: string): Record<string, unknown> {
    return { action: "notion-fetch", id: pageId };
  }

  search(query: string): Record<string, unknown> {
    return { action: "notion-search", query };
  }

  run(task: AgentTask): AgentTask {
    const t0 = performance.now();
    try {
      if (task.intent === "查重" || task.intent === "dedup_check") {
        task.result = this.buildDedupSpec((task.payload.ads_id as string) ?? NOTION_IDS.ads);
      } else if (["fetch", "读", "read"].includes(task.intent)) {
        task.result = this.fetchPage((task.payload.page_id as string) ?? "");
      } else if (["search", "搜索"].includes(task.intent)) {
        task.result = this.search((task.payload.query as string) ?? "");
      } else {
        task.result = this.fetchPage((task.payload.page_id as string) ?? "");
      }
      task.status = "done";
    } catch (e) {
      task.status = "failed";
      task.error = String(e);
    }
    task.elapsed = Math.round(performance.now() - t0) / 1000;
    return task;
  }
}

// ── 🟢 Writer Agent ──────────────────────────────────────────────
export class WriterAgent {
  static PARENT_RULES: Record<string, Record<string, string>> = {
    dws: { type: "data_source_id", data_source_id: NOTION_IDS.dws },
    ads: { type: "data_source_id", data_source_id: NOTION_IDS.ads },
    meta: { type: "page_id", page_id: NOTION_IDS.meta },
  };

  static FORBIDDEN_PARENT = NOTION_IDS.root;

  resolveParent(target: string): Record<string, string> {
    if (target in WriterAgent.PARENT_RULES) {
      return WriterAgent.PARENT_RULES[target];
    }
    if (target === WriterAgent.FORBIDDEN_PARENT) {
      throw new Error(
        `FORBIDDEN: Cannot write directly to root ${WriterAgent.FORBIDDEN_PARENT}. ` +
          "Use 'dws', 'ads', or a specific sub-page UUID.",
      );
    }
    return { type: "page_id", page_id: target };
  }

  buildCreateSpec(
    title: string,
    content: string,
    target = "dws",
    properties?: Record<string, unknown>,
  ): Record<string, unknown> {
    const parent = this.resolveParent(target);
    const props: Record<string, unknown> = { [resolve("DWS", "title")]: title, [resolve("DWS", "status")]: STATUS_IN_PROGRESS };
    if (properties) Object.assign(props, properties);
    return {
      action: "notion-create-pages",
      parent,
      pages: [{ properties: props, content }],
    };
  }

  run(task: AgentTask): AgentTask {
    const t0 = performance.now();
    try {
      const spec = this.buildCreateSpec(
        (task.payload.title as string) ?? "未命名",
        (task.payload.content as string) ?? "",
        (task.payload.target as string) ?? "dws",
        task.payload.properties as Record<string, unknown> | undefined,
      );
      task.result = spec;
      task.status = "done";
    } catch (e) {
      task.status = "failed";
      task.error = String(e);
    }
    task.elapsed = Math.round(performance.now() - t0) / 1000;
    return task;
  }
}

// ── 🟡 StateManager Agent ────────────────────────────────────────
export class StateManagerAgent {
  buildAdsUpdate(
    adsTaskId: string,
    dwsUrl: string,
    isFinal = true,
  ): Record<string, unknown> {
    const status = isFinal ? STATUS_DONE : STATUS_IN_PROGRESS;
    return {
      action: "notion-update-page",
      command: "update_properties",
      page_id: adsTaskId,
      properties: { [resolve("ADS", "status")]: status, [resolve("ADS", "note")]: dwsUrl },
    };
  }

  buildLogEntry(title: string, url: string, timestamp = ""): string {
    const ts = timestamp || new Date().toLocaleTimeString("sv-SE", { timeZone: "Asia/Shanghai" }).slice(0, 5);
    return `${ts}｜[归档]｜写入DWS：${title} → ${url}`;
  }

  run(task: AgentTask): AgentTask {
    const t0 = performance.now();
    try {
      const adsTaskId = (task.payload.ads_task_id as string) ?? "";
      const dwsUrl = (task.payload.dws_url as string) ?? "";
      const title = (task.payload.title as string) ?? "";
      const isFinal = (task.payload.is_final as boolean) ?? true;

      const steps: Record<string, unknown> = {};

      // Step A: confirm write success
      steps.step_a = { status: "ok", url: dwsUrl };

      // Step B: ADS status writeback
      if (adsTaskId) {
        steps.step_b = this.buildAdsUpdate(adsTaskId, dwsUrl, isFinal);
      } else {
        steps.step_b = { skipped: "no ads_task_id provided" };
      }

      // Step C: log append
      steps.step_c = { log_entry: this.buildLogEntry(title, dwsUrl) };

      task.result = steps;
      task.status = "done";
    } catch (e) {
      task.status = "failed";
      task.error = String(e);
    }
    task.elapsed = Math.round(performance.now() - t0) / 1000;
    return task;
  }
}

// ── NotionAgentRouter ────────────────────────────────────────────
export class NotionAgentRouter {
  reader = new ReaderAgent();
  writer = new WriterAgent();
  state = new StateManagerAgent();
  private _log: AgentTask[] = [];

  clearLog(): void {
    this._log = [];
  }

  private resolveRole(intent: string): string {
    // Exact match first to avoid false positives from substring overlap
    if (intent in INTENT_MAP) return INTENT_MAP[intent];
    // Fallback: substring match
    for (const [key, role] of Object.entries(INTENT_MAP)) {
      if (intent.includes(key)) return role;
    }
    return ROLE_READER; // safe default
  }

  private dispatch(task: AgentTask): AgentTask {
    if (task.role === ROLE_READER) return this.reader.run(task);
    if (task.role === ROLE_WRITER) return this.writer.run(task);
    if (task.role === ROLE_STATE) return this.state.run(task);
    task.status = "failed";
    task.error = `Unknown role: ${task.role}`;
    return task;
  }

  /**
   * Sequential workflow: Reader (dedup) → Writer → StateManager.
   * Use for single-document operations only.
   */
  execute(intent: string, payload: Record<string, unknown>): Record<string, AgentTask> {
    const results: Record<string, AgentTask> = {};

    // Step 1: Reader dedup check (always)
    const rTask = createTask(ROLE_READER, "查重", payload);
    this.dispatch(rTask);
    results.reader = rTask;
    this._log.push(rTask);

    // Step 2: Writer
    const wTask = createTask(ROLE_WRITER, intent, payload);
    this.dispatch(wTask);
    results.writer = wTask;
    this._log.push(wTask);

    // Step 3: StateManager (only if writer succeeded)
    if (wTask.status === "done") {
      // dws_url comes from caller payload (actual URL available only after Notion API execution)
      const dwsUrl = (payload.dws_url as string) ?? "";
      const sPayload = { ...payload, dws_url: dwsUrl };
      const sTask = createTask(ROLE_STATE, "回写", sPayload);
      this.dispatch(sTask);
      results.state = sTask;
      this._log.push(sTask);
    }

    return results;
  }

  /**
   * Generate execution report for all dispatched tasks.
   */
  report(): string {
    const lines = ["── NotionAgentRouter 执行报告 ──"];
    const doneN = this._log.filter((t) => t.status === "done").length;
    const failN = this._log.filter((t) => t.status === "failed").length;
    const total = this._log.length;
    lines.push(`  📊 总计: ${total}  ✅ 成功: ${doneN}  ❌ 失败: ${failN}`);
    lines.push("");
    for (const t of this._log) {
      const icon = t.status === "done" ? "✅" : "❌";
      lines.push(`  ${icon} ${t.role} | ${t.intent} | ${t.elapsed}s`);
      if (t.error) lines.push(`     ERROR: ${t.error}`);
    }
    return lines.join("\n");
  }
}
