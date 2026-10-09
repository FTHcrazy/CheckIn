import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App as AntApp } from "antd";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MapEditorPage 坐标链路回归测试。
 *
 * ── 真实缺陷 ──
 * 用户报障两条，实为**同一根因**：`screen→world` 被换算了两遍。
 *
 *   MapCanvas 已经用「画布真实像素几何」把点击换算成世界坐标后回调，
 *   而页面又把它当作屏幕坐标调了一次 `toWorld`：
 *
 *     world_out = screenToWorld(world_in) = (world_in - C)/k + V
 *
 *   两个后果：
 *   1. **落位偏移**：素材落到远离光标的位置，缩放越小偏得越狠
 *      （k=0.9 时相对位移被放大到 1/k² ≈ 1.23，且额外叠加 -C/k 的固定偏移）。
 *   2. **只能拖动一次**：命中测试 `pickElement` 的入参同样被污染 →
 *      点在素材上永远选不中 → 每次点击都 `setSelectedId(null)`。
 *      素材刚落位时是选中的，所以"能拖一次"；此后再也无法重新选中，
 *      第二拖就变成了平移画布。
 *
 * 修复：坐标换算只允许发生一次 —— 由持有画布像素几何的 MapCanvas 负责，
 * 页面直接使用收到的世界坐标（见 MapCanvas/index.tsx 的 props 契约注释）。
 *
 * 本测试不 mock MapCanvas，只替换 pixi 渲染后端与纹理加载，
 * 因此真实覆盖「指针事件 → 换算 → 落位 → 选中 → 拖拽」整条链路。
 */

/** 记录所有素材精灵的位置写入（假 Sprite 的 position.set） */
const { spritePositions } = vi.hoisted(() => ({
  spritePositions: [] as { x: number; y: number }[],
}));

vi.mock("pixi.js", () => {
  /** 只声明被测代码真正用到的成员，类型宽松以便子类覆写 */
  type Setter = { set: (...args: number[]) => void };

  class FakeContainer {
    children: unknown[] = [];
    scale: Setter = { set: () => {} };
    position: Setter = { set: () => {} };
    addChild(...kids: unknown[]) {
      this.children.push(...kids);
      return kids[0];
    }
    removeChild() {}
    destroy() {}
  }

  class FakeSprite extends FakeContainer {
    anchor: Setter = { set: () => {} };
    width = 0;
    height = 0;
    rotation = 0;
    texture: unknown = null;
    /** 素材精灵的落位写入即"元素当前世界坐标"，供断言读取 */
    position: Setter = {
      set: (x: number, y: number) => {
        spritePositions.push({ x, y });
      },
    };
  }

  class FakeGraphics extends FakeContainer {
    clear() {}
    rect() {
      return this;
    }
    stroke() {
      return this;
    }
  }

  class Application {
    canvas = document.createElement("canvas");
    stage = new FakeContainer();
    // 立刻 resolve：测试只关心坐标与手势，不关心 Pixi 生命周期
    init = vi.fn(async () => {});
    destroy = vi.fn();
  }

  const Texture = { EMPTY: Symbol("empty") };
  return {
    Application,
    Container: FakeContainer,
    Sprite: FakeSprite,
    Graphics: FakeGraphics,
    Texture,
  };
});

/** 纹理加载无关本测试：直接给空表 + ready，避免触碰真实网络/解码 */
vi.mock("./hooks/useTextureCache", () => ({
  useTextureCache: () => ({ textures: {}, ready: true }),
}));

// 依赖 mock 之后再导入被测页面
import MapEditorPage from "./index";

// jsdom 未实现 PointerEvent / 指针捕获：用 MouseEvent 顶替并补空实现，
// 使 React 的 pointer 事件链路在测试环境可用。
if (typeof window.PointerEvent === "undefined") {
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
}
if (typeof Element.prototype.setPointerCapture !== "function") {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

/** 画布基准尺寸（由 getBoundingClientRect 桩决定） */
const CANVAS = 1024;
/**
 * 初始适配后的缩放。fitToRect 对 1024×1024 的底图在 1024×1024 画布上：
 * min(1024/1024, 1024/1024) * 0.9 = 0.9 —— 取整数值便于精确断言。
 */
const SCALE = 0.9;
/** 初始视口中心恒为底图中心 = 世界原点 */
const VIEW = { x: 0, y: 0 };

const rect = {
  width: CANVAS,
  height: CANVAS,
  left: 0,
  top: 0,
  right: CANVAS,
  bottom: CANVAS,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

let rectSpy: ReturnType<typeof vi.spyOn>;

/** 世界坐标 → 画布本地像素（与 coords.worldToScreen 同式） */
function localOf(world: { x: number; y: number }) {
  return {
    x: (world.x - VIEW.x) * SCALE + CANVAS / 2,
    y: (world.y - VIEW.y) * SCALE + CANVAS / 2,
  };
}

/** 画布本地像素 → 世界坐标（与 coords.screenToWorld 同式） */
function worldOf(local: { x: number; y: number }) {
  return {
    x: (local.x - CANVAS / 2) / SCALE + VIEW.x,
    y: (local.y - CANVAS / 2) / SCALE + VIEW.y,
  };
}

function host(): HTMLElement {
  return document.querySelector(".map-canvas") as HTMLElement;
}

/** 单击画布（无位移） */
function clickCanvas(local: { x: number; y: number }) {
  fireEvent.pointerDown(host(), {
    clientX: local.x,
    clientY: local.y,
    pointerId: 1,
    button: 0,
  });
  fireEvent.pointerUp(host(), {
    clientX: local.x,
    clientY: local.y,
    pointerId: 1,
    button: 0,
  });
}

/** 从 from 拖到 to（按住左键移动后释放） */
function dragCanvas(from: { x: number; y: number }, to: { x: number; y: number }) {
  fireEvent.pointerDown(host(), {
    clientX: from.x,
    clientY: from.y,
    pointerId: 1,
    button: 0,
  });
  fireEvent.pointerMove(host(), {
    clientX: to.x,
    clientY: to.y,
    pointerId: 1,
    buttons: 1,
  });
  fireEvent.pointerUp(host(), {
    clientX: to.x,
    clientY: to.y,
    pointerId: 1,
    button: 0,
  });
}

/** 工具栏「删除选中」按钮：其可用态即"当前是否有选中素材" */
function deleteButton(): HTMLElement {
  return screen.getByRole("button", { name: "delete" });
}

/**
 * 工具栏缩放标签文本。
 * 注意不能用 getByText —— 该 span 的祖先容器 textContent 同样是 "90%"，
 * 会命中多个元素而报错。
 */
function zoomLabel(): string {
  return document.querySelector(".map-editor__zoom-label")?.textContent ?? "";
}

/** 工具栏素材计数文本（同上，用类选择器精确定位） */
function countLabel(): string {
  return document.querySelector(".map-editor__count")?.textContent ?? "";
}

/** 素材面板底部提示：反映当前是否处于"待放置"态 */
function pendingHint(): string {
  return document.querySelector(".sprite-panel__hint")?.textContent ?? "";
}

/** 选中左侧面板的素材（进入待放置态） */
function pickSprite(label: string) {
  const img = screen.getByAltText(label);
  fireEvent.click(img.closest("button") as HTMLElement);
}

/** 渲染页面并等待初始适配完成（缩放标签变成 90%） */
async function setup() {
  const utils = render(
    <AntApp>
      <MapEditorPage />
    </AntApp>,
  );
  // 放行 MapCanvas 的异步 init → canvasSize 落地 → 首次 fitView
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  await waitFor(() => expect(zoomLabel()).toBe("90%"));
  return utils;
}

beforeEach(() => {
  spritePositions.length = 0;
  rectSpy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
});

afterEach(() => {
  // 未开启 vitest globals 时 RTL 不会自动清理，DOM 会跨用例累积
  cleanup();
  rectSpy.mockRestore();
});

describe("MapEditorPage 坐标链路", () => {
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
    dragCanvas(grab, { x: grab.x + 18, y: grab.y });

    const moved = spritePositions.at(-1) as { x: number; y: number };
    // 屏幕右移 18px ÷ 缩放 0.9 = 世界 +20
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
    dragCanvas(grab, { x: grab.x + 18, y: grab.y });
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
    dragCanvas(reselect, { x: reselect.x + 18, y: reselect.y });
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
});
