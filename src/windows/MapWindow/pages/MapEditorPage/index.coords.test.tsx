import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MapEditorPage 页面级回归（拆分之一）：坐标链路 + 全屏缩放与素材尺寸。
 *
 * 真实缺陷背景（原 index.test.tsx 顶部）：
 *   `screen→world` 被换算两遍 → 落位偏移 + 素材只能拖动一次。本文件不 mock
 *   MapCanvas，只替换 pixi 后端与纹理，真实覆盖「指针事件 → 换算 → 落位 → 选中
 *   → 拖拽」整条链路。拆分原因与探针注入方式见 `index.generate.test.tsx` 头部。
 */
import { worldToScreen } from "./coords";
import {
  CANVAS,
  MARGIN,
  VIEW,
  canvasHint,
  clickCanvas,
  countLabel,
  deleteButton,
  dragCanvas,
  host,
  installPointerShims,
  levelChip,
  localAt,
  localOf,
  openMore,
  pendingHint,
  pickSprite,
  rect,
  regionLabel,
  setup,
  worldOf,
  zoomBy,
  zoomLabel,
} from "./__test-utils";
import { resetMapStores } from "./store/reset";

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

describe("MapEditorPage 坐标链路", () => {
  it("留白：底图不铺满画布，四周各留约一成空白", async () => {
    await setup();

    // 用**页面上真实显示的缩放**（而非测试自己的常量）推算底图四角位置，
    // 这样断言跟着实际视口走：一旦有人把适配改回"铺满"，缩放标签会变，
    // 四角随即贴边/出界，此处立刻失败。
    const scale = Number(zoomLabel().replace("%", "")) / 100;
    const size = { width: CANVAS, height: CANVAS };
    const half = CANVAS / 2; // 底图世界尺寸 1024 → 半宽 512 = CANVAS / 2
    const tl = worldToScreen({ x: -half, y: -half }, { ...VIEW, scale }, size);
    const br = worldToScreen({ x: half, y: half }, { ...VIEW, scale }, size);

    // 四边都必须留出空白（底图不裁边）
    expect(tl.x).toBeGreaterThanOrEqual(MARGIN - 1e-6);
    expect(tl.y).toBeGreaterThanOrEqual(MARGIN - 1e-6);
    expect(CANVAS - br.x).toBeGreaterThanOrEqual(MARGIN - 1e-6);
    expect(CANVAS - br.y).toBeGreaterThanOrEqual(MARGIN - 1e-6);

    // 留白比例落在合理区间：至少 9%（读出"这是一张完整的图纸"），
    // 但也不能缩得只剩孤零零一小块（≤ 20%）。
    expect(MARGIN / CANVAS).toBeGreaterThanOrEqual(0.09);
    expect(MARGIN / CANVAS).toBeLessThanOrEqual(0.2);
  });

  it("落位：素材落在光标对应的世界坐标，而非被二次换算", async () => {
    await setup();
    pickSprite("森林");

    const click = { x: 712, y: 571 };
    clickCanvas(click);

    await waitFor(() => expect(spritePositions.length).toBeGreaterThan(0));
    const placed = spritePositions.at(-1) as { x: number; y: number };
    const expected = worldOf(click);

    expect(placed.x).toBeCloseTo(expected.x, 5);
    expect(placed.y).toBeCloseTo(expected.y, 5);

    // 历史缺陷签名：世界坐标又被当作屏幕坐标换算一次 → 落点跑到别处
    const doubled = worldOf(expected);
    expect(Math.abs(placed.x - doubled.x)).toBeGreaterThan(1);
    expect(Math.abs(placed.y - doubled.y)).toBeGreaterThan(1);
  });

  it("拖拽：按世界坐标增量移动，元素不会跳到光标下方", async () => {
    await setup();
    pickSprite("森林");
    clickCanvas(localOf({ x: 0, y: 0 }));

    // 以**实际落位**为基准：落位精度由上一个用例负责，这里只验证拖拽手感
    const placed = spritePositions.at(-1) as { x: number; y: number };
    const grabWorld = { x: placed.x, y: placed.y - 45 }; // 元素竖直中部（基准高 90）
    const grab = localOf(grabWorld);
    dragCanvas(grab, { x: grab.x + 16, y: grab.y });

    const moved = spritePositions.at(-1) as { x: number; y: number };
    // 屏幕右移 16px ÷ 缩放 0.8 = 世界 +20
    expect(moved.x - placed.x).toBeCloseTo(20, 5);
    // 增量式：y 保持不动。若误把锚点吸附到光标，y 会变成光标的 -45
    expect(moved.y - placed.y).toBeCloseTo(0, 5);
    expect(Math.abs(moved.y - grabWorld.y)).toBeGreaterThan(1);
  });

  it("取消选中后可重新点选并再次拖动（回归：素材只能拖动一次）", async () => {
    await setup();
    pickSprite("森林");
    clickCanvas(localOf({ x: 0, y: 0 })); // 落位即选中
    expect(deleteButton()).not.toBeDisabled();

    // ── 第一次拖动：应当生效 ──
    const placed = spritePositions.at(-1) as { x: number; y: number };
    const grab = localOf({ x: placed.x, y: placed.y - 45 });
    dragCanvas(grab, { x: grab.x + 16, y: grab.y });
    const afterFirst = spritePositions.at(-1) as { x: number; y: number };
    expect(afterFirst.x - placed.x).toBeCloseTo(20, 5);

    // ── 点画布空白处：取消选中（正常行为）──
    clickCanvas({ x: 60, y: 60 });
    expect(deleteButton()).toBeDisabled();

    // ── 重新点选该素材 ──
    // 此前缺陷：命中测试拿到的是二次换算后的世界坐标，永远打不中 →
    // 每次点击都清空选中 → 素材再也无法被选中，自然"只能拖一次"。
    const reselect = localOf({ x: afterFirst.x, y: afterFirst.y - 45 });
    clickCanvas(reselect);
    expect(deleteButton()).not.toBeDisabled();

    // ── 第二次拖动：必须再次生效 ──
    dragCanvas(reselect, { x: reselect.x + 16, y: reselect.y });
    const afterSecond = spritePositions.at(-1) as { x: number; y: number };
    expect(afterSecond.x - afterFirst.x).toBeCloseTo(20, 5);
  });

  it("缓慢拖动（每次仅移动 1px）应判为拖拽，不得触发落位", async () => {
    await setup();
    // 进入待放置态但不点画布：此时若有任何"误判为单击"，就会立刻落位
    pickSprite("森林");
    expect(countLabel()).toContain("0");
    expect(pendingHint()).toContain("点击画布放置");

    const from = { x: 512, y: 300 };
    fireEvent.pointerDown(host(), {
      clientX: from.x,
      clientY: from.y,
      pointerId: 1,
      button: 0,
    });
    // 20 次 1px 移动：单次位移永远低于阈值，只有累计位移才能识别为拖拽。
    // 若按"单次位移"判断（历史缺陷），松手时会被当成单击 → 素材凭空落位。
    for (let i = 1; i <= 20; i += 1) {
      fireEvent.pointerMove(host(), {
        clientX: from.x + i,
        clientY: from.y,
        pointerId: 1,
        buttons: 1,
      });
    }
    fireEvent.pointerUp(host(), {
      clientX: from.x + 20,
      clientY: from.y,
      pointerId: 1,
      button: 0,
    });

    // 识别为拖拽：未落位，且待放置态保留
    expect(countLabel()).toContain("0");
    expect(pendingHint()).toContain("点击画布放置");
  });

  /**
   * 生成 → 撤销 → 重做 → 清除。
   *
   * 【2.42.0】区域只有国家一级：生成 12 块。超时由文件顶层的
   * `vi.setConfig({ testTimeout: 120000 })` 统一兜住。
   */
  it("区块：可生成、可撤销、可重做、可清除", async () => {
    await setup();

    const generate = screen.getByRole("button", { name: /生成区块/ });
    /** 每次重新查询：按钮的 disabled 会随状态切换，避免持有过期节点 */
    const clearRegionsBtn = () => {
      openMore();
      return screen.getByText("清除区块").closest("button") as HTMLElement;
    };

    // 初始无区块：标签不渲染，清除按钮禁用
    expect(regionLabel()).toBe("");
    expect(clearRegionsBtn()).toBeDisabled();

    // ── 生成 ──
    fireEvent.click(generate);
    await waitFor(() => expect(regionLabel()).toContain("12"));
    expect(clearRegionsBtn()).not.toBeDisabled();

    // ── 撤销：区块必须一起回退 ──
    // 这条断言是本次改动的核心风险点：撤销栈原先只快照 elements，
    // 区块不进历史。若仍是这样，撤销后区块会留在原地、此处失败。
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(regionLabel()).toBe(""));

    // ── 重做：区块恢复 ──
    fireEvent.click(screen.getByRole("button", { name: "redo" }));
    await waitFor(() => expect(regionLabel()).toContain("12"));

    // ── 清除 ──
    fireEvent.click(clearRegionsBtn());
    await waitFor(() => expect(regionLabel()).toBe(""));
    expect(clearRegionsBtn()).toBeDisabled();
  });

  it("区块与素材互不干扰：生成区块不会影响已放置的素材", async () => {
    await setup();
    pickSprite("森林");
    clickCanvas(localOf({ x: 0, y: 0 }));
    await waitFor(() => expect(countLabel()).toContain("1"));

    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("12"));

    // 素材数量保持不变 —— 区块层与素材层是各自独立的文档字段
    expect(countLabel()).toContain("1");

    // 撤销一次只回退区块，素材仍在
    fireEvent.click(screen.getByRole("button", { name: "undo" }));
    await waitFor(() => expect(regionLabel()).toBe(""));
    expect(countLabel()).toContain("1");
  });

  /**
   * 【2.42.0】层级配置随层级一并下线：主栏不再有「层级 N」浮层与
   * 「应用并生成区块」入口，区域只有国家一级，「生成区块」一步出图。
   */
  it("区域只有国家一级：无层级配置入口，生成即 12 块", async () => {
    await setup();
    // 层级配置浮层已整体移除（RegionSchemaPanel 随 2.42.0 删除）
    expect(screen.queryByRole("button", { name: /层级 \d/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /应用并生成区块/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("12"));
  });

  /**
   * 【2.42.0】无级缩放（LOD 交叉淡化）已随层级一并关闭：区域只有国家一级，
   * 层级胶囊恒为「国家 100%」，缩放只改变视口倍率。
   */
  it("缩放不改变层级显示：胶囊恒为「国家」，到缩放下限后不再变小", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("12"));

    const zoomPct = () => document.querySelector(".map-editor__zoom-label")?.textContent ?? "?";
    const chip = () => document.querySelector(".map-editor__level-chip")?.textContent ?? "";
    // 【为什么抠数值而不是钉字符串】多档缩放的累积浮点误差会把 208% 抖成 207%，
    // 钉精确读数只会制造假红；这里关心的是"过了 200 且不再动"。
    const zoomVal = () => Number((zoomPct().match(/(\d+)%/) ?? [])[1] ?? -1);

    // 起点：国家（唯一的层级），80%
    expect(zoomVal()).toBe(80);
    expect(chip()).toBe("国家");

    // 放大若干档：倍率在变，层级不变
    const zoomIn = screen.getByRole("button", { name: "zoom-in" });
    const zoomOut = screen.getByRole("button", { name: "zoom-out" });
    for (let i = 0; i < 10; i += 1) fireEvent.click(zoomIn);
    await waitFor(() => expect(zoomVal()).toBeGreaterThan(200), { timeout: 3000 });
    expect(chip()).toBe("国家");

    // 「适应窗口」精确回到起点
    fireEvent.click(screen.getByRole("button", { name: "expand" }));
    await waitFor(() => expect(zoomVal()).toBe(80), { timeout: 3000 });

    // 缩到下限（最粗一级自然缩放 × coarseOut = 0.609×0.6 ≈ 37%），再点不动
    for (let i = 0; i < 12; i += 1) fireEvent.click(zoomOut);
    await waitFor(() => expect(zoomVal()).toBeLessThanOrEqual(40), { timeout: 3000 });
    fireEvent.click(zoomOut);
    fireEvent.click(zoomOut);
    await act(async () => {});
    expect(zoomVal()).toBeLessThanOrEqual(40);
    expect(chip()).toBe("国家");
  });

  /**
   * 【2.42.0】素材不再随层级淡出（层级已关闭）：任何缩放下都可见、可选中。
   * 钉住这条防回归 —— 若有人把 `elementWeight` 重新接到衰减链上，这里会红。
   */
  it("素材不随缩放淡出：放大放置、缩回整图后仍选中、仍点得中", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("12"));
    expect(canvasHint()).toContain("新素材归入「国家」级");

    // 放大后摆一座山
    zoomBy("zoom-in", 11);
    pickSprite("山（中）");
    const anchor = { x: 30, y: 20 };
    clickCanvas(localAt(anchor));
    await waitFor(() => expect(countLabel()).toContain("1"));
    expect(deleteButton()).not.toBeDisabled();

    // 缩回整图：山还在，选中保持（权重恒 1）
    fireEvent.click(screen.getByRole("button", { name: "expand" }));
    await waitFor(() => expect(zoomLabel()).toBe("80%"));
    expect(deleteButton()).not.toBeDisabled();

    // 取消后再点它：仍点得中
    clickCanvas({ x: 20, y: 1000 });
    expect(deleteButton()).toBeDisabled();
    clickCanvas(localAt({ x: anchor.x, y: anchor.y - 4 }));
    expect(deleteButton()).not.toBeDisabled();
  });

  /**
   * 反向保障：**生成区块之前**放置的素材没有层级可言，不能因此被藏起来。
   *
   * 这类素材记 `level: null`（层级无关，权重恒为 1），且生成区块**不会**回头
   * 改写它们的归属 —— 隐式的数据改写比"素材与新层级不一致"更难排查。
   */
  it("未生成区块时放置的素材层级无关：缩到任何一级都还在、也点得中", async () => {
    await setup();
    expect(canvasHint()).toContain("不归属层级");

    pickSprite("森林");
    clickCanvas(localOf({ x: 40, y: 40 }));
    await waitFor(() => expect(countLabel()).toContain("1"));

    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("12"));
    // 提示改为"新素材归入某级"，说明归属只对之后放置的素材生效
    expect(canvasHint()).not.toContain("不归属层级");
    // 层级无关 → 不该被层级切换清掉选中
    expect(deleteButton()).not.toBeDisabled();

    // 先取消选中，后面那一下点击才有断言价值
    clickCanvas({ x: 20, y: 1000 });
    expect(deleteButton()).toBeDisabled();

    // 缩到最远：最粗一级就是国家，层级胶囊不再变
    zoomBy("zoom-out", 8);
    await waitFor(() => expect(levelChip()).toBe("国家"));
    clickCanvas(localAt({ x: 40, y: 0 }));
    expect(deleteButton()).not.toBeDisabled();
  });
});

/**
 * 「最小的单位放大到全屏」+ 素材随层级缩小（用户报障的正面验收）。
 *
 * 用户原话：「无极缩放，最小的单位尺寸太小了，根本无法添加几个要素，能不能将
 * 最小的单位的尺寸支持放大到全屏为止」。两条根因各钉一条用例：
 *   1. 缩放上限（旧的 `scales[last] × 4` = 8.89，中位郡铺满要 10~11 倍）；
 *   2. 素材的基准宽（80~160）比它所属的郡（长边 70~90）还大。
 */
describe("MapEditorPage 全屏缩放与素材尺寸", () => {
  /**
   * 【2.42.0】层级已关闭：缩放上限 = 「国家能铺满画布短边」（fill 反推）与
   * 基础上限（最粗自然缩放 ×4）取大者。不再钉 1400% 这种与郡级挂钩的读数，
   * 只钉"有上限且到顶后不再变大"。
   */
  it("缩放有上限：放大到顶后读数不再变大", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("12"));

    zoomBy("zoom-in", 40);
    await waitFor(() => expect(Number(zoomLabel().replace("%", ""))).toBeGreaterThan(200), {
      timeout: 5000,
    });

    // 再点 3 次：读数必须一动不动 ⇒ 是"夹在上限"，不是"还能继续放大"
    const atMax = zoomLabel();
    zoomBy("zoom-in", 3);
    await act(async () => {});
    expect(zoomLabel()).toBe(atMax);
  });

  /**
   * 【2.42.0】素材不再按层级缩小（单级因子恒 1）：山（大）160×93 世界单位
   * 原尺寸参与命中。钉"点中心选中、点外接矩形外不选中"的几何口径。
   */
  it("素材命中区：点中心选中、点外接矩形外 1px 不选中", async () => {
    await setup();
    fireEvent.click(screen.getByRole("button", { name: /生成区块/ }));
    await waitFor(() => expect(regionLabel()).toContain("12"));

    // 山（大）基准 160×93，因子 1 ⇒ 半宽 80、高 93（锚点在脚底）
    pickSprite("山（大）");
    const anchor = { x: 0, y: 0 };
    clickCanvas(localAt(anchor));
    await waitFor(() => expect(countLabel()).toContain("1"));

    // 先取消选中，后面的点击才有断言价值
    clickCanvas({ x: 20, y: 1000 });
    expect(deleteButton()).toBeDisabled();

    // 竖直中部（锚点是脚底，素材在它上方）：能选中
    clickCanvas(localAt({ x: 0, y: -46 }));
    expect(deleteButton()).not.toBeDisabled();

    // 再取消，点"外接矩形外"：半宽 80，这里 81
    clickCanvas({ x: 20, y: 1000 });
    expect(deleteButton()).toBeDisabled();
    clickCanvas(localAt({ x: 81, y: -46 }));
    expect(deleteButton()).toBeDisabled();
  });
});
