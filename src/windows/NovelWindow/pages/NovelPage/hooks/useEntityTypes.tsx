import { createElement } from "react";
import type { ReactNode } from "react";
import { EntityTypesContext } from "./entity-types-context";
import type { EntityTypesContextValue } from "./entity-types-context";

/**
 * 要素类型 Provider（R23）：在 NovelPage 顶层挂一次，深层组件自由消费。
 * Context 值的组装与消费见 ./entity-types-context.ts。
 */

interface EntityTypesProviderProps {
  value: EntityTypesContextValue;
  children: ReactNode;
}

export function EntityTypesProvider({
  value,
  children,
}: EntityTypesProviderProps) {
  return createElement(EntityTypesContext.Provider, { value }, children);
}
