# Layer 3: Hook System（顺序执行·约2小时）

> 依赖 Layer 2（状态机 + 策略引擎）+ Layer 4.3（resume-service）

## 3.1 Dispatcher
- [ ] `src/hooks/dispatcher.ts`
  - 统一入口：从 stdin/env 读取 hook_event_name
  - 按事件名分发到具体 handler
  - 统一错误处理 + 日志格式
  - 防递归守卫（MEMORY_INJECT_ACTIVE=true 检查）
  - stdout 输出严格 JSON

## 3.2 Hook Handlers（8个）

### 3.2.1 session-start.ts
- [ ] 读取 SQLite 最近活跃 session
- [ ] 判断新会话 vs 恢复旧会话
- [ ] 孤儿 PENDING 状态回收
- [ ] 调用 resume-service 恢复状态机到内存
- [ ] 注入当前阶段上下文 + 允许/禁止动作
- [ ] Daemon 心跳检测（不存活则警告）
- [ ] stdout: `{"result": "注入内容"}`

### 3.2.2 user-prompt-submit.ts
- [ ] 识别输入类型（新材料/答题/追问/复习/中断/故事补充）
- [ ] 路由到正确处理器
- [ ] 附加当前状态上下文
- [ ] stdout: `{"result": "修改后的prompt"}` ← **必须JSON，纯文本会静默失效**

### 3.2.3 pre-tool-use.ts
- [ ] 非域内工具 → 无条件放行
- [ ] 域内工具 → 策略引擎评估
- [ ] PENDING 状态封杀（仅允许 execute_pending_tasks + check_job_status）
- [ ] stdout: `{"decision": "approve"}` 或 `{"decision": "deny", "reason": "..."}`

### 3.2.4 post-tool-use.ts
- [ ] Zod 校验结果
- [ ] 通过 service 层写入数据库（commit-on-success）
- [ ] 更新状态机 + 推进下一阶段
- [ ] 触发派生动作
- [ ] 模块闭环时输出 /compact 引导

### 3.2.5 stop.ts
- [ ] 普通stop：保存快照，不强验收
- [ ] 阶段收工stop：双轨验收门槛检查
- [ ] block 场景：BACKFILL未跑 / Pack未生成 / 审计未收敛 / 双轨未达标

### 3.2.6 subagent-stop.ts
- [ ] 校验子Agent产出是否满足Zod契约
- [ ] 不满足则阻止收工

### 3.2.7 pre-compact.ts
- [ ] 紧急持久化到SQLite
- [ ] 写断点快照
- [ ] 生成 compact_summary + resume_context_pack

### 3.2.8 session-end.ts
- [ ] flush全部未提交状态
- [ ] 写 session summary
- [ ] 更新最近活跃时间
- [ ] 同步镜像任务入队

## 3.3 .claude/settings.json 配置
- [ ] 所有 Hook command 统一 `sh tools/bun-runner.sh src/hooks/dispatcher.ts`
- [ ] `grep -r '"bun ' .claude/settings.json` 返回 0 结果

**验收门槛**：每个 Hook stdout 输出合法 JSON + 防递归守卫测试通过
