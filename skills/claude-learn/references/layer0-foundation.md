# Layer 0: Foundation（顺序执行·约30分钟）

## 0.1 Bun 环境初始化
- [ ] `bun init` 在 `learning-engine/` 目录
- [ ] `bun add drizzle-orm zod pino dayjs @anthropic-ai/sdk p-limit`
- [ ] `bun add -d @types/bun drizzle-kit`
- [ ] 创建 `tsconfig.json`（Bun风格，见ADS第一章）
- [ ] 删除任何 `package-lock.json` / `pnpm-lock.yaml` / `bun.lockb`
- [ ] 确认 `bun.lock` 存在

## 0.2 项目目录结构
- [ ] 创建完整目录树（见ADS第二十三-A章）：
  ```
  learning-engine/
  ├── src/{app,cli/commands,hooks/handlers,core/*,data/*,services,schemas,worker}
  ├── references/prompt-templates/
  ├── agents/
  ├── evals/
  ├── .learning-engine/{state,exports,logs,config,cache}
  └── tools/
  ```
- [ ] 创建 `src/app/bootstrap.ts`（退出信号拦截 + WAL收敛）
- [ ] 创建 `src/app/config.ts`（项目配置）
- [ ] 创建 `src/app/container.ts`（依赖注入容器）

## 0.3 tools/bun-runner.sh
- [ ] 实现 Bun PATH 探测逻辑（$BUN_BIN → ~/.bun/bin/bun → command -v bun）
- [ ] 统一转发参数、日志、失败码
- [ ] 冒烟测试：`sh tools/bun-runner.sh --version`

## 0.4 package.json 脚本
- [ ] 定义所有脚本入口（见ADS第二十三-B章）
- [ ] 确保零 npm/pnpm 残留

**验收门槛**：`bun install && bun run typecheck` 成功
