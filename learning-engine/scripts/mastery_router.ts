/**
 * mastery_router.ts — Three-Layer Mastery Routing
 * Version: 2026-03-04-1055
 *
 * Three layers with DIFFERENT mastery thresholds and exam requirements:
 *
 *   DWD (扫过·知道门在哪): Target 30-40%, stop at 40%
 *   DWS (能讲出来·能复述): Target 60-70%, stop at 65%
 *   ADS (深入掌握·随时复现): Target 85%+, strict exam
 */

import { STATUS_MAP, statusToEmoji } from "../../_shared/constants.ts";

// ── Layer definitions ───────────────────────────────────────────────────────

export const LAYER_DWD = "DWD";
export const LAYER_DWS = "DWS";
export const LAYER_ADS = "ADS";

export interface LayerConfigEntry {
  label: string;
  stopReviewThreshold: number;
  masteryTarget: number;
  examStrictness: string;
  description: string;
  forceDeepIfUserAsked: boolean;
}

export const LAYER_CONFIG: Record<string, LayerConfigEntry> = {
  [LAYER_DWD]: {
    label: "DWD · 扫过知道门在哪",
    stopReviewThreshold: 40.0,
    masteryTarget: 40.0,
    examStrictness: "light",
    description: "知道这个东西在这里，遇到问题知道来找就行",
    forceDeepIfUserAsked: true,
  },
  [LAYER_DWS]: {
    label: "DWS · 能讲出来能复述",
    stopReviewThreshold: 65.0,
    masteryTarget: 65.0,
    examStrictness: "medium",
    description: "能用自己的话讲出来，知道结构，不要求随时复现",
    forceDeepIfUserAsked: true,
  },
  [LAYER_ADS]: {
    label: "ADS · 深入掌握随时复现",
    stopReviewThreshold: 85.0,
    masteryTarget: 85.0,
    examStrictness: "strict",
    description: "深入理解，随时能复现，用户主动学习的知识点",
    forceDeepIfUserAsked: true,
  },
};

// ── Knowledge point with layer assignment ───────────────────────────────────

export class LayeredKnowledgePoint {
  id: string;
  title: string;
  layer: string;
  score: number;
  userAsked: boolean;
  lastTested: string | null;
  anglesPassed: string[];

  constructor(
    id: string,
    title: string,
    layer: string = LAYER_DWD,
    score = 0.0,
    userAsked = false,
    lastTested: string | null = null,
    anglesPassed: string[] = [],
  ) {
    this.id = id;
    this.title = title;
    this.layer = layer;
    this.score = score;
    this.userAsked = userAsked;
    this.lastTested = lastTested;
    this.anglesPassed = anglesPassed;
  }

  get effectiveLayer(): string {
    if (this.userAsked && this.layer !== LAYER_ADS) return LAYER_ADS;
    return this.layer;
  }

  get config(): LayerConfigEntry {
    return LAYER_CONFIG[this.effectiveLayer];
  }

  get stopThreshold(): number {
    return this.config.stopReviewThreshold;
  }

  get needsReview(): boolean {
    return this.score < this.stopThreshold;
  }

  get examStrictness(): string {
    return this.config.examStrictness;
  }

  get statusEmoji(): string {
    let key: string;
    if (this.score === 0) key = "untouched";
    else if (this.score < this.stopThreshold) key = "learning";
    else if (this.score < 75) key = "tested";
    else if (this.score < 85) key = "mastered";
    else if (this.score >= 95) key = "internalized";
    else key = "mastered";
    return STATUS_MAP[key] ?? "⬜";
  }

  summaryLine(): string {
    const layerLabel = this.config.label;
    const askedTag = this.userAsked ? " ⭐用户问过" : "";
    return (
      `${this.statusEmoji} **${this.title}** | ` +
      `${this.score.toFixed(0)}% | ${layerLabel}${askedTag}`
    );
  }
}

// ── Router ──────────────────────────────────────────────────────────────────

export class MasteryRouter {
  points: Map<string, LayeredKnowledgePoint> = new Map();

  addPoint(
    pointId: string,
    title: string,
    layer: string = LAYER_DWD,
    initialScore = 0.0,
  ): LayeredKnowledgePoint {
    const kp = new LayeredKnowledgePoint(
      pointId,
      title,
      layer,
      initialScore,
    );
    this.points.set(pointId, kp);
    return kp;
  }

  markUserAsked(pointId: string): void {
    const kp = this.points.get(pointId);
    if (kp) kp.userAsked = true;
  }

  updateScore(
    pointId: string,
    newScore: number,
    angleId?: string,
  ): void {
    const kp = this.points.get(pointId);
    if (kp) {
      kp.score = newScore;
      if (angleId && !kp.anglesPassed.includes(angleId)) {
        kp.anglesPassed.push(angleId);
      }
    }
  }

  getExamQueue(): LayeredKnowledgePoint[] {
    const pending = [...this.points.values()].filter((kp) => kp.needsReview);
    pending.sort((a, b) => {
      const aPri = a.userAsked ? 0 : 1;
      const bPri = b.userAsked ? 0 : 1;
      if (aPri !== bPri) return aPri - bPri;
      return a.score - b.score;
    });
    return pending;
  }

  getExamPromptForPoint(
    kp: LayeredKnowledgePoint,
    _userAnswer = "",
  ): string {
    const strictness = kp.examStrictness;
    const layerDesc = kp.config.description;

    if (strictness === "light") {
      return `
知识点：${kp.title}
层级：${kp.config.label}（${layerDesc}）
当前分数：${kp.score.toFixed(0)}%  目标：${kp.stopThreshold.toFixed(0)}%

出题要求（轻量过关）：
- 出1-2题，确认用户见过这个概念、知道大概是什么就行
- 不需要深入追问
- 意思对就满分，顺带提标准词
- 到达${kp.stopThreshold.toFixed(0)}%后不再主动复习此点
`;
    } else if (strictness === "medium") {
      return `
知识点：${kp.title}
层级：${kp.config.label}（${layerDesc}）
当前分数：${kp.score.toFixed(0)}%  目标：${kp.stopThreshold.toFixed(0)}%

出题要求（中等深度）：
- 出2-3题，确认用户能用自己的话讲出来
- 不需要随时复现，但要能复述结构
- 意思对就满分，顺带提标准词
`;
    } else {
      // strict = ADS
      const askedTag = kp.userAsked ? "  ⭐用户主动问过" : "";
      return `
知识点：${kp.title}
层级：${kp.config.label}（${layerDesc}）${askedTag}
当前分数：${kp.score.toFixed(0)}%  目标：${kp.stopThreshold.toFixed(0)}%

出题要求（严格深入）：
- 必须覆盖L1→L2→L3三阶
- 5角度确认（反向推导/场景代入/类比迁移/边界测试/一句话精华）
- 意思对满分，顺带提标准词
- 答错→详细解释→确认懂了→再出角度题
- 目标：随时能复现，不只是认得出
`;
    }
  }

  sessionSummary(): string {
    if (!this.points.size) return "📌 暂无知识点记录";
    const lines: string[] = ["> 📊 **【知识点掌握度一览】**\n"];
    for (const layer of [LAYER_ADS, LAYER_DWS, LAYER_DWD]) {
      const pts = [...this.points.values()]
        .filter((kp) => kp.effectiveLayer === layer)
        .sort((a, b) => a.score - b.score);
      if (!pts.length) continue;
      lines.push(`>> **${LAYER_CONFIG[layer].label}**`);
      for (const kp of pts) {
        lines.push(`>> ${kp.summaryLine()}`);
      }
      lines.push("");
    }
    return lines.join("\n");
  }
}
