import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 换章滚动复位守卫。
 *
 * 钉死的失效模式：**切换章节后正文停在上一章的滚动位置**。
 *
 * 根因不是「忘了写归零」，而是写在了够不着的地方：
 * `.nv-editor__scroll` 这个滚动容器**不随章节重挂** —— 编辑器实例整个会话唯一
 * （见 EditorPane 的初始化 effect，依赖 `[]`），正文是 `dispatch` 灌进同一块 DOM。
 * 于是 `useNovelPage` 里那句「换章把 position 记录归零」只改了**记录**，
 * 真实 DOM 的 `scrollTop` 原封不动保留着上一章的值。短章一进来就直接触底，
 * 作者看到的是「文本没了」。
 *
 * 复位必须发生在**持有 DOM ref 的地方**，且要等新正文**排版完成**
 * （在旧高度上设 `scrollTop` 会被新高度夹取，表现为「短章滚不到真正的顶」）。
 *
 * 为什么只能钉源码：EditorPane 是 CodeMirror 宿主，jsdom 里没有真实布局 ——
 * 容器 `clientHeight` 恒为 0、`scrollTop` 赋值不产生任何效果，组件测试无法观测
 * 这条行为。同 `pack-character-name-guard.test.ts` / `novel-db-split.test.ts` 的
 * 源码断言手法。
 */

const root = resolve(__dirname, "../../../../../../..");
const EDITOR = readFileSync(
  resolve(
    root,
    "src/windows/NovelWindow/pages/NovelPage/components/EditorPane/index.tsx",
  ),
  "utf8",
).replace(/\r\n/g, "\n");

/** 取出「换章滚动定位」那个 effect 的函数体（从注释锚点到下一个 effect 之前） */
function scrollEffectBody(): string {
  const anchor = EDITOR.indexOf("换章时的滚动定位");
  if (anchor < 0) throw new Error("index.tsx 里找不到「换章时的滚动定位」effect");
  return EDITOR.slice(anchor, anchor + 2000);
}

describe("换章滚动复位", () => {
  it("滚动复位写在持有 DOM ref 的组件里，且真的落到 .nv-editor__scroll 上", () => {
    const body = scrollEffectBody();
    // 必须去找那个滚动容器 —— 这是「够得着 DOM」的证据
    expect(body).toMatch(/closest<HTMLElement>\("\.nv-editor__scroll"\)/);
    expect(body).toMatch(/scroller\.scrollTop\s*=/);
  });

  it("没有恢复点时滚回顶部（不是什么都不做）", () => {
    const body = scrollEffectBody();
    /*
      反面断言：不许再出现「没有 restore 就 early return」的写法。
      这正是本次修掉的 bug 原文 —— 原先第一行是
        if (!view || !chapter || !restore || restore.chapterId !== chapter.id) return;
      于是正常点章节树 / 大纲换章时整个 effect 直接退出，谁也没去碰 scrollTop。
    */
    expect(body).not.toMatch(
      /if\s*\(!view \|\| !chapter \|\| !restore \|\| restore\.chapterId !== chapter\.id\)\s*return/,
    );
    // 正面：归零分支必须存在，且是「有恢复点用恢复点，否则 0」的三元
    expect(body).toMatch(
      /scroller\.scrollTop\s*=\s*isRestore && restore \? restore\.scrollTop : 0/,
    );
  });

  it("复位放进 requestAnimationFrame —— 等新正文排版完成再设，否则会被旧高度夹取", () => {
    const body = scrollEffectBody();
    expect(body).toMatch(/requestAnimationFrame\(/);
    // 设 scrollTop 的语句必须在 rAF 回调内（在 effect 顶层同步执行会读到旧高度）
    const rafAt = body.indexOf("requestAnimationFrame(");
    const assignAt = body.indexOf("scroller.scrollTop");
    expect(rafAt).toBeGreaterThanOrEqual(0);
    expect(assignAt).toBeGreaterThan(rafAt);
    // 清理帧，避免章节连点时的过期回调去复活一个已被覆盖的滚动位置
    expect(body).toMatch(/cancelAnimationFrame\(/);
  });

  it("effect 依赖含 chapter —— 换章必须重新触发定位", () => {
    const body = scrollEffectBody();
    // activeChapter 由 chapters.find 派生，换章换引用，effect 因此必然触发
    expect(body).toMatch(/\}, \[chapter, restore, onRestoreDone\]\)/);
  });
});
