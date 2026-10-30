/**
 * 关系图数据装载（S1 只读装载 / S2 起提供原件供重派生）
 *
 * 数据源只用一次 `novel-editor-load`（includeContent=false，不拉正文）+ 一次
 * `configGet('novel_entity_types')`（自建类型色）。派生交给纯函数
 * `buildRelationGraph`，本 hook 只负责 IO 与状态机。
 *
 * 刻意不订阅「要素保存」类事件：主窗口改要素名 / 类型后由用户点「刷新」重取
 * （要素变更会连带改节点集合，重派生比重合并安全）。**只**订阅
 * `novel-links-changed`：关系增删是纯增量，按 id 合并即可（S4 / W-16）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STORAGE_KEYS } from "@/shared/novel/constants";
import type { CustomEntityTypeDef, NovelEntity, NovelLink } from "@/shared/novel/entity-model";
import { buildRelationGraph, type RelationGraphDoc } from "@/shared/novel/relation-graph";
import type { SettingCategory } from "@/shared/novel/setting-types";
import type { NovelBundleDTO, NovelLinksDelta } from "@/shared/types/electron";

export interface RelationGraphData {
  workId: string;
  workName: string;
  /** 题材（可空）：关系推断的 prompt 背景用（作品窗口那边同样按这个口径喂） */
  workGenre?: string;
  /** 全部作品（只有 id/name）：切书横幅要显示「主窗口已切到《B》」 */
  works: WorksOption[];
  /** 原始数据：画布记忆变更后要按新成员集合重新派生，所以原件必须留在手里 */
  entities: NovelEntity[];
  links: NovelLink[];
  settings: SettingCategory[];
  customTypes: CustomEntityTypeDef[];
  /**
   * 缺省派生（不套成员集合）：首次播种的种子清单 + 坐标兜底。
   * 最终上图集合由 `useGraphDoc` 用成员集合重新派生。
   */
  baseDoc: RelationGraphDoc;
  /** 数据快照时间（毫秒） */
  loadedAt: number;
  /** 派生耗时（纯函数，不含 IPC）——埋点 rel_graph_open 的 deriveMs */
  deriveMs: number;
}

export interface WorksOption {
  id: string;
  name: string;
}

export type RelationDataState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: RelationGraphData }
  | { status: "error"; message: string };

/** 自建类型配置是「整读整写」的 JSON；坏数据按空表处理，绝不让整窗白屏 */
export function parseCustomTypes(raw: string | null): CustomEntityTypeDef[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): CustomEntityTypeDef[] => {
      if (!item || typeof item !== "object") return [];
      const def = item as { id?: unknown; name?: unknown; color?: unknown };
      if (typeof def.id !== "string" || typeof def.name !== "string") return [];
      return [{ id: def.id, name: def.name, color: typeof def.color === "string" ? def.color : "#8b77f0" }];
    });
  } catch {
    return [];
  }
}

/** 提交成功后要合并回本窗口的增量（来自主进程事务返回值，不重载 bundle） */
export interface LinkDelta {
  /** 本次真正新增的行 */
  created?: readonly NovelLink[];
  /** 改过的备注（id + 新值） */
  notes?: ReadonlyArray<{ id: string; note: string | null }>;
  /** 被删掉的行（主窗口「解除关联」→ 图上那条边消失，节点与坐标不动） */
  removed?: readonly string[];
  /** 改了关系名的行（主窗口暂无改名入口，契约先留好） */
  relations?: ReadonlyArray<{ id: string; relation: string }>;
}

export interface UseRelationDataResult {
  state: RelationDataState;
  refresh: () => void;
  /**
   * 把增量并进本地 links（按 id 幂等），**不重载 bundle**。
   *
   * 为什么不能直接 `refresh()`：重载会让 `useGraphDoc` 的记忆重装，正在拖动中
   * 的坐标会被库里的旧值盖掉；而且状态机会闪一次 loading。
   */
  applyLinkDelta: (delta: LinkDelta) => void;
}

export function useRelationData(workId: string | null | undefined): UseRelationDataResult {
  const [state, setState] = useState<RelationDataState>({ status: "idle" });
  const requestRef = useRef(0);

  const load = useCallback(async (targetWorkId: string) => {
    const api = window.electronAPI?.novel;
    if (!api) {
      setState({ status: "error", message: "数据通道不可用（预加载脚本未就绪）" });
      return;
    }
    const requestId = ++requestRef.current;
    setState({ status: "loading" });
    try {
      const [bundle, rawTypes] = await Promise.all([
        api.editorLoad(false) as Promise<NovelBundleDTO>,
        api.configGet(STORAGE_KEYS.entityTypes),
      ]);
      // 竞态：切书期间旧请求晚到，丢弃
      if (requestId !== requestRef.current) return;

      const work = bundle.works.find((item) => item.id === targetWorkId);
      if (!work) {
        setState({ status: "error", message: "这部作品已不存在（可能已被删除）" });
        return;
      }

      const deriveStarted = performance.now();
      const entities = bundle.entities as unknown as NovelEntity[];
      const links = bundle.links as unknown as NovelLink[];
      const settings = bundle.settings as unknown as SettingCategory[];
      const baseDoc = buildRelationGraph({ workId: targetWorkId, entities, links, settings });
      const deriveMs = Math.round(performance.now() - deriveStarted);

      setState({
        status: "ready",
        data: {
          workId: targetWorkId,
          workName: work.name,
          ...(work.genre ? { workGenre: work.genre } : {}),
          works: bundle.works.map((item) => ({ id: item.id, name: item.name })),
          entities,
          links,
          settings,
          customTypes: parseCustomTypes(rawTypes),
          baseDoc,
          loadedAt: Date.now(),
          deriveMs,
        },
      });
    } catch (error) {
      if (requestId !== requestRef.current) return;
      const message = error instanceof Error ? error.message : String(error);
      setState({ status: "error", message: `装载失败：${message}` });
    }
  }, []);

  useEffect(() => {
    if (!workId) {
      setState({ status: "idle" });
      return;
    }
    void load(workId);
  }, [workId, load]);

  const refresh = useCallback(() => {
    if (workId) void load(workId);
  }, [workId, load]);

  const applyLinkDelta = useCallback((delta: LinkDelta) => {
    const created = delta.created ?? [];
    const notes = delta.notes ?? [];
    const removed = delta.removed ?? [];
    const relations = delta.relations ?? [];
    if (
      created.length === 0 &&
      notes.length === 0 &&
      removed.length === 0 &&
      relations.length === 0
    ) {
      return;
    }

    setState((current) => {
      if (current.status !== "ready") return current;
      const data = current.data;
      let links = data.links;
      let changed = false;

      // 先删再并：同一次 delta 里「删了又建」（合并语义下的极端情况）以新行为准
      if (removed.length > 0) {
        const gone = new Set(removed);
        const kept = links.filter((link) => !gone.has(link.id));
        if (kept.length !== links.length) {
          links = kept;
          changed = true;
        }
      }

      if (created.length > 0) {
        const known = new Set(links.map((link) => link.id));
        const fresh = created.filter((link) => !known.has(link.id));
        if (fresh.length > 0) {
          // 新边放最前：与主窗口 addLink 的乐观插入顺序保持一致
          links = [...fresh, ...links];
          changed = true;
        }
      }

      if (relations.length > 0) {
        const byId = new Map(relations.map((item) => [item.id, item.relation]));
        let touched = false;
        links = links.map((link) => {
          const next = byId.get(link.id);
          if (next === undefined || next === link.relation) return link;
          touched = true;
          return { ...link, relation: next };
        });
        if (touched) changed = true;
      }

      if (notes.length > 0) {
        const byId = new Map(notes.map((item) => [item.id, item.note]));
        let touched = false;
        links = links.map((link) => {
          if (!byId.has(link.id)) return link;
          const note = byId.get(link.id) ?? undefined;
          if ((link.note ?? undefined) === note) return link;
          touched = true;
          return { ...link, note };
        });
        if (touched) changed = true;
      }

      if (!changed) return current;
      return { status: "ready", data: { ...data, links } };
    });
  }, []);

  /**
   * 反向同步（S4 / W-16）：主窗口删关系 / 建关系后，图窗口跟着变。
   *
   * 三条硬约束：
   * ① **只合并 links，不碰画布记忆** —— 成员集合与坐标都不变，于是不会重排；
   *    节点集合由 `members` 决定（不是由边决定），删一条边永远不会让卡片消失。
   * ② **不 `load()`** —— 重载会让 `useGraphDoc` 重装记忆，正在拖的坐标被库里
   *    旧值盖掉，还会闪一次 loading。
   * ③ **不弹确认框** —— 这是别人已经做完的事，不是需要用户决策的草稿。
   */
  useEffect(() => {
    const api = window.electronAPI?.windowAPI;
    if (!api) return undefined;
    const handler = (...args: unknown[]): void => {
      const payload = args[0] as NovelLinksDelta | undefined;
      if (!payload || typeof payload !== "object") return;
      // 有 workId 就挡掉别书的增量；缺省时按 id 合并（id 全局唯一）
      if (payload.workId && payload.workId !== workId) return;
      applyLinkDelta({
        created: (payload.created ?? []) as unknown as NovelLink[],
        notes: payload.notes ?? [],
        removed: payload.removed ?? [],
        relations: payload.relations ?? [],
      });
    };
    api.on("novel-links-changed", handler);
    return () => api.off("novel-links-changed", handler);
  }, [applyLinkDelta, workId]);

  return useMemo(() => ({ state, refresh, applyLinkDelta }), [state, refresh, applyLinkDelta]);
}
