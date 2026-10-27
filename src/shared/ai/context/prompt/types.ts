/**
 * Prompt 组装的公共类型
 *
 * `PromptSpec` 是「模板层」与「服务层」之间唯一的契约：模板只负责把内容拼成
 * 这一份结构，服务层原样消费（拼请求、按 `outputFormat` 解析），双方都不解释
 * 对方的业务语义。
 */
import type { OutputFormat } from "../output-spec";

/** 组装结果：服务层原样消费，不解释业务语义 */
export interface PromptSpec {
  /** 系统提示词：角色 + 上下文 + 约束 + 输出契约 */
  system: string;
  /** 用户提示词主体（描述 / 待润色原文） */
  prompt: string;
  /** 期望输出格式（由服务层按此解析） */
  outputFormat: OutputFormat;
  /** 期望条目数（json-array 场景） */
  count?: number;
}

/** 本段命中的人物卡（由 collector.matchEntitiesInText 筛好，模板只负责排版） */
export interface CharacterRef {
  name: string;
  type: string;
  summary?: string;
}
