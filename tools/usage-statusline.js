#!/usr/bin/env bun
// Usage StatusLine — 独立脚本，显示 Claude 5h/7d 用量百分比 + 重置时间
// 零依赖，Bun 运行（Node.js 的 TLS 在 macOS 上有证书链问题）

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
const HOME = homedir();
const PROJECT_ROOT = process.env.CLAUDE_PROJECT_ROOT || join(HOME, '1_learn');
const CACHE_PATH = join(HOME, '.claude', '.usage-cache.json');
const CREDS_PATH = join(HOME, '.claude', '.credentials.json');
const SUCCESS_TTL = 300_000; // 5min（减少 API 调用频率，从 60s → 5min）
const FAILURE_TTL = 120_000; // 2min（失败后等更久再重试，避免频繁超时）
const LOCK_TTL    = 10_000;  // 10s 乐观锁，防止多窗口并发 fetch
const API_TIMEOUT = 2_000;   // 2s（从 5s 降到 2s，网络慢时快速失败）

// ── stdin：Claude Code 通过 stdin 传入 JSON，必须读完才能正常退出 ──
let stdinBuf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { stdinBuf += d; });
process.stdin.on('end', () => main());
process.stdin.resume();

// ── 马卡龙色系（256色 ANSI）──
const COLORS = {
  mint:  { bg: '\x1b[48;5;158m', fg: '\x1b[38;5;22m' },   // 0-49%  薄荷绿
  cream: { bg: '\x1b[48;5;229m', fg: '\x1b[38;5;94m' },   // 50-74% 奶油黄
  peach: { bg: '\x1b[48;5;217m', fg: '\x1b[38;5;52m' },   // 75-89% 蜜桃粉
  berry: { bg: '\x1b[48;5;210m', fg: '\x1b[38;5;52m' },   // 90%+   莓果红
};
const RESET = '\x1b[0m';

// ── 模型标识色（深色马卡龙背景 + 白字）──
const MODEL_COLORS = {
  opus:   { bg: '\x1b[48;5;97m',  fg: '\x1b[38;5;255m' }, // 深薰衣草紫
  sonnet: { bg: '\x1b[48;5;30m',  fg: '\x1b[38;5;255m' }, // 深青碧色
  haiku:  { bg: '\x1b[48;5;132m', fg: '\x1b[38;5;255m' }, // 深玫瑰粉
};

function pickColor(pct) {
  if (pct < 50) return COLORS.mint;
  if (pct < 75) return COLORS.cream;
  if (pct < 90) return COLORS.peach;
  return COLORS.berry;
}

// 上下文窗口用量阈值比用量更激进（满了就压缩/截断）
function pickCtxColor(pct) {
  if (pct < 50) return COLORS.mint;
  if (pct < 70) return COLORS.cream;
  if (pct < 85) return COLORS.peach;
  return COLORS.berry;
}

// ── 解析 stdin 中的 token 总量和版本 ──
function parseTokensAndVersion(stdinBuf) {
  try {
    const data = JSON.parse(stdinBuf);
    const totalTokens = (data?.context_window?.total_input_tokens ?? 0) +
                        (data?.context_window?.total_output_tokens ?? 0);
    const version = data?.version ?? null;
    return { totalTokens, version };
  } catch {}
  return { totalTokens: 0, version: null };
}

// ── 格式化 token+版本段 ──
function formatTokensVersionSegment(totalTokens, version) {
  const dim = '\x1b[2m';
  const reset = RESET;
  const parts = [];
  if (totalTokens > 0) parts.push(`${totalTokens.toLocaleString()} tokens`);
  if (version) parts.push(`v${version}`);
  if (parts.length === 0) return null;
  return `${dim}${parts.join('  ')}${reset}`;
}

// ── 解析 stdin 中的模型标识 ──
function parseModel(stdinBuf) {
  try {
    const data = JSON.parse(stdinBuf);
    const model = (data?.model?.id || '').toLowerCase();  // model 是对象 {id, display_name}
    if (model.includes('opus'))   return 'opus';
    if (model.includes('sonnet')) return 'sonnet';
    if (model.includes('haiku'))  return 'haiku';
  } catch {}
  return null;
}

// ── 格式化模型段 ──
function formatModelSegment(model) {
  if (!model) return null;
  const c = MODEL_COLORS[model] ?? MODEL_COLORS.sonnet;
  return `${c.bg}${c.fg} ${model} ${RESET}`;
}

// ── 解析 stdin 中的上下文窗口数据 ──
function parseCtxWindow(stdinBuf) {
  try {
    const data = JSON.parse(stdinBuf);
    const used = data?.context_window?.used_percentage;
    if (used != null && typeof used === 'number') {
      return Math.round(Math.max(0, Math.min(100, used)));
    }
  } catch {}
  return null;
}

// ── 格式化上下文窗口段 ──
function formatCtxSegment(pct) {
  if (pct == null) return null;
  const c = pickCtxColor(pct);
  return `${c.bg}${c.fg} ${pct}%(context) ${RESET}`;
}

// ── 时间格式化：剩余时间 → "2h-30m" / "6d-22h" ──
function formatRemaining(resetAt, totalLabel) {
  if (!resetAt) return totalLabel;
  const ms = new Date(resetAt).getTime() - Date.now();
  if (ms <= 0) return '0m';
  const mins = Math.floor(ms / 60_000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d-${hours % 24}h`;
  if (hours > 0) return `${hours}h-${mins % 60}m`;
  return `${mins}m`;
}

// ── 读 OAuth token ──
function getToken() {
  // 从文件读取（Windows 无 Keychain）
  try {
    const raw = readFileSync(CREDS_PATH, 'utf8');
    const creds = JSON.parse(raw);
    const oauth = creds?.claudeAiOauth;
    if (!oauth?.accessToken) return null;
    if (oauth.expiresAt && oauth.expiresAt <= Date.now()) return null;
    const sub = oauth.subscriptionType || '';
    if (sub === 'api' || !sub) return null;
    return oauth.accessToken;
  } catch {}

  return null;
}

// ── 读缓存（含乐观锁：另一个窗口正在 fetch 时返回旧数据）──
// 返回 { fresh: data|null, stale: data|null }
//   fresh !== null → 缓存有效，直接用
//   fresh === null → 缓存过期，需要 fetch；stale 保存上次数据供 lock/fallback
function readCache() {
  try {
    const raw = readFileSync(CACHE_PATH, 'utf8');
    const cache = JSON.parse(raw);
    const age = Date.now() - (cache.timestamp || 0);
    // 另一个窗口正在 fetch → 返回旧数据，不重复请求
    if (cache.fetching && age < LOCK_TTL) return { fresh: cache.data ?? null, stale: cache.data };
    const ttl = cache.error ? FAILURE_TTL : SUCCESS_TTL;
    if (age < ttl) return { fresh: cache.data, stale: cache.data };
    // 过期了，但保留旧数据作为 stale fallback
    return { fresh: null, stale: cache.data };
  } catch {}
  return { fresh: null, stale: null };
}

// ── 写锁（fetch 前调用，阻止其他窗口并发请求）──
function writeLock(staleData) {
  try {
    mkdirSync(join(HOME, '.claude'), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify({ data: staleData, fetching: true, timestamp: Date.now() }));
  } catch {}
}

// ── 写缓存 ──
function writeCache(data, error) {
  try {
    mkdirSync(join(HOME, '.claude'), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify({ data, error: !!error, timestamp: Date.now() }));
  } catch {}
}

// ── 调 API（使用内置 fetch，避免 Node.js https 模块的 TLS 证书问题）──
async function fetchUsage(token) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), API_TIMEOUT);
    const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'usage-statusline/1.0',
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── 格式化一段用量 ──
function formatSegment(pct, resetAt, totalLabel) {
  if (pct == null) return null;
  const p = Math.round(Math.max(0, Math.min(100, pct)));
  const remaining = formatRemaining(resetAt, totalLabel);
  const c = pickColor(p);
  return `${c.bg}${c.fg} ${p}%(${remaining}/${totalLabel}) ${RESET}`;
}

// ── 主逻辑 ──
async function main() {
  // 0. 解析 stdin 中的模型和上下文窗口（每次都读，不走缓存）
  const modelName = parseModel(stdinBuf);
  const ctxPct = parseCtxWindow(stdinBuf);
  const { totalTokens, version } = parseTokensAndVersion(stdinBuf);

  // 1. 尝试缓存
  const { fresh, stale } = readCache();
  if (fresh) {
    render(fresh, ctxPct, modelName, totalTokens, version);
    return;
  }

  // 2. 获取 token
  const token = getToken();
  if (!token) {
    render(stale, ctxPct, modelName, totalTokens, version);  // 无 token 也展示旧数据
    return;
  }

  // 3. 写锁（保留旧数据）→ 调 API
  writeLock(stale);
  const resp = await fetchUsage(token);
  if (!resp) {
    writeCache(stale, true);           // 失败时保留旧数据，不写 null
    render(stale, ctxPct, modelName, totalTokens, version);
    return;
  }

  // 4. 解析
  const data = {
    fiveHour: resp.five_hour?.utilization ?? null,
    fiveHourResetAt: resp.five_hour?.resets_at ?? null,
    sevenDay: resp.seven_day?.utilization ?? null,
    sevenDayResetAt: resp.seven_day?.resets_at ?? null,
  };

  writeCache(data, false);
  render(data, ctxPct, modelName, totalTokens, version);
}

// ── 检测终端宽度（窄屏用紧凑格式）──
function getTerminalCols() {
  return process.stdout.columns || parseInt(process.env.COLUMNS) || 80;
}

// ── 紧凑格式（无颜色，短标签，窄屏专用）──
function renderCompact(data, ctxPct, modelName) {
  const parts = [];
  if (modelName) parts.push(modelName[0].toUpperCase()); // S / O / H
  if (ctxPct != null) parts.push(`${ctxPct}%ctx`);
  if (data) {
    if (data.fiveHour != null) parts.push(`${Math.round(data.fiveHour)}%5h`);
    if (data.sevenDay != null) parts.push(`${Math.round(data.sevenDay)}%7d`);
  }
  if (parts.length > 0) console.log(parts.join('|'));
}

function render(data, ctxPct, modelName, totalTokens, version) {
  const cols = getTerminalCols();

  // 窄屏（< 60列）用紧凑无颜色格式，确保一定能显示
  if (cols < 60) {
    renderCompact(data, ctxPct, modelName);
    return;
  }

  const parts = [];

  // 模型标识放第一位
  const sMod = formatModelSegment(modelName);
  if (sMod) parts.push(sMod);

  // 上下文窗口第二位
  const sCtx = formatCtxSegment(ctxPct);
  if (sCtx) parts.push(sCtx);

  // 用量信息
  if (data) {
    const s5 = formatSegment(data.fiveHour, data.fiveHourResetAt, '5h');
    const s7 = formatSegment(data.sevenDay, data.sevenDayResetAt, '7d');
    if (s5) parts.push(s5);
    if (s7) parts.push(s7);
  }

  // token 总量 + 版本（合并为一段，替代 Claude Code 内置的分离显示）
  const sTv = formatTokensVersionSegment(totalTokens, version);
  if (sTv) parts.push(sTv);

  if (parts.length > 0) {
    console.log(parts.join(' | '));
  }
}
