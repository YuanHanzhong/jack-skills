# Layer 6: Integration（可并行·约3小时）

## 可并行拆分为 3 个 Agent

### Agent-MCPTools（6.1）

#### 6.1 MCP Tools（10个域内工具）
- [ ] `submit_answer` — 提交答题回答
- [ ] `confirm_concept_map` — 确认知识点地图
- [ ] `request_interruption` — 请求中断/追问
- [ ] `execute_pending_tasks` — 执行待处理任务
- [ ] `start_interview_session` — 启动陪练会话
- [ ] `submit_interview_answer` — 提交陪练回答
- [ ] `trigger_review` — 触发复习
- [ ] `export_mastery_map` — 导出掌握度地图（JSON + Markdown）
- [ ] `check_job_status` — 查询后台任务状态（阻塞式轮询）
- [ ] `sync_notion` — 同步到 Notion

### Agent-CLICommands（6.2）

#### 6.2 CLI 命令（15个）
- [ ] init / ingest / resume / review / interview / sync-notion / stats / export
- [ ] DB系列：init-db / migrate-db / export-db / import-db / snapshot-db / verify-db / portable-export

### Agent-NotionSync（6.3）

#### 6.3 Notion 同步
- [ ] `src/data/sync/notion-sync.ts`
  - SQLite → Notion 单向同步
  - 4个 Notion 库：闪卡展示库 / 项目故事池 / 模块输出包 / 学习统计看板
  - 同步时机：卡片批量生成后 / 模块完成后 / Session收工后 / 手动sync
  - 故事池反向同步（人工编辑回流）

## 6.4 E2E 全流程测试
- [ ] 投入一段测试材料 → 走完 INGEST → MAP_REVIEW → AUDIT → TEST → BACKFILL → CARD_GEN → PACK → REVIEW_SCHEDULE → DONE
- [ ] 验证 SQLite 数据完整性 + 双轨状态正确
- [ ] 验证断点续传（中途杀进程 → 重启恢复）

**验收门槛**：E2E 全流程走通 + 断点续传验证
