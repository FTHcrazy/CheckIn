/**
 * map-terrain 单测（PRD §6：纯函数独立文件 + vitest 单测）
 *
 * 覆盖：
 * - 复现性：同 seed 同约束必出同图（RM8③）
 * - 约束边界：三面环海确实三面入海 / 北境雪原确实北方有雪
 * - 空池降级：无约束也能生成合理地形
 * - 河流入海：有 bigRiver 时河流 features 存在
 */
import { describe, it, expect } from "vitest";
import {
  buildWorld,
  hashSeed,
  randomSeed,
  pruneStaleRivers,
  T_DESERT,
  T_GRASS,
  T_RIVER,
  T_SEA,
  T_SNOW,
  T_SNOWFIELD,
  type TerrainFeature,
  type TerrainTemplates,
} from "./map-terrain";

describe("map-terrain hashSeed", () => {
  it("同字符串必出同数", () => {
    expect(hashSeed("4F2A19")).toBe(hashSeed("4F2A19"));
  });

  it("不同字符串出不同数", () => {
    expect(hashSeed("4F2A19")).not.toBe(hashSeed("4F2A20"));
  });
});

describe("map-terrain randomSeed", () => {
  it("返回 6 位大写十六进制", () => {
    const s = randomSeed();
    expect(s).toMatch(/^[0-9A-F]{6}$/);
  });
});

describe("map-terrain buildWorld 复现性", () => {
  const opt = {
    cols: 32,
    rows: 20,
    seed: "4F2A19",
    templates: { threeSea: true, northSnow: true } as TerrainTemplates,
  };

  it("同 seed 同约束必出同图", () => {
    const a = buildWorld(opt);
    const b = buildWorld(opt);
    expect(Array.from(a.cells)).toEqual(Array.from(b.cells));
  });

  it("不同 seed 出不同图", () => {
    const a = buildWorld(opt);
    const b = buildWorld({ ...opt, seed: "DIFFERENT" });
    expect(Array.from(a.cells)).not.toEqual(Array.from(b.cells));
  });
});

describe("map-terrain buildWorld 约束边界", () => {
  const cols = 48;
  const rows = 30;

  it("三面环海：西/东/南三侧边缘入海", () => {
    const w = buildWorld({
      cols,
      rows,
      seed: "SEA001",
      templates: { threeSea: true },
    });
    // 左边一列、右边一列、底边一行应当多数是海
    let leftSea = 0;
    let rightSea = 0;
    let bottomSea = 0;
    for (let r = 0; r < rows; r++) {
      if (w.cells[r * cols] === T_SEA) leftSea++;
      if (w.cells[r * cols + cols - 1] === T_SEA) rightSea++;
    }
    for (let c = 0; c < cols; c++) {
      if (w.cells[(rows - 1) * cols + c] === T_SEA) bottomSea++;
    }
    expect(leftSea).toBeGreaterThan(rows * 0.5);
    expect(rightSea).toBeGreaterThan(rows * 0.5);
    expect(bottomSea).toBeGreaterThan(cols * 0.5);
  });

  it("北境雪原：北方有雪原/雪山", () => {
    const w = buildWorld({
      cols,
      rows,
      seed: "SNOW01",
      templates: { northSnow: true },
    });
    // 顶边 5 行内至少有一个雪原/雪山
    let snowCount = 0;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < cols; c++) {
        const t = w.cells[r * cols + c];
        if (t === T_SNOW || t === T_SNOWFIELD) snowCount++;
      }
    }
    expect(snowCount).toBeGreaterThan(0);
  });
});

describe("map-terrain buildWorld 空池降级", () => {
  it("无约束也能生成全陆/海分布合理", () => {
    const w = buildWorld({
      cols: 32,
      rows: 20,
      seed: "PLAIN01",
      templates: {},
    });
    expect(w.cells.length).toBe(32 * 20);
    // 至少有海和陆地
    const hasSea = Array.from(w.cells).includes(T_SEA);
    const hasLand = Array.from(w.cells).some((t) => t !== T_SEA);
    expect(hasSea).toBe(true);
    expect(hasLand).toBe(true);
  });
});

describe("map-terrain buildWorld 河流", () => {
  it("有 bigRiver 时河流 features 存在", () => {
    // 用设计稿验证过的可靠参数：64×40 + 三面环海 + 北境雪原（保证有雪山源头）+ 大河
    const w = buildWorld({
      cols: 64,
      rows: 40,
      seed: "4F2A19",
      templates: { bigRiver: true, threeSea: true, northSnow: true },
    });
    const rivers = w.features.filter((f) => f.type === "river");
    expect(rivers.length).toBeGreaterThan(0);
  });
});

describe("pruneStaleRivers（手改地形后的一致性校验）", () => {
  const COLS = 4;
  const ROWS = 3;
  const CELL = 16;

  /** 沿 (0,1)-(3,1) 铺一条水平河道，返回世界像素坐标的 pts */
  function riverPts(): number[] {
    const pts: number[] = [];
    for (let c = 0; c < COLS; c++) {
      pts.push((c + 0.5) * CELL, 1.5 * CELL);
    }
    return pts;
  }

  function river(): TerrainFeature {
    return { id: "r1", type: "river", pts: riverPts() };
  }

  it("河道仍在时保留河流 feature", () => {
    const cells = new Array(COLS * ROWS).fill(T_GRASS);
    for (let c = 0; c < COLS; c++) cells[1 * COLS + c] = T_RIVER;
    const out = pruneStaleRivers([river()], cells, COLS, ROWS, CELL);
    expect(out.length).toBe(1);
  });

  it("河道被涂成沙漠后丢弃该 feature（修复「河悬在沙漠上」）", () => {
    const cells = new Array(COLS * ROWS).fill(T_DESERT);
    const out = pruneStaleRivers([river()], cells, COLS, ROWS, CELL);
    expect(out.length).toBe(0);
  });

  it("非河流要素不受影响", () => {
    const cells = new Array(COLS * ROWS).fill(T_SEA);
    const cliff: TerrainFeature = {
      id: "c1",
      type: "cliff",
      points: [{ x: 8, y: 8 }],
    };
    const out = pruneStaleRivers([cliff], cells, COLS, ROWS, CELL);
    expect(out.length).toBe(1);
    expect(out[0].id).toBe("c1");
  });

  it("异常数据（无采样点）按保留处理，不误删用户内容", () => {
    const cells = new Array(COLS * ROWS).fill(T_DESERT);
    const empty: TerrainFeature = { id: "r2", type: "river", pts: [] };
    const out = pruneStaleRivers([empty], cells, COLS, ROWS, CELL);
    expect(out.length).toBe(1);
  });
});

describe("map-terrain buildWorld flat 子图", () => {
  it("flat 模式不生成山地雪峰", () => {
    const w = buildWorld({
      cols: 30,
      rows: 20,
      seed: "TOWN001",
      templates: {},
      flat: true,
    });
    // flat 模式下山地/雪山占比应远低于正常模式
    const mountainCount = Array.from(w.cells).filter(
      (t) => t === T_SNOW || t === 6,
    ).length;
    expect(mountainCount).toBeLessThan(w.cells.length * 0.1);
  });
});
