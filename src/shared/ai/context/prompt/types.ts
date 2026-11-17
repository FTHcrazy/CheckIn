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

/** 域模块的 ctx 类型。optional 幽灵字段经 `infer` 取到的是 `Ctx`，不会漏 `undefined` */
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
