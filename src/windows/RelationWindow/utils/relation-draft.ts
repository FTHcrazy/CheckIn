/**
 * 连线草稿的校验与提交载荷（纯函数，S3）
 *
 * 为什么单独一层：四条阻断（自身 / 跨作品 / 空名 / 同两端同关系已存在）与
 * 「二次确认五项」的文案都是**产品契约**，不能埋在 React 组件的 if 里 ——
 * 埋在组件里就只能靠点界面来验证，而这里的每一条都能被单测逐字钉住。
 *
 * 与写库无关：本文件不碰 IPC，也不生成 rev。提交载荷由 `buildCommitRequest`
 * 组装，真正落库走 `novel-graph-commit` 单事务。
 */
import { createNovelId } from "@/shared/services/novel-shared";
import { formatEdgeLabel } from "@/shared/novel/relation-graph";
import type { EntityType, NovelLink } from "@/shared/novel/entity-model";

/** 连线两端（画布节点 + 它所属的作品 + 类型显示名） */
export interface DraftEndpoint {
  id: string;
  name: string;
  type: EntityType;
  /** 类型显示名（角色 / 地点 / 自建类型名） */
  typeLabel: string;
  workId: string;
}

export type DraftIssueCode = "self" | "cross-work" | "empty" | "duplicate";

export interface DraftIssue {
  code: DraftIssueCode;
  message: string;
  /**
   * 硬阻断 = 不能提交。
   * 「同两端同关系已存在」不是硬阻断：产品口径是**红字提示但允许以合并语义提交**，
   * 因为用户可能就是想再补一句备注，拦死反而要他先删再建。
   */
  fatal: boolean;
}

export interface DraftCheckInput {
  source: DraftEndpoint;
  target: DraftEndpoint;
  /** 用户输入的关系名（原始文本，未清洗） */
  relation: string;
}

export interface DraftCheck {
  /** 清洗后的关系名（写入库里的就是它） */
  relation: string;
  issues: DraftIssue[];
  /** 无硬阻断且关系名非空 → 可以点「创建关系」 */
  canSubmit: boolean;
  /** 同关系名已存在 → 以「合并」语义提交 */
  merge: boolean;
  /** 合并后这条平行关系会显示成什么（「X +1」） */
  mergeLabel: string;
  /** 二次确认第 4 项：重复判定结果 */
  verdict: string;
}

/**
 * 关系名清洗：去首尾空白、把连续空白（含全角空格）压成一个。
 *
 * 不做「去标点 / 转小写」：关系名是中文自由文本，「同门」与「同门 」才是同一个，
 * 而「师兄」和「师兄（大师兄）」是两条不同关系，不该被归一化吃掉。
 */
export function normalizeRelation(raw: string): string {
  return raw.replace(/[\s\u3000]+/g, " ").trim();
}

/** 关系名比较：忽略大小写（作者偶尔会用拉丁字母写关系名） */
function sameRelation(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

/** 该对端点已存在的平行关系名（用于「重复」判定与合并文案） */
export function existingRelationsBetween(
  relations: readonly string[],
  relation: string,
): string[] {
  const normalized = normalizeRelation(relation);
  if (!normalized) return [];
  return relations.filter((item) => sameRelation(item, normalized));
}

export interface DraftCheckOptions {
  /** 同一对端点已存在的关系名（正反向都算，边是无向的） */
  existingRelations?: readonly string[];
}

/** 四类阻断 + 「将新建 / 合并」判定 */
export function checkDraft(
  input: DraftCheckInput,
  options: DraftCheckOptions = {},
): DraftCheck {
  const { source, target } = input;
  const relation = normalizeRelation(input.relation);
  const existing = existingRelationsBetween(options.existingRelations ?? [], relation);
  const issues: DraftIssue[] = [];

  if (source.id === target.id) {
    issues.push({
      code: "self",
      message: "不能与自己建立关系",
      fatal: true,
    });
  }
  if (source.workId !== target.workId) {
    issues.push({
      code: "cross-work",
      message: "不能连到别的作品的要素（数据不出本书）",
      fatal: true,
    });
  }
  if (!relation) {
    issues.push({
      code: "empty",
      message: "关系名不能为空",
      fatal: true,
    });
  }
  const merge = existing.length > 0;
  if (merge) {
    issues.push({
      code: "duplicate",
      message: `这对要素已有「${relation}」关系`,
      fatal: false,
    });
  }

  // 合并后这条平行关系会变成第 (已有条数) 条附加关系 → 标签 +N
  const mergeLabel = formatEdgeLabel(relation, existing.length);

  return {
    relation,
    issues,
    canSubmit: !issues.some((issue) => issue.fatal),
    merge,
    mergeLabel,
    verdict: merge ? `已存在同关系（合并为「${mergeLabel}」）` : "将新建",
  };
}

/** 一次连线提交要写入的行（id 由渲染层生成，主进程按 id 幂等插入） */
export function buildDraftLink(source: DraftEndpoint, target: DraftEndpoint, relation: string): NovelLink {
  return {
    id: createNovelId("l"),
    fromType: source.type,
    fromId: source.id,
    toType: target.type,
    toId: target.id,
    relation: normalizeRelation(relation),
  };
}

/** 节点级校验：两端必须都在本书要素集里（防御「端点已删」的残留拖拽） */
export function endpointsValid(
  source: DraftEndpoint | null | undefined,
  target: DraftEndpoint | null | undefined,
): boolean {
  return Boolean(source?.id && target?.id && source.workId === target.workId);
}
