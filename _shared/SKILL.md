---
name: shared-modules
description: >-
  共享基础模块：Notion Schema 缓存、漂移自愈、路径定义、常量管理。
  这是其他 4 个 skill 的共同依赖，安装时必须一起安装。
---

# Shared Modules

其他 skills 的公共依赖，包含：

| 文件 | 用途 |
|------|------|
| `config.ts` | Notion DB UUID + Schema 列名缓存（单一来源） |
| `schema_resolver.ts` | Schema 漂移自愈层：`resolve(db, key)` / `buildProps(db, values)` |
| `paths.ts` | 跨平台路径定义 |
| `constants.ts` | Status/signal 常量集中管理 |
| `schema-drift-protocol.md` | Schema 漂移处理协议文档 |
