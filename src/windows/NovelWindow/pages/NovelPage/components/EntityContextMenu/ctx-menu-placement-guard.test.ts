import { describe, expect, it } from "vitest";
import * as sass from "sass";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 选区右键菜单「不被裁掉」守卫（REQ-056）
 *
 * 事故：菜单项随 AI 文本变换 / 记入行囊 / 新建资料卡 / 绑定列表一路增加到
 * 近 500px 高，而 EditorPane 仍在按「约 190×320」估算夹取坐标。菜单是
 * `.nv-page__stage`（`overflow: hidden`）里的绝对定位浮层，底边一越界就
 * **整块被切掉、且滚动不到**——用户只能看到上半截，下面的功能点不了。
 *
 * 钉死的契约有三条，缺一条就会复发：
 * 1. 高度必须**实测**（`scrollHeight`），不许再用估算常数；
 * 2. 落位必须走 `placeContextMenu`（翻上 / 夹取 / 超高滚动三档）；
 * 3. 样式层面留兜底：菜单自身 `max-height` + `overflow-y: auto`，
 *    即使 JS 量不到 stage 尺寸也不会被裁。
 */
const HERE = __dirname;

const read = (...parts: string[]): string =>
  readFileSync(resolve(HERE, ...parts), "utf8");

const MENU = read("index.tsx");
const PLACEMENT = read("placement.ts");
const EDITOR = read("../EditorPane/index.tsx");

const css = sass.compile(resolve(HERE, "index.scss"), {
  loadPaths: [resolve(HERE, "../../../../../../")],
}).css;

/**
 * 取选择器**自身**的声明（到第一个 `}` 为止）。
 *
 * 不能用花括号配平切整块：`.nv-ctxmenu` 里嵌了 `&__item.ant-btn` 等子规则，
 * 整块切片会把子规则的声明也算进来。本文件只关心基础规则的声明，
 * 而 Sass 输出的基础规则声明都在第一个 `}` 之前。
 */
function ownDecls(selector: string): string {
  const at = css.indexOf(`${selector} {`);
  expect(at, `编译产物里找不到规则 ${selector}`).toBeGreaterThan(-1);
  return css.slice(at, css.indexOf("}", at) + 1);
}

describe("右键菜单不被 stage 裁掉", () => {
  it("菜单高度是实测的（scrollHeight），不是写死的估算常数", () => {
    // 用 scrollHeight 而非 offsetHeight：上一轮若已套 max-height，
    // offsetHeight 量到的是压缩后的高度，会形成「越算越矮」的回路
    expect(MENU).toContain("scrollHeight");
  });

  it("落位交给 placeContextMenu（翻上 / 夹取 / 超高滚动三档都在纯函数里）", () => {
    expect(MENU).toContain("placeContextMenu");
    expect(PLACEMENT).toContain("maxHeight");
    expect(PLACEMENT).toContain("stage.height - margin");
  });

  it("EditorPane 不再按「约 190×320」估算夹取（旧实现在这里切掉下半截）", () => {
    // 反向断言：留着这对常数就等于把 bug 固化回去
    expect(EDITOR).not.toContain("stageRect.height - 320");
    expect(EDITOR).not.toContain("stageRect.width - 208");
  });

  it("菜单自身也有兜底：max-height + 内部滚动，杜绝被 overflow:hidden 切掉", () => {
    const decls = ownDecls(".nv-ctxmenu");
    expect(decls).toContain("max-height: calc(100% - 16px)");
    expect(decls).toContain("overflow-y: auto");
    // max-height 要按 border-box 算，否则 padding + border 会多出 14px 顶出下沿
    expect(decls).toContain("box-sizing: border-box");
  });
});

/**
 * 「绑定到现有资料卡」下线（REQ-062）
 *
 * 它只是把选中文字追加成某张卡的别名，收益与「新建资料卡」高度重叠，
 * 却随资料卡数量线性增长——设定库有 N 张卡就多 N 行，占了菜单一半以上篇幅。
 * 这里钉住它不会悄悄回来（回来的话菜单立刻又会长到要滚动）。
 */
describe("右键菜单不再有「绑定到现有资料卡」", () => {
  const SCSS = readFileSync(resolve(HERE, "index.scss"), "utf8");
  /** 反向断言前先剥注释：文件里解释「已下线」的注释不该被当成残留代码 */
  const MENU_CODE = MENU.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  it("菜单源码里没有绑定分区与其回调", () => {
    expect(MENU_CODE).not.toContain("绑定到现有资料卡");
    expect(MENU_CODE).not.toContain("onBind");
    expect(MENU_CODE).not.toContain("__binds");
  });

  it("菜单不再依赖实体列表（不随资料卡数量长高）", () => {
    expect(MENU_CODE).not.toContain("entities");
    expect(MENU_CODE).not.toContain("NovelEntity");
  });

  it("样式里也不留绑定列表的死代码", () => {
    expect(SCSS).not.toContain("__binds");
    expect(SCSS).not.toContain("__bound");
  });
});
