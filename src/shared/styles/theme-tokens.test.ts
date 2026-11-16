import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 主题变量守卫：`var(--app-*)` 引用的名字必须真的在 `themes.scss` 里定义。
 *
 * 【为什么需要这条】CSS 自定义属性拼错**不会报错**：`var(--app-danger)` 里的
 * `--app-danger` 不存在时，整条声明按「无效值」处理 —— 若写了 fallback
 * （`var(--app-danger, #d4380d)`）就静默降级成那个写死的颜色，看起来"能用"，
 * 实际已经脱离主题体系；没写 fallback 则整个属性被丢弃，元素退回继承值。
 * 两种表现都不会在类型检查、构建、测试里留下任何痕迹。
 *
 * 这个坑本项目已经踩过两次：`novel-ui-kit.test.ts` 里那条「样式里不引用不存在的
 * `--app-danger`」就是第一次的产物，但它的扫描根只有 NovelWindow —— 于是
 * MapWindow 在 2.19.0 又写了一遍 `--app-danger`（真名 `--app-error`），
 * 外加 5 处 `--app-accent`（真名 `--app-primary`，值恰好等于它的 fallback
 * `#5b6cf9`，所以肉眼完全看不出来）。
 *
 * 【为什么是"全 src 扫描"而不是按窗口各写一份】按窗口写就必须每加一个窗口记得
 * 补一份，而"忘记补"正是这类缺陷的成因。这里一次性覆盖 `src` 下全部 `.scss`。
 * 186 个文件、纯文本正则，实测对整轮测试的耗时影响可忽略。
 */

const SRC_ROOT = path.resolve(process.cwd(), "src");
const THEMES_FILE = path.join(SRC_ROOT, "shared/styles/themes.scss");

/**
 * 豁免清单 —— **现在是空的，且应当保持空**。
 *
 * 曾经有两条（`AiConsentDialog` 的 `--app-accent` / `--app-fill-quaternary`，
 * 都是 fallback 生效中、观感正常的老代码）。已改掉：
 * - `--app-accent` → `--app-primary`（标题图标取品牌主色，顺带获得换肤能力）
 * - `--app-fill-quaternary` → `--app-surface`（弹窗里的槽，按 themes.scss 顶部的
 *   分层规则 elevation 内的凹槽一律用 surface）
 *
 * 清单留在这里是为了**留一个需要显式修改的决策点**：将来真要豁免，必须往这个
 * 数组里加一条、并改下面「豁免清单为空」那条用例，写的时候会被迫回答「为什么
 * 不能用已有 token」。比一个空允许列表难绕过。
 */
const KNOWN_LEGACY: ReadonlyArray<{ file: string; token: string; note: string }> = [];

/**
 * 去掉注释。
 *
 * 必须去：多处注释里用 `var(--app-*)` 当**通配写法**说明"颜色走主题变量"，
 * 那不是真实引用；`--app-typo`、`--app-space-*` 也只出现在注释里。
 *
 * `//` 用 `(^|[^:])` 保护，避免把 `url(http://…)` 截断。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function collectScss(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectScss(full));
    else if (entry.name.endsWith(".scss")) out.push(full);
  }
  return out;
}

/** `themes.scss` 里定义的 `--app-*` 名字集合 */
function definedAppTokens(): Set<string> {
  const css = stripComments(readFileSync(THEMES_FILE, "utf8"));
  const names = new Set<string>();
  for (const match of css.matchAll(/^\s*(--app-[a-z0-9-]+)\s*:/gm)) names.add(match[1]);
  return names;
}

/**
 * 一个文件里真实引用到的 `--app-*` 名字（去重）。
 *
 * 正则要求 `--app-` 后至少跟一个名字字符：注释被剥掉之后，`var(--app-*)` 这种
 * 通配写法自然不匹配（`*` 不在字符集里），无需额外排除。
 */
function usedAppTokens(file: string): string[] {
  const css = stripComments(readFileSync(file, "utf8"));
  const names = new Set<string>();
  for (const match of css.matchAll(/var\(\s*(--app-[a-z0-9-]+)/g)) names.add(match[1]);
  return [...names];
}

const relOf = (file: string) => path.relative(SRC_ROOT, file).split(path.sep).join("/");

describe("主题变量：var(--app-*) 必须真的存在", () => {
  const defined = definedAppTokens();
  const files = collectScss(SRC_ROOT).filter((file) => file !== THEMES_FILE);

  it("守卫自身没失效：能从 themes.scss 解析出定义", () => {
    // 若有人把 themes.scss 改名/挪走，上面的读取会抛错；但若只是改了定义写法
    // （比如不再用 `--app-x:` 的形式），本守卫会「零定义 ⇒ 全部违规」或
    // 「零定义 ⇒ 零使用」，两种静默都得先在这里暴露。
    expect(defined.size).toBeGreaterThan(50);
    expect(files.length).toBeGreaterThan(100);
  });

  it("所有 var(--app-*) 都能在 themes.scss 找到定义", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relOf(file);
      for (const token of usedAppTokens(file)) {
        if (defined.has(token)) continue;
        if (KNOWN_LEGACY.some((k) => k.file === rel && k.token === token)) continue;
        offenders.push(`${rel} → var(${token})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("历史遗留清单没有失效条目（修好了就要删掉，不许留尸）", () => {
    const stale = KNOWN_LEGACY.filter((k) => {
      const full = path.join(SRC_ROOT, k.file);
      return !usedAppTokens(full).includes(k.token);
    }).map((k) => `${k.file} → ${k.token}`);
    expect(stale).toEqual([]);
  });

  it("豁免清单为空（要豁免先在这里落一条并解释，别静默放过）", () => {
    // 清空后不接受新增：加一条就必须改这条断言，改的时候会被要求解释
    // 「为什么不能用真实存在的 token」。这比一个宽松的允许列表难绕过。
    expect(KNOWN_LEGACY).toEqual([]);
  });
});
