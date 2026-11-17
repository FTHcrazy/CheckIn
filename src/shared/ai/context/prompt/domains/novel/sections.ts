/**
 * 小说域专属段落：吃 `AiBookContext` 的四块（作品背景 / 已有要素 / 境界 / 人物卡）。
 *
 * 为什么不进 kit：签名里出现 `AiBookContext`。第三个域想复用 → 它引用了小说语义，
 * 必须自写（§8.3 判据 4）。`characterBlock` 的参数虽然是公共的 `CharacterRef`，
 * 但「人物卡」本身是小说要素（判据是**语义**，不是参数类型）。
 *
 * 字符串一个字都没改：`prompt.test.ts` 的既有断言拿这些段落当比对目标。
 */
import type { CharacterRef } from "../../types";
import type { AiBookContext } from "./types";

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
