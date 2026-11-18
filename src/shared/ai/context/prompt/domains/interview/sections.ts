/**
 * 面试域专属段落。
 *
 * 四个是 §8.2 点名的，`questionListBlock` 是质检必需的第五个（内部用 kit 的
 * `kvBlock` 拼，所以第二个域想复用「一题一卡」直接抄 kvBlock 就够）。
 *
 * 为什么不进 kit：这些段落的语义只属题库（「选区」「封闭分类词表」「待检题目」），
 * 签名里虽然多数只有字符串 / 字符串数组，但第三个域复用它们等于引用了面试语义。
 */
import { kvBlock } from "../../kit";
import type {
  InterviewAuditTarget,
  InterviewCategoryRef,
  InterviewPromptContext,
} from "./types";

/**
 * 分类段：题库的分类是**封闭词表**，出题 / 质检都必须落在这张表里。
 * 只给 `label（id）`，不给 note（22 个分类的 note 叠起来会吃掉大半个 prompt）；
 * 当前分类额外带 note —— 那一条才是模型真正需要遵守的约束。
 */
export function categoryBlock(
  categories: InterviewCategoryRef[],
  activeId?: string,
): string | null {
  if (categories.length === 0) return null;
  const list = categories.map((c) => `${c.label}（${c.id}）`).join("、");
  const active = activeId ? categories.find((c) => c.id === activeId) : undefined;
  const head = `【可选分类（只能从中选，不许新造 id）】${list}`;
  if (!active) return head;
  return `${head}\n- 当前分类：${active.label}（${active.id}）${active.note ? `｜${active.note}` : ""}`;
}

/**
 * 选区段：划词解释的锚点。
 *
 * 参数全是字符串，但「选区」是题库页独有的概念（浮层 + 划词），归本域。
 * 第三个域若也要「聚焦一块引文」，应该用 kit 的 `chapterBlock` 或 `kvBlock`，
 * 而不是复用这个带着面试交互语义的段落。
 */
export function focusBlock(term: string, sentence?: string, stem?: string): string | null {
  const word = term.trim();
  if (!word) return null;
  const lines = [`【选区】${word}`];
  if (sentence?.trim()) lines.push(`- 所在原文：${sentence.trim()}`);
  if (stem?.trim()) lines.push(`- 所在题干（节选）：${stem.trim()}`);
  return lines.join("\n");
}

/** 已有标题段：出题 / 出词 / 出图的避重约束（不给就会一直出「什么是闭包」） */
export function siblingTitlesBlock(titles: string[], note?: string): string | null {
  const cleaned = titles.map((t) => t.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  const head = `【已有条目（不要重复，也不要只换一种说法）】${cleaned.join("、")}`;
  return note ? `${head}\n- ${note}` : head;
}

/** 覆盖度段：告诉模型「这个库现在有什么」，避免它一直往同一类里堆 */
export function coverageBlock(stats: InterviewPromptContext["stats"]): string | null {
  const { questions, glossaries, diagrams } = stats;
  const total = questions + glossaries + diagrams;
  if (total === 0) return "【题库现状】题库为空，本次是第一批内容。";
  return kvBlock("题库现状", [
    ["题目", `${questions} 道`],
    ["词条", `${glossaries} 条`],
    ["图解", `${diagrams} 张`],
  ]);
}

/** 待检题目段：一题一个 kv 块，题目之间空一行（模型按 id 分组回答时不易串） */
export function questionListBlock(targets: InterviewAuditTarget[]): string | null {
  const blocks = targets
    .map((t) =>
      kvBlock(`待检题目 ${t.id}`, [
        ["标题", t.title],
        ["分类", t.categoryId],
        ["难度", t.difficulty],
        ["题干", t.stem],
        ["参考答案", t.answer],
        ["标签", (t.tags ?? []).join("、")],
      ]),
    )
    .filter((block): block is string => Boolean(block));
  return blocks.length > 0 ? blocks.join("\n\n") : null;
}
