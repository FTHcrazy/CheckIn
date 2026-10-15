/**
 * 全局设定中心的数据 hook（N6）
 *
 * 全局窗口是「即关即销」的独立窗口，窗口本身不持有需要跨会话保活的状态 ——
 * 全部数据取自主进程全局域 IPC（`novel-global-setting-*`），本 hook 只做：
 * 1. 装载（`globalSettingLoad`）与广播重载（`global-setting-changed`，H7）；
 * 2. 把 DTO 映射成 `SettingCategory` 交给共享的 `SettingCenter(source="global")`；
 * 3. 写操作收口 —— **写后重载**（不本地乐观更新）：设定窗口写操作低频，
 *    重载保证「引用计数 / 实时同步」这类主进程派生数据永远与库一致。
 *
 * 边界：不含 SQL、不认识主进程内部结构，只经 preload 暴露的 `electronAPI.novel`。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  NovelGlobalSettingCategoryDTO,
  NovelGlobalSettingCategoryPatch,
  NovelGlobalSettingLevelDTO,
  NovelGlobalSettingLevelPatch,
} from "@/shared/types/electron";
import type {
  SettingCategory,
  SettingCategoryKind,
  SettingLevel,
} from "@/shared/novel/setting-types";
import { DEFAULT_CATEGORY_COLOR } from "@/shared/novel/setting-defaults";
import { moveLevel, previewSplit } from "@/shared/novel/setting-utils";
import { SETTING_PRESETS } from "@/shared/novel/setting-presets";
import { createNovelId } from "@/shared/services/novel-shared";

/** 设定中心要求的回调集合（全局域实现，写后重载） */
export interface GlobalSettingController {
  /** 传给 `SettingCenter` 的 categories（已含 refCount） */
  settings: SettingCategory[];
  /** 首次装载是否还在路上（渲染占位用） */
  loading: boolean;
  /** 主动重载（窗口重新聚焦 / 广播 / 写后） */
  reload: () => void;
  onCreateCategory: (name: string, kind: SettingCategoryKind, color: string) => void;
  onPatchCategory: (categoryId: string, patch: NovelGlobalSettingCategoryPatch) => void;
  onDeleteCategory: (categoryId: string) => void;
  onReorderCategories: (orderedIds: string[]) => void;
  onAddLevel: (categoryId: string, name: string, index: number) => void;
  onBatchAddLevels: (categoryId: string, names: string[]) => void;
  onPatchLevel: (levelId: string, patch: NovelGlobalSettingLevelPatch) => void;
  onDeleteLevel: (levelId: string) => void;
  onReorderLevels: (categoryId: string, fromId: string, toIndex: number) => void;
  onSplitLevel: (levelId: string, segmentCount: number, namePattern?: string) => void;
  onMergeLevel: (levelId: string) => void;
  onExport: (categoryId: string, format: "json" | "markdown") => void;
  onApplyPreset: (presetId: string) => void;
}

/** 全局等级 DTO → 渲染层 SettingLevel（缺省值兜底，字段一一对应） */
function toLevel(dto: NovelGlobalSettingLevelDTO): SettingLevel {
  return {
    id: dto.id,
    categoryId: dto.categoryId,
    name: dto.name,
    rank: dto.rank,
    aliases: Array.isArray(dto.aliases) ? dto.aliases : [],
    note: dto.note ?? "",
    subLevels: dto.subLevels ?? 1,
    subPattern: dto.subPattern ?? "",
    power: dto.power ?? null,
    parentId: dto.parentId ?? null,
    segFrom: dto.segFrom ?? null,
    segTo: dto.segTo ?? null,
  };
}

/**
 * 全局分类 DTO → 渲染层 SettingCategory。
 *
 * 全局库与作品无关，`workId` 恒为空串；`refCount` 原样带出让列表显示
 * 「N 部书引用」徽标（REQ-041）。
 */
function toCategory(dto: NovelGlobalSettingCategoryDTO): SettingCategory {
  return {
    id: dto.id,
    workId: "",
    name: dto.name,
    color: dto.color,
    kind: dto.kind === "realm" ? "realm" : "custom",
    sortOrder: dto.sortOrder,
    note: dto.note ?? "",
    subLevels: dto.subLevels ?? 1,
    carryDir: dto.carryDir === "desc" ? "desc" : "asc",
    subPattern: dto.subPattern ?? "",
    levels: (dto.levels ?? []).map(toLevel),
    refCount: dto.refCount ?? 0,
  };
}

export function useGlobalSetting(): GlobalSettingController {
  const [settings, setSettings] = useState<SettingCategory[]>([]);
  const [loading, setLoading] = useState(true);
  /** 卸载后丢弃迟到的异步结果，避免对已销毁窗口 setState */
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const reload = useCallback(() => {
    const api = window.electronAPI?.novel;
    if (!api) {
      setLoading(false);
      return;
    }
    void api
      .globalSettingLoad()
      .then((result) => {
        if (!aliveRef.current) return;
        setSettings((result?.categories ?? []).map(toCategory));
      })
      .catch(() => {
        /* 装载失败保留上次列表；空态由 SettingCenter 自己呈现 */
      })
      .finally(() => {
        if (aliveRef.current) setLoading(false);
      });
  }, []);

  // 首次装载 + 订阅「全局设定已变」广播（含书侧引用 / 上架触发的计数刷新）
  useEffect(() => {
    reload();
    const api = window.electronAPI?.windowAPI;
    if (!api) return undefined;
    const handler = (): void => reload();
    api.on("global-setting-changed", handler);
    return () => api.off("global-setting-changed", handler);
  }, [reload]);

  const onCreateCategory = useCallback(
    (name: string, kind: SettingCategoryKind, color: string): void => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const api = window.electronAPI?.novel;
      if (!api) return;
      void api
        .globalCategoryAdd(createNovelId("gsc"), trimmed, kind, color || DEFAULT_CATEGORY_COLOR)
        .then(() => reload());
    },
    [reload],
  );

  const onPatchCategory = useCallback(
    (categoryId: string, patch: NovelGlobalSettingCategoryPatch): void => {
      if (patch.name !== undefined && !patch.name.trim()) return;
      const api = window.electronAPI?.novel;
      if (!api) return;
      void api.globalCategoryUpdate(categoryId, patch).then(() => reload());
    },
    [reload],
  );

  const onDeleteCategory = useCallback(
    (categoryId: string): void => {
      const api = window.electronAPI?.novel;
      if (!api) return;
      // D4 二次确认在主进程：先探引用计数，>0 时经 window.confirm 再执行固化删除
      void api.globalCategoryDelete(categoryId).then(async (first) => {
        if (first.ok) {
          reload();
          return;
        }
        if (first.refCount > 0) {
          const ok = window.confirm(
            `该分类正被 ${first.refCount} 部书引用。删除后这些书会把它就地固化为各自的本书副本（保留内容、不再同步）。确定删除？`,
          );
          if (!ok) return;
        }
        await api.globalCategoryDelete(categoryId, true);
        reload();
      });
    },
    [reload],
  );

  const onReorderCategories = useCallback(
    (orderedIds: string[]): void => {
      const api = window.electronAPI?.novel;
      if (!api) return;
      void api
        .globalCategoryOrder(orderedIds.map((id, index) => ({ id, sortOrder: index + 1 })))
        .then(() => reload());
    },
    [reload],
  );

  const onAddLevel = useCallback(
    (categoryId: string, name: string, index: number): void => {
      const trimmed = name.trim();
      if (!trimmed) return;
      const api = window.electronAPI?.novel;
      if (!api) return;
      void api.globalLevelAdd(categoryId, createNovelId("gsl"), trimmed, index).then(() => reload());
    },
    [reload],
  );

  const onBatchAddLevels = useCallback(
    (categoryId: string, names: string[]): void => {
      const cleaned = names.map((name) => name.trim()).filter(Boolean).slice(0, 99);
      if (cleaned.length === 0) return;
      const api = window.electronAPI?.novel;
      if (!api) return;
      void api
        .globalLevelBatchAdd(
          categoryId,
          cleaned.map((name) => ({ id: createNovelId("gsl"), name })),
        )
        .then(() => reload());
    },
    [reload],
  );

  const onPatchLevel = useCallback(
    (levelId: string, patch: NovelGlobalSettingLevelPatch): void => {
      if (patch.name !== undefined && !patch.name.trim()) return;
      const api = window.electronAPI?.novel;
      if (!api) return;
      void api.globalLevelUpdate(levelId, patch).then(() => reload());
    },
    [reload],
  );

  const onDeleteLevel = useCallback(
    (levelId: string): void => {
      const api = window.electronAPI?.novel;
      if (!api) return;
      void api.globalLevelDelete(levelId).then(() => reload());
    },
    [reload],
  );

  /**
   * 等级项重排：与本书域同一口径 —— 用 `moveLevel` 在 rank 升序上算出新 rank，
   * 再整批 `{id, rank}` 回写（主进程与本地各算一套，规则相同）。
   */
  const onReorderLevels = useCallback(
    (categoryId: string, fromId: string, toIndex: number): void => {
      const api = window.electronAPI?.novel;
      if (!api) return;
      const category = settings.find((item) => item.id === categoryId);
      if (!category) return;
      const next = moveLevel(category.levels, fromId, toIndex);
      void api
        .globalLevelOrder(next.map((level) => ({ id: level.id, rank: level.rank })))
        .then(() => reload());
    },
    [settings, reload],
  );

  const onSplitLevel = useCallback(
    (levelId: string, segmentCount: number, namePattern?: string): void => {
      const api = window.electronAPI?.novel;
      if (!api) return;
      const owner = settings.find((category) =>
        category.levels.some((level) => level.id === levelId),
      );
      const target = owner?.levels.find((level) => level.id === levelId);
      if (!owner || !target) return;
      // 等级序列只支持两层：子层级不允许再拆（与本书域同口径）
      if (target.parentId) return;
      const segments = previewSplit(target, segmentCount, target.subLevels, namePattern);
      void api
        .globalLevelSplit(
          levelId,
          segments.map((segment) => ({
            name: segment.name,
            from: segment.segFrom,
            to: segment.segTo,
          })),
        )
        .then(() => reload());
    },
    [settings, reload],
  );

  const onMergeLevel = useCallback(
    (levelId: string): void => {
      const api = window.electronAPI?.novel;
      if (!api) return;
      void api.globalLevelMerge(levelId).then(() => reload());
    },
    [reload],
  );

  /**
   * 导出全局库为 JSON / Markdown。
   *
   * 全局导出通道导出**整库**（无 per-category 接口），因此这里忽略 `categoryId`，
   * 与全局动作区「导出为 JSON（全部）」的文案一致。
   */
  const onExport = useCallback(
    (_categoryId: string, format: "json" | "markdown"): void => {
      void (async () => {
        const api = window.electronAPI?.novel;
        if (!api) return;
        const payload = await api.globalSettingExport();
        const base = "全局设定库-全部设定";
        if (format === "json") {
          await api.exportFile(base, JSON.stringify(payload, null, 2), "json", "JSON 文件");
          return;
        }
        const lines: string[] = ["# 全局设定库", ""];
        for (const category of payload.categories) {
          lines.push(`## ${category.name}`, "");
          if (category.note) lines.push(category.note, "");
          for (const level of category.levels) {
            const alias =
              level.aliases.length > 0 ? `（别名：${level.aliases.join("、")}）` : "";
            lines.push(`- **${level.rank}. ${level.name}**${alias} ${level.note}`);
          }
          lines.push("");
        }
        await api.exportFile(base, lines.join("\n"), "md", "Markdown 文件");
      })();
    },
    [],
  );

  /**
   * 应用内置预设到全局库：新建分类 + 补分类级元信息 + 批量灌等级。
   *
   * 与本书域同一套数据流，只是通道换成全局域（`gsc` / `gsl`）。realm 唯一性
   * 由主进程兜底（已有 realm 时降级为 custom）。
   */
  const onApplyPreset = useCallback(
    (presetId: string): void => {
      const preset = SETTING_PRESETS.find((item) => item.id === presetId);
      if (!preset) return;
      const api = window.electronAPI?.novel;
      if (!api) return;
      void (async () => {
        const saved = await api.globalCategoryAdd(
          createNovelId("gsc"),
          preset.name,
          preset.kind,
          DEFAULT_CATEGORY_COLOR,
        );
        if (!saved) {
          reload();
          return;
        }
        await api.globalCategoryUpdate(saved.id, {
          note: preset.note,
          subLevels: preset.subLevels,
          carryDir: preset.carryDir,
          subPattern: preset.subPattern,
        });
        if (preset.levels.length > 0) {
          await api.globalLevelBatchAdd(
            saved.id,
            preset.levels.map((level) => ({
              id: createNovelId("gsl"),
              name: level.name,
              subLevels: level.subLevels,
              subPattern: level.subPattern,
            })),
          );
        }
        reload();
      })();
    },
    [reload],
  );

  return {
    settings,
    loading,
    reload,
    onCreateCategory,
    onPatchCategory,
    onDeleteCategory,
    onReorderCategories,
    onAddLevel,
    onBatchAddLevels,
    onPatchLevel,
    onDeleteLevel,
    onReorderLevels,
    onSplitLevel,
    onMergeLevel,
    onExport,
    onApplyPreset,
  };
}
