# B4 需求：图层面板 + 折线要素（R-MAP-24 / R-MAP-26）

> 状态：**B4-1 已实施（2.29.0）、B4-2 已实施（2.30.0）、B4-3 已实施（2.31.0）**——B4 三批全部闭环。
> 基线：CheckIn **2.31.0**（工作区）
> 上游：[`map-window-overview.md`](map-window-overview.md) §3.5「推荐开工顺序」第 1 条 ·
> [`review/map-vs-reference-interaction-review.md`](../../review/map-vs-reference-interaction-review.md) §7/§9 的 B4
> 采纳来源：[`nested-submap-elements.md`](nested-submap-elements.md) §3（`MapPolyline` 数据模型 + 线纹理笔刷）、
> [`nested-submap-road.md`](nested-submap-road.md) §3（道路层与样式）、
> [`nested-submap-elements.md`](nested-submap-elements.md) §3.4（水系不做自动生成的业界结论）
> 本文**取代**上述两篇中「道路/折线」部分的**执行口径**（两篇降为素材与算法依据，不再单独排期）。

---

## 0. 结论速览（7 条拍板项）

| # | 议题 | 结论 | 依据 |
|---|------|------|------|
| **D1** | 图层能不能自由排序 / 自由建组 | **不能**。图层 = 固定顺序的**类型容器**，v1 只给「显隐 + 锁定」。 | 逆向目标同层只放同类型；Wonderdraft 固定 water/land/paths/symbols/regions/labels/overlay；Inkarnate 2.0 之前 11 个固定对象层，社区催「Photoshop 式拖拽排序」催了 3 年，官方才在 Custom Layers 项目里给（见 §2 证据） |
| **D2** | 图层面板放哪 | **左栏底部**（素材库下方，可折叠），不新增第三栏、不塞右栏浮层。 | 逆向目标的图层组也在左栏（底图/画笔/要素/图层/页面尺寸）；左栏语义 =「用什么画 + 画在哪层」 |
| **D3** | `doc.layers` 存什么 | **只存状态，不存结构**：`layerState: Partial<Record<LayerId,{visible,locked}>>`，层的集合是常量。 | 层集合由能力决定、不是用户数据；结构进文档就要迁移，还要处理「文档里有而代码没有的层」 |
| **D4** | 区块层可见性归谁 | 仍归 `showRegions`（唯一事实源）。面板读写它，不写 `layerState.region.visible`。 | 它已经是「成品图开关」，且影响导出与老测试；双写必然漂移 |
| **D5** | 折线做几套类型 | **一套 `MapPolyline` + `kind` 枚举**（road / river / ridge / border / route），不为每种线各建类型。 | `nested-submap-elements.md` §3.1 已定；道路只是 `kind:"road"` |
| **D6** | 「面要素」这一批做不做 | **不做填充面**。只做 `closed: true` 的**闭合折线（描边）**，填充字段留空。 | `regions` 已占 polygon 语义（tiling 划分）；再加自由面就要处理与区块的重叠/填充/导出/子图裁剪四套规则，成本差一个数量级；湖泊与势力范围用闭合折线已能满足 80% |
| **D7** | 渲染栈怎么办 | 新增物理层 `polylineLayer`，插在 `regionLayer` 与 `elementLayer` **之间**（8 层 → 9 层）。 | 逆向 z 序 `POLYGON → LINE → POINT → TEXT`；Wonderdraft 的 paths 在 symbols 之下 |

> 一句话：**这一批交付的是「能分层管 + 能画线」，不是「能自由组图层」和「能填色」。**
> 后两者都在 §7 记了「为什么现在不做、什么条件下再做」。

---

## 1. 为什么是这两件事（而不是继续调观感）

现状（`map-window-overview.md` §1）：10 个能力域已闭环，观感已对齐九成（`render-analysis` §9 只剩 3 条待办且都要等口径）。
真正卡住用户的是**对象管不住**：

- 一键成图（2.25.0）一次产出几十个素材，**只能一个点点删**，不能「把森林整层关掉看看地形」；
- 画不出河。而河流是一张地图最便宜的信息量来源（Wonderdraft 的主打卖点就是「几笔画出好看的河流与道路」）；
- 这两个能力同时是 4 件后续工作的前置：一键成图的河流、生成器自动分组 folder、
  对象的层级语义、`nested-submap-road.md` 的落地（见 `map-window-overview.md` §3.3）。

---

## 2. 竞品与逆向目标的共识（三个成熟产品 converges 同一结论）

| 维度 | 逆向目标（易制地图，实测 A/B） | Wonderdraft | Inkarnate | 我们 |
|------|------------------------------|-------------|-----------|------|
| 层的形式 | **六类类型容器 + 文件夹树**；同层只能放同类型 | water / land / **paths** / symbols / regions / labels / overlay —— **固定 7 层** | 2.0 之前 11 个固定对象层；2.0 才允许自定义层拖拽 | 渲染栈已有 8 层（`layers.ts`），**无文档层** |
| z 序 | `BASEMAP → PaintCover → PAINT → POLYGON → LINE → POINT → TEXT` | 固定顺序（线在符号下） | 笔刷层整体在对象层下 | 固定顺序 |
| 显隐/锁定 | ✅ 每层 | ✅ | ✅ | ❌ 只有「显示分区」 |
| 排序 | ✅（含文件夹） | ❌ | 2.0 起可拖拽 | ❌ |
| 线要素 | LINE 层 + 节点拖拽 | paths：几笔画出河流/道路，可改节点 | 路径工具 | ❌ |

**可复用的三条结论**：

1. **「类型即图层」是这类工具的公约数**，不是简化版妥协 —— 用户的心智是「我在改线还是改点」，不是「这个对象在哪个组」。
2. **固定顺序优先于自由排序**。Inkarnate 的排序诉求存在了三年才被满足，期间用户的真实痛点是「不知道东西在哪个层」——
   靠**面板里列出每一层 + 层内对象清单**就能解决 80%，不需要真的改 z 序。
3. **线的「好看」靠平滑 + 变宽 + 笔刷**，不靠自动生成。`nested-submap-elements.md` §3.4 已经把这条论证过：
   连 Azgaar 都退回到「用户手画、系统不校验高程」；逆向目标则**完全没有水体资产**（60 图集零河流）。

---

## 3. 需求一：图层面板（R-MAP-24）

### 3.1 用户故事

> 我生成了一张图，想确认「陆地是干净的、山摆得对不对」——把**素材层**关掉看底图。
> 我摆错了城市位置，想去改，但画布上东西太多——**锁定**其它层，只留城郭可选。
> 我不确定河流画在哪一层了——面板上按类型分组，一眼看到「折线 3」。

### 3.2 逻辑层清单（代码常量，不进文档）

| # | 层 id | 名称 | 数据来源 | 物理层（`layers.ts`） | v1 可见 | v1 可锁 |
|---|-------|------|----------|----------------------|---------|---------|
| 1 | `base` | 底图与海面 | `baseImageId` + `paperGrain` | `staticLayer` + `coast` | 🔒 只读行 | ❌ |
| 2 | `region` | 区块 | `doc.regions` | `regionLayer` | ✅（写 `showRegions`） | ✅ |
| 3 | `polyline` | 折线 | `doc.polylines`（B4-1 已落数据模型，B4-2 接工具） | `polylineLayer`（B4-2 新增；当前该行只记状态，暂无渲染对象） | ✅ | ✅ |
| 4 | `element` | 素材 | `doc.elements` | `elementLayer` | ✅ | ✅ |
| 5 | `submap` | 子图 | `doc.regions[].submap` | `submapLayer` | ✅ | ✅ |
| 6 | `label` | 地名 | `doc.labels` | `labelLayer` | ✅ | ✅ |

**为什么底图行只读也要列出来**：面板如果只列 5 行，用户会以为「底图不在图层体系里」，
而底图恰恰是「关不掉的那一层」—— 明确画成一条灰行、带锁图标，比不显示更诚实。

`overlay` 与 `draftLayer` **不进面板**：它们是交互指示（选中框）与草稿，不是内容。

### 3.3 数据模型（零写入原则）

```ts
/** 图层 id：与 §3.2 的清单一一对应（`base` 不在其中，它不可写） */
export type MapLayerId = "region" | "polyline" | "element" | "submap" | "label";

/** 单个逻辑层的用户可改状态（**两个字段都可选**，缺省 = 可见且未锁） */
export interface MapLayerState {
  visible?: boolean;
  locked?: boolean;
}

/** MapDocument 增加（可选字段，老文档不写值） */
layerState?: Partial<Record<MapLayerId, MapLayerState>>;
```

**三条约束（写进类型注释，实施时必须照做）**：

1. **`createEmptyDocument()` / `migrateDoc()` 都不写这个字段**（沿用 `regionSchema` 的零写入原则）——
   老文档形状逐字节不变，只在用户真的点了眼睛/锁之后才出现。
2. **读点函数唯一**：`layerVisible(doc, id)` / `layerLocked(doc, id)` 两个纯函数收口，
   组件里禁止直接读 `doc.layerState?.[id]?.visible ?? true`（`region` 的回落是 `showRegions`，
   散着写必然有人漏掉这个分支）。
3. **`migrateDoc` 只做「非法则剔除」**：`layerState` 里出现未知 key、或者 `visible` 不是布尔，直接丢该项，不报错、不补默认值。

### 3.4 交互规格

| 元素 | 行为 | 备注 |
|------|------|------|
| 行 | 图标 + 名称 + 对象计数（`素材 42` / `区块 17` / `折线 3`） | 计数从文档算，不缓存 |
| 眼睛 | 切换 `visible`，**画面即时生效**，撤销栈记一步 | 与 `showRegions` 联动（D4） |
| 锁 | 切换 `locked`：命中测试跳过该层、框选跳过、键盘删除跳过 | 锁不改变渲染 |
| 悬停 | 行高亮；`title` 给出「该层放什么」的一句话 | 与 ElementPanel 的 Tooltip 风格一致 |
| 锁定中的层被点击 | 不选中，画布底部提示「`素材` 层已锁定」 | 静默无反应是最差的结果 |
| 空层 | 照常显示，计数 `0`，眼睛可点但无效果 | 不隐藏空层：层集合是**能力**，不是数据 |
| 折叠 | 整块可折叠（默认展开），折叠状态存 `localStorage` | UI 状态不进文档、不进撤销栈 |

**不做**（写入 §7 的「暂缓」）：拖拽排序、新建自定义层、文件夹分组、层内对象列表（v1 只在层行显示计数）、
层级的批量显隐。

### 3.5 与 `showRegions` 的关系（迁移口径）

- `showRegions` **保留**为区块层可见性的唯一事实源；面板的区块行眼睛直接读写它。
- `layerState.region` 只允许出现 `{ locked }`；若老数据里出现 `region.visible`，`migrateDoc` 丢弃该字段（避免双源）。
- 工具栏「更多 → 显示分区」保留，与面板眼睛是同一状态的两个入口（就像 `Ctrl+Z` 与工具栏撤销按钮）。

---

## 4. 需求二：折线要素（R-MAP-26）

### 4.1 数据模型

```ts
export interface MapPolyline {
  id: string;                        // 前缀 pl_
  kind: "road" | "river" | "ridge" | "border" | "route";
  styleId: string;                   // 见 §4.4
  points: Point[];                   // 世界坐标；首尾是端点，中间是控制点
  closed: boolean;                   // true = 闭合（湖泊/势力范围轮廓），v1 只描边不填充
  level: number | null;              // 层级归属，语义同 MapElement.level
  label?: string;                    // 语义标签（官道/土路），纯展示，≠ kind
}

/** MapDocument 与 MapSubmap 都增加（子图内也能画线） */
polylines?: MapPolyline[];           // 可选 → 老文档不写值
```

**为什么 `polylines` 是可选而不是 `[]`**：与 `layerState` 同理（零写入）。
读点用 `docPolylines(doc)` / `submapPolylines(submap)` 两个纯函数兜底成 `[]`，
禁止在渲染与命中测试里各写一次 `?? []`。

### 4.2 绘制交互（工具态 `polyline`）

`MapTool` 从 `"select" | "draw"` 扩为 `+ "polyline"`。与 `draw`（画区）**互斥**，
进入一个必须退出另一个（沿用 `handlePickTool` 的现有约定）。

| 操作 | 行为 |
|------|------|
| 单击空白 | 落一个控制点；上一段实时预览（跟随光标） |
| 双击 / `Enter` | 结束（≥2 点才成线；1 点则丢弃并退出） |
| `Esc` | 结束当次绘制并退出工具态（沿用画区态的 Esc 语义） |
| `Backspace` / `Ctrl+Z` | 退一个控制点（**线还没落库时**只退点，不整体撤销） |
| 起点 8px 内单击（`closed` 模式） | 闭合 |

**先画后调**：落完线进入 `select` 态并选中它，右栏浮出「折线属性」（样式下拉 + 线宽 + 层级 + 删除），
沿用 `ElementPanel` 的浮层范式 —— 不新起一套面板。

### 4.3 几何与渲染

- **平滑**：控制点之间走 Catmull-Rom（`tension 0.5`），与 `land.ts` 的 `drawLandPath` 复用同一条路径生成器，
  避免「陆地边缘平滑、河流折线生硬」的割裂。
- **线宽单位 = 世界单位**（与区块边界一致，缩放时线随图一起变细），**但设屏幕下限 0.75px**：
  否则缩到洲一级时道路整体消失（这是 D7 迁移后最容易踩的坑）。
- **节点命中半径 = 屏幕恒定 8px**（世界单位会随缩放变大变小，缩小后节点根本点不中）。
- **层级权重**：`alpha = elementWeight(level, levelAlphas)`，线宽每级减半（`elementSizeFactor`）——
  与素材、地名同一套规则，不新发明。
- **子图**：折线随子图递归渲染，走子图的 `levelAlphas`；父图不显示子图折线（沿用 road 篇 D4 结论）。

### 4.4 样式集（v1 五档，常量表）

| `styleId` | `kind` | 外观 | 用途 |
|-----------|--------|------|------|
| `road-main` | road | 深褐 4px + 米白内描 2px（双层） | 官道 / 主路 |
| `road-trail` | road | 深褐 2px，短虚线 | 小路 / 山径 |
| `river` | river | 蓝绿 3.2px，无描边 | 河流 |
| `ridge` | ridge | 深褐 2px + 三角笔刷（沿路径贴 PNG） | 山脉脊线 |
| `border` | border | 红褐 2px，长虚线，两端渐隐 | 势力边界 |

- 双层描边是「手绘地图」的关键观感（单根纯色线看起来像 CAD 图纸）；
- `ridge` 的笔刷纹理走 `nested-submap-elements.md` §3.2 的 `brushTextureId` 通路，
  **v1 可以先落 `undefined` 走纯色**（样式表预留字段，不阻塞交付）；
- 河流的「源头细、入海粗」变宽留到 B4-3（需要按弧长插值线宽，`Graphics` 分段绘制），**v1 等宽**。

### 4.5 编辑与生命周期

| 操作 | 行为 |
|------|------|
| 选中 | 单击线（命中半径 = 线宽/2 + 6px 屏幕）；显示节点手柄 |
| 拖节点 | 移动单个控制点（拖动中不写撤销栈，松手记一步） |
| 双击节点 | 删除该点（少于 2 点时整条删除） |
| 双击线段 | 在该处插入一个点 |
| `Delete` | 删除整条线（撤销可回） |
| 复制粘贴 / 微移 | 与素材同一套：`Ctrl+C/V/D`、方向键与 WASD |

**不做**：「平滑度滑杆」「端点吸附到素材/地名」「自动避让海岸线」（§7）。

---

## 5. 渲染栈变更（8 → 9 层）

```ts
// layers.ts，插在 regionLayer 之后
"staticLayer", "coast", "regionLayer", "polylineLayer", "elementLayer",
"submapLayer", "labelLayer", "overlay", "draftLayer",
```

**受影响的三处守卫（必须同步改，不许绕过）**：

1. `render-stack-guard.test.ts` 里的 `toHaveLength(8)` → 8 应改为读常量或改成 9 ——
   该文件自己写着「禁止裸下标」，长度是唯一的例外，改时把注释一起更新；
2. `MapCanvas/index.tsx` 的节点装配（新层要建容器并 `addChildAt`，位置从 `worldLayerIndexOf("polylineLayer")` 取）；
3. `bake.test.tsx` / `coastBake.test.ts` 的「holder children 数量」断言（2.28.0 刚从 8 改成 17）。

> 这是本项目**第一次在 `WORLD_LAYER_ORDER` 中间插层**（此前都是末尾追加 `draftLayer`）。
> 插入而不是追加的理由：线必须压在素材之下（D7），追加到末尾会变成「路盖住山」。

---

## 6. 分批与验收

| 批次 | 状态 | 内容 | 验收判据（可执行） | 复杂度 |
|------|------|------|-------------------|--------|
| **B4-1** | ✅ **2.29.0** | 图层面板：6 行结构、眼睛、锁、计数、折叠；`layerState` 数据层与读点函数；`showRegions` 联动 | ① 关掉素材层 → 画布上素材立刻消失，撤销一步恢复；② 锁定素材层 → 点素材选不中且有提示（折线层的同款验收随 B4-2）；③ 关窗再开，显隐/锁定状态仍在（落在 `doc_json` 里）；④ 老文档（无 `layerState`）打开后 `doc_json` **字节不变**（不写空对象） | S~M |
| **B4-2** | ✅ **2.30.0** | 折线：`MapPolyline` + 数据通路（增删改、撤销、持久化、导出）+ `polylineLayer` + 平滑渲染 + 5 档样式 + 绘制态 | ① 画一条 3 点折线 → 刷新后形状不变；② 拖中间节点整条线跟着平滑变形；③ 缩到洲一级线还在（屏幕下限生效）；④ 导出 PNG 里线存在；⑤ 撤销：落线一步、拖节点一步、删线一步 | L |
| **B4-3** | ✅ **2.31.0** | 打磨：河流变宽、`ridge` 笔刷纹理、闭合折线（`closed`）、折线属性浮层补齐（另补 §4.5 的复制粘贴 / 微移） | ① 河流从源头到入海肉眼可辨变宽；② 山脉脊线能看到笔刷而非纯线 | M |

> **B4-1 与 B4-2 的先后不可颠倒**：折线的可见性/锁定要挂在图层上，
> 先做线再做层等于把同一套开关写两遍。

### 6.1 B4-1 落地记录（2.29.0）

| 事项 | 落地方式 | 文件 |
|------|----------|------|
| 层清单 / 读点 / 归一化 | `MAP_LAYER_IDS` + `MAP_LAYER_ROWS`（六行，含只读底图）；`layerVisibleOf` / `layerLockedOf` 两个读点收口；`normalizeLayerState` 只删不加 | `MapEditorPage/layerState.ts`（新） |
| 文档字段 | `layerState?` 与 `polylines?` 均为可选；`migrateDoc` 只剔除非法项，**不写空对象** | `MapEditorPage/types.ts` |
| 撤销账目 | `DocSnapshot.layerState`（眼/锁各记一步）；`withLayerState` 把"切回默认"写成**删键**，避免存档里堆 `{visible:true}` | `store/useMapDocStore.ts` |
| 渲染 | `element` / `submap` / `label` 三层用容器 `visible` 关（整棵子树跳过绘制）；`region` 仍走既有 `alpha`（要在半透明填充下透出陆地） | `components/MapCanvas/index.tsx` |
| 锁定生效点 | 五处：`pickElement`（含画布起拖）、双击改地名、键盘 Delete、属性面板删除、清空画布 | `hooks/useMapEditor.ts`、`index.tsx`、`MapCanvas/index.tsx` |
| 锁定提示 | 命中被锁层时 `message.info("「素材」层已锁定，先解锁再编辑")`，不静默 | `index.tsx` |
| 面板 | 左栏底部（素材库下方），6 行 + 计数 + 眼/锁 + 折叠；折叠状态存 `localStorage`（不进文档、不进撤销栈） | `components/LayerPanel/`（新） |
| 折线数据模型 | `MapPolyline` + `createPolylineId` + `docPolylines` / `submapPolylines` 读点先落地（B4-2 直接用），面板折线行计数已接 | `types.ts` |

**实施中的两处偏离（记录在案，避免后人当成漏项）**：

1. **`layerState` 进了撤销栈**。§8-5 原文写"不能进撤销栈的对象快照"，实施时按
   §3.4「眼睛切换记一步」执行：它不是**对象批量快照**的一员（没有"选中一批改属性"
   的语义），但每次切换是独立的、看得见的一步，必须可撤销 —— 与 `showRegions` 同级。
   §8-5 已按此订正。
2. **`region` 的渲染仍是 `alpha`，不是 `visible`**。两者都能"看不见"，但 `alpha`
   是既有行为（`showRegions` 的效果），改成 `visible` 会顺带改掉半透明填充下
   透出陆地的那点观感，属于本次不该动的范围。

### 6.2 B4-2 落地记录（2.30.0）

| 事项 | 落地方式 | 文件 |
|------|----------|------|
| 几何（纯函数层） | `smoothPolyline`（Catmull-Rom，端点镜像外推防"线头发直"）、`distanceToPath` / `nearestOnPath`（命中与插点共用一条采样路径）、`dashPath`（虚线按弧长切段） | `MapEditorPage/polylineGeometry.ts`（新） |
| 样式表 | `POLYLINE_STYLES` 五档常量；线宽 = **世界单位** + 屏幕下限 0.75px（`effectiveWidthWorld`）；命中容差 = `线宽/2 + 6px 屏幕` | `MapEditorPage/polylineStyle.ts`（新） |
| 绘制 | `strokeStyled`（实线/虚线/两端渐隐）+ `drawPolyline`（主线 + 内描芯，**顺序不可反**）；不挂滤镜（§8-1） | `components/MapCanvas/polylineRender.ts`（新） |
| 渲染栈 | `WORLD_LAYER_ORDER` 8 → 9，`polylineLayer` 插在 `regionLayer` 与 `elementLayer` 之间（D7）；折线按层级分容器，与素材层同构 | `layers.ts`、`MapCanvas/index.tsx` |
| 数据层 | `addPolyline` / `updatePolyline` / `removePolyline` / `movePolylinePoint`（高频、不入栈）/ `insertPolylinePoint` / `deletePolylinePoint`（<2 点整条删）；`DocSnapshot.polylines`，撤销回"从没画过线"时**删键** | `store/useMapDocStore.ts` |
| 交互 | 绘制态（单击落点 / 双击与 Enter 收尾 / Esc 四级退让 / Delete 退草稿点）；选中态（拖节点绝对坐标、双击线上插点取**线上最近点**、双击节点删点、锁层提示） | `MapCanvas/index.tsx`、`index.tsx` |
| 属性面板 | 样式下拉 / 粗细滑杆（`coalesceKey` 压撤销步）/ 层级下拉 / 名称输入（本地草稿按 id 重置）/ 删除 | `components/PolylinePanel/`（新） |
| 守卫更新 | `render-stack-guard.test.ts` 长度 9 + 「折线层插在区块与素材之间」用例；pixi 替身补 `lineTo` / `circle` | 同名测试文件 |

**实施中的三处偏离（记录在案）**：

1. **样式档线宽与 §4.4 表格的"px"口径不同**。表格写的是视觉印象（4px/2px），
   实际按**世界单位**落地（`road-main` 5 + 内描 2.4 等）——px 是屏幕量、
   世界单位才随图缩放，§4.3 的口径优先。
2. **§4.5 的「复制粘贴 / 微移」未随 B4-2 交付**。R-MAP-25 的剪贴板与方向键微移
   只覆盖素材；折线要接的话需要"选中折线时的同一套快捷键分流"，留待实机反馈
   出现"想复制一条河"再补（删除与撤销已全量可用）。**→ 已于 B4-3（2.31.0）补齐**。
3. **`ridge` 笔刷纹理、河流变宽、闭合折线按计划留给 B4-3**；`border` 的
   两端渐隐（`fadeEnds`）已随样式表一并交付。**→ B4-3 已全部落地，见 §6.3。**

### 6.3 B4-3 落地记录（2.31.0）

| 事项 | 落地方式 | 文件 |
|------|----------|------|
| 河流变宽 | 样式档加 `taper: {from, to}`（river 0.35→1，按**弧长**线性插值）；渲染用**带状填充**（`ribbonPolygon` 左右偏移 + 两端圆头扇，一次 `beginFill` 成形）而不是分段描边 —— 河流带 0.92 透明度，分段描边的圆头接缝会叠画出一串深色斑点 | `polylineStyle.ts`、`polylineGeometry.ts`（`pointTangentAtLength` / `ribbonPolygon`）、`polylineRender.ts`（`drawTaperedFill`） |
| ridge 笔刷 | 样式档加 `hatch`（影线颜色/粗细/间距/长短两档）：沿弧长每 `2.4×线宽` 在行进方向**右手侧**戳一根垂直短线、长短交替 —— 传统 hachure 的极简版；**确定性**落点（不掷随机数），重绘之间毛边不跳动 | 同上（`drawHatch`） |
| 闭合折线 | 渲染 / 命中 / 高亮 / 双击四处共用一条退化守卫：`closed && points.length >= 3`，<3 点按开链；绘制态**点回起点**（≥3 点、`DRAFT_CLOSE_PX` 内）= 闭合收尾；面板「闭合」开关（<3 点禁用）；store 删点致 <3 点时自动写回 `closed:false` | `polylineRender.ts`、`useMapEditor.ts`、`MapCanvas/index.tsx`、`index.tsx`、`PolylinePanel/`、`useMapDocStore.ts` |
| 复制 / 粘贴 / 微移 | store 剪贴板扩为 `MapElement \| MapPolyline` 联合（按 `points` 判形态），`copy` / `cut` / `paste` / `duplicate` / `nudge` 五动作内部分流 —— hook 与页面快捷键的**分流只发生在"选中哪个字段"上**；折线无联动地名，微移即全部点平移，与素材同键同账目（合并键压步） | `useMapDocStore.ts`、`useMapEditor.ts`、`index.tsx` |

**实施中的两处偏离（记录在案）**：

1. **`StrokeTarget` 加了可选 `beginFill` / `endFill` 能力位**。§8 未提：变宽带需要
   一次填充画多边形，而旧测试替身没有这两个方法 —— 渲染前**先探能力**，
   不满足回退等宽描边（线还在，只是不变宽），不让一条河崩掉整张图。
2. **taper 与 dash 互斥、闭环不吃 taper**（一条首尾相接的河没有"哪头是海"）。
   样式表里没有同时具备两者的档位；真出现时本实现忽略 dash / taper。

---

## 7. 明确不做（附解锁条件）

| 暂缓项 | 为什么现在不做 | 什么条件下再做 |
|--------|----------------|----------------|
| **图层自由排序 / 自定义层 / 文件夹分组** | 见 §2 结论 2：收益是极少数场景，代价是「同层多类型」的 z 冲突、导出顺序、子图继承三套规则 | 出现「用户把河流放在山之上」这类**真实工单**，且面板已有层内对象清单 |
| **填充面（湖泊/势力范围涂色）** | `regions` 已占 polygon 语义；自由面要处理与 tiling 的重叠、填充混合、子图裁剪 | `closed` 折线上线后仍被反馈「区域上不了色」 |
| **线要素自动生成（河流/道路）** | `nested-submap-elements.md` §3.4 已论证：程序化产「地理正确」，手画产「好看」；逆向目标零水体 | 不排期（若做，只做「沿两点连线 + 避让陆地边缘」的道路，不做水文） |
| **多选 / 框选 / 层内对象列表** | R-MAP-25 已交付单对象剪贴板；多选是另一条独立的交互改造 | 素材数常态 > 100 时 |
| **端点吸附（线连到城/渡口）** | 需要「要素连接图」的数据模型（`fromId`/`toId` 目前只是预留字段） | 做 R-MAP-06「地点连线」时一并设计 |

---

## 8. 风险与不变量

1. **不要给 `polylineLayer` 挂滤镜**：与海岸同理（`map-window-overview.md` §6-2），运行期零滤镜是流畅度的基本盘。
2. **不要在 `Graphics` 上逐帧重画全部折线**：折线进 `Graphics` 后按「文档变更 → 重画该层」，
   拖动节点时只重画被拖那条（分段 `clear` + `moveTo`），否则 20 条线拖动会掉帧。
3. **`WORLD_LAYER_ORDER` 仍是唯一出处**：插层后禁止任何地方写裸下标（含测试）。
4. **锁 ≠ 隐藏**：锁定层照常渲染、照常参与 LOD；只是不参与命中与编辑。
5. **图层状态必须随文档落库，也要进撤销栈**：它是 UI 状态里唯一需要持久化的一项，
   也是唯一"看得见的画面变化"（关掉素材层 ≠ 只是折叠一个面板）。与 `showRegions`
   同级处理：**文档字段 + 一次 commit**，一次切换一步；但**不要**塞进 `elements`
   那种"选中一批改属性"的批量快照（它没有批量语义）。切回默认值时写**删键**
   而不是 `{visible:true}`，否则存档里会慢慢堆满空状态。

---

## 9. 已决问题（原「待评审开放问题」，2026-11-05 拍板）

> 三条已按「先低风险、后扩面」的顺序定下来（D8 / D9 / D10），实施不再等确认。
> 改变结论的条件写在每条末尾 —— 到条件出现时再回来改，不靠记忆。

### D8 折线的「平滑度」不做滑杆，固定 Catmull-Rom tension 0.5

**结论**：v1 固定参数，不给用户调；`POLYLINE_TENSION = 0.5` 作为常量放在几何模块里。

**理由**：

1. **参考目标不平滑 ≠ 我们也该不平滑**。逆向目标的线是矢量折线，是因为它整张图都是
   "矢量图元"风格；我们的陆地边缘、海岸线走的都是 Catmull-Rom（`land.ts` 的
   `drawLandPath`）。线不平滑会在同一条河里出现"岸是曲线、河是硬折"的割裂感 ——
   这正是 2.28.0 那轮"旋转不和谐"的同类问题。
2. **滑杆是一个参数管所有线**。真实需求是"官方驿道要直、山径可以抖"，
   那是**按线**的属性，不是全局滑杆能表达的。真要给自由度，应该加样式档
   （`road-trail` 走直线、`river` 走平滑），成本更低且不会让每条线都变成调参对象。
3. 固定参数的代价可控：tension 只影响控制点之间的弧度，改一个常量就能整体调，
   不涉及数据结构与持久化。

**什么时候改**：实机反馈出现"线太软/太硬"且**集中在某一类线**（而不是全局）时，
加样式档字段 `tension?: number`（可选、零写入），仍然不做全局滑杆。

### D9 「图层面板」与「一键成图自动分组」不是同一件事，分组另立需求号

**结论**：本批只交付**类型层**（固定 5 个可写层 + 1 个只读底图行）。
生成器的自动分组（P2-4「生成结果按内容分组」）**另立需求号**（预留 R-MAP-29），
不塞进 B4。

**理由**：

1. 两者回答的问题不同：类型层回答「这是什么、要不要看」；分组回答
   「这次生成出来的这一批东西，我想整体挪/整体删」。后者是**对象管理**，
   需要"组"这个新容器 + 组的增删改 + 组与类型层的 z 关系 + 导出顺序，是独立议题。
2. 混做会让 `layerState` 长出"组"的概念，而组的集合是**用户数据**（可以任意增删），
   与"层集合是常量"（D3）根本冲突 —— 一份文档里存一个常量结构，迟早要迁移。

**什么时候做**：一键成图单次产出常态 > 60 个对象、且出现"想整批删掉这次生成的森林"
这类反馈时启动；届时先定"组是不是也是一种层"。

### D10 子图内**不显示**折线工具（数据模型先预留）

**结论**：B4-1 只落 `MapSubmap.polylines` 数据模型；子图编辑界面的折线工具
**在 R-REG-10「子图内编辑」落地之前不出现**。

**理由（这条推翻了本文初稿的「建议显示」）**：

1. **子图现在根本没有"编辑内容"的能力**。子图的内容全部由「圈定生成」或
   「绑定已有子图」写入，素材 / 地名 / 区块在子图里都改不了（`useMapDocStore`
   的写操作只到 `doc.*`，没有 `doc.regions[].submap.*` 的回写路径；
   子图内编辑是 `region-editing.md` 的 P1 待办 R-REG-10）。
   在这种界面上单独开一个"能画线"的工具，等于子图里唯一能改的东西是折线 ——
   用户会立刻问"为什么这里能画线却不能摆山"。
2. **同一条新链路不该在两个坐标系里同时调**。折线要接的东西（层级权重、命中、
   裁剪、导出）在父图与子图各有一份上下文，先父图跑通，再把子图当"第二个消费方"
   接上，问题归因清楚得多。
3. 预留成本已经付掉了：`MapSubmap.polylines` 与 `submapPolylines()` 读点已在
   B4-1 落地，将来开放入口只是"给工具态加一个作用域"，不涉及数据迁移。

**什么时候开**：R-REG-10（子图内编辑）落地后，一并开放素材/地名/折线的**子图作用域**，
而不是单独开折线。

---

## 附：与两篇既有方案稿的差异（避免两次结论打架）

| 议题 | `nested-submap-road.md` / `elements.md` 原方案 | 本文口径 | 差异原因 |
|------|---------------------------------------------|----------|----------|
| 折线类型 | `MapPolyline` + `kind` 五值 | **采纳** | 一致 |
| 线宽 | 「世界单位线宽」 | **采纳 + 屏幕下限 0.75px** | 只写世界宽度会在缩小后消失 |
| 层级归属 | `submapEnterWeight × elementWeight` | **采纳** | 与素材同一套 |
| 道路自动生成（地点连路） | 有方案（D2） | **不做** | 需要连接图模型；先把「手画」做对 |
| 水系 | 「只留 `kind:"river"` 预留，不自动生成」 | **采纳，且本批就把 `river` 样式做出来** | 预留字段没意义，样式表成本很低 |
| 面要素 | elements 篇 §2 用「散布区」表达植被/雪原 | **不冲突**：散布区仍是素材，本文的 `closed` 折线只解决轮廓线 | — |
