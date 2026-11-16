import { createContext, useContext } from "react";
import {
  ENTITY_FILTER_ORDER,
  createTypeMetaResolver,
} from "@/shared/novel/entity-type-meta";
import type { EntityTypeMeta } from "@/shared/novel/entity-type-meta";
import type { CustomEntityTypeDef, EntityType } from "../types";

/**
 * 要素类型上下文（R23）
 *
 * 内置六类 meta 静态可查（ENTITY_TYPE_META）；自建类型（ct-*）的定义存在
 * config，展示 meta 必须在运行期派生。所有「查类型 meta」的组件一律经
 * useEntityTypeMeta()，不要直接索引 ENTITY_TYPE_META——ct-* 会拿到 undefined。
 */

export interface EntityTypesContextValue {
  /** 任意类型（内置 + 自建 + 已删除兜底）的展示 meta */
  metaOf: (type: EntityType) => EntityTypeMeta;
  /** 筛选 / 标注类型开关的完整顺序：内置在前、自建追加在末尾 */
  filterOrder: EntityType[];
  /** 当前自建类型定义（EntityTypeManager 展示用） */
  customTypes: CustomEntityTypeDef[];
}

export const EntityTypesContext = createContext<EntityTypesContextValue | null>(null);

/** 由自建类型定义组装上下文值（useNovelPage 组装、Provider 消费，纯函数可测） */
export function buildEntityTypesValue(
  customTypes: CustomEntityTypeDef[],
): EntityTypesContextValue {
  const metaOf = createTypeMetaResolver(customTypes);
  return {
    customTypes,
    metaOf,
    filterOrder: [...ENTITY_FILTER_ORDER, ...customTypes.map((def) => def.id)],
  };
}

/** Provider 缺失时的兜底值：内置行为（单测 / 极端挂载场景不崩） */
const FALLBACK_VALUE = buildEntityTypesValue([]);

/** 消费类型 meta 上下文 */
export function useEntityTypeMeta(): EntityTypesContextValue {
  return useContext(EntityTypesContext) ?? FALLBACK_VALUE;
}
