import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fitSubmapTransform, type CanvasSize } from "../coords";

import { useMapEditor } from "./useMapEditor";
import { elementSizeFactor, resolveElementLevel } from "../lod";
import { generateLand } from "../land";
import { useMapDocStore } from "../store/useMapDocStore";
import { BASE_BOUNDS } from "../store/useMapViewportStore";
import { useMapSelectionStore } from "../store/useMapSelectionStore";
import { resetMapStores } from "../store/reset";
import type { MapRegion, Point } from "../regions";

/** 子图用例的固定陆地 seed（让区块形状可复现，见 `carveSubmap` 用例里的注释） */
const SUBMAP_LAND_SEED = 1;

/**
 * `useMapEditor` 的状态机单测（目前只覆盖 `setStyle` 的同值守卫）。
 *
 * ── 为什么这条不能只在页面上测 ──
 * 页面级的第一反应是「选一次羊皮纸 → 再点一次羊皮纸 → 按一次撤销看回不回原色」。
 * 这条路**测不到我们的守卫**：antd/rc-select 对"重选同值"常常根本不发
 * `onChange`（它自己就短路了），于是把 `if (next === doc.style) return;`
 * 整行删掉，页面用例照样绿 —— 那是在测 antd 的行为，不是测我们的代码。
 *
 * 所以这里直接对 hook 下手：绕过 UI 层，连调三次 `setStyle("parchment")`，
 * 只断言**撤销栈深度**。删掉守卫 → 压三步 → 撤销一次还停在羊皮纸 → 红。
 */

const SIZE: CanvasSize = { width: 800, height: 600 };

// 三个 store 是模块级单例，必须在每个用例前显式复位（对齐 useNovelEditorStore.test）
beforeEach(() => {
  resetMapStores();
});

afterEach(cleanup);

describe("useMapEditor · setStyle 的同值守卫", () => {
  /**
   * PRD §6.4 的落地约束：风格进撤销栈，但**同值不压步**。
   *
   * 【为什么同值压步是缺陷而不是洁癖】`commit` 是无条件记账的：每压一步，用户
   * 就要多按一次 Ctrl+Z 才能退到真正的上一态，而中间那几步画面**完全不动**。
   * 连按三次撤销还在原地，用户会判断"撤销坏了"，比没有撤销更糟。
   */
  it("同值重复调用只压一步撤销（删掉守卫必然变红）", () => {
    const { result } = renderHook(() => useMapEditor(SIZE));

    expect(result.current.doc.style).toBe("none");
    expect(result.current.canUndo).toBe(false);

    act(() => result.current.setStyle("parchment"));
    expect(result.current.doc.style).toBe("parchment");
    expect(result.current.canUndo).toBe(true);

    // 同值再来两次 —— 守卫必须把这两次吃掉
    act(() => result.current.setStyle("parchment"));
    act(() => result.current.setStyle("parchment"));
    expect(result.current.doc.style).toBe("parchment");

    // 【这条断言就是变异检查的靶心】总共只压了 1 步：撤销一次就回到原色，
    // 且撤销栈随之清空。若守卫被删，这里会停在 "parchment"（压了 3 步）。
    act(() => result.current.undo());
    expect(result.current.doc.style).toBe("none");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  /**
   * 反向对照：**不同值**必须真的压步，且每一步都能独立退掉。
   *
   * 只有上一条"同值不压步"时，一个恒不提交的实现也能通过 —— 这条把
   * "守卫吃过界"（把所有调用都 return 掉）这种错误实现钉死。
   */
  it("不同值每次都压步：原色 → 羊皮纸 → 墨色，撤销两次逐级退回", () => {
    const { result } = renderHook(() => useMapEditor(SIZE));

    act(() => result.current.setStyle("parchment"));
    act(() => result.current.setStyle("ink"));
    expect(result.current.doc.style).toBe("ink");

    act(() => result.current.undo());
    expect(result.current.doc.style).toBe("parchment");
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.doc.style).toBe("none");
    expect(result.current.canUndo).toBe(false);
  });
});

describe("useMapEditor · generateLand（R-REG-02：生成陆地默认不连带分区）", () => {
  /**
   * 【这条钉的是"默认不划分"这个产品裁决】PRD 需求①的病根不在生成算法，
   * 而在入口：点「生成陆地」时区块被**连带**切了出来。数据层与渲染层早已支持
   * `regions = []`（`createEmptyDocument()` 初始就是空数组），缺的只是一个出口。
   */
  it("generateLand：splitRegions 为假 / 缺省时 regions 为空，land 正常生成", () => {
    const { result } = renderHook(() => useMapEditor(SIZE));

    act(() => result.current.generateLand(42, { splitRegions: false }));
    expect(result.current.doc.land).not.toBeNull();
    expect(result.current.doc.land?.seed).toBe(42);
    expect(result.current.doc.regions).toHaveLength(0);

    // 不传 options 与 `{splitRegions:false}` 等价 —— 缺省就是"不分区"
    act(() => result.current.generateLand(43));
    expect(result.current.doc.land?.seed).toBe(43);
    expect(result.current.doc.regions).toHaveLength(0);
  });

  /**
   * 【回归等价】勾选后必须与改前完全一致：陆地内逐岛切分、多岛加权分配数量。
   * 断言用"同种子两次调用深比较相等"（确定性的可执行版本）+ 一次撤销步
   * （陆地与区块是同一个 commit，撤销一步一起回退）。
   */
  it(
    "generateLand：splitRegions 为真时在陆地内切分，同种子结果逐点相等且一步撤销",
    () => {
      const { result } = renderHook(() => useMapEditor(SIZE));

      act(() => result.current.generateLand(42, { splitRegions: true }));
      const first = result.current.doc.regions;
      expect(first.length).toBeGreaterThan(0);
      expect(result.current.doc.land).not.toBeNull();

      // 同种子重跑一遍：全部顶点浮点值必须逐点相同（否则"重新生成"不可复现）
      act(() => result.current.generateLand(42, { splitRegions: true }));
      expect(result.current.doc.regions).toEqual(first);

      // 陆地 + 区块在同一个 commit 里：撤销一步必须两样一起回退
      // （第一次撤销回到"上一次生成"的状态：陆地与区块都还在，且区块与 first 相等）
      act(() => result.current.undo());
      expect(result.current.doc.land).not.toBeNull();
      expect(result.current.doc.regions).toEqual(first);
      // 再撤一步：第一次生成也一起回退
      act(() => result.current.undo());
      expect(result.current.doc.land).toBeNull();
      expect(result.current.doc.regions).toHaveLength(0);
    },
    60000,
  );

  it("generateLand 不再接受旧的 levelCount 第二参（签名已改为 options 对象）", () => {
    const { result } = renderHook(() => useMapEditor(SIZE));
    // 运行时传一个数字：`options?.splitRegions` 为 undefined ⇒ 走"不分区"，且不报错。
    // 类型层面已由 TS 拦住（这里用 as never 模拟历史调用），行为必须可预测而非崩溃。
    act(() => {
      result.current.generateLand(7, 3 as never);
    });
    expect(result.current.doc.land?.seed).toBe(7);
    expect(result.current.doc.regions).toHaveLength(0);
  });
});

describe("useMapEditor · 嵌套子地图（embedSubmap / carveSubmap / removeSubmap）", () => {
  it("carveSubmap：圈定区块后，该区块挂上现场生成的子图，且可撤销", () => {
    const { result } = renderHook(() => useMapEditor(SIZE));

    // 先生成一棵区块树（level 2：国家/郡），拿到一个可圈定的区块
    act(() => result.current.regenerateHierarchy(2));
    const target = result.current.doc.regions[0];
    expect(target).toBeTruthy();
    expect(target.submap).toBeUndefined();

    act(() => result.current.carveSubmap(target.id, 1));
    const carved = result.current.doc.regions.find((r) => r.id === target.id);
    expect(carved?.submap).toBeTruthy();
    expect(carved?.submap?.regions.length).toBeGreaterThan(0); // 现场生成了子图区块
    expect(carved?.submap?.style).toBe(result.current.doc.style); // 继承父图风格
    expect(carved?.submapEnterScale).toBeDefined(); // 自动反推了渐入阈值

    // 撤销一次 → 子图被移除，区块恢复原状
    act(() => result.current.undo());
    const restored = result.current.doc.regions.find((r) => r.id === target.id);
    expect(restored?.submap).toBeUndefined();
  });

  it("focusRegion：把视口推进到该区块，且缩放不低于子图渐入阈值", () => {
    const { result } = renderHook(() => useMapEditor(SIZE));
    act(() => result.current.regenerateHierarchy(2));
    const target = result.current.doc.regions[0];

    act(() => result.current.carveSubmap(target.id, 1));
    const carved = result.current.doc.regions.find((r) => r.id === target.id);

    const before = result.current.viewport;
    act(() => result.current.focusRegion(target.id));
    const after = result.current.viewport;

    // 视口必须动（否则"圈定生成后看不到任何变化"，用户会以为按钮没反应）
    expect(after).not.toEqual(before);
    // 视口中心落到该区块的包围盒中心附近（世界坐标）
    const xs = target.polygon.map((p) => p.x);
    const ys = target.polygon.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    expect(after.x).toBeCloseTo(cx, 3);
    expect(after.y).toBeCloseTo(cy, 3);
    // 关键：推进后的缩放要足以让子图淡入，否则"进入"了却看不见子图
    expect(after.scale).toBeGreaterThanOrEqual(carved?.submapEnterScale ?? 0);
  });

  it("carveSubmap：子图分区用「子图本地坐标」，映射回父图世界后与区块重合", () => {
    // 【这条守的是一个"只在画面上看得出来、测试不报错"的缺陷】
    // `MapSubmap.bounds` 的约定是子图本地坐标，渲染时会做
    // `世界 = 本地 × scale + 区块包围盒中心`。如果生成时直接用父图世界坐标，
    // 渲染就会再平移一次中心 —— 子图整体偏出区块，且**没有任何报错**。
    //
    // 【为什么断言包围盒而不是逐顶点】`generateHierarchy` 的区块边界会做崎岖化，
    // 实测有 0.09% 的顶点微越出父容器（最大 3 世界单位），逐顶点断言会假红。
    // 但整体包围盒的中心是刚性的：一旦坐标域搞错，它就会整体偏移一个区块半径。
    const { result } = renderHook(() => useMapEditor(SIZE));
    /**
     * 【先钉一块 land：这条用例以前是**随机**的】`buildRegions(null, …)` 走
     * `land.seed ?? Math.random()`，于是每次跑出来的区块形状都不同。层级从四级
     * 砍成三级后，子图首级的数量由 3 变 20（`carveSubmap` 沿用父 schema 的
     * `count`），退化格被丢掉的概率随之变大 —— 实测偶发出现 21 单位的偏移
     * （某个角落的小格被判定退化后剔除，并集包围盒缩了一角），与本条要守的
     * "坐标域"无关。固定 land 之后形状可复现，探针实测 5 个 seed 的偏移都 ≤ 2.3。
     */
    act(() => {
      useMapDocStore.setState((s) => ({
        doc: { ...s.doc, land: generateLand({ seed: SUBMAP_LAND_SEED, bounds: BASE_BOUNDS }) },
      }));
    });
    act(() => result.current.regenerateHierarchy());
    // 【2.42.0】区域只有国家一级：在 level-0 国家上圈子图。坐标域不变式不变 ——
    // 子图分区必须在「子图本地坐标」里生成。
    const found = result.current.doc.regions.find(
      (r) => Math.abs(r.seed.x) + Math.abs(r.seed.y) > 50,
    );
    expect(found).toBeTruthy();
    // 上面已断言非空，这里收窄类型（避免整段用 `!`）
    const target = found!;

    act(() => result.current.carveSubmap(target.id, 1));
    const carved = result.current.doc.regions.find((r) => r.id === target.id);
    const submap = carved?.submap;
    expect(submap).toBeTruthy();

    const xs = target.polygon.map((p) => p.x);
    const ys = target.polygon.map((p) => p.y);
    const worldRect = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
    const fit = fitSubmapTransform(submap!.bounds, worldRect);

    // 子图全部分区的并集包围盒（子图本地坐标）→ 映射回父图世界
    const all = submap!.regions.flatMap((r) => r.polygon);
    expect(all.length).toBeGreaterThan(0);
    const lx = all.map((p) => p.x);
    const ly = all.map((p) => p.y);
    const localMinX = Math.min(...lx);
    const localMinY = Math.min(...ly);
    const localW = Math.max(...lx) - localMinX;
    const localH = Math.max(...ly) - localMinY;

    const mappedMinX = localMinX * fit.scale + fit.x;
    const mappedMinY = localMinY * fit.scale + fit.y;
    const mappedCx = mappedMinX + (localW * fit.scale) / 2;
    const mappedCy = mappedMinY + (localH * fit.scale) / 2;

    // 中心必须与区块包围盒中心重合（坐标域搞错时这里会差半个区块 —— 几十单位）。
    // 贴岸口径（越湾修复）下区块多边形沿海岸绕行，分区裁剪质心与包围盒中心
    // 允许 ≤ 8 单位的偏移：① 崎岖化会让边缘格略缩进；② 子图首级 20 格时偶尔有一个
    // 退化角落格被剔除。两者都远小于"半个区块"（本用例的块约 150~200 宽）。
    expect(Math.abs(mappedCx - (worldRect.x + worldRect.width / 2))).toBeLessThan(8);
    expect(Math.abs(mappedCy - (worldRect.y + worldRect.height / 2))).toBeLessThan(8);
    // 尺寸同量级（分区被裁在多边形内，允许略小于包围盒）
    expect(localW * fit.scale).toBeGreaterThan(worldRect.width * 0.6);
    expect(localH * fit.scale).toBeGreaterThan(worldRect.height * 0.6);
  });

  it("embedSubmap：把一张已有子图绑定到区块（路径 A）", () => {
    const { result } = renderHook(() => useMapEditor(SIZE));
    act(() => result.current.regenerateHierarchy(1));
    const target = result.current.doc.regions[0];

    const externalSubmap = {
      id: "sm_external_1",
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      land: null,
      regions: [],
      elements: [],
      labels: [],
      style: "parchment" as const,
      baseImageId: "base-1",
    };

    act(() => result.current.embedSubmap(target.id, externalSubmap));
    const bound = result.current.doc.regions.find((r) => r.id === target.id);
    expect(bound?.submap?.id).toBe("sm_external_1");
    expect(bound?.submap?.style).toBe("parchment");
  });

  it("removeSubmap：剥离子图后区块恢复为普通区块（submap 与 enterScale 一起清掉）", () => {
    const { result } = renderHook(() => useMapEditor(SIZE));
    act(() => result.current.regenerateHierarchy(1));
    const target = result.current.doc.regions[0];

    act(() => result.current.carveSubmap(target.id, 1));
    expect(result.current.doc.regions.find((r) => r.id === target.id)?.submap).toBeTruthy();

    act(() => result.current.removeSubmap(target.id));
    const removed = result.current.doc.regions.find((r) => r.id === target.id);
    expect(removed?.submap).toBeUndefined();
    expect(removed?.submapEnterScale).toBeUndefined();
  });

  it("carveSubmap 对不存在的区块 / 无多边形区块静默（不报错、不产生子图）", () => {
    const { result } = renderHook(() => useMapEditor(SIZE));
    const before = result.current.doc.regions.length;

    act(() => result.current.carveSubmap("nonexistent", 1));
    expect(result.current.doc.regions.length).toBe(before);
    expect(result.current.canUndo).toBe(false); // 没有 commit 任何东西
  });
});

/**
 * 合并子树（R-REG-04 / PRD §6-C）。
 *
 * 【为什么在 hook 层测计数而不只在 store 层】页面拿 `removed` 拼提示语
 * （"已合并 N 个子区块（可撤销）"），这个数必须与"真的从文档里消失的块数"一致。
 * store 自己会再算一遍计划，所以这条是"两层算出来的数没有打架"的证明。
 */
describe("useMapEditor · mergeSubtree（合并子树）", () => {
  /** 生成一棵 2 级树（12 国家 + 60 郡 = 72 块），返回一个国家 */
  /**
   * 手工合成的两级树（1 父 + 2 子）。
   *
   * 【2.42.0】生成器只出国家一级，「合并子区域」在产品层已无自然入口；
   * 它是**数据层能力**（老文档 / 存量树仍要能合并），这里直接灌一份
   * 合成的两级 regions 驱动用例，不经过生成器。
   */
  function withTwoLevels() {
    const { result } = renderHook(() => useMapEditor(SIZE));
    const root: MapRegion = {
      id: "root1",
      parentId: null,
      level: 0,
      name: "国家 1",
      seed: { x: 0, y: 0 },
      polygon: [
        { x: -100, y: -100 },
        { x: 100, y: -100 },
        { x: 100, y: 100 },
        { x: -100, y: 100 },
      ],
      color: 0x334455,
    };
    const child = (id: string, cx: number): MapRegion => ({
      id,
      parentId: "root1",
      level: 1,
      name: `子块 ${id}`,
      seed: { x: cx, y: 0 },
      polygon: [
        { x: cx - 50, y: -100 },
        { x: cx + 50, y: -100 },
        { x: cx + 50, y: 100 },
        { x: cx - 50, y: 100 },
      ],
      color: 0x445566,
    });
    act(() =>
      useMapDocStore.getState().regenerateHierarchy([root, child("c1", -50), child("c2", 50)]),
    );
    const seeded = result.current.doc.regions.find((r) => r.id === "root1");
    expect(seeded).toBeTruthy();
    return { result, root: seeded! };
  }

  it("删掉全部后代（含孙），root 自身字段与 polygon 逐点不变，一次撤销回全树", () => {
    const { result, root } = withTwoLevels();
    const treeBefore = result.current.doc.regions;
    expect(treeBefore.length).toBe(3);

    let merged: { removed: number; withSubmap: number } = { removed: -1, withSubmap: -1 };
    act(() => {
      merged = result.current.mergeSubtree(root.id);
    });

    // 两个子块全部消失
    expect(merged.removed).toBe(2);
    expect(merged.withSubmap).toBe(0);
    expect(result.current.doc.regions).toHaveLength(treeBefore.length - merged.removed);
    expect(result.current.doc.regions.some((r) => r.parentId === root.id)).toBe(false);

    // root 原样保留：深比较相等即"polygon 逐点不变"（合并不重贴合）
    const kept = result.current.doc.regions.find((r) => r.id === root.id);
    expect(kept).toEqual(root);
    expect(kept!.polygon).toEqual(root.polygon);
    expect(kept!.polygon).toHaveLength(root.polygon.length);

    // 一次撤销：整棵树回来（合并只压一步快照）
    act(() => result.current.undo());
    expect(result.current.doc.regions).toHaveLength(treeBefore.length);
    expect(result.current.doc.regions).toEqual(treeBefore);
  });

  it("叶子：返回 0 且不产生快照（撤销栈深度不变）", () => {
    const { result, root } = withTwoLevels();
    const leaf = result.current.doc.regions.find((r) => r.parentId === root.id);
    expect(leaf).toBeTruthy();
    // 【层级关闭后的口径】单级生成图里不再有叶子以外的层级；本用例钉的是
    // 「对没有后代的块合并 = 空操作」这条数据层契约。

    const depthBefore = useMapDocStore.getState().undoStack.length;
    let merged: { removed: number; withSubmap: number } = { removed: -1, withSubmap: -1 };
    act(() => {
      merged = result.current.mergeSubtree(leaf!.id);
    });

    expect(merged).toEqual({ removed: 0, withSubmap: 0 });
    expect(useMapDocStore.getState().undoStack.length).toBe(depthBefore);
  });

  it("id 不存在 / 脏数据（悬空 parentId）不抛错", () => {
    const { result, root } = withTwoLevels();

    expect(() => {
      act(() => result.current.mergeSubtree("nope"));
    }).not.toThrow();

    // 人为制造悬空 parentId：让 root 自己指着一个不存在的父
    act(() => {
      useMapDocStore.setState((s) => ({
        doc: {
          ...s.doc,
          regions: s.doc.regions.map((r) => (r.id === root.id ? { ...r, parentId: "ghost" } : r)),
        },
      }));
    });
    // 悬空 parentId 按顶层处理（`buildRegionChildIndex` 归一），后代照样找得到、不崩
    expect(() => {
      act(() => result.current.mergeSubtree(root.id));
    }).not.toThrow();
  });

  it("§6-4：合并让最深层级消失 ⇒ levelAlphas 变短，该级素材被 clamp 跳一档（既有行为）", () => {
    const { result } = withTwoLevels();
    // 合成的两级树（1 父 + 2 子）⇒ levelCountsOf = [1, 2] ⇒ 两级权重
    expect(result.current.levelAlphas).toHaveLength(2);

    // 全合并掉：只剩 level 0
    const roots = result.current.doc.regions.filter((r) => r.level === 0);
    expect(roots).toHaveLength(1);
    act(() => {
      for (const r of roots) result.current.mergeSubtree(r.id);
    });
    expect(result.current.doc.regions.every((r) => r.level === 0)).toBe(true);

    // 层级数量的**事实源**仍是 `levelCountsOf(regions)`（lod.ts 没动）
    expect(result.current.levelAlphas).toHaveLength(1);

    // 素材侧的可测后果：level=1 的素材在 1 级图里被 clamp 到 0，尺寸因子跳一档
    // （`ELEMENT_SIZE_PER_LEVEL = 0.5`：级别越深画得越小；clamp 到 0 后放大约 2 倍）。
    // ⚠️ 这是**预期行为**，不是 bug（架构 §6-4 / PRD §7-R3）：不许改 lod.ts 去"修"
    expect(resolveElementLevel(1, 1)).toBe(0);
    expect(resolveElementLevel(1, 2)).toBe(1);
    expect(elementSizeFactor(1, 1) / elementSizeFactor(1, 2)).toBeCloseTo(2, 6);
  });
});

/**
 * 手画落库（R-REG-03 / `addManualRegion`）。
 *
 * ── 为什么四条用例都在 hook 层 ──
 * 页面级只能验"入口与文案"（一次 render 就要几秒），而校验的**判定**全在
 * `checkManualRegion`（纯函数，T1 已逐码覆盖）。这里要钉的是两者之间的**编排**：
 * `level` / `parentId` 从哪来、`origin` 写没写、失败到底压没压快照。
 * 这三件事各错一次都会"看起来能用"：level 错了高亮分级就错、parentId 错了合并
 * 会漏删、失败压了快照会让用户多按一次 Ctrl+Z 才退掉一条根本没生效的编辑。
 */
describe("useMapEditor · addManualRegion（手画落库）", () => {
  /** 轴对齐正方形（顺时针），`size` 是半边长 */
  function square(cx: number, cy: number, half: number): Point[] {
    return [
      { x: cx - half, y: cy - half },
      { x: cx + half, y: cy - half },
      { x: cx + half, y: cy + half },
      { x: cx - half, y: cy + half },
    ];
  }

  /** 一块手摆的顶层区块（几何完全可控，不用去生成器里找"内点"） */
  function parentRegion(): MapRegion {
    return {
      id: "p1",
      parentId: null,
      level: 0,
      name: "国家 1",
      seed: { x: 0, y: 0 },
      polygon: square(0, 0, 100),
      color: 0x334455,
    };
  }

  /** 直接把 regions 灌进文档（`regenerateHierarchy` 是唯一的写入口） */
  function seed(regions: MapRegion[]) {
    act(() => useMapDocStore.getState().regenerateHierarchy(regions));
  }

  it("未选中区块时手画：level=0、parentId=null、origin=manual，polygon 逐点相等", () => {
    const { result } = renderHook(() => useMapEditor(SIZE));
    seed([parentRegion()]);

    // 五边形（落 5 个点）：顶点数必须原样保留，不能被"简化/闭合"改写
    const drawn: Point[] = [
      { x: -400, y: -400 },
      { x: -300, y: -420 },
      { x: -280, y: -330 },
      { x: -360, y: -300 },
      { x: -420, y: -350 },
    ];
    act(() => {
      const r = result.current.addManualRegion(drawn);
      expect(r.ok).toBe(true);
    });

    const regions = result.current.doc.regions;
    expect(regions).toHaveLength(2);
    const created = regions[regions.length - 1];
    expect(created.origin).toBe("manual");
    expect(created.level).toBe(0);
    expect(created.parentId).toBeNull();
    expect(created.polygon).toHaveLength(5);
    expect(created.polygon).toEqual(drawn);
    // 名字来自 schema（默认第一级是"国家"）+ 同层序号
    expect(created.name).toBe("国家 2");
    // 种子是质心（"这块地的代表点"），不是随便一个顶点
    expect(created.seed.x).toBeGreaterThan(-420);
    expect(created.seed.x).toBeLessThan(-280);
  });

  /**
   * 【2.42.0】区域只有国家一级（层级功能关闭）：选中区块后手画不再产生子区域，
   * 落点前就被 `level-out-of-range` 拦下。原来的「选中后画子块」「跨出父边界」
   * 两条用例随之合并成这一条 —— 拦截必须**不压快照、不新增记录**。
   */
  it("层级已关闭：选中区块后手画 ⇒ level-out-of-range，不压快照、不新增记录", () => {
    const { result } = renderHook(() => useMapEditor(SIZE));
    seed([parentRegion()]);
    act(() => useMapSelectionStore.getState().setSelectedRegionId("p1"));

    const regionsBefore = useMapDocStore.getState().doc.regions;
    const depthBefore = useMapDocStore.getState().undoStack.length;

    let code: string | null = null;
    act(() => {
      const r = result.current.addManualRegion(square(0, 0, 20));
      if (!r.ok) code = r.code;
    });

    expect(code).toBe("level-out-of-range");
    expect(useMapDocStore.getState().doc.regions).toBe(regionsBefore);
    // 【变异检查的靶心】失败若也走 commit，用户按一次 Ctrl+Z 会"什么都没变"
    expect(useMapDocStore.getState().undoStack.length).toBe(depthBefore);
  });

  it("撤销一步整条消失；重做后 id 与 polygon 逐点不变", () => {
    const { result } = renderHook(() => useMapEditor(SIZE));
    seed([parentRegion()]);

    const drawn = square(-400, -400, 40);
    act(() => {
      result.current.addManualRegion(drawn);
    });
    expect(result.current.doc.regions).toHaveLength(2);
    const created = result.current.doc.regions[1];

    // 一次撤销：整块消失（落库是**一条**记录、**一次**快照）
    act(() => result.current.undo());
    expect(result.current.doc.regions).toHaveLength(1);
    expect(result.current.doc.regions.some((r) => r.id === created.id)).toBe(false);

    // 重做：对象引用原样回来 ⇒ id 与 polygon 必然逐点相同
    act(() => result.current.redo());
    const restored = result.current.doc.regions.find((r) => r.id === created.id);
    expect(restored).toBeTruthy();
    expect(restored!.polygon).toEqual(created.polygon);
    expect(restored!.id).toBe(created.id);
  });

  it("连续画两块：撤销栈压**两步**（不带合并键 —— 合并键会把三块压成一步）", () => {
    const { result } = renderHook(() => useMapEditor(SIZE));
    seed([parentRegion()]);
    const depthBefore = useMapDocStore.getState().undoStack.length;

    act(() => {
      result.current.addManualRegion(square(-400, -400, 40));
    });
    act(() => {
      result.current.addManualRegion(square(-300, -400, 40));
    });
    expect(result.current.doc.regions).toHaveLength(3);
    expect(useMapDocStore.getState().undoStack.length).toBe(depthBefore + 2);

    // 撤销一次只退掉**最后画的那块**
    act(() => result.current.undo());
    expect(result.current.doc.regions).toHaveLength(2);
  });

  it("重新生成区块不删手画块（kept 过滤生效）", () => {
    const { result } = renderHook(() => useMapEditor(SIZE));
    seed([parentRegion()]);
    act(() => {
      result.current.addManualRegion(square(-400, -400, 40));
    });
    const manual = result.current.doc.regions.find((r) => r.origin === "manual");
    expect(manual).toBeTruthy();

    // 单级自动树（12 国家）⇒ 加上手画的那块应共 13
    act(() => result.current.regenerateHierarchy());
    expect(result.current.doc.regions).toHaveLength(13);
    expect(result.current.doc.regions.some((r) => r.id === manual!.id)).toBe(true);
  });

  /**
   * 「生成陆地」同样只清自动块（PRD §8-Q4 / 主理人裁决 1）。
   *
   * 【为什么必须与「生成区块」分开测】两者的"保留手画块"是**两段独立的实现**
   * （`regenerateHierarchy` 与 `generateLand` 各有一处 `kept` 过滤）。上面那条只
   * 钉住了前者；把 `generateLand` 里的过滤删掉（`kept` 恒为空）不会有任何用例变红
   * —— 而用户一次「生成陆地」就会丢掉全部手画成果。
   */
  it("generateLand(splitRegions:false)：清空自动块、手画块原样保留", () => {
    const { result } = renderHook(() => useMapEditor(SIZE));
    seed([parentRegion()]); // 一块自动块（origin 缺省 = generated）
    act(() => {
      result.current.addManualRegion(square(-400, -400, 40));
    });
    expect(result.current.doc.regions).toHaveLength(2);
    const manual = result.current.doc.regions.find((r) => r.origin === "manual");
    expect(manual).toBeTruthy();

    act(() => result.current.generateLand(42, { splitRegions: false }));

    expect(result.current.doc.land).not.toBeNull();
    // 自动块全清、手画块原样保留（引用/几何都不变 —— 不是"重建了一个同名块"）
    expect(result.current.doc.regions).toHaveLength(1);
    expect(result.current.doc.regions[0].origin).toBe("manual");
    expect(result.current.doc.regions[0].id).toBe(manual!.id);
    expect(result.current.doc.regions[0].polygon).toEqual(manual!.polygon);
  });

  it("generateLand(splitRegions:true)：手画块 + 新自动块共存", () => {
    const { result } = renderHook(() => useMapEditor(SIZE));
    seed([parentRegion()]);
    act(() => {
      result.current.addManualRegion(square(-400, -400, 40));
    });
    const manual = result.current.doc.regions.find((r) => r.origin === "manual")!;

    act(() => result.current.generateLand(42, { splitRegions: true }));

    const regions = result.current.doc.regions;
    // 手画块仍在（按 id 命中）
    expect(regions.some((r) => r.id === manual.id)).toBe(true);
    // 且真的生成了新的自动块（不只是"什么都没生成"）
    expect(regions.some((r) => r.origin !== "manual")).toBe(true);
    expect(regions.length).toBeGreaterThan(1);
  });
});

/**
 * 素材层锁定（B4-1）：锁 = 命中测试跳过该层。
 *
 * 【为什么在 hook 层测】`pickElement` 是页面与画布共用的唯一命中出口
 * （画布用它判"按下要不要起拖"，页面用它判"点中了谁"）。锁定若只写在页面那个
 * 调用点上，画布那条路仍然能拖动被锁定的素材 —— 表现为"锁了还能拖"，
 * 而两个调用点看起来都"改过了"。
 */
describe("useMapEditor · 素材层锁定", () => {
  const HIT = { x: 100, y: 60 }; // mountain-19 的锚点在 (100,100)，尺寸 160×93

  function seedElement() {
    useMapDocStore.setState({
      doc: {
        ...useMapDocStore.getState().doc,
        elements: [
          { id: "el_x", spriteId: "mountain-19", x: 100, y: 100, scale: 1, rotation: 0, level: null },
        ],
      },
    });
  }

  it("未锁时点得中", () => {
    seedElement();
    const { result } = renderHook(() => useMapEditor(SIZE));
    expect(result.current.pickElement(HIT)?.id).toBe("el_x");
  });

  it("锁定后 pickElement 返回 null，但 ignoreLock 仍能问到「其实是点中了」", () => {
    seedElement();
    const { result } = renderHook(() => useMapEditor(SIZE));
    act(() => result.current.toggleLayerLock("element"));

    expect(result.current.pickElement(HIT)).toBeNull();
    // 页面靠这一条给出「素材层已锁定」提示，而不是让点击静默无反应
    expect(result.current.pickElement(HIT, { ignoreLock: true })?.id).toBe("el_x");
  });

  it("锁定后 removeSelected 不删（键盘 Delete 走的是同一条路）", () => {
    seedElement();
    const { result } = renderHook(() => useMapEditor(SIZE));
    act(() => result.current.setSelectedId("el_x"));
    act(() => result.current.toggleLayerLock("element"));

    act(() => result.current.removeSelected());
    expect(result.current.doc.elements.map((e) => e.id)).toEqual(["el_x"]);
  });

  it("解锁后立刻恢复可命中（锁不是单向门）", () => {
    seedElement();
    const { result } = renderHook(() => useMapEditor(SIZE));
    act(() => result.current.toggleLayerLock("element"));
    act(() => result.current.toggleLayerLock("element"));
    expect(result.current.pickElement(HIT)?.id).toBe("el_x");
  });
});

/* ─────────────── 手工落位避让（观感批次 D · P2-3） ─────────────── */

describe("useMapEditor · placeSprite 手工落位避让", () => {
  /** 预置一个聚落：city-mid 105×66，脚底锚点在 (0,0)，命中盒 y∈[-66,0] */
  function seedSettlement() {
    useMapDocStore.setState({
      doc: {
        ...useMapDocStore.getState().doc,
        elements: [
          { id: "el_city", spriteId: "city-mid", x: 0, y: 0, scale: 1, rotation: 0, level: null },
        ],
      },
    });
  }

  it("验收：山拖到聚落正中心 → 落位被拦（返回 false、文档不动）", () => {
    seedSettlement();
    const { result } = renderHook(() => useMapEditor(SIZE));

    let placed = true;
    act(() => {
      placed = result.current.placeSprite("mountain-19", { x: 0, y: -30 });
    });
    expect(placed).toBe(false);
    // 文档零变化：没有新素材、没有新地名（点要素的默认名也不许生成）
    expect(result.current.doc.elements.map((e) => e.id)).toEqual(["el_city"]);
    expect(result.current.doc.labels).toHaveLength(0);
  });

  it("呼吸边外放行：同一座山落在空地 → 正常落位且素材选中", () => {
    seedSettlement();
    const { result } = renderHook(() => useMapEditor(SIZE));

    let placed = false;
    act(() => {
      placed = result.current.placeSprite("mountain-19", { x: 500, y: 0 });
    });
    expect(placed).toBe(true);
    expect(result.current.doc.elements).toHaveLength(2);
    expect(result.current.selectedId).toBe(result.current.doc.elements[1].id);
  });

  it("验收：移动既有素材不被拦截（拖开解围的路必须是通的）", () => {
    seedSettlement();
    const { result } = renderHook(() => useMapEditor(SIZE));
    // 先在空地放一座山
    act(() => {
      result.current.placeSprite("mountain-19", { x: 500, y: 0 });
    });
    // 把聚落**拖进**山的正中心：移动路径不设防 —— 否则压住的素材永远无法移开
    act(() => {
      result.current.moveElementBy("el_city", 500, -30);
    });
    const city = result.current.doc.elements.find((e) => e.id === "el_city");
    expect(city?.x).toBe(500);
    expect(city?.y).toBe(-30);
    // 两个素材都在（拦截只存在于"新建落位"，移动路径完全自由）
    expect(result.current.doc.elements).toHaveLength(2);
  });

  it("未登记的素材 id 不参与避让（渲染层都不认的东西不拦路）", () => {
    // spriteId 查不到 SpriteDef：与 pickElement 同款跳过 —— 存档里的脏数据
    // 不该让用户"看着空地却放不下东西"
    useMapDocStore.setState({
      doc: {
        ...useMapDocStore.getState().doc,
        elements: [
          { id: "el_ghost", spriteId: "ghost-1", x: 0, y: 0, scale: 1, rotation: 0, level: null },
        ],
      },
    });
    const { result } = renderHook(() => useMapEditor(SIZE));
    let placed = false;
    act(() => {
      placed = result.current.placeSprite("mountain-19", { x: 0, y: -30 });
    });
    expect(placed).toBe(true);
    expect(result.current.doc.elements).toHaveLength(2);
  });

  /* ───── QA 边界补钉：完整交互链 / 新落位素材也设防 ───── */

  it("第一次被拦（文档零变化）→ 同一 pending 换空地再点 → 成功落位", () => {
    seedSettlement();
    const { result } = renderHook(() => useMapEditor(SIZE));

    let first = true;
    act(() => {
      first = result.current.placeSprite("mountain-19", { x: 0, y: -30 });
    });
    expect(first).toBe(false);
    expect(result.current.doc.elements.map((e) => e.id)).toEqual(["el_city"]);

    // 被拦之后状态不能脏：用户换个位置再点，走的仍是同一条成功路径
    let second = false;
    act(() => {
      second = result.current.placeSprite("mountain-19", { x: 500, y: 0 });
    });
    expect(second).toBe(true);
    expect(result.current.doc.elements).toHaveLength(2);
    expect(result.current.selectedId).toBe(result.current.doc.elements[1].id);
  });

  it("先落位的素材对后续落位也设防（山落好后，城市压进它的盒+呼吸边内被拦）", () => {
    // 空地放一座山（mountain-19：160×93，脚底 (500,0)，命中盒 y∈[-93,0]）
    let placed = false;
    const { result } = renderHook(() => useMapEditor(SIZE));
    act(() => {
      placed = result.current.placeSprite("mountain-19", { x: 500, y: 0 });
    });
    expect(placed).toBe(true);
    // city-mid 想落在山的盒+呼吸边内 → 拦（障碍物集合随落位实时生长）
    let blocked = true;
    act(() => {
      blocked = result.current.placeSprite("city-mid", { x: 500, y: -30 });
    });
    expect(blocked).toBe(false);
    expect(result.current.doc.elements).toHaveLength(1);
    // 换到盒+呼吸边外 → 放行
    let ok = false;
    act(() => {
      ok = result.current.placeSprite("city-mid", { x: 500, y: -200 });
    });
    expect(ok).toBe(true);
    expect(result.current.doc.elements).toHaveLength(2);
  });
});
