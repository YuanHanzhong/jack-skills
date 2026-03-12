/**
 * startt_auto_trigger.ts — STARTT document auto-trigger v2 (Claude semantic judgment version)
 *
 * Iron rule: every new conversation window, turn 1 → immediately create STARTT document
 * Architecture:
 *   - Code = flow control + Notion write format
 *   - Claude = smart understanding of user purpose, classification, fill STARTT fields
 *   - NEVER use msg.slice(0,15) truncation to replace understanding purpose
 */

import {
  STARTT_TEMPLATE_ID, LOG_PAGE_ID, DWS_DATA_SOURCE_ID, TODAY_DB_ID,
} from "../_shared/config.ts";
import { getDisplay } from "../_shared/time_utils.ts";
export { STARTT_TEMPLATE_ID, LOG_PAGE_ID, DWS_DATA_SOURCE_ID };
export const TODAY_DB_DATA_SOURCE_ID = TODAY_DB_ID;

/**
 * Build STARTT document initial content.
 * All field content is filled by Claude intelligently; code only handles format and structure.
 *
 * @param ts         - Timestamp ID (e.g. "260311-1430")
 * @param purpose    - Claude-distilled purpose (not truncation)
 * @param category   - Claude-judged category: 优化工具/个人成长/知识学习/专业技术
 * @param userMessage - User's original turn 1 message (preserve original)
 * @param background  - Claude's understanding of background
 * @param initialPlan - Claude's initial direction judgment
 */
export function buildStarttDoc(
  ts: string,
  purpose: string,
  category: string,
  userMessage: string,
  background: string,
  initialPlan: string,
): string {
  const display = getDisplay();
  return `## 🎯 S · 背景与目标

> 📌 创建时间：${display} (UTC+8)

> 📌 分类：${category}

> 📌 用户原话：${userMessage.slice(0, 200)}

> 📌 背景理解：${background}

> 📌 核心目的：${purpose}

---

## ✅ T · 已澄清需求 + 进展记录

> 📌 （目的确认后由Claude持续追加进展）

---

## ❓ A · 待澄清问题

> 📌 （执行过程中补充）

---

## 🔧 R · 执行计划

> 📌 初步方向：${initialPlan}

---

## 📊 T · 技术约束

> 📌 （执行过程中补充）

---

## 📝 变更日志

> 🗓️ ${display} · 初始创建，目的待第2轮确认
`;
}

// ============================================================
// Claude STARTT auto-trigger protocol
// ============================================================

export const CLAUDE_STARTT_PROTOCOL = `
【STARTT自动触发协议·Claude执行标准】

触发时机：新对话第1轮，Claude理解用户消息后，立刻执行

Step 1·Claude智能理解（禁止截断字符串）
  - 目的：用一个名词短语概括核心目标（<10字）
  - 分类：优化工具 / 个人成长 / 知识学习 / 专业技术
  - 背景：用户为什么提这个需求（一句话）
  - 初步方向：Claude判断大致怎么解决

Step 2·代码生成文档结构
  import { buildStarttDoc } from "./startt_auto_trigger.ts";
  const content = buildStarttDoc(ts, purpose, category, userMsg, background, plan);

Step 3·同时建两个记录（并行）
  A. Notion:notion-create-pages → DWS（完整STARTT文档）
  B. Notion:notion-create-pages → 今天日志数据库（一行摘要）

Step 4·第2轮主动确认
  输出：「📌 目的是「{purpose}」，对吗？如不对告诉我，下一轮更正。」

【禁止的写法】
  ❌ purpose = userMsg.slice(0,15)           ← 截断不是理解
  ❌ category = "其他"                       ← 没有判断就默认
`;
