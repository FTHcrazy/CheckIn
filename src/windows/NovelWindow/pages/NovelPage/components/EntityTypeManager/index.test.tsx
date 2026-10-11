import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import EntityTypeManager from ".";
import { CUSTOM_TYPE_PALETTE } from "../../novel-config";
import type { CustomEntityTypeDef } from "../../types";

// 整个文件放宽超时：Modal + ColorPicker 的挂载在并行跑时会超过默认 5s。
// 放在模块顶层（而非逐条 it）——本文件每条用例都要渲染同一棵重组件树。
vi.setConfig({ testTimeout: 20000 });

/**
 * 自定义要素类型管理弹框（R23）。
 *
 * 本轮改动的契约：
 *   ① 取色改用组件库 ColorPicker —— 不再是固定色板的一排色块，
 *      所以「颜色个数」不再由代码写死；预设只作为快捷起点。
 *   ② 已建类型也能改色（原先只能改名），否则想换色只能删了重建，
 *      而删类型会把该类型下的要素卡全部迁回「自定义」兜底 —— 代价太大。
 *
 * ⚠️ 必须手动 cleanup：antd Modal 与 ColorPicker 面板都挂在 `document.body`
 * 的 portal 上，RTL 的自动清理只卸载 render 的那个容器，portal 会活到下一个
 * 用例 —— 于是同一段 aria-label 在页面里出现两份，`getByLabelText` 报
 * 「found multiple elements」。单跑一条用例永远看不到这个假阳性。
 *
 * ⚠️ 本文件整体放宽超时（见文件末尾 `vi.setConfig`）：ColorPicker 取色面板是
 * 重组件，连 Modal 一起挂载一次在并行跑时要好几秒；默认 5s 会假红。
 * 注意这不只是「开面板」的用例慢 —— 哪怕是同步断言，`render()` 本身就要渲染
 * 整棵 Modal + ColorPicker 树。隔离运行本文件从不超过 5s，放宽只是为全量稳定。
 */
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const makeDef = (over: Partial<CustomEntityTypeDef>): CustomEntityTypeDef => ({
  id: "ct-1",
  name: "功法",
  color: "#e0559a",
  ...over,
});

function setup(customTypes: CustomEntityTypeDef[] = []) {
  const onAdd = vi.fn(() => makeDef({ id: "ct-new", name: "新类型" }));
  const onRename = vi.fn(() => true);
  const onRecolor = vi.fn();
  const onRemove = vi.fn();
  render(
    <EntityTypeManager
      open
      customTypes={customTypes}
      usageCountOf={() => 0}
      onClose={vi.fn()}
      onAdd={onAdd}
      onRename={onRename}
      onRecolor={onRecolor}
      onRemove={onRemove}
    />,
  );
  return { onAdd, onRename, onRecolor, onRemove };
}

/**
 * 在取色面板里输入一个 hex 并提交。
 *
 * 输入框是受控的：`change` 之后 value 会被 antd 回写，别去断言输入框的值 ——
 * 提交路径是 `onChangeComplete`。回车提交最稳（jsdom 里 blur 不会关面板，
 * 只等面板消失会永远等不到）。
 */
async function pickHex(hex: string): Promise<void> {
  const input = await waitFor(() => {
    const node = document.querySelector<HTMLInputElement>(
      ".ant-color-picker-hex-input input",
    );
    expect(node).not.toBeNull();
    return node!;
  });
  fireEvent.change(input, { target: { value: hex } });
  fireEvent.keyDown(input, { key: "Enter", keyCode: 13, which: 13 });
  await new Promise((resolve) => setTimeout(resolve, 80));
}

describe("EntityTypeManager：取色走组件库 ColorPicker", () => {
  it("新建区不再有一排写死的色块，取而代之是一个取色器", () => {
    setup();
    const create = document.querySelector(".nv-etm__create") as HTMLElement;
    expect(create).not.toBeNull();
    // 旧的固定色板整块已删除
    expect(document.querySelector(".nv-etm__palette")).toBeNull();
    expect(document.querySelectorAll(".nv-etm__swatch").length).toBe(0);
    // 换成一个 ColorPicker 触发器
    expect(within(create).getByLabelText("新类型颜色")).toBeTruthy();
  });

  it("预设仍保留原配色作为快捷起点（但可自选任意色）", async () => {
    setup();
    const trigger = screen.getByLabelText("新类型颜色");
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(
        document.querySelectorAll(".ant-color-picker-presets-color").length,
      ).toBe(CUSTOM_TYPE_PALETTE.length);
    });
  });

  it(
    "新建时用所选颜色调用 onAdd，且颜色不受固定色板限制",
    async () => {
      const { onAdd } = setup();
      fireEvent.change(screen.getByLabelText("新类型名称"), {
        target: { value: "灵根" },
      });
      // 打开取色器改成一个色板里没有的颜色
      fireEvent.click(screen.getByLabelText("新类型颜色"));
      await pickHex("123456");
      fireEvent.click(screen.getByRole("button", { name: /添\s*加\s*类\s*型/ }));

      expect(onAdd).toHaveBeenCalledTimes(1);
      const [name, color] = onAdd.mock.calls[0] as unknown as [string, string];
      expect(name).toBe("灵根");
      expect(color.toLowerCase()).toBe("#123456");
      // 这个色确实不在预设里 —— 证明「可自选任意色」不是靠预设凑出来的
      expect(CUSTOM_TYPE_PALETTE as readonly string[]).not.toContain("#123456");
    },
  );
});

describe("EntityTypeManager：已建类型可改色", () => {
  it("每个已建类型的圆点就是取色入口（不再只是展示）", () => {
    setup([makeDef({ id: "ct-1", name: "功法", color: "#e0559a" })]);
    const dot = screen.getByLabelText("修改 功法 的颜色");
    expect(dot).toBeTruthy();
    // 圆点用当前颜色上色
    expect((dot as HTMLElement).style.background).toBe("rgb(224, 85, 154)");
  });

  it("改色后回调 onRecolor 带类型 id 与新的 hex", async () => {
    const { onRecolor } = setup([
      makeDef({ id: "ct-1", name: "功法", color: "#e0559a" }),
    ]);
    fireEvent.click(screen.getByLabelText("修改 功法 的颜色"));
    await pickHex("8b5cf6");

    expect(onRecolor).toHaveBeenCalledTimes(1);
    expect(onRecolor).toHaveBeenCalledWith("ct-1", "#8b5cf6");
  });

  it("改色与重命名是两个独立入口，互不串台", () => {
    setup([makeDef({ id: "ct-1", name: "功法" })]);
    expect(screen.getByLabelText("修改 功法 的颜色")).toBeTruthy();
    expect(screen.getByLabelText("重命名 功法")).toBeTruthy();
    expect(screen.getByLabelText("删除 功法")).toBeTruthy();
  });

  it("多个类型各自独立取色（不会串到别的类型上）", async () => {
    const { onRecolor } = setup([
      makeDef({ id: "ct-1", name: "功法", color: "#e0559a" }),
      makeDef({ id: "ct-2", name: "灵根", color: "#14b8a6" }),
    ]);
    fireEvent.click(screen.getByLabelText("修改 灵根 的颜色"));
    await pickHex("0ea5e9");

    expect(onRecolor).toHaveBeenCalledTimes(1);
    expect(onRecolor).toHaveBeenCalledWith("ct-2", "#0ea5e9");
  });
});
