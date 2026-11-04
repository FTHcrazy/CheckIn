/**
 * 地图「文件」store（当前打开的是哪张图、它的版本号与保存状态）。
 *
 * 【为什么与 `useMapDocStore` 分开】文档 store 管"画了什么"，本 store 管
 * "画的是哪一张、存到哪了"。两者生命周期不同：切图时文档整体换掉（并清空撤销栈），
 * 但保存状态与 rev 属于"文件"，混在一起会让「切图触发一次自动保存」这种事
 * 变成隐式副作用（切过去才发现把上一张的 rev 写到了新图上）。
 *
 * 边界：不 import 渲染层组件、不做 IO；读写通道在 `useMapPersistence`。
 */
import { create } from "zustand";

/**
 * 保存状态（工具栏那个小圆点读它）。
 *
 * - `idle`：还没装载完 / 没有当前图
 * - `dirty`：有改动尚未落库（防抖窗口内）
 * - `saving`：正在写
 * - `saved`：已落库
 * - `conflict`：别处改过（等用户在「载入最新 / 覆盖保存」里选）
 * - `error`：写入失败（网络无关，通常是库被锁 / 磁盘问题）
 */
export type MapSaveStatus = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";

interface MapFileState {
  /** 当前地图 id；`null` = 还没有装载任何一张 */
  docId: string | null;
  title: string;
  /** 绑定作品；`null` = 独立地图 */
  workId: string | null;
  /** 乐观锁版本号：每次成功保存后必须同步，否则下一次保存必冲突 */
  rev: number;
  status: MapSaveStatus;
  /** 首次装载是否完成（false 期间任何文档变更都不该触发保存） */
  loaded: boolean;

  /** 打开一张图（或新建后）落位 */
  openFile: (file: { id: string; title: string; workId: string | null; rev: number }) => void;
  setTitle: (title: string) => void;
  setWorkId: (workId: string | null) => void;
  setRev: (rev: number) => void;
  setStatus: (status: MapSaveStatus) => void;
  markLoaded: () => void;
  reset: () => void;
}

const INITIAL = {
  docId: null,
  title: "",
  workId: null,
  rev: 0,
  status: "idle" as MapSaveStatus,
  loaded: false,
};

export const useMapFileStore = create<MapFileState>()((set) => ({
  ...INITIAL,

  openFile: (file) =>
    set({
      docId: file.id,
      title: file.title,
      workId: file.workId,
      rev: file.rev,
      status: "saved",
    }),

  setTitle: (title) => set({ title }),
  setWorkId: (workId) => set({ workId }),
  setRev: (rev) => set({ rev }),
  setStatus: (status) => set({ status }),
  markLoaded: () => set({ loaded: true }),
  reset: () => set({ ...INITIAL }),
}));
