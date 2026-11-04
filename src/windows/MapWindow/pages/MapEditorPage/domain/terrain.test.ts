import { describe, expect, it } from "vitest";
import { isTerrainKind, TERRAIN_KINDS, TERRAIN_META, type TerrainKind } from "./terrain";

/**
 * 地形枚举层单元测试（架构 §三 / §十二.3）。
 *
 * 核心不变量：
 *  - META 完整：每个枚举键都有中文名 + 非空地名池（批量起名的底料不能缺）；
 *  - 回退链无环：DFS 沿 fallbacks 走必须能终止（有环 = 选材引擎死循环风险）；
 *  - 枚举收敛口：isTerrainKind 是 AI / 外部输入的唯一闸门，枚举外必须拒绝。
 */
describe("TERRAIN_META 完整性", () => {
  it("每个枚举键都有元信息：中文名非空、地名池非空", () => {
    for (const kind of TERRAIN_KINDS) {
      const meta = TERRAIN_META[kind];
      expect(meta, `${kind} 缺元信息`).toBeDefined();
      expect(meta.label.trim(), `${kind} 中文名为空`).not.toBe("");
      expect(meta.namePool.length, `${kind} 地名池为空`).toBeGreaterThan(0);
      for (const name of meta.namePool) {
        expect(name.trim(), `${kind} 地名池有空白项`).not.toBe("");
      }
    }
  });

  it("TERRAIN_KINDS 与 TERRAIN_META 键集合一致（无孤儿键/漏键）", () => {
    expect(TERRAIN_KINDS.length).toBe(Object.keys(TERRAIN_META).length);
    for (const kind of TERRAIN_KINDS) {
      expect(TERRAIN_META[kind]).toBeDefined();
    }
  });
});

describe("回退链无环", () => {
  it("从任一地形沿 fallbacks DFS 不会回到当前路径上的节点（灰点栈检测，DAG 汇合不算环）", () => {
    const GREY = new Set<TerrainKind>(); // 当前 DFS 路径上
    const BLACK = new Set<TerrainKind>(); // 已完成、确认无环的子树
    const visit = (kind: TerrainKind, path: TerrainKind[]): void => {
      if (BLACK.has(kind)) return;
      expect(
        GREY.has(kind),
        `回退链有环：${[...path, kind].join(" → ")}`,
      ).toBe(false);
      GREY.add(kind);
      for (const fb of TERRAIN_META[kind].fallbacks) visit(fb, [...path, kind]);
      GREY.delete(kind);
      BLACK.add(kind);
    };
    for (const kind of TERRAIN_KINDS) visit(kind, []);
  });

  it("回退链不含自身（自身已在首轮抽取里用过，无需重复）", () => {
    for (const kind of TERRAIN_KINDS) {
      expect(TERRAIN_META[kind].fallbacks, `${kind} 回退链含自身`).not.toContain(kind);
    }
  });
});

describe("isTerrainKind 收敛口", () => {
  it("枚举内取值放行", () => {
    for (const kind of TERRAIN_KINDS) expect(isTerrainKind(kind)).toBe(true);
  });

  it("枚举外取值一律拒绝（防 AI 造词穿透类型系统，架构 §八）", () => {
    expect(isTerrainKind("savanna")).toBe(false);
    expect(isTerrainKind("swamp2")).toBe(false);
    expect(isTerrainKind("")).toBe(false);
    expect(isTerrainKind("Swamp")).toBe(false);
    expect(isTerrainKind(42)).toBe(false);
    expect(isTerrainKind(null)).toBe(false);
    expect(isTerrainKind(undefined)).toBe(false);
    expect(isTerrainKind({ terrain: "swamp" })).toBe(false);
  });
});
