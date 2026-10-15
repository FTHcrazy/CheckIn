import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OutlineActions } from "../OutlinePanel";
import type { InspirationActions } from "../InspirationPanel";
import type { NamingActions } from "../NameGeneratorPanel";
import SupportPanel from "./index";

/**
 * REQ-049：要素 tab 的「类型管理」入口。
 *
 * 原来只是一颗纯图标按钮（带 Tooltip）——在面板头一排 icon 里几乎发现不了，
 * 而它是新建自定义类型的**唯一**入口。修法：升级为「图标 + 文字」按钮，
 * 并在要素库空态补一条直达引导 + CTA。
 *
 * ⚠️ 断言不要用 `getByText("类型管理")`：面板头与空态**各有一颗**，
 * 会 multiple match。按 class 定位，文字比对先去掉空白（antd 会在两个中文字
 * 之间插入空格）。
 */
const outlineActions: OutlineActions = {
  onEditChapterNote: vi.fn(),
  onAddForeshadow: vi.fn(),
  onUpdateForeshadow: vi.fn(),
  onToggleForeshadow: vi.fn(),
  onRemoveForeshadow: vi.fn(),
};

const inspirationActions: InspirationActions = {
  onAddNote: vi.fn(),
  onUpdateNote: vi.fn(),
  onTogglePin: vi.fn(),
  onRemoveNote: vi.fn(),
  onPromoteNote: vi.fn(),
};

const namingActions: NamingActions = {
  onInsertToEditor: vi.fn(),
  onCreateCharacter: vi.fn(),
  onAddFavorite: vi.fn(),
  onRemoveFavorite: vi.fn(),
};

/** 组件挂载时给 antd Button ref 赋值会用到 offsetLeft / offsetWidth（jsdom 恒 0，无妨） */
const buildProps = (
  over: Partial<Parameters<typeof SupportPanel>[0]> = {},
): Parameters<typeof SupportPanel>[0] => ({
  open: true,
  activeTab: "entity",
  onTabChange: vi.fn(),
  width: 320,
  onWidthChange: vi.fn(),
  onCollapse: vi.fn(),
  outline: [],
  activeChapterId: null,
  outlineActions,
  entities: [],
  filter: "all",
  onFilterChange: vi.fn(),
  detailEntityId: null,
  onOpenEntity: vi.fn(),
  onCloseEntity: vi.fn(),
  getEntityRelations: () => [],
  settings: [],
  notes: [],
  globalNotes: [],
  activeWorkId: "w1",
  workNameOf: () => "",
  inspirationActions,
  onSearch: async () => [],
  onSelectChapter: vi.fn(),
  getAppearances: () => [],
  highlighted: false,
  onToggleHighlight: vi.fn(),
  onExportCard: vi.fn(),
  onSaveEntity: vi.fn(),
  onAddRelation: vi.fn(),
  onRemoveRelation: vi.fn(),
  onSetEntityLevel: vi.fn(),
  onOpenSettings: vi.fn(),
  protagonistEntityId: "",
  onSetProtagonist: vi.fn(),
  onOpenTypeManager: vi.fn(),
  namingActions,
  namingExclude: [],
  namingFavorites: [],
  ...over,
});

describe("SupportPanel：要素 tab 类型管理入口（REQ-049）", () => {
  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
  });

  it("面板头有「图标 + 文字」的类型管理按钮，点击调 onOpenTypeManager", () => {
    const onOpenTypeManager = vi.fn();
    const { container } = render(
      <SupportPanel {...buildProps({ onOpenTypeManager })} />,
    );

    const head = container.querySelector<HTMLElement>(
      ".nv-panel__head-actions .nv-panel__type",
    );
    expect(head).not.toBeNull();
    // 不是纯图标：带可读文字（antd 会在「类型」「管理」间插空格，去空白再比）
    expect(head!.textContent?.replace(/\s/g, "")).toContain("类型管理");
    expect(head).toHaveAttribute("aria-label", "要素类型管理");

    fireEvent.click(head!);
    expect(onOpenTypeManager).toHaveBeenCalledTimes(1);
  });

  it("要素库空态给「类型管理」直达引导与 CTA（同为 onOpenTypeManager）", () => {
    const onOpenTypeManager = vi.fn();
    const { container } = render(
      <SupportPanel {...buildProps({ onOpenTypeManager })} />,
    );

    const hint = container.querySelector(".nv-empty__hint");
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toContain("还没有自定义类型");

    const cta = container.querySelector<HTMLElement>(".nv-empty__cta");
    expect(cta).not.toBeNull();
    expect(cta!.textContent?.replace(/\s/g, "")).toContain("类型管理");

    fireEvent.click(cta!);
    expect(onOpenTypeManager).toHaveBeenCalledTimes(1);
  });
});
