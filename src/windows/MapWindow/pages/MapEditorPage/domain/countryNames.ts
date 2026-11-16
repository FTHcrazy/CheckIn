/**
 * 国名生成（2.50.0 对齐逆向目标 `ctrls.rand_text`，`decoded.js@66000`）。
 *
 * ## 参考算法全文（去掉无关分支后）
 *
 * ```js
 * function text(type, key, suffixPool) {
 *   var table = (key == 0 ? FANTASY_TABLE : ASIAN_TABLE);
 *   var prefixPool = table["start_" + type];
 *   var endPool    = (suffixPool != undefined ? suffixPool : table["end_" + type]);
 *   var i = rand(prefixPool.length);
 *   var j = rand(endPool.length);
 *   // 同一 key 下重名就重抽；该 key 已抽过的组合数 > 前缀池长度时允许复用
 *   if (used[type + key].includes(`_${i}_${j},`)) {
 *     if (used[type + key].split(",").length > prefixPool.length) used[type + key] = `_${i}_${j},`;
 *     else return text(type, key, suffixPool);
 *   } else used[type + key] += `_${i}_${j},`;
 *   var p = prefixPool[i];
 *   // 前缀自带下划线 = 专名，不再拼后缀（"夏_" → "夏"，不是"夏国"）
 *   return p.includes("_") ? p.replace("_", "") : p + endPool[j];
 * }
 * ```
 *
 * 国名的调用点（`decoded.js@577383`）：
 * `getRandText("country", k, l)`，外面套一层 `for (n = 0; n < 20; n++)` 的重名重抽
 * —— 即"最多再抽 20 次，抽不到新的就认了"。这里一并复刻（`MAX_RETRY`）。
 *
 * ## 为什么值得照抄而不是"随机组两个汉字"
 *
 * 参考的池子是**真实史料/神话里的国名**（宁楚赵齐秦…、青丘、一目、厌火、楼兰、
 * 轩辕、龟兹），拼出来天然是"这片大陆本来就有的国家"。随机汉字拼出来的
 * "苍芪国""木夫国"读着像占位符，用户一眼就能看出是生成的。
 *
 * ## 池子口径
 *
 * 参考有两套表：西幻（`start_country` 空，靠一个西式地名池拼接 + `王国/公国/帝国`
 * 后缀）与古风（173 项前缀 + 单一后缀 `国`）。本项目成图是东方水墨/仙侠底子，
 * **取古风那套**。参考池前 27 项因历史原因重复了一遍（宁楚赵…宋各出现两次），
 * 这里去重保留顺序 —— 重复只影响抽中概率，不影响任何观感，去掉更好读。
 */

/**
 * 国名前缀池（`decoded.js` 的 `start_country`，古风表，去重后 146 项）。
 *
 * 末尾带 `_` 的是**专名**：直接成国（"夏_" → "夏"）。参考用下划线标记这件事，
 * 因为它们同时也是"朝代名"，拼上"国"会变成"夏国"这种不存在的读法。
 */
export const COUNTRY_PREFIXES: readonly string[] = [
  "宁", "楚", "赵", "齐", "秦", "韩", "燕", "魏", "晋", "陈", "曹", "吴", "越", "宋",
  "鲁", "郑", "卫", "巴", "蜀", "邓", "莒", "邹", "杞", "蔡", "郯", "任", "滕", "薛",
  "费", "倪", "曾", "缯", "邳", "虞", "虢", "滑", "中山", "梁",
  "夏_", "商_", "周_", "秦_", "汉_", "晋_", "隋_", "唐_", "宋_", "辽_", "金_", "元_",
  "明_", "清_", "匈奴_", "羌_", "鲜卑_", "氐_", "羯_", "凉_", "莽_",
  "仇池", "出云", "突厥_", "契丹_", "蒙_", "北狄_", "女真_", "色木_",
  "鲛人", "南平", "奢比尸", "安槐", "漠北", "凌江", "宁远", "威远", "宣德", "平景",
  "无肠", "羽民", "讙头", "厌火", "三首", "长臂", "一臂", "奇肱", "聂耳", "青丘",
  "黑齿", "子夷", "伏波", "夜灵", "夜郎", "百潮", "楼兰", "北辰", "九黎", "西云",
  "天启", "凤吟", "北冥", "广苼", "南诏_", "温赋_", "倾安_", "浮玉_", "载",
  "结胸", "歧舌", "周饶", "言灵", "巫咸", "女儿", "轩辕_", "白民", "肃慎", "龟兹",
  "长股", "无启", "一目", "柔利", "深目", "拘缨", "歧踵", "君子", "玄股", "毛民",
  "劳民", "伯虑", "里耳", "雕题", "北雊", "枭阳", "列人", "貊", "蟜", "阘非",
  "姑射", "司幽", "中容", "月支", "竖沙", "玺唤", "载民", "寒荒", "始州", "氏羌",
  "列襄", "释厄", "百济", "柔然", "扶余", "大食", "大秦", "拂菻", "南夷", "乌珠",
  "震旦", "西陵", "琉南",
];

/** 国名后缀池（`end_country`，古风表只有一项） */
export const COUNTRY_SUFFIXES: readonly string[] = ["国"];

/**
 * 重名重抽的轮数上限（`decoded.js@577383` 的 `for (n = 0; 20 > n; n++)`）。
 *
 * 超过就接受重复 —— 图上一百多个国家的时代早就过去了，12 个国家撞上 146 项
 * 前缀池的概率极低，真要撞了也不该在这里死循环。
 */
export const COUNTRY_NAME_MAX_RETRY = 20;

/** 参考里"前缀带下划线 = 专名"的标记 */
const PROPER_NAME_MARK = "_";

/**
 * 抽一个国名。
 *
 * @param rng 确定性随机源（生成链路统一走 `createRng(seed)`；**不要传 Math.random**
 *   —— 否则同 seed 出图不可复现，`region-land-audit` 的基线也钉不住）
 * @param used 本图已用过的名字（调用方持有，函数内会写入新名）
 * @returns 国名；池子被抽空到"重抽 20 次仍重复"时，返回那个重复的名字
 */
export function makeCountryName(rng: () => number, used: Set<string>): string {
  const pool = COUNTRY_PREFIXES;
  // 参考用 `used.split(",").length > prefixPool.length` 判断"池子已抽空 ⇒ 允许复用"。
  // 这里的等价物是 Set：用满池子容量后不再重抽。
  const exhausted = used.size >= pool.length;
  for (let attempt = 0; attempt < COUNTRY_NAME_MAX_RETRY; attempt += 1) {
    const prefix = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
    const suffix =
      COUNTRY_SUFFIXES[Math.min(COUNTRY_SUFFIXES.length - 1, Math.floor(rng() * COUNTRY_SUFFIXES.length))];
    // 专名不拼后缀：参考 `p.includes("_") ? p.replace("_","") : p + end[j]`
    const name = prefix.includes(PROPER_NAME_MARK)
      ? prefix.replace(PROPER_NAME_MARK, "")
      : `${prefix}${suffix}`;
    if (exhausted || !used.has(name)) {
      used.add(name);
      return name;
    }
  }
  // 兜底：池子还没空但 20 次全撞（12 个国家下不会发生），也把这次结果收下，
  // 免得调用方拿到空串。
  const prefix = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  const suffix =
    COUNTRY_SUFFIXES[Math.min(COUNTRY_SUFFIXES.length - 1, Math.floor(rng() * COUNTRY_SUFFIXES.length))];
  const name = prefix.includes(PROPER_NAME_MARK)
    ? prefix.replace(PROPER_NAME_MARK, "")
    : `${prefix}${suffix}`;
  used.add(name);
  return name;
}

/**
 * 批量抽 `count` 个互不相同的国名。
 *
 * 【为什么单独有这个函数】国家生成（`countries.ts`）只关心"给我 n 个不重名的",
 * 去重集合的生命周期应该跟"这一次生成"对齐 —— 放进调用方就等于每处都要记得
 * 新建一个 Set。
 */
export function makeCountryNames(count: number, rng: () => number): string[] {
  const used = new Set<string>();
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) out.push(makeCountryName(rng, used));
  return out;
}
