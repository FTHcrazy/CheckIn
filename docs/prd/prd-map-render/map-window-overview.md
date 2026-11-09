# 地图窗口 · 模块总览（唯一入口）

> 状态：**维护中**（每次地图功能落地、闭环或改期后更新本文件）
> 基线：CheckIn **2.44.0**（工作区）｜`src/windows/MapWindow/`｜**全量用例全绿**（2026-11-09 校核，vitest 全量）
> 输入：本模块现存 12 篇 + 已归档 6 个文件（5 篇 md + 1 个 `.ts` 参考实现，逐项见 §4.3）、`CHANGELOG.md` 2.18.0~2.44.0、代码实测
> 职责：**只此一份呈现全貌** —— 整体进度、已完成、未完成、文档去向、仍缺什么。
> 冲突时的优先级：**状态与去向看本文**；观感执行序看
> [`review/map-vs-reference-render-analysis.md` §9](../../review/map-vs-reference-render-analysis.md#9-执行总表交接用)；
> 数据层看 [`spec/map-db-spec.md`](../../spec/map-db-spec.md)。

---

## 0. 三十秒版

1. **渲染与编辑内核已经成型**：与逆向目标（易制地图）的差距从「渲染参数」转到「内容的组织方式」——
   2026-11 之后的所有工作都是在补**对象、素材、图层、折线**，而不是再调海岸颜色。
2. **14 个能力域：13 个已闭环、1 个部分落地**（素材体系 #9）；另有 **2 类能力尚未动工**
   （文字排版增强、搜索/要素绑定），见 §3.1。
3. **最近一批（2.44.0 水系落地）**：用户指令「继续下一批对齐改造」——
   **河流从素材配方改为折线要素**（`domain/water.ts`：离岸 BFS + 地形高度的地势场，
   源头从山地出发逐格下行，**遇海收在海岸线、遇已有河道收在汇流点**，洼地允许 ≤2 步
   平走翻鞍部；断头河必须被湖接住，否则整条丢弃；两端沿邻点二分裁到岸内）；
   **湖泊 = 外环填充 + 2 条等深线环**（低频正弦调制的圆润轮廓，三环共用半径 × 1/0.66/0.38
   天然嵌套；新增 `lake` / `lake-ring` 两档样式与 `PolylineStyle.fill`，只有闭合线吃填充）；
   `river`/`lake` 退出素材区域生长（份额换算成条数），自动水系走独立子流
   `waterSeedOf` 并标 `origin: "generated"`（重生成只换自己那批，手画的线保留）。
   守卫：`water.test.ts`（新增 8 条）、`polylineRender.test.ts`（湖面填充 4 条）、
   `polylineStyle.test.ts`（七档 + 只有湖面带填充）、`generator.test.ts`（河流：无 ⇒ 无水系）。
   上一批（2.43.0 渲染管线按逆向目标逐步复刻）：用户指令「当前的map成图按照
   逆向目标 复刻其渲染过程 逐步落地，缺的补上，有的进行优化，不必兼容老数据」——
   **地貌纹理层**（`terrainTex.ts`：草/沙/雪三张程序化 64² 无缝 tile，生成器随布点
   格网产出气候带栅格 `doc.terrainBands`（哈希接缝抖动零骰子消耗），渲染层新插
   `terrainTexLayer` 单精灵 + 陆地掩膜，按带选择性平铺 —— 参考的
   `createPattern + grid_size:64 + source-atop` 机制完整复刻）；**paint_shadow 三件**
   （描边 3px→1px `#4d3200`、白外影 4px 画填充之下、内阴影 15px `#414040` 画在内侧，
   层级容器三件变五件）；**粉彩色板**（9 格全换高明度粉彩 + 填充 α 0.30→0.55，
   邻接阈值 60→15，分块可读性交给光影三层）；**仙侠体量档**（总闸 0.32→0.18，
   审计上限收至 10%）；**地名限流**（点名配额 12 + 描边 3→2）。
   守卫：`terrainTex.test.ts`（新增）、`regions.test.ts`（样式/色板/相邻色差三条
   换 2.43.0 口径）、`region-land-audit.test.ts`（体量上限收紧）。
   上一批（2.42.0 层级下线 + 布点引擎对齐逆向源值）：用户裁决「先将无级缩放，
   层级，区域生成功能关闭，区域只有国家一级；完全将逆向目标的功能参数以及渲染效果
   对齐，再进行创新优化，无需支持老数据」——**区域层级整体下线**（`REGION_LEVELS` 只留
   国家一级，RegionSchemaPanel 与入口删除，LOD 随之自动退化；引擎仍支持显式多级供测试）；
   **布点引擎对齐 decoded.js 源值**（格网三档 72/54/36 取代实例总数闸、草带弃格 ≈50% 留白、
   地貌格 3 层堆叠、森林丛簇布点：连通先验 + 每丛 3 基础 + 四邻追加）；**国名白色化**
   （`#ffffff` / α 0.6）。守卫：`generator.test.ts`、页面级回归（层级入口不存在 / 12 块 /
   胶囊恒国家 / 素材不淡出）。
   更早是 2.41.0 裁剪重写（区块裁剪换**可切分的半平面裁剪** `clipHalfPlanePieces`、
   飞地 `MapRegion.pieces`、大陆形状 12 种 + 底色 6 档）、2.40.0 区块三级化 +
   一键成图面板对齐、2.37.0 区块线贴岸。
   ⚠️ 2.37.0 的「每块陆地恒 1 个大陆区块」与 2.38.0 的「α 0.30 / 3px / `#73562d`」
   **均已随后续取证作废**（分别见 CHANGELOG 2.40.0 / 2.43.0）。
4. **文档已收口**：闭环的 6 个文件已进 `docs/archive/prd-map/`，未闭环的 12 篇留在
   `docs/prd/prd-map-render/`（含本批新写的 3 篇过程稿 + 1 篇批次排期；闭环后整组归档），散落在 `docs/` 根目录的三份旧稿已全部归档（§4）。

---

## 1. 能力地图（现状一览）

状态标记：**✅ 闭环**（有守卫、可回归）／**◐ 部分**（主体可用，明确缺口）／**✗ 未开工**
"版本"列是该能力的**收口版本**，不是首次提交版本。

| # | 能力域 | 状态 | 版本 | 代码落点（`MapEditorPage/` 内） | 需求/设计文档 |
|---|--------|------|------|------------------------------|--------------|
| 1 | **窗口与主题**：独立 `map` 窗口、入口登记（full 8 个入口含 map、novel 7 个含 map、**lite 不含**）、主题变量复用 | ✅ | 2.18.0 前 | `MapWindow/{App,main}.tsx`、`index.scss`、`electron/edition.ts` | 无专文（受 `AGENTS.md` §6 与主题 token 约束，**不算缺口**） |
| 2 | **数据持久化 `map.db`**：独立库、`doc_json` 整存、`rev` 乐观锁、800ms 防抖保存、关窗 flush、回收站 | ✅ | 2.20.0 | `electron/map-db.ts`、`map-handlers.ts`、`persistence/` | [`spec/map-db-spec.md`](../../spec/map-db-spec.md) |
| 3 | **多图库与作品绑定**：缩略图列表、改名、回收站、绑定/解绑作品 | ✅ | 2.20.0 | `components/MapLibraryModal/`、`store/useMapFileStore.ts` | 同上（§8 记录了「首屏不做列表态」两处形态偏差） |
| 4 | **画布内核**：坐标单一事实源、无级缩放（0.1~8；⚠️ 2.42.0 起 LOD 交叉淡化随层级下线自动退化为恒 1，缩放本身保留）、视口剔除、滚轮步长自适应 | ✅ | 2.17.x | `coords.ts`、`lod.ts`、`cull.ts` | `archive/prd-map/map-render-alignment-architecture.md` §1.2/§4 |
| 5 | **陆地与海岸质感**：四层 fbm 有机轮廓、烘焙三件套（浅滩/等深线/内阴影）、海面暗角、程序纸纹、纹理平铺+羽化、海岸内缩 | ✅ | 2.18.0 / 2.27.0 / 2.28.0 | `land.ts`、`coastBake.ts`、`paperGrain.ts`、`style.ts` | [`review/map-vs-reference-render-analysis.md`](../../review/map-vs-reference-render-analysis.md) §6/§9 |
| 6 | **区块生成与层级**：陆地内切分（非叠放）；⚠️ 2.42.0 起**层级下线，只留国家一级**（引擎 `generateHierarchy` 仍支持显式 `levelCounts` 供测试与嵌套子图） | ✅ | 2.18.0 / 2.42.0 | `regions.ts`、`domain/generator.ts` | `archive/prd-map/map-render-alignment-prd.md` §6.1~6.2 |
| 7 | **区域编辑**：层级定义 `regionSchema`（⚠️ 2.42.0 起单级、配置面板已删除）、手画多边形、子区域合并、叶子/容器双态高亮、面包屑 | ✅（P0） | 2.19.0 / 2.42.0 | `regionEdit.ts`、`RegionPanel`、`useMapDocStore` | [`region-editing.md`](region-editing.md)；架构已归档 |
| 8 | **嵌套子图**：`MapSubmap` 递归数据模型、递归场景图 + 裁剪、路径 A（贴合）/ A′（跨图拷贝绑定）/ B（圈定生成）、子图渐入与内部 LOD、子图海岸/素材/地名、边界羽化带 | ✅（子图内编辑除外，归 R-REG-10） | 2.18.0 / 2.32.0 | `types.ts`、`submapRender.ts`、`submapBind.ts`、`SubmapPickerModal/`、`MapCanvas/index.tsx` | [`nested-submap-main.md`](nested-submap-main.md) |
| 9 | **素材体系**：52 张 AI 素材 / 9 展示分类 / 20 地形枚举 / 地貌带（`core` + 雪·草原·荒漠三带）、选材引擎（三级回退）、属性面板、地名联动 | ◐ | 2.22.0 / 2.25.0~2.26.0 | `sprites.ts`、`domain/{terrain,terrain-assets,zones}.ts`、`SpritePanel`、`ElementPanel` | [`map-asset-system-architecture.md`](map-asset-system-architecture.md) |
| 10 | **一键成图生成器**：热门地图配方、丰度三档（⚠️ 2.42.0 起语义 = **格网边长** 72/54/36，对齐参考 `grid_size`）、成图/骨架、五档重掷、结果摘要、底图选择、配额表 + 格网/丛簇布点（2.42.0 对齐逆向源值：弃格、3 层、森林丛簇）；**面板对齐参考目标**（要素大小 / 生成内容 / 山体 / 河流，2.40.0） | ✅ | 2.25.0（面板 2.40.0 / 引擎 2.42.0） | `domain/{generator,mapPresets}.ts`、`MapGeneratorModal` | [`review/map-vs-reference-interaction-review.md`](../../review/map-vs-reference-interaction-review.md) §5.3 |
| 11 | **对象编辑**：选中态、拖拽/缩放/旋转/透明度/色相、层级与置顶置底、剪贴板（C/X/V/D）、方向键与 WASD 微移、撤销重做 | ✅ | 2.21.0 | `hooks/useMapEditor.ts`、`store/useMapDocStore.ts`、`ElementPanel` | 同上（B1） |
| 12 | **文字标注**：屏幕恒定字号、层级权重联动、三档字号、宋体字族、白描边 | ✅（基础） | 2.18.0 | `labelSync.ts` | `archive/prd-map/map-render-alignment-prd.md` §6.3 |
| 13 | **导出**：PNG 分块导出（`tilePlan` → `exportMapPng` → `savePng`），可选尺寸 | ✅ | 2.18.0 | `export.ts` | 同上 §6.6（**规格不足**，见 §5.1 第 2 条） |
| 14 | **图层面板与折线要素**：6 行结构（底图只读 + 区块/折线/素材/子图/地名）、显隐、锁定、计数、折叠；折线（河流/道路/山脊/边界/**湖面**）绘制、平滑渲染、节点编辑、**7 档样式**、属性面板、河流变宽、山脊影线笔刷、闭合折线（含**湖面填充 + 等深线**）、复制粘贴/微移；`layerState` / `polylines` 零写入 + 撤销；**一键成图自动水系**（2.44.0：河流折线 + 湖泊，`origin: "generated"` 只换自己那批） | ✅ | 2.29.0 / 2.30.0 / 2.31.0 / 2.44.0 | `layerState.ts`、`LayerPanel/`、`polylineGeometry.ts`、`polylineStyle.ts`、`polylineRender.ts`、`PolylinePanel/`、`domain/water.ts`、`useMapDocStore` | [`map-b4-layers-polyline-prd.md`](map-b4-layers-polyline-prd.md)（D1~D8 / §3 / §4 / §6.1~6.3） |

> **怎么验证"能不能用"**：`MapWindow` 的用例数是唯一自动化回归基线（当前数字见文首）；
> 观感与性能目前靠人眼与真机，没有截图比对（见 §5.3）。

---

## 2. 已完成（按版本时间线）

| 版本 | 交付内容 | 当时的取舍 / 踩过的坑 |
|------|----------|----------------------|
| 2.17.x | 区块尺度与素材尺寸纯函数层、缩放上限「让最小郡铺满画布」反推、素材世界尺寸逐级减半、滚轮步长随 `deltaY` | 为 2.18.0 的海岸与子图打地基 |
| **2.18.0** | 陆地海岸四层重做（海岬/深湾/域扭曲）、嵌套子图 Phase 2 + 2.4、子图海岸与内部 LOD、区块选中三笔与 `RegionPanel`、工具栏重组 | 子图整体偏移与「权重冻在构建那一刻」都是**静默缺陷**（不报错、只在特定操作下错位）；已补回归用例 |
| **2.19.0** | 区域编辑 P0 五条（`regionSchema` / 生成不连带分区 / 手画 / 合并 / 叶子高亮） | 「选中」与「高亮」解耦，判据用**叶子**而非最深 `level`；合并是一次快照、polygon 不重贴合 |
| **2.20.0** | `map.db` 独立库、IPC 全通道、自动保存与关窗 flush、地图库弹窗（缩略图/改名/回收站/绑定） | 首屏仍是编辑器（列表做进弹窗）；缩略图改为「开库前抓一张」 |
| **2.21.0** | 素材属性面板（四件套 + 层级 + 置顶置底）、剪贴板与微移、工具栏图标化 | `opacity` / `tint` 设为可选字段，老图读点兜底免迁移 |
| **2.22.0** | 素材 6 → 45（6 分类，AI 生成 + MANIFEST 记录）、点要素落位自带地名 | 不用逆向目标 PNG（红线）；港渡类少 1 个变体，观感已够 |
| **2.25.0** | 地形语义层（20 枚举 + 回退链）、`pickTerrainSprites` 选材引擎、3 个热门地图预设、**一键成图（B3）** | 默认档＝成图；seed 不进主工具栏；布点允许层叠（手绘观感） |
| **2.26.0** | 地貌带 `zones` 三轴分离、网格 + 区域生长 + 黄金角丛簇布点、脚底 y 排序 | 弃用 `ZONE_MIN_DIST` / `zoneR` 的「撒点」范式 |
| **2.27.0** | 素材配额表、多片地形（≤4 块）、`TERRAIN_SCALE` 体量归一、浅滩方向/等深线/内阴影、海面暗角、程序纸纹、区块填充 0.32 → 0.10 | 素材「过大、像小岛」的根因是配比与体量，不是画风；纸纹必须模块级单例、**永不 destroy** |
| **2.28.0** | 批次 A：海岸内缩 14 + 素材四角同判；z 分层基线（`TERRAIN_LAYER`）。批次 B：陆地纹理改 `TilingSprite` 平铺 + 5 层内缩羽化 + 实机反馈修复（等深线越界、单侧缺失、旋转不和谐、地图库列表不刷新）。**收尾**：`MapWindow` 补挂 antd `<App>`容器 | ① **Graphics 遮罩挂 `BlurFilter` 在 pixi 8.22 会让遮罩整块失效**（`isSimple=false` → 遮罩几何进临时纹理 → 主目标 stencil 恒空），改多层内缩降 alpha；烘焙节点数 8 → 17。② **「删除不刷新」第一次修错了方向**（以为是 `onClose` 抢跑）：真因是窗口根从未挂 antd `<App>`，`AntApp.useApp()` 拿到默认空对象，`message.success(...)` 直接 `TypeError` → `onConfirm` 的 promise reject → 二次确认框不关 + `load()` 不执行 |
| **2.29.0** | **B4-1 图层面板**：左栏底部 6 行（底图只读 + 区块/折线/素材/子图/地名）、眼/锁/计数/折叠；`layerState` 零写入 + 撤销；`MapPolyline` 数据模型与读点预留 | ① **三层的显隐用容器 `visible`、区块仍用 `alpha`**：区块要在 0.16 填充下继续透出陆地材质，改成 `visible` 会顺带改掉既有观感。② **锁定要贯通五处**（命中、画布起拖、双击改地名、删除、清空画布），只改页面那个调用点会漏掉画布的拖拽入口。③ **踩了一个 stale closure**：`pickElement` 的 `useCallback` 依赖只写了 `doc.elements`，而锁定只改 `doc.layerState` → 回调闭着锁定前的文档 → "锁了还能点中"；用例红在 `expected {id:'el_x'} to be null` |
| **2.30.0** | **B4-2 折线**：`polylineLayer` 中间插层（8→9，压区块之上、垫素材之下）、Catmull-Rom 平滑（与陆地同款）、5 档样式（官道双层 / 小径虚线 / 河流 / 山脊 / 边界渐隐）、线宽世界单位 + 屏幕下限 0.75px、绘制态（双击与 Enter 收尾）、拖节点 / 双击插删点、`PolylinePanel` 属性面板 | ① **世界单位线宽必须有屏幕下限**：缩到洲一级一条 2.4 单位的小径只剩 0.8px，没有下限就是"线画上了但看不见"。② **几何纯函数层先落**（`polylineGeometry` / `polylineStyle`），渲染与命中测试共用同一条采样路径 —— 插点位置与视觉线重合不是巧合，是"同一份数据"的结果。③ **双击插点取线上最近点而不是鼠标位置**：否则新点会把线拽出一个小尖角。④ 撤销账目三分：落线/插点/删点各一步、拖节点由 `commitDragStart` 只记一次、滑杆用 `coalesceKey` 压步 |
| **2.31.0** | **B4-3 折线打磨（B4 收口）**：河流变宽（`taper` 按弧长插值 + 带状填充 `ribbonPolygon`）、`ridge` 影线笔刷（`hatch` 确定性长短交替）、闭合折线（点回起点 / 面板开关 / <3 点退化守卫四处同款）、折线复制粘贴 / 微移（剪贴板扩为素材∥折线联合） | ① **变宽必须用填充不能用分段描边**：河流带 0.92 透明度，分段描边的圆头接缝会叠画出一串深色斑点；一次 `beginFill` 填多边形透明度处处均匀。② **能力探测先行**：`StrokeTarget` 的 `beginFill` 是可选位，目标不支持时必须落回等宽描边 —— 第一版直接 `return`，线整个消失（测试抓到）。③ **影线要确定性**：不掷随机数，重绘之间毛边不跳动。④ 闭环 <3 点按开链，这条守卫在渲染/命中/高亮/双击**四处**都要有，漏一处就是"看着开链却点不中/看着闭环却画开链" |
| **2.32.0** | **子图收口（A′ 全通 + 羽化）**：跨图选择器 `SubmapPickerModal`（排除当前图与回收站图、摘要卡片、拷贝语义提示）、`submapFromDoc` 拷贝构造（structuredClone + 全树 id 重映射，bounds = 1024² 标准纸）、边界羽化带（`erase` 混合 + `AlphaFilter` 隔离 + 内缩描边带，只挂有海面的子图） | ① **`erase` 不隔离会连父图一起擦穿**：它是基础混合模式（直接设 GL state，不走 advanced 批处理的纹理隔离），必须给 `content` 挂 `AlphaFilter` 让子图先渲进独立纹理 —— 这是 destination-out 只擦自己的唯一办法。② **拷贝语义一次答完绑定的三个开放问题**：无同步通道、源图被删零影响、反向跳转不适用。③ **id 全树重映射现在无害也要做**：「子图内编辑」落地后选中/撤销都按 id 找对象，现在花一个 Map 的成本消灭整类撞 id 问题 |
| **2.33.0** | **海岸观感修复**：等深线逐环外扩（新纯函数 `isobathRingPlan`，每座岛按本环半幅反解 k，波浪线 16/40/70 世界单位均匀离岸）；区块越岸修复（新 `makeRadialClamp`，显示多边形逐点径向投影回岸线，实测最深越岸 26 单位 → 0）；陆地轮廓 v4 调参（海岸特征 3→4、幅度/谐波/扭曲/碎齿能量整体上调一档、`base` 0.82→0.86），占纸下限守卫 15%→12% | ① **「一侧有波浪线一侧没有」的真根因是"绕全图包围盒中心统一放大"**：离岸间隙 = (k−1)·\|顶点−中心\|，多岛时朝向中心一侧被压到 0、线贴岸被填色盖住 —— 上一轮改用实测包围盒只救了单岛。**凡是"离岸若干单位"的装饰都必须逐环外扩**。② 星形环（r(θ) 单值）的两条几何性质各修一个 bug：绕本环中心放大 ⇒ 等深线严格落在陆外；射线与边界恰交一次 ⇒ 径向钳制是精确投影。**半平面裁剪只对凸裁剪框成立**，星形容器里"两点之间的弧"必须逐点钳，`settleInside` 式的顶点回拉覆盖不了。③ **调参方向教训**：base 越大面积反而越小（r_max 涨得比 E[r²] 快，fitExtents 按半幅反解把整岛压小）——想补面积别动 base，砍紧凑度的源头（特征数量/幅度）才是旋钮；砍了又伤层次感，最终守卫让步（15%→12%） |
| **2.34.0** | **海岸形状改 SDF 侵蚀管线**（逆向目标 `erodeGeoJSON` 参数 1:1，`land.ts`）：母形栅格化 → Felzenszwalb SDF → 域扭曲（`warpAmp 115 / noiseScale 0.012 / 5 层`）→ 距离衰减细节（`detAmp 26 / detRadius 28`，边缘毛糙内陆平整）→ marching squares → Chaikin ×2 → DP 抽稀（带自交校验）；排布解耦（侵蚀逐岛局部栅格 + `fitRingToSpan` 贴回格子半幅，`fitExtents` 移除）；`insetLand` 改真偏移（SDF iso=−inset 等值线 + 越界顶点径向拉回） | ① **"太圆润"四轮调参都无效后要换结构**：极坐标 r(θ) 的噪声全域等强，能量调多大都是"毛糙的椭圆"；层次感的定义是"边缘毛糙、内陆平整"，只有距离衰减噪声给得出。② **抽稀会切穿细颈**：DP 把窄半岛根部两岸直接接通成自交 —— 每次抽稀结果必须过自交校验。③ **容差修正必须单调**：自交⇒收紧、超护栏⇒加压，两个方向来回切会**震荡死循环**（同一个环两种修正互相抵消），经历过自交后护栏让位于正确性。④ **insetLand 的"中心等比收缩 ⊆ 原环"只对星形环成立**：SDF 海岸凹段更深，等比缩放顶点跨湾口越出对岸（实测 seed=1），换 iso 等值线才是真偏移 |
| **2.35.0** | **观感批次 C · 镜像翻转破重复（P1-4）**：`MapElement.flipX`（可选 + 读点兜底 `elementFlipXOf`，旧档回落 false）、`flippable` 登记表（缺省可翻，7 张有朝向人造物不可翻）、一键成图按素材子流 50% 随机翻面 + **确定性去重**（同 spriteId 的 flip/量化scale/量化rotation 组合全图至多一次，撞车翻反 flip 或重掷角度）、渲染 `scale.x = |scale.x| × ±1`（主图素材层 + 子图素材同款） | ① **锚点 (0.5,1) 水平居中 ⇒ 翻转不位移**：设计预案里"按 baseWidth 反算锚点 / 命中反算 x"是空操作，命中区与选中框天然一致。② **pixi 8 的 `_setWidth` 保留 scale.x 符号**：翻面符号必须每次同步显式重设，不能增量取反（否则撤销后翻不回去）。③ **`map.db` 无需表结构迁移**：`doc_json` 整存，可选字段即向后兼容。④ **验收是结构性不是统计性**：QA 60 seeds 扫描证明翻转只砍半期望（稀池档量化抖动自身碰撞），确定性去重补上后 20 seeds × 全预设 × dense 恒 0 |
| **2.36.0** | **观感批次 D 收口**：序 5 区块按层级**静态衰减**（新 `REGION_LEVEL_FILL_SCALE = [1, 0.75, 0.58, 0.45]`，填充/边界共用同一张表，主图 + 子图四处落点全走 `regionFillAlphaOf` / `regionBorderAlphaOf`）；序 6 **手工落位 AABB 避让**（`isCenterCovered`：新素材中心落进已有素材命中盒 +30 呼吸边 → 拒绝落位并提示，待放态保持） | ① **静态系数表与 `levelAlphas` 正交**：那是缩放驱动的 LOD 权重（已写进容器 alpha），乘上去双重衰减 —— 设计文档原方案被勘误否决，实现走"新常量表"路线。② **拦截只作用于新建落位**：`moveElementBy` 不设防 —— 拦拖拽 = 压住的素材永远无法拖开解围；守卫用例同时钉"中心被压拦 / 移动不拦"。③ 只开 1 级时系数恒 1，观感与旧版一致；越界 level 朝"不衰减"兜底。至此执行序 1~6 全部闭环，观感修补三件完成 |

| **2.44.0** | **水系落地**：新模块 `domain/water.ts`（纯函数）—— 地势场 = 离岸 BFS + 地形高度 + 确定性哈希噪声；河源按地势 + 山族加权挑选（源距 = 格网短边 30%），逐格下行，**遇海收在海岸线、遇已有河收在汇流点**，洼地允许 ≤2 步平走翻鞍部；**断头河必须有湖接住，否则整条丢弃**；两端沿邻点二分裁到岸内（沿海格中心可能在海上）。湖泊 = 外环填充 + 2 条等深线环（低频正弦调制轮廓；三环共用半径 × 1/0.66/0.38 天然嵌套；出岸则收缩重试）。`river`/`lake` 退出素材区域生长，份额换算成条数；自动水系走独立子流 `waterSeedOf` + `origin: "generated"`，重生成只换自己那批 | ① **"逐顶点独立抖动"平滑完仍是齿轮**：18 边形的半径没有相关性，曲线只能在每个顶点鼓一下 —— 换两条低频正弦，半径沿圆周连续变化才圆润。② **只靠二分裁岸不够**：`CELL_PROBE` 会连着认领 2~3 个中心在海上的沿海格，端点两端都在岸外时二分找不到岸 —— 先剃掉连续岸外点再裁（实测东北角一条河浮在海面）。③ **河不能悬空收尾**：断头河要么被湖接住（湖心第二优先级就是断头河终点），要么丢弃；"半途而废的河"比没有河更像 bug。④ **湖面填充只对闭合线开放**：开链填充会涂出一块与走向无关的色块。⑤ 折线渲染层已经有 Catmull-Rom，生成侧只需给足点（格心抖动 + 法线中点），别在数据层再平滑一次 |
| **2.43.0** | **渲染管线按逆向目标逐步复刻**：地貌纹理层（`terrainTex.ts` 草/沙/雪程序化 64² tile + `doc.terrainBands` 气候带栅格（哈希抖动零骰子）+ `terrainTexLayer` 单精灵陆地掩膜插层）；paint_shadow 三件（描边 1px `#4d3200`、白外影画填充下、内阴影 15px `#414040` 画内侧）；粉彩色板 9 格 + 填充 α 0.55（邻接阈值 60→15）；体量总闸 0.32→0.18（仙侠档，审计上限 10% 钉住）；点名配额 12 + 标注描边 2px | ① **色板与填充是一对**：粉彩配 α0.30 会把色差压进纸色（合成差只剩 ~9），邻接校正无差可校 —— 换色板必须同时提填充。② **白外影画在填充之下就不用做共享边去重**：外半晕铺白、内半晕被两侧半透明填充罩住，接缝天然均匀。③ **内阴影语义 = 逐块各画各的**（相邻块接缝两侧各 15px），分块感来自光影而不是粗线，与参考逐块 `inner_shadow` 同构。④ **纹理带接缝抖动用确定性哈希而不是 rng**：零骰子消耗 ⇒ 同 seed 布点序列逐字节不变（跨版本对照可证）。⑤ 参考的异步 png 纹理加载是 Web 架构限制不是特性，2D 画布一次平铺成单张纹理即可 |
| **2.42.0** | **层级下线 + 布点引擎对齐逆向源值**（用户裁决：区域只留国家一级、完全对齐逆向目标、无需支持老数据）：`REGION_LEVELS` 只留国家一级（RegionSchemaPanel 与入口删除、LOD 自动退化、越界画区落点前拦截）；生成器 `RICHNESS_TOTALS` → `GRID_SIZES`（72/54/36 格网边长）、草带弃格 ≈50% 留白、地貌格 3 层堆叠、森林丛簇布点（连通先验 + 3 基础 + 四邻追加）；国名白色化 `#ffffff` / α 0.6 | ① **体量归一不照抄参考的 `w`**（.11~.5 是其素材池专属归一）：本项目走 `TERRAIN_SCALE`，对齐的是参数结构，双份归一会把草带丘陵放大 4.5 倍。② **随机数调用序全变**：老 seed 对不上老图（裁决内）。③ 12 块国家的单级退化让整条 LOD 链自动恒 1，`MapCanvas` 2233 行一行没改。④ 页面级回归的精确读数（208%/37%/命中 1px）被实测抖动教育过：多档缩放累积浮点误差钉死会假红，改区间断言 |

> 累计取舍与勘误的价值不在"当时怎么想"，而在**别再犯**：完整负向约束见 §6，
> 六条口径勘误见 render-analysis §9.5。
---

## 3. 未完成（按可执行性分类）

### 3.1 尚未动工的能力（2 类，无代码）

| 能力 | 编号 | 优先级 | 现状证据 | 文档 |
|------|------|--------|----------|------|
| **文字排版增强**（竖排 / 沿线 / 角度 / 字距 / 阴影） | R-MAP-27 | P2 | `labelSync.ts` 只有字号档 + 字族 + 白描边 | review §7 |
| **地图内搜索与定位** / **地点绑定小说要素** | v1 R-MAP-15 / 12 | P2 | 无入口、无数据字段 | 仅存于已归档的 v1 PRD（**无主**，§3.4） |

> 「折线与面要素」已随 2.30.0 落地折线部分（R-MAP-26）；**填充面**按 B4 PRD §7 明确不做，
> 不再列为待办（解锁条件见该表）。

### 3.2 已开工但未收口（有代码、有明确缺口）

| 事项 | 编号 | 优先级 | 缺口的具体形态 | 来源 |
|------|------|--------|----------------|------|
| **子图静态层缓存** | nested-submap-main | P2 | 只有海岸烘焙按指纹短路，整棵子图静态层未缓存 | 同上 |
| **一键成图的河流** | R-MAP-21 已知取舍② | P1 | 折线能力已就绪（2.30.0，含变宽），生成器侧的"沿地势画河"仍未设计 | review §9 的 B3 说明 |
| **大陆底色的参考确切色值** | R-MAP-21 面板对齐（2.41.0 部分） | P2 | 6 档底色（羊皮纸/暖沙/黄褐/灰绿/青灰/粉灰）是按参考成图观感给的近似；参考实现底色走贴图/滤镜链，确切色值未能从 `decoded.js` 核出。拿到确切值只需改 `LAND_BASE_COLORS` 一张表 | CHANGELOG 2.41.0 |
| **素材导入（S2）/ 热门地图扩容（S3）/ AI 接口（S4）** | R-MAP-22 | P1/P2 | 设计已写（三通道 + 标注弹层 +「我的素材」分组），实现为零 | [`map-asset-system-architecture.md`](map-asset-system-architecture.md) §六~§八 |
| **区域编辑 P1/P2** | R-REG-06~14 | P1/P2 | 顶点微调 / 删单块 / 改名改色 / 裁剪 / 子图内编辑；P2 还有合并接管子图、边界重贴合、层级数上限放宽 | [`region-editing.md`](region-editing.md) §3.2/§3.3 |
| ~~**观感修补三件**~~（P1-4 / P2-2 / P2-3） | ~~P1-4 / P2-2 / P2-3~~ | P1/P2 | **三条全部完成**：镜像翻转（2.35.0，含确定性去重）、区块层级静态衰减（2.36.0，勘误口径）、手工落位 AABB 避让（2.36.0，移动不设防） | render-analysis §9.1 |

### 3.3 阻塞（缺外部输入，代码侧推不动）

| 事项 | 阻塞点 | 现状数字 |
|------|--------|----------|
| **素材池扩充（P1-5）** | 需美术出图 | 沼泽档 7 种、雪原档 7 种，均低于验收线 ≥12；目标「同屏同一素材 ≤2 次」达不到（口径：沼泽档 = `terrains` 的 `swamp` + `jungle`；雪原档 = `zones` 含 `snow`；见 render-analysis §9.2 · P1-5） |
| **自动生成分组 folder（P2-4）** | 原阻塞点「依赖图层面板」已于 2.29.0 解除；**产品已裁定不立项**（2026-11-06，见 [`R-MAP-DOC-legacy-disposition-scope.md`](R-MAP-DOC-legacy-disposition-scope.md) §B1；重新开案条件：素材 ≥120 张，或用户明确反馈「分类不够用」并能举出具体场景） | 一键成图产物与手绘元素仍混在同一层，但已可整层显隐（"把素材层关掉看地形"已能做到） |

### 3.4 无主遗留（v1 PRD 未实现，且没有任何现行文档承接）

> **已于 2026-11-06 全部处置完毕**：**2 条不立、3 条立号**（均 P2 不排期）。逐条依据、
> 解锁条件与归属文档见 [`R-MAP-DOC-legacy-disposition-scope.md`](R-MAP-DOC-legacy-disposition-scope.md) §A。
> 归档后的 v1 PRD 见 [`archive/prd-map/map-v1-prd.md`](../../archive/prd-map/map-v1-prd.md)。

| v1 编号 | 需求 | 现状 | 处置 |
|---------|------|------|------|
| R-MAP-06 | **地点连线**（可标距离/关系） | 无。若只想要「两点之间的路」，可并入 R-MAP-26 折线；若要「关系标注」，是独立需求 | **不立（B4 折线覆盖）** |
| R-MAP-11 | **素材库面板**：分类浏览 ✅、搜索 ✗、收藏 ✗ | `SpritePanel` 只有分类 | **不立（挂 R-MAP-22·S2）** |
| R-MAP-12 | **地点绑定小说要素**（改地名双向同步） | 完全无承接。现在只有「整张图绑定作品」（`work_id`） | **立 R-MAP-30·P2** |
| R-MAP-13 | **导出为设定文档 / 插入灵感速记** | 完全无承接 | **立 R-MAP-31·P2** |
| R-MAP-15 | **地图内搜索与定位** | 无入口 | **立 R-MAP-32·P2** |

### 3.5 推荐开工顺序（本文的判断，非排期承诺）

1. ~~B4-2 折线~~ → **已完成（2.30.0）**：`polylineLayer` 插在 `regionLayer` 与 `elementLayer` 之间、
   Catmull-Rom 平滑、5 档样式、绘制/拖点/插点/删点。口径落地记录见
   [`map-b4-layers-polyline-prd.md`](map-b4-layers-polyline-prd.md) §6.2。
2. ~~B4-3 折线打磨~~ → **已完成（2.31.0）**：河流变宽（带状填充）、`ridge` 影线笔刷、
   闭合折线、折线复制粘贴/微移。落地记录见同文档 §6.3。
3. ~~子图收口~~ → **已完成（2.32.0）**：A′ 跨图选择器（拷贝绑定，排除当前图与回收站图）+
   边界羽化带（`erase` 混合 + AlphaFilter 隔离，纯几何内缩描边带）。落地记录见
   [`nested-submap-main.md`](nested-submap-main.md) §4.1.2 与
   [`nested-submap-boundary.md`](nested-submap-boundary.md) §2.2。
   下一批顺位是 R-REG-10「子图内编辑」（D10 的解锁前提）。
4. ~~**观感批次 C/D**~~ → **全部完成**：镜像翻转（序 4，2.35.0，含确定性去重）→
   层级静态衰减（序 5，2.36.0，按勘误口径走静态系数表）→ AABB 避让（序 6，2.36.0，
   拦截只作用于新建落位）。执行序 1~6 闭环，观感修补三件收口。
5. **无主遗留的处置会**：把 §3.4 五条逐条判「立/不立」，避免继续悬空。

---

## 4. 文档清单与归档状态

### 4.1 现存（`docs/prd/prd-map-render/`）

| 文档 | 类型 | 状态 | 是否仍有效 |
|------|------|------|-----------|
| **map-window-overview.md**（本文） | 模块总览 | 维护中 | ✅ 唯一入口 |
| [map-b4-layers-polyline-prd.md](map-b4-layers-polyline-prd.md) | 需求 + 设计决策（B4） | **B4-1 / B4-2 / B4-3 已全部实施**（2.29.0 / 2.30.0 / 2.31.0，B4 闭环） | ✅ 有效；**图层面板与折线的执行口径以它为准**，两篇 `nested-submap-*` 降为素材/算法依据 |
| [nested-submap-main.md](nested-submap-main.md) | 主方案 | 已实施（Phase 2/2.4 已落地） | ✅ 有效；A′ 已于 2.32.0 闭环（拷贝绑定）；**静态层缓存未做**（P2） |
| [nested-submap-boundary.md](nested-submap-boundary.md) | 方案专篇 | 待评审 | ✅ 有效；羽化带已于 2.32.0 落地（`erase` 混合 + `AlphaFilter` 隔离）；**缺验收判据**（见 §5.1-6） |
| [nested-submap-road.md](nested-submap-road.md) | 方案专篇 | 待评审（未实现） | ◐ 折线部分**已并入 B4 PRD**，本文只留道路算法依据 |
| [nested-submap-elements.md](nested-submap-elements.md) | 方案专篇 | 待评审（未实现） | ◐ 折线部分已并入 B4 PRD；渲染铁律与「水系不自动生成」结论继续引用 |
| [region-editing.md](region-editing.md) | 增量需求 | P0 已实现 / P1 待排 | ✅ 有效 |
| [map-asset-system-architecture.md](map-asset-system-architecture.md) | 架构 | S1 落地 / S2~S4 预留 | ✅ 有效；素材数量口径已在本次整理中订正为 **52** |
| [R-MAP-DOC-batch-plan.md](R-MAP-DOC-batch-plan.md) | 批次排期（batch-plan） | **定稿** | ✅ 有效；本批 14 个执行单元的交付清单、依赖图、三批完成判定 |
| [R-MAP-DOC-line-autogen-analysis.md](R-MAP-DOC-line-autogen-analysis.md) | 口径裁定（analysis） | **定稿** | ✅ 有效；四类线「自动 vs 手画」唯一裁定稿，road / elements 两篇冲突时以它为准 |
| [R-MAP-DOC-submap-boundary-acceptance.md](R-MAP-DOC-submap-boundary-acceptance.md) | 验收判据（acceptance） | **定稿** | ✅ 有效；边界羽化四组判据 + 递归深度用例清单（§4） |
| [R-MAP-DOC-legacy-disposition-scope.md](R-MAP-DOC-legacy-disposition-scope.md) | 遗留处置（scope） | **定稿** | ✅ 有效；五条无主 + R-MAP-29 + S2 排期 + A′ 三问的处置结论（§A~§C） |

> **现存 12 篇**（上表 12 行 = `ls docs/prd/prd-map-render/*.md | wc -l` 实测）；闭环后整组移入 `docs/archive/prd-map/`。

### 4.2 活规范与审查（`docs/spec/`、`docs/review/`）

| 文档 | 类型 | 状态 | 说明 |
|------|------|------|------|
| [spec/map-db-spec.md](../../spec/map-db-spec.md) | 活规范 | 已实施（B0 / 2.20.0） | 改 `map.db` 前必读；§9 四条已收口 |
| [review/map-vs-reference-interaction-review.md](../../review/map-vs-reference-interaction-review.md) | 审查 | 含未闭环待办 | B0~B3 已闭环；B4 与 R-MAP-27 开放 |
| [review/map-vs-reference-render-analysis.md](../../review/map-vs-reference-render-analysis.md) | 逆向分析 | 执行中 | **观感的状态与执行序唯一事实源＝§9**；已完成 18 项 / 待办 0 条 / 并行轨阻塞 2 条（P1-5 / P2-4，**不计入待办**） |

### 4.3 已归档（`docs/archive/prd-map/`，2026-11-05 整理）

| 文档 | 原位置 | 归档理由 |
|------|--------|----------|
| [map-v1-prd.md](../../archive/prd-map/map-v1-prd.md) | `novel-map-prd.md`（docs 根） | v1 路线（底图+标记+连线）被 `map2` 实现取代；未实现项已提升为 §3.4 |
| [map-v1-architecture-research.md](../../archive/prd-map/map-v1-architecture-research.md) | `novel-map-architecture-research.md`（docs 根） | 选型已全部落地；SVG 双层方案未采纳 |
| [map-coord-system-reference.ts](../../archive/prd-map/map-coord-system-reference.ts) | `novel-map-coord-system.ts`（docs 根） | 参考实现，现行由 `coords.ts` 取代 |
| [map-render-alignment-prd.md](../../archive/prd-map/map-render-alignment-prd.md) | `prd-map-render/prd-map-render-alignment.md` | R-MAP-16~20 已闭环（2.18.0） |
| [map-render-alignment-architecture.md](../../archive/prd-map/map-render-alignment-architecture.md) | `prd-map-render/architecture.md` | 同上，工程方案已执行完 |
| [map-region-editing-architecture.md](../../archive/prd-map/map-region-editing-architecture.md) | `prd-map-render/region-editing-architecture.md` | T1~T5 已落地（2.19.0） |

### 4.4 已彻底删除（勿再引用）

| 文档 | 原因 |
|------|------|
| `character-pack-prd.md`（docs 根） | v1 PRD 引用的「面板设计范式」，内容已并入 `AGENTS.md` §6 |
| `novel-editor-prd.md`（docs 根） | v1 PRD 明确声明其地图章节不再作为依据 |

> 归档不改正文，只在顶部加「已归档 · 闭环版本 · 现行为准的去处」。
> 归档文档内指向旧路径的行文按历史记录理解（与 `CHANGELOG.md` 同规则）。

---

## 5. 仍待补充或缺失

### 5.1 文档层面（7 条）

1. **没有「交互与快捷键」活规范**：放置态/选中态、右键、快捷键（`Ctrl+C/X/V/D`、方向键/WASD、
   `Esc`）散落在 review §2.3 与代码里，新人无法从文档确认"按这个键应该发生什么"。
   → **已补**：[`spec/map-interaction-spec.md`](../../spec/map-interaction-spec.md)（七类口径，每行带守卫落点；无守卫的登记在 §8）。
2. **没有「导出规格」文档**：现只有 PNG 分块导出，DPR、目标尺寸、透明底、是否支持 SVG/PDF、命名规则
   均未定义（原 §6.6 已随 alignment 归档，且本身不完整）。
   → **已补**：[`spec/map-export-spec.md`](../../spec/map-export-spec.md)（六项规格 + 差异逐条处置；基线图命名 §6.1）。
3. **没有性能验收记录**：v1 PRD §6 的「2000+ 元素同屏 / ≥55fps / 首屏 <1s」基线在 `map2` 重写后**从未复测**（口径以
   [`spec/map-perf-spec.md`](../../spec/map-perf-spec.md) 为准），
   当前只有"体感流畅"和 750 条用例（`pnpm exec vitest run src/windows/MapWindow`），没有数字。
   → **口径已补、数字仍缺**：`spec/map-perf-spec.md` 定了样本 / 方法 / 通过线 / 脚本名，但本批不实测（见 §5.3-2）。
4. **B4 的需求文档已补（2026-11-05）**：[`map-b4-layers-polyline-prd.md`](map-b4-layers-polyline-prd.md)
   给出了 7 条拍板项（类型即图层、面板位置、`layerState` 零写入、`showRegions` 归属、单一 `MapPolyline`、
   面要素暂缓、插层位置）与三批验收判据；**原始缺口记录保留在此**：
   图层面板此前只有 review §7 的一行缺口，折线只有服务嵌套子图的两篇方案稿、未按 B4 口径收口。
5. **素材数量口径曾漂移（已订正）**：**52** 是脚本与磁盘实测（`node scripts/count-map-sprites.mjs`，
   `assets/sprites/*.png` 也是 52；MANIFEST 共 56 条 = 52 符号 + 4 底图）。
   原先两处写 53，本次整理已改为 52；53 的具体来源未追溯（推测为把某张底图计入符号）。
   后续凡涉及数量，**以脚本输出为准**。
6. **子图边界过渡缺验收判据**：boundary 篇给了选型与实现要点，但没有"什么算通过"（渐隐宽度、色差阈值、
   截图基线），无法验收。
   → **已补**：[`R-MAP-DOC-submap-boundary-acceptance.md`](R-MAP-DOC-submap-boundary-acceptance.md)（四组判据，各标自动 / 人眼）。
7. **2.28.0 缺同 seed 对照图**：render-analysis 序 1 的验收要求"同 seed 前后对照"，当前只有实机口述结论。
   → **路线已定、图仍缺**：[`review/R-MAP-DOC-render-seed-review.md`](../../review/R-MAP-DOC-render-seed-review.md)（只核现状、不重建"前"图；"前"组无 2.x tag 可回退，补图前涉观感验收一律记「未验证」）。

### 5.2 业务层面（6 条）

1. **§3.4 五条无主遗留**没有处置结论。 → **已处置**（2026-11-06）：2 不立 + 3 立号（R-MAP-30/31/32，均 P2 不排期），见 §3.4 与[处置稿](R-MAP-DOC-legacy-disposition-scope.md) §A。
2. **素材导入（S2）无排期**，而它是一键成图"用久了就腻"的主要解法。 → **已排期**：R-MAP-22 批内**首位（P1）**，三个前置见[处置稿](R-MAP-DOC-legacy-disposition-scope.md) §B2。
3. **`map.db` 四条开放项**：缩略图抓取时机、`map_revisions` 无 UI（无法"回到上一版"）、
   `map_assets` 表已建未用、删作品后的「降级为独立地图」钩子未接（现留悬空 `work_id`）。 → **已收口**：四条均有「结论 / 归属 / 可判定触发条件」，见 [`spec/map-db-spec.md`](../../spec/map-db-spec.md) §9。
4. **A′ 的交互未设计**：跨图选择器要回答「引用还是拷贝」「子图能否反向跳转」「绑定的图被删除怎么办」。 → **已闭环（降级）**：2.32.0 的拷贝语义把三问答完（拷贝 / 源图被删零影响 / 反向跳转不适用），见[处置稿](R-MAP-DOC-legacy-disposition-scope.md) §C。
5. **道路 vs 水系边界未合并**：road 篇说"地点自动连路"，elements 篇说"水系只预留不自动生成"，
   两篇各自成立，但没有一张表说清"哪些线自动、哪些手画"。 → **已归并**：四类线一律手画、生成器对折线零产出，见 [`R-MAP-DOC-line-autogen-analysis.md`](R-MAP-DOC-line-autogen-analysis.md)。
6. ~~**图层与现有 7 层静态栈的关系未定**~~ —— **已定**（B4 PRD D7）：`doc.layers` 是「类型容器状态」，
   物理栈仍在 `layers.ts` 里固定；本批只在 `regionLayer` 与 `elementLayer` 之间**插一层** `polylineLayer`（8 → 9），
   其余不映射、不前移。

### 5.3 验证层面（3 条）

1. **观感回归无自动化**：无截图比对/像素基线，2.27~2.28 的调参全靠人眼，回退风险隐性。
   → 阈值与基线图口径已定（[`spec/map-export-spec.md`](../../spec/map-export-spec.md) §6.1 命名、
   [`R-MAP-DOC-submap-boundary-acceptance.md`](R-MAP-DOC-submap-boundary-acceptance.md) §2.3 的 ΔE），**比对脚本未做**。
2. **性能无压测脚本**：素材 2000+ 的视口剔除与 draw call 数没有度量口径。
   → 口径与脚本名已定（[`spec/map-perf-spec.md`](../../spec/map-perf-spec.md)），**脚本未实现**。
3. **子图递归深度无用例**：有 **16 层护栏**（`SUBMAP_MAX_DEPTH`，防爆栈用，`submapRender.ts:78`），
   无产品上限约定；深链（4 层以上）的缩放/剔除/导出没有用例。
   → **用例清单已给**：[`R-MAP-DOC-submap-boundary-acceptance.md`](R-MAP-DOC-submap-boundary-acceptance.md) §4（4 层 4 条 + 5 层 3 条）。

---

## 6. 不变量与负向约束（改动前必读）

> 完整版见 `review/map-vs-reference-render-analysis.md` §9.4 与
> `archive/prd-map/map-render-alignment-architecture.md` §6.2。这里只留最容易踩的十一条。

1. **运行期零滤镜**：海岸全部在烘焙期烤进 `RenderTexture`，`bakeCoast` 之后不许再加实时滤镜 ——
   这是"缩放流畅"的基本盘。
2. **不给 `Graphics` 遮罩挂 `filters`**：pixi 8.22 里 Graphics 只能走 stencil（0/1 无 alpha），
   挂 filter 会让 `isSimple=false`，遮罩几何被渲进临时纹理、主目标 stencil 恒空 ⇒ **内容整块消失且不报错**。
3. **不 `destroy` 自造静态纹理**：`getPaperGrainTexture()` 是模块级单例，`StrictMode` 二次挂载时
   `useMemo` 不重算，销毁后第二轮读 `_source` 直接白屏。
4. **缩放仍是单一事实源**：所有子图不各自持有缩放，只改根 `world.position/scale`；
   子图 LOD 用"等效缩放"查自己的权重，几何零重建。
5. **不改 `lod.ts` / `coords.ts` / 场景图 7 层结构**：这是本项目优于参考实现的三处，已认领。
6. **`levelAlphas` 是缩放驱动的 LOD 权重（Σα≡1），不是层级静态系数**：把它再乘到填充上会双重衰减，
   层级衰减必须另立静态系数表。
7. **区块观感不要靠压 `REGION_FILL_ALPHA`**：逆向源值是 α **0.30** / 边界 **3px** / `#73562d`
   （`decoded.js@131642`），2.38.0 已对齐。要收密度请压「同屏可辨识区块数」（LOD 帽函数 +
   `LOD_BLOCK_PX`），压 alpha 只会让边界线一起淡掉 —— 2.27.0 的 0.10 就是这条弯路的终点。
8. **`PLAIN_CELL_RATIO` 不是"随机留白"**：它是反解格边长的目标值；按旧语义丢格会重现"北密南秃"。
9. **地形只贴 PNG，禁程序化填色**（map1 的教训）；同一要素的数据与渲染必须单一事实源。
10. **改公共原语前先数使用点**：`MapCanvas` 的节点装配被 `render-stack-guard.test.ts` /
    `bake.test.tsx` / `coastBake.test.ts` 三处钉着，改装配顺序会同时炸三个文件 —— 设计如此。
11. **窗口根必须挂 antd `<App>`**：`AntApp.useApp()` 在缺少容器时**不报错**，而是返回
    `{ message:{}, notification:{}, modal:{} }`（`antd/es/app/context.js` 的默认值），
    于是 `message.success()` / `modal.confirm()` 全部 `TypeError`。它的抛出位置几乎总是在
    「写操作已经成功之后」的收尾语句里，所以症状是「操作生效了但界面不动」。
    守卫：`src/windows/MapWindow/app-shell.test.ts`。

---

## 7. 维护规则（这份文档怎么活下去）

1. **能力闭环时**：在 §1 把状态改成 ✅ 并填版本；§2 加一行（含当时的坑）；
   §3 删除对应条目；§4 把文档移到归档组。
2. **新开一项能力时**：先在 §3 加行（禁止只有代码没有文档），再决定它属于哪个能力域，
   最后才写需求/方案文档。
3. **口径统一**：数量类事实（素材数、用例数、版本号）一律用脚本或命令产出并写明命令，
   禁止手算后写进文档（教训见 render-analysis §9.5）。
4. **单一事实源**：本文负责"有哪些、到哪了、去哪看"；**不**复制具体参数（参数在代码常量里）、
   **不**复制执行序（在 render-analysis §9）、**不**复制表结构（在 map-db-spec）。
5. **归档纪律**：`docs/archive/prd-map/` 只进不出；已归档文档不再修改正文，只在顶部加说明。

---

## 附：本文与既有文档的引用关系

- 上游：`CHANGELOG.md`（2.18.0~2.28.0）、代码实测（`src/windows/MapWindow/`）
- 状态细节：`review/map-vs-reference-render-analysis.md` §9（观感）、
  `review/map-vs-reference-interaction-review.md` §9（交互批次）、`spec/map-db-spec.md` §9（数据层开放项）
- 未闭环需求：`nested-submap-*.md`、`region-editing.md`、`map-asset-system-architecture.md`
- 已归档依据：`archive/prd-map/`（6 个文件：5 篇 md + 1 个 `.ts`）
