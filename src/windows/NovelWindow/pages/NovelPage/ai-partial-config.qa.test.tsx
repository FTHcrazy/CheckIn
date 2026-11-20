/**
 * QA 独立复核（REQ-063）：**「开关开着但没配全」时入口必须还在**。
 *
 * 这是本次需求最容易做错的一条：把 `available` 当成「出不出现」的判据，
 * 就会在「开着但缺模型 / 缺 Key / 缺地址」时把入口也一起收掉 —— 用户看见
 * AI 页明明勾了「启用」，写作界面却一个 AI 入口都没有，既不知道能配、
 * 也不知道该补哪一项。
 *
 * 因此这里不复制工程师的源码字符串断言（那只能证明某个字符串还在文件里），
 * 而是**真把组件挂起来**，按两种状态各渲染一次，读渲染树的实际产出：
 *
 * | 状态                | aiVisible | aiAvailable | 期望                        |
 * |---------------------|-----------|-------------|-----------------------------|
 * | 开关关 / 没有通道    | false     | false       | 整块不在渲染树              |
 * | 开着但没配全         | true      | false       | 在、禁用、带原因说明        |
 * | 可用                | true      | true        | 在、可点                    |
 *
 * 为什么用组件测试而不是再写一份源码 grep：`ai-hidden-guard.test.ts` 已经钉了
 * 「源码里有 `{aiVisible ? …}`」；但「`disabled` 有没有等于 `!aiAvailable`」
 * 「禁用时那句原因有没有真的挂上去」只有渲染出来才看得见。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TRANSFORM_KIND_LABELS, type TransformKind } from "@/shared/ai/context";
import EntityContextMenu from "./components/EntityContextMenu";
import NameGeneratorPanel, {
  type NamingActions,
} from "./components/NameGeneratorPanel";
import AiFabGroup from "./components/AiFabGroup";

/**
 * 把 antd `Tooltip` 换成「把 title 落到 data 属性上」的替身。
 *
 * 原因不是图省事：jsdom 里 hover 打开 antd Tooltip 既依赖 rc-trigger 的原生
 * 监听、又依赖 layout 测量，禁用态下更测不出来（实测 `fireEvent.mouseEnter`
 * 对 disabled 子节点不触发）。这里要钉的是**组件有没有把「原因」交给说明层**，
 * 而不是「antd 的浮层会不会弹」——后者留给真机核对。
 *
 * FloatButton 也一并换桩：它的 tooltip 是内部 `import Tooltip from "../tooltip"`
 * （antd 包内深路径），外置依赖下 mock 不到那层；替桩把 tooltip 直接落到
 * data 属性上，同一套断言语义。禁用态仍走真实 DOM 的 disabled 属性。
 *
 * tooltip 支持 string 与 `{ title, placement }` 两种形态（antd 会把对象
 * 展开成 Tooltip 的 props），替桩统一只取 title。
 */
const tooltipTextOf = (tooltip: unknown): string => {
  if (typeof tooltip === "string") return tooltip;
  if (tooltip && typeof tooltip === "object" && "title" in tooltip) {
    const title = (tooltip as { title?: unknown }).title;
    return typeof title === "string" ? title : "";
  }
  return "";
};

vi.mock("antd", async (importOriginal) => {
  const actual = await importOriginal<typeof import("antd")>();
  const TooltipStub = ({
    title,
    children,
  }: {
    title?: unknown;
    children?: React.ReactNode;
  }) => (
    <span data-qa-tooltip={tooltipTextOf(title)}>
      {children}
    </span>
  );
  const FloatButtonStub = ({
    tooltip,
    disabled,
    onClick,
    icon,
    "aria-label": label,
  }: {
    tooltip?: unknown;
    disabled?: boolean;
    onClick?: () => void;
    icon?: React.ReactNode;
    "aria-label"?: string;
  }) => (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      data-qa-tooltip={tooltipTextOf(tooltip)}
    >
      {icon}
    </button>
  );
  const FloatButtonGroupStub = ({
    open,
    onOpenChange,
    icon,
    tooltip,
    "aria-label": label,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    icon?: React.ReactNode;
    tooltip?: unknown;
    "aria-label"?: string;
    children?: React.ReactNode;
  }) => (
    <div className="ant-float-btn-group" data-open={open ? "true" : "false"}>
      {children}
      <TooltipStub title={tooltip}>
        <button
          type="button"
          aria-label={label}
          onClick={() => onOpenChange?.(!open)}
        >
          {icon}
        </button>
      </TooltipStub>
    </div>
  );
  return {
    ...actual,
    Tooltip: TooltipStub,
    FloatButton: Object.assign(FloatButtonStub, {
      Group: FloatButtonGroupStub,
    }),
  };
});

/** 复用 useAiAvailability 的真实文案，避免测试自己编一套说法 */
const REASON = "尚未配置模型名，请先在设置里填写";

/** 读「某个入口按钮」身上的 tooltip 文案（替桩直接落在 data 属性上） */
const tipOf = (container: HTMLElement, label: string): string | null =>
  container
    .querySelector(`[aria-label="${label}"]`)
    ?.getAttribute("data-qa-tooltip") ?? null;

afterEach(() => {
  // antd 的 Tooltip / Modal / Select 弹层都往 body 挂节点，RTL 收不干净
  cleanup();
  document.body.innerHTML = "";
});

// ── 1. AiFabGroup：只有 aiAvailable 决定禁用，不决定存亡 ────────────────
const renderFab = (aiAvailable: boolean) =>
  render(
    <AiFabGroup
      open
      onOpenChange={() => {}}
      onContinue={() => {}}
      aiAvailable={aiAvailable}
      aiUnavailableText={REASON}
      rescueHint="卡文救援（给几个互不相同的后续走向）"
      onRescue={() => {}}
    />,
  );

describe("AiFabGroup：开着但没配全 → 入口在、禁用、带原因", () => {
  it("渲染出来且置灰（不是被收掉）", () => {
    const { container, unmount } = renderFab(false);
    const button = screen.getByRole("button", {
      name: "AI 续写",
    }) as HTMLButtonElement;
    expect(container.querySelector(".ant-float-btn-group")).toBeTruthy();
    expect(button.disabled).toBe(true);
    unmount();
  });

  it("禁用时交给说明层的是「原因」，可用时才是「功能说明」", () => {
    const { container, unmount } = renderFab(false);
    const disabledTip = tipOf(container, "AI 续写");
    expect(disabledTip, "禁用时没有把原因交给说明层 → 用户只会看到一颗死按钮").toBe(
      REASON,
    );
    unmount();

    const { container: available, unmount: unmount2 } = renderFab(true);
    const enabledTip = tipOf(available, "AI 续写");
    expect(enabledTip).not.toBe(REASON);
    expect(enabledTip).toContain("续写");
    unmount2();
  });

  it("可用时不禁用（确认禁用真的来自 aiAvailable，而不是恒为 true）", () => {
    const { unmount } = renderFab(true);
    const button = screen.getByRole("button", {
      name: "AI 续写",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    unmount();
  });
});

// ── 2. EntityContextMenu：整块收起 vs 整块禁用 ────────────────────────
const TRANSFORM_ORDER: TransformKind[] = ["expand", "condense", "rewrite", "tone", "pov"];

function ctxMenu(aiVisible: boolean, aiAvailable: boolean) {
  return (
    <EntityContextMenu
      x={10}
      y={10}
      text="他缓缓抬起手"
      onAddToPack={() => {}}
      onMark={() => {}}
      onPolish={() => {}}
      onTransform={() => {}}
      aiVisible={aiVisible}
      aiAvailable={aiAvailable}
      aiUnavailableText={REASON}
      onClose={() => {}}
    />
  );
}

describe("EntityContextMenu：AI 块的三种呈现", () => {
  it("开着但没配全 → 「文本变换」标签 + 润色 + 五个变换都在，且全部禁用", () => {
    const { container } = render(ctxMenu(true, false));

    expect(container.textContent).toContain("文本变换");
    const polish = screen.getByRole("menuitem", { name: /润\s*色这段文字/ });
    expect(polish).toBeTruthy();
    expect((polish as HTMLButtonElement).disabled).toBe(true);

    for (const kind of TRANSFORM_ORDER) {
      const item = screen.getByRole("menuitem", {
        name: new RegExp(TRANSFORM_KIND_LABELS[kind]),
      });
      expect((item as HTMLButtonElement).disabled, `${kind} 应禁用`).toBe(true);
    }
    // 原因挂在每一项的 title 上（antd Button 的 title 会落到 DOM）
    expect(polish.getAttribute("title")).toBe(REASON);
  });

  it("开关关掉 → 整块（标签 + 润色 + 五个变换）不在渲染树里", () => {
    const { container } = render(ctxMenu(false, false));

    expect(container.textContent).not.toContain("文本变换");
    expect(container.textContent).not.toContain("润色这段文字");
    for (const kind of TRANSFORM_ORDER) {
      expect(container.textContent, `${kind} 仍在`).not.toContain(
        TRANSFORM_KIND_LABELS[kind],
      );
    }
    // 反向：不许留下「灰按钮」——菜单里一个 AI 相关按钮都不能有
    const disabledItems = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".nv-ctxmenu__item"),
    ).filter((node) => node.disabled);
    expect(disabledItems, "AI 关掉后不该再出现任何禁用项").toHaveLength(0);
  });

  it("关掉 AI 后菜单不能变成空壳：非 AI 项照旧可点", () => {
    const onAddToPack = vi.fn();
    const { container } = render(
      <EntityContextMenu
        x={10}
        y={10}
        text="他缓缓抬起手"
        onAddToPack={onAddToPack}
        onMark={() => {}}
        onPolish={() => {}}
        onTransform={() => {}}
        aiVisible={false}
        aiAvailable={false}
        onClose={() => {}}
      />,
    );
    expect(container.textContent).toContain("记入行囊");
    expect(container.textContent).toContain("新建资料卡");
    fireEvent.click(screen.getByRole("menuitem", { name: /记入背包/ }));
    expect(onAddToPack).toHaveBeenCalledTimes(1);
  });

  it("可用时启停跟着 aiAvailable 走（不是恒禁用）", () => {
    render(ctxMenu(true, true));
    const polish = screen.getByRole("menuitem", { name: /润\s*色这段文字/ });
    expect((polish as HTMLButtonElement).disabled).toBe(false);
  });
});

// ── 3. NameGeneratorPanel：AI 收起，本地引擎照常 ───────────────────────
vi.mock("@/shared/ai/ai-client", () => ({
  aiGenerateStructured: vi.fn(() => Promise.reject(new Error("not configured"))),
}));

const buildActions = (): NamingActions => ({
  onInsertToEditor: vi.fn(),
  onInsertMeaning: vi.fn(),
  onCreateCharacter: vi.fn(),
  onAddFavorite: vi.fn(),
  onRemoveFavorite: vi.fn(),
});

describe("NameGeneratorPanel：AI 起名收得起，本地起名不受影响", () => {
  it("开关关掉 → 没有「AI 起名」按钮、也没有描述输入框", () => {
    const { container } = render(
      <NameGeneratorPanel
        exclude={[]}
        favorites={[]}
        actions={buildActions()}
        aiVisible={false}
        aiAvailable={false}
      />,
    );
    expect(container.querySelector(".nv-name__ai-btn")).toBeNull();
    expect(container.querySelector(".nv-name__ai-input")).toBeNull();
    // 但本地引擎还在
    expect(container.querySelector(".nv-name__regen")).not.toBeNull();
  });

  it("开着但没配全 → 「AI 起名」在、禁用、带原因；「换一批（本地）」仍可点", () => {
    const { container } = render(
      <NameGeneratorPanel
        exclude={[]}
        favorites={[]}
        actions={buildActions()}
        aiVisible
        aiAvailable={false}
        aiUnavailableText={REASON}
      />,
    );

    const aiButton = container.querySelector<HTMLButtonElement>(".nv-name__ai-btn");
    expect(aiButton, "开着但没配全时 AI 起名入口必须还在").not.toBeNull();
    expect(aiButton?.disabled).toBe(true);
    expect(aiButton?.getAttribute("title")).toBe(REASON);

    const regen = container.querySelector<HTMLButtonElement>(".nv-name__regen");
    expect(regen, "本地起名按钮不见了").not.toBeNull();
    expect(regen?.disabled, "本地起名不该被 AI 的状态牵连").toBe(false);
  });

  it("两种状态下「换一批（本地）」都能真的换出结果", () => {
    for (const aiVisible of [true, false]) {
      const { container, unmount } = render(
        <NameGeneratorPanel
          exclude={[]}
          favorites={[]}
          actions={buildActions()}
          aiVisible={aiVisible}
          aiAvailable={false}
        />,
      );
      const regen = container.querySelector<HTMLButtonElement>(".nv-name__regen");
      expect(regen, `aiVisible=${aiVisible} 时本地按钮缺席`).not.toBeNull();

      /** 结果卡上的名字文本（`.nv-name__text`，AI 徽标在它内部，故取去掉徽标后的文本） */
      const nameNodes = () => Array.from(container.querySelectorAll(".nv-name__text"));
      const beforeNames = nameNodes().map((node) => node.textContent);

      fireEvent.click(regen as HTMLButtonElement);

      const afterNames = nameNodes().map((node) => node.textContent);
      expect(
        afterNames.length,
        `aiVisible=${aiVisible} 时点「换一批」没产出结果`,
      ).toBeGreaterThan(0);
      // 种子按「换一批」推进 → 结果必须变（不能原地不动）
      expect(afterNames, `aiVisible=${aiVisible} 时「换一批」没换`).not.toEqual(beforeNames);
      unmount();
      document.body.innerHTML = "";
    }
  });
});
