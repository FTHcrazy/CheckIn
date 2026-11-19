/**
 * 选区裸 Enter 开卡的匹配判据（O-17，纯函数）
 *
 * 只做「这一段选区是不是某个要素名」的判断，不碰 DOM、不碰 IPC：
 * 事件侧负责把 r1~r5 的事实喂进来，这里给出唯一结论。可测性优先
 * （AGENTS §6.6），EditorPane 只挂事件、不藏逻辑。
 */

export type SelectionCardResult =
  | { kind: "none" }
  | { kind: "entity"; entityId: string }
  | { kind: "candidates"; entityIds: string[] };

/** 一条「名字 → 要素」映射；复用正文标注的词条表，不新建查询接口 */
export interface SelectionCardTerm {
  term: string;
  entityId: string;
}

export interface MatchSelectionForCardInput {
  /** 选区文本（原样，函数内部 trim） */
  selection: string;
  /** IME 组合中：候选期的 Enter 属于输入法，绝不拦截 */
  isComposing: boolean;
  /** 事件来源是否为正文（R5）；弹窗 / 输入框里的 Enter 一律放行 */
  focusOrigin: "body" | "other";
  /** 修饰键：只有裸 Enter 才触发（R4） */
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** 正文标注映射：`term` 含名字与别名（由 buildEntityTerms 提供） */
  terms: readonly SelectionCardTerm[];
}

/**
 * R1~R5 顺序判定：
 *   R1 选区非空且非 IME；R5 焦点在正文；R4 裸 Enter；
 *   R2 去首尾空白后精确等于某条标准名 / 别名（不做包含匹配，避免误触）；
 *   R3 唯一命中直接开卡，多条命中交由调用方弹 antd Dropdown。
 */
export function matchSelectionForCard(
  input: MatchSelectionForCardInput,
): SelectionCardResult {
  if (input.isComposing) return { kind: "none" };
  if (input.focusOrigin !== "body") return { kind: "none" };
  if (input.shiftKey || input.ctrlKey || input.metaKey || input.altKey) {
    return { kind: "none" };
  }
  const text = input.selection.trim();
  if (!text) return { kind: "none" };

  const hits = new Set<string>();
  for (const item of input.terms) {
    // 精确命中：选区 != 完整词条就放行（普通文本 + Enter 照常换行）
    if (item.term.trim() === text) hits.add(item.entityId);
  }
  if (hits.size === 0) return { kind: "none" };
  const entityIds = [...hits];
  if (entityIds.length === 1) return { kind: "entity", entityId: entityIds[0] };
  return { kind: "candidates", entityIds };
}
