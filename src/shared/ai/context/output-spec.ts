/**
 * AI 输出契约（渲染进程侧，纯函数）
 *
 * 解决「模型返回自由文本 → 客户端正则乱切」的脆弱点：调用方先**声明**期望格式，
 * 本层负责两件事——① 把格式要求写进系统提示词（强约束）；② 把返回文本解析成
 * 结构化条目（三层保险，见下）。
 *
 * 三层保险（弱模型不遵循 JSON 时不至于全盘失效）：
 *   1. prompt 层：`buildOutputInstruction` 写死 JSON 契约 + 示例 + 反例；
 *   2. 解析层：剥代码块 → 取最小 `[` 到最大 `]` 切片 → JSON.parse → 逐字段校验；
 *   3. 兜底层：JSON 彻底失败时退回「按行切 + 去序号 + 拆分寓意」的启发式，
 *      并用 `usedFallback` 告知调用方（提示质量可能下降，但仍有结果可用）。
 *
 * 本文件不 import novel、不碰 IPC、不读写磁盘。
 */

/** 结构化输出的单个字段声明 */
export interface OutputField {
  /** 字段键（与 JSON 对象里的 key 一致） */
  key: string;
  /** 字段类型；number 会做一次 Number() 归一，非法则丢弃该条 */
  type: "string" | "number";
  /** 提示词里给人的字段说明（如「名字」「寓意」） */
  label: string;
}

/** 输出格式契约：调用方声明，本层注入指令 + 解析 */
export type OutputFormat =
  /** 纯文本（润色等无结构需求） */
  | { kind: "text" }
  /** JSON 数组（起名等一批结构化条目） */
  | { kind: "json-array"; fields: OutputField[] };

/** 解析出的一条结构化结果；值统一归一成字符串，便于直接渲染 */
export type AiEntry = Record<string, string>;

/** 解析结果 */
export interface ParsedOutput {
  entries: AiEntry[];
  /** 是否为启发式兜底（JSON 解析失败）；调用方可据此提示「结果质量可能下降」 */
  usedFallback: boolean;
}

/** 默认起名输出契约：名字 + 寓意 */
export const NAMING_OUTPUT_FORMAT: OutputFormat = {
  kind: "json-array",
  fields: [
    { key: "name", type: "string", label: "名字" },
    { key: "meaning", type: "string", label: "寓意" },
  ],
};

/** 默认纯文本输出契约（润色） */
export const TEXT_OUTPUT_FORMAT: OutputFormat = { kind: "text" };

/**
 * 生成「输出格式」指令，由 assembler 拼进 system prompt。
 * 对 json-array 会写死字段、示例与反例——这是约束性最强的一层。
 */
export function buildOutputInstruction(format: OutputFormat): string {
  if (format.kind === "text") {
    return "直接输出结果本身，不要任何前后缀说明、不要使用代码块包裹。";
  }

  const fields = format.fields
    .map((f) => `"${f.key}"（${f.label}${f.type === "number" ? "，数字" : ""}）`)
    .join("、");
  const sample = `{${format.fields
    .map((f) => `"${f.key}":"${f.type === "number" ? "1" : `${f.label}示例`}"`)
    .join(",")}}`;

  return (
    `你必须只输出一个合法的 JSON 数组，不要输出任何其它文字、解释或 Markdown。` +
    `\n- 每个元素是一个对象，且只包含这些字段：${fields}；` +
    `\n- 示例：[${sample}]；` +
    `\n- 严禁输出「以下是……：」之类的前缀，严禁使用 \`\`\` 代码块包裹，严禁在数组外附加说明。`
  );
}

/** 剥掉模型习惯性加的 ```json … ``` 代码块包裹 */
export function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  return (fenced ? fenced[1] : trimmed).trim();
}

/**
 * 从自由文本里抠出 JSON 数组并 parse。
 *
 * 取「第一个 `[` 到最后一个 `]`」而不是贪婪正则：模型常把数组夹在
 * 「好的，结果如下：」与「希望对你有帮助」之间，切片法是唯一稳的做法。
 */
export function extractJsonArray(text: string): unknown[] | null {
  const body = stripCodeFence(text);
  const start = body.indexOf("[");
  const end = body.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 从「坏掉的 JSON」里逐个抢救对象（第 2.5 层保险）。
 *
 * 真实数据（2026-10-27 naming 记录）：模型在第 5 条把 `}` 写成了 `]`
 * —— `…无上手段。"],{"name":"沈延寿" …`，整串因此 `JSON.parse` 必败。
 * 这类「数组里某个分隔符写错 / 末尾被截断 / 中间混入说明文字」的坏输出极常见，
 * 但对**单条对象**来说往往仍然合法。
 *
 * 做法：字符串感知地扫一遍，把每个 depth 0→1→0 的 `{ … }` 切片单独 parse；
 * 坏对象只丢自己，不牵连整批。扫描器必须认得引号与转义，否则寓意里的
 * `{`/`}`/`"` 会把括号配平搞乱。
 */
function salvageJsonObjects(text: string): unknown[] | null {
  const slices: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  /** 收尾一个切片：缺右花括号就补上（模型把 `}` 写成 `]` 时正是这个形态） */
  const flush = (slice: string) => {
    const trimmed = slice.trim();
    if (!trimmed) return;
    slices.push(trimmed.endsWith("}") ? trimmed : `${trimmed}}`);
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}") {
      if (depth === 0) continue; // 多余的右括号：忽略，不进切片
      depth -= 1;
      if (depth === 0 && start >= 0) {
        flush(text.slice(start, i + 1));
        start = -1;
      }
      continue;
    }
    // 真实事故形态：第 5 条把 `}` 写成了 `]` → 对象其实已结束，只是括号写错。
    // 不在这里收口，后半个数组会被吞进同一个未闭合切片，全部丢失。
    if (ch === "]" && depth === 1 && start >= 0) {
      flush(text.slice(start, i));
      depth = 0;
      start = -1;
    }
  }

  // 末尾被 max_tokens 截断：最后一个对象字段可能已完整，只差右花括号
  if (depth > 0 && start >= 0) {
    const tail = text.slice(start).trimEnd();
    if (tail.endsWith('"')) flush(tail);
  }

  if (slices.length === 0) return null;
  return slices.map((slice) => {
    try {
      return JSON.parse(slice) as unknown;
    } catch {
      return slice; // 交给 normalizeEntry 走「逐字段正则」那一手
    }
  });
}

/** 主字段里带 JSON 标点 = 半截数组被切碎的残片，不是名字 */
function hasStructureNoise(entry: AiEntry, fields: OutputField[]): boolean {
  const primary = entry[fields[0]?.key ?? ""];
  return Boolean(primary && /[{}[\]]|"\s*[:：]/.test(primary));
}

/**
 * 对象切片 `JSON.parse` 失败时，按字段名逐个抠值（如多余的尾逗号、键名漏引号、
 * 值里混入裸换行）。字段不全返回 null —— 与正常路径同一条验收标准。
 */
function readFieldsByPattern(slice: string, fields: OutputField[]): AiEntry | null {
  const entry: AiEntry = {};
  for (const field of fields) {
    const key = field.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`["'\`]?${key}["'\`]?\\s*[:：]\\s*["'\`]([^"'\`]*)["'\`]`);
    const value = re.exec(slice)?.[1]?.trim();
    if (!value) return null;
    entry[field.key] = value;
  }
  return hasStructureNoise(entry, fields) ? null : entry;
}

/** 按声明字段校验并归一一条记录；缺字段 / 类型非法返回 null（丢弃该条，不污染整批） */
function normalizeEntry(raw: unknown, fields: OutputField[]): AiEntry | null {
  // 抢救出来的坏切片是字符串：直接走字段正则
  if (typeof raw === "string") return readFieldsByPattern(raw, fields);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const entry: AiEntry = {};
  for (const field of fields) {
    const value = source[field.key];
    if (value === undefined || value === null) return null;
    if (field.type === "number") {
      const num = Number(value);
      if (!Number.isFinite(num)) return null;
      entry[field.key] = String(num);
      continue;
    }
    const str = String(value).trim();
    if (!str) return null;
    entry[field.key] = str;
  }

  // 结构残片护栏（UI 的最后一道闸）：主字段里出现 JSON 标点，说明这压根不是一条记录，
  // 而是半截数组被切碎了。这类值宁可整条丢掉，也不能出现在作者的结果卡上。
  return hasStructureNoise(entry, fields) ? null : entry;
}

/**
 * 这段文本像不像「模型试图输出 JSON」？
 *
 * 判据：出现 `[{` / `{"key":` 这类结构片段。像 JSON 的文本**绝不能**再按行切
 * ——真实事故：整段坏数组是一行，`[{"name":"江长青","meaning":…` 被行切后
 * 第一项成了名字 `[{"name"`，用户看到的就是一屏乱码。
 */
function looksLikeJsonPayload(body: string): boolean {
  return /\[\s*\{/.test(body) || /["']?\b\w+["']?\s*[:：]\s*["']/.test(body);
}

/** 兜底：按行切、去序号/项目符号、按常见分隔符拆出「名字 + 寓意」 */
function fallbackEntries(text: string, fields: OutputField[]): AiEntry[] {
  const body = stripCodeFence(text);
  // JSON 残片不做行切：交给调用方按「本次无产出」处理，比塞一屏乱码强
  if (looksLikeJsonPayload(body)) return [];
  const primary = fields[0]?.key ?? "text";
  const secondary = fields[1]?.key;
  const out: AiEntry[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine
      .replace(/^(\d+[.、)）]|[-*·•])\s*/, "")
      .trim();
    if (!line) continue;
    // 跳过模型的引导语（「以下是十个名字：」「结果如下」），它们不是名字
    if (/[:：]\s*$/.test(line)) continue;
    if (/^(以下|下面|结果|好的|当然|这是|生成)/.test(line)) continue;
    // 最后一道护栏：JSON 残片（`[{"name"`、`"meaning":`）绝不能当成名字进 UI。
    // 宁可这行不要，也不能把半截数组甩到作者脸上。
    if (/[{}]/.test(line) || /"\s*:/.test(line)) continue;
    // 模型常写成「凌霜——清冷孤傲」「凌霜：清冷孤傲」「凌霜 - 清冷孤傲」
    const matched = /^(.{1,20}?)\s*(?:——|—|：|:|\s-\s|\s—\s)\s*(.+)$/.exec(line);
    const name = (matched ? matched[1] : line).trim();
    if (!name) continue;
    const entry: AiEntry = { [primary]: name };
    if (secondary) {
      entry[secondary] = matched ? matched[2].trim() : "";
    }
    out.push(entry);
    if (out.length >= 60) break;
  }
  return out;
}

/** 按首个字段做去重（同名字只留第一次出现的寓意） */
function dedupeEntries(entries: AiEntry[], fields: OutputField[]): AiEntry[] {
  const key = fields[0]?.key;
  if (!key) return entries;
  const seen = new Set<string>();
  const out: AiEntry[] = [];
  for (const entry of entries) {
    const value = entry[key];
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(entry);
  }
  return out;
}

/**
 * 对齐段落分隔（润色专用后处理）
 *
 * 模型输出自由文本时习惯把每段之间空一行，而作者的原文往往是「单换行分段」。
 * 润色结果是按选区**整段回填**的（`replaceRange`），多出来的空行不会自动收敛，
 * 作者只能一行行手删——这是纯体验损耗，与润色质量无关。
 *
 * 处理口径按**原文**的分段习惯走：
 * - 原文没有空行 → 结果也不留空行（折叠连续空行）；
 * - 原文本来就空行分段 → 保留模型的分段（此时空行是作者自己的写法）。
 *
 * 只动换行，不碰文字：不合并段落、不增删句子。
 */
export function alignParagraphBreaks(text: string, original: string): string {
  const body = text.replace(/\r\n?/g, "\n").trim();
  if (!body) return "";
  if (/\n[ \t]*\n/.test(original)) return body;
  return body
    .replace(/[ \t]*\n[ \t]*\n+/g, "\n")
    .replace(/[ \t]+\n/g, "\n");
}

/**
 * 解析模型返回文本。
 *
 * text 格式无结构需求，entries 恒为空数组（调用方直接用 `raw`）。
 */
export function parseOutput(
  text: string,
  format: OutputFormat,
  options: { limit?: number } = {},
): ParsedOutput {
  if (format.kind === "text") {
    return { entries: [], usedFallback: false };
  }

  const limit = options.limit && options.limit > 0 ? options.limit : undefined;
  const array = extractJsonArray(text);
  if (array) {
    const entries: AiEntry[] = [];
    for (const item of array) {
      const entry = normalizeEntry(item, format.fields);
      if (entry) entries.push(entry);
    }
    if (entries.length > 0) {
      const deduped = dedupeEntries(entries, format.fields);
      return {
        entries: limit ? deduped.slice(0, limit) : deduped,
        usedFallback: false,
      };
    }
  }

  // 第二层保险补强：整串 JSON 非法时（分隔符写错 / 末尾截断），逐条抢救对象。
  // 抢救出来的条目字段齐全，等价于正常解析 → 不算「兜底」，不弹质量提示。
  const salvaged = salvageJsonObjects(stripCodeFence(text));
  if (salvaged) {
    const entries: AiEntry[] = [];
    for (const item of salvaged) {
      const entry = normalizeEntry(item, format.fields);
      if (entry) entries.push(entry);
    }
    const deduped = dedupeEntries(entries, format.fields);
    if (deduped.length > 0) {
      return {
        entries: limit ? deduped.slice(0, limit) : deduped,
        usedFallback: false,
      };
    }
  }

  // 第三层保险：JSON 不成立时退回启发式，保证「有结果」优先于「格式完美」
  const fallback = dedupeEntries(fallbackEntries(text, format.fields), format.fields);
  return {
    entries: limit ? fallback.slice(0, limit) : fallback,
    usedFallback: true,
  };
}
