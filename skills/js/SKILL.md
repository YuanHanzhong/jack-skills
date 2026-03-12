---
name: js
description: 完整收尾流程：先 /ja 会话沉淀，再 /jc Git PR 提交。触发词：沉淀并提交、保存并推送、收工、做完了提交一下。不触发：只沉淀→用 /ja，只提交→用 /jc。
allowed-tools: Skill, Bash, Read, Write, Glob, Grep
---

## Context

- Current git status: !`git status`
- Current git diff (staged and unstaged changes): !`git diff HEAD`
- Current branch: !`git branch --show-current`
- Remote repository: !`git remote -v`
- STARTT template: `.claude/skills/notion-writer/templates/startt_template.md`
- Sessions directory: `03_DWS/sessions/`

## Your task

依次执行两个 skill：**Step 1 /ja 会话沉淀** → **Step 2 /jc Git PR 流程**

### Step 1: 执行 /ja — AI 智能会话沉淀

使用 Skill 工具调用 `ja` skill，执行完整的会话沉淀流程。

包含：
1. 获取 JSONL 会话数据（增强性）
2. 获取 Git 提交历史（增强性）
3. 读取 STARTT 模板
4. 三源融合智能分析
5. 确定分类和元数据
6. 生成并保存 STARTT 文档
7. 验证文档质量

**确认沉淀完成且质量合格后，再继续 Step 2。**

### Step 2: 执行 /jc — Git PR 流程

使用 Skill 工具调用 `jc` skill，执行完整的 Git PR 流程。

包含：
1. Step 0: 同步远端仓库（先拉取远端最新代码）
2. 检查当前分支是否已有开放 PR
3. 如有 PR：只推送更新，不重复创建
4. 如无 PR：创建功能分支 → 提交 → 推送 → 创建 PR + auto-merge
5. 自动清理已合并的本地分支
6. PR 合并后清理远程已合并分支（6 重安全检查）

## 执行顺序

```
1. /ja — AI 智能沉淀
   └─ 完成后验证质量

2. /jc — Git PR 流程
   └─ 沉淀文档随其他变更一起提交
```

## 结果输出格式

执行完成后，输出清晰的状态摘要：

```markdown
## ✅ 执行结果摘要

### Step 1: /ja 会话沉淀
- **状态**: 新建沉淀
- **数据源**: 对话上下文 ✅ | JSONL ✅/⚠️ | Git ✅/⚠️
- **文件**: `03_DWS/sessions/<分类>/<文件名>.md`
- **标题**: <会话主题>

### Step 2: /jc Git PR 流程
- **提交**: [哈希] - 提交信息
- **PR**: [PR 链接]
- **Auto-merge**: [已启用/未启用]
- **分支**: <分支名>

### 📦 交付物统计
- 沉淀文档：1 个
- Git 提交：1 个
- Pull Request：1 个
```

## 与其他命令的区别

- `/ja` - 只沉淀，**不执行 Git**
- `/jc` - 只 Git PR，**不沉淀**
- `/js` - **沉淀 + Git PR**（= /ja + /jc）

## 重要提示

- ✅ **先沉淀后提交**，确保文档质量再进入 Git 流程
- ✅ /ja 和 /jc 的详细逻辑各自维护，/js 只负责串联调用
- ✅ 如果 /ja 失败或质量不合格，不继续执行 /jc
