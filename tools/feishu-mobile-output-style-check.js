#!/usr/bin/env bun

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const files = {
  soul: "/Users/jack/.hermes/SOUL.md",
  hermesAgent:
    "/Users/jack/.hermes/skills/autonomous-ai-agents/hermes-agent/SKILL.md",
  readabilityRef:
    "/Users/jack/.hermes/skills/autonomous-ai-agents/hermes-agent/references/feishu-mobile-reply-readability.md",
  rulePropagation:
    "/Users/jack/.hermes/skills/devops/jack-rule-propagation/SKILL.md",
  agents: "/Users/jack/1_learn/AGENTS.md",
};

for (const profile of readdirSync("/Users/jack/.hermes/profiles", {
  withFileTypes: true,
})) {
  if (!profile.isDirectory()) continue;
  const soulPath = join(
    "/Users/jack/.hermes/profiles",
    profile.name,
    "SOUL.md",
  );
  if (existsSync(soulPath)) files[`profile:${profile.name}`] = soulPath;
}

const docs = Object.fromEntries(
  Object.entries(files).map(([key, path]) => [
    key,
    { path, text: readFileSync(path, "utf8") },
  ]),
);

const failures = [];

function expectMatch(key, label, pattern) {
  if (!pattern.test(docs[key].text)) {
    failures.push(`${docs[key].path}: missing ${label}`);
  }
}

function expectNoMatch(key, label, pattern) {
  if (pattern.test(docs[key].text)) {
    failures.push(`${docs[key].path}: stale ${label}`);
  }
}

function expectNoActiveBlockquoteHierarchy(key) {
  const riskyLines = docs[key].text
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => /`>{1,2}`/.test(line))
    .filter(({ line }) => /(层级|缩进|hierarchy|indent)/i.test(line))
    .filter(
      ({ line }) =>
        !/(不要|避免|禁止|不是|不再|do not|avoid|not|remove|without)/i.test(
          line,
        ),
    );

  for (const { number, line } of riskyLines) {
    failures.push(
      `${docs[key].path}:${number}: active blockquote hierarchy guidance: ${line.trim()}`,
    );
  }
}

expectMatch(
  "soul",
  "natural or card title line rule",
  /标题可以用两种稳定形态[\s\S]*自然标题行[\s\S]*emoji \+【标题】/,
);
expectMatch(
  "soul",
  "no Markdown heading markers in normal chat",
  /普通飞书聊天[\s\S]*不要使用 `###`/,
);
expectMatch(
  "soul",
  "big-module separator rule",
  /大模块[\s\S]*`---`[\s\S]*分隔/,
);
expectMatch(
  "soul",
  "same-line numbered item rule",
  /编号项[\s\S]*同一行[\s\S]*`1\. 标题/,
);
expectMatch(
  "soul",
  "light a/b/c subitem indentation rule",
  /子项[\s\S]*`a\.`[\s\S]*`b\.`[\s\S]*`c\.`[\s\S]*轻缩进/,
);
expectMatch("soul", "avoid tofu square symbol rule", /避免[\s\S]*`□`/);
expectMatch(
  "soul",
  "semantic emoji module-label rule",
  /emoji[\s\S]*语义模块标签[\s\S]*不要每行都放/,
);

for (const key of Object.keys(docs).filter((key) => key.startsWith("profile:"))) {
  expectMatch(
    key,
    "profile Feishu/mobile style sync",
    /飞书 \/ 移动端输出格式[\s\S]*自然标题行[\s\S]*编号项[\s\S]*同一行/,
  );
}

for (const key of ["hermesAgent", "readabilityRef", "rulePropagation"]) {
  expectMatch(
    key,
    "pointer to SOUL as canonical detailed style source",
    /SOUL\.md[\s\S]*(详细|权威|唯一|canonical|source)/i,
  );
}

expectMatch(
  "agents",
  "Codex Feishu/mobile style summary",
  /飞书 \/ 移动端输出格式[\s\S]*(自然标题行|emoji \+【标题】)[\s\S]*同一行/,
);

for (const key of Object.keys(docs)) {
  expectNoMatch(key, "old 1）emoji step guidance", /1）emoji/);
  expectNoMatch(
    key,
    "line-start 1. prohibition",
    /(line-start|行首)[^\n]*`1\. `.*(avoid|避免|不要|禁止)/i,
  );
  expectNoActiveBlockquoteHierarchy(key);
}

if (failures.length > 0) {
  console.error("Feishu/mobile output style check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Feishu/mobile output style check passed.");
