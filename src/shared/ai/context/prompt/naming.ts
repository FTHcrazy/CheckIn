/**
 * 起名模板（R-AI-02 + 上下文自动灌入 + JSON 寓意）
 *
 * 承接的两处历史逻辑：
 * - 早期 `buildNamingPrompt` 的「类型 / 风格 / 性别 / 数量 / 避开已用名」；
 * - 2.7.0 起名面板的「书名 / 要素 / 境界自动灌入 + json-array 寓意输出」。
 * 两者已合并到本文件，调用方不再需要自己拼 system。
 *
 * 不 import novel、不碰 IPC。
 */
import type { AiBookContext } from "../collector";
import { NAMING_OUTPUT_FORMAT } from "../output-spec";
import {
  composePrompt,
  constraintBlock,
  entityBlock,
  outputBlock,
  realmBlock,
  requirementBlock,
  roleBlock,
  workBlock,
} from "./sections";
import type { PromptSpec } from "./types";

/** 起名意图参数（由 NameGeneratorPanel 传入；本层不解释业务语义） */
export interface NamingIntent {
  /** 作者补充的语义描述（可空：空了也能靠上下文起名） */
  description?: string;
  /** 名字类型中文标签（人名 / 地名 …） */
  kind?: string;
  /** 风格中文标签（仙侠 / 西幻 …） */
  style?: string;
  /** 性别倾向（男 / 女），非人名场景不传 */
  gender?: string;
  /** 期望数量 */
  count: number;
}

const ROLE = "你是一名中文小说起名助手，为作者生成贴合本书设定的名字。";

/** 组装起名 Prompt */
export function assembleNamingSpec(context: AiBookContext, intent: NamingIntent): PromptSpec {
  const requirements: string[] = [];
  if (intent.kind) requirements.push(`名字类型：${intent.kind}`);
  if (intent.style) requirements.push(`风格：${intent.style}`);
  if (intent.gender) requirements.push(`性别倾向：${intent.gender}`);

  const constraints: string[] = [];
  if (!context.work.genre) {
    constraints.push("题材未设置，请依据书名与已有要素的用字风格推断整体基调，不要偏离。");
  }
  if (context.excludeNames?.length) {
    constraints.push(`不要与以下已用名字重复：${context.excludeNames.join("、")}`);
  }
  constraints.push(`只生成 ${intent.count} 个，宁可少也不要凑数；每个名字都要能读出意涵。`);

  return {
    system: composePrompt(
      roleBlock(ROLE),
      workBlock(context),
      entityBlock(context, "以上要素只作命名风格锚点，不得与其中任何名字重复或近似。"),
      realmBlock(context, "若本次是境界名，须与既有体系的构词风格一致、层级递进关系合理。"),
      requirementBlock(requirements),
      constraintBlock(constraints),
      outputBlock(NAMING_OUTPUT_FORMAT),
    ),
    // 作者没写描述时不塞一句空话占位，而是给一个「基于本书设定」的明确任务
    prompt:
      intent.description?.trim() ||
      `请围绕《${context.work.name}》的设定，生成一批贴合本书气质的名字。`,
    outputFormat: NAMING_OUTPUT_FORMAT,
    count: intent.count,
  };
}
