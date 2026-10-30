import { describe, expect, it } from "vitest";
import * as sass from "sass";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * REQ-053 守卫：**带遮罩的页内浮层打开时，顶栏必须压在遮罩之上**。
 *
 * 这条只能钉源码 / 编译产物，钉不了 DOM 行为：jsdom 没有命中测试与层叠计算，
 * 「第一击被 `.ant-modal-wrap` 收走」在组件测试里永远不会发生 —— 真机上却是
 * 「行囊 / 小说设定 要点两次」的唯一成因。
 *
 * 三个契约：
 * 1. `.nv-page.is-overlay .nv-page__head` 真的 `position: relative` + `z-index`
 *    高于 Modal 外壳层级（antd 6：`zIndexPopupBase` 1000 + 容器偏移 100 = 1100，
 *    嵌套弹窗各再 +100 ⇒ 1200；容器上限 2100）。写死数字可以，但必须落在这个区间。
 * 2. 页面把 `is-overlay` 挂在 `view.pageOverlayOpen` 上（不是 `focusMode` 之类）。
 * 3. 顶栏收到 `onDismissOverlays`（浮层让位的语义在 `NovelTopBar` 的 click 捕获里）。
 */

const pageScssPath = resolve(__dirname, "index.scss");
const pageTsx = readFileSync(resolve(__dirname, "NovelPage.tsx"), "utf8");
const pageScss = readFileSync(pageScssPath, "utf8");

/** 注释里引用了被删代码原文，断言前必须剥掉（否则反向断言必然假红） */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const css = sass.compile(pageScssPath, {
  loadPaths: [resolve(__dirname, "../../../../../../")],
}).css;

/** 取选择器所在块的声明（块尾用花括号配平，块内可能嵌 `color-mix(...)`） */
function declsOf(selector: string): Record<string, string> {
  const source = css;
  // 必须以「选择器 + {」定位：sass 产物保留注释，注释里引用选择器原文会误命中
  const pattern = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`,
  );
  const matchedAt = pattern.exec(source);
  expect(matchedAt, `编译产物里找不到规则 ${selector}`).not.toBeNull();
  const at = matchedAt ? matchedAt.index : 0;

  let depth = 0;
  let end = at;
  for (let i = at; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  const decls: Record<string, string> = {};
  for (const raw of source.slice(at, end + 1).split("\n")) {
    const line = raw.trim().replace(/;$/, "");
    const matched = /^(--[\w-]+|[a-z-]+)\s*:\s*(.+)$/.exec(line);
    if (matched) decls[matched[1]] = matched[2].trim();
  }
  return decls;
}

describe("页内浮层打开时顶栏压在遮罩之上（REQ-053）", () => {
  it("`.nv-page.is-overlay .nv-page__head` 建层：position + 高于 Modal wrap 的 z-index", () => {
    const decls = declsOf(".nv-page.is-overlay .nv-page__head");

    // 不建 stacking context 的 z-index 是死属性
    expect(decls.position).toBe("relative");

    const z = Number(decls["z-index"]);
    expect(Number.isFinite(z), "z-index 必须是数字").toBe(true);
    // > 1100（扁平 Modal wrap）、> 1200（嵌套一层弹窗）
    expect(z, "低于 antd Modal 外壳就还是会被遮罩吃掉点击").toBeGreaterThan(
      1200,
    );
    // < 2100（antd 容器层上限）：再高就盖过 toast / notification 这类全局层
    expect(z, "高过 antd 容器上限会压住全局浮层").toBeLessThan(2100);
  });

  it("`.nv-page` 只在 `is-overlay` 下抬顶栏，平时（含专注模式）不动层级", () => {
    const plain = declsOf(".nv-page__head");
    expect(plain["z-index"]).toBeUndefined();
    expect(plain.position).toBeUndefined();

    // 反向：直接给 `.nv-page__head` 挂 z-index 会让顶栏永久压住所有浮层
    expect(stripComments(pageScss)).not.toMatch(
      /&__head\s*\{[^}]*z-index/,
    );
  });

  it("页面把 `is-overlay` 挂在 view.pageOverlayOpen 上", () => {
    expect(stripComments(pageTsx)).toContain(
      'view.pageOverlayOpen ? " is-overlay" : ""',
    );
  });

  it("顶栏拿到 onDismissOverlays（点击顶栏 → 先收浮层再执行动作）", () => {
    expect(stripComments(pageTsx)).toContain(
      "onDismissOverlays={view.dismissPageOverlays}",
    );
  });
});
