import { describe, expect, it } from "vitest";
import {
  CUSTOM_TYPE_GLYPH,
  createTypeMetaResolver,
  customTypeMeta,
  ENTITY_TYPE_META,
} from "./entity-type-meta";

/**
 * O-17：颜色语义冗余。
 *
 * 前缀字是「类型身份」的文本通道 —— 读屏能读、灰度能辨。这里钉住单一事实源
 * 的取值，避免某处组件又硬编码一套前缀导致两处漂移。
 */
describe("entity-type-meta：单字前缀（O-17）", () => {
  it("内置六类前缀固定为 人/地/势/物/阶/其", () => {
    expect(ENTITY_TYPE_META.character.glyph).toBe("人");
    expect(ENTITY_TYPE_META.location.glyph).toBe("地");
    expect(ENTITY_TYPE_META.faction.glyph).toBe("势");
    expect(ENTITY_TYPE_META.item.glyph).toBe("物");
    expect(ENTITY_TYPE_META.level_system.glyph).toBe("阶");
    expect(ENTITY_TYPE_META.custom.glyph).toBe("其");
  });

  it("全部前缀都是单字（不是空串、不是多字短语）", () => {
    for (const meta of Object.values(ENTITY_TYPE_META)) {
      expect([...meta.glyph]).toHaveLength(1);
    }
  });

  it("自建类型统一「其」，含已删除自建类型的兜底路径", () => {
    const def = {
      id: "ct-1",
      name: "宗门",
      color: "var(--app-accent-purple)",
    };
    expect(customTypeMeta(def).glyph).toBe(CUSTOM_TYPE_GLYPH);
    const resolve = createTypeMetaResolver([def]);
    expect(resolve("ct-1").glyph).toBe("其");
    expect(resolve("ct-deleted").glyph).toBe("其");
  });
});
