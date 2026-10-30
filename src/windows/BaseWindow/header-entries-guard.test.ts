/**
 * 主窗标题栏入口守卫（合并事故回归）
 *
 * 背景：地图分支与 novel 分支各自改过 `App.tsx` 的标题栏，合并时
 * `MapEntry` 的 import 保留下来了、`actions` 插槽里却只剩 `SettingsEntry`
 * —— 编译不报错（一个未使用的 import 而已），运行时表现为「地图入口凭空消失」。
 *
 * 所以这里钉两件事：
 * 1. 标题栏动作插槽里**同时**挂着「地图」与「设置」两个入口；
 * 2. 地图那颗按钮发的 `map-window-open` 在 preload 白名单里 —— 白名单漏了
 *    同样静默：点击有反应（无异常）、主进程永远收不到。
 *
 * 纯源码断言：App 挂了 ThemeProvider + 路由，渲染整棵树只为点一次按钮不划算。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(path.resolve(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");
}

/** 取 `actions={` 起的那个 JSX 属性值（到与之配平的 `}` 为止） */
function readActionsProp(source: string): string {
  const start = source.indexOf("actions={");
  expect(start, "App.tsx 的 WindowHeader 没有 actions 插槽").toBeGreaterThan(-1);

  let depth = 0;
  for (let i = source.indexOf("{", start); i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error("actions 插槽的花括号没有配平");
}

describe("BaseWindow 标题栏入口", () => {
  const app = readSource("src/windows/BaseWindow/App.tsx");

  it("地图入口挂在 WindowHeader 的 actions 插槽里（与设置入口并列）", () => {
    const actions = readActionsProp(app);
    expect(actions).toContain("<MapEntry />");
    expect(actions).toContain("<SettingsEntry />");
    // 地图在左、设置在右：贴窗控按钮的永远是设置，顺序反了会让人点错
    expect(actions.indexOf("<MapEntry />")).toBeLessThan(
      actions.indexOf("<SettingsEntry />"),
    );
  });

  it("地图入口只此一处（不允许在页面里再挂一个浮动入口）", () => {
    const hits = app.match(/<MapEntry\s*\/>/g) ?? [];
    expect(hits).toHaveLength(1);
  });

  it("map-window-open 在 preload 的 send 白名单内", () => {
    const preload = readSource("electron/preload.ts");
    expect(preload).toContain("'map-window-open'");
  });

  it("地图入口本身只经 IPC 唤起窗口，不承载地图逻辑", () => {
    const entry = readSource("src/windows/BaseWindow/components/MapEntry/index.tsx");
    expect(entry).toContain('send("map-window-open"');
    // 窗口边界：入口不得 import 地图窗口的任何内容（注释里提到名字无妨）
    expect(entry).not.toMatch(/from\s+["'][^"']*MapWindow/);
  });
});
