/**
 * 地图选择 / 工具态 store（模块级 zustand 单例）。
 *
 * 持有「选中素材」「待放置素材」两个轻量交互态。
 *
 * ── 为什么独立 ──
 * 选中态是**高频、短暂**的：点选 / 拖拽 / 缩放时频繁变化，却与文档数据
 * 毫无关系。与 doc store 拆开后，选中一个素材不再惊动文档树，删除选中
 * 也不会让视口重渲染。
 */
import { create } from "zustand";

interface MapSelectionState {
  /** 当前选中的素材 id；null = 未选中 */
  selectedId: string | null;
  /** 当前选中的区块 id；null = 未选中。与 `selectedId` 互斥（选素材则清区块，反之亦然） */
  selectedRegionId: string | null;
  /** 当前待放置的素材（点击面板后进入「待放置」态，再点画布落位） */
  pendingSpriteId: string | null;
  setSelectedId: (id: string | null) => void;
  setSelectedRegionId: (id: string | null) => void;
  setPendingSpriteId: (id: string | null) => void;
}

export const useMapSelectionStore = create<MapSelectionState>()((set) => ({
  selectedId: null,
  selectedRegionId: null,
  pendingSpriteId: null,
  setSelectedId: (id) => set({ selectedId: id }),
  setSelectedRegionId: (id) => set({ selectedRegionId: id }),
  setPendingSpriteId: (id) => set({ pendingSpriteId: id }),
}));

/** 复位选择 store（测试隔离 + 窗口即关即销时清空） */
export function resetMapSelectionStore(): void {
  useMapSelectionStore.setState({ selectedId: null, selectedRegionId: null, pendingSpriteId: null });
}
