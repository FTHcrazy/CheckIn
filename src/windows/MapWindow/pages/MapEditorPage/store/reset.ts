/**
 * 地图编辑器三个 store 的统一复位入口。
 *
 * 供两处调用：
 *   · 测试的 beforeEach / afterEach（store 是模块级单例，必须显式复位）；
 *   · MapWindow「即关即销」销毁时（下次打开从空文档起步）。
 *
 * 与项目 useNovelEditorStore.test.ts 的 reset() 范式一致：
 * 单例 store 的隔离只能靠显式 setState，不能靠 React cleanup。
 */
import { createEmptyDocument } from "../types";
import { resetMapDocStore } from "./useMapDocStore";
import { resetMapViewportStore } from "./useMapViewportStore";
import { resetMapSelectionStore } from "./useMapSelectionStore";

export function resetMapStores(): void {
  resetMapDocStore(createEmptyDocument());
  resetMapViewportStore();
  resetMapSelectionStore();
}
