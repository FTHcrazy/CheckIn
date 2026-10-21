/**
 * 要素类型语义色（跨窗口单一真相源，R27）
 *
 * 「类型色在正文高亮、卡片头像、筛选 chips、关系图节点」四处必须严格一致
 * （设计方案 §02）。这些 meta 原先只存在于 NovelPage 的 novel-config.ts，
 * 关系图独立窗口（RelationWindow）也要用，所以上提到 shared：
 * novel-config.ts 原地 re-export，既有导入路径零改动。
 *
 * 内置类型静态可查；自建类型（ct-*）的颜色存在 config 里，必须运行期派生
 * —— 一律经 `createTypeMetaResolver()`，不要直接索引 ENTITY_TYPE_META。
 */
import type { BuiltinEntityType, CustomEntityTypeDef } from "./entity-model";

export interface EntityTypeMeta {
  label: string;
  /** 主色：头像底、名称、正文高亮描边、关系图节点描边 */
  color: string;
  /** 弱色：卡片底、筛选 chip 底、正文高亮底色 */
  colorWeak: string;
}

/**
 * 内置要素类型语义色
 *
 * 全部映射到四套主题的 `--app-*` 变量上，换肤自动跟随（关系图窗口同理：
 * React Flow 的节点是 DOM，直接吃 CSS 变量，不需要第二份色表）。
 */
export const ENTITY_TYPE_META: Record<BuiltinEntityType, EntityTypeMeta> = {
  character: {
    label: "角色",
    color: "var(--app-primary)",
    colorWeak: "var(--app-primary-weak)",
  },
  location: {
    label: "地点",
    color: "var(--app-accent-green)",
    colorWeak: "var(--app-accent-green-weak)",
  },
  faction: {
    label: "势力",
    color: "var(--app-accent-purple)",
    colorWeak: "var(--app-accent-purple-weak)",
  },
  item: {
    label: "物品",
    color: "var(--app-accent-amber)",
    colorWeak: "var(--app-accent-amber-weak)",
  },
  level_system: {
    label: "等级体系",
    color: "var(--app-accent-blue)",
    colorWeak: "var(--app-accent-blue-weak)",
  },
  custom: {
    label: "自定义",
    color: "var(--app-text-secondary)",
    colorWeak: "var(--app-surface-active)",
  },
};

/** 要素库筛选顺序（内置部分）：全部在前，其余按语义分组；自定义类型追加在末尾 */
export const ENTITY_FILTER_ORDER: BuiltinEntityType[] = [
  "character",
  "location",
  "faction",
  "item",
  "level_system",
  "custom",
];

/** 自建类型弱色：与卡片 / chip / 高亮底的既有观感对齐（内置弱色约 12%-16%） */
export function customTypeMeta(def: CustomEntityTypeDef): EntityTypeMeta {
  return {
    label: def.name,
    color: def.color,
    colorWeak: `color-mix(in srgb, ${def.color} 15%, transparent)`,
  };
}

/**
 * 组装「任意类型 → meta」的解析器。
 *
 * 自建类型被删除后，历史要素仍带着 ct-xxx：解析不到时回落到 `custom`
 * （与 EntityTypeContext 的既有行为一致），不允许抛错或渲染空白节点。
 */
export function createTypeMetaResolver(
  customTypes: readonly CustomEntityTypeDef[],
): (type: string) => EntityTypeMeta {
  const index = new Map(customTypes.map((def) => [def.id, def]));
  return (type: string) => {
    const builtin = ENTITY_TYPE_META[type as BuiltinEntityType];
    if (builtin) return builtin;
    const def = index.get(type);
    return def ? customTypeMeta(def) : ENTITY_TYPE_META.custom;
  };
}
