#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..");

const entries = [
  {
    label: "Claude Code project entry",
    file: path.join(repoRoot, "CLAUDE.md"),
    required: [
      "AGENTS.md",
      'bun run rules:resolve -- --query "<关键词>"',
      "00_DIM/rules/需求澄清计划先行规范.md",
      "00_DIM/rules/Hermes-Codex协作规范.md",
      "/Users/jack/.hermes/SOUL.md",
      "/Users/jack/.hermes/skills/**/SKILL.md",
      "00_DIM/hermes-skills/manifest.json",
      "不复制完整规则正文",
    ],
  },
  {
    label: "Codex project entry",
    file: path.join(repoRoot, "AGENTS.md"),
    required: [
      "/Users/jack/1_learn/AGENTS.md",
      "00_DIM/rules/需求澄清计划先行规范.md",
      "00_DIM/rules/Hermes-Codex协作规范.md",
      "/Users/jack/.hermes/SOUL.md",
      "/Users/jack/.hermes/skills/**/SKILL.md",
      "00_DIM/hermes-skills/manifest.json",
      "飞书 / 移动端输出格式",
    ],
  },
  {
    label: "Codex global entry",
    file: "/Users/jack/.codex/AGENTS.md",
    required: [
      "/Users/jack/1_learn/AGENTS.md",
      "00_DIM/rules/需求澄清计划先行规范.md",
      "00_DIM/rules/Hermes-Codex协作规范.md",
      "/Users/jack/.hermes/SOUL.md",
      "/Users/jack/.hermes/skills/**/SKILL.md",
      "00_DIM/hermes-skills/manifest.json",
      "不复制完整规则正文",
    ],
  },
  {
    label: "Cursor project rule",
    file: path.join(repoRoot, ".cursor/rules/output.mdc"),
    required: [
      "AGENTS.md",
      "00_DIM/rules/需求澄清计划先行规范.md",
      "00_DIM/rules/Hermes-Codex协作规范.md",
      "/Users/jack/.hermes/SOUL.md",
      "/Users/jack/.hermes/skills/**/SKILL.md",
      "00_DIM/hermes-skills/manifest.json",
      "自然标题行",
      "emoji +【标题】",
      "避免 `###`",
      "轻缩进",
    ],
  },
  {
    label: "Kimi Code CLI project entry",
    file: path.join(repoRoot, ".kimi/AGENTS.md"),
    required: [
      "AGENTS.md",
      'bun run rules:resolve -- --query "<关键词>"',
      "00_DIM/rules/需求澄清计划先行规范.md",
      "00_DIM/rules/Hermes-Codex协作规范.md",
      "/Users/jack/.hermes/SOUL.md",
      "/Users/jack/.hermes/skills/**/SKILL.md",
      "00_DIM/hermes-skills/manifest.json",
      "不复制完整规则正文",
      "Agent",
      "EnterPlanMode",
    ],
  },
];

let failures = 0;

for (const entry of entries) {
  let content = "";
  try {
    content = fs.readFileSync(entry.file, "utf8");
  } catch (error) {
    console.error(`FAIL ${entry.label}: cannot read ${entry.file}`);
    failures += 1;
    continue;
  }

  const missing = entry.required.filter((needle) => !content.includes(needle));
  if (missing.length > 0) {
    console.error(`FAIL ${entry.label}: ${entry.file}`);
    for (const needle of missing) {
      console.error(`  missing: ${needle}`);
    }
    failures += 1;
    continue;
  }

  console.log(`OK ${entry.label}`);
}

if (failures > 0) {
  process.exit(1);
}
