/**
 * config.ts — Centralized Notion UUID / Data Source ID registry.
 * [FIX-UUID] Single source of truth. All other scripts import from here.
 * NEVER define these UUIDs elsewhere.
 */

// Notion Database IDs
export const ODS_DATA_SOURCE_ID = "9634cf6c-8c6b-4c19-978a-71c4f33d3294"; // ODS
export const DWD_DATA_SOURCE_ID = "78cb3687-2ebf-47f3-8e66-76f1a07f1da0"; // DWD
export const DWS_DATA_SOURCE_ID = "0fdba26c-ff3b-45e5-8658-89316783bff2"; // DWS
export const ADS_DATA_SOURCE_ID = "1dbff6c4-966e-4184-80b4-9deaf2ea49ff"; // ADS
export const COORD_DB_ID = "67f4ea6f-85b8-4121-9b66-bbc6ad7d7903"; // Coord DB

// Container Page URLs (Notion view pages)
export const CONTAINER_URLS: Record<string, string> = {
  ADS: "https://www.notion.so/31cbad10f05a81918187edfe2c8924c6",
  DWD: "https://www.notion.so/31cbad10f05a81208865c8414b321aed",
  DWS: "https://www.notion.so/31cbad10f05a8176a6d5de582f3345fb",
  ODS: "https://www.notion.so/31cbad10f05a81c9ad4ef624239ea4cf",
};

// Utility Page IDs
export const ROOT_PAGE_ID = "315bad10f05a80928d51e21275eb4b84";
export const METADATA_PAGE_ID = "315bad10f05a81c39dc0c7df7bcda434";
export const STARTT_TEMPLATE_ID = "315bad10f05a81898524c288ef25598b";
export const LOG_PAGE_ID = "319bad10f05a81559d59c3e8836d20fe";
export const RULE_LIB_ID = "316bad10f05a8161ba44c078185e11b2";
export const MONTHLY_LOG_ID = "317bad10f05a814c9097edb40d31660e";
export const TODAY_DB_ID = "418be9da-e2d3-4d2c-8be6-51dc48fef53f";

// ── Schema Cache ─────────────────────────────────────────────────────────────
// Hardcoded property names so we skip fetch before create/update.
// Only update here when Notion schema actually changes.
// Last synced: 2026-03-11

export const ADS_SCHEMA = {
  title: "任务",           // TITLE
  status: "状态",          // SELECT: 🔵 进行中 | 🟡 收集中 | 📦 归档 | 🟢 已完成 | 🔴 已放弃
  mastery: "掌握度",       // SELECT: ⚪ 未学习 | 🟡 了解中 | 🔵 理解中 | 🟢 已掌握 | 🟣 已内化 | 🔴 需复习
  content: "内容",         // TEXT
  note: "备注",            // TEXT
  chapter: "当前章节",      // TEXT
  category: "分类",        // SELECT: 个人成长 | 知识学习 | 专业技术 | 优化工具 | 手册
  ownerNote: "焊忠备注",   // TEXT (owner-only)
  masteryScore: "掌握度分数",   // NUMBER
  lastTestDate: "上次测试日期", // DATE
  streakCorrect: "连续答对次数", // NUMBER
  parentRel: "上级 项目",   // RELATION (self)
  childRel: "子级 项目",    // RELATION (self)
  _lastSynced: "2026-03-11",
} as const;

export const ODS_SCHEMA = {
  title: "标题",           // TITLE
  status: "状态",          // SELECT: 🟡 收集中 | 🔵 进行中 | 🟢 已完成 | 🟣 已归档 | 🔴 已放弃
  mastery: "掌握度",       // SELECT: ⚪ 未学习 | 🟡 了解中 | 🔵 理解中 | 🟢 已掌握 | 🟣 已内化 | 🔴 需复习
  masteryScore: "掌握度分数", // NUMBER
  priority: "优先级",      // SELECT: 高 | 中 | 低
  category: "分类",        // SELECT: 个人成长 | 知识学习 | 专业技术 | 优化工具 | 手册
  sourceType: "来源类型",   // MULTI_SELECT: GitHub | 文章 | 书籍 | 视频 | 对话记录
  sourceOds: "来源ODS",    // TEXT
  originalLink: "原始链接", // URL
  odsLink: "ODS链接",      // URL
  note: "备注",            // TEXT
  chapter: "当前章节",      // TEXT
  totalChapters: "总章节数", // NUMBER
  lastStudy: "上次学习",    // DATE
  lastTestDate: "上次测试日期", // DATE
  streakDays: "连续学习天数", // NUMBER
  streakCorrect: "连续答对次数", // NUMBER
  ownerNote: "焊忠备注",   // TEXT (owner-only)
  createdDate: "创建日期",  // CREATED_TIME
  acquiredDate: "获取日期", // CREATED_TIME
  lastEdited: "最后修改时间", // LAST_EDITED_TIME
  timestamp: "时间戳",         // DATE
  turnCount: "对话轮数",       // NUMBER
  isResolved: "是否解决问题",   // SELECT
  activityType: "活动类型",    // SELECT
  satisfaction: "满意度信号",   // NUMBER
  analysisStatus: "分析状态",   // SELECT
  keywords: "关键词",          // TEXT
  frictionPoints: "摩擦点",    // TEXT
  chatUrl: "对话URL",          // URL
  _lastSynced: "2026-03-11",
} as const;

export const DWD_SCHEMA = {
  title: "手册",           // TITLE
  status: "状态",          // SELECT: 🟡 收集中 | 🔵 进行中 | 🟢 已完成 | 🟣 已归档 | 🔴 已放弃
  mastery: "掌握程度",     // SELECT: ⚪未学习 | 🟡了解中 | 🔵理解中 | 🟢已掌握 | 🔴需复习
  masteryScore: "掌握度分数", // NUMBER
  priority: "优先级",      // SELECT: 高 | 中 | 低
  category: "分类",        // SELECT: 个人成长 | 知识学习 | 专业技术 | 优化工具 | 手册
  sourceType: "来源类型",   // MULTI_SELECT: GitHub | 文章 | 书籍 | 视频 | 对话记录
  sourceOds: "来源ODS",    // TEXT
  originalLink: "原始链接", // URL
  odsLink: "ODS链接",      // URL
  note: "备注",            // TEXT
  chapter: "当前章节",      // TEXT
  totalChapters: "总章节数", // NUMBER
  lastStudy: "上次学习",    // DATE
  lastTestDate: "上次测试日期", // DATE
  streakDays: "连续学习天数", // NUMBER
  streakCorrect: "连续答对次数", // NUMBER
  ownerNote: "焊忠备注",   // TEXT (owner-only)
  createdDate: "创建日期",  // CREATED_TIME
  date: "日期",            // CREATED_TIME
  lastEdited: "最后修改时间", // LAST_EDITED_TIME
  _lastSynced: "2026-03-11",
} as const;

export const DWS_SCHEMA = {
  title: "工程实施",       // TITLE
  status: "状态",          // SELECT: 🟡 收集中 | 🔵 进行中 | 🟢 已完成 | 🟣 已归档 | 🔴 已放弃
  mastery: "掌握度",       // SELECT: ⚪ 未学习 | 🟡 了解中 | 🔵 理解中 | 🟢 已掌握 | 🟣 已内化 | 🔴 需复习
  masteryScore: "掌握度分数", // NUMBER
  priority: "优先级",      // SELECT: 高 | 中 | 低
  category: "分类",        // SELECT: 个人成长 | 知识学习 | 专业技术 | 优化工具 | 手册
  sourceType: "来源类型",   // MULTI_SELECT: GitHub | 文章 | 书籍 | 视频 | 对话记录
  sourceOds: "来源ODS",    // TEXT
  originalLink: "原始链接", // URL
  odsLink: "ODS链接",      // URL
  note: "备注",            // TEXT
  chapter: "当前章节",      // TEXT
  totalChapters: "总章节数", // NUMBER
  lastStudy: "上次学习",    // DATE
  lastTestDate: "上次测试日期", // DATE
  streakDays: "连续学习天数", // NUMBER
  streakCorrect: "连续答对次数", // NUMBER
  ownerNote: "焊忠备注",   // TEXT (owner-only)
  createdDate: "创建日期",  // CREATED_TIME
  lastEdited: "最后修改时间", // LAST_EDITED_TIME
  _lastSynced: "2026-03-11",
} as const;
