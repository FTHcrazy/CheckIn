/**
 * 名字归一（共享纯函数）
 *
 * AI 产出的「名字」几乎不会干干净净：模型爱写「《青云志》」「"李玄"」
 * 「『天元宗』」，也会叠成「《『青云志』》」。这一层把它剥回本体。
 *
 * 为什么独立成文件：实体抽取（R-AI-08）与等级体系生成（R-AI-18）都要做同一件事，
 * 而在两处各写一份正则必然漂移 —— 历史教训是「李玄（青冥宗）」被削成
 * 「李玄（青冥宗」（左括号留下、右括号没了），卡名肉眼正常、检索与去重全对不上。
 *
 * 规则：**只剥成对包裹**（整串被一对符号包住，且内部不含同类符号），
 * 单端孤立的符号才单独剥。不做 trim 之外的任何改写 —— 归一不能改变作者的名字。
 */

/** 成对包裹符号（开 → 闭）。引号的开闭同字，靠出现次数判断是否配平 */
const WRAPPER_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["《", "》"],
  ["「", "」"],
  ["『", "』"],
  ["“", "”"],
  ['"', '"'],
  ["'", "'"],
  ["（", "）"],
  ["(", ")"],
  ["【", "】"],
  ["[", "]"],
];

/** 剥一层包裹（无变化时原样返回，由调用方判断是否继续） */
export function stripOneWrapper(name: string): string {
  // ① 整串被一对包裹包住，且**内部不含同类符号**（说明这层是真的配平）
  for (const [open, close] of WRAPPER_PAIRS) {
    if (name.length <= open.length + close.length) continue;
    if (!name.startsWith(open) || !name.endsWith(close)) continue;
    const inner = name.slice(open.length, name.length - close.length);
    if (!inner.includes(open) && !inner.includes(close)) return inner;
  }
  // ② 单端孤立的包裹符号（「青冥宗 / 青冥宗」）：对面那个在整串里根本不存在
  for (const [open, close] of WRAPPER_PAIRS) {
    if (name.startsWith(open) && !name.includes(close)) return name.slice(open.length);
    if (name.endsWith(close) && !name.includes(open)) {
      return name.slice(0, name.length - close.length);
    }
  }
  return name;
}

/** 反复剥包裹（最多 4 层，防极端输入下死循环），并去掉首尾空白 */
export function stripWrappers(raw: string): string {
  let name = (raw ?? "").trim();
  for (let guard = 0; guard < 4; guard += 1) {
    const next = stripOneWrapper(name);
    if (next === name) break;
    name = next;
  }
  return name.trim();
}
