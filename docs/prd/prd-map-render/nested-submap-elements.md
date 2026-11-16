# 嵌套子地图 · 要素预留清单与架构分层

> 模块全貌与进度见 [map-window-overview.md](map-window-overview.md)（地图模块唯一入口）。

> 状态：**待评审（部分已并入 B4）**｜方案稿；折线部分已并入 B4 PRD（2.30.0 落地），渲染铁律与「水系不自动生成」结论继续有效。归属 R-MAP 系列（地图渲染改造）的**增量**，是 `nested-submap-main.md`
> 的「要素扩展 + 状态架构」专篇。解决两件事：① 盘点用户后续可能需要的要素，**现在就在数据模型里
> 预留位置**（避免将来加要素触发文档迁移）；② 确立**数据层 / 状态层 / 渲染层的边界纪律**，防止
> 功能耦合与状态不统一。
> 输入：[`map-window-overview.md`](map-window-overview.md)（模块总览）、[`map-b4-layers-polyline-prd.md`](map-b4-layers-polyline-prd.md)（B4 折线执行口径）
> 基线：CheckIn **2.36.0**（工作区）｜折线（`MapPolyline`）已于 2.30.0 落地；面要素按 B4 D6 明确不做
>
> 线要素「自动 vs 手画」口径见 [`R-MAP-DOC-line-autogen-analysis.md`](R-MAP-DOC-line-autogen-analysis.md)（冲突时以该文裁定为准）。
>
> 两条用户已确认的关键决策（本文据此定稿）：
> - **素材散布区采用「离散实例」**（圈定区域 → 散布一批同种素材实例），**不做**连续纹理平铺；
> - **架构分层**：DB 持久化 + 不同业务 zustand store + UI state，减少 React 闭包陷阱与状态不统一。

---

## 0. 结论速览

1. **要素缺口里，最该现在预留的是「素材散布区」和「通用折线」**：前者兜住植被/沙漠/雪原，
   后者兜住道路/河流/山脉脊线/航线/势力边界。两者都复用现有渲染路径，风格问题从根上解决。
2. **一条渲染铁律（写死）**：凡地形/植被/山脉的**最终视觉元素一律贴 PNG 素材**，禁止 WebGL
   程序化绘制几何填色。程序化绘制只允许做「辅助几何」（裁剪、掩膜、边界），不许作为视觉元素。
   —— 这是 map1 分支品质差的教训：不是 WebGL 的错，是「程序化画几何」替代了「贴 PNG」。
3. **架构分层**：`DB 持久化（事实源）→ 业务 zustand store（可派生/可撤销）→ UI state（瞬态）`
   三层，MapWindow 当前的「单 useMapEditor 大 useState」要拆成多个业务 store，对齐项目既有的
   zustand 范式（`useNovelEditorStore` / `useMemoStore` 等先例）。
4. **水系不下调成「自动生成」，只作折线 `kind:"river"` 预留**：业界「程序化水文生成」成熟但不美观
   （且 map1 已踩坑），「手绘质感地图工具」成熟但都**不做自动水系**（只给笔刷让用户手画）——
   两者之间**不存在「既能自动生成、又能贴 PNG 好看」的成熟解**。因此内陆河流/湖泊**不自动生成**，
   只把「河」作为 `MapPolyline` 的一个 `kind` 预留，用户手画走向 + 线纹理笔刷渲染（详见 §3.4）。

---

## 1. 渲染铁律：贴 PNG，禁程序化填色（map1 教训）

### 1.1 教训复述

map1 分支用 WebGL 绘制地形与树木，成品品质差。**根因不是 WebGL，而是「用程序化绘制的几何
（多边形 + 填色 + 渐变）去替代本该贴 PNG 素材的地方」**——程序化画出来的树/山，与用户手里的
PNG 素材风格必然冲突。

逆向结论（makeamap_渲染逻辑分析.md §16）印证：

> - 「**素材体系（这才是"好看"的来源）**」：山/林/城/港都是「一个符号 = 一张 PNG + 一条联动文字」；
> - §644「山体/树木边缘锐利、色彩饱和 = 素材本身就是高分辨率 PNG，按 1:1 贴」；
> - `auto generate` 系列（山脉/城市/森林）由「自动生成器」**批量生成**，本质是「批量贴 PNG」。

### 1.2 铁律（写进 AGENTS 级规范）

> **凡地形 / 植被 / 山脉的最终视觉元素，一律贴 PNG 素材（Sprite / 散布实例 / 线纹理笔刷）。
> 禁止 WebGL 程序化绘制几何填色作为视觉元素。程序化绘制只允许用于辅助几何（裁剪掩膜、
> 边界、羽化遮罩）。**

违反判定：任何「画一个绿色多边形当森林」「画一条渐变当山脉」都是违反；「圈定区域贴 60 个森林
PNG」是正确。

### 1.3 铁律之二：同一要素的数据与渲染必须「单一事实源」（map1 水体失败根因）

map1 的湖泊/河流失败，根因**不是**「WebGL 画水不好看」，而是「同一份水体数据被两条渲染路径各画
了一遍」。`map-terrain.ts` 的开发者复盘注释原文：

> 「河流此前被画了两遍 —— GL 拿 cells 里的河格刷出一片宽水面，2D 层再按 pts 描一条窄水带，
> 两者中心线与宽度都对不上（GL 还有域扰动 + 覆盖度模糊把 1 格河吹宽到 ≈3 格），实测就是
> 『水道不连贯、两条水并排、水里还长着山』。」

> **凡同一要素，数据只存一份、渲染只走一条路径。禁止同一数据在 GL 与 2D 两条路径各画一遍。**
> 需要「GL 地表 + 2D 矢量」两套表现时，必须像 map1 里 `baseCells`（抹掉河流后的地表底质）那样，
> 显式派生第二份数据并指定唯一消费方，而不是让两条路径读同一份数据各自发挥。

---

## 2. 素材散布区（离散实例）—— 植被 / 沙漠 / 雪原的正确形态

### 2.1 数据模型（`types.ts`）

```ts
/** 素材散布区：圈定一个区域，批量散布同一种素材实例（离散实例，不做连续纹理） */
export interface MapMaterialArea {
  id: string;                       // 前缀 ma_
  /** 填充的素材（复用 SPRITES，与手动放置的素材是同一类东西 → 风格天然一致） */
  spriteId: string;
  /** 圈定区域（多边形，世界坐标） */
  polygon: Point[];
  /** 散布密度（每世界单位面积的实例数） */
  density: number;
  /** 缩放抖动区间 [min, max]，实例随机缩放 */
  scaleRange: [number, number];
  /** 旋转抖动区间（度） */
  rotationRange: [number, number];
  /** 是否「贴边」：实例沿区域边界排布（用于山脉脊线、森林边缘） */
  edgeMode?: boolean;
  /** 归属层级：与素材/道路同构，null = 层级无关 */
  level: number | null;
}
```

### 2.2 关键设计点

1. **「植被区」里放的不是「一个面」，而是「一批 `MapElement` 实例」**——它们和用户手动放的素材
   是同一类东西，走同一条 `MapElement` 渲染路径，风格天然一致。区别只是「这批实例是批量生成、
   受区域约束的」。
2. **离散实例（已确认）而非连续纹理**：`MapMaterialArea` 是「生成实例的规则」，不是「一张平铺
   纹理」。渲染/导出时按规则展开成 N 个 Sprite。好处：命中测试、移动单个实例、撤销都沿用现有
   `MapElement` 逻辑，零新渲染管线。
3. **生成是「派生」而非「存储」**：实例坐标由 `spriteId + polygon + density + 抖动 + 一个 seed`
   **确定性地派生**（加 `seed` 字段保证同参数必得同散布，撤销/截图比对可靠）。**不要把展开后
   的几百个实例坐标写进文档**——那会让撤销栈抱着一大坨坐标跑，且用户改一次 density 就要重写
   全部。文档只存「规则 + seed」，实例在渲染时按需展开。
4. **层级归属复用**：`level` 用现有 `elementWeight` / `submapEnterWeight` 门控，与素材/道路同构，
   零新 LOD 逻辑。
5. **边界约束**：区域多边形超出当前区块/子图时，实例生成时用 `pointInPolygon` 过滤（复用
   `regions.ts`），只保留落在区域内的实例；边缘实例可按 `edgeMode` 吸附到边界上。

> ⚠️ 需要给 `MapMaterialArea` 补一个 `seed: number`（上面的模型里漏了），否则「同参数必得同散布」
> 不成立。落实现时补上。

### 2.3 与「程序化面」的边界（防再犯）

| | 错误（map1 教训） | 正确（本文） |
|---|---|---|
| 森林 | 画一个绿色多边形 + 程序化树形 | 圈定区域，散布 N 个「森林 PNG」实例 |
| 沙漠 | 画一块黄色面 | 圈定区域，散布「沙丘 PNG」实例 |
| 山脉 | 画一条渐变脊线 | 折线 `kind:"ridge"` + 线纹理笔刷（贴 PNG 沿路径） |

---

## 3. 通用折线（含线纹理笔刷）—— 道路 / 河流 / 山脉脊线 / 航线 / 势力边界

> 这是对 `nested-submap-road.md` 的**升级**：把单一 `MapRoad` 泛化为 `MapPolyline`，
> 道路只是 `kind:"road"`。道路方案的结论全部保留，仅数据结构更通用。

### 3.1 数据模型

```ts
/** 通用折线要素：道路 / 河流 / 山脉脊线 / 航线 / 势力边界共用 */
export interface MapPolyline {
  id: string;                       // 前缀 pl_
  /** 折线类型（决定默认渲染与可用样式集） */
  kind: "road" | "river" | "ridge" | "route" | "border";
  styleId: string;                  // 线条样式（颜色/粗细/虚实/笔刷纹理）
  points: Point[];                  // 折线（首尾 = 锚点，中间 = 控制点）
  level: number | null;             // 层级归属
  fromId?: string;                  // road/route：起点地点要素
  toId?: string;                    // 终点地点要素
  /** 语义标签（可选：官道/土路/山路/水路…），仅展示，不影响几何，≠ kind */
  label?: string;
}

/** MapDocument / MapSubmap 增加 */
polylines: MapPolyline[];
```

> ⚠️ **`kind` 与 `label` 是两个不同字段，勿混**：
> - `kind` = **折线类型**（road/river/ridge/route/border），决定渲染与可用样式集；
> - `label` = **语义标签**（官道/土路/水路），纯展示文本，不影响几何。
> 原 road 篇把语义标签误写成 `kind`，已在本文统一定名。

### 3.2 线条样式增加「笔刷纹理」（pImage 思路）

逆向结论 §581-588：线要素用 `pImage`（线纹理笔刷），不是纯色 stroke。对应到本项目：

```ts
export interface PolylineStyleDef {
  id: string;
  label: string;
  color: number;                     // 纯色兜底（无笔刷时）
  width: number;                     // 世界单位线宽
  dash: "solid" | "dashed" | "dotted";
  brushTextureId?: string;           // 可选：线纹理笔刷（贴 PNG 沿路径，山脉/河流用）
}
```

- 无 `brushTextureId` → 现有 `Graphics` 纯色/虚线 stroke（道路默认）；
- 有 `brushTextureId` → 沿折线路径「贴 PNG 笔刷」（山脉脊线、河流），复用 `drawLandPath` 的
  Catmull-Rom 路径 + 沿路径放置 Sprite。**这是「贴 PNG」铁律在线要素上的落地**。

### 3.3 层级归属（沿用 road 方案的 D4，不变）

折线可见权重 = `submapEnterWeight(父图缩放) × elementWeight(level, 子图 levelAlphas)`，
线宽每级减半（`elementSizeFactor`）。子图只显示子图折线、父图只显示父图折线。

### 3.4 水系不自动生成，只作 `kind:"river"` 预留（业界调研结论）

**结论：业界不存在「既能程序化自动生成、又能保证手绘 PNG 质感好看」的成熟水系方案。** 两条路线
是分裂的：

| 路线 | 代表 | 成熟度 | 对你的适用性 |
|---|---|---|---|
| 程序化水文生成（高度图 + flux 水流累积，河从高处流向海） | Azgaar Fantasy-Map-Generator、mewo2 terrain、Genevaux(SIGGRAPH'13)、Landlab | ✅ 地理上**正确** | ❌ 产出「地理正确」而非「好看」；你的 map1 BFS 河流正是这套，已踩坑 |
| 手绘质感地图（河 = 笔刷手画走向） | Inkarnate（subtract 减法笔刷挖河 + 精修河岸）、Wonderdraft（路径笔刷）、目标网站 makeamap.cn（60 图集零水体） | ✅ 视觉**好看** | ✅ 与你「贴 PNG 质感对齐」一致，但都**不做自动水系** |

三条硬证据：

1. **目标网站零水体**（逆向 §16，第 612–652 行）：60 个图集只有山脉/丘陵/沙丘/雪山、城市、森林、
   村镇、港口——**没有任何河流/湖泊图集**；水从头到尾只有「海 + 海岸」（底图海面纹理 +
   海洋修饰层 + 浅海大陆架），即 `coastBake.ts` 已对齐的部分。
2. **map1 已踩坑**：BFS「河流自高处最陡下降入海 + 支流」生成的水道，实测「水道不连贯、两条水
   并排、水里还长着山」（见 §1.3）。
3. **连最成熟的开源项目也收敛到「用户手画」**：Azgaar v1.65.0 把「河流生成」与「河流渲染」
   彻底解耦，新增「选择单元格创建河流」模式，并明言「自定义河流走向完全由用户负责，系统不校验
   高程（No matter what the heights are, custom rivers are responsibility of users）」。

**因此定级**：

| 水系形态 | 定级 | 理由 |
|---|---|---|
| 海 + 海岸 + 浅海大陆架 | ✅ **P0，已闭环** | 目标网站有、`coastBake.ts` 已对齐，不属「待预留」 |
| 内陆河流/湖泊（程序化自动生成） | ❌ **P2，明确不做** | 无「自动 + 好看」成熟解；map1 已踩坑；与贴 PNG 质感对齐冲突 |
| 内陆河流/湖泊（用户手画折线） | 🟡 **P1，仅 `kind:"river"` 预留** | 河 = 用户手画走向的 `MapPolyline` + 线纹理笔刷，不做程序化拓扑 |

**纪律**：河流 = 用户手画的一条折线（`MapPolyline`, `kind:"river"`）+ 线纹理笔刷贴 PNG，**不写
任何「从高处 BFS 下降入海」的程序化生成逻辑**。河网拓扑（源点/支流/入海）由用户在「地点/要素」
层手动或半自动连线，系统不负责「河符不符合地理规律」，只负责「把用户画的线渲染好看」。

---

## 4. 其余要素预留（P1，只留字段不展开设计）

| 要素 | 预留方式 | 说明 |
|---|---|---|
| 标注类型 `label.kind` | `MapLabel` 加可选 `kind?` | 城市/山川/海域/势力，决定标注样式，先留字段 |
| 剧情事件点 `MapEvent` | `MapDocument.events` 预留 | 「小说地图」区别于通用制图的核心价值，地点 + 章节关联 |
| 装饰三件套 | `MapDocument.decorations` 预留 | 图例/比例尺/指北针，走独立装饰层 |
| 区域着色（势力/气候） | 复用 `MapRegion` 结构，暂不新增 | 与行政区划同构，`kind` 区分 |

**明确不预留（避免过度设计）**：海岸线手动编辑（涉及 land 几何重构）、跨域章节关联（涉及
non-map 域数据）、渲染层氛围滤镜（走 `style` 扩展）、**内陆水体的程序化自动生成（BFS 河流等，
无「自动 + 好看」成熟解，见 §3.4，P2 不做）**。

---

## 5. 架构分层：DB 持久化 + 业务 zustand store + UI state

### 5.1 现状问题

MapWindow 当前是**单个 `useMapEditor` hook + 一堆 `useState`**（`doc` / `viewport` / `selectedId` /
`undoStack` / `redoStack` / `pendingSpriteId` 全塞在一个 hook 里）。这正是「状态不统一 + React
闭包陷阱」的温床：撤销/重做、选中态、视图态、pending 态混在一起，每次渲染都重建一套回调。

项目里 zustand 5.0.15 已装，且有成熟范式（`useNovelEditorStore` / `useMemoStore` / `useEntityJumpStore`，
每个业务一个 store）。MapWindow 应**对齐既有范式**，而不是继续用大 useState。

### 5.2 三层边界（写死，防耦合）

```
┌─────────────────────────────────────────────────────────┐
│  DB 持久化（唯一事实源）                                   │
│  novel_maps.doc_json —— 只存「文档数据」：MapDocument 序列化  │
│  （land/regions/elements/labels/polylines/materialAreas/   │
│    events/decorations/version）                            │
│  · 不含：viewport、selectedId、undo/redo、pending 等瞬态     │
└─────────────────────────────────────────────────────────┘
                          ↑ 读/写（经 IPC）
┌─────────────────────────────────────────────────────────┐
│  业务 zustand store（可派生、可撤销）                       │
│  useMapDocStore      —— 文档数据 + undo/redo（快照栈）        │
│  useMapViewportStore —— viewport / 缩放（高频，独立避免重渲染）│
│  useMapSelectionStore—— selectedId / 选中态                 │
│  useMapToolStore     —— 当前工具 / pending 放置态            │
│  useSubmapStore      —— 子图进入/渐入的派生门控              │
│  各 store 只暴露 selector + action，禁止互相 import 内部实现   │
└─────────────────────────────────────────────────────────┘
                          ↑ subscribe（selector 精确订阅）
┌─────────────────────────────────────────────────────────┐
│  UI state（瞬态，不进 store）                              │
│  hover 状态、拖拽中的临时坐标、输入框 value 等               │
│  用组件内 useState/useRef，随组件销毁即丢弃                 │
└─────────────────────────────────────────────────────────┘
```

### 5.3 边界纪律（每条都是防耦合/防闭包陷阱的具体手段）

1. **DB 只存文档数据，不存瞬态**：`viewport`、`selectedId`、`undo/redo`、`pending` 一律不进 DB。
   DB 里若出现 `selectedId` 就是边界违规。
2. **undo/redo 只作用于 `doc` store**：快照栈只快照「文档数据」，不涉及 viewport/选中态。
   选中态、视口变化**不进撤销栈**（与 `MapLabel.offsetY`「只由渲染层写、不进撤销栈」同一纪律）。
3. **高频状态独立成 store**：`viewport`（滚轮每格都变）单独一个 store，避免和 `doc` 绑定导致
   「缩一下拖整个文档树重渲染」。selector 用精确订阅（`useMapViewportStore(s => s.scale)`），
   不做 `useMapViewportStore()` 全量订阅。
4. **跨 store 派生用 selector + 中间层，不用闭包捕获**：子图渐入权重 = f(viewport.scale, doc)，
   这类跨 store 派生放在「派生层」（`useSubmapStore` 或一个 `selectSubmapEnterWeight` selector），
   **不**写在组件回调里捕获旧值——闭包陷阱的根源就是「回调里引用渲染时的旧 state」。
5. **渲染层只读 store，不写**：`MapCanvas` 通过 subscribe 拿到 doc/viewport 做增量同步（已有
   「增量同步」纪律），写操作一律走 store 的 action → commit 入撤销栈。禁止渲染层直接改 doc。

### 5.4 与现有「渲染三纪律」的关系

本章不推翻 `architecture.md` 的「增量同步 / 视口只改 scale / 权重只落容器 alpha」三纪律，而是
在**状态层**补齐它们的对偶：三纪律管「渲染层怎么高效画」，本章管「状态层怎么干净地存与传」。
两者合起来才是「无级缩放 + 高性能」的完整保障。

---

## 6. 改动范围清单（要素 + 架构增量）

| 模块 | 文件 | 改动 |
|---|---|---|
| 数据模型 | `types.ts` | 新增 `MapMaterialArea`（含 `seed`）、`MapPolyline`、`PolylineStyleDef`；`MapDocument`/`MapSubmap` 加 `polylines` / `materialAreas` / `events` / `decorations`；`MapLabel` 加 `kind?`；`MapElement` 加 `isPlace?` |
| 渲染铁律 | `AGENTS.md` §6.1.x | 新增「地形/植被/山脉只贴 PNG，禁程序化填色」一条 |
| 状态分层 | `useMapEditor.ts` 拆分 | 拆成 `useMapDocStore` / `useMapViewportStore` / `useMapSelectionStore` / `useMapToolStore`（新目录 `store/`） |
| 持久化 | `electron` 主进程 | `novel_maps.doc_json` 读写 IPC（按 PRD §7 既有约定接） |
| 渲染 | `MapCanvas/index.tsx` | 新增 `materialAreaLayer`（散布实例，复用 `MapElement` 路径）、`polylineLayer`（折线 + 可选笔刷纹理） |
| 文档 | `docs/prd/prd-map-render/` | 本文 + 同步修正 `nested-submap-road.md`（`MapRoad` → `MapPolyline`） |

---

## 7. 验证方式

1. **单元测试（纯函数）**：
   - `materialArea` 实例展开：同 `seed` + 同参数 → 实例坐标逐点相同（确定性）；实例全部落在
     `polygon` 内（`pointInPolygon`）；`density` / `scaleRange` / `rotationRange` 生效；
   - `polyline` 笔刷纹理沿路径放置：首尾对齐、间距均匀；
   - store 边界：undo/redo 只回滚 doc、不回滚 viewport/selectedId。
2. **截图比对（视觉）**：
   - 圈定区域填充「森林」→ 与手动放的森林 PNG 风格一致（不是绿色多边形）；
   - 河流/山脉脊线用笔刷纹理，与 PNG 素材风格一致；
   - 子图只显示子图折线/散布区，父图尺度门控为 0。
3. **性能**：
   - 大面积散布区：实例按需展开 + 视口剔除（`cull.ts`），不一次性建几百个 Sprite；
   - 滚轮缩放不触发 doc store 更新（viewport 独立 store），无整树重渲染。

---

## 附：要素决策速查

| 要素 | 结构 | 渲染方式 | 预留 |
|---|---|---|---|
| 植被/沙漠/雪原 | `MapMaterialArea`（离散实例 + seed） | 批量贴 PNG（复用 `MapElement`） | P0 |
| 道路/山脉脊线/航线/势力边界 | `MapPolyline`（kind 区分） | 折线 + 纯色/笔刷纹理 | P0 |
| 内陆河流/湖泊（用户手画） | `MapPolyline`, `kind:"river"` | 折线 + 线纹理笔刷，不自动生成 | P1 |
| 海 + 海岸 | `coastBake.ts` 四层海岸 | 已闭环，非待预留 | ✅ |
| 标注类型 | `MapLabel.kind?` | 样式区分 | P1 |
| 剧情事件点 | `MapEvent` | 地点 + 章节关联 | P1 |
| 装饰三件套 | `decorations` | 独立装饰层 | P1 |
| 内陆水体（程序化自动生成） | — | — | ❌ P2 不做 |
