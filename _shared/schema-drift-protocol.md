# Schema 漂移协议

1. 属性名从 `_shared/config.ts` 缓存读取，不要每次 fetch
2. 如果 `_lastSynced` 超过 7 天，第一次写入前 fetch 一次 schema
3. 如果 Notion 写入失败（属性不存在/不匹配）：
   - fetch 对应 data_source schema
   - 用新 schema 重试
   - 告知用户：「⚠️ 检测到 XX 库 schema 变更：列名 A→B，建议我更新 config.ts 吗？」
4. 用户说「Schema检查」→ 主动 fetch 全部 4 个库对比
