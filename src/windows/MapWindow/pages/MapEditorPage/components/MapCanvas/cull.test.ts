import { describe, expect, it } from "vitest";
import {
  CULL_MARGIN,
  createCullCache,
  cullLayers,
  isBoundsVisible,
  rectsIntersect,
  screenCullRect,
  type CullRect,
} from "./cull";
import type { Container } from "pixi.js";

/**
 * 视口粗剔除的纯函数测试（B5 / PRD §6.6.1）。
 *
 * 剔除的两种失败都不报错：
 *   · 剔多了 → 该显示的内容凭空消失，用户以为"数据丢了"；
 *   · 剔少了 → 什么也看不出来，只是白算。
 * 所以这里的断言以"**不该剔的绝不剔**"为主，而不是"剔得有多干净"。
 *
 * `cull.ts` 只 `import type { Container }`，运行期不碰 pixi —— 因此本文件
 * 不需要 mock，替身容器按鸭子类型造即可。
 */

/** 造一个只提供剔除所需能力的假容器（记录局部/舞台两种包围盒各被算了几次） */
function fakeNode(bounds: CullRect) {
  const node = {
    visible: true,
    /** `getLocalBounds()` 被调的次数 —— 这才是现在会被缓存的量 */
    localCalls: 0,
    /** `getBounds()` 被调的次数 —— 修复后应该恒为 0（它不能被缓存） */
    calls: 0,
    /** 恒等变换的容器：局部空间 == 舞台空间，两者数值相同 */
    getLocalBounds() {
      node.localCalls += 1;
      return bounds;
    },
    toGlobal(point: { x: number; y: number }) {
      return { x: point.x, y: point.y };
    },
    getBounds() {
      node.calls += 1;
      return bounds;
    },
  };
  return node as typeof node & Container;
}

/**
 * 模拟"真实 pixi 容器"的替身：**包围盒随视口变化**。
 *
 * 【为什么需要它】真实 pixi 的 `getBounds()` 返回的是**舞台空间**包围盒
 * （父级变换已乘进去），所以同一份内容在不同视口下会得到不同的数值；而
 * `getLocalBounds()` 是局部空间、与视口无关。剔除缓存的正确性完全取决于
 * "缓存的到底是哪一个" —— 一个 `getBounds()` 恒返回定值的替身**测不出**
 * 这个区别（那正是 S-1 当初漏过去的原因）。
 */
const view = { tx: 0, ty: 0, scale: 1 };

function viewportAwareNode() {
  /** 固定的局部包围盒：内容没变，它就一直是这样 */
  const local: CullRect = { minX: -100, minY: -100, maxX: 100, maxY: 100 };
  const apply = (x: number, y: number) => ({
    x: x * view.scale + view.tx,
    y: y * view.scale + view.ty,
  });
  const node = {
    visible: true,
    getLocalBounds() {
      return local;
    },
    toGlobal(point: { x: number; y: number }) {
      return apply(point.x, point.y);
    },
    getBounds() {
      // 复刻 pixi：舞台空间，随视口变
      const a = apply(local.minX, local.minY);
      const b = apply(local.maxX, local.maxY);
      return {
        minX: Math.min(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxX: Math.max(a.x, b.x),
        maxY: Math.max(a.y, b.y),
      };
    },
  };
  return node as typeof node & Container;
}

describe("rectsIntersect", () => {
  const view: CullRect = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

  it("完全在视野内 → 相交", () => {
    expect(rectsIntersect({ minX: 10, minY: 10, maxX: 50, maxY: 50 }, view)).toBe(true);
  });

  it("部分重叠 → 相交（跨出边缘也算）", () => {
    expect(rectsIntersect({ minX: 80, minY: 80, maxX: 300, maxY: 300 }, view)).toBe(true);
    expect(rectsIntersect({ minX: -50, minY: -50, maxX: 10, maxY: 10 }, view)).toBe(true);
  });

  it("完全在外 → 不相交", () => {
    expect(rectsIntersect({ minX: 200, minY: 200, maxX: 300, maxY: 300 }, view)).toBe(false);
    expect(rectsIntersect({ minX: -300, minY: -300, maxX: -200, maxY: -200 }, view)).toBe(false);
    // 一条轴重叠、另一条完全错开
    expect(rectsIntersect({ minX: 10, minY: 200, maxX: 50, maxY: 300 }, view)).toBe(false);
  });

  it("共边算相交（贴着视野边缘的内容不该被裁掉）", () => {
    expect(rectsIntersect({ minX: 100, minY: 0, maxX: 200, maxY: 100 }, view)).toBe(true);
    expect(rectsIntersect({ minX: -100, minY: 0, maxX: 0, maxY: 100 }, view)).toBe(true);
  });
});

describe("screenCullRect", () => {
  it("外扩量按缩放折算（世界单位 × 当前缩放 = 像素）", () => {
    const size = { width: 800, height: 600 };
    const at1 = screenCullRect(size, { x: 0, y: 0, scale: 1 });
    expect(at1).toEqual({
      minX: -CULL_MARGIN,
      minY: -CULL_MARGIN,
      maxX: 800 + CULL_MARGIN,
      maxY: 600 + CULL_MARGIN,
    });

    // 放到 4 倍：同样的 64 世界单位 = 256 像素
    const at4 = screenCullRect(size, { x: 0, y: 0, scale: 4 });
    expect(at4.minX).toBe(-256);
    expect(at4.maxX).toBe(800 + 256);

    // 缩到 25%：只剩 16 像素（外扩跟着缩放变小，才不会把远处的内容也算进来）
    const at025 = screenCullRect(size, { x: 0, y: 0, scale: 0.25 });
    expect(at025.minY).toBe(-16);
  });

  it("缩放为 0 / 负数时不产生 Infinity（用 1e-6 兜底）", () => {
    const rect = screenCullRect({ width: 10, height: 10 }, { x: 0, y: 0, scale: 0 });
    expect(Number.isFinite(rect.minX)).toBe(true);
    expect(Number.isFinite(rect.maxY)).toBe(true);
  });
});

describe("isBoundsVisible", () => {
  const view: CullRect = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

  it("视野外的容器判不可见", () => {
    expect(isBoundsVisible(fakeNode({ minX: 500, minY: 500, maxX: 600, maxY: 600 }), view)).toBe(
      false,
    );
  });

  it("NaN / Infinity 一律判**可见**（宁可多画一层，也不能把整层藏掉）", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(isBoundsVisible(fakeNode({ minX: bad, minY: 0, maxX: 10, maxY: 10 }), view)).toBe(true);
    }
  });
});

describe("cullLayers", () => {
  const view: CullRect = { minX: 0, minY: 0, maxX: 100, maxY: 100 };

  it("逐个写 visible：在视野内的留 true，在外的置 false", () => {
    const inside = fakeNode({ minX: 10, minY: 10, maxX: 20, maxY: 20 });
    const outside = fakeNode({ minX: 900, minY: 900, maxX: 950, maxY: 950 });
    cullLayers([inside, outside], view);
    expect(inside.visible).toBe(true);
    expect(outside.visible).toBe(false);

    // 反向再跑一次：可见性必须能恢复（拖回来就该重新出现）
    cullLayers([inside, outside], { minX: 880, minY: 880, maxX: 1000, maxY: 1000 });
    expect(outside.visible).toBe(true);
  });

  it("null / undefined 直接跳过（层级容器还没建时不炸）", () => {
    expect(() => cullLayers([null, undefined], view)).not.toThrow();
  });

  it("同一次剔除里每个容器只算一次局部包围盒，且**从不**问舞台包围盒", () => {
    const node = fakeNode({ minX: 10, minY: 10, maxX: 20, maxY: 20 });
    cullLayers([node], view);
    expect(node.localCalls).toBe(1);
    // `getBounds()` 是舞台空间、随视口变 —— 它一旦被调，就有被缓存的风险
    expect(node.calls).toBe(0);
  });

  it("命中缓存就不再算局部包围盒（视口变化时复用上一轮的结果）", () => {
    const node = fakeNode({ minX: 10, minY: 10, maxX: 20, maxY: 20 });
    const cache = createCullCache();

    cullLayers([node], view, cache);
    expect(node.localCalls).toBe(1);

    // 视口变了、内容没变：局部包围盒必然一样，不该再算一遍
    cullLayers([node], { minX: 5, minY: 5, maxX: 90, maxY: 90 }, cache);
    expect(node.localCalls).toBe(1);

    // 内容变了（外部清表）→ 必须重算，否则会把搬走了的层判成还在
    cache.clear();
    cullLayers([node], view, cache);
    expect(node.localCalls).toBe(2);
  });

  it("命中缓存的容器仍会按新的视野重新判定可见性", () => {
    const node = fakeNode({ minX: 10, minY: 10, maxX: 20, maxY: 20 });
    const cache = createCullCache();
    cullLayers([node], view, cache);
    expect(node.visible).toBe(true);

    cullLayers([node], { minX: 500, minY: 500, maxX: 600, maxY: 600 }, cache);
    expect(node.visible).toBe(false);
    // 局部包围盒来自缓存（只算过一次），但判定用的是新视野
    expect(node.localCalls).toBe(1);
  });
});

/**
 * 回归：S-1「把**舞台空间**的包围盒跨视口缓存了」。
 *
 * 【故障链】`getBounds()` 返回的是父级变换已乘进去的包围盒（pixi 文档明写
 * "For world space bounds"），它**随视口变化**；而缓存只按"内容引用变没变"
 * 失效，视口变化一律不清 → 缩走时算出的旧矩形被拿去和新视野比 → `visible=false`
 * 且再缩回来仍然命中旧缓存 → **整层永久隐身**，直到下一次内容变更才自愈。
 * 表现是"偶发、时好时坏"，最容易被当成 flake 放过去。
 *
 * 【为什么这条用例能抓住它】替身复刻了真实 pixi 的关键性质：同一份内容在
 * 不同视口下 `getBounds()` 给出不同数值，而 `getLocalBounds()` 恒定。
 * 用"包围盒恒为定值"的替身是测不出这个 bug 的。
 */
describe("回归 S-1：缓存不得跨视口复用舞台包围盒", () => {
  const viewRect: CullRect = { minX: 0, minY: 0, maxX: 200, maxY: 200 };

  it("视口把内容推到屏幕外 → 移回来必须重新可见（缓存不能钉住旧结果）", () => {
    const node = viewportAwareNode();
    const cache = createCullCache();

    // 视口 A：内容（局部 -100..100）被平移到屏幕外
    view.tx = -5000;
    view.ty = -5000;
    expect(isBoundsVisible(node, viewRect, cache)).toBe(false);

    // 视口 B：容器与内容一个字都没改，只有视口动了
    view.tx = 0;
    view.ty = 0;
    expect(isBoundsVisible(node, viewRect, cache)).toBe(true);

    view.tx = 0;
    view.ty = 0;
    view.scale = 1;
  });

  it("视口缩得很小（内容被推出视野）→ 恢复缩放后必须重新可见", () => {
    const node = viewportAwareNode();
    const cache = createCullCache();

    // 放大 100 倍：局部 ±100 变成舞台 ±10000，中心点跑到屏幕外
    view.scale = 100;
    view.tx = -100000;
    view.ty = -100000;
    expect(isBoundsVisible(node, viewRect, cache)).toBe(false);

    view.scale = 1;
    view.tx = 0;
    view.ty = 0;
    expect(isBoundsVisible(node, viewRect, cache)).toBe(true);
  });
});
