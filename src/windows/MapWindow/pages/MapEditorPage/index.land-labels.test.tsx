import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MapEditorPage 页面级回归（拆分之二）：陆地与海岸 + 文字标注 + 风格预设。
 *
 * 这三组覆盖的是**状态链路**（按钮 → useMapEditor → doc 字段 → 页面显示）而非
 * 几何/渲染细节（几何在 land.test.ts / coastBake.test.ts，渲染在 MapCanvas 各
 * test）。拆分原因与探针注入方式见 `index.generate.test.tsx` 头部。
 */
import {
  chooseOption,
  clickCanvas,
  countLabel,
  draftInput,
  installPointerShims,
  labelCount,
  landLabel,
  localOf,
  openMore,
  pickSprite,
  rect,
  regionLabel,
  selectValue,
  setup,
} from "./__test-utils";
import { resetMapStores } from "./store/reset";
import { useMapDocStore } from "./store/useMapDocStore";
import type { MapRegion, Point } from "./regions";

const { spritePositions, labelNodes } = vi.hoisted(() => ({
  spritePositions: [] as { x: number; y: number }[],
  labelNodes: [] as {
    text: string;
    destroyed: boolean;
    style: { fontSize?: number } | null;
  }[],
}));

vi.mock("pixi.js", async () => {
  const { createPixiMock } = await import("./__pixi-mock");
  return createPixiMock({ spritePositions, labelNodes });
});

vi.mock("./hooks/useTextureCache", () => ({
  useTextureCache: () => ({ textures: {}, ready: true }),
}));

installPointerShims();

let rectSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  spritePositions.length = 0;
  labelNodes.length = 0;
  // 三个 store 是模块级单例，必须显式复位（对齐 useNovelEditorStore.test 范式）
  resetMapStores();
  rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
});

afterEach(() => {
  // 未开启 vitest globals 时 RTL 不会自动清理，DOM 会跨用例累积
  cleanup();
  rectSpy.mockRestore();
});

vi.setConfig({ testTimeout: 120000 });

/**
 * 陆地与海岸 —— 本次改造唯一"从无到有"的图层。
 *
 * 这里覆盖的是**状态链路**而不是几何（几何在 `land.test.ts`）：
 * 按钮 → useMapEditor.generateLand → doc.land → 页面显示 seed，
 * 以及最要紧的一条：**撤销要把陆地一起退掉**。
 *
 * 后者是 `DocSnapshot` 扩容的全部理由：快照若仍只有 `{elements, regions}`，
 * 撤销「生成陆地」后海岸四层会留在画面上 —— 用户会以为"撤销坏了"。
 * 几何层面的"海岸消失"由 `MapCanvas/bake.test.tsx` 断言（`land` 变 null → 清空 RT）。
 */
describe("MapEditorPage 陆地与海岸", () => {
  it("生成陆地：默认不分区（只有 seed、没有区块）；撤销后一起回退", async () => {
    await setup();
    expect(landLabel()).toBe("");

    fireEvent.click(screen.getByRole("button", { name: /生成陆地/ }));
    await waitFor(() => expect(landLabel()).toMatch(/^seed \d+$/), { timeout: 20000 });
    // 默认不勾「同时划出区块」⇒ 地图上不出现任何区块（"默认不划分"落地）
    expect(regionLabel()).toBe("");

    // ── 撤销：陆地一起回退（快照含 land）──
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(landLabel()).toBe(""), { timeout: 20000 });
    expect(regionLabel()).toBe("");

    // ── 重做：陆地恢复，区块仍为空 ──
    fireEvent.click(screen.getByRole("button", { name: "redo" }));
    await waitFor(() => expect(landLabel()).toMatch(/^seed \d+$/), { timeout: 20000 });
    expect(regionLabel()).toBe("");
  });

  it("生成陆地：勾选「同时划出区块」后才在陆地内切分（回归等价）", async () => {
    await setup();

    // 打开「生成陆地」的配套下拉，勾上「同时划出区块」
    fireEvent.click(screen.getByRole("button", { name: "陆地选项" }));
    const sw = await screen.findByRole("switch", { name: "同时划出区块" });
    expect(sw).toHaveAttribute("aria-checked", "false"); // 默认关
    fireEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));

    fireEvent.click(screen.getByRole("button", { name: /生成陆地/ }));
    await waitFor(() => expect(landLabel()).toMatch(/^seed \d+$/), { timeout: 20000 });
    await waitFor(() => expect(regionLabel()).toMatch(/已生成 \d+ 块/), { timeout: 20000 });
  });

  it("已有区块时点「生成陆地」会先确认，且文案按勾选态二分", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("223"));

    // ── ① 默认（不勾）：文案说"清除自动块"，且不点确认就不动手 ──
    fireEvent.click(screen.getByRole("button", { name: /生成陆地/ }));
    await waitFor(() =>
      expect(document.body.textContent).toContain("将清除 223 个自动生成的区块"),
    );
    expect(landLabel()).toBe("");

    // 取消掉，回到干净状态
    fireEvent.click(screen.getByRole("button", { name: /取\s*消/ }));
    await waitFor(() => expect(regionLabel()).toContain("223"));

    // ── ② 勾上：保留旧文案（重新划分区块）──
    fireEvent.click(screen.getByRole("button", { name: "陆地选项" }));
    const sw = await screen.findByRole("switch", { name: "同时划出区块" });
    fireEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));

    fireEvent.click(screen.getByRole("button", { name: /生成陆地/ }));
    await waitFor(() =>
      expect(document.body.textContent).toContain(
        "将重新划分区块（现有 223 个自动生成的区块会被替换）",
      ),
    );
    expect(landLabel()).toBe("");
  });

  it("已有手画块时生成陆地：文案含「保留 M 个手动区块」与坐标系提醒", async () => {
    await setup();

    const tri = (dx: number): Point[] => [
      { x: dx, y: 0 },
      { x: dx + 120, y: 0 },
      { x: dx + 60, y: 120 },
    ];
    const auto: MapRegion = {
      id: "auto-1",
      parentId: null,
      level: 0,
      name: "大陆 1",
      seed: { x: 0, y: 0 },
      polygon: tri(-400),
      color: 0x334455,
    };
    const manual: MapRegion = {
      id: "manual-1",
      parentId: null,
      level: 0,
      name: "大陆 2",
      seed: { x: 300, y: 0 },
      polygon: tri(300),
      color: 0x334455,
      origin: "manual",
    };
    await act(async () => {
      useMapDocStore.setState((s) => ({ doc: { ...s.doc, regions: [auto, manual] } }));
    });

    fireEvent.click(screen.getByRole("button", { name: /生成陆地/ }));

    // 不勾「同时划出区块」（默认）：清 1 个自动块、保留 1 个手画块
    await waitFor(() =>
      expect(document.body.textContent ?? "").toContain("将清除 1 个自动生成的区块"),
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("保留 1 个手动区块");
    // 只要 manualCount > 0，必须提示手画块与旧陆地的坐标系失配
    expect(text).toContain("手动区块是基于当前陆地绘制的");
  });
});

/**
 * 文字标注 —— 古地图的信息密度主要来自这里（PRD §6.3）。
 *
 * 本组覆盖**状态链路**（按钮 → useMapEditor → doc.labels → 画布建 Text），
 * 渲染侧的增量/字号/权重在 `MapCanvas/label.test.tsx`。
 */
describe("MapEditorPage 文字标注", () => {
  it("「加标注」：画布落位 → 输入 → 回车落库；空文本不创建", async () => {
    await setup();
    expect(labelCount()).toContain("0");

    // ── 先试一次空提交：Esc 退出，文档里不留任何东西 ──
    fireEvent.click(screen.getByRole("button", { name: /加标注/ }));
    clickCanvas(localOf({ x: 20, y: 10 }));
    await waitFor(() => expect(draftInput()).not.toBeNull());
    fireEvent.keyDown(draftInput() as HTMLElement, { key: "Escape" });
    await waitFor(() => expect(draftInput()).toBeNull());
    expect(labelCount()).toContain("0");
    // 空文本连 Text 节点都不该建（新建是"拿到文字才落库"的两段式）
    expect(labelNodes).toHaveLength(0);

    // ── 再来一次，这回真的输入 ──
    fireEvent.click(screen.getByRole("button", { name: /加标注/ }));
    clickCanvas(localOf({ x: 20, y: 10 }));
    await waitFor(() => expect(draftInput()).not.toBeNull());
    fireEvent.change(draftInput() as HTMLElement, { target: { value: "落霞岛" } });
    fireEvent.keyDown(draftInput() as HTMLElement, { key: "Enter" });

    await waitFor(() => expect(labelCount()).toContain("1"));
    expect(labelNodes).toHaveLength(1);
    expect(labelNodes[0].text).toBe("落霞岛");
    // 提交后覆盖层收起
    expect(draftInput()).toBeNull();
  });

  it("素材地名：填字出现联动标注；删素材一起删，撤销一次一起回", async () => {
    await setup();

    // 放一座山（落位即选中）
    pickSprite("山（中）");
    clickCanvas(localOf({ x: 30, y: 20 }));
    await waitFor(() => expect(countLabel()).toContain("1"));

    // 选中素材 → 属性区出现「地名」输入框
    const nameBox = screen.getByPlaceholderText("地名");
    fireEvent.change(nameBox, { target: { value: "青云岭" } });
    fireEvent.keyDown(nameBox, { key: "Enter" });

    await waitFor(() => expect(labelCount()).toContain("1"));
    expect(labelNodes).toHaveLength(1);
    expect(labelNodes[0].text).toBe("青云岭");

    // ── 删除素材：地名必须在同一步里一起消失（不进渲染层的"孤儿"状态）──
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    await waitFor(() => expect(countLabel()).toContain("0"));
    await waitFor(() => expect(labelCount()).toContain("0"));
    expect(labelNodes[0].destroyed).toBe(true);

    // ── 撤销一次：素材与地名一起回来（证明是同一个撤销步）──
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(countLabel()).toContain("1"));
    await waitFor(() => expect(labelCount()).toContain("1"));
  });

  it("「显示分区」开关：关掉只影响显示，撤销一步即恢复", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("223"));

    // 显示分区 Switch 收在「更多」面板里，先展开再查
    openMore();
    const sw = screen.getByRole("switch");
    expect(sw).toHaveAttribute("aria-checked", "true");

    fireEvent.click(sw);
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "false"));
    expect(regionLabel()).toContain("223");

    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(sw).toHaveAttribute("aria-checked", "true"));
    expect(regionLabel()).toContain("223");
  });

  it("加标注：撤销一步回到 0 条（地名进撤销栈）", async () => {
    await setup();
    expect(labelCount()).toContain("0");

    fireEvent.click(screen.getByRole("button", { name: /加标注/ }));
    clickCanvas(localOf({ x: 20, y: 10 }));
    await waitFor(() => expect(draftInput()).not.toBeNull());
    fireEvent.change(draftInput() as HTMLElement, { target: { value: "落霞岛" } });
    fireEvent.keyDown(draftInput() as HTMLElement, { key: "Enter" });
    await waitFor(() => expect(labelCount()).toContain("1"));

    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(labelCount()).toContain("0"));

    // 重做再回来（快照含 labels，两个方向都要成立）
    fireEvent.click(screen.getByRole("button", { name: "redo" }));
    await waitFor(() => expect(labelCount()).toContain("1"));
  });

  it("字号档：下拉选 16 号后新建的地名按 16 号渲染", async () => {
    await setup();
    // 字号档下拉收在「更多」面板里，先展开再断言
    openMore();
    expect(selectValue("label-size")).toBe("12 号");

    chooseOption("label-size", "16 号");
    await waitFor(() => expect(selectValue("label-size")).toBe("16 号"));

    fireEvent.click(screen.getByRole("button", { name: /加标注/ }));
    clickCanvas(localOf({ x: 20, y: 10 }));
    await waitFor(() => expect(draftInput()).not.toBeNull());
    fireEvent.change(draftInput() as HTMLElement, { target: { value: "落霞岛" } });
    fireEvent.keyDown(draftInput() as HTMLElement, { key: "Enter" });

    await waitFor(() => expect(labelNodes).toHaveLength(1));
    // 一路传到渲染层：doc.labels[0].size → labelSync 的 TextStyle.fontSize
    expect(labelNodes[0].style?.fontSize).toBe(16);
  });

  it("改字号档更新已存在的联动地名：12 → 16 → 撤销回 12", async () => {
    await setup();

    // 放一座山（落位即选中），填一个地名 —— 不带 size 时默认 12 号
    pickSprite("山（中）");
    clickCanvas(localOf({ x: 30, y: 20 }));
    await waitFor(() => expect(countLabel()).toContain("1"));
    const nameBox = screen.getByPlaceholderText("地名");
    fireEvent.change(nameBox, { target: { value: "青云岭" } });
    fireEvent.keyDown(nameBox, { key: "Enter" });

    await waitFor(() => expect(labelNodes).toHaveLength(1));
    expect(labelNodes[0].text).toBe("青云岭");
    expect(labelNodes[0].style?.fontSize).toBe(12);

    // 素材此刻仍是选中态 → 改字号档应当落到这条联动地名上
    // 字号档下拉收在「更多」面板里，先展开
    openMore();
    chooseOption("label-size", "16 号");
    await waitFor(() => expect(selectValue("label-size")).toBe("16 号"));
    // 原地改样式（`labelSync` 替换 `node.style` 后仍是同一个 Text 节点）
    await waitFor(() => expect(labelNodes[0].style?.fontSize).toBe(16));

    // 字号是成品的一部分：撤销一步回到 12
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(labelNodes[0].style?.fontSize).toBe(12));
    // 撤销只退字号，不许把地名一起退掉
    expect(labelNodes[0].text).toBe("青云岭");
    expect(labelCount()).toContain("1");
  });
});

/**
 * 风格预设（B4）与它和撤销栈的关系。
 *
 * 风格是**成品的一部分**（"给读者看的配色"），不是视图偏好：选错了要能撤销回去。
 * 这一条与上面「显示分区」那条是同一类 —— 都是"文档字段 + 一个 UI 控件"，
 * 而漏掉 commit 的表现都是"控件变了、按撤销没反应"。
 */
describe("MapEditorPage 风格预设", () => {
  it("切风格：下拉变更进撤销栈，撤销回到「原色」、重做再回去", async () => {
    await setup();
    // 风格下拉收在「更多」面板里，先展开再断言
    openMore();
    expect(selectValue("style")).toBe("原色");

    chooseOption("style", "羊皮纸");
    await waitFor(() => expect(selectValue("style")).toBe("羊皮纸"));

    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(selectValue("style")).toBe("原色"));

    fireEvent.click(screen.getByRole("button", { name: "redo" }));
    await waitFor(() => expect(selectValue("style")).toBe("羊皮纸"));
  });

  it("重选同一档不多压撤销步：切羊皮纸 → 再点羊皮纸 → 一次撤销回原色", async () => {
    await setup();
    const undo = screen.getByRole("button", { name: "undo" });

    // 风格下拉收在「更多」面板里，先展开
    openMore();
    chooseOption("style", "羊皮纸");
    await waitFor(() => expect(selectValue("style")).toBe("羊皮纸"));
    // 此刻位置：撤销栈里有且只有 1 步
    expect(undo).toBeEnabled();

    // 同一个选项再点一次 —— 不许再压一步
    chooseOption("style", "羊皮纸");
    await waitFor(() => expect(selectValue("style")).toBe("羊皮纸"));

    // 一次撤销就必须回到原色（若多压了一步，这里会仍停在羊皮纸）
    fireEvent.click(undo);
    await waitFor(() => expect(selectValue("style")).toBe("原色"));
    // 栈真的空了：否则说明"羊皮纸"被压了两步，第一次撤销只是退到"羊皮纸→羊皮纸"
    expect(undo).toBeDisabled();
  });
});
