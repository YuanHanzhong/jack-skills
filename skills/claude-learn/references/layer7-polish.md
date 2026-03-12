# Layer 7: Polish（可并行·约2小时）

## 7.1 面试陪练完善
- [ ] INTERVIEW_PREP → STARL_BUILD → FEYNMAN_LOOP → PRESSURE_TEST → FINALIZE 完整流程
- [ ] 5级压力追问（本质/风险/极端场景/故障处理/系统重构）
- [ ] 联动规则：陪练盲点 → 切L1/L2/L3测试 → 补完继续
- [ ] projectExpression 维度提升

## 7.2 复习调度器完善
- [ ] 艾宾浩斯间隔（当天/1天/3天/7天/14天）
- [ ] P0-P3 混合调度
- [ ] 跨模块混合测试
- [ ] 新问题自动补卡

## 7.3 DB 生命周期完善
- [ ] 完整导出/导入（轻量版 + 完整版 JSON 交换格式）
- [ ] snapshot-db + verify-db 完善
- [ ] portable-export（打包搬家）
- [ ] migrate-db（版本迁移 + 自动备份）

## 7.4 文档清洗
- [ ] 所有 README / CLAUDE.md / SKILL.md / agent 提示词只出现 `bun`
- [ ] `grep -r 'npm\|pnpm\|npx\|tsx\|ts-node' **/*.md **/*.json` 返回 0
- [ ] 所有 prompt-templates 更新

## 7.5 SKILL.md + Skill Creator
- [ ] 编写 SKILL.md（<500行）
- [ ] 三级渐进加载
- [ ] evals.json 测试集
- [ ] Skill Creator 评估 + 迭代
