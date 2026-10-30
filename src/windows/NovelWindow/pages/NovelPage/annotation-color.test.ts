import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { annotationLayer } from "./novel-editor";
import type { EntityTerm } from "./types";

/**
 * 自定义类型（ct-*）高亮取色守卫。
 *
 * 钉死的失效模式：**自建类型的要素在正文里完全不高亮**（背景透明、下划线也没有），
 * 内置六类照常。用户看到的现象就是「用了自定义要素，正文没高亮」。
 *
 * 根因不在数据层：buildEntityTerms 照常产出 ct-* 词条、findTermMatches 照常命中、
 * useNovelPage 也照常把 customTypes 的 color 合并进 terms。断在**最后一跳**——
 * `Decoration.mark` 的顶层 `spec.style` 被 @codemirror/view 静默丢弃：
 *
 *   class MarkDecoration extends Decoration {
 *     constructor(spec) {
 *       ...
 *       this.attrs = spec.class && spec.attributes
 *         ? combineAttrs(spec.attributes, { class: spec.class })
 *         : spec.class ? { class: spec.class } : spec.attributes || noAttrs;
 *     }
 *   }
 *
 * DOM 属性只由 `spec.class` 与 `spec.attributes` 拼出来，`spec.style` 从不读取 ——
 * 不报错、不告警，元素上连 style 属性都没有。于是 `--nv-mark-color` 落到 undefined，
 * 而 EditorPane/index.scss 的 `color-mix(in srgb, var(--nv-mark-color) 14%, transparent)`
 * 在变量为空时整条声明失效。
 *
 * 为什么内置类型看不出来：SCSS 给内置六类各写了一条静态 `[data-entity-type="…"]`
 * 规则填 `--nv-mark-color`，ct-* 是动态 id、没有静态规则，**只靠 inline 注入**，
 * 所以这一跳断了只有自建类型受影响。
 *
 * 因此注入必须写在 `attributes.style` 里。下面用真实 CodeMirror（jsdom 无布局但
 * 属性照常写）做行为断言，再用源码断言堵住「又搬回顶层」的回头路。
 */

const root = resolve(__dirname, "../../../../..");
const EDITOR_SRC = readFileSync(resolve(root, "src/windows/NovelWindow/pages/NovelPage/novel-editor.ts"), "utf8")
  .replace(/\r\n/g, "\n");

/** 去掉注释与字符串字面量后再做反向断言：本仓注释习惯把历史 bug 原文写在旁边 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const EDITOR_CODE = stripComments(EDITOR_SRC);

/** 把词库挂进一个真实 EditorView，返回宿主元素 */
function mount(terms: EntityTerm[], doc: string): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  new EditorView({
    parent: host,
    state: EditorState.create({
      doc,
      extensions: [annotationLayer(terms, true)],
    }),
  });
  return host;
}

describe("标注层取色：自定义类型必须真的注入 --nv-mark-color", () => {
  it("带 color 的 ct-* 词条：标记元素上能读到 inline 变量", () => {
    const terms: EntityTerm[] = [
      { term: "九幽诀", entityId: "e1", type: "ct-1", color: "#e0559a" },
    ];
    const host = mount(terms, "他修的是九幽诀，很强");

    const mark = host.querySelector<HTMLElement>("[data-entity-type='ct-1']");
    expect(mark, "自建类型词条没有产生标注标记，说明词库/匹配这一跳就断了").not.toBeNull();
    expect(mark!.style.getPropertyValue("--nv-mark-color").trim()).toBe("#e0559a");
    // 类名与 data-entity-type 仍要在（EditorPane 的 hover 出卡依赖它们）
    expect(mark!.classList.contains("nv-hl")).toBe(true);
    expect(mark!.classList.contains("nv-hl--ct-1")).toBe(true);
    expect(mark!.getAttribute("data-entity-id")).toBe("e1");
  });

  it("自定义颜色随词条变化，不是写死的某一个色", () => {
    const terms: EntityTerm[] = [
      { term: "青囊", entityId: "e1", type: "ct-a", color: "#14b8a6" },
      { term: "赤霄", entityId: "e2", type: "ct-b", color: "#e8722a" },
    ];
    const host = mount(terms, "青囊与赤霄都收进了行囊");

    const a = host.querySelector<HTMLElement>("[data-entity-type='ct-a']");
    const b = host.querySelector<HTMLElement>("[data-entity-type='ct-b']");
    expect(a!.style.getPropertyValue("--nv-mark-color").trim()).toBe("#14b8a6");
    expect(b!.style.getPropertyValue("--nv-mark-color").trim()).toBe("#e8722a");
  });

  it("内置类型词条不带 color：元素上不写 inline style（仍走 SCSS 静态定义）", () => {
    const terms: EntityTerm[] = [{ term: "沈砚", entityId: "e1", type: "character" }];
    const host = mount(terms, "沈砚来了");

    const mark = host.querySelector<HTMLElement>("[data-entity-type='character']");
    expect(mark).not.toBeNull();
    expect(mark!.getAttribute("style")).toBeNull();
    // 内置类型靠 SCSS 的 --nv-mark-color 定义取色，不在这一段断言
  });

  it("同类型多个词条共享一个颜色（colorMapOf 按 type 去重）", () => {
    const terms: EntityTerm[] = [
      { term: "九幽诀", entityId: "e1", type: "ct-1", color: "#8b5cf6" },
      { term: "幽诀", entityId: "e2", type: "ct-1", color: "#8b5cf6" },
    ];
    const host = mount(terms, "九幽诀就是幽诀");

    for (const mark of host.querySelectorAll<HTMLElement>("[data-entity-type='ct-1']")) {
      expect(mark.style.getPropertyValue("--nv-mark-color").trim()).toBe("#8b5cf6");
    }
  });
});

describe("标注层取色（源码守卫）：注入不许搬回顶层 spec.style", () => {
  it("highlightDecoration 把 style 写进 attributes，而不是 Decoration.mark 顶层", () => {
    // 反面：不许出现顶层 `style:` 作为 Decoration.mark spec 的兄弟字段
    expect(EDITOR_CODE).toMatch(/attributes:\s*\{[\s\S]*?"data-entity-type":\s*term\.type/);

    // attributes 块里必须有 style 注入
    const attributesBlock = EDITOR_CODE.match(/attributes:\s*\{([\s\S]*?)\n\s*\},/);
    expect(attributesBlock, "找不到 highlightDecoration 的 attributes 块").not.toBeNull();
    expect(attributesBlock![1]).toMatch(/style:\s*`--nv-mark-color:/);
  });

  it("注释里点明了 MarkDecoration 丢弃顶层 style 的机制", () => {
    // 这条 bug 踩过一次就够：留下机制说明，避免后人「顺手搬回顶层」
    expect(EDITOR_SRC).toMatch(/MarkDecoration/);
    expect(EDITOR_SRC).toMatch(/spec\.class/);
    expect(EDITOR_SRC).toMatch(/静默丢弃|不读取/);
  });
});
