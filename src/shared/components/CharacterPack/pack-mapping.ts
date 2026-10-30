/**
 * 属性映射（成长换算）—— 纯函数层
 *
 * 一条映射 = 「每 1 点源属性 → 目标属性加算 rate」。网游里最常见的写法是
 * 「每加 1 点力量，血量 +100」，玄幻里则是「每点根骨多 12 点气血」。
 *
 * ## 为什么不是简单的「各算各的」
 *
 * 源属性取的是它的**最终值**（含装备/技能/状态的加成），所以映射不能与
 * 效果词条一起在一趟循环里加完 —— 必须等所有属性的「不含映射的最终值」
 * 都算出来之后，再按**依赖顺序**叠加。否则就会出现「先算的映射读到源属性的
 * 基础值、后算的读到含加成的值」这种由排序决定的静默不一致。
 *
 * ## 成环时怎么办
 *
 * `力量→生命` 与 `生命→力量` 同时存在时方程没有唯一解（迭代会发散）。
 * 这里的选择是：**环上、以及所有被环挡住（下游）的映射一律不生效**，属性保持
 * 不含映射的值，并把原因如实上报给界面。理由是不猜 —— 与其给一个随顺序变化
 * 的数，不如明确说「这几条换算因为互相引用没有生效，请改掉」。
 *
 * 判定用 Kahn 拓扑排序：能排到的按顺序算，排不到的就是「环 + 环的下游」。
 * 再用一次**出度剥离**把两种情形分开（`cycle` / `blocked`）—— 看见 `d→c`
 * 被标成「循环引用」的人会去 `d→c` 里找环，那里没有；标成「被挡住」才对。
 */
import type { PackMappingRule } from "./types";

/** 一条映射实际产生的换算量（供「来源明细」逐条展示） */
export interface MappingHit {
  mappingId: string;
  sourceAttrId: string;
  rate: number;
  /** 源属性的最终值（含加成与它自己的换算） */
  sourceValue: number;
  /** 实际加算量 = round4(sourceValue × rate) */
  applied: number;
}

/**
 * 映射没能生效的原因。
 *
 * 判据一律看**目标属性**（它才是「算不出来的那个」），源在不在环上不影响结论：
 * 目标本身在环上 → `cycle`；目标只是因上游有环而排不到 → `blocked`。
 * 口径统一后，界面文案可以都说成「属性「c」…」，用户据此去查谁的引用关系。
 */
export type MappingProblem =
  /** 源与目标是同一个属性 —— 会自我放大，直接判无效 */
  | "self"
  /** 源或目标属性已不存在（历史脏数据） */
  | "missing"
  /** 目标属性本身在环上（`力量→生命` 与 `生命→力量` 同时存在） */
  | "cycle"
  /**
   * 目标属性不在环上，只是被上游的环挡住了 —— 算不出来就不能拿去用。
   *
   * 与 `cycle` 分开报是为了让人知道该去改哪一条：看到 `d→c` 标着「循环引用」
   * 会去找 `d→c` 里的环（那里根本没有），标着「被循环挡住」才会去查 `c` 的上游。
   */
  | "blocked";

/**
 * 原因 → 中文文案。
 *
 * 和类型放在一起而不是散在组件里：导出为 Markdown 的表格与面板上的提示都要用它，
 * 两处各写一份的话，改词的时候必然漏掉一处 —— 而漏掉的那处只是文案旧了，不报错。
 */
export const MAPPING_PROBLEM_META: Record<
  MappingProblem,
  { label: string; hint: string }
> = {
  self: {
    label: "源与目标相同",
    hint: "同一条属性对自己按系数放大没有上限，已忽略；把源或目标改成别的属性即可",
  },
  missing: {
    label: "属性已删除",
    hint: "源或目标属性已经不存在了；重新选一条属性，或者删掉这条换算",
  },
  cycle: {
    label: "循环引用",
    hint: "这条换算的目标属性同时是它自己的上游；环上的换算都没有唯一解，改掉其中一条",
  },
  blocked: {
    label: "被循环挡住",
    hint: "目标属性本身没问题，但它依赖的属性卷进了循环引用，所以算不出来；先解开上游那个环",
  },
};

export interface MappingEvaluation {
  /** 每个属性的换算加算合计（只含生效的映射；钉住的属性也照实记账，见 `frozenAttrIds`） */
  addMapped: Map<string, number>;
  /** 每个属性的换算明细，按目标属性归组 */
  hits: Map<string, MappingHit[]>;
  /** 启用了但没能参与换算的映射 → 原因（顺序稳定） */
  problems: Map<string, MappingProblem>;
}

/** 与 pack-utils 的 roundTo 同口径；此处内联以免两侧互相 import 成环 */
function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function pushHit(hits: Map<string, MappingHit[]>, hit: MappingHit, targetAttrId: string): void {
  const list = hits.get(targetAttrId);
  if (list) list.push(hit);
  else hits.set(targetAttrId, [hit]);
}

/**
 * 按依赖顺序求值。
 *
 * `baseFinal` 是各属性**不含映射**的最终值（即跑完两道闸门与运算顺序之后的值）。
 * `attrOrder` 用来给同层属性一个稳定顺序 —— 传入的属性顺序变了，
 * 结果必须不变（只在成环这种病态配置下才会看出差别，那时整组都会被丢弃）。
 */
export function evaluateMappings(input: {
  /** 属性 id 的稳定顺序（通常是 attributes 的 sortOrder 顺序） */
  attrOrder: string[];
  /** 各属性「不含映射」的最终值 */
  baseFinal: Map<string, number>;
  mappings: PackMappingRule[];
  /**
   * 「值已钉死」的属性：换算量照算照记账，但**不改变它的值**（`覆盖` 型效果命中的属性）。
   *
   * 覆盖的语义是「这个属性就是这个值」，所以映射进来的量既不能改写它，
   * 也不能顺着它流向下游 —— 否则「生命被覆盖为 9999」+「生命→战力」会算成
   * 9999 再加一遍映射量，与面板上写着的 9999 对不上。
   */
  frozenAttrIds?: Set<string>;
  /** 映射原样带上 id 时用；缺省时按 source→target 合成一个稳定 id */
  idOf?: (mapping: PackMappingRule) => string;
  sortOrderOf?: (mapping: PackMappingRule) => number;
}): MappingEvaluation {
  const { attrOrder, baseFinal, mappings, frozenAttrIds } = input;
  const idOf =
    input.idOf ?? ((mapping: PackMappingRule) => `${mapping.sourceAttrId}->${mapping.targetAttrId}`);
  const sortOrderOf = input.sortOrderOf ?? (() => 1);

  const known = new Set(attrOrder);
  const problems = new Map<string, MappingProblem>();
  const addMapped = new Map<string, number>();
  const hits = new Map<string, MappingHit[]>();
  const value = new Map<string, number>();
  for (const id of attrOrder) value.set(id, baseFinal.get(id) ?? 0);

  // 先剔掉结构上就不成立的（自指 / 属性已被删除 / 系数为 0 视同关闭）
  const live: Array<{ id: string; rule: PackMappingRule }> = [];
  for (const rule of mappings) {
    if (rule.rate === 0) continue;
    const id = idOf(rule);
    if (rule.sourceAttrId === rule.targetAttrId) {
      problems.set(id, "self");
      continue;
    }
    if (!known.has(rule.sourceAttrId) || !known.has(rule.targetAttrId)) {
      problems.set(id, "missing");
      continue;
    }
    live.push({ id, rule });
  }
  if (live.length === 0) return { addMapped, hits, problems };

  // 依赖图：目标依赖源。同一对 (源, 目标) 有多条时，按 sortOrder 依次叠加
  live.sort((a, b) => sortOrderOf(a.rule) - sortOrderOf(b.rule));
  const indeg = new Map<string, number>();
  const outgoing = new Map<string, Array<{ id: string; rule: PackMappingRule }>>();
  for (const id of attrOrder) {
    indeg.set(id, 0);
    outgoing.set(id, []);
  }
  for (const entry of live) {
    indeg.set(entry.rule.targetAttrId, (indeg.get(entry.rule.targetAttrId) ?? 0) + 1);
    outgoing.get(entry.rule.sourceAttrId)?.push(entry);
  }

  const resolved = new Set<string>();
  const queue = attrOrder.filter((id) => (indeg.get(id) ?? 0) === 0);
  while (queue.length > 0) {
    const current = queue.shift() as string;
    resolved.add(current);
    for (const entry of outgoing.get(current) ?? []) {
      const sourceValue = value.get(entry.rule.sourceAttrId) ?? 0;
      const applied = round4(sourceValue * entry.rule.rate);
      const target = entry.rule.targetAttrId;
      // 钉住的属性：账照记（列表上要能看见「这条算出了多少」），值不动（覆盖说了算）
      if (!frozenAttrIds?.has(target)) {
        value.set(target, (value.get(target) ?? 0) + applied);
      }
      addMapped.set(target, (addMapped.get(target) ?? 0) + applied);
      pushHit(hits, {
        mappingId: entry.id,
        sourceAttrId: entry.rule.sourceAttrId,
        rate: entry.rule.rate,
        sourceValue,
        applied,
      }, target);
      const left = (indeg.get(target) ?? 0) - 1;
      indeg.set(target, left);
      if (left === 0) queue.push(target);
    }
  }

  // 剩下的都在环上、或被环挡住：整组丢弃，别给出一个随顺序变化的数。
  // 注意 `addMapped` / `hits` 里可能已经攒了「来自已解析源」的部分贡献，一并撤掉。
  const unresolved = new Set(attrOrder.filter((id) => !resolved.has(id)));
  if (unresolved.size > 0) {
    // 残余图（只留两端都未解析的边）做**出度剥离**：能一路走到出口的节点
    // 只是「被环挡住」，剥不动的才是真正在环上的。分开报，用户才知道该改哪一条。
    const outdeg = new Map<string, number>();
    const sourcesOf = new Map<string, string[]>();
    for (const id of unresolved) {
      outdeg.set(id, 0);
      sourcesOf.set(id, []);
    }
    for (const entry of live) {
      const source = entry.rule.sourceAttrId;
      const target = entry.rule.targetAttrId;
      if (!unresolved.has(source) || !unresolved.has(target)) continue;
      outdeg.set(source, (outdeg.get(source) ?? 0) + 1);
      sourcesOf.get(target)?.push(source);
    }
    const blocked = new Set<string>();
    const peel = [...unresolved].filter((id) => (outdeg.get(id) ?? 0) === 0);
    while (peel.length > 0) {
      const id = peel.shift() as string;
      blocked.add(id);
      for (const source of sourcesOf.get(id) ?? []) {
        if (blocked.has(source)) continue;
        const left = (outdeg.get(source) ?? 0) - 1;
        outdeg.set(source, left);
        if (left === 0) peel.push(source);
      }
    }

    for (const id of unresolved) {
      value.set(id, baseFinal.get(id) ?? 0);
      addMapped.delete(id);
      hits.delete(id);
    }
    for (const entry of live) {
      const target = entry.rule.targetAttrId;
      if (!unresolved.has(target)) continue;
      problems.set(entry.id, blocked.has(target) ? "blocked" : "cycle");
    }
  }

  return { addMapped, hits, problems };
}

/** 一条映射的人读文案片段：`力量 ×100`（源属性名由调用方给出） */
export function mappingRateText(rate: number): string {
  const fixed = (Math.round(rate * 10000) / 10000).toString();
  return `×${fixed}`;
}
