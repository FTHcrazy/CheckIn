# Changelog · 2.21.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

## [2.21.0] - 2026-11-03

> 地图**对象可编辑**（B1，R-MAP-23 / R-MAP-25）：素材从"只能拖动"变成
> "选中即属性面板"——四件套（尺寸 / 旋转 / 不透明 / 色相）+ 层级 + 排序 +
> 剪贴板与微移。数据模型加两个可选字段，老地图读点兜底、无需迁移。

### Added

- **素材属性面板**（`components/ElementPanel/`）：选中素材浮出，提供尺寸 / 旋转 /
  不透明度 / 色相四条滑杆（同键合并 = 一次拖动一步撤销）、层级下拉（含
  「层级无关」）、置顶 / 置底 / 复制 / 删除；工具栏的「地名」输入框迁入面板
  （它是"选中对象的属性"，不该拆在两处）。
- **素材外观字段**（`MapElement.opacity` / `MapElement.tint`）：可选字段，缺省按
  不透明 + 原色读（`elementOpacityOf` / `elementTintHueOf` / `tintColorOf`，
  渲染、命中与面板共用同一套取值规则）；色相即"同素材不同色"的变体基础（B3 生成器靠它做抖动）。
- **剪贴板与快捷键**（R-MAP-25）：`Ctrl+C / X / V`（应用内剪贴板，可连续粘贴）、
  `Ctrl+D` 复制一份并选中副本、方向键 / WASD 微移（精调 4 / Shift 加速 16 个
  世界单位，连按合并为一步撤销）；输入框与滑杆焦点内不劫持。
- **文档 store 新动作**（`useMapDocStore`）：`updateElement`（clamp + 空变更不压
  快照）、`reorderElement`（置顶 / 置底）、`duplicateElement`、`copyElement` /
  `cutElement` / `pasteElement`（会话级剪贴板，切图复位）、`nudgeElement`。

### Changed

- 工具栏「选择 / 画区 / 加标注」图标化（aria-label 与原文案一致，测试与读屏不受影响）；
  画布提示补微移与剪贴板说明。
