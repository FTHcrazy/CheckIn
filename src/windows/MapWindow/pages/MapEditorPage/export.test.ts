import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Container } from "pixi.js";

/**
 * 导出 PNG（B5 / PRD §6.6.3）。
 *
 * 【本文件能测什么、不能测什么】
 *   ✔ 切块方案（纯函数，可以精确断言行列数、每块像素、平移量）；
 *   ✔ 逐块的 world 摆位与 `extract.canvas` 调用参数（拼缝对齐的唯一依据）；
 *   ✔ 失败路径必须复原视口（`finally`）；
 *   ✔ 落盘只走 `exportBinary`，绝不走 `exportFile`（源码级断言）。
 *   ✘ 真实的像素输出（jsdom 没有 WebGL，也没有真的 2D 上下文）；
 *   ✘ 4096 档拼缝处的像素差、颜色一致性 —— 必须真机截图比对。
 */

/** `export.ts` 运行时用 `new Rectangle(...)` 组 frame，必须提供替身 */
vi.mock("pixi.js", () => {
  class Rectangle {
    x: number;
    y: number;
    width: number;
    height: number;
    constructor(x: number, y: number, width: number, height: number) {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
    }
  }
  return { Rectangle };
});

import {
  EXPORT_DEFAULT_SIZE,
  EXPORT_SIZES,
  EXPORT_TILE_MAX,
  exportMapPng,
  savePng,
  tilePlan,
  type ExportScene,
} from "./export";

const WORLD = { x: -512, y: -512, width: 1024, height: 1024 };

describe("tilePlan（纯函数）", () => {
  it("方纸 1024² 导成 4096：一块、倍率 4", () => {
    const plan = tilePlan(WORLD, 4096);
    expect(plan).toMatchObject({
      cols: 1,
      rows: 1,
      tilePxW: 4096,
      tilePxH: 4096,
      width: 4096,
      height: 4096,
      scale: 4,
    });
  });

  it("长边定尺寸、短边按同一倍率（不分别缩放，否则两种纸看起来畸变不同）", () => {
    const plan = tilePlan({ x: 0, y: 0, width: 1000, height: 500 }, 2048);
    expect(plan.width).toBe(2048);
    expect(plan.height).toBe(1024);
    expect(plan.scale).toBeCloseTo(2.048, 6);
  });

  it("4096 档永远不需要切块（1 × 1），因为远小于 EXPORT_TILE_MAX", () => {
    for (const longSide of EXPORT_SIZES) {
      const plan = tilePlan(WORLD, longSide);
      expect(plan.cols).toBe(1);
      expect(plan.rows).toBe(1);
      // 与 8192 的关系：单块边长 == 整幅边长，且不超过上限
      expect(plan.tilePxW).toBe(Math.max(plan.width, plan.height));
      expect(plan.tilePxW).toBeLessThanOrEqual(EXPORT_TILE_MAX);
    }
  });

  it("超过上限才切块：16384 长边 → 2 × 2，每块正好 8192", () => {
    const plan = tilePlan(WORLD, 16384);
    expect(plan.width).toBe(16384);
    expect(plan.cols).toBe(2);
    expect(plan.rows).toBe(2);
    expect(plan.tilePxW).toBe(8192);
    expect(plan.tilePxH).toBe(8192);
    // 每块的边长 × 块数必须覆盖整幅（拼不齐就会露缝）
    expect(plan.tilePxW * plan.cols).toBeGreaterThanOrEqual(plan.width);
  });

  it("非方形纸的切块按长边算列、按短边算行", () => {
    const plan = tilePlan({ x: 0, y: 0, width: 2048, height: 1024 }, 16384, 4096);
    expect(plan.width).toBe(16384);
    expect(plan.height).toBe(8192);
    expect(plan.cols).toBe(4);
    expect(plan.rows).toBe(2);
    expect(plan.tilePxW).toBe(4096);
    expect(plan.tilePxH).toBe(4096);
  });

  it("尺寸档默认 2048（4096 的图约 30MB，不该是默认动作）", () => {
    expect(EXPORT_DEFAULT_SIZE).toBe(2048);
    expect(EXPORT_SIZES).toContain(EXPORT_DEFAULT_SIZE);
  });

  it("退化输入不产生 Infinity / 0 块", () => {
    const plan = tilePlan({ x: 0, y: 0, width: 0, height: 0 }, 2048);
    expect(Number.isFinite(plan.scale)).toBe(true);
    expect(plan.width).toBeGreaterThan(0);
    expect(plan.cols).toBeGreaterThanOrEqual(1);
  });
});

/** 只提供导出所需能力的假 world（position / scale 可读写，并记录每一次写入） */
function fakeWorld() {
  const state = { x: 12, y: -34, scale: 2.5 };
  /** 每次 `scale.set` 的实参（逐块摆位 + 最后一次复原） */
  const scaleWrites: number[] = [];
  /** 每次 `position.set` 的实参 */
  const positionWrites: Array<[number, number]> = [];
  const world = {
    state,
    scaleWrites,
    positionWrites,
    position: {
      get x() {
        return state.x;
      },
      get y() {
        return state.y;
      },
      set(nx: number, ny: number) {
        positionWrites.push([nx, ny]);
        state.x = nx;
        state.y = ny;
      },
    },
    scale: {
      get x() {
        return state.scale;
      },
      set(v: number) {
        scaleWrites.push(v);
        state.scale = v;
      },
    },
  };
  return world as unknown as typeof world & Container;
}

function fakeScene(overrides: Partial<ExportScene> = {}) {
  const world = fakeWorld();
  // 只关心"被调了几次、frame 是多少"：参数类型显式声明成 unknown，
  // 实现不接参数（写了 `_options` 却不用会被 no-unused-vars 抓）
  const canvas = vi.fn<(options: unknown) => unknown>(() => ({ fake: true }));
  const scene = {
    renderer: { extract: { canvas } },
    stage: {} as Container,
    world,
    worldRect: { ...WORLD },
    clearOverlay: vi.fn(),
    redrawOverlay: vi.fn(),
    ...overrides,
  } as ExportScene;
  return { scene, world, canvas };
}

describe("exportMapPng", () => {
  const drawImage = vi.fn();

  beforeEach(() => {
    drawImage.mockReset();
    // jsdom 没有真的 2D 上下文：只提供 drawImage，用来数"拼了几块"
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage,
    } as never);
    // toBlob 也一样：给一个能走的字节流，让整条链路跑到最后
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(
      ((cb: BlobCallback) => {
        cb({ arrayBuffer: async () => new ArrayBuffer(8) } as unknown as Blob);
      }) as unknown as typeof HTMLCanvasElement.prototype.toBlob,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("4096 档：取图一次、拼一块、得到 PNG 字节", async () => {
    const { scene, canvas } = fakeScene();
    const bytes = await exportMapPng(scene, 4096);

    expect(canvas).toHaveBeenCalledTimes(1);
    // target 必须是 stage（不是 world）：world 之上还有投影等外层内容
    expect(canvas.mock.calls[0]).toEqual([
      expect.objectContaining({
        target: scene.stage,
        resolution: 1,
        antialias: true,
        frame: expect.objectContaining({ x: 0, y: 0, width: 4096, height: 4096 }),
      }),
    ]);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 4096, 4096]);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes?.length).toBe(8);
  });

  it("导出前清空选中框、导出后重绘回来（成品图里不能有框，但导完不能一直没框）", async () => {
    const { scene } = fakeScene();
    await exportMapPng(scene, 2048);
    expect(scene.clearOverlay).toHaveBeenCalledTimes(1);
    expect(scene.redrawOverlay).toHaveBeenCalledTimes(1);
  });

  it("切块时逐块的 world 摆位正确（拼缝对齐的唯一依据）", async () => {
    const { scene, world, canvas } = fakeScene();
    await exportMapPng(scene, 16384);

    expect(canvas).toHaveBeenCalledTimes(4);
    /*
     * 1024² 的纸、16384 长边 ⇒ 倍率 16、2×2 块、每块 8192 像素。
     * 第 (col,row) 块的世界左上角 = (-512 + col·512, -512 + row·512)，
     * world.position = -原点 × 倍率 ⇒ col0 → 8192，col1 → 0，行优先遍历。
     * 数组最后一项是 `finally` 里的复原（回到初始化时的 12, -34）。
     */
    // `-原点 × 倍率` 在原点为 0 时会得到 -0（IEEE 754），渲染上无差别，
    // 但 `toEqual` 会把 -0 与 0 判为不同 —— 这里先归一化再比。
    expect(world.positionWrites.map(([x, y]) => [x + 0, y + 0])).toEqual([
      [8192, 8192],
      [0, 8192],
      [8192, 0],
      [0, 0],
      [12, -34],
    ]);
    // 倍率每次都显式写一遍（不依赖上一次的残留），最后一次复原成 2.5
    expect(world.scaleWrites).toEqual([16, 16, 16, 16, 2.5]);
    expect(canvas.mock.calls.map((c) => (c[0] as { frame: { width: number } }).frame.width)).toEqual(
      [8192, 8192, 8192, 8192],
    );
    // 4 次 drawImage 落在 2×2 的整数格上（不会因为缩放取整而错半像素）
    expect(drawImage.mock.calls.map((c) => c.slice(1))).toEqual([
      [0, 0, 8192, 8192],
      [8192, 0, 8192, 8192],
      [0, 8192, 8192, 8192],
      [8192, 8192, 8192, 8192],
    ]);
  });

  it("成功后视口必须复原（导出不该改变用户看到的画面）", async () => {
    const { scene, world } = fakeScene();
    await exportMapPng(scene, 4096);
    expect(world.state.x).toBe(12);
    expect(world.state.y).toBe(-34);
    expect(world.state.scale).toBe(2.5);
  });

  it("中途抛错也要复原视口，并重新画出选中框", async () => {
    const world = fakeWorld();
    const scene = {
      renderer: {
        extract: {
          canvas: () => {
            throw new Error("WebGL context lost");
          },
        },
      },
      stage: {} as Container,
      world,
      worldRect: { ...WORLD },
      clearOverlay: vi.fn(),
      redrawOverlay: vi.fn(),
    } as ExportScene;

    await expect(exportMapPng(scene, 4096)).rejects.toThrow("context lost");
    // 一次失败的导出不能把画面永久留在"某个切块的偏移"上
    expect(world.state).toEqual({ x: 12, y: -34, scale: 2.5 });
    expect(scene.redrawOverlay).toHaveBeenCalledTimes(1);
  });
});

describe("savePng", () => {
  const exportBinary = vi.fn();

  beforeEach(() => {
    exportBinary.mockReset();
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      novel: { exportBinary },
    };
  });

  afterEach(() => {
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it("走 exportBinary（字节通道），四个参数都对", async () => {
    exportBinary.mockResolvedValue({ path: "/tmp/map.png" });
    const bytes = new Uint8Array([137, 80, 78, 71]);
    const saved = await savePng(bytes, "地图-2048.png");

    expect(saved).toBe("/tmp/map.png");
    expect(exportBinary).toHaveBeenCalledWith("地图-2048.png", bytes, "png", "PNG 图片");
  });

  it("用户取消（返回 null）→ 不报错，返回 null", async () => {
    exportBinary.mockResolvedValue(null);
    await expect(savePng(new Uint8Array([0]), "a.png")).resolves.toBeNull();
  });

  it("主进程抛错 → 吞掉并返回 null（不把异常抛到 UI 事件里）", async () => {
    exportBinary.mockRejectedValue(new Error("disk full"));
    await expect(savePng(new Uint8Array([0]), "a.png")).resolves.toBeNull();
  });
});

describe("落盘通道（源码级硬约束）", () => {
  const SRC = readFileSync(
    path.resolve(process.cwd(), "src/windows/MapWindow/pages/MapEditorPage/export.ts"),
    "utf8",
  ).replace(/\r\n/g, "\n");

  it("只用 exportBinary，绝不出现 exportFile 调用", () => {
    // `exportFile` 是 utf8 写：写 PNG 会得到一个打不开的文件，且**零报错**
    // （AGENTS §2.1 有记录）。这条断言就是防止有人"顺手"换回去。
    expect(SRC).toMatch(/exportBinary\(/);
    expect(SRC).not.toMatch(/exportFile\(/);
  });

  it("取图目标必须是 stage，不是 world", () => {
    expect(SRC).toMatch(/target:\s*scene\.stage/);
    expect(SRC).not.toMatch(/target:\s*scene\.world/);
  });
});
