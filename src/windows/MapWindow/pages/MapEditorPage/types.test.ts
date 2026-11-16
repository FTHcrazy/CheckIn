import { describe, expect, it } from "vitest";
import { createEmptyDocument, elementFlipXOf, migrateDoc } from "./types";
import { DEFAULT_REGION_SCHEMA, normalizeRegionSchema, regionSchemaOf } from "./regions";

/**
 * 老文档兼容（R-REG-01 边界③）—— `migrateDoc` 与 `regionSchema` 的"零写入 + 读时回落"。
 *
 * ── 为什么必须单独一组用例 ──
 * `types.ts` 里 `regionSchema` 字段的注释承诺："`createEmptyDocument()` / `migrateDoc`
 * 都**不写**这个字段（只做'非法则剔除'），老文档形状因此逐字节不变"。这条承诺是
 * "改前逐字节一致"的唯一证据链，却**没有任何用例覆盖 migrateDoc**
 * （`normalizeRegionSchema` / `regionSchemaOf` 在 `regions.test.ts` 里有，
 * 但迁移入口本身没有）。
 *
 * 这里把三种输入的实际产出钉死：
 *   ① 合法**缺省**（无字段）⇒ 迁移后**不含** regionSchema（落库形状不变），读时回落默认；
 *   ② **非法**（长度 0/5、name 非串、count 0/负、整段是字符串）⇒ 不抛错，
 *      **迁移时就从文档形状里剔除**（不是靠读时遮掩），读时回落默认 4 级；
 *   ③ 合法 schema ⇒ 原样保留（不替换成规范化副本），读时返回等值（不是默认那份）。
 *
 * 【② 为什么必须断言"剔除"而不只是"读时回落"】读路径统一走
 * `regionSchemaOf → normalizeRegionSchema` 只是一条**口头约定**，不是类型保证 ——
 * 任何一处裸读 `doc.regionSchema` 的代码都会直接撞上脏数据。而 `migrateDoc` 的产物
 * 是要**写回存档**的，非法值留在里面等于把脏数据固化成"这份存档的常态"。
 */

describe("migrateDoc · regionSchema 老文档兼容", () => {
  it("没有 regionSchema 的老 v2 文档：迁移后不含该字段，读时回落默认（2.42.0 起 1 级）", () => {
    const raw = {
      version: 2,
      baseImageId: "base-1",
      land: null,
      style: "none",
      labels: [],
      showRegions: true,
      elements: [],
      regions: [],
    };
    const out = migrateDoc(raw);

    // 字段**不存在**（而不是值为 undefined 的显式键）—— 落库形状逐字节不变
    expect(Object.prototype.hasOwnProperty.call(out, "regionSchema")).toBe(false);
    expect(out.regionSchema).toBeUndefined();
    // 其余字段与空文档逐字节相同（老文档打开后观感不变）
    expect(out).toEqual(createEmptyDocument());
    // 读时回落默认（2.42.0 起只有国家一级），且是同一份引用（不每次新数组）
    expect(regionSchemaOf(out)).toBe(DEFAULT_REGION_SCHEMA);
    expect(regionSchemaOf(out)).toHaveLength(1);
  });

  it("非法 regionSchema 的各种形态：不抛错，迁移时即剔除，读时一律回落默认（1 级）", () => {
    const illegal: unknown[] = [
      [], // 长度 0
      // 多级 schema：2.42.0 关闭层级后的"老数据"，与非法值同一出口
      DEFAULT_REGION_SCHEMA.concat([{ name: "郡", count: 60 }]),
      DEFAULT_REGION_SCHEMA.concat([
        { name: "郡", count: 60 },
        { name: "城", count: 160 },
      ]),
      [{ name: 123, count: 3 }], // name 不是字符串
      [{ name: "a", count: 0 }], // count = 0
      [{ name: "a", count: -1 }], // count 为负
      [{ name: "a", count: 1.5 }], // count 非整数
      "garbage", // 整段是字符串
      { name: "a", count: 1 }, // 整段是对象而非数组
    ];

    for (const bad of illegal) {
      const label = JSON.stringify(bad);
      // 每一份非法值先确认会被规范化挡下（否则下面的"剔除 / 回落"论断没有意义）
      expect(normalizeRegionSchema(bad), `非法值应被挡下：${label}`).toBeNull();
      // 迁移不得抛错（脏数据不能让用户打不开地图）
      expect(() => migrateDoc({ version: 2, regionSchema: bad }), label).not.toThrow();
      const out = migrateDoc({ version: 2, regionSchema: bad });

      // ① 迁移产物里**不再有这个字段**（而不是留着 undefined 的显式键）——
      //    它会被写回存档，留着就等于把脏数据固化下来
      expect(
        Object.prototype.hasOwnProperty.call(out, "regionSchema"),
        `非法值应被剔除：${label}`,
      ).toBe(false);
      // ② 读时回落默认（1 级；不是空数组、不是抛错）
      expect(regionSchemaOf(out), label).toBe(DEFAULT_REGION_SCHEMA);
    }
  });

  it("合法 regionSchema（1 项）：迁移后原样保留，读时返回等值（而不是默认那份）", () => {
    const good = [{ name: "国", count: 9 }];
    const out = migrateDoc({ version: 2, regionSchema: good });

    expect(out.regionSchema).toEqual(good);
    expect(regionSchemaOf(out)).toEqual(good);
    // 是这份自定义 schema，不是默认那份
    expect(regionSchemaOf(out)).not.toBe(DEFAULT_REGION_SCHEMA);
    expect(regionSchemaOf(out)).toHaveLength(1);
  });

  it("合法但带额外键的 regionSchema：**原样保留**，不被替换成规范化副本", () => {
    // 【为什么单独立一条】「零写入」不只是"字段在不在"，还包括"值有没有被重排"。
    // 如果迁移时顺手写成 `regionSchema: normalizeRegionSchema(raw)`，形状上看着没问题，
    // 但用户存档里的额外字段（将来版本新增的、或第三方工具写的）会被静默抹掉 ——
    // 那正是 `migrateDoc` 开头"未知字段原样保留"那条纪律要防的事。
    const withExtra = [{ name: "国", count: 9, note: "未来字段" }];
    const out = migrateDoc({ version: 2, regionSchema: withExtra });

    expect(Object.prototype.hasOwnProperty.call(out, "regionSchema")).toBe(true);
    // 逐字段相等 ⇒ 额外键 `note` 还在
    expect(out.regionSchema).toEqual(withExtra);
    expect(out.regionSchema?.[0]).toHaveProperty("note", "未来字段");
    // 读路径仍按 schema 语义正常工作（额外键被规范化层忽略）
    expect(regionSchemaOf(out)).toEqual([{ name: "国", count: 9 }]);
  });
});

/* ─────────────────── 镜像翻转读点兜底（观感批次 C · P1-4） ─────────────────── */

/**
 * `elementFlipXOf` 是 flipX 的唯一读点：旧存档没有这个字段，渲染层靠它在
 * 读点回落"原样"（不翻）。与 `elementOpacityOf` / `elementTintHueOf` 同一
 * 模式 —— 迁移函数不补值，兜底只在读点发生。
 */
describe("elementFlipXOf · 镜像翻转读点兜底（P1-4）", () => {
  it("旧存档素材没有 flipX 字段：读作 false（原样渲染，不报错）", () => {
    const legacy = {
      id: "el_1",
      spriteId: "mountain-20",
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      level: null,
      flipX: undefined, // 2.34.0 及之前的存档没有这个字段（undefined = 不存在）
    };
    expect(elementFlipXOf(legacy)).toBe(false);
  });

  it("只有布尔 true 才翻：脏数据（字符串 / 数字 / null）一律按 false", () => {
    expect(elementFlipXOf({ flipX: true })).toBe(true);
    expect(elementFlipXOf({ flipX: false })).toBe(false);
    expect(elementFlipXOf({ flipX: "true" as unknown as boolean })).toBe(false);
    expect(elementFlipXOf({ flipX: 1 as unknown as boolean })).toBe(false);
    expect(elementFlipXOf({ flipX: null as unknown as boolean })).toBe(false);
    expect(elementFlipXOf({ flipX: undefined })).toBe(false);
  });

  it("migrateDoc 不丢元素的 flipX：未知字段随 elements 原样保留", () => {
    const raw = {
      version: 2,
      baseImageId: "base-1",
      land: null,
      style: "none",
      labels: [],
      showRegions: true,
      regions: [],
      elements: [
        { id: "el_1", spriteId: "swamp-1", x: 10, y: 20, scale: 1, rotation: 0, level: null, flipX: true },
      ],
    };
    const out = migrateDoc(raw);
    expect(out.elements[0].flipX).toBe(true);
    // 布尔 false 也原样保留（不删不补）：落库形状 = 用户写过的形状
    const rawFalse = { ...raw, elements: [{ ...raw.elements[0], flipX: false }] };
    expect(migrateDoc(rawFalse).elements[0].flipX).toBe(false);
  });
});
