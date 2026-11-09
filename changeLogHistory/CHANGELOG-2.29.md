# Changelog · 2.29.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

## [2.29.0] - 2026-11-05

> 地图 **B4-1：图层面板**。左栏底部新增一块"画在哪一层"：六行（底图只读 + 区块/折线/素材/子图/地名）、
> 眼睛管显隐、锁管可编辑、每行带对象计数、整块可折叠。同时把**折线的数据模型**先落好（B4-2 直接接）。
> 一句话：一键成图吐出几十个素材之后，终于能"把素材整层关掉，看地形摆得对不对"。

### Added

- **图层面板（R-MAP-24 / B4-1）**：`components/LayerPanel/`，左栏底部、素材库下方，六行固定顺序。
  `base` 行只读（带静态锁）——底图恰恰是"关不掉的那一层"，画成灰行比不列更诚实。
  每行计数从文档算（`区块 17` / `素材 42` / `折线 0`），空层照常显示：**层的集合是能力，不是数据**。
  折叠偏好存 `localStorage`，不进文档、不进撤销栈。
- **图层数据层**：`layerState.ts` —— `MAP_LAYER_IDS` / `MAP_LAYER_ROWS`（层清单唯一出处）、
  `layerVisibleOf` / `layerLockedOf`（**唯一读点**，`region` 的可见性回落到 `showRegions`）、
  `normalizeLayerState`（迁移时只删不加：未知层、非布尔、`region.visible` 一律剔除）。
  `MapDocument.layerState?` 为可选字段，`createEmptyDocument` / `migrateDoc` **都不写值**（零写入）。
- **折线数据模型（B4-2 前置）**：`MapPolyline`（`kind` 五值 + `styleId` + `points` + `closed` + `level` + `label`）、
  `createPolylineId`、`docPolylines` / `submapPolylines` 读点、`MapSubmap.polylines?`。
  本版**只有数据与计数**，无渲染、无工具态（见 `docs/prd/prd-map-render/map-b4-layers-polyline-prd.md` §6）。

### Changed

- **图层显隐的落地方式**：`element` / `submap` / `label` 三层关掉时设容器 `visible = false`
  （整棵子树跳过绘制）；`region` 仍走既有 `alpha`——它要在 0.16 填充下继续透出陆地材质，
  改成 `visible` 会顺带改掉既有观感。
- **锁定贯通五处**：`pickElement`（含画布"按下已选中素材即起拖"）、双击改地名、键盘 Delete、
  属性面板删除、清空画布。只改页面那个调用点会漏掉画布的拖拽入口，表现为"锁了还能拖"。
- **锁定有话说**：命中被锁层时 `message.info("「素材」层已锁定，先解锁再编辑")`。
  静默无反应是最差的结果——用户只会认为功能坏了。
- **撤销账目**：图层显隐/锁定各记一步（与 `showRegions` 同级）；**切回默认值时删键**而不是写
  `{visible: true}`，否则每份存档都会慢慢堆满空状态。
- **区块可见性的唯一事实源仍是 `showRegions`**：面板的区块行眼睛直接读写它，
  `layerState.region.visible` 在迁移时被丢弃（双源必然漂移）。

### Fixed

- **`pickElement` 的 stale closure**：给命中测试加锁定时，`useCallback` 依赖只写了 `doc.elements`，
  而锁定只改 `doc.layerState` → 回调一直闭着锁定前的文档 → "锁了还能点中"。
  用例红在 `expected { id: 'el_x' } to be null`，改为把锁定状态算成独立常量 `elementLayerLocked` 进依赖。

### Docs

- `prd-map-render/map-b4-layers-polyline-prd.md`：§9 三条开放问题拍板 —— **D8** 折线固定
  Catmull-Rom tension 0.5、不做全局滑杆（要自由度就加样式档）；**D9** "自动分组"与"类型层"不是一件事，
  另立 R-MAP-29；**D10** 子图内**暂不显示**折线工具（子图现在连素材/地名都改不了，
  单独开一条能画的线是自相矛盾），数据模型已预留。另补 §6.1 B4-1 落地记录。
- `map-window-overview.md`：能力域 13 → 14（新增"图层面板 ◐"）、时间线补 2.29.0、§3.1/§3.3/§3.5 按 B4-1 收口重排。
