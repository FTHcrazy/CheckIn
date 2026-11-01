import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CanvasSize } from "../coords";
import { useMapEditor } from "./useMapEditor";

/**
 * `useMapEditor` 的状态机单测（目前只覆盖 `setStyle` 的同值守卫）。
 *
 * ── 为什么这条不能只在页面上测 ──
 * 页面级的第一反应是「选一次羊皮纸 → 再点一次羊皮纸 → 按一次撤销看回不回原色」。
 * 这条路**测不到我们的守卫**：antd/rc-select 对"重选同值"常常根本不发
 * `onChange`（它自己就短路了），于是把 `if (next === doc.style) return;`
 * 整行删掉，页面用例照样绿 —— 那是在测 antd 的行为，不是测我们的代码。
 *
 * 所以这里直接对 hook 下手：绕过 UI 层，连调三次 `setStyle("parchment")`，
 * 只断言**撤销栈深度**。删掉守卫 → 压三步 → 撤销一次还停在羊皮纸 → 红。
 */

const SIZE: CanvasSize = { width: 800, height: 600 };

afterEach(cleanup);

describe("useMapEditor · setStyle 的同值守卫", () => {
  /**
   * PRD §6.4 的落地约束：风格进撤销栈，但**同值不压步**。
   *
   * 【为什么同值压步是缺陷而不是洁癖】`commit` 是无条件记账的：每压一步，用户
   * 就要多按一次 Ctrl+Z 才能退到真正的上一态，而中间那几步画面**完全不动**。
   * 连按三次撤销还在原地，用户会判断"撤销坏了"，比没有撤销更糟。
   */
  it("同值重复调用只压一步撤销（删掉守卫必然变红）", () => {
    const { result } = renderHook(() => useMapEditor(SIZE));

    expect(result.current.doc.style).toBe("none");
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.setStyle("parchment"));
    expect(result.current.doc.style).toBe("parchment");
    expect(result.current.canUndo).toBe(true);

    // 同值再来两次 —— 守卫必须把这两次吃掉
    act(() => result.current.setStyle("parchment"));
    act(() => result.current.setStyle("parchment"));
    expect(result.current.doc.style).toBe("parchment");

    // 【这条断言就是变异检查的靶心】总共只压了 1 步：撤销一次就回到原色，
    // 且撤销栈随之清空。若守卫被删，这里会停在 "parchment"（压了 3 步）。
    act(() => result.current.undo());
    expect(result.current.doc.style).toBe("none");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  /**
   * 反向对照：**不同值**必须真的压步，且每一步都能独立退掉。
   *
   * 只有上一条"同值不压步"时，一个恒不提交的实现也能通过 —— 这条把
   * "守卫吃过界"（把所有调用都 return 掉）这种错误实现钉死。
   */
  it("不同值每次都压步：原色 → 羊皮纸 → 墨色，撤销两次逐级退回", () => {
    const { result } = renderHook(() => useMapEditor(SIZE));

    act(() => result.current.setStyle("parchment"));
    act(() => result.current.setStyle("ink"));
    expect(result.current.doc.style).toBe("ink");

    act(() => result.current.undo());
    expect(result.current.doc.style).toBe("parchment");
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.doc.style).toBe("none");
    expect(result.current.canUndo).toBe(false);
  });
});
