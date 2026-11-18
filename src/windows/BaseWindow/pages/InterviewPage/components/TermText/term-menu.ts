/**
 * 可点名词的右键菜单（纯函数，便于单测）。
 *
 * 【为什么需要菜单】
 * 词表匹配是纯文本的，误命中不可避免（「字节流」里的「节流」）。命中之后那段
 * 文字就变成了按钮，用户没法再划它 —— 也就没有别的入口表达「这里不该点亮」。
 * 右键菜单是唯一的补救口，两种粒度：
 *
 *   - `这里不是「节流」` → 只解除**这一处**（位置指纹 = 词条 + 键 + 左右各 6 字），
 *     别的段落里同一个词照常可点；
 *   - `编辑词条「节流」` → 改词名 / 领域 / 分类 / 定义（词条本身错了，光解除这一处
 *     治不了，下次换个地方还会错）；
 *   - `删掉别名「xxx」`  → 从词条上永久删掉这个说法（全库生效），
 *     用于「别名本来就记错了」。
 *
 * 菜单只描述「有哪些动作」，不执行：执行在页面（`TermActionContext`），
 * 这样这里可以被纯函数的单测钉住，不必挂 DOM。
 */
import type { GlossaryTerm } from "../../data/interview-glossary";

/** 一个可点的菜单项（`key` 形如 `unbind` / `alias:闭包`） */
export interface TermMenuItem {
  key: string;
  label: string;
}

/** 分组（别名多时收成一层子菜单，避免菜单一屏全是别名） */
export interface TermMenuGroup {
  key: string;
  label: string;
  children: TermMenuItem[];
}

export type TermMenuNode = TermMenuItem | TermMenuGroup;

/** 解除整段绑定的动作键 */
export const UNBIND_KEY = "unbind";

/** 打开词条编辑的动作键 */
export const EDIT_KEY = "edit";

/** 删除别名的动作键前缀 */
export const ALIAS_KEY_PREFIX = "alias:";

export function isTermMenuGroup(node: TermMenuNode): node is TermMenuGroup {
  return Array.isArray((node as TermMenuGroup).children);
}

/** 从菜单项 key 里取出要删的别名；不是别名项返回 `null` */
export function aliasOfMenuKey(key: string): string | null {
  if (!key.startsWith(ALIAS_KEY_PREFIX)) return null;
  const alias = key.slice(ALIAS_KEY_PREFIX.length);
  return alias ? alias : null;
}

/**
 * 构造某个命中位置的右键菜单。
 *
 * @param term    被点亮的词条
 * @param hitText 正文里实际的文字（可能是别名，也可能只是词名的一部分）
 * @param hitKey  本次命中的匹配键（小写归一，`GlossarySegment.key`）
 *
 * 规则：
 * 1. 永远有「这里不是「原文」」—— 这是最常用的动作，不该藏在子菜单里；
 * 2. 能编辑时给「编辑词条」（词条本身错了：领域不对 / 词名太长 / 定义写歪）；
 * 3. 命中的是别名 → 直接提供「删掉别名「它」」（用户正看着这个错误说法）；
 * 4. 命中的是词名 / 英文名 → 剩下的别名一并列出（超两条收进子菜单），逐条可删；
 * 5. 一个别名都没有时不渲染空的子菜单。
 *
 * 英文名（`en`）不出现在可删列表里：它不是别名，删掉它等于改词条本身 ——
 * 那属于「编辑词条」，菜单里已有入口。
 */
export function buildTermMenu(params: {
  term: GlossaryTerm;
  hitText: string;
  hitKey: string;
  /** 页面是否接好了词条编辑（没接就不给一个点了没反应的菜单项） */
  canEdit?: boolean;
}): TermMenuNode[] {
  const { term, hitText, hitKey, canEdit = false } = params;
  const text = hitText.trim() || term.term;
  const key = hitKey.trim().toLowerCase();
  const aliases = (term.aliases ?? []).filter((alias) => alias.trim().length > 0);

  const nodes: TermMenuNode[] = [
    { key: UNBIND_KEY, label: `这里不是「${text}」` },
  ];

  if (canEdit) {
    nodes.push({ key: EDIT_KEY, label: `编辑词条「${term.term}」` });
  }

  // 命中别名：用户此刻看到的就是这个说法，优先给「删掉它」
  const hitAlias = aliases.find((alias) => alias.trim().toLowerCase() === key);
  if (hitAlias) {
    nodes.push({ key: `${ALIAS_KEY_PREFIX}${hitAlias}`, label: `删掉别名「${hitAlias}」` });
  }

  const rest = aliases.filter((alias) => alias !== hitAlias);
  if (rest.length <= 2) {
    // 一两条就直接摆出来：多一层子菜单等于多一次悬停
    for (const alias of rest) {
      nodes.push({ key: `${ALIAS_KEY_PREFIX}${alias}`, label: `删掉别名「${alias}」` });
    }
  } else {
    nodes.push({
      key: "alias-group",
      label: "删掉某个别名",
      children: rest.map((alias) => ({
        key: `${ALIAS_KEY_PREFIX}${alias}`,
        label: alias,
      })),
    });
  }

  return nodes;
}
