/**
 * 境界读写口子（REQ-048 / PRD §9.7.6）
 *
 * 三条硬契约：
 *  1. 所有境界读取必须走 `getRealm()`；需要「对外展示的那份」时走 `getPanelRealm()`
 *  2. 所有境界写入必须走 `setRealm()` —— 任何绕过它的写入都算实现缺陷，即使功能正确
 *  3. 禁止任何代码直接引用境界字段（`novel_pack_characters.realm_at` / `novel_links` 的「当前境界」行）
 *
 * 第 3 条不依赖未来是否做 split：直接引用不会在 v1 出错，只会在切换时变成
 * 「改了没反应」的静默不同步。**契约不是「照做一遍」，而是「每次改动后查一遍」。**
 *
 * v1 只实现 linked 语义（行囊境界 ≡ 面板境界）；split（行囊记真实修为、面板挂对外宣称）
 * 属于 v1.5 预留，正式版不输出开关，但升级时只改本文件即可，调用方零改动。
 */
import type { PackRealmLinkDTO } from "./types";
import { carryRealm, clampRealm, type LadderRung, type RealmPosition } from "./pack-utils";

export interface RealmState {
  /** novel_links 的「当前境界」行（唯一事实源，未绑定实体时为 null） */
  link: PackRealmLinkDTO | null;
  /** 未绑定实体时行囊自持的境界 JSON `{levelId, sub}`（仅行囊内使用） */
  realmRaw: string;
  /** 等级阶梯（来自 R25 novel_levels，已按 rank 排序） */
  rungs: LadderRung[];
  /** 是否已绑定 EntityPanel 实体 */
  bound: boolean;
  /**
   * 绑定的实体 id：`novel_links.from_id` 指向的是 `novel_entities.id`，
   * 与行囊自己的角色 id **不同源**（§9.7.5）——漏了它就会写进两条互不相干的关系行。
   */
  entityId: string;
}

export interface RealmWritePlan {
  /** 需要落库的 novel_links 行（幂等 upsert）；null = 本次不写 links */
  link: PackRealmLinkDTO | null;
  /** 需要写回的 realm_at JSON；null = 本次不改该字段 */
  realmRaw: string | null;
  /**
   * 本次实际落到的位置（进位 / 夹取之后的**唯一真相**）。
   *
   * 调用方拿它做 toast 文案，不要自己再算一遍：两份规则一旦漂移，就会出现
   * 「toast 说变了、数据没变」的假变更（「阶内进位」曾因为漏传 carry 而踩到）。
   */
  position: RealmPosition;
}

export const UNBOUND_REALM_HINT = "尚未指定主角，境界仅在行囊内使用";

/** 解析行囊自持境界（`{levelId, sub}`），失败返回 null */
export function parseRealmRaw(raw: string): { levelId: string; sub: number } | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as { levelId?: unknown; sub?: unknown };
    if (typeof record.levelId !== "string") return null;
    return { levelId: record.levelId, sub: Number(record.sub) || 1 };
  } catch {
    return null;
  }
}

/**
 * 解析 `novel_links.note` 里的小层。
 *
 * ⚠️ 不能用 `parseRealmRaw` 代替：那条解析要求 `levelId` 字段存在，而 note 里
 * **只写 `{sub}`**（等级由 `to_id` 承载）。早期版本复用了它，导致已绑定状态下
 * 读出的 sub 永远是 1 —— 写成「小层改了、重开面板又回到第 1 层」的静默失效。
 */
export function parseSub(raw: string): number {
  if (!raw) return 1;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return 1;
    const sub = Number((parsed as { sub?: unknown }).sub);
    return Number.isFinite(sub) && sub >= 1 ? Math.floor(sub) : 1;
  } catch {
    return 1;
  }
}

/** 把「等级 id + 小层」换算成阶梯下标（找不到该等级时回落到第 0 阶） */
export function toPosition(
  rungs: LadderRung[],
  levelId: string | null,
  sub: number,
): RealmPosition {
  if (!levelId) return { index: 0, sub: 1 };
  const index = rungs.findIndex((rung) => rung.id === levelId);
  if (index < 0) return clampRealm(rungs, { index: 0, sub });
  return clampRealm(rungs, { index, sub });
}

/** 把阶梯下标换算回「等级 id + 小层」 */
export function fromPosition(
  rungs: LadderRung[],
  position: RealmPosition,
): { levelId: string; sub: number } {
  return {
    levelId: rungs[position.index]?.id ?? "",
    sub: position.sub,
  };
}

/**
 * 读 —— 行囊视角。
 * split 放开后：优先返回独立值，缺失则回退联动值；v1 与 getPanelRealm 同源。
 */
export function getRealm(state: RealmState): RealmPosition {
  const linked = readLinked(state);
  if (linked) return linked;
  const own = parseRealmRaw(state.realmRaw);
  return toPosition(state.rungs, own?.levelId ?? null, own?.sub ?? 1);
}

/**
 * 读 —— 面板（对外展示）视角。
 * 面板永远读联动值：未绑定时没有面板境界，回落到阶梯首阶。
 */
export function getPanelRealm(state: RealmState): RealmPosition {
  return readLinked(state) ?? toPosition(state.rungs, null, 1);
}

function readLinked(state: RealmState): RealmPosition | null {
  if (!state.bound || !state.link) return null;
  return toPosition(state.rungs, state.link.toId, parseSub(state.link.note));
}

/**
 * 写 —— 唯一写入口。
 *
 * `origin` 不是文案用途，它决定**路由目标**：`origin === 'r25'` → 永远写面板那份；
 * 其余在 split 下写行囊自己那份。若忽略这层语义，R25 侧的改动会落进行囊那份，
 * 表现为「面板看着变了、行囊侧却没跟着变」的**反向**静默不同步。
 * （原型实测踩过，见 PRD §9.7.6）
 *
 * 未绑定实体时不写 novel_links（避免产生孤儿关系行 §9.7.5）；
 * 且 `origin === 'r25'` 的写入在未绑定时无目标，直接拒绝（返回空计划）。
 */
export function setRealm(
  state: RealmState,
  position: RealmPosition,
  origin: "pack" | "r25",
  options: { linkId?: string; carry?: boolean; delta?: number } = {},
): RealmWritePlan {
  const next = options.carry
    ? carryRealm(state.rungs, position, options.delta ?? 0)
    : clampRealm(state.rungs, position);
  const resolved = fromPosition(state.rungs, next);

  if (state.bound && state.entityId) {
    return {
      position: next,
      link: {
        // id 仅在新建行时使用；已有行沿用原 id，保证幂等 upsert 不新增孤儿
        id: options.linkId || state.link?.id || "",
        fromType: "character",
        fromId: state.entityId,
        toType: "level",
        toId: resolved.levelId,
        relation: "当前境界",
        note: JSON.stringify({ sub: resolved.sub }),
      },
      realmRaw: null,
    };
  }
  // 未绑定：仅行囊内使用。面板视角不存在目标，不写。
  if (origin === "r25") return { position: next, link: null, realmRaw: null };
  return {
    position: next,
    link: null,
    realmRaw: JSON.stringify({ levelId: resolved.levelId, sub: resolved.sub }),
  };
}
