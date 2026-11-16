/**
 * 提示词公共段落（所有 AI 模板共用）
 *
 * 为什么单独抽这一层：段落的**顺序与措辞**决定模型是否听话，如果每个功能各写
 * 一份，调优时就会「改了起名忘了润色」。这里把每一类信息收敛成一个函数
 * （角色 / 作品背景 / 已有要素 / 境界 / 人物 / 章节片段 / 约束 / 输出契约），
 * 模板只管挑选与排序，不再手拼字面量。
 *
 * 约定：
 * - 段落统一用 `【…】` 起头，让模型能区分「背景信息」与「硬约束」；
 * - 约束一律以 `- ` 开头的列表给出，比一整段祈使句更容易被遵循；
 * - 空数据返回 `null`（而不是空串），由 `composePrompt` 统一丢弃，
 *   避免拼出「【已有要素】」后面什么都没有的残句。
 *
 * 不 import novel、不碰 IPC、不做截断（截断是 collector 的职责）。
 */
import type { AiBookContext } from "../collector";
import { buildOutputInstruction, type OutputFormat } from "../output-spec";
import type { CharacterRef } from "./types";

/** 角色定位：整个 system prompt 的第一句，决定模型以什么身份作答 */
export function roleBlock(text: string): string {
  return text.trim();
}

/**
 * 作品背景：书名 + 题材。
 * 题材缺失时**如实说明**而不是编一个，同时给模板一个「据书名推断」的钩子。
 */
export function workBlock(context: AiBookContext): string {
  const { name, genre } = context.work;
  return genre
    ? `【作品背景】《${name}》｜题材：${genre}`
    : `【作品背景】《${name}》（题材未设置）`;
}

/** 已有要素：按类型分组压成一行（只作风格锚点，不逐条罗列简介） */
function entityLine(context: AiBookContext): string | null {
  if (context.entities.length === 0) return null;
  const groups = new Map<string, string[]>();
  for (const entity of context.entities) {
    const list = groups.get(entity.type) ?? [];
    list.push(entity.name);
    groups.set(entity.type, list);
  }
  const parts: string[] = [];
  for (const [type, names] of groups) {
    parts.push(`${type}：${names.join("、")}`);
  }
  return parts.join("；");
}

/** 已有要素段；`note` 用于追加该功能的专属约束（如「不得与其中任何名字重复」） */
export function entityBlock(context: AiBookContext, note?: string): string | null {
  const line = entityLine(context);
  if (!line) return null;
  return note ? `【已有要素】${line}\n- ${note}` : `【已有要素】${line}`;
}

/** 境界体系段：只有采集到层级时才出现（起名贴合世界观用） */
export function realmBlock(context: AiBookContext, note?: string): string | null {
  const levels = context.realmLevels;
  if (!levels?.length) return null;
  const head = `【境界体系】${levels.join(" → ")}`;
  return note ? `${head}\n- ${note}` : head;
}

/** 人物段：润色时让模型知道「这段话里的人是谁」，避免写出与人设相悖的措辞 */
export function characterBlock(
  characters: CharacterRef[] | undefined,
  note?: string,
): string | null {
  if (!characters?.length) return null;
  const cards = characters
    .map((c) => `- ${c.name}（${c.type}）${c.summary ? `：${c.summary}` : ""}`)
    .join("\n");
  return note ? `【本段涉及的人物】\n${cards}\n- ${note}` : `【本段涉及的人物】\n${cards}`;
}

/** 章节片段段：只给模型理解上下文，必须明说「不要输出它」 */
export function chapterBlock(snippet: string | undefined, note: string): string | null {
  if (!snippet) return null;
  return `【本段所在章节片段（${note}）】\n${snippet}`;
}

/** 本次要求段（起名的类型 / 风格 / 性别等显式意图） */
export function requirementBlock(requirements: string[]): string | null {
  if (requirements.length === 0) return null;
  return `【本次要求】${requirements.join("；")}`;
}

/** 约束清单：统一成 `- xxx` 列表，空数组返回 null */
export function constraintBlock(lines: string[]): string | null {
  const cleaned = lines.map((line) => line.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  return cleaned.map((line) => `- ${line}`).join("\n");
}

/** 输出契约段：由 output-spec 统一产出，模板不许自己编格式要求 */
export function outputBlock(format: OutputFormat): string {
  return buildOutputInstruction(format);
}

/**
 * 按顺序拼段，丢弃空段。
 * 段落之间只留一个换行：prompt 里每个换行都是 token，而 `【…】` 标签已经
 * 足够让模型分段，不需要空行再撑一遍。
 */
export function composePrompt(...blocks: Array<string | null | undefined>): string {
  return blocks
    .map((block) => block?.trim())
    .filter((block): block is string => Boolean(block))
    .join("\n");
}
