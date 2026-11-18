/**
 * 业务域登记表 —— **加一个域只改这个文件的 2 行**（§8.3 判据 2）。
 *
 * 顺序即 `PROMPT_INTENTS` 的顺序，也是看板 / 日志里意图的展示顺序。
 */
import type { PromptDomainModule, UniqueIntentsAssertion } from "../types";
import { interviewPromptDomain } from "./interview";
import { novelPromptDomain } from "./novel";

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
