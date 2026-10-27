import { readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateNames } from "../../naming/name-generator";
import { aiGenerateStructured } from "@/shared/ai/ai-client";
import NameGeneratorPanel, { type NamingActions } from "./index";

// 只监视生成器的入参（行为回归：切换选项必须带「新值」调用，不能带旧闭包值）
vi.mock("../../naming/name-generator", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../naming/name-generator")>();
  return { ...actual, generateNames: vi.fn(actual.generateNames) };
});

// AI 调用整块替换：面板只关心「拿回来的条目怎么落地」
vi.mock("@/shared/ai/ai-client", () => ({
  aiGenerateStructured: vi.fn(),
}));

const buildActions = (): NamingActions => ({
  onInsertToEditor: vi.fn(),
  onInsertMeaning: vi.fn(),
  onCreateCharacter: vi.fn(),
  onAddFavorite: vi.fn(),
  onRemoveFavorite: vi.fn(),
});

/** 组件库 Select 的选中动作：mousedown 打开弹层 → 点 portal 里的选项 */
const pickOption = async (root: HTMLElement, label: string): Promise<void> => {
  const trigger = root.querySelector<HTMLElement>("input.ant-select-input");
  expect(trigger).not.toBeNull();
  fireEvent.mouseDown(trigger as HTMLElement);

  const options = await waitFor(() => {
    const nodes = Array.from(
      document.body.querySelectorAll<HTMLElement>(
        ".ant-select-item-option-content",
      ),
    );
    expect(nodes.length).toBeGreaterThan(0);
    return nodes;
  });

  const target = options.find((node) => node.textContent === label);
  expect(target).toBeDefined();
  fireEvent.click(target as HTMLElement);
};

describe("NameGeneratorPanel 组件", () => {
  beforeEach(() => {
    vi.mocked(generateNames).mockClear();
  });

  it("切换名称类型：立刻按新类型重新生成（回归：不能沿用旧闭包的 kind）", async () => {
    const { container } = render(
      <NameGeneratorPanel exclude={[]} favorites={[]} actions={buildActions()} />,
    );

    // 挂载首次生成：默认人名
    await waitFor(() => expect(generateNames).toHaveBeenCalled());
    expect(vi.mocked(generateNames).mock.calls[0][0].kind).toBe("person");

    const kindSelect = container.querySelector<HTMLElement>(".nv-name__select");
    expect(kindSelect).not.toBeNull();
    await pickOption(kindSelect as HTMLElement, "法宝名");

    const calls = vi.mocked(generateNames).mock.calls;
    expect(calls[calls.length - 1][0].kind).toBe("artifact");
  });

  it("切换风格：新风格不支持当前类型时回退到该风格首个支持的类型", async () => {
    const { container } = render(
      <NameGeneratorPanel exclude={[]} favorites={[]} actions={buildActions()} />,
    );
    await waitFor(() => expect(generateNames).toHaveBeenCalled());

    const selects = container.querySelectorAll<HTMLElement>(".nv-name__select");
    // 0 类型 / 1 风格 / 2 性别 / 3 数量
    const styleSelect = selects[1];
    expect(styleSelect).toBeDefined();
    await pickOption(styleSelect as HTMLElement, "西式现代（西方）");

    const calls = vi.mocked(generateNames).mock.calls;
    const last = calls[calls.length - 1][0];
    expect(last.style).toBe("westernModern");
  });

  /**
   * 真实事故（2026-10-27）：模型把 `}` 写成 `]`，旧解析退回行切，面板第一张卡就是
   * `[{"name"`。解析层已修（output-spec 逐条抢救）；这里钉的是**面板这一侧**的底线：
   * 无论 AI 回来什么，作者看到的只能是名字，不能是 JSON 残片。
   */
  it("AI 返回不可用数据：面板只留本地结果，不显示任何 JSON 残片", async () => {
    vi.mocked(aiGenerateStructured).mockResolvedValue({
      ok: true,
      data: {
        text: '[{"name":"江长青","meaning":"寓意寿命长青，直接呼应书名',
        entries: [],
        usedFallback: true,
      },
    });

    const { container, queryByText } = render(
      <NameGeneratorPanel exclude={[]} favorites={[]} actions={buildActions()} />,
    );
    await waitFor(() => expect(generateNames).toHaveBeenCalled());

    const aiButton = container.querySelector<HTMLElement>(".nv-name__ai-btn");
    expect(aiButton).not.toBeNull();
    fireEvent.click(aiButton as HTMLElement);
    await waitFor(() => expect(queryByText(/已切回本地起名/)).not.toBeNull());

    const grid = container.querySelector(".nv-name__grid");
    expect(grid).not.toBeNull();
    // 结果卡里不许出现任何 JSON 标点（`[{"name"` 这类残片）
    expect(grid?.textContent ?? "").not.toMatch(/[[\]{}"]/);
    expect(grid?.querySelectorAll(".nv-name__card").length).toBeGreaterThan(0);
  });
});

/**
 * 窄面板布局守卫。
 *
 * 真缺陷：侧栏最窄 280px（内容区约 255px）时，结果栅格死写两列 → 每列约 124px，
 * 卡内 5 颗 24px 图标按钮恰好需要 124px，再加内边距必然溢出，被 `__scroll` 的
 * `overflow-x: hidden` 直接裁掉（名字与按钮都被切一半）。这类问题 jsdom 量不出来
 * （没有真实排版），只能在源码上钉住「不许写死列数」。
 */
describe("起名面板：窄面板不得截断结果卡（布局守卫）", () => {
  const scss = readFileSync(path.resolve(__dirname, "index.scss"), "utf8").replace(
    /\r\n/g,
    "\n",
  );

  /** 取某个 `&__x {` 规则的声明体（到缩进两格的 `}` 为止） */
  const blockOf = (selector: string): string => {
    const start = scss.indexOf(selector);
    expect(start).toBeGreaterThan(-1);
    const open = scss.indexOf("{", start);
    const end = scss.indexOf("\n  }", open);
    return scss.slice(open, end);
  };

  it("结果栅格按可用宽度自适应，不写死两列", () => {
    const grid = blockOf("&__grid {");
    expect(grid).toMatch(/repeat\(auto-fill, minmax\(\d+px, 1fr\)\)/);
    expect(grid).not.toContain("repeat(2, 1fr)");
    expect(grid).not.toContain("1fr 1fr");
  });

  it("操作行允许折行兜底，按钮不被压缩", () => {
    const acts = blockOf("&__acts {");
    expect(acts).toContain("flex-wrap: wrap");
    expect(acts).toContain("flex: none");
  });
});
