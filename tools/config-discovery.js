#!/usr/bin/env bun

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_ROOT_DIR = join(__dirname, '..');
const SENSITIVE_KEY_RE = /(API[_-]?KEY|TOKEN|SECRET|PASSWORD|PRIVATE|CREDENTIAL)/i;
const CONFIG_KEY_RE = /\b[A-Z][A-Z0-9_]{2,}\b/g;
const PLACEHOLDER_KEYS = new Set(['API_KEY', 'YOUR_API_KEY', 'KEY_NAME', 'ENV_VAR']);

function normalizePath(path) {
  return path.replace(/\\/g, '/');
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function extractScriptPath(script) {
  const match = script.match(/\b(tools\/[^\s"'`]+?\.js)\b/);
  return match ? match[1] : '';
}

function inferRisk(name, script) {
  const text = `${name} ${script}`;
  if (/\b(push|reset\s+--hard|clean\s+-fd|rm\s+-rf|force)\b/.test(text)) return 'high';
  if (/(--fix|--apply|apply|--fail-on-issues|rebuild|delete|move|write|setup)/i.test(text)) return 'medium';
  return 'low';
}

function inferPurpose(name, scriptPath) {
  const text = `${name} ${scriptPath}`;
  if (text.includes('knowledge:health')) return '检查知识库质量、来源追踪、链接和结构信号';
  if (text.includes('config:discover')) return '发现项目命令、配置项和工具目录';
  if (text.includes('direction:')) return '同步方向盘任务与 ADS 执行层';
  if (text.includes('memory:')) return '管理本地记忆和向量索引';
  if (text.includes('search')) return '检索知识库内容或评估搜索质量';
  if (text.includes('check')) return '检查命名、Hook 或规则健康状态';
  if (text.includes('fetch')) return '抓取外部来源并导入 ODS';
  if (text.includes('move')) return '移动 ADS 任务状态';
  if (text.includes('archive') || text.includes('session')) return '保存或提取会话记录';
  return '项目自动化工具';
}

function inferLayers(name, script, scriptPath) {
  const text = `${name} ${script} ${scriptPath}`;
  const layers = ['tools'];
  if (/(DIM|rule|template|config|setup|hook|check|audit|catalog|index|00_DIM)/i.test(text)) layers.unshift('00_DIM');
  if (/(ODS|fetch|source|web)/i.test(text)) layers.unshift('01_ODS');
  if (/(DWD|flashcard|dwd)/i.test(text)) layers.unshift('02_DWD');
  if (/(DWS|session|archive|insight|dws)/i.test(text)) layers.unshift('03_DWS');
  if (/(ADS|direction|move|task|ads|04_ADS)/i.test(text)) layers.unshift('04_ADS');
  if (/(方向盘|direction)/i.test(text)) layers.unshift('00_方向盘');
  return unique(layers);
}

function discoverCommands(rootDir) {
  const packagePath = join(rootDir, 'package.json');
  const packageJson = JSON.parse(readText(packagePath) || '{}');
  const scripts = packageJson.scripts || {};

  return Object.entries(scripts)
    .map(([name, script]) => {
      const scriptPath = extractScriptPath(script);
      return {
        name,
        command: `bun run ${name}`,
        script,
        scriptPath,
        purpose: inferPurpose(name, scriptPath),
        layers: inferLayers(name, script, scriptPath),
        risk: inferRisk(name, script),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function defaultValueFromLine(line, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const envPattern = new RegExp(`process\\.env\\.${escaped}\\s*(?:\\|\\||\\?\\?)\\s*['"]([^'"]+)['"]`);
  const envMatch = line.match(envPattern);
  if (envMatch) return envMatch[1];

  const assignmentPattern = new RegExp(`\\b${escaped}=([^\\s\`'"]+)`);
  const assignmentMatch = line.match(assignmentPattern);
  return assignmentMatch ? assignmentMatch[1] : null;
}

function addConfig(configs, key, sourceFile, line, associatedCommands) {
  if (!key || key.length < 3) return;
  if (['TRUE', 'FALSE', 'TODO', 'README', 'INDEX', 'JSON', 'HTTP', 'HTTPS'].includes(key)) return;
  if (PLACEHOLDER_KEYS.has(key)) return;
  if (!key.includes('_') && !SENSITIVE_KEY_RE.test(key)) return;

  const existing = configs.get(key) || {
    key,
    defaultValue: null,
    required: false,
    sensitive: SENSITIVE_KEY_RE.test(key),
    sources: [],
    associatedCommands: [],
  };

  const defaultValue = defaultValueFromLine(line, key);
  if (defaultValue !== null && existing.defaultValue === null) {
    existing.defaultValue = defaultValue;
  }
  existing.required = existing.required || (defaultValue === null && SENSITIVE_KEY_RE.test(key));
  existing.sources = unique([...existing.sources, sourceFile]);
  existing.associatedCommands = unique([...existing.associatedCommands, ...associatedCommands]);
  configs.set(key, existing);
}

function stripRegexLiterals(line) {
  return line.replace(/(^|[=(:,\[]\s*)\/(?:\\.|[^/\\\n])+\/[a-z]*/g, '$1');
}

function commandsForSource(commands, sourceFile) {
  return commands
    .filter((command) => command.scriptPath && sourceFile.endsWith(command.scriptPath))
    .map((command) => command.command);
}

async function discoverConfigs(rootDir, commands) {
  const patterns = [
    'package.json',
    'tools/**/*.js',
    '00_DIM/rules/**/*.md',
    '00_DIM/templates/**/*.md',
    'AGENTS.md',
    'CLAUDE.md',
    '.kimi/AGENTS.md',
    'README.md',
    'settings.local.template.json',
  ];
  const files = [];
  for (const pattern of patterns) {
    files.push(...await glob(pattern, { cwd: rootDir, nodir: true, ignore: ['node_modules/**', 'tools/**/*.test.js'] }));
  }

  const configs = new Map();
  for (const file of unique(files).sort()) {
    const fullPath = join(rootDir, file);
    const content = readText(fullPath);
    if (!content) continue;

    const associatedCommands = commandsForSource(commands, normalizePath(file));
    content.split('\n').forEach((rawLine) => {
      const line = stripRegexLiterals(rawLine);
      if (!/(process\.env\.|`[A-Z][A-Z0-9_]{2,}|[A-Z][A-Z0-9_]{2,}=)/.test(line)) return;

      const matches = [];
      for (const match of line.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})/g)) {
        matches.push(match[1]);
      }
      for (const match of line.matchAll(/`([A-Z][A-Z0-9_]{2,})(?:=[^`]*)?`/g)) {
        matches.push(match[1]);
      }
      for (const match of line.matchAll(/\b([A-Z][A-Z0-9_]{2,})=[^\s`'"]+/g)) {
        matches.push(match[1]);
      }
      matches.forEach((key) => addConfig(configs, key, normalizePath(file), line, associatedCommands));
    });
  }

  return [...configs.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export async function discoverProjectConfig({ rootDir = DEFAULT_ROOT_DIR } = {}) {
  const commands = discoverCommands(rootDir);
  const configs = await discoverConfigs(rootDir, commands);
  return {
    generatedAt: new Date().toISOString(),
    rootDir,
    commands,
    configs,
  };
}

function markdownList(values) {
  return values.length > 0 ? values.map((value) => `\`${value}\``).join(' / ') : '-';
}

export function formatConfigDiscoveryReport(report) {
  const lines = [
    '# 配置发现报告',
    '',
    `生成时间：${report.generatedAt}`,
    '',
    '## 配置项',
    '',
    '| Key | 默认值 | 必填 | 敏感 | 来源 | 关联命令 |',
    '|---|---|---:|---:|---|---|',
  ];

  report.configs.forEach((config) => {
    lines.push(
      `| \`${config.key}\` | ${config.defaultValue === null ? '-' : `\`${config.defaultValue}\``} | ${config.required ? '是' : '否'} | ${config.sensitive ? '是' : '否'} | ${markdownList(config.sources)} | ${markdownList(config.associatedCommands)} |`
    );
  });

  lines.push('', '## 命令', '', '| 命令 | 脚本 | 风险 | 层级 | 功能 |', '|---|---|---|---|---|');
  report.commands.forEach((command) => {
    lines.push(
      `| \`${command.command}\` | ${command.scriptPath ? `\`${command.scriptPath}\`` : '-'} | ${command.risk} | ${command.layers.join(' / ')} | ${command.purpose} |`
    );
  });

  return `${lines.join('\n')}\n`;
}

export function formatToolCatalog(report) {
  const lines = [
    '---',
    '层级: DIM',
    '类型: 工具目录',
    `generated: ${report.generatedAt}`,
    '---',
    '',
    '# 工具能力目录',
    '',
    '> 本文件由 `bun run config:catalog` 生成。手动修改会在下次生成时被覆盖。',
    '',
    '覆盖层级：00_DIM / 04_ADS / tools',
    '',
    '## 命令目录',
    '',
    '| 命令 | 脚本路径 | 功能 | 读写层级 | 风险 |',
    '|---|---|---|---|---|',
  ];

  report.commands.forEach((command) => {
    lines.push(
      `| \`${command.command}\` | ${command.scriptPath ? `\`${command.scriptPath}\`` : '-'} | ${command.purpose} | ${command.layers.join(' / ')} | ${command.risk} |`
    );
  });

  lines.push('', '## 配置项', '', '| Key | 默认值 | 必填 | 敏感 | 来源 |', '|---|---|---:|---:|---|');
  report.configs.forEach((config) => {
    lines.push(
      `| \`${config.key}\` | ${config.defaultValue === null ? '-' : `\`${config.defaultValue}\``} | ${config.required ? '是' : '否'} | ${config.sensitive ? '是' : '否'} | ${markdownList(config.sources)} |`
    );
  });

  return `${lines.join('\n')}\n`;
}

function parseArgs(args) {
  return {
    json: args.includes('--json'),
    catalog: args.includes('--catalog'),
    writeCatalog: args.includes('--write-catalog'),
    help: args.includes('--help') || args.includes('-h'),
  };
}

function printHelp() {
  console.log(`
配置发现工具

使用方法:
  bun run config:discover
  bun run config:discover --json
  bun run config:catalog

输出内容:
  - package.json 中的 bun run 命令
  - 工具、规则、模板中的配置 key
  - 默认值、敏感性、必填性、关联命令和风险等级
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const report = await discoverProjectConfig({ rootDir: process.cwd() });
  if (options.writeCatalog) {
    const outputPath = join(process.cwd(), '00_DIM', 'TOOL_CATALOG.md');
    writeFileSync(outputPath, formatToolCatalog(report), 'utf8');
    console.log(`✅ 已生成 ${relative(process.cwd(), outputPath)}`);
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(options.catalog ? formatToolCatalog(report) : formatConfigDiscoveryReport(report));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`❌ 配置发现失败: ${error.message}`);
    process.exit(1);
  });
}
