import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import NovelTopBar from ".";
import type { NovelWork } from "../../types";

/**
 * 顶栏动作图标的层次与开关语义（UI-07 收尾 + REQ-050 修法 ③ + O-02 / O-05）。
 *
 * 这里钉的是**结构契约**（几颗常驻图标、哪些带 is-on、aria-pressed 是否跟着
 * 状态走、低频入口是否真的进了溢出菜单），视觉三档本身由 `novel-ui-kit.test.ts`
 * 从编译产物断言 —— jsdom 没有样式引擎，在这边断言背景色只会得到空字符串。
 *
 * REQ-050：顶栏「本书设定」与「排版与偏好」原本「只开不关」，缺 toggle 语义。
 * O-02（2.57.0）：六颗无文字图标同权平铺 → 收成「布局组 / 阅读+外观组 / ⋯」。
 * 行囊、历史快照、设定中心三个低频入口进溢出菜单，并且**带文字说明**。
 */

const works: NovelWork[] = [
  { id: "w1", name: "测试作品", createdAt: 1 },
  { id: "w2", name: "第二本", createdAt: 2 },
];

/** 四颗常驻图标的可访问名，顺序即渲染顺序（阅读模式是 O-05 新增的那颗） */
const ICON_LABELS = ["章节栏", "支撑面板", "阅读模式", "排版与偏好"] as const;

/** 只构建 props（不渲染）—— 需要自己控制 render/rerender 的用例用这个 */
function buildProps(over: Partial<Parameters<typeof NovelTopBar>[0]> = {}) {
  return {
    works,
    activeWorkId: "w1",
    workMeta: new Map(),
    volumeName: "第一卷",
    chapterName: "第一章",
    leftOpen: false,
    rightOpen: false,
    settingsOpen: false,
    snapshotOpen: false,
    settingCenterOpen: false,
    readMode: false,
    onSelectWork: vi.fn(),
    onCreateWork: vi.fn(() => true),
    onRenameWork: vi.fn(() => true),
    onSetWorkGenre: vi.fn(() => true),
    onDeleteWork: vi.fn(),
    onResetTemplate: vi.fn(),
    onExportBook: vi.fn(),
    onExportVolume: vi.fn(),
    onExportChapter: vi.fn(),
    onToggleLeft: vi.fn(),
    onToggleRight: vi.fn(),
    onToggleSettings: vi.fn(),
    onToggleSettingCenter: vi.fn(),
    onToggleReadMode: vi.fn(),
    onToggleHistory: vi.fn(),
    onOpenPack: vi.fn(),
    ...over,
  };
}

function setup(over: Partial<Parameters<typeof NovelTopBar>[0]> = {}) {
  const props = buildProps(over);
  render(<NovelTopBar {...props} />);
  return props;
}

/** 顶栏图标按钮：可访问名 → 按钮元素（antd 会把 className 挂到根 button 上） */
const iconButton = (label: string) =>
  screen.getByLabelText(label).closest("button") as HTMLButtonElement;

/** 打开「⋯」溢出菜单（antd Dropdown 走点击触发器，菜单渲染在 portal 里） */
const openMore = () => {
  fireEvent.click(iconButton("更多入口"));
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("NovelTopBar：图标层次契约", () => {
  it("四颗常驻图标都挂同一个类，才能共用三档样式", () => {
    setup();
    ICON_LABELS.forEach((label) => {
      const button = iconButton(label);
      expect(button, `${label} 未渲染成按钮`).toBeTruthy();
      expect(button.className).toContain("nv-topbar__icon");
    });
  });

  it("全部收起时四颗图标都不带 is-on（默认档）", () => {
    setup();
    ICON_LABELS.forEach((label) => {
      expect(iconButton(label).className).not.toContain("is-on");
    });
  });

  it("开关打开时对应按钮进激活档，且 aria-pressed 跟着状态走", () => {
    setup({ leftOpen: true, readMode: true, settingsOpen: false });

    expect(iconButton("章节栏").className).toContain("is-on");
    expect(iconButton("章节栏").getAttribute("aria-pressed")).toBe("true");
    // O-05：阅读模式是持久开关，开态必须能看出来
    expect(iconButton("阅读模式").className).toContain("is-on");
    expect(iconButton("阅读模式").getAttribute("aria-pressed")).toBe("true");

    // 未开的仍是默认档，aria-pressed 明确为 false（不是缺失）
    expect(iconButton("支撑面板").className).not.toContain("is-on");
    expect(iconButton("支撑面板").getAttribute("aria-pressed")).toBe("false");
    expect(iconButton("排版与偏好").className).not.toContain("is-on");
    expect(iconButton("排版与偏好").getAttribute("aria-pressed")).toBe("false");
  });

  it("点击各自只触发自己的回调", () => {
    const props = setup();
    iconButton("章节栏").click();
    iconButton("排版与偏好").click();
    iconButton("阅读模式").click();
    expect(props.onToggleLeft).toHaveBeenCalledTimes(1);
    expect(props.onToggleSettings).toHaveBeenCalledTimes(1);
    expect(props.onToggleReadMode).toHaveBeenCalledTimes(1);
    expect(props.onToggleRight).not.toHaveBeenCalled();
  });
});

/**
 * O-05：阅读模式提为可见开关。
 *
 * 能力本身（只读 + 隐藏光标 + 章首尾续滚翻章）早就建好了，问题是它只存在于
 * 「排版与偏好」抽屉的第二块里，没有任何人找得到。这条钉的是**入口存在且可读**：
 * 顶栏常驻一颗「书」，开态补出「读」字标签（只靠图标变色在浅色主题下太弱）。
 */
describe("NovelTopBar：阅读模式可见开关（O-05）", () => {
  it("常驻渲染，关态只有图标、没有「读」标签", () => {
    setup();
    const button = iconButton("阅读模式");
    expect(button).toBeTruthy();
    expect(button.textContent).not.toContain("读");
  });

  it("开态补出「读」字标签（一眼能看出现在处于阅读模式）", () => {
    setup({ readMode: true });
    expect(iconButton("阅读模式").textContent).toContain("读");
  });

  it("点击即切（是 toggle，不是「只能打开」）", () => {
    const onToggleReadMode = vi.fn();
    setup({ onToggleReadMode });
    fireEvent.click(iconButton("阅读模式"));
    fireEvent.click(iconButton("阅读模式"));
    expect(onToggleReadMode).toHaveBeenCalledTimes(2);
  });
});

/**
 * O-02 / O-01：低频入口收进溢出菜单。
 *
 * 三个入口（设定中心 / 历史快照 / 行囊）都还在，只是不再各占一颗顶栏图标；
 * 菜单项**带文字**——图层 / 时钟 / 书包三个字形无法自解释，同排并列只会变成
 * 「点开才知道」。
 */
describe("NovelTopBar：低频入口进溢出菜单（O-02）", () => {
  it("菜单收起时三颗旧图标都不在顶栏上（只剩四颗常驻 + 更多）", () => {
    setup();
    ["行囊", "历史快照", "设定中心"].forEach((label) => {
      expect(screen.queryByLabelText(label)).toBeNull();
    });
    expect(screen.getByLabelText("更多入口")).toBeInTheDocument();
  });

  it("展开菜单后三项都以文字出现（不是纯图标）", () => {
    setup();
    openMore();
    ["设定中心", "历史快照", "行囊"].forEach((text) => {
      expect(screen.getByText(text, { selector: "b" })).toBeInTheDocument();
    });
    // 分组标题：菜单按「本书内容」分组（O-01 的命名归位）
    expect(screen.getByText("本书内容")).toBeInTheDocument();
  });

  it("三行菜单项都带图标（缺一行就会让标题左移一格，扫下来像漏了一格）", () => {
    setup();
    openMore();
    const items = document.querySelectorAll(".ant-dropdown-menu-item");
    // 分组标题不是菜单项，只有 3 条真项
    expect(items).toHaveLength(3);
    items.forEach((item) => {
      const icon = item.querySelector(".ant-dropdown-menu-item-icon");
      expect(icon, item.textContent ?? "").not.toBeNull();
      // 图标是内联 SVG（SvgIcon），不是空的占位 span
      expect(icon!.querySelector("svg")).not.toBeNull();
      // 三颗都挂 18px 图标盒：antd 默认给 12px，对着两行文字像个小点。
      // 注意 antd 会用 `cloneElement` 把它的 `-item-icon` 类**合并到我们这一层**，
      // 所以类名就在图标元素自己身上，不是子节点。
      expect(icon!.classList.contains("nv-topbar__menu-ico")).toBe(true);
    });
  });

  it("菜单项各自触发自己的回调，且不互相串台", () => {
    const onToggleSettingCenter = vi.fn();
    const onToggleHistory = vi.fn();
    const onOpenPack = vi.fn();
    setup({ onToggleSettingCenter, onToggleHistory, onOpenPack });

    openMore();
    fireEvent.click(screen.getByText("设定中心", { selector: "b" }));
    expect(onToggleSettingCenter).toHaveBeenCalledTimes(1);
    expect(onToggleHistory).not.toHaveBeenCalled();
    expect(onOpenPack).not.toHaveBeenCalled();
  });

  it("引导锚点 topbar-setting / topbar-pack 仍在顶栏源码里（第 3、4 步依赖）", () => {
    setup();
    openMore();
    // 菜单项文字节点上挂着锚点；菜单收起时它们不在布局树里，所以引导另有 fallback
    expect(
      screen.getByText("设定中心", { selector: "b" }).closest("[data-tour-target]"),
    ).toHaveAttribute("data-tour-target", "topbar-setting");
    expect(
      screen.getByText("行囊", { selector: "b" }).closest("[data-tour-target]"),
    ).toHaveAttribute("data-tour-target", "topbar-pack");
  });

  it("「⋯」自己带 topbar-more 锚点（菜单收起时引导的落点）", () => {
    setup();
    expect(iconButton("更多入口")).toHaveAttribute(
      "data-tour-target",
      "topbar-more",
    );
    expect(iconButton("更多入口")).toHaveAttribute("aria-expanded", "false");
  });
});

describe("NovelTopBar：「排版与偏好」语义", () => {
  it("带 data-drawer-keep-open=settings（点外部关闭的例外标记）", () => {
    setup();
    const btn = screen.getByRole("button", { name: "排版与偏好" });
    expect(btn).toHaveAttribute("data-drawer-keep-open", "settings");
    expect(btn).toHaveAttribute("aria-pressed", "false");
  });
});

/**
 * REQ-053：浮层（设定中心 / 类型管理 Modal）开着时，顶栏按钮的第一击必须
 * 既落到按钮本身、又收掉浮层 —— 否则就是「行囊 / 设定中心要点两次」。
 *
 * 这里钉的是**通知时机与例外**（jsdom 没有遮罩几何，命中范围由
 * `NovelPage/index.scss` 的 `.nv-page.is-overlay` 负责，那条由样式守卫钉）。
 */
describe("NovelTopBar：页内浮层让位（REQ-053）", () => {
  it("点常驻图标时先收浮层、再执行动作（同一次点击，两个动作都发生）", () => {
    const order: string[] = [];
    const onDismissOverlays = vi.fn(() => order.push("dismiss"));
    const onToggleLeft = vi.fn(() => order.push("left"));
    setup({ onDismissOverlays, onToggleLeft });

    iconButton("章节栏").click();

    expect(onDismissOverlays).toHaveBeenCalledTimes(1);
    expect(onToggleLeft).toHaveBeenCalledTimes(1);
    // 顺序不能反：先把浮层收掉（它若还在，会把这次点击的后续动作压在下面）
    expect(order).toEqual(["dismiss", "left"]);
  });

  it("设定中心菜单项自己带 data-page-overlay-keep-open（它是开关本体）", () => {
    setup();
    openMore();
    expect(
      screen.getByText("设定中心", { selector: "b" }).closest("[data-page-overlay-keep-open]"),
    ).toHaveAttribute("data-page-overlay-keep-open", "settingCenter");
  });

  it("其余常驻图标都不带 data-page-overlay-keep-open", () => {
    setup({ onDismissOverlays: vi.fn() });
    [...ICON_LABELS, "更多入口"].forEach((label) => {
      expect(iconButton(label).hasAttribute("data-page-overlay-keep-open")).toBe(
        false,
      );
    });
  });
});

/**
 * REQ-054：行囊是独立窗口，首次创建要等整个 SPA 装载（dev 下 1–3s）。
 * 这段时间入口必须**自己说明正在打开** —— 否则作者只会看到「点了没反应」。
 *
 * O-02 之后它搬进了溢出菜单，这条契约跟着搬：菜单项文案换成「正在打开…」。
 */
describe("NovelTopBar：行囊「正在打开」态（REQ-054）", () => {
  it("packOpening=true → 菜单项说明正在打开", () => {
    setup({ packOpening: true });
    openMore();
    expect(screen.getByText("正在打开…")).toBeInTheDocument();
  });

  it("默认（窗口未在打开）说明用途，点击即发请求", () => {
    const onOpenPack = vi.fn();
    setup({ onOpenPack });
    openMore();
    expect(screen.getByText("主角状态盘点")).toBeInTheDocument();
    fireEvent.click(screen.getByText("行囊", { selector: "b" }));
    expect(onOpenPack).toHaveBeenCalledTimes(1);
  });
});

/**
 * O-08：保存失败整格可点。
 *
 * 此前只有一行红字，用户看见「保存失败」却无处可点，只能反复 Ctrl+S 猜。
 * 这条钉「失败态是可点的按钮」——jsdom 里能验的就是角色与可点性，
 * 视觉（淡红底 / 手型）由 `novel-ui-kit.test.ts` 从编译产物断言。
 */
describe("NovelTopBar：保存失败可点重试（O-08）", () => {
  it("失败态渲染成按钮（不是纯文字块）", async () => {
    const store = await import("../../store/useNovelEditorStore");
    store.useNovelEditorStore.setState({ saveState: "failed" });
    setup();
    const button = screen.getByRole("button", { name: "保存失败，点击重试" });
    expect(button).toBeInTheDocument();
    // 文案要说清「能点」，不能只写「保存失败」
    expect(button.textContent).toContain("点击重试");
  });
});
