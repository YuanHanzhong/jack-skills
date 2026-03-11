---
name: push-jack-skills-toGithub
description: >-
  将本地 .claude/skills/ 下的最新 skills 同步推送到 GitHub jack-skills 仓库。
  触发：用户说「推送skills」「同步到GitHub」「发布skills」或直接 /push-jack-skills-toGithub。
---

# Push Jack Skills to GitHub

将本地 `.claude/skills/` 和 `~/.claude/tools/` 的内容同步到 `E:/github/jack-skills/` 并推送。
**推送前必须通过安全扫描，发现 HIGH 级别问题时阻断推送。**

## CHANGELOG.md 规范

每个 skill 可选包含 `CHANGELOG.md`，格式如下：

```markdown
# Changelog

## v2.0 (2026-03-11)
- 新增情绪识别触发
- 优化认知突破流程
- 效果：对话深度提升，情绪支持更自然

## v1.0 (2026-03-01)
- 初始版本：基础认知教练
- 效果：支持深挖、陪想、自责信号响应
```

推送前 Claude 应检查本次变更是否需要更新 CHANGELOG.md，提醒用户。

## 执行步骤

### Step 1 — 同步文件（动态发现）

遍历 `skills/` 下所有一级子目录和根文件，只排除黑名单，自动发现新 skill。

```bash
SRC=/e/github/3_simple/.claude/skills
DST=/e/github/jack-skills
EXCLUDE="node_modules|bun.lock|MIGRATION_CHECKPOINT.md"

# 同步所有子目录（自动发现新 skill）
for dir in "$SRC"/*/; do
  name=$(basename "$dir")
  [[ "$name" =~ ^($EXCLUDE)$ ]] && continue
  rm -rf "$DST/$name"
  cp -r "$dir" "$DST/$name"
done

# 同步根文件（package.json, tsconfig.json 等）
for f in "$SRC"/*.json "$SRC"/*.ts; do
  [ -f "$f" ] && cp "$f" "$DST/"
done

# 同步 ~/.claude/tools/ 脚本
TOOLS_SRC=/c/Users/jack/.claude/tools
TOOLS_DST="$DST/tools"
mkdir -p "$TOOLS_DST"
rm -rf "$TOOLS_DST"/*
for f in "$TOOLS_SRC"/*; do
  [ -f "$f" ] && cp "$f" "$TOOLS_DST/"
done
```

保留目标独有文件：不删除 `jack-skills/` 中的 `README.md`, `.gitignore`, `.git/`。

### Step 2 — 版本清单

读取每个已同步 skill 的 `CHANGELOG.md`（如果存在），提取最新版本号和首行摘要，展示清单：

```
══════════════════════════════════════════════════
  📦 Skills 版本清单
══════════════════════════════════════════════════
  [1] _shared              (无版本)
  [2] chat-mode             v2.0  +情绪识别
  [3] learning-engine       v1.2  +面试陪练
  [4] notion-organizer      v1.0  初始版本
  [5] notion-writer         v1.1  +ADS分流
  [6] push-jack-skills-toGithub  v1.0  +安全扫描
  [7] tools/                (脚本工具集)
══════════════════════════════════════════════════
  共 N 个 skills + tools，即将全部推送
  输入编号可排除不推送的 skill（直接回车=全部推送）
```

**操作：**
- 无 CHANGELOG.md 的 skill 显示 `(无版本)`
- 用户输入编号可排除对应 skill（从 `$DST` 中删除该目录）
- 直接回车 = 全部推送

### Step 3 — 安全扫描（Security Gate）

**此步骤为强制门禁，不可跳过。**

对 `jack-skills/` 中所有 `.ts`、`.js` 和 `.md` 文件执行以下扫描（含 `tools/` 子目录）。使用 Grep 工具逐项扫描，汇总结果后判定。

#### 3a. Hardcoded Secrets（HIGH）

检测 API key、token、password、secret 附近的长字符串：

```
pattern: (key|token|secret|password|credential)\s*[:=]\s*['"][A-Za-z0-9_\-/+]{20,}['"]
glob: *.{ts,js}
path: /e/github/jack-skills/
```

检测已知 credential 前缀：

```
pattern: (sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36,}|AKIA[A-Z0-9]{16}|Bearer\s+[A-Za-z0-9\-._~+/]{20,}|Basic\s+[A-Za-z0-9+/=]{20,})
glob: *.{ts,js}
path: /e/github/jack-skills/
```

检测 private key 块：

```
pattern: -----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----
glob: *.{ts,js}
path: /e/github/jack-skills/
```

#### 3b. Dangerous Functions（HIGH）

```
pattern: \b(eval|exec|execSync|Function)\s*\(
glob: *.{ts,js}
path: /e/github/jack-skills/
```

```
pattern: require\s*\(\s*['"]child_process['"]\s*\)
glob: *.{ts,js}
path: /e/github/jack-skills/
```

#### 3c. Unsafe Shell Patterns（HIGH）

检测模板字符串直接拼入 shell 命令（未经 sanitize）：

```
pattern: (exec|execSync|spawn|spawnSync)\s*\(\s*`[^`]*\$\{
glob: *.{ts,js}
path: /e/github/jack-skills/
```

#### 3d. Sensitive Data Leakage（MEDIUM）

```
pattern: (\.env|process\.env\.[A-Z_]{5,})\b
glob: *.{ts,js}
path: /e/github/jack-skills/
```

注意：`process.env` 用于读取环境变量是正常的，只标记直接硬编码 `.env` 文件路径或可疑用法。

#### 3e. OWASP Patterns（MEDIUM）

innerHTML 赋值：

```
pattern: \.innerHTML\s*=
glob: *.{ts,js}
path: /e/github/jack-skills/
```

SQL 字符串拼接：

```
pattern: (SELECT|INSERT|UPDATE|DELETE)\s+.*\+\s*[a-zA-Z]
glob: *.{ts,js}
path: /e/github/jack-skills/
```

### Step 4 — 报告与判定

汇总扫描结果，输出安全报告：

```
══════════════════════════════════════════════════
  🔒 Security Scan Report — jack-skills
══════════════════════════════════════════════════

  HIGH findings:    <count>
  MEDIUM findings:  <count>

  [逐条列出发现，含文件名、行号、匹配内容]

══════════════════════════════════════════════════
```

**判定规则：**
- **HIGH ≥ 1** → ❌ 阻断推送，要求用户修复后重试
- **MEDIUM only** → ⚠️ 警告，展示给用户确认是否继续
- **无发现** → ✅ 安全扫描通过

如果阻断，停止执行后续步骤，告诉用户需要修复哪些问题。

### Step 5 — 显示 diff

安全扫描通过后，展示变更摘要：

```bash
cd /e/github/jack-skills && git status && git diff --stat
```

等用户确认再继续。

### Step 6 — 提交 + Tag + 推送

用户确认后执行：

```bash
cd /e/github/jack-skills && git add -A && git commit -m "<描述变更>"
```

提交后自动打 tag 标记此次推送版本：

```bash
cd /e/github/jack-skills
TAG="skills-v$(date +%Y%m%d)-1"
# 如果同日已有 tag，递增序号
while git tag -l "$TAG" | grep -q .; do
  SEQ=$((${TAG##*-} + 1))
  TAG="skills-v$(date +%Y%m%d)-$SEQ"
done
git tag "$TAG"
git push origin main "$TAG"
```

推送完成后展示 tag 名称，提示回退方式：`git checkout <tag>` 即可回到任意历史版本。

## 注意

- 安全扫描是强制步骤，即使用户催促也不可跳过
- 同步前先展示 diff，等用户确认再 push
- 误报（false positive）由用户判断，MEDIUM 级别可由用户确认后放行
- 每次推送自动打 git tag，便于版本回退
