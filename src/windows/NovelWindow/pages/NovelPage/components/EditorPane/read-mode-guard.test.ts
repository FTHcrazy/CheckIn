import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 阅读模式「滚到章节首/尾自动加载上下章」守卫。
 *
 * 钉死的失效模式有两个，都是「看起来对、实际一跳就错」：
 *
 * 1. **把「停在边界」当成「要切章」**：每一章刚进来 `scrollTop` 恒为 0，
 *    于是往下滚的第一帧（平滑滚动中间态只有 1~3px）就被判成「到顶 →
 *    加载上一章」，表现为「切到下一章刚往下滚就弹回上一章」。判定必须带
 *    **滚轮方向**：顶部 + deltaY<0 才是上一章，底部 + deltaY>0 才是下一章。
 * 2. **短章放开后连环跳**：短章顶/底同时成立，只能靠方向区分；一旦放开，
 *    从长章底部切进短章后同一段惯性继续往下 → 又到底 → 再切 … 会一口气
 *    穿过一串短章。必须靠「一次手势只切一章」（滚轮间隔 > GESTURE_GAP 才算
 *    新手势，切章后本次手势即被消费）兜住。
 *
 * 为什么钉源码：jsdom 没有布局，`scrollHeight`/`clientHeight` 恒为 0、
 * 滚轮也没有真实滚动效果，组件测试观测不到这条行为。同
 * `scroll-reset-guard.test.ts` 的源码断言手法。
 */

const EDITOR = readFileSync(resolve(__dirname, "index.tsx"), "utf8").replace(
  /\r\n/g,
  "\n",
);

/** 取出「阅读模式边界加载」这段实现（从注释锚点到换章复位 effect 之前） */
function wheelBody(): string {
  const anchor = EDITOR.indexOf("阅读模式「滚到章节首/尾继续滚");
  if (anchor < 0) throw new Error("index.tsx 里找不到阅读模式边界加载的实现");
  return EDITOR.slice(anchor, anchor + 4000);
}

describe("阅读模式滚动切章", () => {
  it("触发依据是滚轮方向意图，不是「停在边界」", () => {
    const body = wheelBody();
    // 正面：方向与边界必须同时成立才判定意图
    expect(body).toMatch(/atTop && deltaY < 0/);
    expect(body).toMatch(/atBottom && deltaY > 0/);
    /*
      反面：不许再有「在 Scroll 里判边界就直接切章」的写法。
      那就是本次修掉的 bug —— 往下滚时 scrollTop 还在 1~3px，被判成到顶。
    */
    expect(EDITOR).not.toMatch(/handleReadModeEdge/);
  });

  it("短章（一屏装得下）也参与，但阈值更严", () => {
    const body = wheelBody();
    // 反面：不许再把短章整体排除掉
    expect(body).not.toMatch(/readModeRef\.current \|\| el\.scrollHeight <= el\.clientHeight/);
    // 正面：短章走独立阈值（顶/底同时成立，要求更明确的推挤）
    expect(body).toMatch(/scrollable \? PULL : PULL_SHORT/);
  });

  it("一次滚动手势只切一章 —— 拦住「短章连环穿」", () => {
    const body = wheelBody();
    // 手势切分：事件间隔超过 GESTURE_GAP 才算新手势
    expect(body).toMatch(/now - gesture\.lastAt > GESTURE_GAP/);
    // 触发前必须检查「本次手势已消费」，触发后立即消费
    expect(body).toMatch(/gesture\.spent\) return/);
    expect(body).toMatch(/gesture\.spent = true/);
    /*
      反面：换章后的复位**不许**把 spent 清掉。
      切章那一刻用户同一段惯性还在滚，清了 spent 就等于放行连环跳。
    */
    const reset = body
      .slice(body.indexOf("换章后边界状态复位"), body.indexOf("[chapterId]"))
      // 注释里会提到 spent（说明为什么故意保留），断言只看代码
      .replace(/\/\/[^\n]*/g, "");
    expect(reset.length).toBeGreaterThan(0);
    // 复位 effect 只允许清意图，不许碰手势状态
    expect(reset).not.toMatch(/wheelGestureRef|\bspent\s*[:=]/);
  });

  it("监听挂在滚动容器的 wheel 上，并把 deltaMode 折算成 px", () => {
    expect(EDITOR).toMatch(/onWheel=/);
    // deltaMode: 0=px / 1=行 / 2=页，不折算会让阈值在行模式下永远攒不满
    expect(EDITOR).toMatch(/event\.deltaMode === 1/);
    expect(EDITOR).toMatch(/handleReadModeWheel\(el, event\.deltaY \* scale\)/);
  });
});
