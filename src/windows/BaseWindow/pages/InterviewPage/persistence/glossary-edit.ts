/**
 * 词条编辑的纯函数层（表单 → payload、键冲突判定）。
 *
 * 【为什么单独一层】
 * 编辑词条有两条容易分家的规则：
 *   1. 落库 payload 只能整体覆盖，可选字段**必须能被清空**（`{...term}` 会把
 *      用户删掉的 `en` / `related` 又带回来）；
 *   2. 「同名不同领域允许共存，同领域撞键才算重复」——这条与 AI 出词条的判定
 *      必须同一口径（`useInterviewAi.buildDraftCandidate`），否则「AI 出得进、
 *      手改不进去」或反过来。
 * 两者都是纯计算，放在这里能被单测直接钉住，不必挂 DOM。
 */
import {
  SHAPE_LIMITS,
  isValidGlossaryShape,
  type GlossaryShape,
} from "@/shared/interview/payload-shape";
import { GLOSSARY_DOMAIN_LABEL, type GlossaryTerm } from "../data/interview-glossary";

/** 参与键冲突判定的词条（合并词表项 / 草稿词条都算） */
export interface GlossaryKeyHolder {
  id: string;
  term: string;
  en?: string;
  aliases?: readonly string[];
  /** 领域；取不到（草稿）时按「一律算冲突」处理 */
  domain?: string;
  /** 是不是草稿箱里的条目（只影响提示文案：草稿与已入库是两种东西） */
  draft?: boolean;
}

/** 一个词条的全部匹配键（小写归一、去重），与匹配器的建索引口径一致 */
export function glossaryKeyList(source: {
  term?: string;
  en?: string;
  aliases?: readonly string[];
}): string[] {
  const keys: string[] = [];
  for (const raw of [source.term, source.en, ...(source.aliases ?? [])]) {
    const key = raw?.trim().toLowerCase();
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

/**
 * 词条 → 落库 payload（**清空语义**）。
 *
 * `en` / `aliases` / `related` / `categoryId` 为空时不带这个键 —— `undefined`
 * 落进 payload 会被结构化克隆丢掉，但 `{...term}` 里残留的旧值不会被丢，
 * 于是「用户把英文名删了、保存后又回来了」。所以这里逐字段判定，不做展开。
 */
export function toGlossaryShape(term: GlossaryTerm): GlossaryShape {
  const en = term.en?.trim();
  const aliases = (term.aliases ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
  const related = (term.related ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
  return {
    id: term.id,
    term: term.term.trim(),
    domain: term.domain,
    short: term.short.trim(),
    detail: term.detail.map((item) => item.trim()).filter((item) => item.length > 0),
    ...(en ? { en } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
    ...(related.length > 0 ? { related } : {}),
    ...(term.categoryId ? { categoryId: term.categoryId } : {}),
  };
}

/**
 * 改完之后的键冲突。
 *
 * 口径与 `buildDraftCandidate` 一致：**同键 + 同领域**才算重复。同名不同义
 * （「节流」在浏览器性能与 RxJS 里）两条都该留下，正文里靠 `variants` 并列。
 *
 * 自己（同 id）不参与比对 —— 编辑时把词名改回原样不该被自己挡住。
 * 对方领域取不到（草稿词条）时按冲突处理：宁可挡住，也不要进一条永远被
 * 先出现者遮蔽的隐形词条。
 */
export function glossaryConflicts(
  source: GlossaryShape,
  holders: readonly GlossaryKeyHolder[],
): string[] {
  const mine = new Set(glossaryKeyList(source));
  const conflicts: string[] = [];
  for (const holder of holders) {
    if (holder.id === source.id) continue;
    const overlap = glossaryKeyList(holder).filter((key) => mine.has(key));
    if (overlap.length === 0) continue;
    if (holder.domain && holder.domain !== source.domain) continue;
    const domainNote =
      holder.domain && holder.domain === source.domain
        ? `（同为 ${GLOSSARY_DOMAIN_LABEL[source.domain as GlossaryTerm["domain"]] ?? source.domain}）`
        : "";
    conflicts.push(
      `「${overlap[0]}」与${holder.draft ? "草稿" : "已有"}词条「${holder.term}」重复${domainNote}`,
    );
  }
  return conflicts;
}

/**
 * 表单值 → 词条（在 `term` 原对象上覆盖可编辑字段）。
 *
 * `id` 一律以入参为准：词条 id 被别的词条的 `related` 引用、也是匹配负例
 * （`interview_match_hint.term_id`）的锚点，换 id 等于把这两处一起弄断。
 */
export function buildEditedGlossary(
  base: GlossaryTerm,
  next: {
    term: string;
    en?: string;
    domain: GlossaryTerm["domain"];
    categoryId?: string;
    short: string;
    detail: readonly string[];
    aliases?: readonly string[];
  },
): GlossaryTerm {
  const term: GlossaryTerm = {
    id: base.id,
    term: next.term.trim(),
    domain: next.domain,
    short: next.short.trim(),
    detail: next.detail.map((item) => item.trim()).filter((item) => item.length > 0),
    ...(base.related?.length ? { related: [...base.related] } : {}),
  };
  const en = (next.en ?? "").trim();
  if (en) term.en = en;
  const aliases = (next.aliases ?? []).map((item) => item.trim()).filter((item) => item.length > 0);
  if (aliases.length > 0) term.aliases = aliases;
  if (next.categoryId) term.categoryId = next.categoryId as GlossaryTerm["categoryId"];
  return term;
}

/** 保存前的完整校验（结构 + 冲突），返回人话错误列表；空数组 = 可以写 */
export function validateGlossaryEdit(
  term: GlossaryTerm,
  holders: readonly GlossaryKeyHolder[],
): string[] {
  const shape = toGlossaryShape(term);
  const checked = isValidGlossaryShape(shape);
  const errors = checked.ok ? [] : [...checked.errors];
  // 结构不合法时不再判冲突：字段都没填全，冲突提示只会更乱
  if (!checked.ok) return errors;
  return [...errors, ...glossaryConflicts(checked.value, holders)];
}

/** 表单文案里要显示的上限（与结构校验同源，禁在这里抄字面量） */
export const GLOSSARY_LIMITS = SHAPE_LIMITS.glossary;
