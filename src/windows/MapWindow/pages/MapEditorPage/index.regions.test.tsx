import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MapEditorPage 页面级回归（拆分之三）：层级配置与合并子区域 + 画区模式（R-REG-03）。
 *
 * 这两组必须走页面，因为它们是"文档 ←→ UI"的双向链路：单测能钉住每一段，但
 * "按钮文案读的是组件状态还是文档"、"画区态拖画布会不会误撒顶点"这类只有页面
 * 能证伪。拆分原因与探针注入方式见 `index.generate.test.tsx` 头部。
 */
import {
  clickCanvas,
  countLabel,
  host,
  installPointerShims,
  localOf,
  pickSprite,
  rect,
  regionLabel,
  setup,
} from "./__test-utils";
import { resetMapStores } from "./store/reset";
import { useMapDocStore } from "./store/useMapDocStore";
import { useMapSelectionStore } from "./store/useMapSelectionStore";

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
 * 【2.42.0】层级配置浮层（R-REG-01）已随「关闭层级」下线，对应 5 条页面用例删除；
 * schema 回落 / 多级老数据语义由 `regions.test.ts` 与 `types.test.ts` 钉住。
 *
 * 「合并子区域」（R-REG-04）是数据层能力、按钮仍在：单级生成图里所有区块都是
 * 叶子 ⇒ 按钮灰化。留一条页面级用例钉住这个口径。
 */
describe("MapEditorPage 合并子区域（层级关闭后的口径）", () => {
  it("单级生成图里所有区块都是叶子：合并按钮灰化，点击无弹层", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("12"));

    const root = useMapDocStore.getState().doc.regions.find((r) => r.level === 0);
    expect(root).toBeTruthy();
    await act(async () => {
      useMapSelectionStore.getState().setSelectedRegionId(root!.id);
    });

    const mergeBtn = screen.getByRole("button", { name: /合并子区域/ });
    expect(mergeBtn).toBeDisabled();
    fireEvent.click(mergeBtn);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    // 没有确认弹层（叶子直接被 disabled 拦住，而不是点了才报"没有子区域"）
    expect(document.querySelectorAll(".ant-modal-confirm")).toHaveLength(0);
  });
});

/**
 * 画区模式（R-REG-03）—— 页面级只验**入口、动作区与模式隔离**。
 *
 * 判定（自交 / 越界 / 封顶 / 重叠）全在 `regionEdit.test.ts`（纯函数）与
 * `useMapEditor.test.tsx`（编排）里；这里再测一遍只会把最贵的用例变成
 * 三层重复的慢测试（架构 §4.6「测试策略矩阵」）。
 */
describe("MapEditorPage 画区模式（R-REG-03）", () => {
  /** 画区动作区（不在画区模式时为 null） */
  function drawActions(): HTMLElement | null {
    return document.querySelector(".map-editor__draw-actions");
  }
  /** 「已画 N 点 · 已用 M/600」 */
  function drawCount(): string {
    return document.querySelector(".map-editor__draw-count")?.textContent ?? "";
  }
  /** 「层级 L1 国家」；越界时是「已达最深层级（共 N 级）」 */
  function drawLevel(): string {
    return document.querySelector(".map-editor__draw-level")?.textContent ?? "";
  }
  /** 已画点数（从文案里抠数字 —— 断言文案本身也顺带钉住格式） */
  function drawnPoints(): number {
    return Number((drawCount().match(/已画\s*(\d+)\s*点/) ?? [])[1] ?? -1);
  }

  // ⚠️ 一律用**正则**取按钮，两个坑都要躲：
  //   ① antd 的图标会把自己的名字（`highlight` / `undo` …）拼进可访问名；
  //   ② antd v6 会在**两个汉字**且无图标的按钮里自动插一个空格（「完成」→「完 成」）。
  const drawTool = () => screen.getByRole("button", { name: /画区/ });
  const selectTool = () => screen.getByRole("button", { name: /选择/ });
  const finishButton = () => screen.getByRole("button", { name: /完\s*成/ });
  const undoPointButton = () => screen.getByRole("button", { name: /撤销上一点/ });

  /** 在世界坐标处单击画布 */
  function clickWorld(world: { x: number; y: number }) {
    clickCanvas(localOf(world));
  }

  it("「画区」进入模式：动作区出现、层级取自 schema、完成与撤销在点数不足时 disabled", async () => {
    await setup();

    // 选择模式下没有动作区
    expect(drawActions()).toBeNull();

    fireEvent.click(drawTool());
    expect(drawActions()).not.toBeNull();
    // 未选中任何区块 ⇒ 画在顶层：L1 国家（默认 schema 第一级）
    expect(drawLevel()).toBe("层级 L1 国家");
    expect(drawCount()).toContain("已画 0 点");
    expect(drawCount()).toContain("已用 0/600");
    // 点数不足：两个按钮都必须 disabled（点了没反应比不给更糟）
    expect(finishButton()).toBeDisabled();
    expect(undoPointButton()).toBeDisabled();

    // 落 3 点
    clickWorld({ x: -300, y: -300 });
    clickWorld({ x: -150, y: -300 });
    clickWorld({ x: -150, y: -150 });
    await waitFor(() => expect(drawnPoints()).toBe(3));
    expect(finishButton()).not.toBeDisabled();
    expect(undoPointButton()).not.toBeDisabled();

    // 「撤销上一点」退一格，退到 0 仍留在画区模式
    fireEvent.click(undoPointButton());
    await waitFor(() => expect(drawnPoints()).toBe(2));
    fireEvent.click(undoPointButton());
    fireEvent.click(undoPointButton());
    await waitFor(() => expect(drawnPoints()).toBe(0));
    expect(drawActions()).not.toBeNull(); // 还在模式里

    // Esc 第一下：没草稿、在画区 ⇒ 回选择模式
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(drawActions()).toBeNull());

    // 再进一次，改用顶部「选择」退出 —— 两条退路都必须真的退得出来
    // （只留 Esc 的话，一个"按钮 handler 写错"的缺陷永远不会被这条用例发现）
    fireEvent.click(drawTool());
    expect(drawActions()).not.toBeNull();
    fireEvent.click(selectTool());
    await waitFor(() => expect(drawActions()).toBeNull());

    // 全程没有产生任何文档变更，也就没有快照
    expect(useMapDocStore.getState().doc.regions).toHaveLength(0);
    expect(useMapDocStore.getState().undoStack).toHaveLength(0);
  });

  it("落 3 点「完成」⇒ 新增一条手画区块；撤销一步整条消失", async () => {
    await setup();
    fireEvent.click(drawTool());

    clickWorld({ x: -300, y: -300 });
    clickWorld({ x: -150, y: -300 });
    clickWorld({ x: -150, y: -150 });
    await waitFor(() => expect(drawnPoints()).toBe(3));

    fireEvent.click(finishButton());
    await waitFor(() => expect(useMapDocStore.getState().doc.regions).toHaveLength(1));

    const created = useMapDocStore.getState().doc.regions[0];
    expect(created.origin).toBe("manual");
    expect(created.level).toBe(0);
    expect(created.parentId).toBeNull();
    expect(created.polygon).toHaveLength(3);
    // 成功即清空草稿，并留在画区模式（便于连续画）
    await waitFor(() => expect(drawnPoints()).toBe(0));
    expect(drawActions()).not.toBeNull();
    expect(drawCount()).toContain("已用 1/600");

    // 一次撤销：整块消失（落库是**一条**记录、**一次**快照）
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(useMapDocStore.getState().doc.regions).toHaveLength(0));
  });

  it("模式隔离：画区态在已有区块内点一下 ⇒ 选区不变、不新增区块、只多一个顶点", async () => {
    await setup();

    // ── 先用手画造出一块（几何完全可控，也不用先跑一遍生成）──
    fireEvent.click(drawTool());
    clickWorld({ x: -300, y: -300 });
    clickWorld({ x: 0, y: -300 });
    clickWorld({ x: 0, y: 0 });
    clickWorld({ x: -300, y: 0 });
    await waitFor(() => expect(drawnPoints()).toBe(4));
    fireEvent.click(finishButton());
    await waitFor(() => expect(useMapDocStore.getState().doc.regions).toHaveLength(1));
    const region = useMapDocStore.getState().doc.regions[0];

    // ── 回选择模式，点中那块地 ──
    fireEvent.keyDown(window, { key: "Escape" }); // 无草稿 ⇒ 退出画区
    await waitFor(() => expect(drawActions()).toBeNull());
    clickWorld({ x: -150, y: -150 });
    await waitFor(() =>
      expect(useMapSelectionStore.getState().selectedRegionId).toBe(region.id),
    );

    const regionsBefore = useMapDocStore.getState().doc.regions;

    // ── 进画区，在同一块地内部点一下 ──
    fireEvent.click(drawTool());
    // 选中 level 0 的区块 ⇒ 目标层级 = 1，但层级已下线（schema 仅 1 级，2.42.0）⇒
    // 必然越界：胶囊标红、落点**前**拦截（裁决 5 的层级判定仍在，只是永远溢出）
    expect(drawLevel()).toBe("已达最深层级（共 1 级）");

    clickWorld({ x: -150, y: -150 });

    // ① 选区纹丝不动（画区态不得命中区块/素材）
    expect(useMapSelectionStore.getState().selectedRegionId).toBe(region.id);
    // ② 文档一个字段都没变（尤其 regions 的**引用**不变 ⇒ 没有任何 commit）
    expect(useMapDocStore.getState().doc.regions).toBe(regionsBefore);
    expect(useMapDocStore.getState().undoStack).toHaveLength(1); // 只有"画第一块"那一步
    // ③ 落点被层级封顶拦下：顶点不落（旧口径"多一个顶点"随层级下线不再成立）
    expect(drawnPoints()).toBe(0);
  });

  /* ────────── 双击收尾（R-REG-03 的回归主战场） ────────── */

  /**
   * 在同一处连点两下 = 双击（两次 down 的间隔必然 < 350ms）。
   *
   * 【为什么用两次 down/up 而不是 `fireEvent.doubleClick`】闭合判定已从 `dblclick`
   * 搬到 `pointerdown`：`dblclick` 是浏览器在**两次 down/up 之后**才派发的事件，
   * 那时顶点已经落下了，只能事后补救。真双击的行为必须用真实的事件序列表达。
   */
  function doubleClickWorld(world: { x: number; y: number }) {
    clickWorld(world);
    clickWorld(world);
  }

  /** 一个五边形的前 4 个顶点（第 5 个由"双击"提供），环绕质心递增、不自交 */
  const QUAD: Array<{ x: number; y: number }> = [
    { x: -300, y: -300 },
    { x: -100, y: -320 },
    { x: 0, y: -150 },
    { x: -200, y: 0 },
  ];
  const FIFTH = { x: -350, y: -120 };

  it("画 4 点再双击（第 5 点由双击提供）⇒ 落库顶点数是 5，不是 6", async () => {
    await setup();
    fireEvent.click(drawTool());
    for (const p of QUAD) clickWorld(p);
    await waitFor(() => expect(drawnPoints()).toBe(4));

    doubleClickWorld(FIFTH);

    // 【缺陷本体】旧实现挂在 dblclick 上：两对 down/up 会落两个顶点，
    // 收尾时要么多一个顶点（6），要么以 degenerate-edge 把整条草稿打回
    await waitFor(() => expect(useMapDocStore.getState().doc.regions).toHaveLength(1));
    const created = useMapDocStore.getState().doc.regions[0];
    expect(created.polygon).toHaveLength(5);
    expect(created.origin).toBe("manual");
    // 落库后草稿清空、仍在画区模式
    await waitFor(() => expect(drawnPoints()).toBe(0));
    expect(drawActions()).not.toBeNull();
    // 成功提示（没有落到任何 message.error 分支）
    expect(document.body.textContent ?? "").toMatch(/已创建区块/);
  });

  it("双击首顶点附近 ⇒ 闭合，第二下被静默吸收、不留未闭合顶点", async () => {
    await setup();
    fireEvent.click(drawTool());
    for (const p of QUAD) clickWorld(p);
    clickWorld(FIFTH);
    await waitFor(() => expect(drawnPoints()).toBe(5));

    // ── 双击：两下**相邻**发出，保证落在同一个 350ms 双击窗口内 ──
    //
    // 【为什么要相邻发】早期版本在两下之间夹了一个 `await waitFor(...)`；并发跑
    // 全量（`--maxWorkers=4` 与其它文件争 CPU）时那个 await 可能被拖到 >350ms，
    // 于是第二下被当成"新多边形的第一点"落下一个孤立顶点 —— 表现为"并发必红、
    // 单跑必绿"的假回归（实测正是这条）。两下相邻即无时间依赖，断言更稳。
    clickWorld(QUAD[0]); // 第一下：命中首顶点 ⇒ 立即闭合
    clickWorld(QUAD[0]); // 第二下：草稿已空 ⇒ 必须被静默吸收

    await waitFor(() => expect(useMapDocStore.getState().doc.regions).toHaveLength(1));
    // 顶点数 = 已落点数，既没多也没少（旧实现会多出第 6 点或残留孤立点）
    expect(useMapDocStore.getState().doc.regions[0].polygon).toHaveLength(5);
    // 关键：草稿已被清空 —— 不留未闭合顶点
    expect(drawnPoints()).toBe(0);
    // 第二下没有多造一块
    expect(useMapDocStore.getState().doc.regions).toHaveLength(1);
  });

  it("画 2 点再双击 ⇒ 落库 3 顶点（≥3 的下界仍然走得通）", async () => {
    await setup();
    fireEvent.click(drawTool());
    clickWorld({ x: -300, y: -300 });
    clickWorld({ x: -100, y: -300 });
    await waitFor(() => expect(drawnPoints()).toBe(2));

    doubleClickWorld({ x: -200, y: -100 });

    await waitFor(() => expect(useMapDocStore.getState().doc.regions).toHaveLength(1));
    expect(useMapDocStore.getState().doc.regions[0].polygon).toHaveLength(3);
  });

  it("缓慢点首顶点（两次 down 间隔 > 350ms）⇒ 走「命中首顶点」闭合，不新增顶点", async () => {
    await setup();
    fireEvent.click(drawTool());
    for (const p of QUAD) clickWorld(p);
    clickWorld(FIFTH);
    await waitFor(() => expect(drawnPoints()).toBe(5));

    // 真实等待，不用假时钟：双击窗口是 350ms，等 420ms 即可跨过它。
    // （假时钟会波及 React 调度与 antd 的动画计时，代价远大于这 0.4 秒。）
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });

    clickWorld(QUAD[0]);
    await waitFor(() => expect(useMapDocStore.getState().doc.regions).toHaveLength(1));
    // 顶点数 = 已落点数，既没多也没少
    expect(useMapDocStore.getState().doc.regions[0].polygon).toHaveLength(5);
    expect(drawnPoints()).toBe(0);
  });

  it("350ms 窗口之外在同一处再点一下**不闭合**（只是被判成手抖、去重吃掉）", async () => {
    await setup();
    fireEvent.click(drawTool());
    for (const p of QUAD) clickWorld(p);
    clickWorld(FIFTH);
    await waitFor(() => expect(drawnPoints()).toBe(5));

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
    // 慢速地点在与上个顶点**完全相同**的位置：不是双击、也不是首顶点
    clickWorld(FIFTH);

    // 仍停在画区态、5 个点：若双击判定不看时间差，这里会闭合成一块
    expect(drawnPoints()).toBe(5);
    expect(useMapDocStore.getState().doc.regions).toHaveLength(0);
    expect(drawActions()).not.toBeNull();
  });

  /**
   * Esc 的四个消费者不能互相抢（画区加进来之后的竞争）。
   *
   * 靠的是 window 监听里那句 "target 是 INPUT 就 return" —— 这句是**约定**，
   * 一旦有人把它挪到 `const mod = ...` 之后，输入框里的 Esc 就会连带清掉草稿，
   * 而画面上只会表现为"按 Esc 有时取消、有时不取消"。这里把它钉成用例。
   */
  it("画区态 + 已落 3 点 + 焦点在输入框：Esc 只作用于输入框，草稿与模式都不动", async () => {
    await setup();

    // 先放一个素材（选中它，属性区才会出现「地名」输入框）
    pickSprite("森林");
    clickCanvas(localOf({ x: 0, y: 0 }));
    await waitFor(() => expect(countLabel()).toContain("1"));

    fireEvent.click(drawTool());
    clickWorld({ x: -300, y: -300 });
    clickWorld({ x: -100, y: -300 });
    clickWorld({ x: -100, y: -100 });
    await waitFor(() => expect(drawnPoints()).toBe(3));

    const input = screen.getByPlaceholderText("地名") as HTMLInputElement;
    input.focus();
    fireEvent.keyDown(input, { key: "Escape" });

    // 草稿与模式都纹丝不动
    expect(drawnPoints()).toBe(3);
    expect(drawActions()).not.toBeNull();
    // 反向对照：在**画布之外**（window 上）按 Esc，第一下就该清掉草稿
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(drawnPoints()).toBe(0));
    expect(drawActions()).not.toBeNull(); // 只清草稿，还在画区模式
  });

  /**
   * 画区态拖动画布 ≠ 撒顶点。
   *
   * 【为什么单独立一条】落点放在 `pointerup`（只有"几乎没移动"才算单击），正是为了
   * 让"拖空白平移"不误撒顶点。若把落点搬回 `pointerdown`（一个很自然的"顺手简化"），
   * 用户一拖动画布就会沿拖动轨迹撒下一串顶点 —— 而现有用例都不会红。
   */
  it("画区态拖动画布（位移 > CLICK_SLOP）⇒ 只平移、不撒顶点", async () => {
    await setup();
    fireEvent.click(drawTool());
    clickWorld({ x: -300, y: -300 });
    clickWorld({ x: -150, y: -300 });
    await waitFor(() => expect(drawnPoints()).toBe(2));

    const before = drawnPoints();
    // 按住并拖动超过单击阈值（CLICK_SLOP = 4px）：必须判为平移而不是"落一个顶点"
    const from = { x: 400, y: 500 };
    const to = { x: 560, y: 660 };
    fireEvent.pointerDown(host(), { clientX: from.x, clientY: from.y, pointerId: 1, button: 0 });
    fireEvent.pointerMove(host(), { clientX: to.x, clientY: to.y, pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(host(), { clientX: to.x, clientY: to.y, pointerId: 1, button: 0 });
    await act(async () => {});

    // 顶点数不变（拖动不落点），仍在画区模式，也没有落库任何区块
    expect(drawnPoints()).toBe(before);
    expect(drawActions()).not.toBeNull();
    expect(useMapDocStore.getState().doc.regions).toHaveLength(0);
  });
});
