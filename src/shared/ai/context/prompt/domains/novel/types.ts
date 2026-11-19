/**
 * 小说域的 Prompt 类型（**唯一产地**）。
 *
 * `AiBookContext` 在这里，而不是像改造前那样写在 `context/collector.ts`：
 * 它是「这本书是什么」的域级形状，域内的段落 / 采集器 / 模板都要用它，
 * 放在采集器文件里会让「加一个域」与「采集器」耦合在一起（§8.3 判据 3）。
 *
 * 兼容：`context/collector.ts` 已降级为薄壳 `export *`，老 import 路径照旧可用。
 */
import type { NamingIntent } from "./builders/naming";
import type { PolishIntent } from "./builders/polish";
import type { TransformIntent } from "./builders/transform";
import type { ContinuationIntent } from "./builders/continuation";
import type { SummaryIntent } from "./builders/summary";
import type { ExtractIntent } from "./builders/extract";
import type { RelationIntent } from "./builders/relation";
import type { LevelGenIntent } from "./builders/level-gen";
import type { BranchIntent } from "./builders/branch";
import type { ConsistencyIntent } from "./builders/consistency";

/** 归一后的上下文（assembler 的输入） */
export interface AiBookContext {
  work: {
    name: string;
    genre?: string;
  };
  /** 要素摘要（naming 只带 type+name；polish 额外带 summary） */
  entities: Array<{
    type: string;
    name: string;
    summary?: string;
  }>;
  /** 境界名（仅 naming 采集） */
  realmLevels?: string[];
  /** 章节片段（仅 polish / transform / continuation 采集，已截断） */
  chapterSnippet?: string;
  /** 需避开的已用名（仅 naming 采集） */
  excludeNames?: string[];
}

/**
 * 小说域的意图 → 参数类型。
 *
 * 与 `domains/novel/index.ts` 的 `NOVEL_BUILDERS` 一一对应：加意图时这里加一个键，
 * 那张映射表与 `Record<NovelPromptIntent, …>` 的几张表会被编译器逼着补齐。
 *
 * ⚠️ 与 builders 是**类型层**互相引用（builders 从本文件取 `AiBookContext`）：
 * 双向都用 `import type`，运行期零环。
 */
export interface NovelPromptPayloadMap {
  naming: NamingIntent;
  polish: PolishIntent;
  transform: TransformIntent;
  continuation: ContinuationIntent;
  summary: SummaryIntent;
  extract: ExtractIntent;
  relation: RelationIntent;
  levelGen: LevelGenIntent;
  /** R-AI-11 卡文救援：给几条互不相同的后续走向 */
  branch: BranchIntent;
  /** R-AI-10b 一致性 AI 档：只判 10a 标「疑似」的残余 */
  consistency: ConsistencyIntent;
}

/** 小说域的意图名（唯一产地；采集器与注册表都从这里取） */
export type NovelPromptIntent = keyof NovelPromptPayloadMap;
