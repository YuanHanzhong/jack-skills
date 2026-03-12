---
name: jc
description: 智能 Git PR 全流程：commit→push→PR→auto-merge→分支清理。触发词：提交、推送、创建PR、push、commit、发PR、合并代码。不触发：会话沉淀→用 /ja，沉淀+提交→用 /js。
allowed-tools: Bash
---

## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Remote repository: !`git remote -v`

## Your task

执行智能 Git PR 流程，核心特性：
1. ✅ **PR 存在检测**：避免重复创建
2. ✅ **GitHub 原生 auto-merge**：`--auto --merge`
3. ✅ **自动清理已合并分支**：5重安全检查
4. ✅ **默认添加 auto-merge 标签**：配合 GitHub Actions，支持上下文检测例外
5. ✅ **远端同步**：执行 PR 流程前先拉取远端最新代码

### Step 0: 同步远端仓库

**在所有操作之前，先拉取远端最新代码**：

```bash
# 获取当前分支名称
current_branch=$(git branch --show-current)

# 如果当前在主分支，无需同步，直接退出
if [ "$current_branch" = "main" ] || [ "$current_branch" = "master" ]; then
  echo "ℹ️ 当前在主分支，跳过同步"
  echo "✅ 远端同步完成"
  exit 0
fi

# ⚠️ 前置保护：工作区有未提交变更时，先 stash 再切换
needs_stash=false
if [ -n "$(git status --porcelain)" ]; then
  echo "📦 检测到未提交变更，暂存中..."
  git stash --include-untracked -m "auto: jc step0 stash before sync"
  needs_stash=true
fi

# 切换到主分支并拉取最新代码
git checkout main
git pull origin main

# 切回功能分支
git checkout "$current_branch"

# 恢复暂存（如有）
if [ "$needs_stash" = "true" ]; then
  echo "📦 恢复暂存的变更..."
  git stash pop || echo "⚠️ stash pop 失败，请手动处理：git stash list"
fi

# 将主分支的最新更改合并到当前分支
if git rev-parse --verify HEAD@{upstream} >/dev/null 2>&1; then
  echo "📥 合并主分支更新到当前分支..."
  # 尝试合并，捕获返回码
  merge_output=$(git merge origin/main --no-edit 2>&1)
  merge_result=$?

  if [ $merge_result -eq 0 ]; then
    # 合并成功
    echo "✅ 合并成功"
  elif [ $merge_result -eq 1 ]; then
    # 有冲突
    echo "⚠️ 合并冲突！请解决冲突后重新运行 /jc"
    echo "$merge_output"
    echo ""
    echo "💡 解决冲突命令："
    echo "   1. git status 查看冲突文件"
    echo "   2. 编辑冲突文件，保留需要的代码"
    echo "   3. git add <冲突文件>"
    echo "   4. git commit -m '解决合并冲突'"
    echo "   5. 重新运行 /jc"
    exit 1
  else
    # 其他错误
    echo "⚠️ 合并失败！"
    echo "$merge_output"
    exit 1
  fi
else
  echo "⚠️ 当前分支无 upstream 跟踪，跳过合并"
fi

echo "✅ 远端同步完成"
```

**处理合并冲突**：
- 精确检测合并结果（成功/冲突/其他错误）
- 如果发生冲突，输出详细提示信息并以 exit 1 停止流程
- 告知用户解决冲突的具体步骤
- 避免产生混乱的提交历史

**关键点**：
- ✅ 先切换到 main 拉取，确保拉取的是最新主分支
- ✅ 切回功能分支后尝试合并（保留本地修改）
- ✅ 精确区分合并成功/冲突/其他错误
- ⚠️ 冲突时主动停止，避免产生混乱的提交历史

### Step 1: 检查 PR 状态

```bash
gh pr list --head $(git branch --show-current) --state open
```

- 如果存在 PR：跳过创建，只推送新提交
- 如果不存在：执行完整流程

### Step 2: 分支处理

检查当前分支，如果在主分支则自动创建功能分支：

```bash
current_branch=$(git branch --show-current)

if [ "$current_branch" = "main" ] || [ "$current_branch" = "master" ]; then
  echo "📍 当前在主分支 ($current_branch)"

  # 从对话上下文或 git diff 智能生成分支名
  # Claude 根据对话上下文确定 prefix 和 feature_name
  # 例如：feat/jc-auto-merge-label, fix/session-naming-bug

  # 如果无法从上下文确定，使用通用格式：
  timestamp=$(date +%m%d-%H%M)
  new_branch="feat/update-${timestamp}"

  echo "🌿 自动创建功能分支：$new_branch"
  git checkout -b "$new_branch"
else
  echo "✅ 当前在功能分支：$current_branch"
fi
```

**分支命名规则**：
- `feat/` - 新功能
- `fix/` - Bug 修复
- `chore/` - 杂项（文档、配置等）
- `refactor/` - 重构

### Step 3: 提交与推送

**3.1 远程仓库验证**（推送前必做）：
```bash
git remote -v
```
- 确认远程地址正确
- 如有 "repository moved" 警告：
  1. 停止执行
  2. `git remote set-url origin <新地址>`
  3. 验证：`git remote -v`
  4. 重新推送

**3.2 提交变更**：

根据 `git status` 和 `git diff` 生成提交信息，遵循约定式提交格式（conventional commits）：

```bash
# 添加所有变更文件（Claude 根据 git status 选择要提交的文件）
git add <file1> <file2> ...

# 生成提交信息（Claude 从对话上下文中提取 Why，融入 commit message body）
# 格式：<type>: <subject>
#
# <body>  ← 从对话上下文提取动机和决策
#
# Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
git commit -m "$(cat <<'EOF'
<type>: <subject>

<body - 动机和决策背景>

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
EOF
)"
```

**类型（type）**：
- `feat`: 新功能
- `fix`: Bug 修复
- `chore`: 杂项（文档、配置、清理等）
- `refactor`: 重构
- `docs`: 文档
- `test`: 测试

**3.3 推送到远程**：
```bash
git push origin $(git branch --show-current) -u
```

**3.4 自动清理已合并的本地分支**（推送后执行）：

**5重安全检查**：
```
1. 不是 main/master（永远不删主分支）
2. 不是当前分支（永远不删当前工作分支）
3. 已合并到 main（只删已合并的）
4. 无未合并的提交（用 git log main..branch 检查）
5. 当前工作目录干净（有未提交更改时不执行）
```

**执行逻辑**：
```bash
# 获取所有已合并到 main 的本地分支
git branch --merged main | grep -v "main" | grep -v "master" | grep -v "^\*" | while read branch; do
  # 检查：无未合并的提交
  if [ -z "$(git log main..$branch --oneline)" ]; then
    # 检查：不是当前分支（再次确认）
    if [ "$branch" != "$(git branch --show-current)" ]; then
      echo "🗑️  删除本地分支：$branch"
      git branch -d "$branch"
    fi
  fi
done
```

**策略**：
- ✅ 只删除**本地**分支（远程分支暂不删）
- ✅ 保守策略：宁可漏删，不误删
- ✅ 单个分支失败不影响其他分支

### Step 3.5: 检测 auto-merge 意图（PR 创建前）

从当前对话上下文中检测用户是否明确要求跳过自动合并。

**检测关键词**（禁用 auto-merge）：
- 中文：不要 auto-merge、不自动合并、手动合并、跳过自动合并
- 英文：no auto-merge、skip auto-merge、manual merge

**检测范围**：最近 3 条用户消息

**检测逻辑**：

> **AI 决策**: 扫描最近 3 条用户消息，检测是否包含上述关键词
>
> **输入**: 当前对话上下文中最近 3 条用户消息
> **处理**: 逐条匹配关键词列表（中文 + 英文），任一命中即标记跳过
> **输出**: `SKIP_AUTO_MERGE` 标记（`true` 或 `false`），供 Step 4.1 使用
>
> - 检测到关键词 → `SKIP_AUTO_MERGE=true`（跳过标签）
> - 未检测到 → `SKIP_AUTO_MERGE=false`（默认添加标签）

### Step 4: PR 创建（仅在无 PR 时）

**4.1 创建 PR**：

从当前对话上下文中提取决策背景，融入 PR description：

```bash
# 分支验证：确保不在主分支上
current_branch=$(git branch --show-current)
if [ "$current_branch" = "main" ] || [ "$current_branch" = "master" ]; then
  echo "❌ 错误：当前在主分支 ($current_branch) 上，无法创建 PR"
  echo "💡 请先切换到功能分支：git checkout -b <分支名>"
  exit 1
fi

# 根据上下文检测结果决定是否添加标签
if [ "$SKIP_AUTO_MERGE" = "true" ]; then
  echo "⚠️  已跳过 auto-merge 标签（根据用户要求）"
  gh pr create --title "$PR_TITLE" --body "$PR_BODY"
else
  echo "✅ 默认添加 auto-merge 标签"
  # 尝试带标签创建，失败则降级
  if ! gh pr create --title "$PR_TITLE" --body "$PR_BODY" --label auto-merge 2>&1; then
    echo "⚠️  标签添加失败（可能标签不存在），降级为不带标签创建"
    gh pr create --title "$PR_TITLE" --body "$PR_BODY"
  fi
fi
```

**PR 描述应包含 Context 部分**（从对话上下文提取）：
```markdown
## Context
- **动机**：为什么需要这个变更
- **决策**：关键的技术决策和理由

## Summary
- [变更要点 1]
- [变更要点 2]

## Test plan
- [ ] 测试项 1
- [ ] 测试项 2

---
🤖 **Auto-merge**: 已添加 `auto-merge` 标签，CI 通过后将自动合并
```

**4.2 启用 Auto-merge**（创建成功后立即执行）：

**智能错误处理**：
```bash
# 尝试启用 auto-merge，捕获所有可能的错误
merge_result=$(gh pr merge --auto --merge 2>&1)
merge_exit_code=$?

if [ $merge_exit_code -eq 0 ]; then
  echo "✅ Auto-merge 已启用（GitHub 原生）"
  if [ "$SKIP_AUTO_MERGE" != "true" ]; then
    echo "🏷️  已添加 auto-merge 标签（GitHub Actions 备选方案）"
    echo "💡 双重保险：GitHub 原生 + Actions 标签触发"
  fi
else
  # 分析失败原因并提供友好提示
  if echo "$merge_result" | grep -q "Protected branch rules not configured"; then
    echo "⚠️  GitHub 原生 auto-merge 不可用：需要配置分支保护规则"
    echo "💡 原因：需要配置分支保护规则才能使用 auto-merge"
    echo "📖 了解更多：https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches"
  elif echo "$merge_result" | grep -q "Upgrade to GitHub Pro\|make this repository public"; then
    echo "⚠️  GitHub 原生 auto-merge 不可用：需要 GitHub Pro 或公开仓库"
    echo "💡 原因：分支保护功能仅限 Pro 账号或公开仓库"
    echo "📖 了解更多：https://docs.github.com/en/get-started/learning-about-github/githubs-plans"
  else
    echo "⚠️  GitHub 原生 auto-merge 不可用：$merge_result"
  fi

  if [ "$SKIP_AUTO_MERGE" != "true" ]; then
    echo "🏷️  已添加 auto-merge 标签，GitHub Actions 将在 CI 通过后自动合并"
  fi

  echo ""
  echo "✅ PR 已创建成功，可通过以下方式合并："
  echo "   1. 手动在 GitHub 界面查看并合并"
  echo "   2. CI 通过后执行：gh pr merge --merge"
  echo "   3. 立即合并（跳过 CI）：gh pr merge --merge --admin"
fi
```

**参数说明**：
- `--auto`: CI 检查通过后自动合并（`gh pr merge` 的选项）
- `--merge`: 使用 merge 方式，保留完整历史
- 无需指定 PR 编号，自动对当前分支的 PR 生效

**错误处理策略**：
- ✅ **不中断流程**：即使 auto-merge 失败，PR 仍然创建成功
- ✅ **友好提示**：根据错误类型提供明确的原因说明
- ✅ **提供替代方案**：给出手动合并的多种选择
- ✅ **完整错误信息**：未知错误时显示原始错误消息

**注意**：PR 描述格式见 Step 4.1 中的模板。

### Step 5: PR 合并后清理（可选）

如果 PR 已设置 auto-merge，等待合并完成后，执行远程分支清理：

**5.1 同步远程状态**：
```bash
git fetch --prune
```
- 移除远程已删除分支的本地引用
- 更新远程分支列表

**5.2 清理 [gone] 分支**：
```bash
# 列出所有 [gone] 分支（远程已删除，本地仍存在）
git branch -vv | grep ': gone]' | awk '{print $1}'

# 删除这些分支
git branch -vv | grep ': gone]' | awk '{print $1}' | xargs -r git branch -d
```

**安全检查**：
- ✅ 只删除标记为 `[gone]` 的分支
- ✅ 不删除当前分支
- ✅ 不删除 main/master
- ✅ 使用 `-d` 而不是 `-D`（确保已合并）

**何时执行**：
- PR 设置了 auto-merge 且预期即将合并
- 定期清理多余的本地分支
- 用户明确要求清理

**5.3 清理远程已合并分支**：
```bash
# 获取当前工作分支
current_branch=$(git branch --show-current)

# 获取所有远程分支（已合并到 main）
remote_branches=$(git branch -r --merged main | grep -v "main" | grep -v "master" | grep -v "HEAD")

if [ -z "$remote_branches" ]; then
  echo "ℹ️ 没有已合并到 main 的远程分支"
else
  echo "📋 以下远程分支已合并到 main，即将删除："
  echo "$remote_branches"

  # 逐个检查并删除
  for branch in $remote_branches; do
    # 去掉 "origin/" 前缀
    branch_name=${branch#origin/}

    # 安全检查 1: 不删除当前工作分支
    if [ "$branch_name" = "$current_branch" ]; then
      echo "⚠️ 跳过 $branch：当前工作分支"
      continue
    fi

    # 安全检查 2: 双重验证 - 确保远程分支确实已合并到 main
    # git merge-base --is-ancestor A B: 检查 A 是否是 B 的祖先
    # 返回 0 = A 是 B 的祖先 = A 已合并到 B = 可以删除
    # 返回 1 = A 不是 B 的祖先 = A 未合并到 B = 跳过
    if ! git merge-base --is-ancestor origin/$branch_name main 2>/dev/null; then
      # 返回 1：不是祖先 = 未合并 = 跳过
      echo "⚠️ 跳过 $branch：远程分支未合并到 main"
      continue
    fi
    # 返回 0：是祖先 = 已合并 = 继续删除

    # 安全检查 3: 确认本地分支也已合并（如果有本地副本）
    # git branch --merged main | grep -q "$branch_name"
    # 返回 0 = 找到 = 已合并 = 可以删除（不跳過）
    # 返回 1 = 没找到 = 未合并 = 跳过
    local_branch=$(git branch | grep "^[* ] *${branch_name}$" || true)
    if [ -n "$local_branch" ]; then
      if git branch --merged main | grep -q "$branch_name"; then
        # 返回 0：找到 = 已合并 = 继续删除
        :
      else
        # 返回 1：没找到 = 未合并 = 跳过
        echo "⚠️ 跳过 $branch：本地分支未合并到 main"
        continue
      fi
    fi

    # 安全检查 4: 再次确认不是 main/master
    if [ "$branch_name" = "main" ] || [ "$branch_name" = "master" ]; then
      echo "⚠️ 跳过 $branch：保护分支"
      continue
    fi

    echo "🗑️ 删除远程分支：$branch"
    git push origin --delete "$branch_name"
  done
fi
```

**安全检查（6 重确认）**：
```
1. ✅ git branch -r --merged main 筛选已合并的远程分支
2. ✅ 双重验证：git merge-base --is-ancestor 再次确认远程分支已合并
3. ✅ 检查本地副本是否也已合并（如有）
4. ✅ 不删除 main/master 分支
5. ✅ 不删除当前工作分支
6. ✅ 逐个检查，允许跳过个别分支
```

**何时执行**：
- PR 已成功合并到 main
- 用户明确要求清理远程分支
- 定期维护时使用

## 输出格式

```markdown
## PR 流程结果

### 检查状态
- 当前分支：<分支名>
- PR 状态：[存在 - 只推送更新 / 不存在 - 创建新 PR]

### 提交信息
- 提交：[哈希] - <提交信息>
- 推送：成功

### PR 信息
- PR #<编号>：<标题>
- URL：<PR 链接>
- Auto-merge：[已启用 ✅ / 不可用 ⚠️ - 原因]
- 合并方式：[自动合并 / 手动合并]

### 分支清理（Step 3.4）
- 已删除（本地已合并）：[分支列表]
- 保留：<当前分支>

### 远程分支清理（Step 5，可选）
- 同步远程：✅ git fetch --prune
- 已删除（[gone]）：[分支列表]
- 已删除（远程已合并）：[分支列表]
- 保留：<当前分支>
```

## 质量标准

- ✅ 避免重复 PR（核心改进）
- ✅ 远程仓库验证（推送前必查）
- ✅ 检测 "repository moved" 警告并立即处理
- ✅ 自动清理已合并的本地分支
- ✅ 约定式提交信息格式
- ✅ GitHub 原生 auto-merge 支持
- ✅ 默认添加 auto-merge 标签（配合 GitHub Actions）
- ✅ 上下文检测支持例外场景（"不要 auto-merge"）
- ✅ Step 0 远端同步（先拉取再操作）
- ✅ Step 5.3 远程分支清理（6 重安全检查确认已合并）

## 相关工具

- GitHub CLI：`gh`（必需）
