/**
 * 量纲 JSON 交换（REQ-022 / Phase 3 §7.2）
 *
 * Phase 3 给 levels 加了可选 `ratio`、config 加了可选 `alias` / `autoCarry`。
 * 交换格式的兼容策略是「按结构校验、新增字段全部可选」—— 这里钉住两条：
 * 1. **旧文件导入不丢**：v1 文件（无 ratio / alias）解析通过且字段原样保留，
 *    行为与升级前逐字节一致；
 * 2. **新字段 round-trip 不丢**：带 ratio / alias 的体系导出再导入，字段原样回来。
 *    `version` 不拦截（现状策略：结构校验，version 只是识别位）。
 */
import { describe, expect, it } from "vitest";
import { buildUnitsJson, parseUnitsJson, UNITS_FILE_KIND, UNITS_FILE_VERSION } from "./pack-units";
import type { PackUnitSystem } from "./types";

const system = (partial: Partial<PackUnitSystem>): PackUnitSystem => ({
  id: "u1",
  characterId: "c1",
  name: "熟练度",
  kind: "threshold",
  levels: "[]",
  config: '{ "use": "proficiency" }',
  isDefault: false,
  sortOrder: 1,
  ...partial,
});

describe("量纲 JSON 导入导出（Phase 3 兼容口径）", () => {
  it("旧文件（v1：levels 无 ratio、config 无 alias）导入不丢", () => {
    const oldFile = JSON.stringify({
      kind: UNITS_FILE_KIND,
      version: UNITS_FILE_VERSION,
      units: [
        {
          use: "proficiency",
          kind: "threshold",
          name: "熟练度",
          levels: [
            { name: "入门", min: 0, max: 99 },
            { name: "精通", min: 100, max: null },
          ],
        },
      ],
    });
    const result = parseUnitsJson(oldFile);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.units).toHaveLength(1);
    expect(result.units[0].levels).toEqual([
      { name: "入门", min: 0, max: 99 },
      { name: "精通", min: 100, max: null },
    ]);
  });

  it("带 ratio / alias / autoCarry 的新体系 round-trip 不丢字段", () => {
    const levels = [
      { name: "入门", min: 0, max: null, ratio: 100 },
      { name: "重", min: 0, max: null },
    ];
    const json = buildUnitsJson([
      system({
        levels: JSON.stringify(levels),
        config: '{ "use": "proficiency", "alias": "修为", "autoCarry": false }',
      }),
    ]);
    const result = parseUnitsJson(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.units[0].levels).toEqual(levels);
    expect(result.units[0].config).toEqual({
      alias: "修为",
      autoCarry: false,
    });
  });

  it("version 不做拦截（结构校验策略，version 只是识别位）", () => {
    const future = JSON.stringify({
      kind: UNITS_FILE_KIND,
      version: 999,
      units: [{ use: "currency", kind: "ratio", name: "货币", levels: [] }],
    });
    expect(parseUnitsJson(future).ok).toBe(true);
  });
});
