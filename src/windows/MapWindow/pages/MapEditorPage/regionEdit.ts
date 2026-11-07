/**
 * 区块"编辑域"纯函数
 *
 * 【为什么单独一个文件，而不是塞进 `regions.ts`】`regions.ts` 是一个自洽的**生成器**
 * （Voronoi + 崎岖化 + 噪声，已 1170 行被算法占满），它的不变量是"父子边界逐点严丝
 * 合缝"；本文件的不变量是"手画多边形合法、子树删除、叶子判定"。两者毫不相干，混在
 * 一处会让 `regions.test.ts` 变成杂物间，也让"改合并逻辑"与"改崎岖化参数"产生同一
 * 文件的并发冲突。本文件只**复用** `regions.ts` 已导出的
 * `pointInPolygon` / `REGION_PALETTE_RGB` / `levelLabelOf` / 常量，不复制实现。
 *
 * 【边界】纯函数模块：无副作用、无 React / Pixi / DOM，**禁读** `Date.now()` /
 * `Math.random()` / 全局随机流。同输入必同输出，因此可以被 QA 当作主测试面。
 *
 * 【唯一的例外：`createRegionId`】它是"发号"而不是"计算"，天然带状态（模块内单调
 * 计数器）。放在这里的理由是它和落库字段（名字 / 取色 / 序号）是同一件事的三件套，
 * 拆到别的文件只会让 `addManualRegion` 多一个 import。计数器**不含**时钟与随机数，
 * 所以"同一串编辑顺序 ⇒ 同一串 id"仍然成立（见该函数注释）。
 *
 * 【错误码而不是中文文案】拒绝原因是**枚举**，文案由页面查表映射
 * （见架构文档 §5「文案映射（唯一出处）」）。纯函数层返回中文会让"哪句话该改"
 * 散落在两层，且测试断言会绑死在文案上。
 *
 * 【已知的既有行为，不是 bug】合并会让"层级数量事实源"（`levelCountsOf(regions)`）
 * 少一级，于是该级素材被 `lod.ts` 的 `resolveElementLevel` clamp 到现存最深一级，
 * `elementSizeFactor` 跳档、视觉上放大 2 倍。**这是预期行为，有测试锁定，不要改
 * `lod.ts`**（PRD §7-R3 / 架构 §6-4）。
 */

import {
  REGION_PALETTE_RGB,
  REGION_TOTAL_LIMIT,
  levelLabelOf,
  pointInPolygon,
  type MapRegion,
  type Point,
  type RegionLevelDef,
} from "./regions";

/* ───────────────────────── 几何常量与内部工具 ───────────────────────── */

/**
 * 几何谓词的默认容差（世界单位）。
 *
 * 【为什么是 1e-9】它只用来挡住浮点噪声（同一坐标算两次的末位误差），
 * 不是"宽容度"。真正需要"贴边算在内"的地方用下面那个固定世界单位容差。
 */
const EPS = 1e-9;

/**
 * "贴边算在内"的固定世界单位容差（1e-6）。
 *
 * 【为什么是固定小量而不是按比例】按比例放宽（比如"父块尺寸的 1%"）会让
 * **真的画出去一点**的多边形也通过，数据就脏了；而生成器自身的残余缺陷
 * （实测 0.6% 的子块顶点越出父块，最大 3.2 世界单位）要求的宽容度只有
 * 浮点级 —— 用户贴着父边界画时，顶点落在父块折线的**线段上**，误差就是末位。
 * 因此这里只吸收浮点噪声，不做任何比例放宽（架构 §6-3 点名反例）。
 */
const EDGE_EPS = 1e-6;

/** 叉积 oa × ob（> 0 表示 b 在 a 的逆时针侧） */
function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** 点到线段的最短距离 */
function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  if (d2 < 1e-18) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / d2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/** 归一化的父 id：悬空 `parentId` 归入 `null`（PRD §6-C.9：按顶层处理） */
function normalizedParentIdOf(region: MapRegion, ids: ReadonlySet<string>): string | null {
  return region.parentId !== null && ids.has(region.parentId) ? region.parentId : null;
}

/* ─────────────────────── 1) 树索引（叶子判定 / 祖先链） ─────────────────────── */

/**
 * parentId → 直接子节点 id 列表。
 *
 * **悬空 `parentId` 归入 `null` 键**（PRD §6-C.9：指向不存在区块的脏行按顶层处理）。
 * 顺序 = 入参顺序（渲染 z 序与合并的确定性都靠它）。
 */
export function buildRegionChildIndex(
  regions: readonly MapRegion[],
): Map<string | null, string[]> {
  const ids = new Set(regions.map((r) => r.id));
  const index = new Map<string | null, string[]>();
  for (const region of regions) {
    const parentId = normalizedParentIdOf(region, ids);
    const bucket = index.get(parentId);
    if (bucket) bucket.push(region.id);
    else index.set(parentId, [region.id]);
  }
  return index;
}

/**
 * 有子节点的区块 id 集合 —— **叶子判定的全部依据**。
 *
 * O(n) 一次建好；`doc.regions` 不变时结果可复用（渲染层用
 * `useMemo(() => buildParentIdSet(doc.regions), [doc.regions])`）。
 *
 * 【为什么不是 `level === maxLevel`】合并恰恰会造出 `level` 比最深级**更浅**的叶子
 * （把"国家"的郡全合并掉后，"国家"成为叶子但 `level = 2`）。按 level 判会让刚合并
 * 出来的区块既不能高亮、也无法在视觉上确认选中（PRD §6-A / 团队裁决 #1）。
 */
export function buildParentIdSet(regions: readonly MapRegion[]): Set<string> {
  const ids = new Set(regions.map((r) => r.id));
  const parents = new Set<string>();
  for (const region of regions) {
    if (region.parentId !== null && ids.has(region.parentId)) parents.add(region.parentId);
  }
  return parents;
}

/** 叶子判定：没有任何区块以它为 parentId。⚠️ 判据是**结构**，不是 `level === maxLevel` */
export function isLeafRegion(regionId: string, parentIds: ReadonlySet<string>): boolean {
  return !parentIds.has(regionId);
}

/**
 * 祖先链（根 → 父，**不含自身**）。
 *
 * 遇环或悬空即停：脏文档（`parentId` 指向自己 / A→B→A）下绝不死循环，
 * 这也是"面包屑不得挂起整个面板"的底线。
 */
export function ancestorPathOf(
  regions: readonly MapRegion[],
  regionId: string,
): MapRegion[] {
  const byId = new Map(regions.map((r) => [r.id, r]));
  const self = byId.get(regionId);
  if (!self) return [];

  const chain: MapRegion[] = [];
  const seen = new Set<string>([regionId]);
  let cursor = self.parentId;
  while (cursor !== null && !seen.has(cursor)) {
    const parent = byId.get(cursor);
    if (!parent) break; // 悬空 parentId：到此为止，已收集的仍是有效祖先
    seen.add(cursor);
    chain.push(parent);
    cursor = parent.parentId;
  }
  return chain.reverse();
}

/* ────────────────────────────── 2) 子树（合并） ────────────────────────────── */

/**
 * 全部后代（前序，**不含自身**）。id 不存在 / 无后代 ⇒ `[]`；遇环去重。
 *
 * 【为什么必须递归整棵子树】只删一层会让孙节点变成 `parentId` 悬空的孤儿
 * （PRD §6-C.2）；用户说的"子区域"在日常语义里包含"孙子"。
 */
export function collectDescendants(
  regions: readonly MapRegion[],
  rootId: string,
): MapRegion[] {
  const byId = new Map(regions.map((r) => [r.id, r]));
  if (!byId.has(rootId)) return [];
  const childIndex = buildRegionChildIndex(regions);

  const out: MapRegion[] = [];
  const seen = new Set<string>([rootId]);
  // 显式栈做前序：递归在 600 块的退化链上会爆栈，且顺序要靠"逆序压栈"保证
  const stack: string[] = [...(childIndex.get(rootId) ?? [])].reverse();
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id);
    if (!node) continue;
    out.push(node);
    const kids = childIndex.get(id) ?? [];
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
  }
  return out;
}

export interface MergePlan {
  root: MapRegion;
  /** 将被删除的后代（前序，不含 root） */
  descendants: MapRegion[];
  /** 后代 id（顺序同 descendants）。用**数组**而不是 Set：便于 `toEqual` 深比较断言 */
  descendantIds: string[];
  /** 后代中 `submap != null` 的（弹窗 ⚠ 段用） */
  withSubmap: Array<{ id: string; name: string }>;
}

/**
 * 合并计划。
 *
 * `null` = root 不存在**或**已是叶子（UI 据此 disabled，store 据此不 commit ——
 * 避免"合并了但什么都没变"的空快照，PRD §6-C.1）。
 */
export function planMerge(regions: readonly MapRegion[], rootId: string): MergePlan | null {
  const root = regions.find((r) => r.id === rootId);
  if (!root) return null;
  const descendants = collectDescendants(regions, rootId);
  if (descendants.length === 0) return null;
  return {
    root,
    descendants,
    descendantIds: descendants.map((r) => r.id),
    withSubmap: descendants
      .filter((r) => r.submap != null)
      .map((r) => ({ id: r.id, name: r.name })),
  };
}

/**
 * 按计划删除后代，`root` **原样保留**（引用不变、`polygon` 逐点不变）。
 *
 * 返回新数组，不修改入参；返回顺序 = 原顺序过滤后（渲染 z 序不变）。
 *
 * 【为什么 `root` 必须同一个对象引用】① `polygon` 不重贴合是已定语义（PRD §6-C.4），
 * 顶点数不变意味着渲染缓存 key 不变、几何零重建；② 测试用 `===` 钉住"没被顺手改了"。
 */
export function applyMerge(regions: readonly MapRegion[], plan: MergePlan): MapRegion[] {
  const drop = new Set(plan.descendantIds);
  return regions.filter((r) => !drop.has(r.id));
}

/* ─────────────────────── 3) 几何谓词（自己写，禁引几何库） ─────────────────────── */

/**
 * 线段**真相交**（不含端点接触、不含共线重叠）。`eps` 缺省 `1e-9`。
 *
 * 【"真相交"是什么意思】两条线段在各自**内部**相交，即四个方向值两两异号。
 * 端点接触（T 形、首尾相接）与共线重叠都不算 —— 相邻边共享端点正是多边形合法形态，
 * 把它们算成相交会让每个正常多边形都"自交"。
 */
export function segmentsProperlyIntersect(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
  eps: number = EPS,
): boolean {
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  const straddle = (x: number, y: number) => (x > eps && y < -eps) || (x < -eps && y > eps);
  return straddle(d1, d2) && straddle(d3, d4);
}

/**
 * 多边形自交：任意两条**不相邻**的边真相交。相邻边（含首尾）共享端点不算。
 *
 * 【复杂度】O(n²)，但 n 是**手画顶点数**（正常 3~30，耐心上限约 200）。
 * n=200 ⇒ 2 万次线段测试，亚毫秒 —— 不值得为它建空间索引（架构 §2.3.1）。
 */
export function polygonSelfIntersects(polygon: readonly Point[], eps: number = EPS): boolean {
  const n = polygon.length;
  if (n < 4) return false; // 三角形不可能有"不相邻的两条边"
  for (let i = 0; i < n; i += 1) {
    const a1 = polygon[i];
    const a2 = polygon[(i + 1) % n];
    for (let j = i + 1; j < n; j += 1) {
      if (j === i + 1) continue; // 相邻（共享顶点）
      if (i === 0 && j === n - 1) continue; // 首尾相邻
      if (segmentsProperlyIntersect(a1, a2, polygon[j], polygon[(j + 1) % n], eps)) return true;
    }
  }
  return false;
}

/** 两多边形是否有任何一对边真相交（不做包含判定） */
export function polygonsEdgesCross(
  a: readonly Point[],
  b: readonly Point[],
  eps: number = EPS,
): boolean {
  if (a.length < 2 || b.length < 2) return false;
  for (let i = 0; i < a.length; i += 1) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j += 1) {
      if (segmentsProperlyIntersect(a1, a2, b[j], b[(j + 1) % b.length], eps)) return true;
    }
  }
  return false;
}

/**
 * 点是否在多边形内**或边界上**（边界用"到边距离 ≤ eps"判定，避免贴边误判为外）。
 *
 * 【为什么必须要"或边界上"】用户贴着父边界画是最常见的画法；生成器自身的残余缺陷
 * 会让父块折线在那里有亚像素级的细节，`pointInPolygon` 的射线法在边界上本来就没有
 * 稳定答案 —— 少了这半句，"完全在父块内"的合法多边形会被判成越界（架构 §6-3）。
 */
export function pointInPolygonOrOnEdge(
  p: Point,
  polygon: readonly Point[],
  eps: number = EDGE_EPS,
): boolean {
  if (polygon.length < 3) return false;
  if (pointInPolygon(p, polygon as Point[])) return true;
  for (let i = 0; i < polygon.length; i += 1) {
    if (distToSegment(p, polygon[i], polygon[(i + 1) % polygon.length]) <= eps) return true;
  }
  return false;
}

/**
 * 点是否**严格**落在多边形内部（边界上不算）。
 *
 * 【为什么不能只用 `pointInPolygon`】射线法对"正好落在顶点/边上"的点没有稳定答案
 * —— 两个共享一条边的方块，共享顶点会被判成"在内部"，于是共边被误判成重叠
 * （生成出来的兄弟区块本来就共用边界，误判会让手画"贴着兄弟画"全线被拒）。
 */
function pointStrictlyInside(p: Point, polygon: readonly Point[], eps: number): boolean {
  if (polygon.length < 3) return false;
  for (let i = 0; i < polygon.length; i += 1) {
    if (distToSegment(p, polygon[i], polygon[(i + 1) % polygon.length]) <= eps) return false;
  }
  return pointInPolygon(p, polygon as Point[]);
}

/**
 * 两多边形是否重叠 = 边相交 ∨ a 有顶点落在 b **内** ∨ b 有顶点落在 a **内**。
 *
 * 三种形态都覆盖：**穿越**（只有边相交）、**完全包含**（只有顶点在对方内）、
 * **一角落在内**（两者各命中一条）。
 *
 * 【为什么顶点用"严格在内部"而不是"在内部或边上"】共边**不算重叠**：生成出来的
 * 兄弟区块本来就严丝合缝共用边界，手画时"紧贴着一个兄弟往外画"也应被允许
 * （留缝/贴边合法；只有真正的面积重叠才会让填充 α 叠加变深、命中测试取最上层）。
 * 边相交用的是"真相交"，同样不含共线与端点接触。
 */
export function polygonsOverlap(
  a: readonly Point[],
  b: readonly Point[],
  eps: number = EDGE_EPS,
): boolean {
  if (a.length < 3 || b.length < 3) return false;
  if (polygonsEdgesCross(a, b, eps)) return true;
  for (const p of a) if (pointStrictlyInside(p, b, eps)) return true;
  for (const p of b) if (pointStrictlyInside(p, a, eps)) return true;
  return false;
}

/* ────────────────────────────── 4) 手画校验 ────────────────────────────── */

export type ManualRegionRejectCode =
  | "too-few-points" // 顶点 < 3
  | "degenerate-edge" // 相邻顶点重合（距离 ≤ eps）
  | "self-intersect" // 自交
  | "overlap-sibling" // 与同父兄弟相交
  | "overlap-ancestor" // 与祖先链上任一区块相交
  | "outside-parent" // 有边/顶点越出父多边形（容差外）
  | "level-out-of-range" // parent.level + 1 > levelCount - 1
  | "total-limit"; // 现有区块数 ≥ limit

export type ManualRegionCheck =
  | { ok: true; polygon: Point[] }
  | { ok: false; code: ManualRegionRejectCode; conflict?: { id: string; name: string } };

export interface ManualRegionCheckInput {
  /** 草稿顶点（世界坐标，首尾**不**重复） */
  polygon: readonly Point[];
  /** 选中的区块 = 新块的父；`null` = 画顶层（level 0） */
  parent: MapRegion | null;
  /** 当前文档的全部区块（含 sibling / ancestor，函数内部自己筛） */
  regions: readonly MapRegion[];
  /** `regionSchemaOf(doc).length` —— 层级上限的唯一来源 */
  levelCount: number;
  /** 总数护栏，缺省 `REGION_TOTAL_LIMIT` */
  limit?: number;
}

/**
 * 手画多边形落库前的**唯一校验入口**。
 *
 * 校验顺序（短路，第一个失败即返回）：
 *   degenerate-edge → too-few-points → total-limit → level-out-of-range
 *   → self-intersect → overlap-ancestor → overlap-sibling → outside-parent
 *
 * 顺序不是随意的：先做 O(n²) 以上的**开销**判断（顶点数、总数、层级），
 * 再进 O(n·m) 的**空间**判断（自交、重叠、包含）。用户最常犯的错（点重合、
 * 点太少、层级封顶）都在最前面，代价最低。
 *
 * 【`ok` 时返回的 `polygon` 是副本】落库对象不该与页面上的草稿数组共享引用 ——
 * 草稿下一次 `slice()` 或原地改写都不该动到已进文档的几何。
 */
export function checkManualRegion(input: ManualRegionCheckInput): ManualRegionCheck {
  const { polygon, parent, regions } = input;
  const limit = input.limit ?? REGION_TOTAL_LIMIT;
  const levelCount = input.levelCount;

  // ── 1) 相邻顶点重合（含首尾）：退化成一条线段的"多边形"在填充下会闪空洞 ──
  if (polygon.length > 1) {
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      if (Math.hypot(a.x - b.x, a.y - b.y) <= EDGE_EPS) {
        return { ok: false, code: "degenerate-edge" };
      }
    }
  }

  // ── 2) 顶点数 ──
  if (polygon.length < 3) return { ok: false, code: "too-few-points" };

  // ── 3) 总数护栏（渲染与内存的硬上限） ──
  if (regions.length >= limit) return { ok: false, code: "total-limit" };

  // ── 4) 层级封顶：`level` 不得超过 `levelCount - 1` ──
  const level = parent ? parent.level + 1 : 0;
  if (level > levelCount - 1) return { ok: false, code: "level-out-of-range" };

  // ── 5) 自交（even-odd 填充下会出空洞，与"地块"直觉冲突） ──
  if (polygonSelfIntersects(polygon)) return { ok: false, code: "self-intersect" };

  // ── 6) 跨出祖先边界 ──
  //
  // 【为什么用"边穿越"而不是 `polygonsOverlap`】新块必须落在 parent 内部，而
  // parent 恒落在祖先内部 ⇒ 新块与祖先**必然**"包含重叠"。若按重叠判定，任何
  // 合法的子块都会被拒（父块自己也不代表"越界"：它本来就在祖先里）。
  // 真正要拦的是"跨到树的另一个分支"：新块穿越了祖先的边界。
  // 贴着祖先边界画不会误判 —— "真相交"不含共线与端点接触。
  const ancestors = parent ? ancestorPathOf(regions, parent.id) : [];
  for (const ancestor of ancestors) {
    if (polygonsEdgesCross(polygon, ancestor.polygon, EDGE_EPS)) {
      return {
        ok: false,
        code: "overlap-ancestor",
        conflict: { id: ancestor.id, name: ancestor.name },
      };
    }
  }

  // ── 7) 与同父兄弟相交 ──
  //
  // 兄弟 = 同一个 parent 的直接子节点。parent 为 null 时"兄弟"就是顶层区块
  // （悬空 parentId 的脏行也算顶层，靠 `buildRegionChildIndex` 归一）。
  const childIndex = buildRegionChildIndex(regions);
  const siblingIds = childIndex.get(parent ? parent.id : null) ?? [];
  for (const siblingId of siblingIds) {
    if (parent && siblingId === parent.id) continue; // 防御：父块不会在自己的子列表里
    const sibling = regions.find((r) => r.id === siblingId);
    if (!sibling) continue;
    if (polygonsOverlap(polygon, sibling.polygon)) {
      return {
        ok: false,
        code: "overlap-sibling",
        conflict: { id: sibling.id, name: sibling.name },
      };
    }
  }

  // ── 8) 越出父多边形 ──
  //
  // 两种越界都要抓：顶点在外（"一角捅出去"）与边横穿父边界（凹父块里两点都在内、
  // 中间那段弦却跑出去了）。后者用"真相交"判定，因此贴着父边界画不会误判。
  if (parent) {
    const conflict = { id: parent.id, name: parent.name };
    for (const p of polygon) {
      if (!pointInPolygonOrOnEdge(p, parent.polygon)) {
        return { ok: false, code: "outside-parent", conflict };
      }
    }
    if (polygonsEdgesCross(polygon, parent.polygon, EDGE_EPS)) {
      return { ok: false, code: "outside-parent", conflict };
    }
  }

  return { ok: true, polygon: polygon.map((p) => ({ x: p.x, y: p.y })) };
}

/* ───────────────────────── 5) 落库字段（纯，确定性） ───────────────────────── */

/**
 * 该层级的序号 = 现有同层区块数 + 1。
 *
 * 【为什么不从已有 name 里解析序号】`name` 会被将来的重命名功能污染（R-REG-08），
 * 而序号只该由"现有多少块"决定。
 */
export function nextRegionOrdinal(regions: readonly MapRegion[], level: number): number {
  return regions.filter((r) => r.level === level).length + 1;
}

/** 展示名 `{层级名} {序号}`，与生成区同一口径（名字只来自 schema） */
export function manualRegionName(
  schema: readonly RegionLevelDef[] | undefined,
  level: number,
  ordinal: number,
): string {
  return `${levelLabelOf(schema, level)} ${ordinal}`;
}

/**
 * 手画区块 id 的**模块内单调计数器**。
 *
 * 【为什么不用 `Math.random()` / `Date.now()`】本文件是纯函数区，测试要对同一串输入
 * 复现同一份输出；随机 / 时钟会让"同种子同结果"这条可执行性质失效，也让快照比对
 * （`toEqual`）在跨用例时随机红。
 *
 * 【为什么计数器不会在测试间撞车】`doc.regions` 里的 id 只需要**在一份文档内唯一**：
 *   · 每个测试文件的模块实例互相独立（vitest 默认按文件隔离模块注册表），
 *     计数器各从 1 开始，互不可见；
 *   · 同一文件里的多个用例共享计数器，于是 id 只会越取越大 —— 撞车需要"回绕"，不存在；
 *   · 撤销/重做复用同一批对象引用，**不会重新生成 id**，所以"重做后 id 不变"天然成立。
 *
 * 【前缀 `rgm_`】与生成器的 id（`i0_…` / 子图 `sm_…`）在日志与快照里一眼可分；
 * 排查"这块钱是画的还是生成的"时不用去翻 `origin` 字段。
 */
let regionIdCounter = 0;

/** 手画区块的新 id（`rgm_` + 递增序号；见上方注释的不撞车理由） */
export function createRegionId(): string {
  regionIdCounter += 1;
  return `rgm_${regionIdCounter}`;
}

/**
 * 0xRRGGBB → HSL（h 度 0~360，s/l 为 0~1）。
 *
 * 【为什么还留着】`REGION_PALETTE` 是 HSL 三元组、`REGION_PALETTE_RGB` 由
 * `hslToRgb` 算出；本函数是那条换算的**反解**，`regionEdit.test.ts` 用往返一致性
 * 守住"色板算出来的 RGB 真的是那个颜色"（色相/饱和/明度任一环写错都会红）。
 * 手画取色已改成直接取色板，不再依赖它。
 */
export function rgbToHsl(rgb: number): { h: number; s: number; l: number } {
  const r = ((rgb >> 16) & 0xff) / 255;
  const g = ((rgb >> 8) & 0xff) / 255;
  const b = (rgb & 0xff) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  // 灰阶（含纯黑纯白）：色相无定义，统一读 0，饱和度 0
  if (d < 1e-9) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

/**
 * 手画取色用的黄金比步长：在色板里按序号跳格取色。
 *
 * 【0.618 而不是"序号 % 色板长度"】`ordinal % len` 会让相邻序号拿到颜色表里**相邻**
 * 的两格（赭红 → 土黄），而这两格正是最难分辨的一对；黄金比步长把相邻序号送到色板
 * 对角位置，手画连点几块也不会出现"两块几乎同色"。
 */
const GOLDEN_STEP = 0.6180339887;

/**
 * 手画取色（确定性，**不用 rng**）：从 `REGION_PALETTE_RGB` 里按序号跳格取一格。
 *
 * 【为什么与生成器共用同一张色板】手画的块和生成的块必须读起来是**同一张图上的
 * 同一种配色**。2.39.0 把生成器从"连续 HSL"改成离散色板之后，手画若还按色相偏移
 * 取色，同一张图上会出现两套色系（生成的块是色板色、手画的是中间色）。
 *
 * 【与父块同色时顺延一格】手画的父子只有"紧邻"这一层关系（父块是用户点中的那一块），
 * 撞色会直接读成"父块没被切开"，所以这里显式避开父块那一格。
 *
 * 【为什么不用 rng】生成器的 rng 是**串行流**：多取一个数会把整张图重排
 * （`regions.ts` 里 `buildChildren` 的取色注释有专项说明）。手画取色必须与生成流无关。
 */
export function manualRegionColor(input: { parentColor: number | null; ordinal: number }): number {
  const ordinal = Number.isFinite(input.ordinal) ? Math.max(1, Math.round(input.ordinal)) : 1;
  const len = REGION_PALETTE_RGB.length;
  let index = Math.round(((ordinal * GOLDEN_STEP) % 1) * (len - 1));
  index = Math.max(0, Math.min(len - 1, index));
  if (input.parentColor !== null && REGION_PALETTE_RGB[index] === input.parentColor) {
    index = (index + 1) % len;
  }
  return REGION_PALETTE_RGB[index];
}
