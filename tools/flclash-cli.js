#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DEFAULT_CONTROLLER = 'http://127.0.0.1:9090';
const DEFAULT_TEST_URL = 'https://www.gstatic.com/generate_204';
const DEFAULT_TIMEOUT = 5000;
const KIMI_RULE_MARKER_START = 'Kimi (Moonshot AI) Direct Rules - Auto-managed';
const KIMI_RULE_MARKER_END = 'End Kimi Rules';
const KIMI_DIRECT_RULES = [
  'DOMAIN-SUFFIX,kimi.moonshot.cn,DIRECT',
  'DOMAIN-SUFFIX,api.moonshot.cn,DIRECT',
  'DOMAIN-SUFFIX,statics.moonshot.cn,DIRECT',
  'DOMAIN-SUFFIX,kimi.com,DIRECT',
  'DOMAIN-SUFFIX,moonshot.cn,DIRECT',
  'DOMAIN,platform.kimi.com,DIRECT',
  'DOMAIN,api.kimi.com,DIRECT',
  'DOMAIN,www.kimi.com,DIRECT',
  'DOMAIN,www.moonshot.cn,DIRECT',
];
const GROUP_TYPES = new Set(['Selector', 'URLTest', 'Fallback', 'Relay', 'LoadBalance']);
const WESTERN_REGION_PATTERNS = [
  ['美国', /🇺🇸|美国|美國|美西|美东|美國|US|USA|United States|America|Los Angeles|San Jose|Seattle|New York|Dallas|Chicago/i],
  ['加拿大', /🇨🇦|加拿大|Canada|Toronto|Vancouver/i],
  ['英国', /🇬🇧|英国|英國|UK|United Kingdom|London/i],
  ['德国', /🇩🇪|德国|德國|Germany|Frankfurt|Berlin/i],
  ['法国', /🇫🇷|法国|法國|France|Paris/i],
  ['荷兰', /🇳🇱|荷兰|荷蘭|Netherlands|Holland|Amsterdam/i],
  ['意大利', /🇮🇹|意大利|Italy|Milan|Rome/i],
  ['西班牙', /🇪🇸|西班牙|Spain|Madrid/i],
  ['葡萄牙', /🇵🇹|葡萄牙|Portugal|Lisbon/i],
  ['爱尔兰', /🇮🇪|爱尔兰|愛爾蘭|Ireland|Dublin/i],
  ['瑞士', /🇨🇭|瑞士|Switzerland|Zurich/i],
  ['瑞典', /🇸🇪|瑞典|Sweden|Stockholm/i],
  ['芬兰', /🇫🇮|芬兰|芬蘭|Finland|Helsinki/i],
  ['挪威', /🇳🇴|挪威|Norway|Oslo/i],
  ['丹麦', /🇩🇰|丹麦|丹麥|Denmark|Copenhagen/i],
  ['波兰', /🇵🇱|波兰|波蘭|Poland|Warsaw/i],
  ['捷克', /🇨🇿|捷克|Czech|Prague/i],
  ['奥地利', /🇦🇹|奥地利|奧地利|Austria|Vienna/i],
  ['比利时', /🇧🇪|比利时|比利時|Belgium|Brussels/i],
  ['卢森堡', /🇱🇺|卢森堡|盧森堡|Luxembourg/i],
  ['冰岛', /🇮🇸|冰岛|冰島|Iceland/i],
  ['希腊', /🇬🇷|希腊|希臘|Greece|Athens/i],
];

function usage() {
  return `Usage:
  bun run flclash:status
  bun run flclash start
  bun run flclash restart
  bun run flclash airports
  bun run flclash airport <airport-index>
  bun run flclash groups
  bun run flclash nodes <group-index-or-name>
  bun run flclash delay <group-index-or-name> [node-index-or-name]
  bun run flclash delay <group-index-or-name> --all
  bun run flclash select <group-index-or-name> <node-index-or-name>
  bun run flclash guard [--health]

Options:
  --controller <url>   Controller URL, default ${DEFAULT_CONTROLLER}
  --url <url>          Delay test URL, default ${DEFAULT_TEST_URL}
  --timeout <ms>       Delay timeout, default ${DEFAULT_TIMEOUT}
  --all-regions        Do not filter nodes to Europe/America
  --health             Include FlClash/controller health in guard output
  --json               Print machine-readable JSON
`;
}

function parseArgs(argv) {
  const args = [];
  const options = {
    controller: DEFAULT_CONTROLLER,
    url: DEFAULT_TEST_URL,
    timeout: DEFAULT_TIMEOUT,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === '--json') {
      options.json = true;
    } else if (item === '--all') {
      options.all = true;
    } else if (item === '--all-regions') {
      options.allRegions = true;
    } else if (item === '--health') {
      options.health = true;
    } else if (item === '--controller') {
      options.controller = argv[++i];
    } else if (item.startsWith('--controller=')) {
      options.controller = item.slice('--controller='.length);
    } else if (item === '--url') {
      options.url = argv[++i];
    } else if (item.startsWith('--url=')) {
      options.url = item.slice('--url='.length);
    } else if (item === '--timeout') {
      options.timeout = Number(argv[++i]);
    } else if (item.startsWith('--timeout=')) {
      options.timeout = Number(item.slice('--timeout='.length));
    } else if (item === '-h' || item === '--help') {
      options.help = true;
    } else {
      args.push(item);
    }
  }

  if (!Number.isFinite(options.timeout) || options.timeout <= 0) {
    throw new Error('--timeout must be a positive number');
  }

  return { command: args[0] ?? 'status', args: args.slice(1), options };
}

function flClashDir() {
  return path.join(os.homedir(), 'Library', 'Application Support', 'com.follow.clash');
}

function readCurrentConfig() {
  const configPath = path.join(flClashDir(), 'config.json');
  if (!fs.existsSync(configPath)) return null;
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function listProfileFiles() {
  const profilesDir = path.join(flClashDir(), 'profiles');
  if (!fs.existsSync(profilesDir)) return [];
  return fs.readdirSync(profilesDir)
    .filter((name) => name.endsWith('.yaml') || name.endsWith('.yml'))
    .sort()
    .map((name, index) => ({ index: index + 1, name, path: path.join(profilesDir, name) }));
}

function kimiRulesFile() {
  return path.join(flClashDir(), 'rules', 'kimi-direct.yaml');
}

function ensureKimiRulesFile() {
  const filePath = kimiRulesFile();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, [
      '# Kimi (Moonshot AI) Direct Rules',
      'payload:',
      ...KIMI_DIRECT_RULES.map((rule) => `  - ${rule}`),
      '',
    ].join('\n'));
  }
  return filePath;
}

function ruleDomain(rule) {
  return rule.split(',')[1];
}

function hasAllKimiRules(content) {
  return KIMI_DIRECT_RULES.every((rule) => content.includes(ruleDomain(rule)));
}

function kimiRulesHealth(content) {
  const lines = content.split('\n');
  const validation = validateRuleIndent(lines);
  if (!validation.ok) return validation;

  const matchIndex = findLastMatchRuleIndex(lines);
  if (matchIndex === -1) return { ok: false, error: 'No MATCH rule found' };
  const matchIndent = lines[matchIndex].match(/^\s*/)?.[0] ?? '';

  for (const rule of KIMI_DIRECT_RULES) {
    const domain = ruleDomain(rule);
    const ruleIndex = lines.findIndex((line) => line.includes(domain) && line.includes('DIRECT'));
    if (ruleIndex === -1) return { ok: false, error: `Missing ${domain}` };
    if (ruleIndex > matchIndex) return { ok: false, error: `${domain} appears after MATCH` };
    const indent = lines[ruleIndex].match(/^\s*/)?.[0] ?? '';
    if (indent !== matchIndent) return { ok: false, error: `${domain} indent does not match MATCH rule` };
  }

  return { ok: true };
}

function isKimiManagedLine(line) {
  const lower = line.toLowerCase();
  return lower.includes('kimi') || lower.includes('moonshot');
}

function removeKimiRuleLines(lines) {
  const result = [];
  let inManagedBlock = false;

  for (const line of lines) {
    if (line.includes('Kimi (Moonshot AI) Direct Rules') || line.includes('Kimi Direct Rules')) {
      inManagedBlock = true;
      continue;
    }
    if (inManagedBlock && line.includes(KIMI_RULE_MARKER_END)) {
      inManagedBlock = false;
      continue;
    }
    if (inManagedBlock) continue;
    if (isKimiManagedLine(line)) continue;
    result.push(line);
  }

  return result;
}

function findLastMatchRuleIndex(lines) {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/^\s*-\s*'?MATCH,/.test(lines[i])) return i;
  }
  return -1;
}

function validateRuleIndent(lines) {
  let inRules = false;
  let ruleIndent = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed === 'rules:') {
      inRules = true;
      ruleIndent = null;
      continue;
    }

    if (!inRules) continue;
    if (!/^\s/.test(line)) {
      inRules = false;
      ruleIndent = null;
      continue;
    }

    if (trimmed.startsWith('- ')) {
      const indent = line.length - line.trimStart().length;
      if (ruleIndent === null) {
        ruleIndent = indent;
      } else if (indent !== ruleIndent) {
        return { ok: false, error: `line ${i + 1} rule indent ${indent}, expected ${ruleIndent}` };
      }
    }
  }

  return { ok: true };
}

function timestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function patchKimiRulesInProfile(profilePath) {
  const original = fs.readFileSync(profilePath, 'utf8');
  if (kimiRulesHealth(original).ok) {
    return { profilePath, changed: false, status: 'ok', message: 'Kimi rules present' };
  }

  const originalLines = original.split('\n');
  const cleanedLines = removeKimiRuleLines(originalLines);
  const matchIndex = findLastMatchRuleIndex(cleanedLines);
  if (matchIndex === -1) {
    return { profilePath, changed: false, status: 'skipped', message: 'No MATCH rule found' };
  }

  const indent = cleanedLines[matchIndex].match(/^\s*/)?.[0] ?? '';
  const managedBlock = [
    `${indent}# === ${KIMI_RULE_MARKER_START} ===`,
    ...KIMI_DIRECT_RULES.map((rule) => `${indent}- '${rule}'`),
    `${indent}# === ${KIMI_RULE_MARKER_END} ===`,
    '',
  ];
  const nextLines = [
    ...cleanedLines.slice(0, matchIndex),
    ...managedBlock,
    ...cleanedLines.slice(matchIndex),
  ];
  const validation = validateRuleIndent(nextLines);
  if (!validation.ok) {
    return { profilePath, changed: false, status: 'error', message: validation.error };
  }

  const backupPath = `${profilePath}.bak-${timestamp()}`;
  const tempPath = `${profilePath}.tmp`;
  fs.copyFileSync(profilePath, backupPath);
  fs.writeFileSync(tempPath, nextLines.join('\n'));
  fs.renameSync(tempPath, profilePath);

  return {
    profilePath,
    changed: true,
    status: 'patched',
    message: `Inserted Kimi rules before MATCH at line ${matchIndex + 1}`,
    backupPath,
  };
}

function guardKimiRules() {
  const profiles = listProfileFiles();
  ensureKimiRulesFile();
  return profiles.map((profile) => patchKimiRulesInProfile(profile.path));
}

function detectWesternCountry(name) {
  for (const [country, pattern] of WESTERN_REGION_PATTERNS) {
    if (pattern.test(name)) return country;
  }
  return '';
}

function isWesternNode(name) {
  return detectWesternCountry(name) !== '';
}

function sanitizeConfigSummary(config) {
  if (!config) return null;
  return {
    mixedPort: config['mixed-port'],
    mode: config.mode,
    externalController: config['external-controller'] || '',
    allowLan: config['allow-lan'] === true,
    proxyCount: Array.isArray(config.proxies) ? config.proxies.length : 0,
    groupCount: Array.isArray(config['proxy-groups']) ? config['proxy-groups'].length : 0,
  };
}

async function request(controller, route, init = {}) {
  const base = controller.replace(/\/+$/, '');
  const response = await fetch(`${base}${route}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status} ${route}${text ? `: ${text}` : ''}`);
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function controllerStatus(controller) {
  try {
    const version = await request(controller, '/version');
    return { ok: true, version };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function getProxyGroups(controller) {
  const data = await request(controller, '/proxies');
  const proxies = data?.proxies ?? {};
  return Object.values(proxies)
    .filter((proxy) => GROUP_TYPES.has(proxy.type) && Array.isArray(proxy.all))
    .map((group, index) => ({
      index: index + 1,
      name: group.name,
      type: group.type,
      now: group.now ?? '',
      count: group.all.length,
      all: group.all,
    }));
}

function chooseByIndexOrName(items, value, label) {
  if (!value) throw new Error(`Missing ${label}`);
  const index = Number(value);
  if (Number.isInteger(index) && index >= 1 && index <= items.length) {
    return items[index - 1];
  }
  const found = items.find((item) => item.name === value);
  if (!found) throw new Error(`Unknown ${label}: ${value}`);
  return found;
}

function nodesForGroup(group) {
  return group.all.map((name, index) => ({
    index: index + 1,
    name,
    country: detectWesternCountry(name),
    selected: name === group.now,
  }));
}

function filterNodes(nodes, options) {
  const filtered = options.allRegions ? nodes : nodes.filter((node) => isWesternNode(node.name));
  return filtered.map((node, index) => ({ ...node, index: index + 1 }));
}

async function delayNode(controller, nodeName, options) {
  const route = `/proxies/${encodeURIComponent(nodeName)}/delay?timeout=${options.timeout}&url=${encodeURIComponent(options.url)}`;
  try {
    const data = await request(controller, route);
    return { name: nodeName, delay: data?.delay ?? -1 };
  } catch (error) {
    return { name: nodeName, delay: -1, error: error.message };
  }
}

function formatDelay(delay) {
  return delay >= 0 ? `【${delay}ms】` : '【超时】';
}

async function delayNodes(controller, nodes, options) {
  const rows = [];
  for (const node of nodes) {
    const result = await delayNode(controller, node.name, options);
    rows.push({ ...node, delay: result.delay, error: result.error });
  }
  return rows;
}

function startFlClash() {
  execFileSync('open', ['-a', 'FlClash'], { stdio: 'ignore' });
}

function restartFlClash() {
  try {
    execFileSync('osascript', ['-e', 'tell application "FlClash" to quit'], { stdio: 'ignore' });
  } catch {
    // The app may already be closed. Opening it below is still the desired state.
  }
  execFileSync('open', ['-a', 'FlClash'], { stdio: 'ignore' });
}

function printTable(rows, columns) {
  const widths = columns.map((column) => Math.max(
    column.header.length,
    ...rows.map((row) => String(column.value(row)).length),
  ));
  console.log(columns.map((column, i) => column.header.padEnd(widths[i])).join('  '));
  console.log(widths.map((width) => '-'.repeat(width)).join('  '));
  for (const row of rows) {
    console.log(columns.map((column, i) => String(column.value(row)).padEnd(widths[i])).join('  '));
  }
}

function printJsonOrTable(data, options, columns) {
  if (options.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (!Array.isArray(data)) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }
  if (data.length === 0) {
    console.log('(empty)');
    return;
  }
  printTable(data, columns);
}

function offlineControllerMessage() {
  return [
    'FlClash external-controller is not reachable at 127.0.0.1:9090.',
    'Open FlClash -> Settings/General -> ExternalController, enable it, then apply/reload the current profile.',
    'After that, rerun: bun run flclash groups',
  ].join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const { command, args, options } = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return;
  }

  if (command === 'start') {
    startFlClash();
    console.log('FlClash start requested.');
    return;
  }

  if (command === 'restart') {
    restartFlClash();
    console.log('FlClash restart requested.');
    return;
  }

  if (command === 'profiles' || command === 'airports') {
    const profiles = listProfileFiles();
    printJsonOrTable(profiles, options, [
      { header: '#', value: (row) => row.index },
      { header: '机场配置', value: (row) => row.name },
    ]);
    return;
  }

  if (command === 'status') {
    const config = sanitizeConfigSummary(readCurrentConfig());
    const controller = await controllerStatus(options.controller);
    const status = { dataDir: flClashDir(), config, controller };
    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    console.log(`dataDir: ${status.dataDir}`);
    console.log(`controller: ${controller.ok ? 'reachable' : 'offline'}`);
    if (controller.ok) {
      console.log(`version: ${JSON.stringify(controller.version)}`);
    } else {
      console.log(`reason: ${controller.error}`);
    }
    if (config) {
      console.log(`current config: ${config.proxyCount} proxies, ${config.groupCount} groups, external-controller=${config.externalController || '(disabled)'}`);
    }
    return;
  }

  if (command === 'guard') {
    const results = guardKimiRules();
    const controller = options.health ? await controllerStatus(options.controller) : null;
    const config = options.health ? sanitizeConfigSummary(readCurrentConfig()) : null;
    const status = { rulesFile: kimiRulesFile(), profiles: results, controller, config };
    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    // Silent unless there is something actionable to report
    const problems = results.filter((r) => r.status !== 'ok');
    const controllerOffline = controller && !controller.ok;
    if (problems.length === 0 && !controllerOffline) {
      return; // nothing to say — cron stays silent
    }
    console.log(`rulesFile: ${status.rulesFile}`);
    if (options.health) {
      console.log(`controller: ${controller.ok ? 'reachable' : 'offline'}`);
      if (config) {
        console.log(`current config: ${config.proxyCount} proxies, ${config.groupCount} groups, external-controller=${config.externalController || '(disabled)'}`);
      }
    }
    for (const result of results) {
      const marker = result.status === 'patched' ? 'FIXED' : result.status.toUpperCase();
      const name = path.basename(result.profilePath);
      console.log(`${marker}: ${name} - ${result.message}`);
      if (result.backupPath) console.log(`backup: ${result.backupPath}`);
    }
    return;
  }

  if (['groups', 'nodes', 'delay', 'select', 'airport'].includes(command)) {
    const controller = await controllerStatus(options.controller);
    if (!controller.ok) {
      throw new Error(offlineControllerMessage());
    }
  }

  if (command === 'airport') {
    const profiles = listProfileFiles();
    const profile = chooseByIndexOrName(profiles, args[0], 'airport');
    await request(options.controller, '/configs?force=true', {
      method: 'PUT',
      body: JSON.stringify({ path: profile.path }),
    });
    console.log(`airport selected: ${profile.index}. ${profile.name}`);
    return;
  }

  if (command === 'groups') {
    const groups = await getProxyGroups(options.controller);
    printJsonOrTable(groups.map(({ all, ...group }) => group), options, [
      { header: '#', value: (row) => row.index },
      { header: 'group', value: (row) => row.name },
      { header: 'type', value: (row) => row.type },
      { header: 'selected', value: (row) => row.now || '-' },
      { header: 'nodes', value: (row) => row.count },
    ]);
    return;
  }

  const groups = await getProxyGroups(options.controller);
  const group = chooseByIndexOrName(groups, args[0], 'group');
  const nodes = filterNodes(nodesForGroup(group), options);

  if (command === 'nodes') {
    const rows = await delayNodes(options.controller, nodes, options);
    printJsonOrTable(rows, options, [
      { header: '#', value: (row) => row.index },
      { header: '当前', value: (row) => (row.selected ? '*' : '') },
      { header: '国家/节点', value: (row) => `${row.country || '未知'} ${row.name}` },
      { header: '速度', value: (row) => formatDelay(row.delay) },
    ]);
    return;
  }

  if (command === 'delay') {
    const targets = options.all
      ? nodes
      : [chooseByIndexOrName(nodes, args[1] ?? String(nodes.find((node) => node.selected)?.index ?? 1), 'node')];
    const results = await delayNodes(options.controller, targets, options);
    printJsonOrTable(results, options, [
      { header: '#', value: (row) => row.index },
      { header: '国家/节点', value: (row) => `${row.country || '未知'} ${row.name}` },
      { header: '速度', value: (row) => formatDelay(row.delay) },
    ]);
    return;
  }

  if (command === 'select') {
    const node = chooseByIndexOrName(nodes, args[1], 'node');
    await request(options.controller, `/proxies/${encodeURIComponent(group.name)}`, {
      method: 'PUT',
      body: JSON.stringify({ name: node.name }),
    });
    console.log(`selected: ${group.name} -> ${node.name}`);
    return;
  }

  throw new Error(`Unknown command: ${command}\n${usage()}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

export {
  chooseByIndexOrName,
  detectWesternCountry,
  filterNodes,
  formatDelay,
  guardKimiRules,
  hasAllKimiRules,
  isWesternNode,
  kimiRulesHealth,
  nodesForGroup,
  patchKimiRulesInProfile,
  parseArgs,
  sanitizeConfigSummary,
  validateRuleIndent,
};
