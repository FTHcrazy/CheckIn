import { beforeEach, describe, expect, it } from "vitest";
import { useMapDocStore } from "./useMapDocStore";
import { resetMapStores } from "./reset";
import { type MapRegion, type RegionLevelDef } from "../regions";
import { createEmptyDocument } from "../types";

/**
 * `useMapDocStore` 的两条新能力：层级定义的**快照合并键**、**合并子树**。
 *
 * ── 为什么这两条必须落在 store 层测 ──
 * 它们都是"撤销栈账目"的规则，而账目只有在**连续多次操作**之后才看得出对错：
 *   · 合并键错了 ⇒ 表现为"连按三次撤销还在原地"（压了 3 步）或"改完一撤销全没了"（1 步都没压）；
 *   · 叶子合并没有守卫 ⇒ 表现为"按了撤销但画面完全不动"（压了一个空快照）。
 * 页面用例里这些都被 UI 事件与异步渲染盖住了，只有直接对 store 发号施令才能钉住。
 */

/** 造一个最小可用区块（store 不碰几何，一个三角形足够） */
function mkRegion(
  id: string,
  parentId: string | null,
  level: number,
  extra: Partial<MapRegion> = {},
): MapRegion {
  return {
    id,
    parentId,
    level,
    name: `区块 ${id}`,
    seed: { x: 0, y: 0 },
    polygon: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ],
    color: 0x445566,
    ...extra,
  };
}

/** 一棵四层链：A(0) → B(1) → D(2) 另有 C(1)。D 带一张子图 */
function tree(): MapRegion[] {
  return [
    mkRegion("A", null, 0),
    mkRegion("B", "A", 1),
    mkRegion("C", "A", 1),
    mkRegion("D", "B", 2, {
      submap: {
        id: "sm_D",
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        land: null,
        regions: [],
        elements: [],
        labels: [],
        style: "none",
        baseImageId: "base-1",
      },
    }),
  ];
}

/** 往文档里塞一批区块（不经过 commit —— 这些是"既有状态"，不该占撤销栈） */
function seedRegions(regions: MapRegion[]): void {
  useMapDocStore.setState({ doc: { ...createEmptyDocument(), regions } });
}

/**
 * 两级 schema（合键测试的载体）。
 *
 * 【2.42.0】产品层区域只有国家一级、层级配置面板已下线；store 的
 * `setRegionSchema` 作为数据层能力保留（嵌套子图 / 潜在复用），合键行为
 * 与 schema 项数无关 —— 这里用**显式构造**的两级 schema 驱动用例，
 * 不再从默认 schema 切片。
 */
function twoLevels(): RegionLevelDef[] {
  return [
    { name: "大陆甲", count: 12 },
    { name: "洲乙", count: 60 },
  ];
}

const state = () => useMapDocStore.getState();

beforeEach(() => {
  resetMapStores();
});

describe("useMapDocStore · setRegionSchema 的快照合并键", () => {
  /**
   * 【核心账目】同一键的连续 N 次编辑只压**一步**快照。
   *
   * 配置面板是"边调边写"的（层数、名称、数量各有自己的提交时机），一次"把 4 级改成
   * 3 级并改名"会产生好几次 `set`。若每次都压步，用户要按十几次 Ctrl+Z 才能退回，
   * 而中间每一步画面只动一点点 —— 那是"撤销坏了"的体感。
   */
  it("连续三次编辑只压一步：撤销一次回到「从没配置过」（undefined）", () => {
    expect(state().doc.regionSchema).toBeUndefined();
    expect(state().undoStack).toHaveLength(0);

    const a = twoLevels();
    a[0].name = "大陆甲";
    state().setRegionSchema(a);
    const b = a.map((def) => ({ ...def }));
    b[1].count = 20;
    state().setRegionSchema(b);
    const c = b.map((def) => ({ ...def }));
    c[1].name = "洲乙";
    state().setRegionSchema(c);

    // 文档是最新那份
    expect(state().doc.regionSchema).toEqual(c);
    // 但撤销栈只有一步（第一次编辑之前）
    expect(state().undoStack).toHaveLength(1);

    state().undo();
    // ⚠️ 回落到 `undefined` 而不是 `DEFAULT_REGION_SCHEMA`：老文档从没写过这个字段，
    // 兜底成默认值会凭空造出一次"文档内容变更"（`applySnapshot` 的注释有完整理由）
    expect(state().doc.regionSchema).toBeUndefined();
    expect(state().undoStack).toHaveLength(0);
  });

  /**
   * 【断键】`breakCommitKey` 之后的下一次编辑必须**独立成步**。
   *
   * 合并键的"连续"边界是交互动作而不是时间：改完名称、失焦、回来再改数量 = 两步。
   */
  it("breakCommitKey 之后的下一次编辑压新步（共两步）", () => {
    const a = twoLevels();
    state().setRegionSchema(a);
    const b = a.map((def) => ({ ...def }));
    b[0].count = 9;
    state().setRegionSchema(b);
    expect(state().undoStack).toHaveLength(1);

    state().breakCommitKey();
    const c = b.map((def) => ({ ...def }));
    c[0].count = 11;
    state().setRegionSchema(c);
    expect(state().undoStack).toHaveLength(2);
  });

  /**
   * 【撤销必须断键（架构 §6-8 的四处之一）】撤销之后再改 schema 不能被并进上一步。
   *
   * 这条只有在"撤销 → 改 → 看撤销栈深度"这个顺序下才暴露：键没被清空时，
   * 撤销后的第一次编辑会以为"还是同一串连续编辑"，于是**一步都不压**，
   * 用户随后按 Ctrl+Z 会退到撤销之前的那一版（越过他刚做的编辑）。
   */
  it("撤销后紧接一次编辑，仍然压步（undo 清空了合并键）", () => {
    const a = twoLevels();
    state().setRegionSchema(a);
    expect(state().undoStack).toHaveLength(1);

    state().undo();
    expect(state().undoStack).toHaveLength(0);

    // 键若没被 undo 清空 ⇒ 这一次会被 coalesce 吃掉 ⇒ 撤销栈仍为 0
    const b = a.map((def) => ({ ...def }));
    b[0].count = 7;
    state().setRegionSchema(b);
    expect(state().undoStack).toHaveLength(1);
    expect(state().doc.regionSchema).toEqual(b);
  });

  /**
   * 【减少层数要删区块，且必须与 schema 同一步】
   *
   * 若分成两次 commit，用户按一次 Ctrl+Z 会得到"区块回来了、但层级数还是新的"这种
   * 半截状态 —— 比不让撤销更危险（用户会以为撤销坏了，接着乱点）。
   */
  it("pruneLevelsAbove：删超层区块与改 schema 同一次快照，一次撤销两样一起回来", () => {
    seedRegions(tree());
    expect(state().doc.regions).toHaveLength(4);

    const a = twoLevels();
    state().setRegionSchema(a, 2);

    expect(state().doc.regionSchema).toEqual(a);
    // level >= 2 的只有 D
    expect(state().doc.regions.map((r) => r.id)).toEqual(["A", "B", "C"]);
    expect(state().undoStack).toHaveLength(1);

    state().undo();
    expect(state().doc.regionSchema).toBeUndefined();
    expect(state().doc.regions).toHaveLength(4);
  });

  /**
   * 【拖拽起始必须断键（架构 §6-8 的四处之一）】
   *
   * `commitDragStart` 是一次独立的编辑动作（拖拽全程只记这一步）。它若不清合并键，
   * 那么"先调 schema、再拖一次素材、再调 schema"里的第二次 schema 编辑会被并进上一步
   * —— 用户按 Ctrl+Z 会一次性退掉"改配置 + 拖拽"两件事，且中间的拖拽状态永远找不回。
   */
  it("commitDragStart 断键：拖拽起始后的 schema 编辑压新步，不被并进上一步", () => {
    const a = twoLevels();
    state().setRegionSchema(a);
    expect(state().undoStack).toHaveLength(1);

    // 一次拖拽起始：压一步快照（拖拽本身只记一次），且必须断掉合并键
    state().commitDragStart(state().doc);
    expect(state().undoStack).toHaveLength(2);

    const b = a.map((def) => ({ ...def }));
    b[0].count = 11;
    state().setRegionSchema(b);
    // 键若没被 commitDragStart 清空 ⇒ 这次编辑被 coalesce 吃掉 ⇒ 仍停在 2
    expect(state().undoStack).toHaveLength(3);
    expect(state().doc.regionSchema).toEqual(b);
  });
});

describe("useMapDocStore · mergeSubtree（合并子树）", () => {
  it("非叶子：删全部后代（含孙子），root 引用不变，一次快照可整步撤销", () => {
    const regions = tree();
    seedRegions(regions);
    const rootRef = regions[0];

    const result = state().mergeSubtree("A");

    // 后代是 B / C / D 三个（"子区域"在日常语义里包含孙子）
    expect(result).toEqual({ removed: 3, withSubmap: 1 });
    expect(state().doc.regions).toHaveLength(1);
    expect(state().doc.regions[0]).toBe(rootRef);
    expect(state().undoStack).toHaveLength(1);

    state().undo();
    expect(state().doc.regions).toHaveLength(4);
    expect(state().doc.regions[0]).toBe(rootRef);
  });

  it("叶子：返回 0 且**不压快照**（不给用户一步「按了撤销但画面没动」）", () => {
    seedRegions(tree());
    const before = state().undoStack.length;

    const result = state().mergeSubtree("D");

    expect(result).toEqual({ removed: 0, withSubmap: 0 });
    expect(state().undoStack).toHaveLength(before);
    expect(state().doc.regions).toHaveLength(4);
  });

  it("id 不存在：静默返回 0，不产生快照、不抛错", () => {
    seedRegions(tree());
    expect(() => state().mergeSubtree("nope")).not.toThrow();
    expect(state().mergeSubtree("nope")).toEqual({ removed: 0, withSubmap: 0 });
    expect(state().undoStack).toHaveLength(0);
  });

  it("withSubmap 只数带子图的后代（B / C 没子图，D 有）", () => {
    seedRegions(tree());
    const result = state().mergeSubtree("B");
    // B 只有一个孩子 D（带子图）；B 自己保留
    expect(result).toEqual({ removed: 1, withSubmap: 1 });
    expect(state().doc.regions.map((r) => r.id)).toEqual(["A", "B", "C"]);
  });
});
