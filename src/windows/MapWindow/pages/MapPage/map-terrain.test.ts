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
  buildOverlayFeatures,
  hashSeed,
  randomSeed,
  pruneStaleRivers,
  worldFromContent,
  CELL,
  OVERLAY_TYPES,
  T_DESERT,
  T_GRASS,
  T_LAVA,
  T_MARSH,
  T_MOUNTAIN,
  T_RIVER,
  T_RUINS,
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
    const island: TerrainFeature = {
      id: "i1",
      type: "island",
      points: [{ x: 8, y: 8 }],
      cells: [0],
    };
    const out = pruneStaleRivers([island], cells, COLS, ROWS, CELL);
    expect(out.length).toBe(1);
    expect(out[0].id).toBe("i1");
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

// ─────────────────────────────────────────────────────────────
// 热门小说格局模板（RM8 拓展）
// ─────────────────────────────────────────────────────────────

const COLS = 80;
const ROWS = 50;

function ratio(w: ReturnType<typeof buildWorld>, types: number[]): number {
  let n = 0;
  for (const c of w.cells) if (types.includes(c)) n++;
  return n / w.cells.length;
}

function edgeSeaRatio(w: ReturnType<typeof buildWorld>, side: "left" | "right" | "top" | "bottom"): number {
  const { cols, rows, cells } = w;
  let sea = 0;
  let total = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const onEdge =
        (side === "left" && c === 0) ||
        (side === "right" && c === cols - 1) ||
        (side === "top" && r === 0) ||
        (side === "bottom" && r === rows - 1);
      if (!onEdge) continue;
      total++;
      if (cells[r * cols + c] === T_SEA) sea++;
    }
  }
  return total ? sea / total : 0;
}

describe("map-terrain 热门小说格局模板", () => {
  it("中央大陆（九州）：四周边缘大面积临海", () => {
    const w = buildWorld({ cols: COLS, rows: ROWS, seed: "JZ0001", templates: { centralContinent: true } });
    for (const s of ["left", "right", "top", "bottom"] as const) {
      expect(edgeSeaRatio(w, s)).toBeGreaterThan(0.5);
    }
  });

  it("群岛海域：海域占比显著高于默认（> 58%）", () => {
    const w = buildWorld({ cols: COLS, rows: ROWS, seed: "QD0001", templates: { archipelago: true } });
    expect(ratio(w, [T_SEA])).toBeGreaterThan(0.58);
  });

  it("十万大山：山地占比 ≥ 默认格局的 1.8 倍", () => {
    const base = buildWorld({ cols: COLS, rows: ROWS, seed: "MT0001", templates: {} });
    const mt = buildWorld({ cols: COLS, rows: ROWS, seed: "MT0001", templates: { tenThousandMountains: true } });
    const baseM = ratio(base, [T_MOUNTAIN, T_SNOW]);
    const mtM = ratio(mt, [T_MOUNTAIN, T_SNOW]);
    expect(baseM).toBeGreaterThan(0.05);
    expect(mtM).toBeGreaterThan(baseM * 1.8);
  });

  it("南疆沼泽：产出沼泽且集中在南部", () => {
    const w = buildWorld({ cols: COLS, rows: ROWS, seed: "SW0001", templates: { southSwamp: true } });
    expect(ratio(w, [T_MARSH])).toBeGreaterThan(0.02);
    let north = 0;
    let south = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        if (w.cells[r * COLS + c] !== T_MARSH) continue;
        if (r < ROWS / 2) north++;
        else south++;
      }
    }
    expect(south).toBeGreaterThan(north * 2);
  });

  it("赤炎火山：产出熔岩且成规模", () => {
    const w = buildWorld({ cols: COLS, rows: ROWS, seed: "VC0001", templates: { volcanic: true } });
    expect(ratio(w, [T_LAVA])).toBeGreaterThan(0.03);
  });

  it("古战场废墟：产出废墟地形", () => {
    const w = buildWorld({ cols: COLS, rows: ROWS, seed: "RU0001", templates: { ruinFields: true } });
    expect(ratio(w, [T_RUINS])).toBeGreaterThan(0.04);
  });

  it("千里平原：几乎不生成山地", () => {
    const w = buildWorld({ cols: COLS, rows: ROWS, seed: "PL0001", templates: { plains: true } });
    expect(ratio(w, [T_MOUNTAIN, T_SNOW])).toBeLessThan(0.02);
  });

  it("裂谷天堑：谷道（裂谷中线一带）平均高程低于全图", () => {
    const w = buildWorld({ cols: COLS, rows: ROWS, seed: "RC0001", templates: { riftCanyon: true } });
    let all = 0;
    let inRiftSum = 0;
    let inRiftN = 0;
    for (let r = 0; r < ROWS; r++) {
      const ny = r / (ROWS - 1);
      const cxr = 0.5 + 0.17 * Math.sin(ny * 5.2 + 0.7) + 0.06 * Math.sin(ny * 11.3);
      for (let c = 0; c < COLS; c++) {
        const nx = c / (COLS - 1);
        const e = w.elev[r * COLS + c];
        all += e;
        if (Math.abs(nx - cxr) < 0.085) {
          inRiftSum += e;
          inRiftN++;
        }
      }
    }
    expect(inRiftN).toBeGreaterThan(0);
    expect(inRiftSum / inRiftN).toBeLessThan(all / (COLS * ROWS));
  });

  it("全部模板逐个可用且不崩（含互相冲突的组合）", () => {
    const keys: Array<keyof TerrainTemplates> = [
      "threeSea", "island", "centralContinent", "westDesert", "northSnow",
      "centerLake", "bigRiver", "barren", "tenThousandMountains", "southSwamp",
      "volcanic", "riftCanyon", "archipelago", "eastWaste", "ruinFields", "plains",
    ];
    for (const k of keys) {
      const w = buildWorld({
        cols: 40,
        rows: 25,
        seed: "ALL001",
        templates: { [k]: true } as TerrainTemplates,
      });
      expect(w.cells.length).toBe(40 * 25);
      expect(Array.from(w.cells).some((t) => t === T_SEA)).toBe(true);
    }
    const both = buildWorld({
      cols: 40,
      rows: 25,
      seed: "ALL002",
      templates: { island: true, centralContinent: true, tenThousandMountains: true, plains: true },
    });
    expect(both.cells.length).toBe(40 * 25);
  });
});

// ─────────────────────────────────────────────────────────────
// 叠加型符号派生（岛屿 / 瀑布；悬崖已移除）
// ─────────────────────────────────────────────────────────────

describe("buildOverlayFeatures：悬崖符号已移除，只剩岛屿 / 瀑布", () => {
  /** 6×5 网格，左上 3×3 为山地，其余草原 */
  function grid(): { cols: number; rows: number; cells: number[] } {
    const cols = 6;
    const rows = 5;
    const cells = new Array(cols * rows).fill(T_GRASS);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) cells[r * cols + c] = T_MOUNTAIN;
    return { cols, rows, cells };
  }

  it("山地与低地交界不再产出任何 cliff 要素（等高线梳齿噪声已移除）", () => {
    const { cols, rows, cells } = grid();
    const feats = buildOverlayFeatures({ cols, rows, cells, seed: 1 });
    expect(feats.filter((f) => (f.type as string) === "cliff").length).toBe(0);
  });

  it("OVERLAY_TYPES 只剩岛屿 / 瀑布（回归守卫）", () => {
    expect([...OVERLAY_TYPES]).toEqual(["island", "waterfall"]);
  });

  it("确定性：同 cells 同 seed 必出同结果", () => {
    const { cols, rows, cells } = grid();
    const pts: number[] = [];
    for (let c = 0; c < cols; c++) pts.push((c + 0.5) * CELL, 0.5 * CELL);
    const rivers: TerrainFeature[] = [{ id: "r", type: "river", pts }];
    const a = buildOverlayFeatures({ cols, rows, cells, rivers, seed: 9 });
    const b = buildOverlayFeatures({ cols, rows, cells, rivers, seed: 9 });
    // 该图有河流跨越山脚 ⇒ 必有瀑布，避免测试空转
    expect(a.length).toBeGreaterThan(0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("纯草原图不凭空造符号（叠加层为空）", () => {
    const feats = buildOverlayFeatures({
      cols: 5,
      rows: 4,
      cells: new Array(20).fill(T_GRASS),
      seed: 3,
    });
    expect(feats.length).toBe(0);
  });
});

describe("buildOverlayFeatures 瀑布：只在河道跨越高差处", () => {
  const cols = 12;
  const rows = 6;
  const cells = new Array(cols * rows).fill(T_GRASS);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) cells[r * cols + c] = T_MOUNTAIN;

  const riverAt = (row: number): TerrainFeature => {
    const pts: number[] = [];
    for (let c = 0; c < cols; c++) pts.push((c + 0.5) * CELL, (row + 0.5) * CELL);
    return { id: "r", type: "river", pts };
  };

  /** 南北落差图：山在北，草原在南，河沿某列自北向南 */
  function northSouthMountainRiver(col: number): TerrainFeature {
    const pts: number[] = [];
    for (let r = 0; r < 6; r++) pts.push((col + 0.5) * CELL, (r + 0.5) * CELL);
    return { id: "rn", type: "river", pts };
  }
  const nsCells = new Array(6 * 6).fill(T_GRASS);
  for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) nsCells[r * 6 + c] = T_MOUNTAIN;

  it("河道穿过高差格边 → 生成瀑布，且落点在格边（崖唇）上", () => {
    const feats = buildOverlayFeatures({ cols, rows, cells, rivers: [riverAt(1)], seed: 7 });
    const wf = feats.filter((f) => f.type === "waterfall");
    expect(wf.length).toBe(1);
    const p = wf[0].points?.[0] as { x: number; y: number };
    // 崖唇 = 格边中点 ⇒ 必有一个坐标落在格边界（CELL 的整数倍）
    expect(p.x % CELL === 0 || p.y % CELL === 0).toBe(true);
  });

  it("瀑布带跌落方向 angle，且指向低侧（山地之右为草原 → +x）", () => {
    const wf = buildOverlayFeatures({ cols, rows, cells, rivers: [riverAt(1)], seed: 7 }).filter(
      (f) => f.type === "waterfall",
    );
    expect(wf.length).toBe(1);
    const a = wf[0].angle ?? NaN;
    expect(Math.cos(a)).toBeGreaterThan(0.9);
    expect(Math.abs(Math.sin(a))).toBeLessThan(0.1);
  });

  it("南北落差（山在北、草原在南）→ 水帘朝 +y（π/2）跌落", () => {
    const feats = buildOverlayFeatures({
      cols: 6,
      rows: 6,
      cells: nsCells,
      rivers: [northSouthMountainRiver(2)],
      seed: 5,
    });
    const wf = feats.filter((f) => f.type === "waterfall");
    expect(wf.length).toBe(1);
    expect(wf[0].angle).toBeCloseTo(Math.PI / 2, 5);
  });

  it("河道远离高差处 → 不生成瀑布（修复「白竖线漂在湖面」）", () => {
    const feats = buildOverlayFeatures({ cols, rows, cells, rivers: [riverAt(5)], seed: 7 });
    expect(feats.filter((f) => f.type === "waterfall").length).toBe(0);
  });

  it("无河流 feature 则不生成瀑布", () => {
    const feats = buildOverlayFeatures({ cols, rows, cells, seed: 7 });
    expect(feats.filter((f) => f.type === "waterfall").length).toBe(0);
  });

  it("瀑布数量上限为 2，且互不相邻", () => {
    const rivers = [riverAt(0), riverAt(1), riverAt(2)];
    const wf = buildOverlayFeatures({ cols, rows, cells, rivers, seed: 7 }).filter(
      (f) => f.type === "waterfall",
    );
    expect(wf.length).toBeLessThanOrEqual(2);
    if (wf.length === 2) {
      const [a, b] = wf;
      const d = Math.hypot(
        (a.points?.[0].x ?? 0) - (b.points?.[0].x ?? 0),
        (a.points?.[0].y ?? 0) - (b.points?.[0].y ?? 0),
      );
      expect(d).toBeGreaterThanOrEqual(CELL * 8);
    }
  });
});

describe("worldFromContent：叠加型符号由 cells 派生（旧档自愈）", () => {
  it("存档里的 cliff/waterfall 旧值被忽略，改由 cells 重算；河流 pts 原样保留", () => {
    const cols = 8;
    const rows = 5;
    const cells = new Array(cols * rows).fill(T_GRASS);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) cells[r * cols + c] = T_MOUNTAIN;
    const riverPts: number[] = [];
    for (let c = 0; c < cols; c++) riverPts.push((c + 0.5) * CELL, 1.5 * CELL);
    for (let c = 0; c < cols; c++) cells[1 * cols + c] = T_RIVER;
    // 旧档里存在 cliff（类型已从 TerrainFeature 移除）→ 用宽松字面量还原，
    // 验证读取时被忽略、且不会把已删除的符号重新画出来
    const legacy = [
      { id: "c0", type: "cliff", points: [{ x: 20, y: 30 }] },
      { id: "w0", type: "waterfall", points: [{ x: 3, y: 3 }] },
      { id: "r0", type: "river", pts: riverPts },
    ] as unknown as Parameters<typeof worldFromContent>[0]["features"];
    const w = worldFromContent({ cols, rows, cells, features: legacy, seed: "OLD001" });
    // 悬崖这一地形已删除 ⇒ 任何情况下都不该再出现 cliff
    expect(w.features.some((f) => (f.type as string) === "cliff")).toBe(false);
    // 旧瀑布 id 不再出现（由 cells 重新派生）
    expect(w.features.some((f) => f.id === "w0")).toBe(false);
    expect(w.features.some((f) => f.id === "c0")).toBe(false);
    // 派生出的瀑布带跌落方向
    const wf = w.features.filter((f) => f.type === "waterfall");
    expect(wf.length).toBeGreaterThan(0);
    for (const f of wf) expect(typeof f.angle).toBe("number");
    // 河流（含 pts）保留 —— 旧实现漏掉 pts 导致重开图后河流 ribbon 消失
    const rv = w.features.find((f) => f.type === "river");
    expect(rv?.pts?.length).toBe(riverPts.length);
  });
});
