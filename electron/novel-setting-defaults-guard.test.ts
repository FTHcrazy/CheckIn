import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 设定默认值的两侧一致性守卫
 *
 * 主进程建表 / 插入时用自己的一份常量（electron/handlers/novel-handlers.ts），
 * 渲染层乐观更新用另一份（NovelPage/novel-config.ts）。两边都在源码里，
 * 而 `refactor` 口径下不存在运行期读写对方常量的可能（主进程不 import
 * src/），所以只能用源码断言把它们钉在一起。
 *
 * 漂移的后果很隐蔽：新建分类后本地显示 9 层、落库是 1 层，重开一次才暴露，
 * 且只在用户改进位规则时才被察觉。
 */
const HANDLERS = readFileSync("electron/handlers/novel-handlers.ts", "utf8");
const SETTING_HANDLERS = readFileSync(
  "electron/handlers/novel-setting-handlers.ts",
  "utf8",
);
const CONFIG = readFileSync(
  "src/windows/NovelWindow/pages/NovelPage/novel-config.ts",
  "utf8",
);

/** 取 `export const X = "值";` 里的字面量 */
function literal(source: string, name: string): string | null {
  const match = source.match(
    new RegExp(`export const ${name} = "([^"]*)"`),
  );
  return match ? match[1] : null;
}

describe("设定默认值：主进程与渲染层一致", () => {
  it("色点默认值一致", () => {
    expect(literal(HANDLERS, "DEFAULT_CATEGORY_COLOR")).toBe(
      literal(CONFIG, "DEFAULT_CATEGORY_COLOR"),
    );
  });

  it("小层命名模板一致", () => {
    expect(literal(HANDLERS, "DEFAULT_SUB_PATTERN")).toBe(
      literal(CONFIG, "DEFAULT_SUB_PATTERN"),
    );
  });

  it("渲染层的默认小层数与主进程建表默认值一致（都是 1）", () => {
    const configValue = CONFIG.match(
      /export const DEFAULT_SUB_LEVELS = (\d+)/,
    );
    expect(configValue).not.toBeNull();
    expect(configValue![1]).toBe("1");
    // 主进程：建表列默认值 + 新建分类插入时的字面量都必须是 1
    expect(SETTING_HANDLERS).toMatch(
      /VALUES \(\?, \?, \?, \?, \?, \?, '', 1, 'asc', \?\)/,
    );
  });
});
