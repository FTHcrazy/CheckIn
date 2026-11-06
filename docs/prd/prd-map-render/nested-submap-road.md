# 嵌套子地图 · 道路自动生成与层级归属

> 模块全貌与进度见 [map-window-overview.md](map-window-overview.md)（地图模块唯一入口）。

> 状态：方案稿（待评审）。归属 R-MAP 系列（地图渲染改造）的**增量**，是 `nested-submap-main.md`
> 的「道路层」专篇。解决两件事：① 在地点要素之间**自动生成道路**；② 道路作为**独立绘制层**，
> 支持多种线条、用户手动调整，且**缩放时子图只显示子图自己的道路、父图只显示父图自己的道路**。
>
> 本文默认方案已按用户确认采用（「按你的默认来」）。文内标注了四个可调决策点（D1~D4）及其
> 默认取值，后续如需改，只动对应决策点即可。
>
> ⚠️ **数据结构已升级**：本文的 `MapRoad` 已泛化为**通用折线 `MapPolyline`**（`kind:"road"`），
> 详见 `nested-submap-elements.md` §3。道路方案的全部结论（自动生成、独立图层、层级归属 D4、
> 手动调整）**不变**，只是容器从「专用 MapRoad 数组」改为「通用 polylines 数组 + kind 过滤」。

---

## 0. 结论速览

1. **道路是全新的独立能力**（现状无「道路/连线」概念，README 已注明「v1 PRD 的标记/连线不在范围」），
   但它**复用**既有的三个机制，不另起炉灶：`level` 层级归属（`elementWeight`）、渲染层增量同步、
   独立图层容器。
2. **地点 = 给现有要素加可选标记**（D1）：不新建大类，`MapElement` / `MapLabel` 加 `isPlace?`，
   「地点」天然继承 level 归属与移动/删除联动。
3. **道路自动生成 = 给初始折线路径**（D2）：自动在地点间生成一条**折线**（带中间控制点），
   用户可拖控制点微调。自动生成只是「给个起点」，调整才是核心。
4. **道路是独立图层 `roadLayer`**（D3）：支持多种线条样式（颜色/粗细/虚实）+ 可选语义类型标签，
   与素材层、标注层平级，z 序在素材之上、标注之下。
5. **层级归属 = 道路跟随所属地图**（D4）：道路按 `level` 归属，子图里的道路在父图尺度下不显示，
   缩进子图才显示子图自己的道路——与素材/标注的 `elementWeight` 机制**完全同构**，零新 LOD 逻辑。
6. **数据结构 = 通用折线 `MapPolyline`**：道路是 `MapPolyline` 的 `kind:"road"`，与河流/山脉脊线/
   航线/势力边界共用同一结构，将来加一类 = 加一个 kind + 一个样式，零新结构（见 elements 篇 §3）。

---

## 1. 数据模型（`types.ts`）

> 道路用通用折线 `MapPolyline`（`kind:"road"`），结构定义见 `nested-submap-elements.md` §3。
> 这里只列道路视角的字段映射：

```ts
/** 道路 = MapPolyline 的 kind:"road"（字段由通用折线承载，见 elements 篇 §3） */
// kind: "road"
// fromId / toId: 起终点地点要素 id（对应 MapElement.id 或 MapLabel.id）
// points: 折线路径（世界坐标），首尾 = 起终点锚点，中间为可拖控制点
// styleId: 线条样式 id（见 §3 ROAD_STYLES）
// level: 归属层级，与素材/标注同一套规则，null = 层级无关

/** MapDocument / MapSubmap 增加字段 */
interface MapDocument {
  // ...现有字段不变
  polylines: MapPolyline[];   // 其中 kind:"road" 即道路
}
interface MapSubmap {
  // ...现有字段不变
  polylines: MapPolyline[];   // 子图自己的折线（含道路），独立于父图
}
```

**关键设计点**：

1. **道路两端锚定「地点要素」**：`fromId` / `toId` 指向被标为地点的要素（`isPlace`）。道路是
   「派生连接」，地点移动时道路端点跟随（与 `MapLabel.elementId` 联动素材同款机制）。
2. **`points` 是完整折线**（首尾 = 起终点，中间 = 控制点），不存「首尾之外只存控制点」的压缩形式：
   这样命中测试、导出、撤销都只处理一种结构，且将来支持「无起终点的自由道路」也无需迁移。
3. **道路的 `level` 与地点要素的 `level` 解耦**：默认道路继承「两端地点中较粗的一级」（道路跨两级
   时应挂在较粗的一级，避免在细层级里出现一条「穿出区块」的长路），但保留可手动覆盖。
4. **子图有自己的 `polylines`**：与子图自己的 `elements` / `labels` 同构，子图道路不进父图道路数组。

### 地点标记（D1）

```ts
interface MapElement {
  // ...现有字段不变
  /** 是否被标注为「地点」（道路端点）；undefined/false = 普通要素 */
  isPlace?: boolean;
}
interface MapLabel {
  // ...现有字段不变
  isPlace?: boolean;
}
```

- 默认方案：**不新建「地点」大类**，只加 `isPlace` 可选标记。理由：地点本质是「这个要素能否做
  道路端点」，是个布尔属性，不是新类型；加标记后地点天然继承 level、移动、删除联动，零新增复杂度。
- 若将来「地点」需要独立图标/样式，再单独抽一层，当前不预埋。

---

## 2. 道路自动生成（D2）

**流程**：用户选中两个 `isPlace` 要素 → 触发「生成道路」→ 系统生成一条初始折线 → 用户拖控制点微调。

**初始折线形态（默认 = 折线 + 中间控制点）**：

1. 取起终点锚点（地点要素的底部锚点 `x/y`）；
2. 在两点间插入 1~2 个中间控制点，默认取「中点 + 垂直于连线方向的小幅偏移」（用 `fbm` 噪声给一个
   轻微弯曲，避免死板直线——复用 `regions.ts` 的噪声工具）；
3. 结果是一条**已可微调**的折线，用户后续拖任意控制点改走向。

**为什么是折线而非贝塞尔**：折线控制点直观（拖哪动哪）、命中测试简单（点-线段距离）、导出（SVG
path）直接映射；贝塞尔的控制点不在曲线上、用户理解成本高。若将来要平滑道路，可在**渲染层**用
Catmull-Rom → 贝塞尔插值（`land.ts` 已有 `drawLandPath` 的成熟做法），**文档数据仍存折线**——
「数据存折线、渲染平滑化」是比「数据存贝塞尔」更稳的取舍。

**手动调整**：
- 拖动整条道路 = 平移（两端锚点不动，整体位移）；
- 拖动控制点 = 改变局部走向；
- 拖动端点 = 重新吸附到另一个地点（或断开成自由端点，二期）；
- 全部走 `commit` 入撤销栈。

---

## 3. 道路绘制层与线条样式（D3）

### 3.1 独立图层

```
world
├─ staticLayer / coast / regionLayer
├─ elementLayer          ← 素材（现有）
├─ roadLayer             ← 道路（新增，z 序在素材之上、标注之下）
├─ labelLayer            ← 标注（现有）
└─ overlay
```

- `roadLayer` 与素材、标注平级，是**独立容器**，可用「显示/隐藏道路层」独立开关；
- 子图子树内部同样有自己的 `roadLayer`（递归）。

### 3.2 多种线条样式

```ts
export interface RoadStyleDef {
  id: string;            // 稳定标识，持久化存这个值
  label: string;
  color: number;         // 0xRRGGBB
  width: number;         // 世界单位线宽
  dash: "solid" | "dashed" | "dotted";   // 实线/虚线/点线
}

export const ROAD_STYLES: RoadStyleDef[] = [
  { id: "road-main",  label: "官道", color: 0x8a6b3a, width: 4,   dash: "solid"  },
  { id: "road-dirt",  label: "土路", color: 0xa98a5a, width: 2.5, dash: "solid"  },
  { id: "road-path",  label: "小径", color: 0x9a8a6a, width: 1.5, dash: "dashed" },
  { id: "road-water", label: "水路", color: 0x4a6a8a, width: 2,   dash: "dotted" },
];
```

- **视觉样式（颜色/粗细/虚实）**是核心；`label`（语义标签：官道/土路/水路）是可选附加，仅展示用；
  注意 `label` ≠ 折线类型的 `kind`（见 elements 篇 §3 的定名澄清）。
- 线宽用**世界单位**（与素材 `baseWidth` 同口径），渲染时按 `scale` 缩放，保证「缩放到父图看道路」
  时线宽随层级一致变细，而不是屏幕像素恒定（道路该跟着地图走，与地名标注「屏幕字号恒定」是两种
  语义，见 §4）。

---

## 4. 层级归属：子图只显示子图道路、父图只显示父图道路（D4）

这是本需求最关键的一条，它和之前「小溪村只在县城层级看轮廓」是**同一个思想**：

- **道路跟随它所属的地图**。父图（县城）的道路只在父图尺度显示；子图（小溪村）的道路只在缩进
  子图后显示。**不存在**「子图的主干道在大地图上也能看到一条淡化线」的跨层穿透（默认关闭，D4）。
- 实现上**零新 LOD 逻辑**：道路的可见权重直接复用 `elementWeight(level, levelAlphas)` ——
  子图的 `roadLayer` 挂在子图子树内部，其可见性由「子图渐入权重」（主方案 §5.3 的
  `submapEnterWeight`）**整体门控**，道路自己再按 `level` 在子图内部淡入淡出。两层门控叠加，
  天然得到「父图尺度看不到子图道路、缩进子图才看到子图自己的道路」。

```
子图道路的最终可见权重 = submapEnterWeight(父图缩放) × elementWeight(道路.level, 子图levelAlphas)
```

- **线宽的层级缩放**：道路线宽按 `elementSizeFactor(level, levelCount)` 同款「每级减半」缩放
  （与素材尺寸减半同源），这样缩到父图尺度时，子图道路（若可见）的线宽也等比变细，与素材、
  区块边界同呼吸，不会出现「一根粗线杵在细地图上」的违和。

---

## 5. 改动范围清单（道路增量）

| 模块 | 文件 | 改动 |
|---|---|---|
| 数据模型 | `types.ts` | 新增 `MapPolyline`（`kind:"road"`）、`PolylineStyleDef`/`ROAD_STYLES`；`MapDocument.polylines`、`MapSubmap.polylines`；`MapElement`/`MapLabel` 加 `isPlace?`；`createEmptyDocument`/`migrateDoc` 补默认 |
| 渲染 | `MapCanvas/index.tsx` | 新增 `roadLayer`（z 序在素材之上、标注之下）；子图子树内递归挂 `roadLayer`；道路绘制走 `drawLandPath` 同款的折线渲染（含虚线/点线 via Graphics lineStyle） |
| 状态 | `useMapEditor.ts` | 新增 `generateRoad`（自动生成初始折线）、`moveRoad`/`dragRoadPoint`（手动调整）、`togglePlace`（标注地点），走 `commit` 入撤销栈 |
| 逻辑 | 新增 `road.ts`（纯函数） | `buildInitialRoad`（自动生成折线）、`roadWeight`（submapEnterWeight × elementWeight）、`roadSizeFactor`（线宽层级缩放）、`roadAt`（命中测试：点到折线距离） |
| 文档 | `docs/prd/prd-map-render/` | 本文 |

---

## 6. 验证方式

1. **单元测试（纯函数）**：
   - `buildInitialRoad`：两地点间生成的折线首尾 = 起终点锚点、中间控制点个数符合配置；
   - `roadAt`：点到折线的命中距离正确（垂足在段内/段外两种情形）；
   - `roadWeight`：`submapEnterWeight × elementWeight` 的乘积正确（含门控为 0 的情形）；
   - `roadSizeFactor`：线宽「每级减半」正确；
   - `migrateDoc` 对老文档（无 `polylines`/`isPlace`）兼容。
2. **截图比对（视觉）**：
   - 两地点间生成道路 → 拖控制点 → 道路走向变化正确、端点跟随地点移动；
   - 多种线条样式（官道/土路/小径/水路）颜色、粗细、虚实正确；
   - 道路层独立开关：隐藏后道路消失、素材/标注不受影响。
3. **层级归属（端到端，钉死）**：
   - 县城道路 + 小溪村道路各建一条；
   - 缩到县城尺度：**只显示县城道路**，小溪村道路不可见（门控为 0）；
   - 缩进小溪村区块：小溪村道路随子图渐入淡入，其线宽按层级等比变细；
   - 全程无级、无跳变、底图不糊（沿用 §8.1 的小溪村→县城用例，追加道路判定）。

---

## 附：四个可调决策点

| # | 决策点 | 默认取值 | 改法 |
|---|---|---|---|
| D1 | 地点如何标注 | 给 `MapElement`/`MapLabel` 加 `isPlace?` 标记，不新建大类 | 若需独立图标，再抽「地点」层 |
| D2 | 自动生成路径形态 | 折线 + 中间控制点（数据存折线，渲染层可平滑） | 可改为贝塞尔，但数据结构需重审 |
| D3 | 线条样式 | 视觉样式（颜色/粗细/虚实）+ 可选 `label` 语义标签 | 可扩充 ROAD_STYLES 表 |
| D4 | 层级归属 | 道路跟随所属地图，无跨层穿透；线宽每级减半 | 若需「子图主干道在大图可见淡化线」，需另加跨层权重 |
