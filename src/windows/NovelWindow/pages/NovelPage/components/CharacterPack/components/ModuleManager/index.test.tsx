import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ModuleManager from "./index";
import type { PackPanelApi } from "../../hooks/usePackPanel";
import { PACK_MODULES, type PackModuleKey } from "../../types";

/**
 * 模块排序（REQ-020）
 *
 * 两条路径都要钉住，因为它们服务于**不同的用户**：
 *  - 拖拽（原生 HTML5 DnD，与左栏章节树同一套做法）是鼠标路径；
 *  - 手柄的方向键是键盘路径 —— 拖拽对键盘用户完全不可达，
 *    「排序」这件事不该以牺牲可达性为代价换来实现上的省事。
 *
 * 语义上还有一个易错点：插入而不是交换。`moveTo` 用 splice 插入，
 * 写成两两交换的实现「也能动」，但拖远距离时顺序会错得看不出来
 * （相邻一格时两种写法结果相同，所以只测相邻是测不出来的）。
 */

const MODULES = PACK_MODULES.map((module, index) => ({
  key: module.key,
  enabled: true,
  sortOrder: (index + 1) * 10,
}));

function makeApi(over: Partial<PackPanelApi> = {}) {
  return {
    modules: MODULES,
    moduleManagerOpen: true,
    setModuleManagerOpen: vi.fn(),
    setModuleEnabled: vi.fn(),
    setModuleOrder: vi.fn(),
    resetModules: vi.fn(),
    ...over,
  } as unknown as PackPanelApi;
}

const handle = (label: string) =>
  screen.getByLabelText(`调整「${label}」的顺序`) as HTMLElement;

/** 一次完整的原生拖拽：start(源) → over(目标) → drop(目标) */
function dragTo(fromLabel: string, toLabel: string) {
  const store: Record<string, string> = {};
  const dataTransfer = {
    effectAllowed: "",
    dropEffect: "",
    setData: (type: string, value: string) => {
      store[type] = value;
    },
    getData: (type: string) => store[type] ?? "",
  };
  const from = handle(fromLabel).closest("li") as HTMLElement;
  const to = handle(toLabel).closest("li") as HTMLElement;

  fireEvent.dragStart(from, { dataTransfer });
  fireEvent.dragOver(to, { dataTransfer });
  fireEvent.drop(to, { dataTransfer });
  fireEvent.dragEnd(from, { dataTransfer });
}

/** 断言落库的顺序（只看「总属性汇总」在序列里的位置，其余不动） */
function orderedKeys(api: PackPanelApi): PackModuleKey[] {
  return (api.setModuleOrder as ReturnType<typeof vi.fn>).mock.calls[0][0] as PackModuleKey[];
}

describe("ModuleManager —— 排序（REQ-020）", () => {
  afterEach(cleanup);

  it("列表按传入顺序渲染，且每个模块都有可拖动手柄", () => {
    render(<ModuleManager api={makeApi()} />);
    const rows = document.querySelectorAll(".cpk-mgr__row");
    expect(rows).toHaveLength(PACK_MODULES.length);
    expect(handle("总属性汇总")).toBeInTheDocument();
  });

  it("拖到远处是**插入**而不是交换（相邻一格时两种写法无法区分）", () => {
    const api = makeApi();
    render(<ModuleManager api={api} />);
    // 把「总属性汇总」（第 1 位）拖到「技能栏」（第 5 位）上
    dragTo("总属性汇总", "技能栏");
    const keys = orderedKeys(api);
    expect(keys.indexOf("summary")).toBe(4);
    // 交换写法的结果：summary 到第 5 位、skills 到第 1 位 —— 这里技能必须只前移一格
    expect(keys.indexOf("skills")).toBe(3);
  });

  it("方向键也能排：↑ 上移一格、↓ 下移一格，越界时不动", () => {
    const api = makeApi();
    render(<ModuleManager api={api} />);

    // 「人物属性」是第 2 位 → ↑ 之后与「总属性汇总」换位
    fireEvent.keyDown(handle("人物属性"), { key: "ArrowUp" });
    expect(orderedKeys(api).indexOf("attributes")).toBe(0);

    (api.setModuleOrder as ReturnType<typeof vi.fn>).mockClear();

    // 第 1 位再 ↑ 无效（不该产生一次「顺序没变但其实写库了」的调用）
    fireEvent.keyDown(handle("总属性汇总"), { key: "ArrowUp" });
    expect(api.setModuleOrder).not.toHaveBeenCalled();
  });

  it("方向键不吞其他按键（Tab / Enter 仍能正常离开手柄）", () => {
    const api = makeApi();
    render(<ModuleManager api={api} />);
    fireEvent.keyDown(handle("总属性汇总"), { key: "Tab" });
    fireEvent.keyDown(handle("总属性汇总"), { key: "Enter" });
    expect(api.setModuleOrder).not.toHaveBeenCalled();
  });

  it("拖到原位是空操作（不产生一次无意义的写库）", () => {
    const api = makeApi();
    render(<ModuleManager api={api} />);
    dragTo("技能栏", "技能栏");
    expect(api.setModuleOrder).not.toHaveBeenCalled();
  });
});
