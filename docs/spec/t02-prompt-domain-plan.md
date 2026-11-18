# T02 · Prompt 架构泛化 —— 可执行落地方案

> 状态：已落地（C1/C2/C3 均通过 tsc 与全量测试；类型折叠方案经探针实编译验证）
> 输入：`docs/spec/interview-db-ai-spec.md` §8（目标形态与六条可扩展性判据）
> 基线：2.62.0（本方案订立时的应用版本）
> 上游权威设计：`docs/spec/interview-db-ai-spec.md` §8（431–502 行）。本文只做**可执行细化**，
> 不改目标形态；凡与 §8 有偏差的地方都在 §7 单列并说明理由。
>
> 本文所有类型写法都在 `.tmp-type-probe/probe.ts` 里用
> `npx tsc --noEmit --ignoreConfig --strict --verbatimModuleSyntax --erasableSyntaxOnly --noUnusedLocals --noUnusedParameters --target es2023 --module esnext --moduleResolution bundler --skipLibCheck .tmp-type-probe/probe.ts`
> 编译通过（含 6 条 `@ts-expect-error` 反向断言 + 1 条 `UniqueIntentsAssertion` 断言，`EXIT=0`）。
>
> ⚠️ `.gitignore` 里**没有** `.tmp-*` 规则，所以那个探针目录目前是 untracked 的：
> 提交前请删掉它，或补一行 `.tmp-*`（`.gitignore` 不属本任务范围，需你决定）。

---

## 0. 一句话结论

`intent → ctx` 的类型折叠**不需要 `any`，也不需要代码生成**：
域模块挂两个只存在于类型层的幽灵字段（`ctxBrand` / `payloadBrand`），
`DOMAINS` 元组用「条件类型分发 + 索引访问」折叠出 `PromptIntent` / `PromptIntentMap` / `CtxOfIntent`，
运行期用一次显式擦除把 `DOMAINS` 铺平成三张表。

四条硬约束的落地结论：

| 约束 | 结论 |
|---|---|
| 1. 调用写法一字不改 | ✅ `buildPromptSpec("naming", context, { count: 3 })` 原样编译；`context` 仍是 `AiBookContext` |
| 2. `prompt.test.ts` 断言不删不放松 | ✅ 只改 import 路径 + 遍历源，新增 4 条 `it()` |
| 3. 五个符号仍可从 `registry.ts` / `index.ts` 双路 import | ✅ `registry.ts` 降级为 3 行 `export { … } from "./index"` |
| 4. 禁改 `output-spec.ts` / `shared/ai` 之外的生产文件 | ✅ 唯一例外见 §7.1（`guide-doc.test.ts` 是测试文件，且已给出不失效的过滤判据） |

---

## 1. 类型方案全文（探针已验证）

### 1.1 `src/shared/ai/context/prompt/types.ts`（重写）

```ts
/**
 * Prompt 组装的公共类型
 *
 * `PromptSpec` 是「模板层」与「服务层」之间唯一的契约：模板只负责把内容拼成
 * 这一份结构，服务层原样消费（拼请求、按 `outputFormat` 解析），双方都不解释
 * 对方的业务语义。
 *
 * 本文件是**所有业务域的上游**：只放跨域共用的东西（PromptSpec / 最小卡片形状 /
 * 域模块接口 / 折叠用的类型工具）。任何业务域的上下文类型都不许往这里放——
 * 那会让「新增一个域」又要回来改这个文件（§8.3 判据 2）。
 */
import type { AiDataLevel } from "../../ai-consent";
import type { OutputFormat } from "../output-spec";

/** 组装结果：服务层原样消费，不解释业务语义 */
export interface PromptSpec {
  /** 系统提示词：角色 + 上下文 + 约束 + 输出契约 */
  system: string;
  /** 用户提示词主体（描述 / 待润色原文） */
  prompt: string;
  /** 期望输出格式（由服务层按此解析） */
  outputFormat: OutputFormat;
  /** 期望条目数（json-array 场景） */
  count?: number;
}

/**
 * 本段命中的人物卡（由 collector.matchEntitiesInText 筛好，模板只负责排版）。
 *
 * 留在公共层而不是小说域：它是「一张卡最小长什么样」的跨域约定（name/type/summary
 * 三个字段没有任何小说语义），挪进小说域只会让 polish/transform/continuation 的
 * payload 类型多一层间接。
 */
export interface CharacterRef {
  name: string;
  type: string;
  summary?: string;
}

/**
 * 一个业务域的 Prompt 模块 —— **唯一登记单元**。
 *
 * 加一个域 = 写一个实现本接口的常量 + 在 `domains/index.ts` 的 `DOMAINS` 里加一项，
 * 不改任何既有域的文件、不改任何 `Record<…>` 字面量（§8.3 判据 2）。
 *
 * 三个类型参数的第三个（`Payloads`）是 §8.2 签名的一处必要细化：文档写的
 * `PromptPayloadOf<K>` 是**全局**折叠结果，而它又由 `DOMAINS` 折叠而来——
 * 若把全局类型塞回接口，`types.ts` 就要 import `DOMAINS`，构成
 * 「基础设施依赖注册表」的倒挂 + 类型环。让域自己带上 payload 表即可解环，
 * 对外的 `PromptPayloadOf<K>` 语义与文档完全一致。
 */
export interface PromptDomainModule<
  Ids extends string,
  Ctx,
  Payloads extends Record<Ids, unknown>,
> {
  /** 域标识：'novel' | 'interview' | 'ledger' …（日志与排障用，不参与类型折叠） */
  readonly domain: string;
  /** 本域实现的意图名；顺序 = `PROMPT_INTENTS` 的顺序 */
  readonly intents: readonly Ids[];
  /** 按意图组装；`ctx` 由本域自己定，跨域误传在编译期就红 */
  build<K extends Ids>(intent: K, ctx: Ctx, payload: Payloads[K]): PromptSpec;
  /** 意图中文标签（不是域标签）。漏一个 = 编译错误 */
  readonly labels: Record<Ids, string>;
  /** 模板版本（落 `ai_log.prompt_version`）。漏一个 = 编译错误 */
  readonly versions: Record<Ids, string>;
  /** 本域合法数据分级；不许声明用不上的分级（面试域只能 L1/L2） */
  readonly allowedLevels: readonly AiDataLevel[];
  /**
   * 幽灵字段：**只在类型层存在，运行期永不赋值**。
   * 存在的唯一目的是让折叠层能从值反推「这个域的 ctx 是什么类型」。
   */
  readonly ctxBrand?: Ctx;
  /** 幽灵字段：同上，用来反推 payload 表 */
  readonly payloadBrand?: Payloads;
}

/* ────────────────────────── 折叠工具（纯类型） ────────────────────────── */

/** `DOMAINS` 的形状约束（域元组） */
export type AnyDomainTuple = readonly unknown[];

/** 域模块的 ctx 类型。optional 幽灵字段经 `infer` 取到的是 `Ctx`，不会漏 `undefined`（探针 §3 已断言） */
export type DomainCtx<M> = M extends { readonly ctxBrand?: infer C } ? C : never;

/** 域模块声明的意图联合 */
export type DomainIntents<M> = M extends { readonly intents: readonly (infer I)[] }
  ? Extract<I, string>
  : never;

/** 域模块的 payload 表 */
export type DomainPayloads<M> = M extends { readonly payloadBrand?: infer P } ? P : never;

/** 全部已实现意图（跨域并集） */
export type IntentsOfDomains<Ds extends AnyDomainTuple> = DomainIntents<Ds[number]>;

/**
 * intent → 拥有它的域模块。
 *
 * 逐成员分发再取并：意图名全局唯一时结果是**单个**模块；一旦两个域声明了同名
 * 意图，这里会塌成「两个模块的并集」，该意图的 ctx 随之变成 `A | B` —— 于是
 * `PROMPT_BUILDERS` 的类型检查（strictFunctionTypes：函数参数逆变）与下面的
 * `UniqueIntentsAssertion` 都会失败。**「意图全局唯一」是编译期保证，不是约定。**
 */
export type DomainOfIntent<Ds extends AnyDomainTuple, K extends string> =
  Ds[number] extends infer D
    ? D extends unknown
      ? K extends DomainIntents<D>
        ? D
        : never
      : never
    : never;

/** intent → 该意图的 ctx 类型 */
export type CtxOfIntent<Ds extends AnyDomainTuple, K extends string> = DomainCtx<
  DomainOfIntent<Ds, K>
>;

/** intent → 该意图的 payload 类型 */
export type PayloadOfIntent<Ds extends AnyDomainTuple, K extends string> = DomainPayloads<
  DomainOfIntent<Ds, K>
>[K & keyof DomainPayloads<DomainOfIntent<Ds, K>>];

/** 某个域里与**其它**域重名的意图 */
export type DuplicateIntentsOf<Ds extends AnyDomainTuple, M> = Extract<
  DomainIntents<M>,
  DomainIntents<Exclude<Ds[number], M>>
>;

/**
 * 意图名全局唯一检查：结果 `never` = 唯一。
 *
 * 第二个类型参数只为触发逐成员分发，调用方不要传。
 */
export type DuplicateIntents<Ds extends AnyDomainTuple, Ms = Ds[number]> = Ms extends unknown
  ? DuplicateIntentsOf<Ds, Ms>
  : never;

/**
 * 编译期断言：意图名必须全局唯一。
 * 用法见 `domains/index.ts` 的 `DOMAINS_HAVE_UNIQUE_INTENTS`——
 * 一旦重名，那行赋值会报「类型 `["意图名在多个域重复登记", …]` 不能赋给 `true`」。
 */
export type UniqueIntentsAssertion<Ds extends AnyDomainTuple> = [
  DuplicateIntents<Ds>,
] extends [never]
  ? true
  : ["意图名在多个域重复登记", DuplicateIntents<Ds>];
```

### 1.2 `src/shared/ai/context/prompt/domains/index.ts`（新建，**唯一登记处**）

```ts
/**
 * 业务域登记表 —— **加一个域只改这个文件的 2 行**（§8.3 判据 2）。
 *
 * 顺序即 `PROMPT_INTENTS` 的顺序，也是看板 / 日志里意图的展示顺序。
 */
import type { PromptDomainModule, UniqueIntentsAssertion } from "../types";
import { novelPromptDomain } from "./novel";
import { interviewPromptDomain } from "./interview";

export const DOMAINS = [novelPromptDomain, interviewPromptDomain] as const;

/**
 * 编译期断言：意图名全局唯一。
 *
 * 为什么需要一条**显式**断言：`PROMPT_BUILDERS` 的运行时构造绕不过一次
 * `as` 断言（`Object.fromEntries` 的返回值 TS 无法核对成映射类型），
 * 光靠赋值兼容性兜不住重名。这条断言把「重名」钉死在 `tsc` 里。
 */
export const DOMAINS_HAVE_UNIQUE_INTENTS: UniqueIntentsAssertion<typeof DOMAINS> = true;

/**
 * 小说域的意图标签。
 *
 * 存在的唯一目的：`src/shared/novel/guide-doc.test.ts` 的「每个 AI 意图都要在
 * 用户手册里有词条」守卫，必须**只对小说域生效**（面试题的帮助手册在题库窗口，
 * 不该被小说手册的守卫逼着写）。过滤源是域归属本身，不是一份硬编码意图名单。
 */
export const NOVEL_INTENT_LABELS = novelPromptDomain.labels;

/** 域模块的联合类型（`PROMPT_INTENTS` / 测试遍历用） */
export type AnyPromptDomain = PromptDomainModule<string, unknown, Record<string, unknown>>;
```

> `import { interviewPromptDomain } from "./interview"` 这一行在 commit 3 才存在。
> commit 2 时 `DOMAINS` 只有 `[novelPromptDomain]`，行为与现在**完全等价**——这是本方案
> 最重要的可验证中间态（见 §6）。

### 1.3 `src/shared/ai/context/prompt/index.ts`（重写：折叠 + 出口）

```ts
/**
 * Prompt 层统一出口（所有 AI 提示词的唯一入口）
 *
 * 本文件做两件事：
 * 1. 把 `DOMAINS` 折叠成全局表（`PROMPT_BUILDERS` / `PROMPT_INTENTS` /
 *    `AI_INTENT_LABELS` / `PROMPT_VERSIONS`）与 `intent → ctx` 类型映射；
 * 2. 把各域的模板与段落原样 re-export（调用方的历史 import 路径不变）。
 *
 * ⚠️ 新增 AI 功能 = 在**自己的域**里写 builder 并在域出口登记；
 * 加一个全新业务域 = 只改 `domains/index.ts` 两行，不碰本文件。
 */
import type { AiDataLevel } from "../../ai-consent";
import type {
  CtxOfIntent,
  IntentsOfDomains,
  PayloadOfIntent,
  PromptSpec,
} from "./types";
import { DOMAINS } from "./domains";

/** `DOMAINS` 的元组类型 —— 下面所有折叠的唯一输入 */
type Domains = typeof DOMAINS;

/** 全部已实现的意图名 */
export type PromptIntent = IntentsOfDomains<Domains>;

/** 意图 → 参数类型 */
export type PromptIntentMap = { [K in PromptIntent]: PayloadOfIntent<Domains, K> };

/** 意图 → 上下文类型（域自己定；跨域误传编译期报错） */
export type PromptContextOf<K extends PromptIntent> = CtxOfIntent<Domains, K>;

/** 意图 → 参数类型（§8.2 的对外别名） */
export type PromptPayloadOf<K extends PromptIntent> = PromptIntentMap[K];

/* ─────────────────── 运行期折叠（擦除发生在这一处） ─────────────────── */

/**
 * 域模块的**运行期视角**：把泛型 `build` 擦成统一签名，供本文件铺平三张表。
 *
 * 擦除只在折叠内部发生，泄漏不到任何调用方：对外暴露的 `PROMPT_BUILDERS`
 * 仍是精确映射类型，`buildPromptSpec` 的 ctx 仍由 intent 决定。
 */
interface ErasedDomain {
  readonly domain: string;
  readonly intents: readonly string[];
  build(intent: string, ctx: unknown, payload: unknown): PromptSpec;
  readonly labels: Record<string, string>;
  readonly versions: Record<string, string>;
  readonly allowedLevels: readonly AiDataLevel[];
}

const ERASED: readonly ErasedDomain[] = DOMAINS;

/** 模板清单：意图 → 组装函数（类型上保证参数与该意图匹配） */
type PromptBuilders = {
  [K in PromptIntent]: (context: PromptContextOf<K>, intent: PromptIntentMap[K]) => PromptSpec;
};

export const PROMPT_BUILDERS = Object.fromEntries(
  ERASED.flatMap((domain) =>
    domain.intents.map((intent) => [
      intent,
      (context: unknown, payload: unknown) => domain.build(intent, context, payload),
    ]),
  ),
) as PromptBuilders;
// ↑ 这次 `as` 是**唯一**一处绕过类型检查的地方，且不可消除：
//   Object.fromEntries 的返回类型是 Record<string, …>，TS 无法核对成映射类型。
//   它被三条守卫围住：DOMAINS_HAVE_UNIQUE_INTENTS（键唯一）、
//   PROMPT_INTENTS === Object.keys(PROMPT_BUILDERS)（键全量，见 prompt.test.ts）、
//   每个 builder 的入参类型由 PromptBuilders 精确约束（值不错位）。

/** 运行期遍历用（顺序 = DOMAINS 登记顺序） */
export const PROMPT_INTENTS = ERASED.flatMap((domain) => [
  ...domain.intents,
]) as readonly PromptIntent[];

/**
 * 意图 → 中文标签（看板 / 调用记录共用的单一产地，G7）。
 *
 * 语义仍是「**全量**意图」——包括非小说域。小说手册的守卫改由
 * `domains/index.ts` 的 `NOVEL_INTENT_LABELS` 限定范围，不要动这里的口径。
 */
export const AI_INTENT_LABELS = Object.assign(
  {} as Record<string, string>,
  ...ERASED.map((domain) => domain.labels),
) as Record<PromptIntent, string>;

/** 各意图的 prompt 模板版本（M7，落 `ai_log.prompt_version` / `ai_event.prompt_ver`） */
export const PROMPT_VERSIONS = Object.assign(
  {} as Record<string, string>,
  ...ERASED.map((domain) => domain.versions),
) as Record<PromptIntent, string>;

/** 按意图取 prompt 版本（未登记时返回空串，调用方按「版本未知」处理） */
export function promptVersionOf(intent: string): string {
  return (PROMPT_VERSIONS as Record<string, string>)[intent] ?? "";
}

/**
 * 按意图组装 Prompt。
 *
 * `ctx` 的类型由 `intent` 决定：小说 8 个意图 → `AiBookContext`，面试 3 个 →
 * `InterviewPromptContext`。把小说上下文喂给 `interviewExplain` 是编译错误。
 */
export function buildPromptSpec<K extends PromptIntent>(
  intent: K,
  context: PromptContextOf<K>,
  payload: PromptIntentMap[K],
): PromptSpec {
  const builder = PROMPT_BUILDERS[intent];
  return builder(context, payload);
}

/* ─────────────────────────── 域与登记表 ─────────────────────────── */

export {
  DOMAINS,
  DOMAINS_HAVE_UNIQUE_INTENTS,
  NOVEL_INTENT_LABELS,
  type AnyPromptDomain,
} from "./domains";

/* ─────────────── 模板与段落（历史 import 路径保持不变） ─────────────── */

// ⚠️ 下面这段必须与改造前的 49 个导出（35 个值 + 14 个类型）逐一对齐：
//    `src/shared/ai/context/index.ts:29-79` 就是从这两个文件取符号的，
//    少一个 = context 桶编译失败 = 半个应用红。
export { assembleNamingSpec, type NamingIntent } from "./domains/novel/builders/naming";
export { assemblePolishSpec, type PolishIntent } from "./domains/novel/builders/polish";
export {
  assembleTransformSpec,
  TRANSFORM_KIND_LABELS,
  TRANSFORM_INTENT_SUB,
  type TransformIntent,
  type TransformKind,
} from "./domains/novel/builders/transform";
export {
  assembleContinuationStreamSpec,
  CONTINUATION_STREAM_OUTPUT_FORMAT,
  CONTINUATION_SUMMARY_MIN_BEFORE_CHARS,
  type ContinuationIntent,
} from "./domains/novel/builders/continuation";
export {
  assembleSummarySpec,
  parseSummaryReply,
  SUMMARY_BODY_HEAD,
  SUMMARY_ONE_LINER_HEAD,
  type SummaryIntent,
  type SummaryReply,
} from "./domains/novel/builders/summary";
export {
  assembleExtractSpec,
  EXTRACT_OUTPUT_FORMAT,
  EXTRACT_TYPE_LABELS,
  type ExtractIntent,
} from "./domains/novel/builders/extract";
export {
  assembleRelationSpec,
  RELATION_CONFIDENCE_VALUES,
  RELATION_OUTPUT_FORMAT,
  type RelationIntent,
} from "./domains/novel/builders/relation";
export {
  assembleLevelGenSpec,
  clampLevelCount,
  LEVEL_OUTPUT_FORMAT,
  type LevelGenIntent,
  type LevelGenMode,
} from "./domains/novel/builders/level-gen";

// 小说域出口（域模块 + 三张域内表 + 语境类型）
export { novelPromptDomain, NOVEL_INTENTS, NOVEL_PROMPT_VERSIONS } from "./domains/novel";
export type {
  AiBookContext,
  NovelPromptIntent,
  NovelPromptPayloadMap,
} from "./domains/novel/types";

// 面试域出口（T02 新增）
export { interviewPromptDomain, INTERVIEW_INTENTS } from "./domains/interview";
export { INTERVIEW_INTENT_LABELS } from "./domains/interview";
export {
  assembleExplainSpec,
  EXPLAIN_ONE_LINER_HEAD,
  EXPLAIN_BODY_HEAD,
} from "./domains/interview/builders/explain";
export {
  assembleDraftSpec,
  clampDraftCount,
  DRAFT_OUTPUT_FORMATS,
  DIAGRAM_KIND_SHAPE_HINT,
} from "./domains/interview/builders/draft";
export {
  assembleAuditSpec,
  AUDIT_OUTPUT_FORMAT,
  AUDIT_SEVERITIES,
  AUDIT_SEVERITY_LABELS,
} from "./domains/interview/builders/audit";
export { collectInterviewContext, INTERVIEW_LIMITS } from "./domains/interview/collector";
export type {
  InterviewAuditPayload,
  InterviewAuditTarget,
  InterviewCategoryRef,
  InterviewDraftPayload,
  InterviewExplainPayload,
  InterviewPromptContext,
  InterviewPromptIntent,
  InterviewPromptPayloadMap,
} from "./domains/interview/types";

// 段落：kit（跨域通用）+ 小说域段落
export {
  chapterBlock,
  composePrompt,
  constraintBlock,
  jsonArrayFormat,
  kvBlock,
  outputBlock,
  requirementBlock,
  roleBlock,
} from "./kit";
export {
  characterBlock,
  entityBlock,
  realmBlock,
  workBlock,
} from "./domains/novel/sections";

export type { CharacterRef, PromptSpec } from "./types";
```

### 1.4 `src/shared/ai/context/prompt/registry.ts`（降级为兼容薄壳）

```ts
/**
 * ⚠️ 兼容薄壳（T02）：真正的折叠在 `./index`。
 *
 * 为什么保留：`promptVersionOf` 被 `electron/handlers/ai/ai-handlers.ts:28` 直接引用
 * （主进程不能反向依赖渲染层的桶文件），另有 3 个测试从本路径 import。
 * 一个版本内保持路径可用，下一版统一改到 `@/shared/ai/context/prompt` 后删除。
 *
 * **新代码不要往这里加东西**，直接 import `./index`。
 */
export {
  AI_INTENT_LABELS,
  PROMPT_BUILDERS,
  PROMPT_INTENTS,
  PROMPT_VERSIONS,
  buildPromptSpec,
  promptVersionOf,
  type PromptContextOf,
  type PromptIntent,
  type PromptIntentMap,
  type PromptPayloadOf,
} from "./index";
```

> 无环：`index.ts` 不 import `registry.ts`（探针已验证同构写法可编译）。

### 1.5 折叠出来的东西长什么样（对照表）

| 符号 | 折叠表达式 | 结果 |
|---|---|---|
| `PromptIntent` | `IntentsOfDomains<Domains>` | `"naming" \| … \| "levelGen" \| "interviewExplain" \| "interviewDraft" \| "interviewAudit"`（11 个） |
| `PromptIntentMap[K]` | `PayloadOfIntent<Domains, K>` | `"naming"` → `NamingIntent`；`"interviewDraft"` → `InterviewDraftPayload` |
| `PromptContextOf<K>` | `CtxOfIntent<Domains, K>` | 小说 8 个 → `AiBookContext`；面试 3 个 → `InterviewPromptContext` |
| `PROMPT_BUILDERS` | `{[K in PromptIntent]: (ctx: PromptContextOf<K>, payload: PromptIntentMap[K]) => PromptSpec}` | 与原形状**逐字节等价**，调用点零感知 |
| `PROMPT_INTENTS` | `ERASED.flatMap(d => d.intents)` | `readonly PromptIntent[]`，顺序 = `DOMAINS` |
| `AI_INTENT_LABELS` | `Object.assign({}, ...domains.map(d => d.labels))` | `Record<PromptIntent, string>`，11 键 |
| `PROMPT_VERSIONS` | 同上（`versions`） | 11 键 |
| `promptVersionOf` | 未改 | `(intent: string) => string` |
| `buildPromptSpec` | 未改签名，`ctx` 改为 `PromptContextOf<K>` | 调用点零感知 |

**探针里跑过的 6 条反向断言**（去掉任何一条都会有人踩）：

```ts
// @ts-expect-error 小说 ctx 不能喂给面试意图
buildPromptSpec("interviewExplain", bookCtx, { term: "闭包" });
// @ts-expect-error 面试 ctx 不能喂给小说意图
buildPromptSpec("naming", interviewCtx, { count: 3 });
// @ts-expect-error payload 与 intent 错配
buildPromptSpec("naming", bookCtx, { text: "原文。" });
// @ts-expect-error 未登记的意图
buildPromptSpec("notAnIntent", bookCtx, {});
// @ts-expect-error ctx 不许变「可空」：幽灵字段是 optional，但 infer 不会漏 undefined
buildPromptSpec("naming", undefined, { count: 3 });
// 同名 intent：UniqueIntentsAssertion 退化成错误元组（探针 §5 已断言）
```

---

## 2. 段落层拆分（kit vs 域）

### 2.1 判据

§8.3 判据 4 的字面是「`kit/` 只放**参数是字符串/数组**的段落」。**执行时按下面这条更准的判据**（两者不冲突，后者可判定）：

> `kit/` 的段落签名里**不许出现任何域的上下文 / payload 类型**；出现即属该域。
> 参数全是字符串但语义只属一个域的（如 `focusBlock` 的「选区」），按 §8.2 的目录归域文件。

### 2.2 十个既有段落的归属（逐条校验 team-lead 的表格）

| 段落 | 签名 | 归属 | 复核结论 |
|---|---|---|---|
| `roleBlock(text)` | `string` | **kit** | ✅ 正确 |
| `requirementBlock(string[])` | `string[]` | **kit** | ✅ 正确 |
| `constraintBlock(string[])` | `string[]` | **kit** | ✅ 正确 |
| `outputBlock(format)` | `OutputFormat` | **kit** | ✅ 正确（`OutputFormat` 是 `output-spec` 的跨域契约，不是域类型） |
| `composePrompt(...blocks)` | `string \| null \| undefined` 变参 | **kit** | ✅ 正确 |
| `chapterBlock(snippet?, note)` | 全 `string` | **kit** | ✅ **同意你的判断**。补充一条理由：它的语义是「带标注的引文块」，虽然现在只被 polish/transform 用，但没有任何小说类型依赖；留在 kit 不增加耦合，且能挡住「第二个域再抄一份 `【…片段】`」 |
| `workBlock(context)` | 吃 `AiBookContext` | novel | ✅ 正确 |
| `entityBlock(context, note?)` | 吃 `AiBookContext` | novel | ✅ 正确 |
| `realmBlock(context, note?)` | 吃 `AiBookContext` | novel | ✅ 正确 |
| `characterBlock(refs, note?)` | 吃 `CharacterRef[]` | novel | ✅ 正确，但**判据要改口径**：`CharacterRef` 是 `prompt/types.ts` 的公共类型、不是小说 ctx，所以这条不能靠「参数是域类型」判；真正的理由是**语义**（人物卡 = 小说要素）。已按此写入 `domains/novel/sections.ts` |

**你要我复核的 `chapterBlock`：确认可进 kit**（见上表理由）。其余 9 条你的归属全对，只有 `characterBlock` 的判据需要从「吃域类型」改成「域语义」。

### 2.3 `kit/sections.ts` 完整代码

```ts
/**
 * 提示词通用段落（所有业务域共用）
 *
 * 为什么单独抽这一层：段落的**顺序与措辞**决定模型是否听话，如果每个功能各写
 * 一份，调优时就会「改了起名忘了润色」。这里把每一类**跨域**信息收敛成一个函数，
 * 域模板只管挑选与排序，不再手拼字面量。
 *
 * 准入门槛（§8.3 判据 4 的可执行版）：**签名里不许出现任何域的 ctx / payload 类型**。
 * 一旦某个段落要吃某个域的上下文，它就属于那个域，写进 `domains/<域>/sections.ts`。
 * 第三个域想复用某域段落 → 说明它引用了该域语义，必须自写，
 * 或把该段落重构成 `kvBlock(title, rows)` 后搬进来。
 *
 * 约定：
 * - 段落统一用 `【…】` 起头，让模型能区分「背景信息」与「硬约束」；
 * - 约束一律以 `- ` 开头的列表给出，比一整段祈使句更容易被遵循；
 * - 空数据返回 `null`（而不是空串），由 `composePrompt` 统一丢弃，
 *   避免拼出「【已有要素】」后面什么都没有的残句；
 * - 不做截断（截断是 collector 的职责）。
 */
import { buildOutputInstruction, type OutputField, type OutputFormat } from "../../output-spec";

/** 角色定位：整个 system prompt 的第一句，决定模型以什么身份作答 */
export function roleBlock(text: string): string {
  return text.trim();
}

/** 本次要求段（起名的类型 / 风格 / 性别等显式意图） */
export function requirementBlock(requirements: string[]): string | null {
  if (requirements.length === 0) return null;
  return `【本次要求】${requirements.join("；")}`;
}

/** 约束清单：统一成 `- xxx` 列表，空数组返回 null */
export function constraintBlock(lines: string[]): string | null {
  const cleaned = lines.map((line) => line.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  return cleaned.map((line) => `- ${line}`).join("\n");
}

/** 输出契约段：由 output-spec 统一产出，模板不许自己编格式要求 */
export function outputBlock(format: OutputFormat): string {
  return buildOutputInstruction(format);
}

/**
 * 按顺序拼段，丢弃空段。
 * 段落之间只留一个换行：prompt 里每个换行都是 token，而 `【…】` 标签已经
 * 足够让模型分段，不需要空行再撑一遍。
 */
export function composePrompt(...blocks: Array<string | null | undefined>): string {
  return blocks
    .map((block) => block?.trim())
    .filter((block): block is string => Boolean(block))
    .join("\n");
}

/**
 * 章节片段段：只给模型理解上下文，必须明说「不要输出它」。
 *
 * ⚠️ 迁移时**只许改文件位置，不许重写字符串**：`【本段所在章节片段（…）】`
 * 是 polish / transform 两条既有断言的比对目标（`prompt.test.ts` 的
 * `toContain("本段所在章节片段")`）。真要泛化成 `【${note}】`，是另一个 commit
 * 的事，且要同步改那 4 条断言。
 */
export function chapterBlock(snippet: string | undefined, note: string): string | null {
  if (!snippet) return null;
  return `【本段所在章节片段（${note}）】\n${snippet}`;
}

```ts
/**
 * 键值段：`【标题】` + 若干 `- 键：值`。
 *
 * 这是 §8.3 判据 4 的**落点**：某个域想把「自己的上下文」渲染成段落时，先看能不能
 * 压成 `[键, 值][]` —— 能压就搬进 kit，第二个域直接复用；压不成（值需要嵌套结构，
 * 或键本身就是域语义）就说明它属于那个域，自写。
 *
 * 空值行整行丢弃（和 constraintBlock 同款：宁可少一行，不要「- 标签：」的残句）。
 */
export function kvBlock(
  title: string,
  rows: ReadonlyArray<readonly [string, string]>,
  note?: string,
): string | null {
  const lines = rows
    .map(([key, value]) => [key.trim(), `${value ?? ""}`.trim()] as const)
    .filter(([key, value]) => Boolean(key) && Boolean(value))
    .map(([key, value]) => `- ${key}：${value}`);
  if (lines.length === 0) return null;
  const head = `【${title.trim()}】`;
  return note ? `${head}\n${lines.join("\n")}\n- ${note}` : `${head}\n${lines.join("\n")}`;
}

/**
 * json-array 契约工厂。
 *
 * 唯一目的：让新域不必记 `{ kind: "json-array", fields: […] }` 的字面量形状，
 * 也避免有人手写 `{kind:"json_array"}` 这种拼错到运行期才炸的键。
 */
export function jsonArrayFormat(fields: OutputField[]): OutputFormat {
  return { kind: "json-array", fields };
}
```

`kit/index.ts`：

```ts
export {
  chapterBlock,
  composePrompt,
  constraintBlock,
  jsonArrayFormat,
  kvBlock,
  outputBlock,
  requirementBlock,
  roleBlock,
} from "./sections";
```

### 2.4 `domains/novel/sections.ts`（4 个小说段落，原样搬）

```ts
/**
 * 小说域专属段落：吃 `AiBookContext` 的四块（作品背景 / 已有要素 / 境界 / 人物卡）。
 *
 * 为什么不进 kit：签名里出现 `AiBookContext`。第三个域想复用 → 它引用了小说语义，
 * 必须自写（§8.3 判据 4）。
 */
import type { CharacterRef } from "../../types";
import type { AiBookContext } from "./types";

export function workBlock(context: AiBookContext): string { /* 原样搬 */ }
export function entityBlock(context: AiBookContext, note?: string): string | null { /* 原样搬 */ }
export function realmBlock(context: AiBookContext, note?: string): string | null { /* 原样搬 */ }
export function characterBlock(characters: CharacterRef[] | undefined, note?: string): string | null { /* 原样搬 */ }
```

**注意**：`entityLine`（私有 helper）跟着搬进本文件，不导出。

---

## 3. 面试域三个 intent 的完整契约

### 3.1 `domains/interview/types.ts`

```ts
/**
 * 面试题库的 Prompt 上下文与意图参数
 *
 * 与小说域的关键差异：题库**不发送任何"作品正文"**，送的是题目 / 词条 / 分类
 * 这些「用户自己的知识资产」。所以 `allowedLevels` 只有 L1/L2（§8.2）。
 *
 * 枚举常量一律从 `src/shared/interview/payload-shape.ts` 取，不在这里抄字面量：
 * 那是产物类型的单一产地，抄一份必然漂移（§11 的整章教训）。
 */
import type {
  DiagramKindShape,
  InterviewKind,
  QuestionDifficultyShape,
  QuestionTrackShape,
} from "../../../../../interview/payload-shape";

/** 分类的一个只读视图（22 基线 + 已采纳的自定义分类） */
export interface InterviewCategoryRef {
  id: string;
  label: string;
  /** 分类说明（作者或 AI 写的一句约束；只对「当前分类」渲染，避免 prompt 膨胀） */
  note?: string;
}

/**
 * 面试域的上下文（**库级、跨次稳定**的那部分）。
 *
 * 分界线与小说域一致：`AiBookContext` 装的是「这本书是什么」，具体要处理的文本
 * 走 payload（polish 的 `text`、summary 的 `chapter`）。这里装的是「这个题库是什么」，
 * 划中的词 / 待检的题都走 payload —— 否则一次性解释气泡也要构造一整个库上下文。
 */
export interface InterviewPromptContext {
  /** 分类词表（已去重、已按 `INTERVIEW_LIMITS.categories` 截断） */
  categories: InterviewCategoryRef[];
  /** 题库规模（`coverageBlock` 的输入，也是「这个库多大」的锚点） */
  stats: {
    questions: number;
    glossaries: number;
    diagrams: number;
  };
  /** 已有题目标题（出题避重；已截断） */
  questionTitles: string[];
  /** 已有词条键（出词避重，含 aliases 归一后的键；已截断） */
  glossaryTerms: string[];
  /** 当前所在的分类（从分类页/详情页进入时才有） */
  activeCategoryId?: string;
}

/* ───────────────────────── 意图 1：划词解释 ───────────────────────── */

/** 划词解释的参数：一次划词的全部素材 */
export interface InterviewExplainPayload {
  /** 划中的词 / 短语（调用方已 trim、已按 2–12 中文 / 3–24 ASCII 过滤） */
  term: string;
  /** 词所在的上下文句（调用方按选区居中切片，建议 ≤120 字） */
  sentence?: string;
  /** 可选题干：从题目里划词时带上，解释才会贴题 */
  stem?: string;
  /** 词条库里已有同名词条的一句话定义（用于「补充释义」场景：不要复述它） */
  existingShort?: string;
}

/* ───────────────────────── 意图 2：AI 拓展 ───────────────────────── */

/**
 * AI 拓展的参数：出题 / 出词 / 出图共用。
 *
 * 为什么三合一而不是三个意图：三者的**上下文完全相同**（分类 / 已有标题 /
 * 库规模），差别只在输出契约。拆成三个意图会让 `AI_INTENT_LABELS` 多两行、
 * 让调用方多一个 switch，而落库口径本来就是 `interviewDraft:<kind>`（§7）。
 */
export interface InterviewDraftPayload {
  /** 产出类型，决定输出契约与角色定位 */
  kind: InterviewKind;
  /** 种子：题干片段 / 分类名 / 原词；空则由分类与难度自由发挥 */
  seed?: string;
  /** 目标分类（模型只能落在这张封闭词表里） */
  categoryId?: string;
  /** 目标轨道（仅 question） */
  track?: QuestionTrackShape;
  /** 目标难度（question / glossary 可给） */
  difficulty?: QuestionDifficultyShape;
  /** 图型（仅 diagram，必填：决定节点键名 label/note 还是 title/detail） */
  diagramKind?: DiagramKindShape;
  /** 期望条数（`clampDraftCount` 夹取；diagram 恒为 1） */
  count: number;
}

/* ───────────────────────── 意图 3：题目质检 ───────────────────────── */

/** 待检题目（调用方已按 payload-shape 校验通过） */
export interface InterviewAuditTarget {
  id: string;
  title: string;
  stem: string;
  answer: string;
  categoryId: string;
  difficulty: QuestionDifficultyShape;
  tags?: string[];
}

/** 质检参数 */
export interface InterviewAuditPayload {
  /** 待检题目（上限 `INTERVIEW_LIMITS.auditTargets`，调用方切） */
  targets: InterviewAuditTarget[];
}

/* ───────────────────────── 意图表（唯一产地） ───────────────────────── */

/** 面试域的意图 → 参数类型。加意图 = 在这里加一个键，其余四张表会被编译器逼着补齐 */
export interface InterviewPromptPayloadMap {
  interviewExplain: InterviewExplainPayload;
  interviewDraft: InterviewDraftPayload;
  interviewAudit: InterviewAuditPayload;
}

/** 面试域的意图名 */
export type InterviewPromptIntent = keyof InterviewPromptPayloadMap;

/**
 * 落库用的子意图串：`interviewDraft:question` / `:glossary` / `:diagram`。
 * 与 `interview_item.source_intent`、`ai_event.intent` 同口径（§7）。
 * **唯一产地**：调用方不许自己拼模板字符串。
 */
export function draftSubIntent(kind: InterviewKind): string {
  return `interviewDraft:${kind}`;
}
```

### 3.2 `domains/interview/sections.ts`

```ts
/**
 * 面试域专属段落。
 *
 * 四个是 §8.2 点名的，`questionListBlock` 是质检必需的第五个（内部用 kit 的
 * `kvBlock` 拼，所以第二个域想复用「一题一卡」直接抄 kvBlock 就够）。
 */
import { kvBlock } from "../../kit";
import type {
  InterviewAuditTarget,
  InterviewCategoryRef,
  InterviewPromptContext,
} from "./types";

/**
 * 分类段：题库的分类是**封闭词表**，出题/质检都必须落在这张表里。
 * 只给 `label（id）`，不给 note（22 个分类的 note 叠起来会吃掉大半个 prompt）；
 * 当前分类额外带 note —— 那一条才是模型真正需要遵守的约束。
 */
export function categoryBlock(
  categories: InterviewCategoryRef[],
  activeId?: string,
): string | null {
  if (categories.length === 0) return null;
  const list = categories.map((c) => `${c.label}（${c.id}）`).join("、");
  const active = activeId ? categories.find((c) => c.id === activeId) : undefined;
  const head = `【可选分类（只能从中选，不许新造 id）】${list}`;
  if (!active) return head;
  return `${head}\n- 当前分类：${active.label}（${active.id}）${active.note ? `｜${active.note}` : ""}`;
}

/**
 * 选区段：划词解释的锚点。
 *
 * 参数全是字符串，但「选区」是题库页独有的概念（浮层 + 划词），按 §8.2 归本域，
 * 不进 kit —— 第三个域若也要「聚焦一块引文」，应该用 kit 的 `chapterBlock` 或
 * `kvBlock`，而不是复用这个带着面试交互语义的段落。
 */
export function focusBlock(term: string, sentence?: string, stem?: string): string | null {
  const word = term.trim();
  if (!word) return null;
  const lines = [`【选区】${word}`];
  if (sentence?.trim()) lines.push(`- 所在原文：${sentence.trim()}`);
  if (stem?.trim()) lines.push(`- 所在题干（节选）：${stem.trim()}`);
  return lines.join("\n");
}

/** 已有标题段：出题/出词/出图的避重约束（不给就会一直出「什么是闭包」） */
export function siblingTitlesBlock(titles: string[], note?: string): string | null {
  const cleaned = titles.map((t) => t.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  const head = `【已有条目（不要重复，也不要只换一种说法）】${cleaned.join("、")}`;
  return note ? `${head}\n- ${note}` : head;
}

/** 覆盖度段：告诉模型「这个库现在有什么」，避免它一直往同一类里堆 */
export function coverageBlock(stats: InterviewPromptContext["stats"]): string | null {
  const { questions, glossaries, diagrams } = stats;
  const total = questions + glossaries + diagrams;
  if (total === 0) return "【题库现状】题库为空，本次是第一批内容。";
  return kvBlock("题库现状", [
    ["题目", `${questions} 道`],
    ["词条", `${glossaries} 条`],
    ["图解", `${diagrams} 张`],
  ]);
}

/** 待检题目段：一题一个 kv 块，题目之间空一行（模型按 id 分组回答时不易串） */
export function questionListBlock(targets: InterviewAuditTarget[]): string | null {
  const blocks = targets
    .map((t) =>
      kvBlock(
        `待检题目 ${t.id}`,
        [
          ["标题", t.title],
          ["分类", t.categoryId],
          ["难度", t.difficulty],
          ["题干", t.stem],
          ["参考答案", t.answer],
          ["标签", (t.tags ?? []).join("、")],
        ],
      ),
    )
    .filter((block): block is string => Boolean(block));
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}
```

### 3.3 `domains/interview/collector.ts`

```ts
/**
 * 面试题库上下文采集器（纯函数）
 *
 * 职责：把页面层取好的题库快照归一成 `InterviewPromptContext`，并按上限截断。
 * 与小说 `collectBookContext` 同款边界：不 import 页面 / store / IPC。
 */
import type { InterviewCategoryRef, InterviewPromptContext } from "./types";

/** 采集上限：数字按「塞进 prompt 后不失控」倒推 */
export const INTERVIEW_LIMITS = {
  /** 分类：22 基线 + 8 个自定义分类。超了说明用户该先收敛侧栏，而不是把整条塞进 prompt */
  categories: 30,
  /** 已有标题 / 词条键：60 条 × ~10 字 ≈ 600 字，避重够用且不撑爆 */
  questionTitles: 60,
  glossaryTerms: 60,
  /** 单批质检的题目数：再多模型会开始复制粘贴前一条的建议 */
  auditTargets: 20,
} as const;

/** 页面层组装好的题库快照（允许字段缺失） */
export interface InterviewSnapshot {
  categories?: InterviewCategoryRef[];
  stats?: { questions: number; glossaries: number; diagrams: number };
  questionTitles?: string[];
  glossaryTerms?: string[];
  activeCategoryId?: string;
}

/** 去空白 + 去重 + 截断 */
function clipList(list: string[] | undefined, max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list ?? []) {
    const value = raw?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}

/** 采集面试题库上下文 */
export function collectInterviewContext(snapshot: InterviewSnapshot): InterviewPromptContext {
  const stats = snapshot.stats ?? { questions: 0, glossaries: 0, diagrams: 0 };
  return {
    categories: (snapshot.categories ?? []).slice(0, INTERVIEW_LIMITS.categories).map((c) => ({
      id: c.id,
      label: c.label,
      ...(c.note ? { note: c.note } : {}),
    })),
    stats: {
      questions: Math.max(0, stats.questions),
      glossaries: Math.max(0, stats.glossaries),
      diagrams: Math.max(0, stats.diagrams),
    },
    questionTitles: clipList(snapshot.questionTitles, INTERVIEW_LIMITS.questionTitles),
    glossaryTerms: clipList(snapshot.glossaryTerms, INTERVIEW_LIMITS.glossaryTerms),
    ...(snapshot.activeCategoryId ? { activeCategoryId: snapshot.activeCategoryId } : {}),
  };
}
```

### 3.4 `builders/explain.ts` —— 划词解释

| 项 | 值 |
|---|---|
| intent | `interviewExplain` |
| ctx | `InterviewPromptContext` |
| payload | `InterviewExplainPayload` |
| `OutputFormat` | `TEXT_OUTPUT_FORMAT`（`{ kind: "text" }`）——**与非小说域无关的既有常量，不新增** |
| 段落 | kit：`roleBlock` / `constraintBlock` / `outputBlock` / `composePrompt`；域：`focusBlock` / `categoryBlock` |
| `versions` | `"v1"` |
| `allowedLevels` | 域级 `["L1", "L2"]`（送的是选区词 + 一句原文，属片段级） |

```ts
const ROLE = "你是一名前端 / 计算机基础面试题的讲解者，擅长把术语讲到面试者当场能复述的程度。";

/** 两段式输出的标记：与 summary 的【一句话】/【摘要】同款套路（text 契约 + 标记行） */
export const EXPLAIN_ONE_LINER_HEAD = "【一句话】";
export const EXPLAIN_BODY_HEAD = "【解释】";

export function assembleExplainSpec(
  context: InterviewPromptContext,
  payload: InterviewExplainPayload,
): PromptSpec {
  const term = payload.term.trim();
  return {
    system: composePrompt(
      roleBlock(ROLE),
      focusBlock(term, payload.sentence, payload.stem),
      payload.existingShort
        ? `【词条库已有一句话定义（不要复述它，要讲得更透）】${payload.existingShort}`
        : null,
      categoryBlock(context.categories, context.activeCategoryId),
      constraintBlock([
        `第一行必须是 ${EXPLAIN_ONE_LINER_HEAD}，后面接一句不超过 40 字的大白话释义，不要用「是指…」绕圈；`,
        `空一行后必须是 ${EXPLAIN_BODY_HEAD}，接 2–5 句展开：它解决什么问题、在什么场景出现、面试官会怎么追问；`,
        "只解释【选区】里这一个词，不要顺势介绍它所在的整章 / 整篇；",
        "不要输出 Markdown 标题、代码块或列表符号；确切的 API 名 / 数字拿不准时如实说需要查文档，不要编；",
        ...(payload.stem
          ? ["解释要贴【所在题干（节选）】的语境：同一个词在不同题里侧重点可以不同；"]
          : []),
      ]),
      outputBlock(TEXT_OUTPUT_FORMAT),
    ),
    prompt: payload.sentence?.trim()
      ? `请解释「${term}」在这个语境里的意思，按约定的两段格式输出。`
      : `请解释「${term}」，按约定的两段格式输出。`,
    outputFormat: TEXT_OUTPUT_FORMAT,
  };
}
```

> 为什么 `text` 而不是 `json-array`：解释是**一段给人读的话**，拆成 JSON 字段只会
> 让模型把解释写成三段干巴巴的标签（summary 已经踩过这个坑并选了 text + 标记行）。
> T06 若需要把一句话抽出来做气泡副标题，按 `parseSummaryReply` 的形状补
> `parseExplainReply` 即可，**不需要改本契约**。

### 3.5 `builders/draft.ts` —— AI 拓展（出题 / 出词 / 出图）

| 项 | 值 |
|---|---|
| intent | `interviewDraft` |
| ctx | `InterviewPromptContext` |
| payload | `InterviewDraftPayload` |
| `OutputFormat` | **按 kind 分三份**：`question` / `glossary` → `json-array`；`diagram` → `text`（理由见下） |
| 段落 | kit：`roleBlock` / `requirementBlock` / `constraintBlock` / `outputBlock` / `composePrompt` / `jsonArrayFormat`；域：`categoryBlock` / `siblingTitlesBlock` / `coverageBlock` |
| `versions` | `"v1"` |
| `allowedLevels` | 域级 `["L1", "L2"]` |

**输出契约表**（模型产出字段 ↔ 应用补齐字段 ↔ 分隔符）：

| kind | 模型必须产出 | 应用侧补齐 | 多值字段的写法 |
|---|---|---|---|
| `question` | `title` `stem` `stemCode` `answer` `difficulty` `topic` `tags` | `id`（`u-q-*`）、`categoryId`（取 payload）、`track`（取 payload）、`reviewedAt` / `updatedAt` / `heat` | `tags` 用**顿号**分隔（词条名里不会出现顿号） |
| `glossary` | `term` `en` `short` `detail` `aliases` `domain` | `id`（`u-g-*`）、`categoryId`、`aliases` 归一 | `detail` 用**换行**（`\n`）分隔 2–4 条；`aliases` 用顿号 |
| `diagram` | 一个 JSON **对象**（见 `DIAGRAM_KIND_SHAPE_HINT`） | `id`（`u-d-*`） | 嵌套结构由 `steps` / `nodes` / `events` / `left`+`right` / `layers` 各自表达 |

**为什么 `diagram` 不能走 `json-array`**：`OutputField.type` 只有 `string | number`，
而 `buildOutputInstruction` 会写死「每个元素……**只包含这些字段**」。图的节点是嵌套数组，
硬塞进扁平字段会让模型按「只包含这些字段」的强约束**丢掉 `nodes`**（图直接画不出来）。
`{kind:"text"}` + 在 `constraintBlock` 里写死整段 JSON 骨架，是唯一不改
`output-spec.ts` 就能表达嵌套结构的路；`parseOutput` 对 text 恒返回空 entries、
调用方直接用 `raw`（summary 同款）。**交接给 T03/T06**：需要 `parseDiagramReply(raw)`
（复用 `extractJsonArray` + `stripCodeFence`），本任务只定契约。

```ts
/** 三种产物的 json 契约（模型产出字段；应用侧补齐字段不在契约里） */
export const DRAFT_OUTPUT_FORMATS: Record<InterviewKind, OutputFormat> = {
  question: jsonArrayFormat([
    { key: "title", type: "string", label: "题目标题（不超过 40 字，不带「请简述」这类前缀）" },
    { key: "stem", type: "string", label: "题干（含设问；代码另放 stemCode）" },
    { key: "stemCode", type: "string", label: "题干代码（没有就填空字符串）" },
    { key: "answer", type: "string", label: "参考答案（分点讲清，去掉寒暄）" },
    { key: "difficulty", type: "string", label: "难度，只能取 basic / medium / hard" },
    { key: "topic", type: "string", label: "来源主题（如 React / JS 基础）" },
    { key: "tags", type: "string", label: "标签，用顿号分隔，最多 5 个" },
  ]),
  glossary: jsonArrayFormat([
    { key: "term", type: "string", label: "词条名（不超过 24 字）" },
    { key: "en", type: "string", label: "英文全称 / 原名（没有就填空字符串）" },
    { key: "short", type: "string", label: "一句话定义（不超过 80 字）" },
    { key: "detail", type: "string", label: "展开细节 2–4 条，每条一行，换行写成 \\n" },
    { key: "aliases", type: "string", label: "别名，用顿号分隔，最多 4 个（没有就填空字符串）" },
    { key: "domain", type: "string", label: "所属领域（如 React / 浏览器）" },
  ]),
  // diagram 走 text：嵌套结构无法用扁平 OutputField 表达，见上方论证
  diagram: TEXT_OUTPUT_FORMAT,
};

/**
 * 图型 → 必须带的键的**逐字样例**。
 *
 * 这张表的存在理由是一条真实缺陷（§11 的 F1）：`flow` 用 `label`/`note`、
 * `timeline` 用 `title`/`detail`，两类图共用过一份节点类型，落库时键名被悄悄改写，
 * 时间轴渲染成空白。把键名写进 prompt 的示例里，是"让模型照抄"而不是"让解析器猜"。
 */
export const DIAGRAM_KIND_SHAPE_HINT: Record<DiagramKindShape, string> = {
  flow: '{"kind":"flow","title":"…","caption":"…","nodes":[{"label":"…","note":"…"}],"note":"易错点"}',
  timeline: '{"kind":"timeline","title":"…","caption":"…","events":[{"title":"…","detail":"…"}]}',
  compare: '{"kind":"compare","title":"…","caption":"…","left":{"title":"…","items":["…"]},"right":{"title":"…","items":["…"]}}',
  layers: '{"kind":"layers","title":"…","caption":"…","layers":[{"label":"…","note":"…"}]}',
};

const DEFAULT_COUNT: Record<InterviewKind, number> = { question: 3, glossary: 3, diagram: 1 };
/** 条数区间：一次出太多作者审不动；图解恒 1 张（一屏放不下第二张） */
export function clampDraftCount(kind: InterviewKind, count: number | undefined): number {
  if (kind === "diagram") return 1;
  if (!count || !Number.isFinite(count)) return DEFAULT_COUNT[kind];
  return Math.min(10, Math.max(1, Math.floor(count)));
}
```

`assembleDraftSpec` 的结构（三段式，按 kind 选 ROLE + 约束集）：

```ts
export function assembleDraftSpec(
  context: InterviewPromptContext,
  payload: InterviewDraftPayload,
): PromptSpec {
  const kind = payload.kind;
  const count = clampDraftCount(kind, payload.count);
  const format = DRAFT_OUTPUT_FORMATS[kind];
  const category = context.categories.find((c) => c.id === payload.categoryId);
  const siblings =
    kind === "question" ? context.questionTitles
    : kind === "glossary" ? context.glossaryTerms
    : [];   // 图解标题不在 ctx 里（量小且不易撞名）

  const requirements: string[] = [];
  if (category) requirements.push(`目标分类：${category.label}（${category.id}）`);
  if (payload.track) requirements.push(`轨道：${payload.track === "written" ? "手写题" : "基础题"}`);
  if (payload.difficulty) requirements.push(`难度：${DRAFT_DIFFICULTY_LABELS[payload.difficulty]}`);
  if (payload.seed?.trim()) requirements.push(`围绕这个种子展开：${payload.seed.trim()}`);

  return {
    system: composePrompt(
      roleBlock(ROLE_BY_KIND[kind]),
      categoryBlock(context.categories, payload.categoryId),
      coverageBlock(context.stats),
      siblingTitlesBlock(siblings, SIBLING_NOTE_BY_KIND[kind]),
      requirementBlock(requirements),
      constraintBlock(constraintsFor({ kind, count, diagramKind: payload.diagramKind })),
      outputBlock(format),
    ),
    prompt: promptFor({ kind, count, category: category?.label ?? "当前分类" }),
    outputFormat: format,
    ...(format.kind === "json-array" ? { count } : {}),
  };
}
```

`assembleDraftSpec` 依赖的四张域内表（同文件内定义，**不进 kit**：全是面试语义）：

```ts
/** 难度中文：prompt 里给人读，也让 requirementBlock 不必裸写 "medium" */
export const DRAFT_DIFFICULTY_LABELS: Record<QuestionDifficultyShape, string> = {
  basic: "基础（一面常见，答不出就是硬伤）",
  medium: "中等（能问出区分度，要看细节）",
  hard: "困难（源码 / 边界 / 设计取舍）",
};

/** 三种产物各自的身份定位（首句必须互不相同，模型才不会串台） */
const ROLE_BY_KIND: Record<InterviewKind, string> = {
  question: "你是一名资深前端面试官，负责为题库补出**可被追问**的面试题与参考答案。",
  glossary: "你是一名技术词典编辑，负责把术语写成面试者能秒懂、又能背下来的词条。",
  diagram: "你是一名技术图解作者，负责把一个抽象机制画成结构清晰、节点不超过 8 个的图。",
};

/** 已有条目的避重口径（三种产物撞名的方式不同，提示语也不同） */
const SIBLING_NOTE_BY_KIND: Record<InterviewKind, string | undefined> = {
  question: "同一条知识点换个角度问是允许的，但标题不能只换说法（「手写 Promise」出现两次就是重复）。",
  glossary: "近义词也算重复（「事件循环」与「Event Loop」是同一个词），命中就别再造一条。",
  diagram: undefined,
};

/** 约束集（函数式：条数 / 图型是变量） */
function constraintsFor(params: {
  kind: InterviewKind;
  count: number;
  diagramKind?: DiagramKindShape;
}): string[] { /* 按上面那张表的 ①–⑦ 逐条产出 */ }

/** 用户提示词主体（一句话，与 novel 模板的习惯一致） */
function promptFor(params: { kind: InterviewKind; count: number; category: string }): string {
  /* question: `请为「${category}」补出 ${count} 道题，按约定输出 JSON 数组。` */
  /* glossary: `请补出 ${count} 个「${category}」方向的词条，按约定输出 JSON 数组。` */
  /* diagram:  `请画一张说明该机制的 ${diagramKind} 图，按约定输出一个 JSON 对象。` */
}
```

三份约束集各自必须覆盖的点（上表 `constraintsFor` 的具体条目，每条都要能在
`interview.test.ts` 里 `toContain`）：| kind | 约束要点 |
|---|---|
| `question` | ① 只能输出 `count` 条，宁可少不要凑；② `categoryId` 由应用补齐，**模型不要输出**；③ 难度必须落在 basic/medium/hard；④ 题干与答案要能直接背，不要写「详情见文档」；⑤ 不得与 `siblingTitlesBlock` 里的标题重复或仅换说法；⑥ `tags` 用顿号分隔；⑦ 一问一答，不要出选择题 / 判断题（题库只有问答形态） |
| `glossary` | ① `term` 只能是一个词，不要带解释；② `short` ≤80 字且是**定义**不是使用场景；③ `detail` 2–4 条、每条一行；④ 与已有词条键（含别名）不重复，近义词也不要新造（提示「可能是同一个词」）；⑤ `en` 缺失留空串，不要编造缩写 |
| `diagram` | ① 只输出**一个** JSON 对象（不是数组）；② 必须逐字照抄 `DIAGRAM_KIND_SHAPE_HINT[diagramKind]` 的键名（`flow` 用 `label`/`note`，`timeline` 用 `title`/`detail`）；③ `caption` 一句话说明这张图讲什么；④ 节点 2–8 个，超出人眼看不清；⑤ 值里不许出现 JSON 结构字符（会被 `payload-shape` 判成残片） |

### 3.6 `builders/audit.ts` —— 已有题目质检

| 项 | 值 |
|---|---|
| intent | `interviewAudit` |
| ctx | `InterviewPromptContext` |
| payload | `InterviewAuditPayload` |
| `OutputFormat` | `json-array`（`AUDIT_OUTPUT_FORMAT`） |
| 段落 | kit：`roleBlock` / `constraintBlock` / `outputBlock` / `composePrompt` / `jsonArrayFormat`；域：`questionListBlock` / `categoryBlock` |
| `versions` | `"v1"` |
| `allowedLevels` | 域级 `["L1", "L2"]` |

```ts
export const AUDIT_SEVERITIES = ["high", "medium", "low"] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

/** 严重程度中文（UI 排序 / 徽标色共用） */
export const AUDIT_SEVERITY_LABELS: Record<AuditSeverity, string> = {
  high: "必改（答案错了 / 会误导人）",
  medium: "该改（不严谨 / 有歧义）",
  low: "可选（措辞 / 补充例子）",
};

/**
 * 输出契约。
 *
 * ⚠️ 首个字段是 `id`，这不是随手排的：`parseOutput` 的 `dedupeEntries` 按
 * **第一个字段**去重。质检必须「一题一条」（把该题的所有问题塞进 `issues` 的多行文本），
 * 否则同一题的第 2、3 条问题会被静默丢掉。
 *
 * ⚠️ 字段不能为空串：`parseOutput` 会把「有空字段」的条目整条丢弃 ——
 * 这正好是要的语义（没问题的题不该出现在清单里），但调用方不要以为「返回条数 < 题数」是 bug。
 */
export const AUDIT_OUTPUT_FORMAT = jsonArrayFormat([
  { key: "id", type: "string", label: "被检题目 id（逐字照抄【待检题目 xxx】里的 id）" },
  { key: "severity", type: "string", label: "严重程度，只能取 high / medium / low" },
  { key: "issues", type: "string", label: "问题清单，每条一行（换行写成 \\n）；没问题时不要输出这一条" },
  { key: "suggestion", type: "string", label: "一句话修改建议（具体到改成什么）" },
]);

export function assembleAuditSpec(
  context: InterviewPromptContext,
  payload: InterviewAuditPayload,
): PromptSpec {
  const targets = payload.targets.slice(0, INTERVIEW_LIMITS.auditTargets);
  return {
    system: composePrompt(
      roleBlock(ROLE),
      categoryBlock(context.categories, context.activeCategoryId),
      questionListBlock(targets),
      constraintBlock([
        "只评审【待检题目】里出现的题目，不要新增题目、不要重写整份答案；",
        "**一题一条**：同一道题发现多个问题时合并到同一条的 issues 里，用换行分隔；",
        `问题的严重程度只允许 ${AUDIT_SEVERITIES.join(" / ")} 三档，判定口径：答案错误或缺关键点 → high；答案不严谨、有歧义、例子失效 → medium；措辞与补充 → low；全覆盖不遗漏；`,
        "重点看四类：答案正确性（技术细节是否真的对）、完整性（面试官期望的关键点有没有漏）、分类与难度是否匹配、题目是否与已有题目重复；",
        "suggestion 要具体到「改成什么」，不要写「建议完善」这类空话；",
        "**完全没问题的题目不要输出**（宁可少报，不要凑数）；",
      ]),
      outputBlock(AUDIT_OUTPUT_FORMAT),
    ),
    prompt: `请按约定逐条评审这 ${targets.length} 道题，只输出有问题的那些，按约定输出 JSON 数组。`,
    outputFormat: AUDIT_OUTPUT_FORMAT,
    count: targets.length,
  };
}
```

### 3.7 `domains/interview/index.ts`（域出口）

```ts
import type { PromptDomainModule, PromptSpec } from "../../types";
import { assembleAuditSpec } from "./builders/audit";
import { assembleDraftSpec } from "./builders/draft";
import { assembleExplainSpec } from "./builders/explain";
import type {
  InterviewPromptContext,
  InterviewPromptIntent,
  InterviewPromptPayloadMap,
} from "./types";

/** 意图 → 组装函数（漏一个 = 编译错误） */
const INTERVIEW_BUILDERS: {
  [K in InterviewPromptIntent]: (
    ctx: InterviewPromptContext,
    payload: InterviewPromptPayloadMap[K],
  ) => PromptSpec;
} = {
  interviewExplain: assembleExplainSpec,
  interviewDraft: assembleDraftSpec,
  interviewAudit: assembleAuditSpec,
};

export const INTERVIEW_INTENTS = Object.keys(
  INTERVIEW_BUILDERS,
) as readonly InterviewPromptIntent[];

export const INTERVIEW_INTENT_LABELS: Record<InterviewPromptIntent, string> = {
  interviewExplain: "划词解释",
  interviewDraft: "AI 拓展",
  interviewAudit: "题目质检",
};

export const INTERVIEW_PROMPT_VERSIONS: Record<InterviewPromptIntent, string> = {
  interviewExplain: "v1",
  interviewDraft: "v1",
  interviewAudit: "v1",
};

export const interviewPromptDomain: PromptDomainModule<
  InterviewPromptIntent,
  InterviewPromptContext,
  InterviewPromptPayloadMap
> = {
  domain: "interview",
  intents: INTERVIEW_INTENTS,
  build: (intent, ctx, payload) => INTERVIEW_BUILDERS[intent](ctx, payload),
  labels: INTERVIEW_INTENT_LABELS,
  versions: INTERVIEW_PROMPT_VERSIONS,
  // 题库内容不是小说正文，任何面试意图都不该触发 L3 整章授权（§8.2）
  allowedLevels: ["L1", "L2"],
};
```

> `novelPromptDomain` 是同构的镜像（`NOVEL_*` 三张表 + `allowedLevels: ["L1","L2","L3"]`），
> 其 `NOVEL_INTENT_LABELS` / `NOVEL_PROMPT_VERSIONS` 直接把现有 `registry.ts:70-105`
> 的 8 条**连注释一起**搬过来（版本注释是「为什么 bump」的唯一记录，不能丢）。

---

## 4. 逐文件迁移映射表

### 4.1 文件位移（13 个）

| 现路径（`src/shared/ai/context/`） | 新路径（`src/shared/ai/context/prompt/`） | 动作 |
|---|---|---|
| `prompt/types.ts` | `prompt/types.ts` | **重写**（见 §1.1） |
| `prompt/sections.ts` | `prompt/kit/sections.ts` + `prompt/domains/novel/sections.ts` | **拆分后删除**（见 §2.3/§2.4） |
| `prompt/registry.ts` | `prompt/registry.ts` | **降级薄壳**（见 §1.4） |
| `prompt/index.ts` | `prompt/index.ts` | **重写**（见 §1.3） |
| `prompt/naming.ts` | `prompt/domains/novel/builders/naming.ts` | 位移 + 改 import |
| `prompt/polish.ts` | `prompt/domains/novel/builders/polish.ts` | 位移 + 改 import |
| `prompt/transform.ts` | `prompt/domains/novel/builders/transform.ts` | 位移 + 改 import |
| `prompt/continuation.ts` | `prompt/domains/novel/builders/continuation.ts` | 位移 + 改 import |
| `prompt/summary.ts` | `prompt/domains/novel/builders/summary.ts` | 位移 + 改 import |
| `prompt/extract.ts` | `prompt/domains/novel/builders/extract.ts` | 位移 + 改 import |
| `prompt/relation.ts` | `prompt/domains/novel/builders/relation.ts` | 位移 + 改 import |
| `prompt/level-gen.ts` | `prompt/domains/novel/builders/level-gen.ts` | 位移 + 改 import |
| `prompt/prompt.test.ts` | `prompt/prompt.test.ts` | 改 import + 遍历源（见 §5） |
| `collector.ts`（`context/` 下） | `prompt/domains/novel/collector.ts` | 位移 + 收窄意图类型 + 原地留薄壳 |
| `collector.test.ts`（`context/` 下） | `prompt/domains/novel/collector.test.ts` | 位移（`import "./collector"` 不用改） |

### 4.2 `AiBookContext` 的最终落点与兼容方式

```
定义         → prompt/domains/novel/types.ts        （唯一产地，§8.3 判据 3）
域内使用     → domains/novel/{sections,collector,index}.ts  →  "./types"
域内 builder → domains/novel/builders/*.ts                  →  "../types"
对外可达     → prompt/index.ts  re-export（type AiBookContext）
             → context/collector.ts 薄壳  export *（见下）
             → context/index.ts     零改动，仍 `type AiBookContext` from "./collector"
```

`src/shared/ai/context/collector.ts` 改造后**只剩两行**：

```ts
/**
 * ⚠️ 兼容薄壳（T02）：`collectBookContext` 与 `AiBookContext` 已迁进小说域。
 *
 * 为什么保留：`src/shared/components/SettingCenter/hooks/useAiLevelGen.ts:21`
 * 直接 `import { collectBookContext } from "@/shared/ai/context/collector"`，
 * 本次任务不允许改 `shared/ai` 之外的文件。一个版本内保持路径可用。
 *
 * 下一版动作：把该 import 改成 `@/shared/ai/context`，然后删掉本文件。
 */
export * from "./prompt/domains/novel/types";
export * from "./prompt/domains/novel/collector";
```

> 这样 `context/index.ts`（12–27 行那一块）**一个字都不用改**，
> `collector.test.ts` 也不用改（它只用 `./collector` 的相对路径）。

### 4.3 `collector.ts` 内容改动（2 处，其余原样）

| 行 | 现状 | 改为 | 理由 |
|---|---|---|---|
| 17 | `import type { PromptIntent } from "./prompt/registry";` | `import type { NovelPromptIntent } from "./types";` | 小说域只能采集小说域意图 |
| 96 | `const LIMITS: Record<PromptIntent, CollectLimits>` | `Record<NovelPromptIntent, CollectLimits>` | **这是 T02 的核心阻塞点**：`Record<PromptIntent, …>` 写在既有域文件里 = 该文件永远无法对新域封闭（新增面试意图 → 这里缺 3 个键 → 编译失败）。收窄到域内意图后，「加域」才真的不用碰小说文件 |
| 118 | `const SNIPPET_INTENTS: ReadonlySet<PromptIntent>` + `new Set<PromptIntent>([…])` | `ReadonlySet<NovelPromptIntent>` + `new Set<NovelPromptIntent>([…])` | 同上 |
| 186 | `collectBookContext(snapshot, intent: PromptIntent)` | `intent: NovelPromptIntent` | 同文件内的调用点（`useNovelPage` / `useAiLevelGen` / `prompt.test.ts`）传的都是字面量，**编译照过** |
| 12–14 | 注释「意图联合类型只有一个产地：`prompt/registry.ts` 的 `PromptIntentMap`」 | 「只有一个产地：`domains/novel/types.ts` 的 `NovelPromptPayloadMap`」 | 注释随产地走 |

### 4.4 八个 builder 的 import 精确改法

路径基准（`prompt/domains/novel/builders/xxx.ts`）：
`"../types"` = 小说域类型 · `"../sections"` = 小说段落 · `"../../../types"` = 公共类型 ·
`"../../../kit"` = 通用段落 · `"../../../../output-spec"` = context/output-spec ·
`"../../../../../ai-consent"` = ai/ai-consent

| 文件 | 改哪一行 | 改成 |
|---|---|---|
| `naming.ts` | `import type { AiBookContext } from "../collector";` | `from "../types"` |
| | `import { NAMING_OUTPUT_FORMAT } from "../output-spec";` | `from "../../../../output-spec"` |
| | `} from "./sections";`（8 个函数） | **拆两行**：`composePrompt, constraintBlock, outputBlock, requirementBlock, roleBlock` → `"../../../kit"`；`entityBlock, realmBlock, workBlock` → `"../sections"` |
| | `import type { PromptSpec } from "./types";` | `from "../../../types"` |
| `polish.ts` | `from "../collector"` | `from "../types"` |
| | `from "../output-spec"` | `from "../../../../output-spec"` |
| | `} from "./sections"`（7 个） | `chapterBlock, composePrompt, constraintBlock, outputBlock, roleBlock` → kit；`characterBlock, workBlock` → `"../sections"` |
| | `import type { CharacterRef, PromptSpec } from "./types";` | `from "../../../types"` |
| `transform.ts` | 同 `polish.ts`（7 个函数拆分一致） | 同上 |
| `continuation.ts` | `from "../collector"` / `"./types"` / `"./sections"` / `"../output-spec"` | `"../types"` / `"../../../types"` / 拆（`characterBlock`→`"../sections"`，其余 5 个→kit）/ `"../../../../output-spec"` |
| `summary.ts` | `from "../collector"` | `"../types"` |
| | `import type { L3Scope } from "../../ai-consent";` | `from "../../../../../ai-consent"` |
| | `from "./types"` | `"../../../types"` |
| | `} from "./sections"`（4 个） | `composePrompt, constraintBlock, roleBlock` → kit；`workBlock` → `"../sections"` |
| | `from "../output-spec"` | `"../../../../output-spec"` |
| `extract.ts` | `from "../collector"` / `"../../ai-consent"` / `"../output-spec"` / `"./types"` | `"../types"` / `"../../../../../ai-consent"` / `"../../../../output-spec"` / `"../../../types"` |
| | `import { composePrompt, constraintBlock, roleBlock, workBlock } from "./sections";` | 拆两行：前 3 个→kit，`workBlock`→`"../sections"` |
| `relation.ts` | 同 `extract.ts`，且 `entityBlock, workBlock` → `"../sections"` | 同上 |
| `level-gen.ts` | `from "../collector"` / `"../output-spec"` / `"./types"` | `"../types"` / `"../../../../output-spec"` / `"../../../types"` |
| | `from "./sections"`（4 个） | `composePrompt, constraintBlock, roleBlock` → kit；`workBlock` → `"../sections"` |

> 只有 4 个通用函数（`composePrompt` / `constraintBlock` / `roleBlock` / `outputBlock`）
> 与 `chapterBlock` / `requirementBlock` 出现在所有 builder 里；`entityBlock` / `realmBlock`
> / `workBlock` / `characterBlock` 只出现在这一个域的 8 个文件里 —— 这就是判据 4 的实际形状。

### 4.5 被移走但**必须仍可从 `prompt/index.ts` 导出**的符号（核对清单）

`src/shared/ai/context/index.ts:29-79` 从 `./prompt` 取了 **49 个符号**（35 个值 + 14 个类型，
明细就是该文件的那个 export 块）。新 `prompt/index.ts` 已按此逐条列出（§1.3）。

**复核手段（不需要额外脚本）**：`context/index.ts` 一个字都没改，所以
`npx tsc --noEmit -p tsconfig.app.json` 一旦报 `Module "./prompt" has no exported member 'X'`，
就是新 index 漏了那个符号 —— 编译器本身就是这张核对清单。

---

## 5. `prompt.test.ts` 改造点

### 5.1 import 路径（纯机械）

| 现状 | 改为 |
|---|---|
| `from "../collector"` | `from "./domains/novel/collector"` |
| `from "../output-spec"` | **不变**（测试仍在 `prompt/` 下） |
| `from "./naming"` … `from "./level-gen"`（8 处） | `from "./domains/novel/builders/naming"` … |
| `from "./registry"` | `from "./index"`（顺便让守卫盯住真正的产地） |

**新增一条**（把 registry 薄壳的兼容承诺也钉住）：

```ts
it("registry.ts 仍是 index 的兼容薄壳（一个版本的路径承诺）", async () => {
  const shell = await import("./registry");
  const main = await import("./index");
  for (const key of ["PROMPT_BUILDERS", "PROMPT_INTENTS", "AI_INTENT_LABELS", "PROMPT_VERSIONS", "promptVersionOf"] as const) {
    expect(shell[key], `registry 少导出了 ${key}`).toBe(main[key]);
  }
});
```

### 5.2 遍历源改造（唯一允许的"放松"）

现状 `prompt.test.ts` **没有**遍历 `PROMPT_BUILDERS` 的通用断言（遍历源是手写的 7 个
`PROMPT_BUILDERS.xxx(...)` 调用）。§8.3 判据 5 要求的「遍历源改为 `DOMAINS`」体现在
**新增**的 4 条断言上；既有 40+ 条断言**一条不动**。

### 5.3 新增的 4 条断言（追加到文件末尾，新 `describe`）

```ts
import { DOMAINS, DOMAINS_HAVE_UNIQUE_INTENTS, NOVEL_INTENT_LABELS } from "./domains";
import { interviewPromptDomain } from "./domains/interview";
import type { AiDataLevel } from "../ai-consent";

/**
 * 域注册表守卫（T02）：这里钉的是「加域不侵入」的四条不变式。
 * 四条全部从 `DOMAINS` 派生，**不含任何硬编码意图名单**——
 * 新增一个域时这些断言自动覆盖它，不需要回来改测试。
 */
describe("Prompt 域注册表（DOMAINS 折叠的不变式）", () => {
  it("① 意图名全局唯一（重名会让 PROMPT_BUILDERS 折叠出错）", () => {
    // 编译期断言（重名时 `tsc` 先红）
    expect(DOMAINS_HAVE_UNIQUE_INTENTS).toBe(true);
    // 运行期再查一遍：上面的断言只能证明"类型层面没冲突"，查不到 `intents` 数组手抄错
    const owner = new Map<string, string>();
    for (const domain of DOMAINS) {
      for (const intent of domain.intents) {
        expect(
          owner.has(intent),
          `意图「${intent}」同时登记在 ${owner.get(intent)} 与 ${domain.domain}`,
        ).toBe(false);
        owner.set(intent, domain.domain);
      }
    }
    // 遍历源与运行期清单必须一致（少铺一个 = 静默丢意图）
    expect([...PROMPT_INTENTS].sort()).toEqual([...owner.keys()].sort());
  });

  it("② label 全量：每个域声明的意图都有中文，且与折叠表逐条一致", () => {
    for (const domain of DOMAINS) {
      for (const intent of domain.intents) {
        const label = domain.labels[intent];
        expect(label, `${domain.domain}/${intent} 缺中文标签`).toBeTruthy();
        expect(label, `${domain.domain}/${intent} 的标签回落成了原始 key`).not.toBe(intent);
        expect(AI_INTENT_LABELS[intent]).toBe(label);
      }
    }
  });

  it("③ version 全量：每个意图都有 v<N> 版本，且与折叠表逐条一致", () => {
    for (const domain of DOMAINS) {
      for (const intent of domain.intents) {
        const version = domain.versions[intent];
        expect(version, `${domain.domain}/${intent} 缺 prompt 版本`).toMatch(/^v\d+$/);
        expect(PROMPT_VERSIONS[intent]).toBe(version);
        expect(promptVersionOf(intent)).toBe(version);
      }
    }
  });

  it("④ allowedLevels 不含域外分级，且面试域不得声明 L3", () => {
    const KNOWN: readonly AiDataLevel[] = ["L1", "L2", "L3"];
    for (const domain of DOMAINS) {
      expect(domain.allowedLevels.length, `${domain.domain} 没声明任何分级`).toBeGreaterThan(0);
      expect(new Set(domain.allowedLevels).size).toBe(domain.allowedLevels.length);
      for (const level of domain.allowedLevels) {
        expect(KNOWN, `${domain.domain} 声明了未知分级「${level}」`).toContain(level);
      }
    }
    // 面试意图只在题库内取材（题目/词条/分类），没有任何路径发送"整章正文"：
    // 声明 L3 会让调用方以为可以先弹整章授权，等于给隐私口径开后门
    expect(interviewPromptDomain.allowedLevels).toEqual(["L1", "L2"]);
    expect(NOVEL_INTENT_LABELS).not.toHaveProperty("interviewExplain");
  });
});
```

### 5.4 面试域契约守卫（新文件 `prompt/domains/interview/interview.test.ts`）

保持 `prompt.test.ts` 的改动面最小，面试域的 10 条断言单独一个文件：

| # | 断言 |
|---|---|
| 1 | `interviewExplain`：`system` 含 `【选区】`、词本身、`【一句话】`、`【解释】`；`outputFormat` = `TEXT_OUTPUT_FORMAT` |
| 2 | `interviewExplain`：无 `sentence` / `stem` 时不留「- 所在原文：」空行残段 |
| 3 | `interviewExplain`：有 `existingShort` 时出现「不要复述它」段 |
| 4 | `interviewDraft(question)`：`outputFormat` 字段键 === `["title","stem","stemCode","answer","difficulty","topic","tags"]`；`count` 夹在 1–10 |
| 5 | `interviewDraft(question)`：`system` 含目标分类 label + `id`、含已有标题里的一条、含「顿号分隔」 |
| 6 | `interviewDraft(glossary)`：字段键 === `["term","en","short","detail","aliases","domain"]`；含「不重复造词条」约束 |
| 7 | `interviewDraft(diagram)`：`outputFormat.kind === "text"`；`system` 含 `DIAGRAM_KIND_SHAPE_HINT.flow` 的 `"label"` 与 `timeline` 的 `"title"`（键名不许混） |
| 8 | `interviewAudit`：`AUDIT_OUTPUT_FORMAT` 首字段是 `id`（`parseOutput` 的去重键），且 `system` 含「一题一条」 |
| 9 | `interviewAudit`：`system` 含三道严重程度的中文口径（`AUDIT_SEVERITY_LABELS` 全量） |
| 10 | `buildPromptSpec("interviewExplain", interviewCtx, …)` 与直接调 `assembleExplainSpec` 等价（泛化层没走样） |

---

## 6. 新建 / 修改文件总清单与顺序

### 6.1 清单（按「新增域只改 2 行」判据组织）

**新建（14）**

| # | 路径 | 性质 |
|---|---|---|
| 1 | `prompt/kit/sections.ts` | 通用段落 8 个（6 搬 + `kvBlock` / `jsonArrayFormat` 新写） |
| 2 | `prompt/kit/index.ts` | kit 出口 |
| 3 | `prompt/domains/index.ts` | **唯一登记处**（`DOMAINS` 2 行 + 唯一性断言 + `NOVEL_INTENT_LABELS`） |
| 4 | `prompt/domains/novel/types.ts` | `AiBookContext` + `NovelPromptPayloadMap` + `NovelPromptIntent` |
| 5 | `prompt/domains/novel/sections.ts` | 小说段落 4 个 |
| 6 | `prompt/domains/novel/index.ts` | `NOVEL_BUILDERS` / 三张表 / `novelPromptDomain` |
| 7 | `prompt/domains/interview/types.ts` | 面试 ctx + 3 个 payload + 意图表 |
| 8 | `prompt/domains/interview/sections.ts` | 5 个段落（含 `questionListBlock`） |
| 9 | `prompt/domains/interview/collector.ts` | `collectInterviewContext` + `INTERVIEW_LIMITS`（30/60/20） |
| 10 | `prompt/domains/interview/index.ts` | `INTERVIEW_BUILDERS` / 三张表 / `interviewPromptDomain` |
| 11 | `prompt/domains/interview/builders/explain.ts` | 划词解释 |
| 12 | `prompt/domains/interview/builders/draft.ts` | 出题 / 出词 / 出图 |
| 13 | `prompt/domains/interview/builders/audit.ts` | 题目质检 |
| 14 | `prompt/domains/interview/interview.test.ts` | 面试域契约守卫（10 条） |

**位移（11）**：见 §4.1 的 8 个 builder + `sections.ts`（拆） + `collector.ts`（+留壳） + `collector.test.ts`

**重写 / 修改（5）**

| # | 路径 | 动作 |
|---|---|---|
| 1 | `prompt/types.ts` | 重写（+`PromptDomainModule` +7 个折叠工具类型） |
| 2 | `prompt/index.ts` | 重写（折叠 + 全量 re-export） |
| 3 | `prompt/registry.ts` | 降级薄壳 |
| 4 | `prompt/prompt.test.ts` | 改 import（12 处）+ 遍历源 + 5 条新断言 |
| 5 | `context/collector.ts` | 降级薄壳（2 行） |

**唯一越界改动（1，测试文件，已论证不失效）**

| # | 路径 | 动作 |
|---|---|---|
| 1 | `src/shared/novel/guide-doc.test.ts` | 第 2 行 import 改带 `NOVEL_INTENT_LABELS`；第 124–128 行的遍历源从 `AI_INTENT_LABELS` 改为 `NOVEL_INTENT_LABELS` |

### 6.2 `guide-doc.test.ts` 的精确改法（硬阻塞）

**改造前**（`src/shared/novel/guide-doc.test.ts:2`、`:124-128`）：

```ts
import { AI_INTENT_LABELS } from "../ai/context/prompt/registry";
...
  it("每个 AI 意图都有可检索词条（漏写 = 新功能等于不存在）", () => {
    for (const [intent, label] of Object.entries(AI_INTENT_LABELS)) {
      expect(aiText, `AI 意图「${intent}」(${label}) 在帮助手册里没有词条`).toContain(label);
    }
  });
```

**改造后**：

```ts
// 第 2 行：改从 prompt 桶取，多拿一个「小说域意图」视图
import { AI_INTENT_LABELS, NOVEL_INTENT_LABELS } from "../ai/context/prompt";
...
  it("每个小说域 AI 意图都有可检索词条（漏写 = 新功能等于不存在）", () => {
    // 遍历源 = novelPromptDomain.labels（由 DOMAINS 派生），不是硬编码名单：
    // 小说域每加一个意图，`Record<NovelPromptIntent, string>` 就逼着补 label，
    // 于是这条守卫自动多一条要求 —— 豁免面永远不会误伤小说域。
    for (const [intent, label] of Object.entries(NOVEL_INTENT_LABELS)) {
      expect(aiText, `AI 意图「${intent}」(${label}) 在帮助手册里没有词条`).toContain(label);
    }
  });

  it("豁免面必须来自域归属（不是「反正没人管」）", () => {
    // ① 别名不许漂移：NOVEL_INTENT_LABELS 必须是 AI_INTENT_LABELS 的子集且值相同
    for (const [intent, label] of Object.entries(NOVEL_INTENT_LABELS)) {
      expect(AI_INTENT_LABELS[intent], `NOVEL_INTENT_LABELS 里多出了非全量表的键 ${intent}`).toBe(label);
    }
    // ② 豁免必须真的豁免到了东西：若哪天有人把 NOVEL_INTENT_LABELS 改成全量表
    //    来图省事，这条会红（全量表 = 又回到"一本小说手册要写面试题词条"的荒谬状态）
    expect(Object.keys(NOVEL_INTENT_LABELS).length).toBeLessThan(
      Object.keys(AI_INTENT_LABELS).length,
    );
  });
```

**为什么守卫不会失效**（逐条论证）：

| 风险 | 为什么守得住 |
|---|---|
| 小说域新增意图，忘了补手册 | `novelPromptDomain.labels: Record<NovelPromptIntent, string>` 先逼你补 label，`NOVEL_INTENT_LABELS` 随即带上它 → 遍历源自动包含 → 手册缺失即红 |
| 有人把过滤写成硬编码名单（`intent !== "interviewExplain"`） | 判据是 `novelPromptDomain.labels` 这个**对象本身**，没有任何字符串比较；`DOMAINS` 增删域都不需要改测试 |
| 有人把 `NOVEL_INTENT_LABELS` 改成全量表来消红 | 新增的 ② 断言（`toBeLessThan` + 子集校验）会红 |
| 新域（如 ledger）的功能没人管手册 | 该域自己的手册守卫由该域负责；`intent-labels.test.ts` 仍然要求**全量**中文标签，`prompt.test.ts` 仍然要求**全量** label + version —— 只有"小说手册"这一层按域豁免，别的守卫一条没松 |
| `AI_INTENT_LABELS` 的语义被改窄 | 语义**不变**（仍是全量 11 键）：`UsagePanel` / `AILogSection` / `intent-labels.ts` 三处消费方零改动 |

> ⚠️ 另一个会红的测试 `intent-labels.test.ts` **不需要改**：它只要求
> 「`AI_INTENT_LABELS` 的每个键都有中文且不等于 key」，我们的 3 个面试标签是中文 → 自动通过。

### 6.3 建议 commit 切分（4 个）

| commit | 内容 | 中间态能否 `tsc` / `vitest` |
|---|---|---|
| **C1 纯位移** | 8 个 builder → `domains/novel/builders/`；`sections.ts` 拆成 `kit/sections.ts` + `domains/novel/sections.ts`；`collector.ts` 拆出 `domains/novel/types.ts`（`AiBookContext`）并把本体移到 `domains/novel/collector.ts`，原地留 2 行薄壳；`collector.test.ts` 跟着搬；**同步修正 `prompt/index.ts` 与 `registry.ts` 的 import 路径** | ✅ **必须全绿**：类型仍是老的（`PromptIntentMap` 还在 registry），只是路径变了 |
| **C2 折叠落地（无新域）** | `domains/novel/types.ts` 加 `NovelPromptPayloadMap`/`NovelPromptIntent`；`domains/novel/index.ts`（`NOVEL_BUILDERS` + 三张表 + 域模块）；`domains/index.ts`（`DOMAINS = [novelPromptDomain]`）；重写 `prompt/index.ts`；`registry.ts` 降壳；`collector.ts` 收窄 3 处；`prompt.test.ts` 改 import + 5 条新断言；`guide-doc.test.ts` 改遍历源 | ✅ **必须全绿**：`DOMAINS` 只有 1 个域，`AI_INTENT_LABELS` 仍是 8 键，行为逐字节等价 —— **这是整个方案最重要的验证点**：泛化层上齐了，业务零变化 |
| **C3 加面试域** | `domains/interview/**` 全部新建 + **`domains/index.ts` 加 2 行**（import + 数组项）+ `prompt/index.ts` 加 interview 的 re-export 块 | ✅ 全绿。这一步**只准**动 `domains/index.ts` 2 行 + 新目录：`git diff --stat` 里出现 `domains/novel/**` / `kit/**` 就说明判据 2 或 4 被破坏 |
| **C4 文档**（可与 T07 合并） | `AGENTS.md:205-208/234-236` 的「三处登记」改成「域模块自登记」；`docs/spec/interview-db-ai-spec.md` §8 状态标记 | — |

### 6.4 中间态编译风险（C1/C2 的具体坑）

| 坑 | 说明 | 处置 |
|---|---|---|
| C1 里 `prompt/index.ts` 指向旧路径 | 位移完成的瞬间桶文件就断了 | C1 必须在同一个 commit 里改完 `index.ts` + `registry.ts` 的 import，否则整个应用红 |
| C1 里 `AiBookContext` 两处定义 | 若 `types.ts` 建好了但 `collector.ts` 还自己 `export interface` → 两个产地 | `collector.ts` 删掉原定义，改 `import type { AiBookContext } from "./types"` + 原样使用；薄壳 `export *` 两者都覆盖 |
| C2 里 `registry.ts` 与 `index.ts` 互相 import | 薄壳只能单向（registry → index） | 写完 `index.ts` 后立刻改 `registry.ts`；探针已验证该方向无环 |
| C2 里 `collector.ts` 的 `LIMITS` | 收窄成 `Record<NovelPromptIntent, …>` 时，`NovelPromptIntent` 必须已在 `types.ts` 里定义 | C2 的第一件事就是加 `NovelPromptPayloadMap` |
| C3 里 `AI_INTENT_LABELS` 变 11 键 | `UsagePanel` / `AILogSection` 的筛选下拉会多 3 项（预期行为） | 无需改代码；若截图守卫存在，按实际截图更新（`ai-partial-config.qa.test.tsx` 与本任务无关） |
| `erasableSyntaxOnly` | 不许用 `enum` / 参数属性 | 全部用 `const` 对象 + `as const`（约束表已如此写） |
| `noUnusedLocals` | `DOMAINS_HAVE_UNIQUE_INTENTS` 若只做断言不导出会被判未使用 | 已 `export`，且被 `prompt.test.ts` 消费 |
| ESLint U+3000 | 注释里不许出现全角空格 | 本方案所有缩进都是半角；工程师抄代码时留意别从文档里带出全角空格 |
| LF 换行 | 项目规范要求源码 LF | 新建文件用 LF；Windows 上 `git mv` 后确认 `.gitattributes` 生效 |

---

## 7. 与 §8 / team-lead 简报的偏差（3 处，均已论证）

### 7.1 `guide-doc.test.ts` 越界改动

team-lead 的约束 4 写「禁改任何 `shared/ai/` 之外的文件」。但 §五 的硬阻塞解法**必然**落在
`src/shared/novel/guide-doc.test.ts`（小说手册的守卫不在 `shared/ai` 内）。
界定：改动仅限**测试文件**（1 行 import + 1 行遍历源 + 1 个新 `it`），
零生产代码、零 `electron/**`。已在 §6.2 给出行号级改法与不失效论证。

### 7.2 `PromptDomainModule` 多一个类型参数

§8.2 写的是 `PromptDomainModule<Ids extends string, Ctx>` 且 `build` 用全局
`PromptPayloadOf<K>`。那需要 `types.ts` import `DOMAINS`，构成「基础设施 → 注册表」的
倒挂 + 类型环。改为第三个类型参数 `Payloads`（`novel`/`interview` 各自带上自己的 payload 表），
对外 `PromptPayloadOf<K>` 的语义与签名**完全一致**。
`PromptPayloadOf` 也因此从 `types.ts` 落到 `prompt/index.ts`（折叠层），
从 `prompt/index.ts` 与 `registry.ts` 两处都能 import。

### 7.3 划词素材放 payload 而非 ctx

team-lead 的简报写「`interviewExplain`：ctx：选区词 + 上下文句 + 可选题干」。
实际设计里这些**在 payload**（`InterviewExplainPayload`），ctx 只装库级稳定信息。

理由（与小说域既有约定一致，不是新发明的分界）：

1. `AiBookContext` 装的是「这本书是什么」，被处理的文本一律走 payload
   （polish 的 `text`、summary 的 `chapter`、extract 的 `chapter`）——`InterviewPromptContext`
   对称地装「这个题库是什么」；
2. ctx 是**域级单一类型**（`build(intent, ctx, payload)` 只有一个 Ctx）。把选区放进 ctx
   意味着一次性解释气泡也要构造一整个域上下文，且同一 ctx 无法对应"这一次划的是哪个词"；
3. 若坚持放 ctx，`buildPromptSpec("interviewExplain", ctx, payload)` 里 `payload` 就只剩
   可选补充项，`PromptIntentMap` 的类型约束会退化成"什么都行"。

**如果团队坚持按简报放 ctx**：改动点是 `InterviewExplainPayload` 的三个字段搬进
`InterviewPromptContext`（并给 `explain` 单独一个 ctx 类型 = 放弃「一域一 ctx」），
其余 5 条契约不变。**不建议**，但成本可控（1 个文件）。

---

## 8. 待团队拍板（不阻塞 C1/C2）

| # | 事项 | 现状判断 | 触发条件 |
|---|---|---|---|
| 1 | `interviewDraft` 三合一 vs 拆三个意图 | **三合一**（ctx 相同，只差输出契约；落库本来就带 `:kind` 子串） | 若 T06 发现三个按钮的上下文差异大到要不同 ctx，再拆 |
| 2 | `diagram` 走 `text` + 专属解析器 | **定为 text**，`parseDiagramReply` 交 T06 | 若 T03 的 `aiGenerateStructured` 通道只认 json-array，则在 T03 加一条 text 通道（不改 prompt 层） |
| 3 | `detail` / `issues` 用换行作多值分隔 | **用 `\n`**（`parseOutput` 保留内部换行；顿号/竖线在中文内容里太常见） | 若实测模型写出裸换行导致 JSON 坏，改为固定条数字段（`detail1..detail4`） |
| 4 | `collector.ts` 薄壳何时删 | 一个版本后 | `useAiLevelGen.ts:21` 改成桶 import 之后 |
| 5 | `INTERVIEW_LIMITS.categories = 30` | 22 基线 + 8 自定义 | 自定义分类上限放宽时同步 |
