/**
 * 基线指纹（payload 指纹）。
 *
 * 【为什么需要指纹】
 * 用户在「2026-01 版」的基线上改了一道题，之后 app 升级把这道题的默认答案也改了。
 * 库里的 `base_hash` 记的是「你改的时候基线长什么样」，拿它和**当前**基线的指纹
 * 比一下就知道「新版有没有动过这题」—— 这是 §5.4「基线已更新」提示的唯一依据。
 * 所以指纹必须满足两条：**同内容必同值**（否则每次启动都误报更新）、
 * **改任一字段必变值**（否则新版的修订永远提示不出来）。
 *
 * 【为什么不用 crypto】
 * 这段代码跑在渲染进程：`node:crypto` 取不到，Web Crypto 的 `subtle.digest`
 * 是异步的（合并视图是同步纯函数，不能 await），而引入第三方哈希库等于为一个
 * 「几十字节字符串算个值」的需求加一条依赖。FNV-1a 是十几行的非加密哈希，
 * 在这里够用：我们只需要「内容变了值就变」，不需要抗碰撞攻击。
 *
 * 【为什么两轮】
 * 单轮 FNV-1a 只有 32 位，指纹表要装 243 题 + 100 词条 + 24 图（约 370 条），
 * 生日界下 32 位仍可能撞一次 —— 撞了的后果是「用户改了题却不提示更新」。
 * 两轮用**不同偏移**各取 16 位拼成 8 位十六进制：碰撞概率降一个量级，
 * 且输出仍短到能直接塞进 SQLite 的一列里人工比对。
 */

/** FNV-1a 32 位的标准偏移基（offset basis） */
const FNV_OFFSET_BASIS = 0x811c9dc5;

/** FNV-1a 的 32 位质数（2^24 + 2^8 + 0x93） */
const FNV_PRIME = 0x01000193;

/** 第二轮的另一个偏移：与第一轮完全不同，避免两段十六进制被同一碰撞带偏 */
const FNV_ALT_OFFSET = 0x9e3779b9;

/**
 * 递归深度上限。
 *
 * payload 是题库产物（最深三层：`source.label`、`layers[].tags[]`），
 * 但库里可能躺着导入的脏数据 —— 正常 JSON 不可能自引用，真遇上了
 * 也要给个确定结果，而不是把渲染进程栈打穿。
 */
const MAX_DEPTH = 32;

/** FNV-1a：逐字符异或后乘质数，`Math.imul` 保证 32 位乘法不丢精度 */
function fnv1a(text: string, offsetBasis: number): number {
  let hash = offsetBasis >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/** 32 位值取低 16 位，补成 4 位十六进制 */
function toHex16(value: number): string {
  return (value & 0xffff).toString(16).padStart(4, "0");
}

function writeStable(value: unknown, depth: number): string {
  if (depth > MAX_DEPTH) return '"[超深嵌套]"';
  if (value === null || value === undefined) return "null";

  const kind = typeof value;
  if (kind === "number") {
    // NaN / Infinity 不是合法 JSON；JSON.stringify 也把它们写成 null
    return Number.isFinite(value as number) ? JSON.stringify(value) : "null";
  }
  if (kind === "string") return JSON.stringify(value);
  if (kind === "boolean") return value ? "true" : "false";
  if (kind === "bigint") return JSON.stringify((value as bigint).toString());
  // function / symbol 在 JSON 里没有表示，统一按 null 处理（不抛）
  if (kind === "function" || kind === "symbol") return "null";

  if (Array.isArray(value)) {
    // 数组保序：下标就是语义的一部分（`tags` 顺序、`layers` 顺序）
    const items = value.map((item) => writeStable(item === undefined ? null : item, depth + 1));
    return `[${items.join(",")}]`;
  }

  // 有 toJSON 的对象（Date 等）先走它，与 JSON.stringify 的行为对齐
  const withToJson = value as { toJSON?: () => unknown };
  if (typeof withToJson.toJSON === "function") {
    return writeStable(withToJson.toJSON(), depth + 1);
  }

  const record = value as Record<string, unknown>;
  // 键排序：同一份内容由不同代码路径构造（AI 解析 / 导入 / 手工编辑）时
  // 键序会不同，不排序就会算出两个指纹 → 每次启动都提示「基线已更新」
  const keys = Object.keys(record).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const item = record[key];
    // undefined 字段跳过：`{a:1}` 与 `{a:1,b:undefined}` 是同一内容
    if (item === undefined) continue;
    parts.push(`${JSON.stringify(key)}:${writeStable(item, depth + 1)}`);
  }
  return `{${parts.join(",")}}`;
}

/**
 * 稳定序列化：对象键排序、数组保序、`undefined` 字段跳过。
 *
 * 同一内容不同键序必须得到同一字符串（指纹的全部意义都在这条上）；
 * 任何输入都不抛 —— 它是展示链路的一部分，不该因为一条脏数据把整页打白。
 */
export function stableStringify(value: unknown): string {
  return writeStable(value, 0);
}

/**
 * payload 指纹，形如 `fp:1a2b3c4d`。
 *
 * 前缀 `fp:` 让日志与导出文件里的人一眼能区分「指纹」和「时间戳 / id」；
 * 第二轮的输入里拼进第一轮结果，两段输出才真正相关于同一份内容。
 */
export function hashPayload(value: unknown): string {
  const text = stableStringify(value);
  const head = fnv1a(text, FNV_OFFSET_BASIS);
  const tail = fnv1a(`${text}#${head.toString(16)}`, FNV_ALT_OFFSET);
  return `fp:${toHex16(head >>> 16)}${toHex16(tail)}`;
}
