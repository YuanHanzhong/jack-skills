---
name: push-skills-github
description: >-
  将本地 .claude/ 全套配置（skills、hooks、tools、agents、memory、settings）同步推送到 GitHub jack-skills 仓库，
  并维护一键安装脚本 install.sh，让新环境 clone 后一条命令完成全部配置。
  触发：用户说「推送skills」「同步到GitHub」「发布skills」「推送配置」「安装环境」「初始化环境」或直接 /push-skills-github。
  当用户提到新机器配置、环境迁移、一键安装时也应触发此技能。
allowed-tools: Bash, Grep
---

# Push & Install — jack-skills

本技能有两个职责：
1. **日常推送**：将本地配置全量同步到 GitHub `jack-skills` 仓库
2. **新环境安装**：在新机器上 clone 后一键配置完整开发环境

## 文件清单

```
push-skills-github/
├── SKILL.md        ← 本文件（技能说明）
├── sync.sh         ← 推送时的同步脚本（本地 → jack-skills 仓库）
└── install.sh      ← 新环境一键安装脚本（jack-skills 仓库 → 新机器）
```

## 同步内容（7 个来源）

| # | 来源 | 目标 | 说明 |
|---|------|------|------|
| 1 | `.claude/skills/` | `$DST/skills/` | 所有 skills 含 _shared |
| 2 | `~/.claude/tools/` | `$DST/tools/` | 全局工具脚本（statusline 等） |
| 3 | `.claude/hooks/` | `$DST/hooks/project/` | 项目级 hooks |
| 4 | `~/.claude/hooks/` | `$DST/hooks/system/` | 系统级 hooks（setup-windows.sh, fix-compat.sh 等） |
| 5 | `.claude/agents/` | `$DST/agents/` | 项目级 agents |
| 6 | project memory | `$DST/memory/project/` | MEMORY.md 等 |
| 7 | settings + CLAUDE.md | `$DST/settings/` | settings.json（项目/系统）、.gitattributes、CLAUDE.md |

另外 `install.sh` 自身也会被复制到 `$DST/install.sh`（仓库根目录）。

## Hooks 脚本说明

推送到远端的 hooks 脚本，各自的职责和触发时机：

### 系统级 hooks（`~/.claude/hooks/`）

| 脚本 | 触发时机 | 职责 |
|------|---------|------|
| `setup-windows.sh` | **手动执行一次** | Windows 一键初始化：chcp 65001、CRLF 全量修复、MCP cmd/c 包装、hookify UTF-8 补丁 |
| `fix-compat.sh` | PostToolUse: Edit\|Write | 每次编辑后轻量检查：项目 .claude/ 下 CRLF、反斜杠路径 |
| `check-platform-compat.sh` | 已废弃（检测已移入 setup-windows.sh） | 保留供参考，不再作为 hook 触发 |

### 项目级 hooks（`.claude/hooks/`）

| 脚本 | 触发时机 | 职责 |
|------|---------|------|
| `check-memory-size.sh` | Stop | 会话结束时检查 MEMORY.md 行数，超 150 行警告 |
| `patch-hookify-utf8.sh` | 已废弃（功能移入 setup-windows.sh） | 保留供参考 |

### 触发配置位置

- **系统级**：`~/.claude/settings.json` → `hooks.PostToolUse` → fix-compat.sh
- **项目级**：`.claude/settings.json` → `hooks.Stop` → check-memory-size.sh
- **一次性**：`bash ~/.claude/hooks/setup-windows.sh`（install.sh 自动调用）

## 执行步骤（推送模式）

### Step 1 — 同步文件

执行 sync.sh：

```bash
bash .claude/skills/push-skills-github/sync.sh
```

### Step 2 — 版本清单

读取每个 skill 的 CHANGELOG.md，展示版本清单，让用户确认。

### Step 3 — 安全扫描（强制门禁）

对 `jack-skills/` 执行安全扫描，HIGH 级别阻断推送。

#### 3a. Hardcoded Secrets（HIGH）
```
pattern: (key|token|secret|password|credential)\s*[:=]\s*['"][A-Za-z0-9_\-/+]{20,}['"]
```

#### 3b. Known Credential Prefixes（HIGH）
```
pattern: (sk-[a-zA-Z0-9]{20,}|ghp_[a-zA-Z0-9]{36,}|AKIA[A-Z0-9]{16})
```

#### 3c. Dangerous Functions（HIGH）
```
pattern: \b(eval|exec|execSync|Function)\s*\(
```

#### 3d. Sensitive Data Leakage（MEDIUM）
```
pattern: (\.env|process\.env\.[A-Z_]{5,})\b
```

**判定：HIGH ≥ 1 阻断；MEDIUM only 警告确认；无发现通过。**

### Step 4 — 显示 diff 并确认

```bash
cd "$DST" && git status && git diff --stat
```

### Step 5 — 提交 + Tag + 推送

```bash
cd "$DST" && git add -A && git commit -m "<描述>"
TAG="skills-v$(date +%Y%m%d)-1"
git tag "$TAG" && git push origin main "$TAG"
```

## 新环境安装

在新机器上执行：

```bash
git clone https://github.com/YuanHanzhong/jack-skills.git
cd jack-skills
bash install.sh /path/to/your/project
```

install.sh 会自动：
1. 将 skills 复制到 `项目/.claude/skills/`
2. 将 tools 复制到 `~/.claude/tools/`
3. 将 hooks 分别复制到项目和系统目录
4. 将 settings.json 安装到正确位置（系统级智能合并，不覆盖已有插件配置）
5. 将 memory 恢复到 `~/.claude/projects/` 下
6. 检测到 Windows 时自动执行 `setup-windows.sh`（CRLF、chcp、hookify 等）
