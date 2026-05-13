import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'fs';
import { join, relative } from 'path';

const DEFAULT_ROOT = process.cwd();
const MAX_MEMORY_CHARS = 6000;
const MAX_RULE_CHARS = 12000;
const MAX_SKILL_CHARS = 18000;

const ROUTE_RULES = [
  {
    target: 'ads',
    label: 'ADS 任务层',
    patterns: [/任务进度/, /本轮任务/, /待办|TODO/i, /进行中/, /完成第[一二三四五六七八九十\d]+步/],
    reason: '任务进度和待办需要进入 ADS 三态流转，不应污染长期记忆。',
  },
  {
    target: 'skill',
    label: 'Skill 流程层',
    patterns: [/可复用流程/, /成功.*流程/, /排障流程/, /稳定步骤/, /下次.*复用/, /runbook/i],
    reason: '可复用操作路径应沉淀为 skill，而不是只留在会话里。',
  },
  {
    target: 'rule',
    label: 'DIM 规则层',
    patterns: [/禁止/, /严禁/, /必须/, /不得/, /新增约束/, /规则/, /触发条件/],
    reason: '约束性内容需要进入 DIM 规则，并写清触发条件和反例。',
  },
  {
    target: 'memory',
    label: 'DIM 记忆层',
    patterns: [/用户偏好/, /反复纠正/, /稳定事实/, /Jack/, /长期偏好/],
    reason: '稳定偏好和反复纠正适合进入短记忆。',
  },
  {
    target: 'dws',
    label: 'DWS 会话层',
    patterns: [/会话总结/, /本次对话/, /讨论了/, /沉淀/, /复盘/],
    reason: '会话结论和过程证据应进入 DWS，供后续检索和追溯。',
  },
];

function walkFiles(dir, predicate, files = []) {
  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, predicate, files);
    } else if (predicate(fullPath, entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function readText(filePath) {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function countMatches(content, patterns) {
  return patterns.reduce((count, pattern) => count + (pattern.test(content) ? 1 : 0), 0);
}

function firstHeading(content) {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function hasFrontMatter(content) {
  return /^---\n[\s\S]*?\n---\n/.test(content);
}

function rel(rootDir, filePath) {
  return relative(rootDir, filePath);
}

export function classifyKnowledgeRoute(input) {
  const text = String(input || '');
  const matches = ROUTE_RULES
    .map((rule) => ({
      ...rule,
      score: countMatches(text, rule.patterns),
    }))
    .filter((rule) => rule.score > 0)
    .sort((a, b) => b.score - a.score);

  if (matches.length === 0) {
    return {
      target: 'review',
      label: '人工复核',
      reason: '未命中稳定路由规则，先保留为待复核建议。',
      score: 0,
    };
  }

  const winner = matches[0];
  return {
    target: winner.target,
    label: winner.label,
    reason: winner.reason,
    score: winner.score,
  };
}

export function analyzeMemory({ rootDir = DEFAULT_ROOT } = {}) {
  const filePath = join(rootDir, '00_DIM', 'memory.md');
  const content = readText(filePath);
  const lines = content.split('\n');
  const issues = [];

  lines.forEach((line, index) => {
    if (/临时|TODO|待办|本轮|明天|今天继续|进度/.test(line)) {
      issues.push({
        type: 'volatile-memory',
        file: rel(rootDir, filePath),
        line: index + 1,
        text: line.trim(),
        recommendation: '移到 ADS 任务或 DWS 会话，不保留在短记忆。',
      });
    }
  });

  if (content.length > MAX_MEMORY_CHARS) {
    issues.push({
      type: 'memory-too-long',
      file: rel(rootDir, filePath),
      chars: content.length,
      recommendation: `压缩到 ${MAX_MEMORY_CHARS} 字以内，保留声明式稳定事实。`,
    });
  }

  return {
    file: rel(rootDir, filePath),
    exists: existsSync(filePath),
    chars: content.length,
    sections: content.split(/^§$/m).length,
    issues,
  };
}

export function analyzeRules({ rootDir = DEFAULT_ROOT } = {}) {
  const rulesDir = join(rootDir, '00_DIM', 'rules');
  const files = walkFiles(rulesDir, (fullPath, name) => name.endsWith('.md') && name !== 'INDEX.md');
  const titleMap = new Map();
  const oversized = [];
  const missingFrontMatter = [];

  for (const file of files) {
    const content = readText(file);
    const title = firstHeading(content) || rel(rootDir, file);

    if (!titleMap.has(title)) titleMap.set(title, []);
    titleMap.get(title).push(rel(rootDir, file));

    if (content.length > MAX_RULE_CHARS) {
      oversized.push({
        file: rel(rootDir, file),
        chars: content.length,
        recommendation: '规则过长，考虑拆成触发条件更明确的小规则。',
      });
    }

    if (!hasFrontMatter(content)) {
      missingFrontMatter.push({
        file: rel(rootDir, file),
        recommendation: '补齐 YAML Front Matter，方便后续自动策展。',
      });
    }
  }

  const duplicates = [...titleMap.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([title, paths]) => ({
      title,
      files: paths,
      recommendation: '合并重复标题规则，保留一个权威入口，其余改为链接或删除。',
    }));

  return {
    count: files.length,
    duplicates,
    oversized,
    missingFrontMatter,
  };
}

export function analyzeSkills({ rootDir = DEFAULT_ROOT } = {}) {
  const skillsDir = join(rootDir, '.agents', 'skills');
  const files = walkFiles(skillsDir, (fullPath, name) => name === 'SKILL.md');
  const missingMetadata = [];
  const oversized = [];
  const nameMap = new Map();

  for (const file of files) {
    const content = readText(file);
    const relPath = rel(rootDir, file);
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    const descriptionMatch = content.match(/^description:\s*(.+)$/m);
    const name = nameMatch?.[1]?.trim() || relPath.split('/').at(-2);

    if (!nameMap.has(name)) nameMap.set(name, []);
    nameMap.get(name).push(relPath);

    if (!nameMatch || !descriptionMatch) {
      missingMetadata.push({
        file: relPath,
        recommendation: '补齐 name 和 description，提升触发稳定性。',
      });
    }

    if (content.length > MAX_SKILL_CHARS) {
      oversized.push({
        file: relPath,
        chars: content.length,
        recommendation: 'Skill 过长，拆出 references 或 scripts，入口只保留触发和流程。',
      });
    }
  }

  const duplicates = [...nameMap.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([name, paths]) => ({
      name,
      files: paths,
      recommendation: '合并同名 skill，避免触发歧义。',
    }));

  return {
    count: files.length,
    missingMetadata,
    oversized,
    duplicates,
  };
}

export function analyzeSessions({ rootDir = DEFAULT_ROOT, limit = 50 } = {}) {
  const sessionsDir = join(rootDir, '03_DWS', 'sessions');
  const files = walkFiles(sessionsDir, (fullPath, name) => name.endsWith('.md'))
    .map((file) => ({ file, mtimeMs: statSync(file).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit)
    .map((item) => item.file);

  const skillCandidates = [];

  for (const file of files) {
    const content = readText(file);
    const score = countMatches(content, [
      /稳定步骤/,
      /可复用流程/,
      /下次.*复用/,
      /排障流程/,
      /修复后形成/,
      /经验沉淀/,
      /踩坑/,
    ]);

    if (score > 0) {
      skillCandidates.push({
        file: rel(rootDir, file),
        score,
        reason: '包含可复用流程或踩坑经验，适合提炼为 skill 草案。',
      });
    }
  }

  return {
    scanned: files.length,
    skillCandidates,
  };
}

function loadHookSettings(rootDir) {
  const settingsPath = join(rootDir, '.claude', 'settings.json');
  if (!existsSync(settingsPath)) {
    return {
      file: rel(rootDir, settingsPath),
      exists: false,
      hooks: {},
      parseError: null,
    };
  }

  try {
    const parsed = JSON.parse(readText(settingsPath));
    return {
      file: rel(rootDir, settingsPath),
      exists: true,
      hooks: parsed.hooks || {},
      parseError: null,
    };
  } catch (error) {
    return {
      file: rel(rootDir, settingsPath),
      exists: true,
      hooks: {},
      parseError: error.message,
    };
  }
}

function hookCommandIncludes(hooks, eventName, needle) {
  const entries = hooks[eventName] || [];
  return entries.some((entry) => {
    if (entry.command?.includes(needle)) return true;
    return (entry.hooks || []).some((hook) => hook.command?.includes(needle));
  });
}

function matcherHasCommand(hooks, eventName, matcherPattern, commandNeedle) {
  const entries = hooks[eventName] || [];
  return entries.some((entry) => {
    const matcher = String(entry.matcher || '');
    if (!matcherPattern.test(matcher)) return false;
    return (entry.hooks || []).some((hook) => hook.command?.includes(commandNeedle));
  });
}

export function analyzeTriggers({ rootDir = DEFAULT_ROOT } = {}) {
  const settings = loadHookSettings(rootDir);
  const issues = [];

  if (!settings.exists) {
    issues.push({
      type: 'missing-hook-settings',
      file: settings.file,
      severity: 'high',
      recommendation: '创建 .claude/settings.json，并注册 PreToolUse 与 Stop 巡检入口。',
    });
  }

  if (settings.parseError) {
    issues.push({
      type: 'invalid-hook-settings',
      file: settings.file,
      severity: 'high',
      details: settings.parseError,
      recommendation: '修复 JSON 后再判断 Hook 是否可触发。',
    });
  }

  const hooks = settings.hooks || {};

  const registeredHooks = [];
  for (const [eventName, entries] of Object.entries(hooks)) {
    for (const entry of entries || []) {
      for (const hook of entry.hooks || []) {
        if (hook.command) registeredHooks.push(`${eventName}: ${hook.command}`);
      }
    }
  }

  if (registeredHooks.length > 0) {
    issues.push({
      type: 'unexpected-default-hooks',
      file: settings.file,
      severity: 'medium',
      details: registeredHooks.join('\n'),
      recommendation: '当前策略是零默认 hook；规则检查改由 AGENTS.md、显式命令和 Codex automation 承接。',
    });
  }

  return {
    settingsFile: settings.file,
    issues,
    coverage: {
      zeroDefaultHooks: registeredHooks.length === 0,
      registeredHooks,
    },
  };
}

export function analyzeEvolution(options = {}) {
  const rootDir = options.rootDir || DEFAULT_ROOT;
  const report = {
    generatedAt: new Date().toISOString(),
    rootDir,
    mode: 'readonly',
    memory: analyzeMemory({ rootDir }),
    rules: analyzeRules({ rootDir }),
    skills: analyzeSkills({ rootDir }),
    sessions: analyzeSessions({ rootDir, limit: options.limit || 50 }),
    triggers: analyzeTriggers({ rootDir }),
  };

  const issueCount =
    report.memory.issues.length +
    report.rules.duplicates.length +
    report.rules.oversized.length +
    report.rules.missingFrontMatter.length +
    report.skills.missingMetadata.length +
    report.skills.oversized.length +
    report.skills.duplicates.length +
    report.sessions.skillCandidates.length +
    report.triggers.issues.length;

  report.summary = {
    issueCount,
    recommendation: issueCount > 0
      ? '先人工审阅报告，再选择要沉淀、合并或技能化的项目。'
      : '当前未发现明显策展项，保持现状。',
  };

  return report;
}

function pushItems(lines, items, render) {
  if (!items || items.length === 0) {
    lines.push('- ✅ 暂无明显问题');
    return;
  }

  for (const item of items) {
    lines.push(render(item));
  }
}

export function formatMarkdownReport(report) {
  const lines = [
    '# 自我进化只读报告',
    '',
    `- 📌 生成时间：${report.generatedAt}`,
    `- 📌 扫描根目录：${report.rootDir}`,
    `- 📌 模式：${report.mode}`,
    `- 📌 问题/机会总数：${report.summary.issueCount}`,
    '- ⚠️ 所有建议默认只读；需要写入 memory、rules、skills 或 DWS 时，应先审阅 diff。',
    '',
    '## 记忆维护',
    '',
    `- 📊 文件：${report.memory.file}`,
    `- 📊 字符数：${report.memory.chars}`,
    `- 📊 分段数：${report.memory.sections}`,
  ];

  pushItems(lines, report.memory.issues, (item) =>
    `- ⚠️ ${item.type}：${item.file}:${item.line || '?'} — ${item.recommendation}`
  );

  lines.push('', '## 规则维护', '', `- 📊 规则文件数：${report.rules.count}`, '', '### 重复规则');
  pushItems(lines, report.rules.duplicates, (item) =>
    `- ⚠️ ${item.title}：${item.files.join('、')} — ${item.recommendation}`
  );

  lines.push('', '### 过长规则');
  pushItems(lines, report.rules.oversized, (item) =>
    `- ⚠️ ${item.file}（${item.chars} 字）— ${item.recommendation}`
  );

  lines.push('', '### 缺少元数据');
  pushItems(lines, report.rules.missingFrontMatter, (item) =>
    `- ⚠️ ${item.file} — ${item.recommendation}`
  );

  lines.push('', '## Skill 维护', '', `- 📊 Skill 数：${report.skills.count}`, '', '### 元数据问题');
  pushItems(lines, report.skills.missingMetadata, (item) =>
    `- ⚠️ ${item.file} — ${item.recommendation}`
  );

  lines.push('', '### 过长 Skill');
  pushItems(lines, report.skills.oversized, (item) =>
    `- ⚠️ ${item.file}（${item.chars} 字）— ${item.recommendation}`
  );

  lines.push('', '### 重复 Skill');
  pushItems(lines, report.skills.duplicates, (item) =>
    `- ⚠️ ${item.name}：${item.files.join('、')} — ${item.recommendation}`
  );

  lines.push('', '## 会话到 Skill', '', `- 📊 扫描最近会话：${report.sessions.scanned}`, '', '### 可技能化会话');
  pushItems(lines, report.sessions.skillCandidates, (item) =>
    `- 💡 ${item.file}（score=${item.score}）— ${item.reason}`
  );

  lines.push('', '## 触发器可执行性', '', `- 📊 配置文件：${report.triggers.settingsFile}`);
  pushItems(lines, report.triggers.issues, (item) =>
    `- ⚠️ ${item.type}（${item.severity}）— ${item.recommendation}`
  );

  lines.push('', '## 下一步建议', '', `- 🎯 ${report.summary.recommendation}`);

  return lines.join('\n');
}
