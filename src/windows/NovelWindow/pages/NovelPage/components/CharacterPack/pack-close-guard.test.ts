/**
 * 行囊第二批修复的守卫（P1-4 / P1-5 / P1-8）
 *
 * ⚠️ 全部走源码断言：`pack-config.ts` / `pack-utils.ts` 可以正常 import，
 * 但 `usePackPanel` 依赖 React 与 IPC，这里的三条约定更适合钉在源码上，
 * 防止某次重构把 key 的取值改回 ownerId 却无人察觉。
 * 路径用 `process.cwd()` 拼 —— vitest 下 `import.meta.url` 不是 file: scheme。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string =>
  readFileSync(resolve(process.cwd(), rel), "utf8");

const CONFIG = read(
  "src/windows/NovelWindow/pages/NovelPage/components/CharacterPack/pack-config.ts",
);
const UTILS = read(
  "src/windows/NovelWindow/pages/NovelPage/components/CharacterPack/pack-utils.ts",
);
const PANEL = read(
  "src/windows/NovelWindow/pages/NovelPage/components/CharacterPack/hooks/usePackPanel.ts",
);
const DATA = read(
  "src/windows/NovelWindow/pages/NovelPage/components/CharacterPack/hooks/usePackData.ts",
);
const VIEW_STATE = read(
  "src/windows/NovelWindow/pages/NovelPage/hooks/useNovelViewState.ts",
);
const PAGE = read(
  "src/windows/NovelWindow/pages/NovelPage/hooks/useNovelPage.ts",
);

describe("P1-4 状态载体键（守卫）", () => {
  it("buildActiveCarriers 的入参取效果自己的 id，不是 ownerId", () => {
    const call = PANEL.slice(PANEL.indexOf("buildActiveCarriers("));
    expect(call.slice(0, 400)).toContain("id: mod.id");
    expect(call.slice(0, 400)).not.toContain("id: mod.ownerId");
  });

  it("新增状态效果时 ownerId 仍写角色 id（多态表约定，不能跟着改）", () => {
    expect(PANEL).toContain('ownerType: "status"');
    expect(PANEL).toContain("ownerId: state.character.id");
  });
});

describe("P1-5 熟练度缩放只作用于技能宿主（守卫）", () => {
  it("computeSummary 里以 ownerType === 'skill' 收窄", () => {
    expect(UTILS).toContain('mod.scaleByProficiency && mod.ownerType === "skill"');
  });

  it("效果编辑器不再给非技能宿主这个开关", () => {
    const editor = read(
      "src/windows/NovelWindow/pages/NovelPage/components/CharacterPack/components/EffectEditor/index.tsx",
    );
    expect(editor).toContain('current.ownerType === "skill"');
  });

  it("列表上的「按熟练度缩放」标签同样收窄，不给失效条目挂标签", () => {
    const list = read(
      "src/windows/NovelWindow/pages/NovelPage/components/CharacterPack/components/ModifierList/index.tsx",
    );
    expect(list).toContain('mod.scaleByProficiency && mod.ownerType === "skill"');
  });
});

describe("P1-8 行囊关闭链路（守卫）", () => {
  it("存在受保护关闭桥，且由面板挂载时注册", () => {
    expect(CONFIG).toContain("export function registerPackCloser");
    expect(CONFIG).toContain("export function requestClosePackPanel");
    expect(PANEL).toContain("registerPackCloser(");
  });

  it("Esc 优先级链与顶栏开关都走桥，不再直接 setPackOpen(false)", () => {
    expect(PAGE).toContain("requestClosePackPanel()");
    expect(VIEW_STATE).toContain("requestClosePackPanel()");
    // handleEscape 里不能留着裸的 view.closePack()
    const escapeBody = PAGE.slice(
      PAGE.indexOf("const handleEscape"),
      PAGE.indexOf("useNovelShortcuts("),
    );
    expect(escapeBody).toContain("requestClosePackPanel()");
    expect(escapeBody).not.toMatch(/^\s*view\.closePack\(\);$/m);
  });

  it("保存失败不关闭面板 —— confirmSaveAndClose 检查返回值后再决定", () => {
    const body = PANEL.slice(PANEL.indexOf("const confirmSaveAndClose"));
    const next = PANEL.indexOf("const confirmDiscardAndClose");
    const slice = body.slice(0, next - body.indexOf("const confirmSaveAndClose"));
    expect(slice).toContain("const ok = await data.save");
    expect(slice).toContain("if (!ok)");
    expect(slice).toContain("return;");
  });

  it("卸载与切作品都有 flushDraft 兜底", () => {
    expect(DATA).toContain("void flushDraft();");
    // deps 里带 workId，让 cleanup 在换书那一帧先跑一次
    const effect = DATA.slice(DATA.indexOf("卸载前 / 切作品前兜底 flush"));
    expect(effect.slice(0, 320)).toContain("[workId, flushDraft]");
  });
});
