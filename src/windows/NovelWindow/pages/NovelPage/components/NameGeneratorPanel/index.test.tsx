import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateNames } from "../../naming/name-generator";
import NameGeneratorPanel, { type NamingActions } from "./index";

// 只监视生成器的入参（行为回归：切换选项必须带「新值」调用，不能带旧闭包值）
vi.mock("../../naming/name-generator", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../naming/name-generator")>();
  return { ...actual, generateNames: vi.fn(actual.generateNames) };
});

const buildActions = (): NamingActions => ({
  onInsertToEditor: vi.fn(),
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
});
