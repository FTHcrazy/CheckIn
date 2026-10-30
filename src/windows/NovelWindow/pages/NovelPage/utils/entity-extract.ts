/**
 * 实体抽取（R-AI-08）的纯逻辑：模型条目 → 候选卡
 *
 * 为什么单独成文件：这段逻辑决定「哪些条目能入库、哪些是重复、类型映射对不对」，
 * 每一条都是一个可以在单测里钉住的判断。塞进 `useNovelPage`（已 2000 行）里
 * 就只能靠组件测试间接覆盖，而这类判断恰恰最容易被后续改动悄悄改坏。
 *
 * 本文件不 import 任何 React / store / IPC。
 */
import type { AiEntry } from "@/shared/ai/context/output-spec";
import type { CustomEntityTypeDef, EntityType } from "@/shared/novel/entity-model";
import { stripWrappers } from "@/shared/novel/name-normalize";
import type { NovelEntity } from "../types";

/** 中文类型标签 → 内置类型 id（与 `EXTRACT_TYPE_LABELS` 同字面，单一产地是提示词） */
const BUILTIN_BY_LABEL: Record<string, EntityType> = {
  人物: "character",
  地点: "location",
  势力: "faction",
  物品: "item",
  境界体系: "level_system",
  其他: "custom",
};

/** 单条候选卡（面板渲染 + 批量入库的输入） */
export interface ExtractCandidate {
  /** 稳定 key：正文原样名字（同名只留一条） */
  key: string;
  name: string;
  type: EntityType;
  summary: string;
  evidence: string;
  /**
   * 已存在同名（或同别名）要素卡的 id。
   * 非空 = **不建卡**，只标「已存在」：重名入库要么产生两张同名卡，
   * 要么悄悄覆盖作者手写的简介，两种都不能接受（PRD 风险应对②）。
   */
  existingId: string | null;
  /** 默认勾选：新卡勾上、重复的不勾（作者想补一句话简介时可手动勾） */
  selected: boolean;
}

/**
 * 抽取面板的会话状态（hook 持有、面板渲染）。
 *
 * 定义放在这里而不是 hook 里：`useNovelPage` 与 `ExtractPanel` 都要用它，
 * 让两边同时 import 一个纯类型文件，避免「hook → 组件」的反向依赖。
 * `null` 表示「本次打开还没有结果」，与「抽出 0 条」是两件事。
 */
export interface ExtractSession {
  chapterId: string;
  chapterTitle: string;
  loading: boolean;
  error: string | null;
  candidates: ExtractCandidate[];
  /** 模型没吐出合法 JSON、走了启发式兜底（结果质量可能下降，面板要如实说） */
  usedFallback: boolean;
  /** 已入库张数：非 null 时面板显示「已建 N 张」 */
  applied: number | null;
}

/**
 * 把模型给的中文类型映射回类型 id。
 *
 * 三级回退：内置标签 → 用户自建类型名 → `custom`。**不猜**：
 * 认不出来就落「其他」，作者在候选列表里改一次比系统猜错类型再解释便宜。
 */
export function normalizeExtractType(
  label: string,
  customTypes: CustomEntityTypeDef[] = [],
): EntityType {
  const trimmed = label?.trim() ?? "";
  if (!trimmed) return "custom";
  const builtin = BUILTIN_BY_LABEL[trimmed];
  if (builtin) return builtin;
  // 自建类型：作者自己起的名字（如「功法」「丹药」）
  const custom = customTypes.find((item) => item.name.trim() === trimmed);
  if (custom) return custom.id;
  // 模型偶尔会错位回传类型 id（"character"），认就认，不认的一律 custom
  if (["character", "location", "faction", "item", "level_system", "custom"].includes(trimmed)) {
    return trimmed as EntityType;
  }
  return "custom";
}

/**
 * 名字归一：去空白、去模型爱加的包裹符号（书名号 / 引号 / 括号）。
 *
 * ⚠️ **只剥成对包裹，不剥「出现在尾部的单个右括号」**：
 * 早先的实现是 `/^[《「『"“'（(【\[]+/` + `/[》」』"”'）)】\]]+$/` 两个正则，
 * 于是「李玄（青冥宗）」会被削成「李玄（青冥宗」——左括号还在、右括号没了，
 * 建出来的卡名肉眼看着没问题，检索与去重全对不上。这类名字并不罕见：
 * 模型很爱把「名字（身份）」写成一条。
 *
 * 现在的规则按「整串是否被一对包裹符号包住」判断，单端孤立符号才单独剥。
 */
export function normalizeExtractName(raw: string): string {
  // 剥包裹的实现已上移到 `@/shared/novel/name-normalize`（R-AI-18 的等级名也要用
  // 同一套规则；两处各写一份正则必然漂移）。这里保留函数名，调用点不必改。
  return stripWrappers(raw);
}

/** 模型条数上限：与提示词里的 `limit` 对齐，防兜底解析产出几十条 */
const MAX_CANDIDATES = 30;

/**
 * 模型条目 → 候选卡列表。
 *
 * 三条硬规则：
 * 1. **同名只留一条**：模型常把同一个人在不同段落抽两次；
 * 2. **与已有卡重名的标 `existingId`**（名字或别名任一命中），默认不勾选；
 * 3. 名字为空 / 超长的直接丢：那不是设定项，是模型的解释性文字。
 */
export function buildExtractCandidates(
  entries: AiEntry[],
  params: {
    /** 本书已有要素卡（判重名用） */
    existing: NovelEntity[];
    /** 用户自建类型（映射类型名用） */
    customTypes?: CustomEntityTypeDef[];
    limit?: number;
  },
): ExtractCandidate[] {
  const limit = params.limit && params.limit > 0 ? Math.min(params.limit, MAX_CANDIDATES) : MAX_CANDIDATES;
  const customTypes = params.customTypes ?? [];

  const byName = new Map<string, NovelEntity>();
  for (const entity of params.existing) {
    const name = entity.name?.trim();
    if (name) byName.set(name, entity);
    for (const alias of entity.aliases ?? []) {
      const trimmed = alias?.trim();
      if (trimmed && !byName.has(trimmed)) byName.set(trimmed, entity);
    }
  }

  const seen = new Set<string>();
  const candidates: ExtractCandidate[] = [];

  for (const entry of entries) {
    const name = normalizeExtractName(entry.name ?? "");
    // 1 字名字在中文里几乎全是虚词 / 泛称；> 12 字基本是模型把解释写进了名字
    if (name.length < 2 || name.length > 12) continue;
    if (seen.has(name)) continue;
    seen.add(name);

    const existing = byName.get(name) ?? null;
    candidates.push({
      key: name,
      name,
      type: normalizeExtractType(entry.type ?? "", customTypes),
      summary: (entry.summary ?? "").trim(),
      evidence: (entry.evidence ?? "").trim(),
      existingId: existing?.id ?? null,
      selected: existing === null,
    });

    if (candidates.length >= limit) break;
  }

  return candidates;
}
