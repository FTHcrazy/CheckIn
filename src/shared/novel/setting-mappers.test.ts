import { describe, expect, it } from "vitest";
import {
  toSettingCategory,
  toSettingLevel,
  type SettingCategoryDTO,
  type SettingLevelDTO,
} from "./setting-mappers";
import type { SettingCategory, SettingLevel } from "./setting-types";

/**
 * 逐字段 diff 证明（N-06 改造前后等价）：
 *
 * 下方 `legacyNovelPageMap` / `legacyGlobalToCategory` + `legacyGlobalToLevel`
 * 是改造前两处**原样复刻**的实现。测试断言：同一份合法 DTO 经唯一实现
 * `toSettingCategory(dto, { workId: "", withRefCount: true })` 得到的对象，
 * 与两处旧实现逐字段（含键集合、含嵌套 levels）完全相等。
 */

// ── 改造前实现：NovelPage.refreshGlobalCategories（无兜底） ──
function legacyNovelPageMap(item: SettingCategoryDTO): Record<string, unknown> {
  return {
    id: item.id,
    workId: "",
    name: item.name,
    color: item.color,
    kind: item.kind,
    sortOrder: item.sortOrder,
    note: item.note,
    subLevels: item.subLevels,
    carryDir: item.carryDir,
    subPattern: item.subPattern,
    refCount: item.refCount,
    levels: (item.levels as SettingLevelDTO[]).map((level) => ({
      id: level.id,
      categoryId: level.categoryId,
      name: level.name,
      rank: level.rank,
      aliases: level.aliases,
      note: level.note,
      subLevels: level.subLevels,
      subPattern: level.subPattern,
      power: level.power,
      parentId: level.parentId,
      segFrom: level.segFrom,
      segTo: level.segTo,
    })),
  };
}

// ── 改造前实现：useGlobalSetting.toLevel / toCategory（有兜底） ──
function legacyGlobalToLevel(dto: SettingLevelDTO): SettingLevel {
  return {
    id: dto.id,
    categoryId: dto.categoryId,
    name: dto.name,
    rank: dto.rank,
    aliases: Array.isArray(dto.aliases) ? dto.aliases : [],
    note: dto.note ?? "",
    subLevels: dto.subLevels ?? 1,
    subPattern: dto.subPattern ?? "",
    power: dto.power ?? null,
    parentId: dto.parentId ?? null,
    segFrom: dto.segFrom ?? null,
    segTo: dto.segTo ?? null,
  };
}

function legacyGlobalToCategory(dto: SettingCategoryDTO): SettingCategory {
  return {
    id: dto.id,
    workId: "",
    name: dto.name,
    color: dto.color,
    kind: dto.kind === "realm" ? "realm" : "custom",
    sortOrder: dto.sortOrder,
    note: dto.note ?? "",
    subLevels: dto.subLevels ?? 1,
    carryDir: dto.carryDir === "desc" ? "desc" : "asc",
    subPattern: dto.subPattern ?? "",
    levels: (dto.levels ?? []).map(legacyGlobalToLevel),
    refCount: dto.refCount ?? 0,
  };
}

/** 递归按键名排序，用于「逐字段 + 键集合」比较（忽略键顺序，`toEqual` 亦忽略但显式更稳） */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) sorted[key] = canonical(source[key]);
    return sorted;
  }
  return value;
}

/** 一份「合法、字段齐全」的全局库分类 DTO（realm + desc + 两个等级项） */
const fullDto: SettingCategoryDTO = {
  id: "gsc-1",
  name: "境界体系",
  color: "#7c5cff",
  kind: "realm",
  sortOrder: 1,
  note: "修炼境界",
  subLevels: 9,
  carryDir: "desc",
  subPattern: "第{n}层",
  refCount: 3,
  levels: [
    {
      id: "gsl-1",
      categoryId: "gsc-1",
      name: "九品",
      rank: 1,
      aliases: ["九品境"],
      note: "最低",
      subLevels: 3,
      subPattern: "第{n}重",
      power: 10,
      parentId: null,
      segFrom: null,
      segTo: null,
    },
    {
      id: "gsl-2",
      categoryId: "gsc-1",
      name: "一品",
      rank: 2,
      aliases: [],
      note: "",
      subLevels: 1,
      subPattern: "",
      power: null,
      parentId: "gsl-1",
      segFrom: 1,
      segTo: 3,
    },
  ],
};

describe("toSettingCategory / toSettingLevel（N-06）", () => {
  it("合法 DTO：与改造前 NovelPage 内联映射逐字段相等", () => {
    const actual = toSettingCategory(fullDto, { workId: "", withRefCount: true });
    const legacy = legacyNovelPageMap(fullDto);
    expect(canonical(actual)).toEqual(canonical(legacy));
    expect(Object.keys(actual).sort()).toEqual(Object.keys(legacy).sort());
    expect(JSON.stringify(canonical(actual))).toBe(JSON.stringify(canonical(legacy)));
  });

  it("合法 DTO：与改造前 useGlobalSetting 的 toCategory 逐字段相等", () => {
    const actual = toSettingCategory(fullDto, { workId: "", withRefCount: true });
    const legacy = legacyGlobalToCategory(fullDto);
    expect(canonical(actual)).toEqual(canonical(legacy));
    expect(Object.keys(actual).sort()).toEqual(Object.keys(legacy).sort());
  });

  it("默认（不传 options）：沿用 DTO 自带 workId，且不带 refCount 键", () => {
    const dto: SettingCategoryDTO = { ...fullDto, workId: "w1" };
    const result = toSettingCategory(dto);
    expect(result.workId).toBe("w1");
    expect("refCount" in result).toBe(false);
  });

  it("缺字段 DTO：一律走兜底，绝不产出 undefined（改造后更强）", () => {
    const sparse: SettingCategoryDTO = {
      id: "gsc-2",
      name: "功法",
      color: "#0a0",
      sortOrder: 2,
      levels: [{ id: "l1", categoryId: "gsc-2", name: "黄阶", rank: 1 }],
    };
    const result = toSettingCategory(sparse, { workId: "", withRefCount: true });

    expect(result).toEqual({
      id: "gsc-2",
      workId: "",
      name: "功法",
      color: "#0a0",
      kind: "custom",
      sortOrder: 2,
      note: "",
      subLevels: 1,
      carryDir: "asc",
      subPattern: "",
      refCount: 0,
      levels: [
        {
          id: "l1",
          categoryId: "gsc-2",
          name: "黄阶",
          rank: 1,
          aliases: [],
          note: "",
          subLevels: 1,
          subPattern: "",
          power: null,
          parentId: null,
          segFrom: null,
          segTo: null,
        },
      ],
    });
    // 关键：没有键的值为 undefined（旧 NovelPage 实现会把 undefined 带出来）
    for (const value of Object.values(result)) expect(value).not.toBeUndefined();
  });

  it("levels 非数组：回退空数组，不抛错", () => {
    const broken = {
      id: "gsc-3",
      name: "坏数据",
      color: "#000",
      sortOrder: 3,
      levels: "not-an-array",
    } as unknown as SettingCategoryDTO;
    expect(() => toSettingCategory(broken)).not.toThrow();
    expect(toSettingCategory(broken).levels).toEqual([]);
  });

  it("levels 为 null：回退空数组", () => {
    const dto: SettingCategoryDTO = {
      id: "gsc-4",
      name: "空",
      color: "#111",
      sortOrder: 4,
      levels: null,
    };
    expect(toSettingCategory(dto).levels).toEqual([]);
  });

  it("aliases 非数组：回退空数组（toSettingLevel）", () => {
    const dto = {
      id: "l9",
      categoryId: "gsc-1",
      name: "名字",
      rank: 1,
      aliases: "别名",
    } as unknown as SettingLevelDTO;
    expect(toSettingLevel(dto).aliases).toEqual([]);
  });

  it("kind / carryDir 只认白名单：非 realm → custom，非 desc → asc", () => {
    const dto: SettingCategoryDTO = {
      id: "gsc-5",
      name: "x",
      color: "#222",
      sortOrder: 5,
      kind: "unknown",
      carryDir: "sideways",
    };
    const result = toSettingCategory(dto);
    expect(result.kind).toBe("custom");
    expect(result.carryDir).toBe("asc");
  });

  it("DTO 带 sourceGlobalId / detachedFromName（本书域形态）时原样带出", () => {
    const dto: SettingCategoryDTO = {
      ...fullDto,
      workId: "w1",
      sourceGlobalId: "gsc-1",
      detachedFromName: "旧名",
    };
    const result = toSettingCategory(dto);
    expect(result.workId).toBe("w1");
    expect(result.sourceGlobalId).toBe("gsc-1");
    expect(result.detachedFromName).toBe("旧名");
  });

  it("全局形态：不带 sourceGlobalId / detachedFromName 键", () => {
    const result = toSettingCategory(fullDto, { workId: "", withRefCount: true });
    expect("sourceGlobalId" in result).toBe(false);
    expect("detachedFromName" in result).toBe(false);
  });
});
