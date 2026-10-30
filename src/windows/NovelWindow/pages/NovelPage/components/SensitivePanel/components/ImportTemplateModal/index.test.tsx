import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ImportTemplateModal from "./index";

/**
 * 词库导入模板弹窗：antd v6 的 DOM 契约 + 小窗口布局约束。
 *
 * 这里钉的是**「样式到底有没有挂到存在的节点上」**这一类问题：
 * - v6 把卡片节点从 `.ant-modal-content` 换成了 `.ant-modal-container`，
 *   照 v5 的写法写 scss 会「一条都命中不了、而且不报错」—— 表现就是
 *   「改了样式毫无反应」，只能靠肉眼比对截图才发现。
 * - 小窗口（Novel 最矮 640）里内容比视口高，必须限制高度 + 正文自滚，
 *   且底部要留出间距；否则滚到底时 footer 直接贴住窗口下沿。
 */

afterEach(() => cleanup());

function scssSource(): string {
  return readFileSync(path.resolve(__dirname, "index.scss"), "utf8").replace(/\r\n/g, "\n");
}

/**
 * 去掉注释再断言：注释里正当地写「v5 的 `.ant-modal-content` 已不存在」是说明，
 * 不该被当成违规用法（真按字面量扫描会逼着人不敢写解释）。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** 递归收集 src 下所有 scss（跳过 node_modules / 隐藏目录） */
function collectScss(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectScss(full, out);
    else if (entry.name.endsWith(".scss")) out.push(full);
  }
  return out;
}

describe("模板弹窗的 antd v6 DOM 契约", () => {
  it("卡片节点是 `.ant-modal-container`，v5 的 `.ant-modal-content` 已不存在", () => {
    const { baseElement } = render(
      <ImportTemplateModal open onClose={() => {}} onNotify={() => {}} />,
    );

    expect(baseElement.querySelector(".nv-tpl-modal .ant-modal-container")).not.toBeNull();
    // 若哪天 antd 又改回 content，这条会先飘红 —— 而不是等用户发现弹窗又贴底了
    expect(baseElement.querySelector(".ant-modal-content")).toBeNull();
  });

  it("header / body / footer 是 container 的直系子节点（scss 里 `>` 选择器的前提）", () => {
    const { baseElement } = render(
      <ImportTemplateModal open onClose={() => {}} onNotify={() => {}} />,
    );

    const container = baseElement.querySelector(".ant-modal-container");
    expect(container).not.toBeNull();
    const direct = Array.from(container?.children ?? []).map((el) => el.className);
    expect(direct.some((name) => name.includes("ant-modal-header"))).toBe(true);
    expect(direct.some((name) => name.includes("ant-modal-body"))).toBe(true);
    expect(direct.some((name) => name.includes("ant-modal-footer"))).toBe(true);
  });

  it("rootClassName 生效：样式命名空间 `.nv-tpl-modal` 挂在 Modal 根节点上", () => {
    const { baseElement } = render(
      <ImportTemplateModal open onClose={() => {}} onNotify={() => {}} />,
    );

    const root = baseElement.querySelector(".ant-modal-root");
    expect(root).not.toBeNull();
    expect(root?.classList.contains("nv-tpl-modal")).toBe(true);
  });
});

describe("模板弹窗的小窗口布局约束", () => {
  it("布局必须挂在 `.ant-modal-container` 上，不得出现 v5 的 `.ant-modal-content`", () => {
    const scss = stripComments(scssSource());
    // v5 的类名一条都命中不了：写了等于没写（而且静默）
    expect(scss).not.toContain(".ant-modal-content");
    expect(scss).toContain(".ant-modal-container");
  });

  it("高度上限按 100vh 扣掉「顶部 100 + 底部留白」，滚到底不贴窗口下沿", () => {
    const matched = stripComments(scssSource()).match(/max-height:\s*calc\(100vh\s*-\s*(\d+)px\)/);
    expect(matched).not.toBeNull();
    const reserve = Number(matched?.[1]);
    // antd 默认 `.ant-modal { top: 100px }`，至少要再留 24px 的底部间距
    expect(reserve).toBeGreaterThanOrEqual(124);
  });

  it("标题与 footer 固定、正文自己滚（小窗口里三个按钮始终可见）", () => {
    const scss = stripComments(scssSource());
    expect(scss).toMatch(/\.ant-modal-footer\s*\{[^}]*flex:\s*none/s);
    expect(scss).toMatch(/\.ant-modal-body\s*\{[^}]*flex:\s*1/s);
    // flex 子项不写 min-height: 0 时最小高度是内容高 → 永远撑开、滚不动
    expect(scss).toMatch(/\.ant-modal-body\s*\{[^}]*min-height:\s*0/s);
    expect(scss).toMatch(/\.ant-modal-body\s*\{[^}]*overflow-y:\s*auto/s);
  });

  it("全仓 scss 不得再出现 v5 的 `.ant-modal-content`（antd 已是 v6）", () => {
    const root = path.resolve(__dirname, "../../../../../../../../");
    const offenders = collectScss(root)
      .filter((file) => stripComments(readFileSync(file, "utf8")).includes(".ant-modal-content"))
      .map((file) => path.relative(root, file));

    expect(offenders).toEqual([]);
  });
});
