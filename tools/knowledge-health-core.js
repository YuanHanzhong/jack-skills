import { createHash } from 'crypto';
import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, basename } from 'path';
import { glob } from 'glob';
import matter from 'gray-matter';

const LAYER_DIRS = {
  ods: '01_ODS',
  dwd: '02_DWD',
  dws: '03_DWS',
  ads: '04_ADS',
};

const ADS_STATES = ['1_收集', '2_进行中', '3_已完成'];
const ADS_TYPES = ['task_plan', 'findings', 'progress'];

function normalizePath(path) {
  return path.replace(/\\/g, '/');
}

function rel(rootDir, filePath) {
  return normalizePath(relative(rootDir, filePath));
}

async function markdownFiles(rootDir, layer) {
  const dir = join(rootDir, layer);
  if (!existsSync(dir)) return [];
  return (await glob(join(dir, '**', '*.md'), {
    ignore: ['**/node_modules/**', '**/INDEX.md'],
    windowsPathsNoEscape: true,
  })).sort();
}

async function knowledgePageFiles(rootDir) {
  const files = [
    ...(await markdownFiles(rootDir, LAYER_DIRS.dwd)),
    ...(await markdownFiles(rootDir, LAYER_DIRS.dws)),
  ];
  return files.filter((file) => {
    const path = rel(rootDir, file);
    const name = basename(file);
    if (name === 'README.md' || name === 'INDEX.md') return false;
    if (path.startsWith('03_DWS/sessions/')) return false;
    if (path.startsWith('03_DWS/insights/')) return false;
    return true;
  });
}

async function structuredPageFiles(rootDir) {
  const files = [
    ...(await markdownFiles(rootDir, LAYER_DIRS.dwd)),
    ...(await markdownFiles(rootDir, LAYER_DIRS.dws)),
    ...(await markdownFiles(rootDir, LAYER_DIRS.ads)),
  ];
  return files.filter((file) => {
    const name = basename(file);
    return name !== 'README.md' && name !== 'INDEX.md';
  });
}

function parseMarkdown(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = matter(raw);
  return {
    raw,
    data: parsed.data || {},
    content: parsed.content || '',
  };
}

function bodySha256(content) {
  return createHash('sha256').update(content.trimStart(), 'utf-8').digest('hex');
}

function asArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [value];
}

function normalizeText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase();
}

function relationTargets(value) {
  return asArray(value)
    .flatMap((item) => {
      if (!item) return [];
      if (typeof item === 'string') return [item];
      if (typeof item === 'object' && item.target) return [item.target];
      return [];
    })
    .map(String)
    .filter(Boolean);
}

function extractSection(content, headingPattern) {
  const lines = content.split('\n');
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start === -1) return null;
  const collected = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) break;
    collected.push(lines[index]);
  }
  return collected.join('\n');
}

function titleFor(filePath, parsed) {
  const fmTitle = parsed.data.title || parsed.data.标题;
  if (fmTitle) return String(fmTitle);
  const heading = parsed.content.match(/^#\s+(.+)$/m);
  return heading ? heading[1].trim() : basename(filePath, '.md');
}

function pageKey(filePath) {
  return basename(filePath, '.md').toLowerCase();
}

function extractWikiLinks(content) {
  const withoutFences = content.replace(/```[\s\S]*?```/g, '');
  const links = [];
  const pattern = /\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g;
  let match;
  while ((match = pattern.exec(withoutFences)) !== null) {
    links.push(match[1].trim().split('/').pop().toLowerCase());
  }
  return links.filter(Boolean);
}

async function scanLayerCounts(rootDir) {
  const ods = await markdownFiles(rootDir, LAYER_DIRS.ods);
  const dwd = await markdownFiles(rootDir, LAYER_DIRS.dwd);
  const dws = await markdownFiles(rootDir, LAYER_DIRS.dws);
  const ads = await markdownFiles(rootDir, LAYER_DIRS.ads);

  const byState = Object.fromEntries(ADS_STATES.map((state) => [state, 0]));
  for (const file of ads) {
    const relativePath = rel(rootDir, file);
    const state = ADS_STATES.find((item) => relativePath.includes(`04_ADS/${item}/`));
    if (state) byState[state] += 1;
  }

  return {
    ods: { files: ods.length },
    dwd: { files: dwd.length },
    dws: { files: dws.length },
    ads: { files: ads.length, byState },
  };
}

async function scanOdsHashes(rootDir) {
  const files = await markdownFiles(rootDir, LAYER_DIRS.ods);
  const drifted = [];
  const missing = [];
  let checked = 0;

  for (const file of files) {
    const parsed = parseMarkdown(file);
    const expected = parsed.data.sha256 || parsed.data.source_sha256 || parsed.data['source-hash'];
    if (!expected) {
      missing.push({ path: rel(rootDir, file), title: titleFor(file, parsed) });
      continue;
    }
    checked += 1;
    const actual = bodySha256(parsed.content);
    if (String(expected).trim().toLowerCase() !== actual) {
      drifted.push({
        path: rel(rootDir, file),
        title: titleFor(file, parsed),
        expected: String(expected),
        actual,
      });
    }
  }

  return { checked, missing, drifted };
}

async function scanQuality(rootDir) {
  const files = await knowledgePageFiles(rootDir);
  const lowConfidence = [];
  const missingConfidence = [];
  const contested = [];
  const missingSources = [];

  for (const file of files) {
    const parsed = parseMarkdown(file);
    const item = {
      path: rel(rootDir, file),
      title: titleFor(file, parsed),
    };
    const confidence = parsed.data.confidence;
    if (!confidence) {
      missingConfidence.push(item);
    } else if (String(confidence).toLowerCase() === 'low') {
      lowConfidence.push(item);
    }

    if (parsed.data.contested === true || String(parsed.data.contested).toLowerCase() === 'true') {
      contested.push({
        ...item,
        contradictions: asArray(parsed.data.contradictions).map(String),
      });
    }

    const sources = asArray(parsed.data.sources || parsed.data['关联ODS'] || parsed.data['关联DWD']);
    if (sources.length === 0) {
      missingSources.push(item);
    }
  }

  return { lowConfidence, missingConfidence, contested, missingSources };
}

async function scanLinks(rootDir) {
  const files = await knowledgePageFiles(rootDir);
  const pages = new Map();
  const inbound = new Map();
  const broken = [];

  for (const file of files) {
    const parsed = parseMarkdown(file);
    const key = pageKey(file);
    pages.set(key, {
      key,
      path: rel(rootDir, file),
      title: titleFor(file, parsed),
      outbound: extractWikiLinks(parsed.content),
    });
    inbound.set(key, 0);
  }

  for (const page of pages.values()) {
    for (const target of page.outbound) {
      if (pages.has(target)) {
        inbound.set(target, (inbound.get(target) || 0) + 1);
      } else {
        broken.push({
          from: page.path,
          target,
        });
      }
    }
  }

  const orphans = [];
  for (const page of pages.values()) {
    if (page.outbound.length === 0 && (inbound.get(page.key) || 0) === 0) {
      orphans.push({
        path: page.path,
        title: page.title,
      });
    }
  }

  return { orphans, broken };
}

async function scanSchemas(rootDir, threshold = 5) {
  const files = await knowledgePageFiles(rootDir);
  const dirs = new Map();
  for (const file of files) {
    const dir = dirname(file);
    const relativeDir = rel(rootDir, dir);
    const current = dirs.get(dir) || {
      path: relativeDir,
      pageCount: 0,
      hasSchema: existsSync(join(dir, 'SCHEMA.md')),
    };
    current.pageCount += 1;
    dirs.set(dir, current);
  }

  const missing = [...dirs.values()]
    .filter((dir) => dir.pageCount >= threshold && !dir.hasSchema)
    .sort((a, b) => b.pageCount - a.pageCount || a.path.localeCompare(b.path));

  const present = [...dirs.values()]
    .filter((dir) => dir.hasSchema)
    .sort((a, b) => a.path.localeCompare(b.path));

  return { threshold, missing, present };
}

async function scanStructure(rootDir) {
  const files = await structuredPageFiles(rootDir);
  const missingCurrentConclusion = [];
  const missingTimeline = [];
  const invalidTimeline = [];

  for (const file of files) {
    const parsed = parseMarkdown(file);
    const item = { path: rel(rootDir, file), title: titleFor(file, parsed) };

    if (!/^##\s+.*当前结论/m.test(parsed.content)) {
      missingCurrentConclusion.push(item);
    }

    const timelineSection = extractSection(parsed.content, /^##\s+.*(?:精确时间线|时间线)/);
    if (timelineSection === null) {
      missingTimeline.push(item);
      continue;
    }

    const lines = timelineSection
      .split('\n')
      .filter((line) => /^\s*[-*]\s+/.test(line));
    const badLines = lines.filter((line) => !/^\s*[-*]\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}[：:]/.test(line));
    if (badLines.length > 0) {
      invalidTimeline.push({ ...item, lines: badLines });
    }
  }

  return { missingCurrentConclusion, missingTimeline, invalidTimeline };
}

async function scanMetadata(rootDir) {
  const files = await structuredPageFiles(rootDir);
  const missingCanonical = [];
  const aliasIndex = new Map();
  const duplicateAliases = [];
  const brokenRelations = [];

  for (const file of files) {
    const parsed = parseMarkdown(file);
    const item = { path: rel(rootDir, file), title: titleFor(file, parsed) };

    if (!parsed.data.canonical_id && !parsed.data.canonicalId) {
      missingCanonical.push(item);
    }

    for (const alias of asArray(parsed.data.aliases).map(String).filter(Boolean)) {
      const key = normalizeText(alias);
      const current = aliasIndex.get(key) || [];
      current.push(item.path);
      aliasIndex.set(key, current);
    }

    for (const target of relationTargets(parsed.data.relations || parsed.data.links)) {
      const targetPath = join(rootDir, target);
      if (!existsSync(targetPath)) {
        brokenRelations.push({ ...item, target });
      }
    }
  }

  for (const [aliasKey, paths] of aliasIndex.entries()) {
    if (paths.length > 1 && !isAdsTaskGroupAlias(paths)) {
      duplicateAliases.push({ alias: aliasKey, paths });
    }
  }

  return { missingCanonical, duplicateAliases, brokenRelations };
}

function isAdsTaskGroupAlias(paths) {
  if (paths.length < 2 || !paths.every((path) => path.startsWith('04_ADS/'))) {
    return false;
  }
  const groups = new Set();
  for (const path of paths) {
    const name = path.split('/').pop();
    const parsed = parseAdsName(name || '') || parseLegacyAdsName(name || '');
    if (!parsed) return false;
    groups.add(`${parsed.date}|${parsed.mode}|${parsed.slug}`);
  }
  return groups.size === 1;
}

function parseLegacyAdsName(name) {
  const match = name.match(/^(\d{2}-\d{4}-\d{2})-(task_plan|findings|progress)-(.+)\.md$/);
  if (!match) return null;
  return {
    date: match[1],
    mode: 'legacy',
    type: match[2],
    slug: match[3],
  };
}

async function scanEvidence(rootDir) {
  const files = await structuredPageFiles(rootDir);
  const missingSection = [];
  const brokenRefs = [];

  for (const file of files) {
    const parsed = parseMarkdown(file);
    const item = { path: rel(rootDir, file), title: titleFor(file, parsed) };
    const section = extractSection(parsed.content, /^##\s+.*原始证据/);
    if (section === null) {
      missingSection.push(item);
      continue;
    }

    const pattern = /`((?:00_DIM|01_ODS|02_DWD|03_DWS|04_ADS)\/[^`]+)`/g;
    let match;
    while ((match = pattern.exec(section)) !== null) {
      const target = match[1];
      if (!existsSync(join(rootDir, target)) && !adsMovedEvidenceExists(rootDir, target)) {
        brokenRefs.push({ ...item, target });
      }
    }
  }

  return { missingSection, brokenRefs };
}

function adsMovedEvidenceExists(rootDir, target) {
  const match = target.match(/^04_ADS\/(?:1_收集|2_进行中|3_已完成)\/([^/]+\.md)$/);
  if (!match) return false;
  return ['1_收集', '2_进行中', '3_已完成'].some((state) => (
    existsSync(join(rootDir, '04_ADS', state, match[1]))
  ));
}

function parseAdsName(name) {
  const match = name.match(/^(\d{2}-\d{4}-\d{2})-(chat|learn|plan|exec|review)-(task_plan|findings|progress)-(.+)\.md$/);
  if (!match) return null;
  return {
    key: `${match[1]}-${match[2]}-${match[4]}`,
    type: match[3],
    title: match[4],
  };
}

async function scanAdsGroups(rootDir) {
  const files = await markdownFiles(rootDir, LAYER_DIRS.ads);
  const groups = new Map();

  for (const file of files) {
    const name = basename(file);
    if (name === 'README.md' || name === 'INDEX.md') continue;
    const parsedName = parseAdsName(name);
    if (!parsedName) continue;
    const state = ADS_STATES.find((item) => rel(rootDir, file).includes(`04_ADS/${item}/`));
    const current = groups.get(parsedName.key) || {
      key: parsedName.key,
      title: parsedName.title,
      state,
      files: [],
      types: new Set(),
    };
    current.files.push(rel(rootDir, file));
    current.types.add(parsedName.type);
    groups.set(parsedName.key, current);
  }

  const dwsContent = (await markdownFiles(rootDir, LAYER_DIRS.dws))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
  const incomplete = [];
  const completedWithoutDws = [];

  for (const group of groups.values()) {
    const missingTypes = ADS_TYPES.filter((type) => !group.types.has(type));
    if (missingTypes.length > 0) {
      incomplete.push({
        key: group.key,
        state: group.state,
        files: group.files,
        missingTypes,
      });
    }

    if (group.state === '3_已完成' && !dwsContent.includes(group.title)) {
      completedWithoutDws.push({
        key: group.key,
        title: group.title,
        files: group.files,
      });
    }
  }

  return { incomplete, completedWithoutDws };
}

async function scanDirectionLinks(rootDir) {
  const directionDir = join(rootDir, '00_方向盘');
  const files = [
    {
      name: '02_当前任务.md',
      taskHeadings: ['进行中', '收集', '待办', '下一步', '已完成', '完成'],
    },
    {
      name: '05_下一步.md',
      taskHeadings: ['下一步', '进行中', '已完成'],
      rootListIsTask: true,
    },
  ];
  const missingAdsLinks = [];

  for (const config of files) {
    const name = config.name;
    const path = join(directionDir, name);
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, 'utf8').split('\n');
    let inTaskSection = Boolean(config.rootListIsTask);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const heading = line.match(/^##\s+(.+?)\s*$/);
      if (heading) {
        inTaskSection = config.taskHeadings.some((keyword) => heading[1].includes(keyword));
        continue;
      }
      if (!inTaskSection) continue;
      if (!/^\s*(?:[-*+]\s+|\d+\.\s+)/.test(line)) continue;
      if (/ADS：/.test(line)) continue;

      let hasLink = false;
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        const next = lines[cursor];
        if (/^\s+-\s+ADS：`/.test(next)) {
          hasLink = true;
          break;
        }
        if (/^\S/.test(next) && /^(?:[-*+]\s+|\d+\.\s+|#{1,6}\s+)/.test(next)) break;
      }

      if (!hasLink) {
        missingAdsLinks.push({
          path: `00_方向盘/${name}`,
          line: index + 1,
          text: line.trim(),
        });
      }
    }
  }

  return { missingAdsLinks };
}

async function latestMarkdownUpdate(rootDir) {
  const files = [
    ...(await markdownFiles(rootDir, LAYER_DIRS.ods)),
    ...(await markdownFiles(rootDir, LAYER_DIRS.dwd)),
    ...(await markdownFiles(rootDir, LAYER_DIRS.dws)),
    ...(await markdownFiles(rootDir, LAYER_DIRS.ads)),
  ];
  let latest = null;
  for (const file of files) {
    try {
      const mtime = statSync(file).mtime;
      if (!latest || mtime > latest) latest = mtime;
    } catch {
      // Ignore unreadable paths; the detailed checks will surface readable files.
    }
  }
  return latest ? latest.toISOString() : null;
}

export async function analyzeKnowledgeHealth({ rootDir = process.cwd() } = {}) {
  return {
    generatedAt: new Date().toISOString(),
    rootDir,
    layers: await scanLayerCounts(rootDir),
    lastUpdated: await latestMarkdownUpdate(rootDir),
    odsHash: await scanOdsHashes(rootDir),
    quality: await scanQuality(rootDir),
    links: await scanLinks(rootDir),
    schemas: await scanSchemas(rootDir),
    structure: await scanStructure(rootDir),
    metadata: await scanMetadata(rootDir),
    evidence: await scanEvidence(rootDir),
    adsGroups: await scanAdsGroups(rootDir),
    direction: await scanDirectionLinks(rootDir),
  };
}

function listItems(items, formatter = (item) => `- ${item.path}`) {
  if (!items.length) return '- 无\n';
  return items.map(formatter).join('\n') + '\n';
}

export function formatKnowledgeHealthReport(report) {
  const { layers, odsHash, quality, links } = report;
  return [
    '# 知识健康检查',
    '',
    `> 生成时间：${report.generatedAt}`,
    `> 最近 Markdown 更新时间：${report.lastUpdated || '暂无'}`,
    '',
    '## 层级统计',
    '',
    `- ODS 原始资料：${layers.ods.files}`,
    `- DWD 明细分析：${layers.dwd.files}`,
    `- DWS 主题沉淀：${layers.dws.files}`,
    `- ADS 应用任务：${layers.ads.files}`,
    `  - 收集：${layers.ads.byState['1_收集'] || 0}`,
    `  - 进行中：${layers.ads.byState['2_进行中'] || 0}`,
    `  - 已完成：${layers.ads.byState['3_已完成'] || 0}`,
    '',
    '## ODS Hash 审计',
    '',
    `- 已校验：${odsHash.checked}`,
    `- 缺少 sha256：${odsHash.missing.length}`,
    `- Hash 漂移：${odsHash.drifted.length}`,
    listItems(odsHash.drifted, (item) => `- ${item.path}（expected=${item.expected} actual=${item.actual}）`).trimEnd(),
    '',
    '## 质量信号',
    '',
    `- 低置信度：${quality.lowConfidence.length}`,
    listItems(quality.lowConfidence).trimEnd(),
    `- 争议页面：${quality.contested.length}`,
    listItems(quality.contested, (item) => `- ${item.path}${item.contradictions.length ? `（矛盾：${item.contradictions.join(', ')}）` : ''}`).trimEnd(),
    `- 缺少 confidence：${quality.missingConfidence.length}`,
    `- 缺少 sources/关联来源：${quality.missingSources.length}`,
    '',
    '## 链接健康',
    '',
    `- 孤岛页面：${links.orphans.length}`,
    listItems(links.orphans).trimEnd(),
    `- 断裂 wikilink：${links.broken.length}`,
    listItems(links.broken, (item) => `- ${item.from} -> [[${item.target}]]`).trimEnd(),
    '',
    '## 主题 Schema',
    '',
    `- 阈值：同一 DWD/DWS 主题目录达到 ${report.schemas.threshold} 个页面`,
    `- 已有 SCHEMA：${report.schemas.present.length}`,
    `- 缺少 SCHEMA：${report.schemas.missing.length}`,
    listItems(report.schemas.missing, (item) => `- ${item.path}（${item.pageCount} 页）`).trimEnd(),
    '',
    '## gbrain 借鉴机制巡检',
    '',
    `- 缺少当前结论：${report.structure.missingCurrentConclusion.length}`,
    `- 缺少精确时间线：${report.structure.missingTimeline.length}`,
    `- 时间线未精确到分钟：${report.structure.invalidTimeline.length}`,
    listItems(report.structure.invalidTimeline, (item) => `- ${item.path}：${item.lines.join(' / ')}`).trimEnd(),
    `- 缺少 canonical_id：${report.metadata.missingCanonical.length}`,
    `- 重复 aliases：${report.metadata.duplicateAliases.length}`,
    listItems(report.metadata.duplicateAliases, (item) => `- ${item.alias}：${item.paths.join(', ')}`).trimEnd(),
    `- 断裂 relations：${report.metadata.brokenRelations.length}`,
    listItems(report.metadata.brokenRelations, (item) => `- ${item.path} -> ${item.target}`).trimEnd(),
    `- 原始证据断链：${report.evidence.brokenRefs.length}`,
    listItems(report.evidence.brokenRefs, (item) => `- ${item.path} -> ${item.target}`).trimEnd(),
    `- ADS 三件套不完整：${report.adsGroups.incomplete.length}`,
    listItems(report.adsGroups.incomplete, (item) => `- ${item.key} 缺少 ${item.missingTypes.join(', ')}`).trimEnd(),
    `- 已完成 ADS 缺 DWS 沉淀：${report.adsGroups.completedWithoutDws.length}`,
    `- 方向盘任务缺 ADS 链接：${report.direction.missingAdsLinks.length}`,
    listItems(report.direction.missingAdsLinks, (item) => `- ${item.path}:${item.line} ${item.text}`).trimEnd(),
    '',
  ].join('\n');
}
