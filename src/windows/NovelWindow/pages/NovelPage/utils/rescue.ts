/**
 * 卡文救援的共享类型与小工具（R-AI-11）
 *
 * 放在 `utils/` 而不是某个组件里：浮层、卡片、编排 hook、页面层都要用同一份
 * 形状 —— 落点枚举写两遍就会漂（一处加 `newChapter`、另一处忘了加）。
 *
 * 边界：纯类型 + 纯函数，不 import React、不碰 store / IPC。
 */
import type { RescueStyle } from "@/shared/ai/context";

/** 风格旋钮的取值（产地仍在 prompt 域的 branch builder，这里只做转发） */
export type { RescueStyle };

/** 一条走向（三段结构，与 `BRANCH_OUTPUT_FORMAT` 字段一一对应） */
export interface RescueSegment {
  /** 走向标题 */
  title: string;
  /** 核心冲突 */
  conflict: string;
  /** 走向后果 */
  consequence: string;
}

/**
 * 采纳落点。
 *
 * `outlineCandidate`（存为大纲候选节点）已按 team-lead 裁定**退化**为
 * 「存为灵感 + 提示手动建节点」：`OutlinePanel` 没有候选态数据模型，
 * 本期不为它新增字段（架构 §2.1 裁定）。枚举值保留，文案按退化口径。
 */
export type RescueLanding =
  | "cursor"
  | "replaceSelection"
  | "newChapter"
  | "inspiration"
  | "outlineCandidate";

/** 落点顺序（`Select` 选项次序；正文类在前、沉淀类在后） */
export const RESCUE_LANDING_ORDER: readonly RescueLanding[] = [
  "cursor",
  "replaceSelection",
  "newChapter",
  "inspiration",
  "outlineCandidate",
];

/** 落点文案（UI 唯一产地） */
export const RESCUE_LANDING_LABELS: Record<RescueLanding, string> = {
  cursor: "插入光标处",
  replaceSelection: "替换选中段落",
  newChapter: "新建一章接着写",
  inspiration: "存为灵感速记",
  outlineCandidate: "存为大纲候选（转灵感）",
};

/** 落点的一句话说明（选到之后在下方提示，避免作者误以为落库了正文） */
export const RESCUE_LANDING_HINTS: Record<RescueLanding, string> = {
  cursor: "按勾选顺序拼进正文，光标落到最后一段末尾",
  replaceSelection: "用勾选的走向替换当前选中的正文（原文会被覆盖）",
  newChapter: "新建一章，把勾选的走向写进去，再从这一章接着写",
  inspiration: "只写进灵感速记，不动正文",
  outlineCandidate: "写入灵感速记，可在大纲手动建节点（不新增候选节点数据）",
};

/**
 * 一条「已插入」的记录（撤销的唯一依据，§3.2）。
 *
 * 为什么记区间而不是记「新章 / 批次 id」：正文是编辑器的普通文本，没有
 * 「AI 段落」这种结构。采纳那一刻的绝对偏移 + 当时写入的原文，是唯一能
 * 精确回滚的东西；`originalText` 还兼作「这段后来被作者改过没有」的判据。
 */
export interface RescueEdit {
  /** 本次采纳的批次（一次采纳一个 batchId，撤销按批次整批回滚） */
  batchId: string;
  /** 落到哪一章：切章后撤销必须拒绝（偏移是另一章的坐标） */
  chapterId: string;
  /** 改写类型：正文区间 / 灵感速记（灵感没有偏移，只有 noteId） */
  kind: "text" | "note";
  /** 正文区间起点（kind = "text" 时有效） */
  from: number;
  /** 正文区间终点（开区间） */
  to: number;
  /** 写入时的原文（撤销前比对，判断是否已被二次编辑） */
  originalText: string;
  /** 灵感速记 id（kind = "note" 时有效） */
  noteId?: string;
}

/** 一次救援会话：结果 + 批次 + 已插入记录 */
export interface RescueSession {
  /** 本批走向（作者一次勾选、一次插入用同一个 batchId） */
  batchId: string;
  /** 卡片（已按生成顺序编号 B1..B5） */
  segments: RescueSegment[];
  /** 已插入的记录（空 = 没有可撤的内容） */
  edits: RescueEdit[];
}

/** 中文序数（走向拼接时的编号，五位够用：条数上限是 5） */
const CN_NUMERALS = ["一", "二", "三", "四", "五"] as const;

/**
 * 把勾选的走向拼成可插入正文的**脚手架**文本。
 *
 * 刻意不写成成稿：三行结构（标题 / 冲突 / 后果）作者一眼就知道哪句是自己的，
 * 也方便他直接在下面接着写。写成六七百字正文反而要么照收、要么全删。
 */
export function composeSegmentsText(segments: readonly RescueSegment[]): string {
  return segments
    .map((segment, index) => {
      const numeral = CN_NUMERALS[index] ?? String(index + 1);
      return `${numeral}、${segment.title}\n冲突：${segment.conflict}\n后果：${segment.consequence}`;
    })
    .join("\n\n");
}

/** 勾选顺序拼接（§6.8：按**作者勾选顺序**，不是生成顺序） */
export function pickCheckedSegments(
  segments: readonly RescueSegment[],
  checkedKeys: readonly string[],
): RescueSegment[] {
  const picked: RescueSegment[] = [];
  for (const key of checkedKeys) {
    const index = Number(key);
    const segment = Number.isInteger(index) ? segments[index] : undefined;
    if (segment) picked.push(segment);
  }
  return picked;
}
