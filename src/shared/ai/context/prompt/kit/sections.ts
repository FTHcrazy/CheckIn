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
 *
 * 不 import novel、不碰 IPC。
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
