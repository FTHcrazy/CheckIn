/**
 * SettingCenter —— 已提升到 `src/shared/components/SettingCenter`（T03）
 *
 * 提升原因（§5.5 / H6）：全局设定中心独立窗口需要复用「本书设定中心」的三栏
 * 结构，而窗口之间禁止互相导入、`src/shared/*` 也不允许 import `src/windows/*`，
 * 故把组件整体下沉到 `src/shared/components/SettingCenter`（与 `CharacterPack`
 * 同级，允许含 React），并新增 `source: "book" | "global"` 入参区分两个域。
 *
 * 本文件保留为**同名 re-export 垫片**，`NovelPage.tsx` 的既有 import 路径
 * （`./components/SettingCenter`）零改动；组件本体、样式与测试均已迁入 shared。
 */
export { default } from "@/shared/components/SettingCenter";
export type {
  SettingCenterProps,
  SettingCenterSource,
} from "@/shared/components/SettingCenter";
