import { StrictMode } from "react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * MapCanvas 的 Pixi 生命周期回归测试。
 *
 * ── 真实缺陷 ──
 * 报错：`Uncaught TypeError: this._cancelResize is not a function`
 *   at _Application.destroy (pixi.js)
 *   at index.tsx:140  ← MapCanvas 初始化 effect 的 cleanup
 *
 * 根因链：
 *   1. Pixi v8 的 `Application.init()` 是 **async**，内部先
 *      `await autoDetectRenderer()`，**之后**才逐个执行插件 `init`；
 *      而 `ResizePlugin.init` 正是那个给 `this._cancelResize` 赋值的插件。
 *   2. `ResizePlugin.destroy()` 里无条件调用 `this._cancelResize()`。
 *   3. React 19 StrictMode 在开发模式下把 effect 跑成
 *      「挂载 → 卸载 → 再挂载」。第一次卸载时 `init()` 可能仍在 await 窗口内，
 *      此时 cleanup 调 `instance.destroy()` → 插件字段尚为 undefined → TypeError，
 *      且异常发生在 cleanup 里会连累后续渲染，表现为画布一直空白。
 *
 * 修复：在 effect 内用 `initDone` / `destroyPending` 记录状态 ——
 *   init 未完成时收到的卸载请求只置位、不销毁，等 init 完成后自行销毁。
 *
 * 本测试用「init 未 resolve 前 destroy 即抛错」的假 Application 复现该时序，
 * 把「init 完成前不得 destroy」这条不变量钉死在行为层面。
 */

/** 手动可控的 deferred：让测试精确掌握 init 何时 resolve */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 本次渲染期间创建的假 Application 实例 */
interface FakeApp {
  init: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  canvas: HTMLCanvasElement;
  stage: { addChild: ReturnType<typeof vi.fn> };
}

let apps: FakeApp[] = [];
/** init 调用是否已完成；未完成时 destroy 复刻真实插件的抛错行为 */
let initSettled = false;

vi.mock("pixi.js", () => {
  class FakeContainer {
    children: unknown[] = [];
    addChild(...kids: unknown[]) {
      this.children.push(...kids);
      return kids[0];
    }
    removeChild() {}
    destroy() {}
    scale = { set: vi.fn() };
    position = { set: vi.fn() };
  }

  class FakeSprite extends FakeContainer {
    anchor = { set: vi.fn() };
    width = 0;
    height = 0;
    rotation = 0;
    texture: unknown = null;
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
    init = vi.fn(async () => {
      // 模拟 await autoDetectRenderer()：此刻插件字段（_cancelResize）尚不存在
      await initDeferred.promise;
      initSettled = true;
    });
    destroy = vi.fn(() => {
      // 复刻 ResizePlugin.destroy() 在插件未 init 时的崩溃
      if (!initSettled) {
        throw new TypeError("this._cancelResize is not a function");
      }
    });
    constructor() {
      apps.push(this as unknown as FakeApp);
    }
  }

  const initDeferred = createDeferred<void>();
  // 暴露给测试，用于放行 init
  (globalThis as Record<string, unknown>).__releaseInit = () => initDeferred.resolve();

  const Texture = { EMPTY: Symbol("empty") };
  return { Application, Container: FakeContainer, Sprite: FakeSprite, Graphics: FakeGraphics, Texture };
});

// 依赖 mock 之后再导入被测组件
import MapCanvas from "./index";
import type { MapDocument } from "../../types";

function makeDoc(): MapDocument {
  return { version: 1, baseImageId: "base-1", elements: [] };
}

const noop = () => {};

function renderCanvas(strict: boolean) {
  const tree = (
    <div style={{ width: 800, height: 600 }}>
      <MapCanvas
        doc={makeDoc()}
        viewport={{ x: 0, y: 0, scale: 1 }}
        textures={{}}
        texturesReady={false}
        selectedId={null}
        pendingSpriteId={null}
        onSizeChange={noop}
        onWheel={noop}
        onPan={noop}
        onCanvasClickWorld={noop}
        onElementDragStart={noop}
        onElementDragDelta={noop}
      />
    </div>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

function releaseInit() {
  (globalThis as unknown as { __releaseInit: () => void }).__releaseInit();
}

beforeEach(() => {
  apps = [];
  initSettled = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MapCanvas Pixi 生命周期", () => {
  it("StrictMode 双挂载：init 未完成时卸载不得调用 destroy（回归 _cancelResize）", async () => {
    const { unmount } = renderCanvas(true);

    // 此刻 init 仍挂在 await 上（未 release）——对应 StrictMode 第一次卸载的时机
    expect(apps.length).toBeGreaterThan(0);
    for (const app of apps) {
      // 若修复失效，cleanup 会在 init settle 前调 destroy → 触发 TypeError
      expect(app.destroy).not.toHaveBeenCalled();
    }

    // 卸载（模拟 StrictMode 的第一次 cleanup）
    expect(() => unmount()).not.toThrow();

    // 未完成 init 的实例仍不得被 destroy
    for (const app of apps) {
      expect(app.destroy).not.toHaveBeenCalled();
    }

    // 放行 init：修复逻辑应在此刻自行销毁被弃用的实例
    releaseInit();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // 至少有一个实例被销毁（被卸载的那个），且全程无异常
    expect(apps.some((a) => a.destroy.mock.calls.length > 0)).toBe(true);
  });

  it("init 已完成后再卸载：destroy 正常调用一次", async () => {
    const { unmount } = renderCanvas(false);

    // 放行 init 并等待 effect 内的建图逻辑跑完
    releaseInit();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(apps.length).toBeGreaterThan(0);
    const app = apps[0];

    unmount();
    // 此时 initDone 为真，cleanup 应直接销毁
    expect(app.destroy).toHaveBeenCalledTimes(1);
  });
});
