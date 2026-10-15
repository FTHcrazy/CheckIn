import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AttributesModule from "./index";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import type { PackDoc } from "../../hooks/usePackData";
import { DEFAULT_UI_PREFS } from "../../types";

/**
 * 人物属性空态引导（UI-03）。
 *
 * 空态不再只是「一句说明」，而是把作者能做的下一步摆出来：套用模板
 * （通用 / 玄幻 / 网游，复用 ATTR_TEMPLATES）或自己建一条。这里的断言钉住
 * 「按钮真的在、真的调到对应动作」，避免后人改回纯文字。
 */

function makeApi(over: { attrView?: unknown[] } = {}) {
  const doc: PackDoc = {
    character: {
      id: "c1",
      workId: "w1",
      name: "主角",
      displayName: "主角",
      avatar: "",
      isProtagonist: true,
      entityId: "",
      realmAt: "",
      note: "",
      sortOrder: 1,
    },
    attrDefs: [],
    attributes: [],
    mappings: [],
    slots: [],
    groups: [],
    categories: [],
    items: [],
    skills: [],
    modifiers: [],
    unitSystems: [],
    layouts: [],
    presets: [],
    realmLink: null,
  };
  return {
    doc,
    attrView: over.attrView ?? [],
    prefs: { ...DEFAULT_UI_PREFS, collapsed: {} },
    toggleModuleCollapsed: vi.fn(),
    applyAttrTemplate: vi.fn(),
    addAttribute: vi.fn(),
    countModifiersOfAttribute: () => 0,
    countMappingsOfAttribute: () => 0,
    isRecentlyChanged: () => false,
    showToast: vi.fn(),
  } as unknown as PackPanelApi;
}

describe("AttributesModule —— 空态分层引导（UI-03）", () => {
  afterEach(cleanup);

  it("无属性：三个模板按钮 + 「自己建属性」，模板点击调到 applyAttrTemplate", () => {
    const api = makeApi();
    render(<AttributesModule api={api} />);

    expect(screen.getByText(/还没有属性/)).toBeInTheDocument();
    for (const name of ["通用", "玄幻", "网游"]) {
      const btn = screen.getByText(`套用${name}模板`).closest("button") as HTMLButtonElement;
      expect(btn).toBeTruthy();
      fireEvent.click(btn);
      expect(api.applyAttrTemplate).toHaveBeenCalledWith(name);
    }
    expect(screen.getByText(/自己建属性/)).toBeInTheDocument();
  });

  it("有属性时不出现空态块", () => {
    const api = makeApi({
      attrView: [
        {
          id: "a1",
          characterId: "c1",
          groupName: "基础属性",
          name: "气血",
          defaultValue: 100,
          baseValue: 100,
          decimals: 0,
          unit: "",
          sortOrder: 1,
          updatedAt: 0,
        },
      ],
    });
    const { container } = render(<AttributesModule api={api} />);
    expect(container.querySelector(".cpk-emptyblock")).toBeNull();
  });
});
