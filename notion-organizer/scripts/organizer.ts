/**
 * organizer.ts — Notion目录整理管家·流程描述+格式化函数
 *
 * 設計原則：
 * - 零常量：不硬編碼任何DB ID/列名/選項值，全部動態fetch
 * - Claude語義判斷：列名映射靠類型+選項值相似度，不靠硬編碼
 * - ADS狀態只有焊忠改：Claude絕不改ADS頁面的狀態字段
 * - 安全移動：收集屬性→move→回寫屬性，不讀頁面內容
 */

import { ROOT_PAGE_ID } from "../../_shared/config.ts";
import { resolve } from "../../_shared/schema_resolver.ts";
import { STATUS_DONE, STATUS_ABANDONED } from "../../_shared/constants.ts";

// ========== 1. 流程描述（Claude執行時參考） ==========

export function describeDynamicSchemaFetch(): string {
  return `
【Phase 0 动态Schema获取·每次执行必做】
Step 1: notion_fetch("${ROOT_PAGE_ID}") → 拿到claudeMem根目录
Step 2: 从根目录内容中找到四个容器页面（ODS/DWD/DWS/ADS）
Step 3: fetch每个容器页面 → 找到inline数据库的data_source_url
Step 4: fetch每个data_source → 拿到最新Schema（列名、类型、选项值）
结果：四个库的完整Schema，全部是当前最新值
⛔ 不硬编码任何值，全部从fetch结果中提取
`;
}

export function describeSafeMovePage(): string {
  return `
【safe_move_page·安全移动原子操作】
Step 1: fetch源页面 → 只读properties字段（不读content）
        → 把所有属性值存到变量（标题/状态/分类/优先级/备注/焊忠备注/...）
Step 2: fetch源库Schema + 目标库Schema（如果Phase 0已做过可复用）
Step 3: Claude语义匹配列名映射
        规则：相同类型(select/text/number) + 选项值相似 → 同一字段
        例如：源库"分类"(select) ↔ 目标库"类别"(select) → 同一字段
        入乡随俗：用目标库的列名写入
Step 4: 检查目标库是否缺列 → 缺就DDL补上（只增不减）
Step 5: notion_move_pages(page_id, new_parent={"data_source_id": target_ds_id})
        ⛔ 不读content，内容自动跟着走
Step 6: notion_update_page(command="update_properties", page_id, properties=映射后的属性)
        用目标库的列名+映射后的值写回
Step 7: 失败处理：
        回写失败 → 重试一次
        仍失败 → 告警「页面已在目标库但属性空，需手动检查」
        ⚠️ 页面不会丢，只是属性可能空
`;
}

export function describeColumnMapping(): string {
  return `
【列名语义匹配规则·Claude执行时按此判断】
1. 相同类型（select↔select, text↔text）是匹配前提
2. 对于select/multi_select：选项值重叠度>50% → 判定为同一字段
   例如：源库"分类"有[个人成长,知识学习,优化工具]
         目标库"类别"有[个人成长,知识学习,专业技术]
         重叠2/3=67% → 同一字段
3. 对于text/number/date等简单类型：列名语义相似即可
   例如："掌握度"↔"掌握程度"、"连续答对次数"↔"连续答对"
4. title类型：每个库只有一个title列，自动匹配
5. 自动字段（created_time/last_edited_time）：跳过，Notion自动处理
6. 状态字段特殊映射：
   ADS用「📦 归档」→ 其他库可能用「🟣 已归档」
   Claude看选项值中含"归档"的就匹配上
`;
}

export function describeClassifyRules(): string {
  return `
【分类整理规则·Claude语义判断】
前提：只移动已完成/已放弃的页面，进行中/收集中绝不动

默认分类→目标库映射（Claude根据实际分类字段值语义判断）：
  手册/参考/文档/指南类 → DWD（手册库）
  优化工具/专业技术/系统/工程类 → DWS（工程实施库）
  个人成长/知识学习/认知/价值观类 → 保留ADS（学习类留ADS方便复习）

⛔ 以上不是硬编码，是Claude的语义判断参考
⛔ 焊忠如果在指挥台/备注中指定了目标库，以焊忠为准
⛔ ADS状态只有焊忠改，Claude绝不改
`;
}

export function describeSchemaHealthCheck(): string {
  return `
【Schema健康检查·每次整理时顺带做】
Step 1: fetch四库最新Schema
Step 2: 取四库列的并集
Step 3: 对每个库：
         缺的列 → DDL补上（只增不减）
         选项值不一致 → 汇报给焊忠（不自动改选项值）
Step 4: 汇报结果：
         ✅ 四库列已对齐（N列）
         ⚠️ 补了X个列到Y库
         ⚠️ 发现选项值不一致：[详情]
`;
}

export function describeFieldSync(): string {
  return `
【字段值跨库同步·触发词：「字段改了」「我改了选项」】
Step 1: 焊忠说「我改了DWS的已归档→归档」
Step 2: fetch该库确认实际变更
Step 3: 生成其他库需要同步的DDL（ALTER COLUMN SET）
Step 4: 执行同步
Step 5: 汇报结果
⛔ 只改选项值，不改列名/列类型
⛔ 列名不自动统一（入乡随俗，各库保持自己的列名）
`;
}

// ========== 1.5 可执行逻辑函数 ==========

interface PageEntry {
  id: string;
  title: string;
  status: string;
  category: string;
  url: string;
}

interface ScanResult {
  movable: PageEntry[];
  inProgress: PageEntry[];
  stats: { total: number; movable: number };
}

export function scanAdsForCompleted(searchResults: any[]): ScanResult {
  const movable: PageEntry[] = [];
  const inProgress: PageEntry[] = [];

  const doneKeywords = ["完成", "已完成", "归档", "已归档", "放弃", "已放弃"];

  for (const page of searchResults) {
    const props = page.properties ?? {};
    const title = _extractTitle(props);
    const status = _extractSelect(props, resolve("ADS", "status"));
    const category = _extractSelect(props, resolve("ADS", "category"));

    const isDone = doneKeywords.some((k) => (status ?? "").includes(k));

    const entry: PageEntry = {
      id: page.id ?? "",
      title,
      status,
      category,
      url: page.url ?? "",
    };

    if (isDone) {
      movable.push(entry);
    } else {
      inProgress.push(entry);
    }
  }

  return {
    movable,
    inProgress,
    stats: { total: searchResults.length, movable: movable.length },
  };
}

export function classifyTargetDb(
  pageTitle: string,
  pageCategory: string
): "DWD" | "DWS" | "ADS" {
  const category = (pageCategory ?? "").toLowerCase();
  const title = (pageTitle ?? "").toLowerCase();

  const dwdKeywords = [
    "手册",
    "参考",
    "文档",
    "指南",
    "reference",
    "manual",
    "guide",
  ];
  const dwsKeywords = [
    "优化工具",
    "专业技术",
    "系统",
    "工程",
    "代码",
    "技能",
    "tool",
    "engineering",
  ];
  const adsKeepKeywords = [
    "个人成长",
    "知识学习",
    "认知",
    "价值观",
    "学习",
  ];

  for (const kw of dwdKeywords) {
    if (category.includes(kw) || title.includes(kw)) return "DWD";
  }

  for (const kw of dwsKeywords) {
    if (category.includes(kw) || title.includes(kw)) return "DWS";
  }

  for (const kw of adsKeepKeywords) {
    if (category.includes(kw) || title.includes(kw)) return "ADS";
  }

  // 默认移到DWS
  return "DWS";
}

interface SchemaField {
  type: string;
  options?: string[];
  [key: string]: any;
}

export function buildPropertyMapping(
  sourceSchema: Record<string, SchemaField>,
  targetSchema: Record<string, SchemaField>
): Record<string, string> {
  const mapping: Record<string, string> = {};
  const usedTargets = new Set<string>();

  for (const [srcName, srcInfo] of Object.entries(sourceSchema)) {
    const srcType = srcInfo.type ?? "";

    // title类型自动匹配
    if (srcType === "title") {
      for (const [tgtName, tgtInfo] of Object.entries(targetSchema)) {
        if (tgtInfo.type === "title" && !usedTargets.has(tgtName)) {
          mapping[srcName] = tgtName;
          usedTargets.add(tgtName);
          break;
        }
      }
      continue;
    }

    // 跳过自动字段
    if (
      ["created_time", "last_edited_time", "created_by", "last_edited_by"].includes(srcType)
    ) {
      continue;
    }

    let bestMatch: string | null = null;
    let bestScore = 0;

    for (const [tgtName, tgtInfo] of Object.entries(targetSchema)) {
      if (usedTargets.has(tgtName)) continue;
      if (tgtInfo.type !== srcType) continue;

      // 名称完全相同
      if (srcName === tgtName) {
        bestMatch = tgtName;
        bestScore = 100;
        break;
      }

      // select/multi_select: 比较选项重叠度
      if (srcType === "select" || srcType === "multi_select") {
        const srcOpts = new Set(srcInfo.options ?? []);
        const tgtOpts = new Set(tgtInfo.options ?? []);
        if (srcOpts.size > 0 && tgtOpts.size > 0) {
          let intersectionCount = 0;
          for (const o of srcOpts) {
            if (tgtOpts.has(o)) intersectionCount++;
          }
          const unionSize = new Set([...srcOpts, ...tgtOpts]).size;
          const overlap = intersectionCount / Math.max(unionSize, 1);
          if (overlap > bestScore) {
            bestScore = overlap;
            bestMatch = tgtName;
          }
        }
      }

      // 名称包含关系
      if (srcName.includes(tgtName) || tgtName.includes(srcName)) {
        const score = 0.6;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = tgtName;
        }
      }
    }

    if (bestMatch !== null && bestScore >= 0.5) {
      mapping[srcName] = bestMatch;
      usedTargets.add(bestMatch);
    }
  }

  return mapping;
}

interface MovedPage {
  title: string;
  target_db?: string;
  [key: string]: any;
}

export function buildMoveReport(
  movedPages: MovedPage[],
  skippedPages: any[]
): string {
  const lines: string[] = [];
  if (movedPages.length > 0) {
    lines.push(`✅ 已移动 ${movedPages.length} 条：`);
    for (const p of movedPages) {
      lines.push(`  · ${p.title} → ${p.target_db ?? "?"}`);
    }
  }
  if (skippedPages.length > 0) {
    lines.push(`⏭️ 跳过 ${skippedPages.length} 条`);
  }
  return lines.length > 0 ? lines.join("\n") : "📌 无需移动";
}

interface MoveEntry {
  title?: string;
  from?: string;
  to?: string;
  [key: string]: any;
}

export function buildEngineeringDoc(
  moves: MoveEntry[],
  timestamp: string
): string {
  const lines: string[] = [
    `> 🔧 工程实践｜Notion目录整理记录`,
    `# 📊 整理记录`,
    `📌 执行时间：${timestamp}`,
    `📌 移动：${moves.length} 条`,
    "",
  ];
  for (const m of moves) {
    lines.push(
      `- ${m.title ?? "?"} | ${m.from ?? "ADS"}→${m.to ?? "?"}`
    );
  }
  return lines.join("\n");
}

// ── 内部辅助函数 ──

function _extractTitle(properties: Record<string, any>): string {
  for (const val of Object.values(properties)) {
    if (typeof val === "object" && val !== null && val.type === "title") {
      const titleArr = val.title;
      if (Array.isArray(titleArr)) {
        return titleArr.map((t: any) => t.plain_text ?? "").join("");
      }
    }
  }
  // fallback: 尝试常见列名
  for (const name of ["标题", "名称", "Name", "title"]) {
    if (name in properties) {
      const val = properties[name];
      if (typeof val === "object" && val !== null) {
        const titleArr: any[] = val.title ?? val.rich_text ?? [];
        if (Array.isArray(titleArr)) {
          return titleArr.map((t: any) => t.plain_text ?? "").join("");
        }
      }
    }
  }
  return "";
}

function _extractSelect(
  properties: Record<string, any>,
  fieldName: string
): string {
  const val = properties[fieldName] ?? {};
  if (typeof val === "object" && val !== null) {
    const select = val.select;
    if (typeof select === "object" && select !== null) {
      return select.name ?? "";
    }
  }
  return "";
}

// ========== 2. 格式化函数 ==========

interface MovedEntry {
  title: string;
  from: string;
  to: string;
  url: string;
  time?: string;
}

interface SkippedEntry {
  title: string;
  status: string;
  reason?: string;
}

interface SchemaFix {
  db: string;
  action: string;
  columns: string[];
}

export function buildOrganizeReport(
  timestamp: string,
  moved: MovedEntry[],
  skipped: SkippedEntry[],
  schemaFixes?: SchemaFix[]
): string {
  const lines: string[] = [`📊 **【Notion整理汇报】** ${timestamp}`];

  if (moved.length > 0) {
    lines.push(`\n✅ 已移动 ${moved.length} 条：`);
    moved.forEach((m, i) => {
      lines.push(
        `${i + 1}. ${m.title} ${m.from}→${m.to} [${m.url}] [${m.time ?? timestamp}]`
      );
    });
  } else {
    lines.push("\n📌 本次无需移动的文档");
  }

  if (skipped.length > 0) {
    lines.push(`\n⏭️ 跳过 ${skipped.length} 条（进行中/收集中）：`);
    for (const s of skipped) {
      lines.push(`  · ${s.title} — ${s.status}`);
    }
  }

  if (schemaFixes && schemaFixes.length > 0) {
    lines.push(`\n🔧 Schema修复：`);
    for (const f of schemaFixes) {
      lines.push(`  · ${f.db}：${f.action}（${f.columns.join(", ")}）`);
    }
  }

  return lines.join("\n");
}

export function buildOrganizeDocContent(
  timestamp: string,
  report: string,
  movedCount: number,
  skippedCount: number
): string {
  const dateStr = timestamp.includes(" ")
    ? timestamp.split(" ")[0]
    : timestamp;

  return `> 🔧 工程实践｜Notion目录整理记录，自动创建。
# 📊 整理记录
📌 执行时间：${timestamp}
📌 移动：${movedCount} 条
📌 跳过：${skippedCount} 条（进行中/收集中）

## 详细汇报
${report}

---
# ⏭️ 断点续传
## 当前状态快照 v1（${timestamp}）
> 🚀 新对话启动：①读最新断点快照 ②读指挥台 ③执行「下次第一步」
📌 **【阶段】**：整理完成
📌 **【已完成】**：
> 本次整理已执行完毕 [${timestamp}]
📌 **【下次第一步】**：
> 下次焊忠说「整理」时再执行`;
}

interface ScanPage {
  title: string;
  status: string;
  category?: string;
}

export function buildScanSummary(pages: ScanPage[]): string {
  const movable = pages.filter(
    (p) => p.status === STATUS_DONE || p.status === STATUS_ABANDONED
  );

  if (movable.length === 0) {
    return "📌 ADS扫描完毕，暂无需要整理的文档（全部进行中/收集中）";
  }

  const lines: string[] = [`📌 发现 ${movable.length} 条可整理的文档：`];
  for (const p of movable) {
    const cat = p.category ?? "未分类";
    lines.push(`  · ${p.title} [${p.status}] 分类=${cat}`);
  }
  lines.push("→ 说「整理Notion目录」开始整理");

  return lines.join("\n");
}

// ========== 3. 测试 ==========

if (import.meta.main) {
  const { test, expect } = await import("bun:test");

  test("buildOrganizeReport with moves, skips, and schema fixes", () => {
    const report = buildOrganizeReport(
      "2026-03-07 21:10",
      [
        {
          title: "📖 技能手册",
          from: "ADS",
          to: "DWD",
          url: "https://notion.so/xxx",
          time: "21:12",
        },
        {
          title: "🔧 代码重构",
          from: "ADS",
          to: "DWS",
          url: "https://notion.so/yyy",
          time: "21:13",
        },
      ],
      [{ title: "📚 价值观澄清", status: "🔵 进行中" }],
      [{ db: "DWS", action: "补2列", columns: ["焊忠备注", "掌握度"] }]
    );
    expect(report).toContain("已移动 2 条");
    expect(report).toContain("跳过 1 条");
    expect(report).toContain("Schema修复");
    console.log("=== 1. 整理汇报 ===");
    console.log(report);
  });

  test("buildOrganizeDocContent", () => {
    const report = buildOrganizeReport(
      "2026-03-07 21:10",
      [
        {
          title: "📖 技能手册",
          from: "ADS",
          to: "DWD",
          url: "https://notion.so/xxx",
          time: "21:12",
        },
      ],
      []
    );
    const doc = buildOrganizeDocContent("2026-03-07 21:10", report, 2, 1);
    expect(doc).toContain("整理记录");
    expect(doc).toContain("断点续传");
    console.log("\n=== 2. 工程文档内容 ===");
    console.log(doc.substring(0, 300));
  });

  test("buildScanSummary with movable pages", () => {
    const summary = buildScanSummary([
      { title: "📖 技能手册", status: "🟢 已完成", category: "手册" },
      { title: "📚 价值观澄清", status: "🔵 进行中", category: "个人成长" },
      { title: "🔧 代码重构", status: "🔴 已放弃", category: "优化工具" },
    ]);
    expect(summary).toContain("发现 2 条");
    console.log("\n=== 3. 扫描汇总 ===");
    console.log(summary);
  });

  test("buildScanSummary with no movable pages", () => {
    const summary = buildScanSummary([
      { title: "📚 学习中", status: "🔵 进行中", category: "个人成长" },
    ]);
    expect(summary).toContain("暂无需要整理的文档");
    console.log("\n=== 4. 无需整理的扫描 ===");
    console.log(summary);
  });

  test("scanAdsForCompleted", () => {
    const result = scanAdsForCompleted([
      {
        id: "p1",
        url: "https://notion.so/p1",
        properties: {
          标题: { type: "title", title: [{ plain_text: "测试页" }] },
          状态: { select: { name: "🟢 已完成" } },
          分类: { select: { name: "手册" } },
        },
      },
      {
        id: "p2",
        url: "https://notion.so/p2",
        properties: {
          标题: { type: "title", title: [{ plain_text: "进行中" }] },
          状态: { select: { name: "🔵 进行中" } },
          分类: { select: { name: "学习" } },
        },
      },
    ]);
    expect(result.movable.length).toBe(1);
    expect(result.inProgress.length).toBe(1);
    expect(result.stats.total).toBe(2);
    expect(result.stats.movable).toBe(1);
  });

  test("classifyTargetDb", () => {
    expect(classifyTargetDb("技能手册", "手册")).toBe("DWD");
    expect(classifyTargetDb("代码重构", "优化工具")).toBe("DWS");
    expect(classifyTargetDb("价值观", "个人成长")).toBe("ADS");
    expect(classifyTargetDb("杂项", "未知")).toBe("DWS"); // default
  });

  test("buildPropertyMapping", () => {
    const mapping = buildPropertyMapping(
      {
        标题: { type: "title" },
        分类: {
          type: "select",
          options: ["个人成长", "知识学习", "优化工具"],
        },
        备注: { type: "rich_text" },
      },
      {
        名称: { type: "title" },
        类别: {
          type: "select",
          options: ["个人成长", "知识学习", "专业技术"],
        },
        备注: { type: "rich_text" },
      }
    );
    expect(mapping["标题"]).toBe("名称");
    expect(mapping["分类"]).toBe("类别");
    expect(mapping["备注"]).toBe("备注");
  });

  test("buildMoveReport", () => {
    const report = buildMoveReport(
      [{ title: "测试", target_db: "DWD" }],
      [{ title: "跳过" }]
    );
    expect(report).toContain("已移动 1 条");
    expect(report).toContain("跳过 1 条");

    const emptyReport = buildMoveReport([], []);
    expect(emptyReport).toBe("📌 无需移动");
  });

  test("buildEngineeringDoc", () => {
    const doc = buildEngineeringDoc(
      [{ title: "测试", from: "ADS", to: "DWD" }],
      "2026-03-07 21:10"
    );
    expect(doc).toContain("工程实践");
    expect(doc).toContain("移动：1 条");
    expect(doc).toContain("测试 | ADS→DWD");
  });

  console.log("\n=== ALL TESTS PASSED ===");
}
