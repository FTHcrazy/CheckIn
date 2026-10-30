import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * IME 组合结束守卫：**`compositionend` 必须补一次正文脉搏**。
 *
 * 钉死的失效模式：中文输入法整段输入之后，自动模式从不重扫、手动模式重扫
 * 坐标整体偏移 N 个字（「改了几个字，高亮全偏了」）。
 *
 * 根因在事件的执行顺序，不在业务逻辑：CodeMirror 自己的 `compositionend`
 * 监听先于应用层那个执行，它在那一刻把候选文本刷进文档 —— `updateListener`
 * 收到 `docChanged` 时 `composingRef` 还是 true，按「候选期不上报」的守卫
 * 直接早退。若 `compositionend` 回调只补 `onChange`（草稿）而不补
 * `onDraftPulse`（脉搏），这段文本对敏感词检测就相当于没发生过：
 * `latestDraft` 停在输入之前，`scanLatestDraft()` 扫的是旧正文。
 *
 * 只能钉源码：jsdom 里没有真实 IME，`CompositionEvent` 也不会驱动 CodeMirror
 * 的 DOM observer，组件测试观测不到「脉搏少报了一次」。同
 * `scroll-reset-guard.test.ts` 的手法。
 */

const root = resolve(__dirname, "../../../../../../..");
const EDITOR = readFileSync(
  resolve(
    root,
    "src/windows/NovelWindow/pages/NovelPage/components/EditorPane/index.tsx",
  ),
  "utf8",
).replace(/\r\n/g, "\n");

/** 取出 `handleCompositionEnd` 的函数体 */
function compositionEndBody(): string {
  const anchor = EDITOR.indexOf("const handleCompositionEnd");
  if (anchor < 0) throw new Error("index.tsx 里找不到 handleCompositionEnd");
  const end = EDITOR.indexOf("};", anchor);
  return EDITOR.slice(anchor, end);
}

describe("EditorPane：compositionend 必须上报脉搏", () => {
  it("组合结束回调里调用 onDraftPulse（不只是 onChange）", () => {
    const body = compositionEndBody();
    expect(body).toContain("onChange");
    expect(body).toContain("onDraftPulse");
  });

  it("docChanged 里的组合期早退仍然保留（候选期不上报，避免字数按拼音递增）", () => {
    // 早退是对的，补脉搏要靠 compositionend —— 别把它当成 bug 顺手删掉
    expect(EDITOR).toContain("if (composingRef.current) return;");
  });
});
