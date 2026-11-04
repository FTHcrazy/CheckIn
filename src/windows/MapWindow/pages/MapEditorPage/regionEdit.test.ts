import { describe, expect, it } from "vitest";
import {
  DEFAULT_REGION_SCHEMA,
  hslToRgb,
  REGION_TOTAL_LIMIT,
  type MapRegion,
  type Point,
} from "./regions";
import {
  ancestorPathOf,
  applyMerge,
  buildParentIdSet,
  buildRegionChildIndex,
  checkManualRegion,
  collectDescendants,
  isLeafRegion,
  manualRegionColor,
  manualRegionName,
  nextRegionOrdinal,
  planMerge,
  pointInPolygonOrOnEdge,
  polygonsEdgesCross,
  polygonsOverlap,
  polygonSelfIntersects,
  rgbToHsl,
  segmentsProperlyIntersect,
  type ManualRegionCheckInput,
  type ManualRegionRejectCode,
} from "./regionEdit";

/**
 * `regionEdit.ts` 纯函数单测 —— QA 的主战场。
 *
 * 【为什么这一层的用例最密】纯函数便宜、变异可验证（删一行守卫必红），
 * 而页面级一条"生成 223 块"≈3.5s。能在这一层钉住的判据，绝不放到上层去代偿
 * （架构 §4.6 测试策略矩阵）。
 *
 * 【两个必须存在的反例（架构 §6-3 点名）】
 *   ① 贴着父边界画 ⇒ 必须**通过**（`pointInPolygonOrOnEdge` 的 1e-6 容差生效）；
 *   ② 跨出父边界 1 个世界单位 ⇒ 必须**拒绝**（容差只有 1e-6，不做比例放宽）。
 * 只写"越界被拒"的话，把容差改成"父块尺寸的 10%"也能全绿 —— 那就等于没校验。
 */

/* ───────────────────────────── 测试夹具 ───────────────────────────── */

/** 矩形多边形（逆时针，首尾不重复） */
function sq(x: number, y: number, w: number, h: number = w): Point[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

/** 造一个最小可用的区块（只填本文件用得到的字段） */
function mk(
  id: string,
  parentId: string | null,
  level: number,
  polygon: Point[],
  extra: Partial<MapRegion> = {},
): MapRegion {
  return {
    id,
    parentId,
    level,
    name: id,
    seed: { x: polygon[0].x, y: polygon[0].y },
    polygon,
    color: 0x888888,
    ...extra,
  };
}

/**
 * 一棵三代树：P（0 级）→ c1/c2/c3（1 级）→ g1..g5（2 级）。
 *
 * 孙节点 g1..g5 必须在内 —— "合并只删一层"会把它们变成 `parentId` 悬空的孤儿
 * （PRD §6-C.2），这是本文件最要紧的一条判据。
 */
function threeGenerationTree(): MapRegion[] {
  const P = mk("P", null, 0, sq(0, 0, 200));
  const c1 = mk("c1", "P", 1, sq(0, 0, 60));
  const c2 = mk("c2", "P", 1, sq(60, 0, 60));
  const c3 = mk("c3", "P", 1, sq(120, 0, 60));
  const g1 = mk("g1", "c1", 2, sq(0, 0, 30));
  const g2 = mk("g2", "c1", 2, sq(30, 0, 30));
  const g3 = mk("g3", "c1", 2, sq(0, 30, 30));
  const g4 = mk("g4", "c2", 2, sq(60, 0, 30));
  const g5 = mk("g5", "c2", 2, sq(60, 30, 30));
  return [P, c1, g1, g2, g3, c2, g4, g5, c3];
}

/* ─────────────────────── 树索引 / 叶子判定 / 祖先链 ─────────────────────── */

describe("regionEdit：树索引与叶子判定", () => {
  it("buildParentIdSet：只收「有子节点」的 id，叶子与悬空脏行都不在内", () => {
    const regions = [
      ...threeGenerationTree(),
      // 悬空 parentId：指向不存在的区块（PRD §6-C.9：按顶层处理）
      mk("dirty", "ghost", 1, sq(0, 0, 5)),
    ];
    const parents = buildParentIdSet(regions);

    expect(parents.has("P")).toBe(true); // 有 c1/c2/c3
    expect(parents.has("c1")).toBe(true); // 有 g1/g2/g3
    expect(parents.has("c2")).toBe(true);
    expect(parents.has("c3")).toBe(false); // 叶子
    expect(parents.has("g1")).toBe(false);
    // ⚠️ 悬空 id 不是"真实存在的区块"，不得进集合（否则脏数据会凭空造出一个"非叶子"）
    expect(parents.has("ghost")).toBe(false);

    expect(isLeafRegion("g1", parents)).toBe(true);
    expect(isLeafRegion("P", parents)).toBe(false);
    // 不存在的 id 也算叶子（没有子节点），调用方不会拿到意外结果
    expect(isLeafRegion("nope", parents)).toBe(true);
  });

  it("buildRegionChildIndex：悬空 parentId 归入 null 键（按顶层处理），顺序 = 入参顺序", () => {
    const regions = [...threeGenerationTree(), mk("dirty", "ghost", 1, sq(0, 0, 5))];
    const index = buildRegionChildIndex(regions);

    expect(index.get(null)).toEqual(["P", "dirty"]);
    expect(index.get("P")).toEqual(["c1", "c2", "c3"]);
    expect(index.get("c1")).toEqual(["g1", "g2", "g3"]);
    expect(index.get("c3")).toBeUndefined();
  });

  it("ancestorPathOf：根→父（不含自身）；悬空 parentId / 环 都不死循环", () => {
    const tree = threeGenerationTree();
    expect(ancestorPathOf(tree, "g1").map((r) => r.id)).toEqual(["P", "c1"]);
    expect(ancestorPathOf(tree, "c1").map((r) => r.id)).toEqual(["P"]);
    expect(ancestorPathOf(tree, "P")).toEqual([]);

    // 悬空 parentId：到此为止，不抛错
    expect(ancestorPathOf([mk("z", "ghost", 1, sq(0, 0, 5))], "z")).toEqual([]);
    // id 不存在
    expect(ancestorPathOf(tree, "nope")).toEqual([]);

    // 环 A→B→A：必须停下来（否则面包屑会把面板挂死）
    const cyclic = [mk("a", "b", 1, sq(0, 0, 10)), mk("b", "a", 1, sq(0, 0, 10))];
    const path = ancestorPathOf(cyclic, "a");
    expect(path.map((r) => r.id)).toEqual(["b"]);
    // 自指
    const selfRef = [mk("s", "s", 1, sq(0, 0, 10))];
    expect(ancestorPathOf(selfRef, "s")).toEqual([]);
  });
});

/* ────────────────────────────── 子树 / 合并 ────────────────────────────── */

describe("regionEdit：子树与合并计划", () => {
  it("planMerge：叶子返回 null，非叶子返回整棵后代且 order 为前序", () => {
    const tree = threeGenerationTree();
    const plan = planMerge(tree, "P");
    expect(plan).not.toBeNull();

    // 前序 = 父在子之前，且每个父的直接子节点按原顺序紧跟其后
    expect(plan!.descendantIds).toEqual(["c1", "g1", "g2", "g3", "c2", "g4", "g5", "c3"]);
    expect(plan!.descendants).toHaveLength(8);
    expect(plan!.root).toBe(tree[0]); // 同一个对象引用

    // 叶子 / 不存在 ⇒ null（UI 据此 disabled，store 据此不 commit）
    expect(planMerge(tree, "g1")).toBeNull();
    expect(planMerge(tree, "nope")).toBeNull();
    // 只有一层子节点也算非叶子
    expect(planMerge(tree, "c3")).toBeNull(); // c3 是叶子
    expect(planMerge(tree, "c1")!.descendantIds).toEqual(["g1", "g2", "g3"]);
  });

  it("planMerge：悬空 parentId 的脏行按顶层处理，不抛错也不被当成后代", () => {
    const dirty = [...threeGenerationTree(), mk("dirty", "ghost", 1, sq(0, 0, 5))];
    expect(() => planMerge(dirty, "P")).not.toThrow();
    expect(planMerge(dirty, "P")!.descendantIds).not.toContain("dirty");
    // 悬空 id 本身不是区块 ⇒ 没有可合并的子树
    expect(planMerge(dirty, "ghost")).toBeNull();
  });

  it("planMerge：子树里带 submap 的区块被单独列出（弹窗 ⚠ 段的数据源）", () => {
    const submap = {
      id: "sm_x",
      bounds: { x: 0, y: 0, width: 10, height: 10 },
      land: null,
      regions: [],
      elements: [],
      labels: [],
      style: "none" as const,
      baseImageId: "base-1",
    };
    const tree = threeGenerationTree();
    const withSub = tree.map((r) => (r.id === "g2" || r.id === "c3" ? { ...r, submap } : r));
    const plan = planMerge(withSub, "P");
    expect(plan!.withSubmap.map((s) => s.id)).toEqual(["g2", "c3"]);
    expect(plan!.withSubmap.map((s) => s.name)).toEqual(["g2", "c3"]);
  });

  it("collectDescendants：不含自身；id 不存在 / 无后代 ⇒ []；环去重", () => {
    const tree = threeGenerationTree();
    expect(collectDescendants(tree, "c3")).toEqual([]);
    expect(collectDescendants(tree, "nope")).toEqual([]);
    expect(collectDescendants(tree, "g1")).toEqual([]);
    expect(collectDescendants(tree, "c1").map((r) => r.id)).toEqual(["g1", "g2", "g3"]);

    // 环：A→B→A，从 A 出发只应拿到 B 一次，且绝不能无限循环
    const cyclic = [mk("a", "b", 1, sq(0, 0, 10)), mk("b", "a", 1, sq(0, 0, 10))];
    const out = collectDescendants(cyclic, "a");
    expect(out.map((r) => r.id)).toEqual(["b"]);
  });

  it("applyMerge：root 引用与 polygon 逐点不变，返回新数组且保持原顺序", () => {
    const tree = threeGenerationTree();
    const root = tree[0];
    const plan = planMerge(tree, "P")!;
    const out = applyMerge(tree, plan);

    expect(out).not.toBe(tree); // 新数组
    expect(tree).toHaveLength(9); // 入参未被修改
    expect(out.map((r) => r.id)).toEqual(["P"]);

    const kept = out[0];
    // ⚠️ 引用相等（不是深比较）：合并不得顺手重建 root（渲染几何零重建的前提）
    expect(kept).toBe(root);
    expect(kept.polygon).toBe(root.polygon);
    expect(kept.level).toBe(root.level);
    expect(kept.name).toBe(root.name);
    expect(kept.color).toBe(root.color);
    expect(kept.seed).toBe(root.seed);
  });
});

/* ───────────────────────────── 几何谓词 ───────────────────────────── */

describe("regionEdit：几何谓词", () => {
  it("segmentsProperlyIntersect：真相交为真，端点接触 / 共线重叠为假", () => {
    // 十字交叉
    expect(
      segmentsProperlyIntersect({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }),
    ).toBe(true);
    // 端点接触（T 形）：不算
    expect(
      segmentsProperlyIntersect({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 }),
    ).toBe(false);
    // 共线重叠：不算
    expect(
      segmentsProperlyIntersect({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 }),
    ).toBe(false);
    // 平行不相交
    expect(
      segmentsProperlyIntersect({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 2, y: 1 }),
    ).toBe(false);
  });

  it("polygonSelfIntersects：正五边形 false、「8」字形 true、相邻边共享端点 false", () => {
    const pentagon: Point[] = [];
    for (let i = 0; i < 5; i += 1) {
      const ang = (Math.PI * 2 * i) / 5 - Math.PI / 2;
      pentagon.push({ x: Math.cos(ang) * 50, y: Math.sin(ang) * 50 });
    }
    expect(polygonSelfIntersects(pentagon)).toBe(false);
    expect(polygonSelfIntersects(sq(0, 0, 100))).toBe(false);
    // 三角形：没有"不相邻的两条边"
    expect(polygonSelfIntersects([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }])).toBe(false);
    // 「8」字形（蝴蝶结）
    expect(
      polygonSelfIntersects([
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ]),
    ).toBe(true);
    // 相邻边（含首尾）共享端点是最常见的合法形态，不得算自交
    expect(
      polygonSelfIntersects([
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
      ]),
    ).toBe(false);
  });

  it("polygonsEdgesCross：只判边相交，包含形态不算", () => {
    expect(polygonsEdgesCross(sq(0, 0, 10), sq(5, 5, 10))).toBe(true);
    // 包含：没有任何一对边真相交
    expect(polygonsEdgesCross(sq(0, 0, 100), sq(10, 10, 10))).toBe(false);
    expect(polygonsEdgesCross(sq(0, 0, 10), sq(50, 50, 10))).toBe(false);
  });

  it("pointInPolygonOrOnEdge：内部 / 边界上为真，容差外为假", () => {
    const poly = sq(0, 0, 100);
    expect(pointInPolygonOrOnEdge({ x: 50, y: 50 }, poly)).toBe(true);
    // 顶点正好落在边界上（"贴着父边界画"的最小形态）
    expect(pointInPolygonOrOnEdge({ x: 0, y: 50 }, poly)).toBe(true);
    expect(pointInPolygonOrOnEdge({ x: 0, y: 0 }, poly)).toBe(true);
    // 浮点噪声级偏移仍算在边上（1e-6 容差）
    expect(pointInPolygonOrOnEdge({ x: -1e-8, y: 50 }, poly)).toBe(true);
    // 真的出去 1 个世界单位：必须为假（容差不得按比例放宽）
    expect(pointInPolygonOrOnEdge({ x: -1, y: 50 }, poly)).toBe(false);
    expect(pointInPolygonOrOnEdge({ x: 120, y: 50 }, poly)).toBe(false);
  });

  it("polygonsOverlap：穿越 / 完全包含 / 一角在内 三种形态都判重叠", () => {
    const big = sq(0, 0, 100);
    // 穿越（只有边相交）
    expect(polygonsOverlap(big, sq(90, 40, 40, 20))).toBe(true);
    // 完全包含（只有顶点落在对方内）
    expect(polygonsOverlap(big, sq(20, 20, 10))).toBe(true);
    // 一角在内（两顶点在内、两顶点在外）
    expect(polygonsOverlap(big, sq(80, 80, 40))).toBe(true);
    // 反向对照：完全分离必须为假（否则"永远重叠"也能让上面三条通过）
    expect(polygonsOverlap(big, sq(200, 200, 10))).toBe(false);
    // 只贴边不重叠（共边不算重叠）
    expect(polygonsOverlap(sq(0, 0, 50), sq(50, 0, 50))).toBe(false);
  });
});

/* ───────────────────────────── 手画校验 ───────────────────────────── */

/**
 * 8 个拒绝码各命中一次。
 *
 * 夹具设计要点：
 *   · `overlap-ancestor` 用**父块自己越出祖先**的脏树（正常生成树里父块恒在祖先内，
 *     此时子块与祖先必然"包含"，若按包含判定会把所有合法子块都拒掉 ——
 *     实现里用的是"边穿越"，所以这里构造一个真的穿越场景）；
 *   · `overlap-sibling` 的两个兄弟块空间上分区，新块与其中一个相交；
 *   · `outside-parent` 跨出父边界 10 个世界单位（远超 1e-6 容差）。
 */
const ROOT = mk("R", null, 0, sq(0, 0, 200), { name: "大陆 1" });
const PARENT = mk("P1", "R", 1, sq(20, 20, 100), { name: "洲 1" });
const SIBLING = mk("S1", "P1", 2, sq(20, 20, 40), { name: "国家 1" });

/** 每个用例都给一份干净的输入，避免用例之间互相污染 */
function input(overrides: Partial<ManualRegionCheckInput> = {}): ManualRegionCheckInput {
  return {
    polygon: sq(30, 60, 20),
    parent: PARENT,
    regions: [ROOT, PARENT],
    levelCount: 4,
    ...overrides,
  };
}

const REJECT_CASES: Array<{ code: ManualRegionRejectCode; input: ManualRegionCheckInput }> = [
  {
    code: "degenerate-edge",
    // 相邻顶点重合（首尾也算相邻）
    input: input({
      polygon: [
        { x: 30, y: 60 },
        { x: 30, y: 60.0000001 },
        { x: 60, y: 90 },
      ],
    }),
  },
  { code: "too-few-points", input: input({ polygon: [{ x: 30, y: 60 }, { x: 50, y: 60 }] }) },
  {
    code: "total-limit",
    input: input({ limit: 2 }), // regions 已 2 块，达到上限
  },
  {
    code: "level-out-of-range",
    // 父块已是 1 级、总共只 2 级 ⇒ 子块要 2 级，越界
    input: input({ levelCount: 2 }),
  },
  {
    code: "self-intersect",
    input: input({
      polygon: [
        { x: 30, y: 60 },
        { x: 70, y: 100 },
        { x: 70, y: 60 },
        { x: 30, y: 100 },
      ],
    }),
  },
  {
    code: "overlap-ancestor",
    // 脏树：父块自己跨出了祖先边界（真实文档里可能是老版本遗留），
    // 于是"完全落在父块内"的新块也会穿越祖先的边
    input: input({
      parent: mk("P2", "R", 1, sq(180, 20, 60), { name: "洲 2" }),
      regions: [ROOT, mk("P2", "R", 1, sq(180, 20, 60), { name: "洲 2" })],
      polygon: sq(190, 30, 20),
    }),
  },
  {
    code: "overlap-sibling",
    input: input({
      regions: [ROOT, PARENT, SIBLING],
      polygon: sq(30, 30, 20), // 压在同父兄弟 S1 上
    }),
  },
  {
    code: "outside-parent",
    input: input({ polygon: sq(110, 30, 40) }), // 右侧跨出父块（父块右边界 120）
  },
];

describe("regionEdit：checkManualRegion", () => {
  it.each(REJECT_CASES)("checkManualRegion：$code 命中一次（参数化）", ({ code, input: given }) => {
    const result = checkManualRegion(given);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(code);
  });

  it("checkManualRegion：重叠类拒绝带 conflict（弹窗要显示「与『名字』重叠」）", () => {
    const sibling = checkManualRegion(
      input({ regions: [ROOT, PARENT, SIBLING], polygon: sq(30, 30, 20) }),
    );
    expect(sibling.ok).toBe(false);
    if (!sibling.ok) {
      expect(sibling.code).toBe("overlap-sibling");
      expect(sibling.conflict).toEqual({ id: "S1", name: "国家 1" });
    }

    const outside = checkManualRegion(input({ polygon: sq(110, 30, 40) }));
    expect(outside.ok).toBe(false);
    if (!outside.ok) {
      expect(outside.code).toBe("outside-parent");
      expect(outside.conflict).toEqual({ id: "P1", name: "洲 1" });
    }
  });

  it("checkManualRegion：贴父边界 / 共线邻边 / 逆绕向 / 极小三角形 都不该拒", () => {
    // ① 贴着父边界画（**两条边完全落在父边界上**，这是最常见的画法，也是架构 §6-3 点名的反例）
    const hugging = checkManualRegion(
      input({
        polygon: [
          { x: 20, y: 20 },
          { x: 70, y: 20 },
          { x: 70, y: 70 },
          { x: 20, y: 70 },
        ],
      }),
    );
    expect(hugging.ok).toBe(true);

    // ② 共线邻边（三点一线，合法的"直边"多边形）
    const collinear = checkManualRegion(
      input({
        polygon: [
          { x: 30, y: 40 },
          { x: 60, y: 40 },
          { x: 90, y: 40 },
          { x: 90, y: 90 },
          { x: 30, y: 90 },
        ],
      }),
    );
    expect(collinear.ok).toBe(true);

    // ③ 逆绕向（顺时针）：多边形方向不保证，`polygonArea` 取绝对值
    const clockwise = checkManualRegion(input({ polygon: sq(30, 60, 20).reverse() }));
    expect(clockwise.ok).toBe(true);

    // ④ 极小三角形：面积 5e-9，但顶点互不重合、不自交 ⇒ 合法
    const tiny = checkManualRegion(
      input({
        polygon: [
          { x: 40, y: 80 },
          { x: 40.0001, y: 80 },
          { x: 40, y: 80.0001 },
        ],
      }),
    );
    expect(tiny.ok).toBe(true);

    // ⑤ 跨出父边界 1 个世界单位（远超 1e-6 容差）必须被拒 —— 容差不得按比例放宽
    const justOutside = checkManualRegion(
      input({
        polygon: [
          { x: 19, y: 40 },
          { x: 60, y: 40 },
          { x: 60, y: 80 },
          { x: 19, y: 80 },
        ],
      }),
    );
    expect(justOutside.ok).toBe(false);
    if (!justOutside.ok) expect(justOutside.code).toBe("outside-parent");
  });

  it("checkManualRegion：顶层（parent = null）只与其它顶层区块比，且返回 polygon 副本", () => {
    const draft = sq(300, 300, 20);
    const result = checkManualRegion({
      polygon: draft,
      parent: null,
      regions: [ROOT],
      levelCount: 4,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // 值相等但**不是同一个数组 / 对象**：落库几何不得与页面草稿共享引用
      expect(result.polygon).toEqual(draft);
      expect(result.polygon).not.toBe(draft);
      expect(result.polygon[0]).not.toBe(draft[0]);
    }

    // 顶层与顶层重叠 ⇒ overlap-sibling（顶层区块之间互为"兄弟"）
    const overlapTop = checkManualRegion({
      polygon: sq(10, 10, 20),
      parent: null,
      regions: [ROOT],
      levelCount: 4,
    });
    expect(overlapTop.ok).toBe(false);
    if (!overlapTop.ok) expect(overlapTop.code).toBe("overlap-sibling");
  });

  it("checkManualRegion：总数护栏取 REGION_TOTAL_LIMIT 缺省值", () => {
    const crowded = Array.from({ length: REGION_TOTAL_LIMIT }, (_, i) =>
      mk(`r${i}`, null, 0, sq(i, 0, 1)),
    );
    const result = checkManualRegion({ polygon: sq(5, 5, 5), parent: null, regions: crowded, levelCount: 4 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("total-limit");
  });
});

/* ───────────────────────────── 落库字段 ───────────────────────────── */

describe("regionEdit：落库字段（纯、确定性）", () => {
  it("nextRegionOrdinal：同层现有数量 + 1（不从 name 解析）", () => {
    const regions = [
      mk("a", null, 0, sq(0, 0, 10)),
      mk("b", null, 1, sq(0, 0, 10), { name: "随便起的名字" }),
      mk("c", null, 1, sq(0, 0, 10), { name: "又一个新的" }),
    ];
    expect(nextRegionOrdinal(regions, 1)).toBe(3);
    expect(nextRegionOrdinal(regions, 0)).toBe(2);
    expect(nextRegionOrdinal(regions, 3)).toBe(1);
  });

  it("manualRegionName：与生成区同一口径；空名回落 L{n}", () => {
    expect(manualRegionName(DEFAULT_REGION_SCHEMA, 2, 12)).toBe("国家 12");
    expect(manualRegionName(DEFAULT_REGION_SCHEMA, 0, 1)).toBe("大陆 1");
    // 空名 / 缺 schema 一律回落，不留空段
    expect(manualRegionName([{ name: "", count: 3 }], 0, 5)).toBe("L1 5");
    expect(manualRegionName(undefined, 3, 7)).toBe("L4 7");
  });

  it("rgbToHsl ↔ hslToRgb：能反解（手画「继承父色相」的前提）", () => {
    const rgb = hslToRgb(200, 0.5, 0.5);
    const hsl = rgbToHsl(rgb);
    expect(hsl.h).toBeCloseTo(200, 0);
    expect(hsl.s).toBeCloseTo(0.5, 1);
    expect(hsl.l).toBeCloseTo(0.5, 1);
    // 灰阶：色相无定义，读 0、饱和 0
    expect(rgbToHsl(0x808080).s).toBeCloseTo(0, 6);
    expect(rgbToHsl(0x000000)).toEqual({ h: 0, s: 0, l: 0 });
  });

  it("manualRegionColor：确定性、无父色按黄金角分散、有父色只偏 ±6°", () => {
    // 同输入必同输出（禁 rng / Math.random）
    expect(manualRegionColor({ parentColor: null, ordinal: 3 })).toBe(
      manualRegionColor({ parentColor: null, ordinal: 3 }),
    );
    // 无父色：不同序号必须拿到不同色（否则整层区块同色）
    const c1 = manualRegionColor({ parentColor: null, ordinal: 1 });
    const c2 = manualRegionColor({ parentColor: null, ordinal: 2 });
    expect(c1).not.toBe(c2);
    // 饱和度 / 明度与生成器同档
    expect(rgbToHsl(c1).l).toBeCloseTo(0.62, 1);

    // 有父色：色相偏差不超过 2×hueSpread（= 6°）
    const parentColor = hslToRgb(120, 0.13, 0.62);
    const parentHue = rgbToHsl(parentColor).h;
    // ordinal % 5 - 2 = 0 ⇒ 完全不偏色：与父色**逐位相同**（父色本身就是这条规则的产物）
    expect(manualRegionColor({ parentColor, ordinal: 2 })).toBe(parentColor);
    for (const ordinal of [1, 3, 4, 5]) {
      const hue = rgbToHsl(manualRegionColor({ parentColor, ordinal })).h;
      const diff = Math.min(Math.abs(hue - parentHue), 360 - Math.abs(hue - parentHue));
      // 6° 规则 + 8 位量化误差（低饱和时一个通道 ≈ 25 级，最大约 1.3°）⇒ 留到 8°
      expect(diff).toBeLessThanOrEqual(8);
    }
  });
});
