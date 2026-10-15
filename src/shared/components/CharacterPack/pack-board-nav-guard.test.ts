import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 「点看板摘要行 → 滚到对应模块」这条链路的守卫。
 *
 * 为什么用源码断言而不是渲染断言：jsdom 没有布局引擎 ——
 * `getBoundingClientRect` 一律返回 0、元素级 `scrollTo` 也不实现，渲染测试里
 * 量不出「到底滚没滚、滚到哪里」。所以把判据抽成了纯函数
 * （`pack-layout.test.ts` 的 `moduleScrollDelta` 一节负责），
 * 这里只钉**接线**：锚点挂在哪儿、滚动时按什么查、展开与滚动的先后。
 *
 * 要防的退化：`data-pack-module` 是**成对字符串**（渲染端写一次、查询端写一次），
 * 任意一边改名都不报错、不编译失败，只是点击后画面再也不动 —— 回到用户报障的
 * 「点了没变化，得自己往下滑」。这类静默失效只能靠源码断言拦。
 */

const SOURCE = readFileSync(
  path.resolve(process.cwd(), "src/shared/components/CharacterPack/index.tsx"),
  "utf8",
);

/** 取某个箭头函数 / 方法定义的正文（从签名到下一个顶层 `};`） */
function bodyOf(signature: string, source = SOURCE): string {
  const start = source.indexOf(signature);
  expect(start, `找不到定义：${signature}`).toBeGreaterThan(-1);
  const end = source.indexOf("\n  };", start);
  expect(end, `找不到定义结尾：${signature}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("行囊看板导航（守卫）", () => {
  it("模块外层挂了 data-pack-module 锚点", () => {
    expect(SOURCE).toContain("data-pack-module={module.key}");
  });

  it("滚动查询用的锚点与渲染端同名（成对字符串，改一边就静默失效）", () => {
    const body = bodyOf("const scrollToModule =");
    expect(body).toContain('body.querySelector<HTMLElement>(`[data-pack-module="${key}"]`)');
    // 渲染端必须写同一个属性名
    expect(SOURCE).toMatch(/data-pack-module=\{module\.key\}/);
  });

  it("滚动判据走 moduleScrollDelta，且 null 时不动画面", () => {
    const body = bodyOf("const scrollToModule =");
    expect(body).toContain("moduleScrollDelta(");
    expect(body).toContain("if (delta === null) return;");
  });

  it("看板入口是「导航」：先展开再滚动，绝不从看板远程收起", () => {
    const body = bodyOf("const openModuleFromBoard =");
    const expandAt = body.indexOf("api.setModuleCollapsed(key, false)");
    const scrollAt = body.indexOf("scrollToModule(key)");
    expect(expandAt).toBeGreaterThan(-1);
    expect(scrollAt).toBeGreaterThan(expandAt);
    // 收起态才展开（按生效值判定），已展开时只滚动
    expect(body).toContain("if (effectiveCollapsed[key])");
    // 不许出现「翻转」语义 —— 那正是旧版「点了没反应」的来源
    expect(body).not.toContain("setModuleCollapsed(key, !");
    expect(body).not.toContain("toggleModuleFromBoard");
  });

  it("看板拿到的就是导航入口，不是旧的翻转回调", () => {
    expect(SOURCE).toContain("onExpandModule={openModuleFromBoard}");
    expect(SOURCE).not.toContain("onExpandModule={toggleModuleFromBoard}");
  });
});
