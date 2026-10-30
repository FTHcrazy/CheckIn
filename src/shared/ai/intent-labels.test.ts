/**
 * REQ-064 守卫：意图中文只有一个产地（`shared/ai/intent-labels`）。
 *
 * 真实缺陷：「用量与效果」页只展开了基础意图表，于是落库时带子类型的
 * `transform:tone` / `transform:expand` / `transform:pov` 直接以原始字符串
 * 上屏；而「AI 记录」页自带一份含子类型的映射 —— 两页对同一条记录两种叫法。
 * 修法不是再抄一份，而是把「基础意图 + 变换子类型 + 历史值」摊平成一张表。
 *
 * 这里钉两件事：
 * 1. 每个变换子类型都有中文、且中文里不含 `:`（含 `:` 说明表没命中、回落了 raw key）；
 * 2. `AI_INTENT_LABELS` 每新增一个意图，本表必须跟着覆盖（防止以后又漏登记）；
 * 3. 两个消费页不再各自维护一份映射（否则必然再次漂移）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AI_INTENT_LABELS } from "./context/prompt/registry";
import { TRANSFORM_INTENT_SUB, TRANSFORM_KIND_LABELS } from "./context/prompt/transform";
import { AI_EVENT_INTENT_LABELS, intentLabel } from "./intent-labels";
import type { TransformKind } from "./context/prompt/transform";

const transformKinds = Object.keys(TRANSFORM_INTENT_SUB) as TransformKind[];

describe("intentLabel：变换子类型必须有中文（不裸露内部类型）", () => {
  it("每个 transform 子类型都翻成中文，且不含冒号", () => {
    expect(transformKinds.length).toBeGreaterThan(0);
    for (const kind of transformKinds) {
      const raw = `transform:${TRANSFORM_INTENT_SUB[kind]}`;
      const label = intentLabel(raw);
      expect(label, `${raw} 没有中文标签`).toBeTruthy();
      expect(label, `${raw} 回落成了原始 key`).not.toContain(":");
      expect(label).toBe(TRANSFORM_KIND_LABELS[kind]);
    }
  });

  it("基础意图同样走中文（不裸露拼音 key）", () => {
    for (const intent of Object.keys(AI_INTENT_LABELS)) {
      const label = intentLabel(intent);
      expect(label, `${intent} 缺中文`).toBeTruthy();
      expect(label, `${intent} 回落成了原始 key`).not.toBe(intent);
    }
  });

  it("历史值仍可读（老日志 / 老事件不能显示英文）", () => {
    expect(intentLabel("test")).toBe("连接测试");
    expect(intentLabel("generate")).toBe("生成（旧）");
  });

  it("未登记的意图回落原始值（只读页面不该因为一条脏数据崩掉）", () => {
    expect(intentLabel("brand-new-intent")).toBe("brand-new-intent");
    expect(intentLabel("transform:unknown")).toBe("transform:unknown");
    expect(intentLabel("")).toBe("");
  });
});

describe("AI_EVENT_INTENT_LABELS：覆盖检查（防漏登记）", () => {
  it("覆盖 AI_INTENT_LABELS 的全部键（新增意图必须同步）", () => {
    for (const [intent, label] of Object.entries(AI_INTENT_LABELS)) {
      expect(AI_EVENT_INTENT_LABELS[intent], `${intent} 未登记`).toBe(label);
    }
  });

  it("覆盖全部 transform 子类型键，且值是中文而非子类型串", () => {
    for (const kind of transformKinds) {
      const key = `transform:${TRANSFORM_INTENT_SUB[kind]}`;
      expect(AI_EVENT_INTENT_LABELS[key], `${key} 未登记`).toBe(TRANSFORM_KIND_LABELS[kind]);
      expect(AI_EVENT_INTENT_LABELS[key]).not.toContain(":");
    }
  });

  it("覆盖历史值", () => {
    expect(AI_EVENT_INTENT_LABELS.test).toBe("连接测试");
    expect(AI_EVENT_INTENT_LABELS.generate).toBe("生成（旧）");
  });
});

describe("两个消费页不再各存一份映射（否则又会漂移）", () => {
  const read = (relative: string): string =>
    readFileSync(path.resolve(process.cwd(), relative), "utf8");

  it("UsagePanel / AILogSection 都用 intentLabel", () => {
    const usage = read("src/windows/SettingsWindow/components/UsagePanel/index.tsx");
    const log = read("src/windows/SettingsWindow/components/AILogSection/index.tsx");
    for (const [name, source] of [
      ["UsagePanel", usage],
      ["AILogSection", log],
    ] as const) {
      expect(source, `${name} 没用单一产地`).toContain("shared/ai/intent-labels");
      expect(source, `${name} 还在自己维护映射`).not.toMatch(/const INTENT_LABEL\s*:/);
      // 「AI 记录」页的筛选下拉可以派生，但不许自己写中文映射
      expect(source).not.toContain("TRANSFORM_KIND_LABELS");
    }
    expect(usage).toContain("intentLabel(row.intent)");
    expect(log).toContain("intentLabel(row.intent)");
  });

  it("AILogSection 的筛选下拉仍基于新常量派生（不漏项）", () => {
    const log = read("src/windows/SettingsWindow/components/AILogSection/index.tsx");
    expect(log).toContain("AI_EVENT_INTENT_LABELS");
    expect(log).toContain("INTENT_OPTIONS");
  });
});
