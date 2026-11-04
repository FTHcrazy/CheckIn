# 地形素材体系架构设计（R-MAP-22 续）

> 版本：v1.2（S1 已落地） · 日期：2026-11-04
> 基线：2.22.x（B0 持久化 / B1 属性面板 / B2 素材落地；2.22.2 补缺批后共 53 张符号 + 4 张底图）
> 服务对象：B3 一键成图生成器（R-MAP-21）、后续热门地图生成与 AI 接线
> 上游依据：`review/map-vs-reference-interaction-review.md` §R-MAP-22 / `assets/sprites/MANIFEST.json`

---

## 一、背景与目标

B2 之后素材已达 45 张（6 分类）+ 4 张底图，全部 AI 生成；2.22.2 补缺批又新增
沼泽/草原/雪原 8 张（现 53 张、9 分类），专门补齐地形配方的原料缺口——
**地形不是一个「地形图」，而是一份「素材配方」**：沼泽 = 芦苇丛 + 水草滩 +
浅滩水洼 + 沼泽枯木交叉渲染，读者自然读出「这是沼泽」。生成器（B3）要的
不是「53 张素材」，而是「给我一种地形，还我一批合适的素材」。当前体系缺三块：

1. 素材只有**面板展示分类**（mountain/forest/…），没有**地形语义标签**，机器无法按地形选材；
2. 没有用户导入通道（`map_assets` 表已建、未启用）；
3. 「十万大山」「南疆沼泽」这类热门地图没有数据结构承载。

**目标**：建立「地形枚举 → 素材标注 → 选材引擎 → 供给层」四层体系，
导入 / 热门地图 / AI 三个预留能力都挂在这四层上，不另起炉灶。

**不包含**（本期不做，只留接口位）：导入 UI 的具体交互稿、AI prompt 的具体
措辞、热门地图预设的数值调优。

---

## 二、核心决策：展示分类 / 地形语义 / 地貌带三轴分离

这是全方案的根基。**目录、登记表、生成引擎各管一件事，不互相越位。**

| 轴 | 载体 | 面向谁 | 归属关系 |
|----|------|--------|----------|
| 展示分类 `category`（现有 6 类） | `SpriteDef.category` + 面板分组 | **人**（素材面板找图） | 单归属：一张素材只进一个分组 |
| 地形语义 `terrains`（S1） | `SpriteDef.terrains: TerrainKind[]` | **机器**（生成器选材） | **多标签**：雪峰 ∈ 高山 + 雪原 |
| **地貌带** `zones`（2.26.0，第三轴） | `SpriteDef.zones: SpriteZone[]` + `domain/zones.ts` | **机器**（同一地形换哪一族画风） | **多标签**：松树 ∈ 主带 + 雪带 |
| 物理目录 | `assets/sprites/`（现状不动） | 打包器 | 不表达任何语义 |

**为什么需要第三轴**（`docs/review/map-vs-reference-render-analysis.md` P0-1）：
地形语义只回答「画什么」——`mountain` 配方里既有雪峰也有连绵山岭。只有两个轴时，
一张温带图的南缘也会长雪峰、雪原图的腹地也会长阔叶树，整张图「处处同款」。
第三轴回答「用哪一族画风」：同一 `mountain` 地形，北带取雪峰、主带取山岭、
南带取风蚀石林。参考实现把山体素材拆成 主池/丘陵/沙漠/雪原 四池，就是这一轴。

**带的口径**（`core` 是全带通用池，不是"中间那条带"）：
人文 / 港渡 / 遗迹只标 `core`（任何气候都成立）；沙丘/绿洲/风蚀岩/石林只标
`desert`；雪峰/雪岭/雪松/雪丘只标 `snow`；圆丘/梯田/阔叶/草丛/疏树只标 `grass`；
其余山地林木标 `core`（主池，全带首选）。选材时**本带优先、core 兜底**——
只要本带有货就绝不跨带。

**为什么目录不按地形类型分子目录**：地形是多标签（一张「雪松林」同时服务
雪原/山地/林地三种地形），按地形建目录会逼出单归属，出现「复制三份」或
「随便放一个」两种坏结局。目录若要整理，只按展示分类分子目录（纯物理归档，
登记表 `src` 路径随之改，id 不动）。**登记表是唯一事实源**，目录只是仓库。

---

## 三、地形枚举 `TerrainKind`

新增于 `src/windows/MapWindow/pages/MapEditorPage/domain/terrain.ts`（纯枚举 + 元信息，无 IO）。
首版 20 个，覆盖常见地形；后续加地形 = 加枚举项 + 给存量素材补标签，不动引擎。

```ts
export type TerrainKind =
  // ── 陆地基本形 ──
  | "plain"        // 平原
  | "grassland"    // 草原
  | "hill"         // 丘陵
  | "mountain"     // 山地
  | "highland"     // 高原
  | "valley"       // 峡谷/谷地
  | "volcano"      // 火山
  // ── 水系 ──
  | "river"        // 河流
  | "lake"         // 湖泊
  | "swamp"        // 沼泽
  | "coast"        // 海岸
  | "sea"          // 海洋（群岛/航路）
  // ── 气候极端 ──
  | "desert"       // 沙漠
  | "snowfield"    // 雪原
  | "tundra"       // 冻原
  | "jungle"       // 丛林
  | "forest"       // 森林（温带林）
  | "oasis"        // 绿洲
  // ── 人文（点要素为主）──
  | "settlement"   // 城郭/村落（聚落）
  | "landmark"     // 遗迹/关隘/地标
  ;
```

配套元信息表 `TERRAIN_META`：key → 中文名 / 图标语义 / 默认地名池
（如 `swamp → ["黑水泽","瘴雾泽"]`）。地名池是热门地图与一键成图的共用底料，
缺失时回退到素材自带 `names`，再回退到不命名。

**与 `category` 的映射关系**（标注示例，落地时逐张过）：

| 现有素材（例） | category（不变） | terrains（新增） |
|---|---|---|
| mountain-peak | mountain | mountain, highland |
| snow-peak-a | mountain | mountain, snowfield, tundra |
| dune-a | desert | desert |
| oasis | desert | oasis, desert |
| forest-dense | forest | forest, jungle |
| port-harbor | harbor | coast, sea |
| city-major | settlement | settlement, plain, grassland |
| ruins-arch | ruin | landmark |

> 53 张一次性标注是体力活：按 MANIFEST 的 subject 半自动初标 + 目检终审，
> 标注结果直接写进 `sprites.ts` 登记表（与 id 同处，diff 可审）。

---

## 四、目录结构设计

```text
src/windows/MapWindow/
├─ assets/sprites/                    # 【本地打包素材】现状不动（53 符号 + 4 底图 + MANIFEST.json）
├─ pages/MapEditorPage/
│  ├─ domain/                         # ★ 新增：地图域纯逻辑层（无 IO、无 React、vitest 直测）
│  │  ├─ terrain.ts                   #   TerrainKind 枚举 + TERRAIN_META
│  │  ├─ terrain-assets.ts            #   选材引擎 pickTerrainSprites()（见 §五）
│  │  └─ mapPresets.ts                #   热门地图预设登记表 MapPresetDef（见 §七）
│  ├─ sprites.ts                      # 登记表（唯一事实源）：SpriteDef 扩 terrains/weight
│  └─ …
└─ …

# 【用户导入素材】不在包内，走用户数据区（主进程管辖）：
{user-data}/map-assets/
├─ library/                           # ★ 新增：跨地图共享的导入素材库（doc_id = NULL）
│  └─ <assetId>.png|.webp
└─ <docId>/                           # B0 已有：单图资源（getMapAssetsDir）
```

- **打包素材**经 Vite 静态导入，构建期定死；**导入素材**运行期经 IPC 读取。
  两者最终都归一成 `SpriteDef` 进同一场随机池 —— 「一键生成同时用两类素材」
  在数据结构层天然成立，不需要特判。
- `map_assets` 表复用 B0 schema：导入素材一行 = `kind:'sprite'`、`doc_id:NULL`、
  `meta_json = { label, category, terrains, baseWidth, baseHeight, names?, weight? }`。
  表结构零迁移。

---

## 五、选材引擎（生成器的唯一取料口）

`domain/terrain-assets.ts`，纯函数、可 seed、不碰 React 与网络：

```ts
export interface SpriteSource {          // 本地与导入素材的公共形状
  id: string;
  src: string;
  terrains: TerrainKind[];
  zones?: SpriteZone[];                  // 缺省 ["core"]（导入素材未标注 = 全带通用）
  weight?: number;                       // 缺省 1
  // …其余与 SpriteDef 对齐
}

/** 按地形随机取材：seed 相同 ⇒ 结果相同（一键成图可复现，「换一张」= seed++） */
export function pickTerrainSprites(
  pool: SpriteSource[],
  terrain: TerrainKind,
  opts: { count: number; seed: number; excludeIds?: string[]; zone?: SpriteZone },
): SpriteSource[];
```

实现要点：
- **过滤 + 补位**：先在 `terrains` 含 terrain 的素材里抽（且不在 `excludeIds`）；
  不足 count 时按回退链逐级补满（如 `tundra` 主池不足时由 `snowfield` →
  `grassland` → `plain` 补位，链写在 `TERRAIN_META`；有多少给多少，不抛错）；
- **分带（2.26.0）**：给了 `zone` 就按序收窄 —— ① 同地形 + 本带 → ② 同地形 +
  `core`（通用池）→ ③ 地形回退链。只有 ①② **一张都没有**时才放开「同地形任意带」
  （`core` 带里的 `desert` 地形就该铺沙，分带不该把它饿死）；**只要本带有货，
  绝不跨带**——跨带就等于没分带；
- **加权抽样**：`weight` 加权不放回抽取，rng 用 mulberry32（同 seed 全链路一致）；
- **守卫测试**：`terrain-assets.test.ts` 钉住「seed 确定性 / 多标签命中 / 回退链
  补位 / exclude 生效 / 不改写入参」五条，另加 §十二.3 三条体系守卫 +
  2.26.0 新增的分带四条（本带独占 / core 补位不跨带 / 只在天生缺料时跨带 /
  不传 zone 保持老行为），以及素材侧两条（`zones` 非空合法、三带各有专属素材）；
  `terrain.test.ts` 钉住 META 完整性与回退链无环。

---

## 六、用户导入流程（预留设计，落地在后续批次）

```text
素材面板「导入素材」
  → 选文件（png/jpg/webp，单张 ≤ 4MB，扩展名白名单）
  → 归属标注弹层：地形类型（TerrainKind 多选，必填 ≥1）
                 展示分组（category 单选）/ 展示名 / 基准宽高（默认按图片比例）
                 可选：命名池
  → IPC map-asset-import
      主进程：格式校验 → 文件名归一为 <assetId>.<ext>（不信任原始文件名）
            → 拷入 {user-data}/map-assets/library/
            → INSERT map_assets(kind='sprite', doc_id=NULL, meta_json=…)
  → 渲染层把返回的 SpriteDef 并入素材池 → 面板出现「我的素材」分组
```

- 新增主进程通道：`map-asset-import` / `map-asset-list` / `map-asset-delete`
  （走 `handlers/map-handlers.ts` + preload 白名单 + `electron.d.ts`，项目惯例三件套）；
  `map-db.ts` 补 `getMapAssetsLibraryDir()`（与 `getMapAssetsDir(docId)` 并列，不混用）。
- **删除**：删文件 + DELETE 行；被存档引用的 id 悬空由现有「素材加载失败跳过该元素」
  兜底，不做级联清理（存档完整性优先，孤儿引用仅日志）。
- 与一键成图的关系：选材引擎吃合并池，**用户素材与本地素材同权重参与随机**；
  「只用我导入的」作为生成器选项（`sourceFilter`），不是独立代码路径。

---

## 七、热门地图生成（预留设计）

新增 `domain/mapPresets.ts` 登记表，一个预设 = 一张「地形配方」：

```ts
export interface MapPresetDef {
  id: string;                              // "shiwandashan"
  label: string;                           // 十万大山
  terrainMix: { terrain: TerrainKind; share: number }[];  // share 合计 = 1
  climate?: SpriteZone;                    // 2.26.0：锁定气候带；缺省按纬度渐变
  namePools?: Partial<Record<TerrainKind, string[]>>;     // 覆盖默认地名池
  seed?: number;                           // 缺省由生成器注入
}
```

首版占位 3 个：十万大山（mountain 0.55 / forest 0.30 / river 0.10 / landmark 0.05）、
南疆沼泽（swamp 0.50 / jungle 0.30 / river 0.15 / settlement 0.05）、
万里雪原（snowfield 0.60 / mountain 0.25 / tundra 0.15，**`climate: "snow"`**）。

- 生成器（B3）的职责边界：**预设只回答「铺什么地形、占多少」，怎么摊到画布上
  是 B3 生成算法的事**（区块 schema 复用现有 regionSchema + LOD 体系）。
  布点骨架（格网边长反解 / 区域生长 / 丛簇 / 分带 / z 序）见
  `docs/review/map-vs-reference-render-analysis.md` §6 与 `domain/generator.ts` 头注。
- 热门地图 ≠ 新代码路径：它只是「预设驱动的批量 pickTerrainSprites +
  落位」，与用户手点素材面板共用同一套 SpriteDef。

---

## 八、AI 接口封装（预留设计）

遵守 AI 域既有纪律（prompt 唯一产地 `src/shared/ai/context/prompt/`、intent 登记、
`ai_event` 埋点、`logAlways` 日志口径），地图域只定义**接口与降级**，不碰管线：

```ts
/** domain/map-ai-advisor.ts —— 地图域面向 AI 的唯一出口 */
export interface MapAiAdvisor {
  /** 按作品上下文（题材/世界观摘要）推荐地形配方 */
  suggestTerrainMix(ctx: { genre?: string; brief?: string }): Promise<MapPresetDef["terrainMix"]>;
  /** 按地形批量起名（复用 naming 管线的意图标签） */
  suggestNames(terrain: TerrainKind, count: number): Promise<string[]>;
}
```

- **两个实现**：`LocalMapAdvisor`（查 TERRAIN_META 默认池 + 预设表，纯本地，
  首版即有）与 `AiMapAdvisor`（接现有 AI provider，后续批次）；
- **降级铁律**：生成器主流程只依赖 `MapAiAdvisor` 接口；AI 未配置 / 调用失败 /
  低置信时静默落到 Local 实现 —— 降级给的是「可用配方」，不是报错弹窗；
- AI 返回的 terrainMix **必须收敛到 TerrainKind 枚举内**（枚举外取值丢弃并记日志），
  防止模型造词穿透类型系统。

---

## 九、模块划分与依赖方向

```text
domain/terrain.ts ─→ domain/terrain-assets.ts ─→ B3 生成器 ─→ MapCanvas
      ↑                    ↑                        ↑
sprites.ts（本地池）   map-assets IPC（导入池）   mapPresets.ts / MapAiAdvisor
```

依赖铁律：
1. `domain/` 不 import 任何组件、hooks、PIXI —— 纯函数层，vitest 直测；
2. 生成器只经 `pickTerrainSprites` 取料，**禁止**直接摸 `SPRITES` 常量
   （否则导入素材永远进不了生成池 —— 守卫测试钉住这条）；
3. `sprites.ts` 保持「登记表」职责：只加元数据字段，不吸收选材逻辑。

---

## 十、分阶段落地

| 阶段 | 内容 | 对应批次 |
|------|------|----------|
| S1（**已落地 2.25.0**） | `domain/terrain.ts`（TerrainKind 20 项 + TERRAIN_META + isTerrainKind 收敛口）+ 53 张 terrains/weight 标注 + `domain/terrain-assets.ts` 引擎（pickTerrainSprites：seed 确定性 / 加权不放回 / exclude / 回退链补位——语义为主地形优先、不足按链补满）+ `domain/mapPresets.ts`（3 预设 + expandTerrainMix 最大余数法）+ 守卫测试（terrains 非空 / id 唯一 / 回退链无环可达 / 预设 share=1 / 真实池冒烟） | R-MAP-21 前置 |
| B3（**已落地 2.25.0**） | `domain/generator.ts`（三子流确定性引擎：分区配方成片布点 / 核心盒碰撞允许层叠 / 地名三档名池）+ `MapGeneratorModal`（预设/丰度/成图-骨架/含地名/划分区块）+ 五档重掷 + 结果摘要 + 底图选择器（`doc.baseImageId` 进撤销栈） | R-MAP-21 |
| S2 | 导入三通道（import/list/delete）+ 标注弹层 + 「我的素材」分组 | 独立批次，S1 后任意时点 |
| S3 | 热门地图预设扩容 + 预设选择 UI | B3 之后的迭代 |
| S4 | AiMapAdvisor 接线（suggestTerrainMix / suggestNames） | AI 排期，对齐 R-AI 批次纪律 |

**风险与对策**：
- 45 张标注口径漂移 → 标注规则写进 MANIFEST（terrain 标注原则一节），review 时按表抽查；
- 地形枚举膨胀 → 新地形必须「有 ≥1 张素材 + 有回退链」才准入枚举，防空转枚举；
- 导入素材体积失控 → 单张 4MB 上限 + 库总量提示（后续可加配额）。

---

## 十一、待拍板

1. 地形枚举首版 20 个是否合适（取舍点：valley/volcano/tundra 是否首版就要）；
2. 用户素材与本地素材「同权重同池」是否符合预期，还是用户素材该有加权；
3. S2（导入）排期位置：随 B3 顺带做，还是 B3 交付后独立一批。

---

## 十二、新地形素材扩展接入 SOP（预留缺口的兑现方式）

> 回答一个问题：**后续任何时候新增一批某地形的素材（项目自建或用户导入），
> 如何零改造成本地融入管理体系与生成体系。**
> 2.22.2 补缺批（沼泽/草原/雪原 8 张）就是本 SOP 的首个示范案例：
> 只动了「放文件 + 登记表 + MANIFEST」三处，选材引擎、面板分组、生成器
> 一行未改即自动吃到新素材。

### 12.1 项目自建素材：四步接入

```text
① 放文件    assets/sprites/<id>.png（透明底、长边 640 归一、走 B2 后处理管线）
② 登记      sprites.ts：import + SPRITES 追加一条 SpriteDef
              - id 稳定且不与存量冲突（存档存 id，改图不改 id）
              - category：用现有 9 档；确需新档 → SPRITE_CATEGORIES 追加一行
              - terrains（S1 起必填）：多标签，决定进哪些地形配方
              - weight 可选：该素材在地形配方里的出现倾向
③ 新地形（可选）  若是全新地形：TerrainKind 枚举加一项 + TERRAIN_META
              补中文名 / 默认地名池 / 回退链。准入条件（§十风险条）：
              「本批 ≥1 张素材挂上该 terrains + 回退链可达已有地形」
④ 记录      MANIFEST.json items 追加一条（file / subject / batch）
```

到此**即插即用**：`pickTerrainSprites` 按 `terrains` 过滤选材（它不认识任何
具体素材 id），素材面板按 `SPRITE_CATEGORIES` 自动分组——两条消费路径都
不需要感知「这批素材存在过」。

### 12.2 用户导入素材（S2 落地后）：同构汇合

用户素材走 `map_assets`（`doc_id=NULL`）+ `meta_json` 标注（terrains 多选必填、
category、weight），主进程 IPC 并池后归一成同一个 `SpriteSource` 形状：

```text
两条路径 ── sprites.ts（打包池，构建期）──┐
                                        ├─→ 合并 SpriteSource 池 → pickTerrainSprites
        ── map_assets（导入池，运行期）──┘
```

「完美融入」的**结构性保证**：生成器与引擎只认 `SpriteSource.terrains`，
不认素材来源——导入素材标注了 `swamp` 就自动出现在沼泽配方里，与本地
素材同权重参与随机，无任何特判分支。

### 12.3 回归保障（S1 落地时钉住）

- 守卫测试：`SPRITES` 每条 `terrains` 非空（漏标注 = 进不了任何配方 = 静默失效，
  必须在测试层炸出来而不是等生成时发现）；
- 守卫测试：`TERRAIN_META` 每个枚举项都有回退链终点（防「有枚举无素材也无回退」
  的空转地形）；
- 新批次自检：`pickTerrainSprites(pool, 新地形)` 能抽到本批素材（一行 vitest 断言）。
