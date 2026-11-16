/**
 * 关系图派生层（纯函数，R27）
 *
 * 输入 = 一次 `novel-editor-load` 的要素 / 关联 / 设定；输出 = 画布节点、合并后的边、
 * 未上图要素（池子）与诊断计数。**不读库、不碰 DOM、不使用布局坐标**，同一输入
 * 必然产出同一结果（可单测，见 relation-graph.test.ts）。
 *
 * 三条收口规则（产品稿 §4.2 / §4.4，v2 沿用）：
 * ① 顶点归属反推 —— `novel_links` 没有 work_id，只有**两端 id 都落在本书要素集内**
 *    才算本书的边；否则按「跨作品 / 悬空」丢弃并计数。
 * ② 端点半解析 —— `to_type='level'`（当前境界绑定）不画边，降级为角色节点的副标题。
 * ③ 无自环、无重复边；同一对要素间的多条关系合并成一条边，标签「首条 + N」。
 */
import type { NovelEntity, NovelLink } from "./entity-model";
import type { SettingCategory } from "./setting-types";
import { formatBoundRealmName, parseRealmNoteSub } from "./setting-utils";

/** 画布节点（= 一张紧凑资料卡：类型 + 名称） */
export interface RelationGraphNode {
  /** 稳定 id（= 要素 id，React Flow 的 node.id） */
  id: string;
  /** 要素 id（与 id 同值，保留语义命名） */
  entityId: string;
  type: string;
  name: string;
  aliases: string[];
  summary: string;
  /** 境界副标题：`to_type='level'` 绑定派生，空串 = 无 */
  realm: string;
  /** 关联条数（去重后的原始关联数，供详情卡展示） */
  relationCount: number;
  /** 是否已上图（false = 在左侧池子里） */
  linked: boolean;
}

/** 画布边（一对要素一条，平行关系合并） */
export interface RelationGraphEdge {
  id: string;
  source: string;
  target: string;
  /** 首条关系名（画布标签的正文） */
  relation: string;
  /** 全部关系名，保留原始顺序 */
  relations: string[];
  /** 平行条数 = relations.length - 1 */
  extraCount: number;
  /** 显示标签：「关系名」或「关系名 +2」 */
  label: string;
  /** 首条关系的备注 */
  note?: string;
  /**
   * 每条平行关系对应的 `novel_links.id`（与 `relations` **同序**）。
   *
   * 边是「合并视图」，写操作却必须落到具体那一行（备注按 id 更新、删除按 id 删）。
   * S1/S2 只读时不需要它；S3 的边详情要逐条改备注，没有这个映射就只能按
   * 关系名反查 —— 而关系名允许重复存在于不同要素之间，反查必错。
   */
  linkIds: string[];
  /** 每条平行关系的备注（与 `relations` 同序；缺省 = 该行没有备注） */
  notes: Array<string | undefined>;
}

/** 诊断计数：两个「被忽略」的数字必须分开（C7 / C11 / A-3） */
export interface RelationGraphDiagnostics {
  /** 本书要素总数 */
  entityCount: number;
  /** 图上节点数 */
  nodeCount: number;
  /** 图上边数（合并后） */
  edgeCount: number;
  /** 未上图（池中）要素数 */
  poolCount: number;
  /** 本书内可成图的原始关联条数（去重、去自环后） */
  linkCount: number;
  dropped: {
    /** 境界绑定（降级为副标题，不画边） */
    level: number;
    /** 自环 */
    selfLoop: number;
    /** 悬空端点（指向已删除 / 不存在 / 非要素类型） */
    dangling: number;
    /** 另一端属于别的作品 */
    crossWork: number;
    /** 同向同关系名的完全重复行 */
    duplicate: number;
  };
}

export interface RelationGraphDoc {
  workId: string;
  /** 本书全部要素（原 sort 顺序；池子与画布都从这里取，避免两处顺序不一致） */
  all: RelationGraphNode[];
  /** 上图节点（按要素 sort 排序，确定性） */
  nodes: RelationGraphNode[];
  edges: RelationGraphEdge[];
  /** 未上图要素（池子）：默认 = 无任何关联的孤立要素 */
  pool: RelationGraphNode[];
  diagnostics: RelationGraphDiagnostics;
}

export interface BuildRelationGraphInput {
  workId: string;
  /** 全库要素（未过滤，函数内部按 workId 收口） */
  entities: NovelEntity[];
  /** 全库关联（未过滤 —— `data.links` 本来就不按 workId 过滤） */
  links: NovelLink[];
  /** 小说设定（含 realm 阶梯），`to_type='level'` 的名字靠它翻译 */
  settings?: SettingCategory[];
  /**
   * 已保存的画布成员集合（S2 起从 `novel_rel_graph_v1` 读）。
   * 缺省 / null = 自动铺开：把所有「有关联」的要素铺上图，其余进池子。
   */
  members?: readonly string[] | null;
}

/** 合并标签：首条 + N（**不是** ` · ` 拼接，见产 §4.3 收口） */
export function formatEdgeLabel(relation: string, extraCount: number): string {
  if (extraCount <= 0) return relation;
  return `${relation} +${extraCount}`;
}

/** 无向配对键：同一对要素的正反向关系合并为一条边 */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

/** 境界绑定派生：所有 realm 分类的阶梯摊平后按 id 查名 */
function collectRealmLevels(settings: SettingCategory[]) {
  return settings.flatMap((category) => category.levels ?? []);
}

/**
 * 派生关系图。
 *
 * 注意：孤立要素**不会**在派生层被丢弃 —— 它们进 `pool`，由画布决定「不上图但可见」。
 */
export function buildRelationGraph(input: BuildRelationGraphInput): RelationGraphDoc {
  const { workId, entities, links, settings = [], members = null } = input;

  const workEntities = entities
    .filter((entity) => entity.workId === workId)
    .slice()
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "zh-CN"));

  const workIds = new Set(workEntities.map((entity) => entity.id));
  const otherWorkIds = new Set(
    entities.filter((entity) => entity.workId !== workId).map((entity) => entity.id),
  );

  const dropped = { level: 0, selfLoop: 0, dangling: 0, crossWork: 0, duplicate: 0 };

  // ── ① 境界绑定：to_type='level' 不画边，记录到 fromId 的副标题 ──
  const realmLevels = collectRealmLevels(settings);
  const realmByEntity = new Map<string, string>();
  for (const link of links) {
    if (link.toType !== "level") continue;
    if (!workIds.has(link.fromId)) continue;
    dropped.level += 1;
    // 同一角色多条境界绑定（历史脏数据）：保留最后一条**能解析出名字**的
    const realm = formatBoundRealmName(
      realmLevels,
      link.toId,
      parseRealmNoteSub(link.note),
    );
    if (realm) realmByEntity.set(link.fromId, realm);
  }

  // ── ② 实体 → 实体：两端都在本书才成立 ──
  interface UsableLink {
    link: NovelLink;
    source: string;
    target: string;
  }
  const usable: UsableLink[] = [];
  const seenExact = new Set<string>();

  for (const link of links) {
    if (link.toType === "level") continue;
    const fromIn = workIds.has(link.fromId);
    const toIn = workIds.has(link.toId);
    if (!fromIn || !toIn) {
      if (otherWorkIds.has(link.fromId) || otherWorkIds.has(link.toId)) {
        dropped.crossWork += 1;
      } else {
        dropped.dangling += 1;
      }
      continue;
    }
    if (link.fromId === link.toId) {
      dropped.selfLoop += 1;
      continue;
    }
    const exact = `${link.fromId}\u0000${link.toId}\u0000${link.relation}`;
    if (seenExact.has(exact)) {
      dropped.duplicate += 1;
      continue;
    }
    seenExact.add(exact);
    usable.push({ link, source: link.fromId, target: link.toId });
  }

  // ── ③ 平行关系合并：同一对要素一条边，标签「首条 + N」 ──
  const edgeByPair = new Map<string, RelationGraphEdge>();
  const degree = new Map<string, number>();
  const relationCount = new Map<string, number>();

  for (const item of usable) {
    relationCount.set(item.source, (relationCount.get(item.source) ?? 0) + 1);
    relationCount.set(item.target, (relationCount.get(item.target) ?? 0) + 1);

    const key = pairKey(item.source, item.target);
    const existing = edgeByPair.get(key);
    if (existing) {
      existing.relations.push(item.link.relation);
      existing.linkIds.push(item.link.id);
      existing.notes.push(item.link.note);
      existing.extraCount = existing.relations.length - 1;
      existing.label = formatEdgeLabel(existing.relation, existing.extraCount);
      continue;
    }
    edgeByPair.set(key, {
      id: `e:${key.split("\u0000").join("~")}`,
      source: item.source,
      target: item.target,
      relation: item.link.relation,
      relations: [item.link.relation],
      extraCount: 0,
      label: item.link.relation,
      note: item.link.note,
      linkIds: [item.link.id],
      notes: [item.link.note],
    });
  }

  const edges = [...edgeByPair.values()];
  for (const edge of edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }

  // `null` = 还没有画布记忆（首次装载中 / 未启用记忆）→ 走自动铺开；
  // `[]` = 用户把图清空了（语义是「显式空集合」，不能再退化成自动铺开）
  const memberSet = members ? new Set(members) : null;

  const toNode = (entity: NovelEntity, linked: boolean): RelationGraphNode => ({
    id: entity.id,
    entityId: entity.id,
    type: entity.type,
    name: entity.name,
    aliases: entity.aliases,
    summary: entity.summary,
    realm: realmByEntity.get(entity.id) ?? "",
    relationCount: relationCount.get(entity.id) ?? 0,
    linked,
  });

  // 上图判定：显式成员集合优先；否则「有一条边就上图」
  const all: RelationGraphNode[] = workEntities.map((entity) => {
    const inGraph = memberSet
      ? memberSet.has(entity.id)
      : (degree.get(entity.id) ?? 0) > 0;
    return toNode(entity, inGraph);
  });

  const nodes = all.filter((node) => node.linked);
  const pool = all.filter((node) => !node.linked);

  const nodeIds = new Set(nodes.map((node) => node.id));
  const visibleEdges = edges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
  );

  return {
    workId,
    all,
    nodes,
    edges: visibleEdges,
    pool,
    diagnostics: {
      entityCount: workEntities.length,
      nodeCount: nodes.length,
      edgeCount: visibleEdges.length,
      poolCount: pool.length,
      linkCount: usable.length,
      dropped,
    },
  };
}
