# Changelog · 2.25.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

## [2.25.0] - 2026-11-04

> 地图编辑器 **B3：一键成图生成器**（R-MAP-21）及其前置地基
> **S1：地形素材体系**（架构见
> `docs/prd/prd-map-render/map-asset-system-architecture.md`）。
> 核心心智：**地形不是一个「地形图」，而是一份「素材配方」**——
> 沼泽 = 芦苇 + 水草 + 浅滩 + 枯木交叉渲染。

### Added

- **一键成图**（工具栏新入口）：弹层选热门地图配方（十万大山 / 南疆沼泽 /
  万里雪原）+ 丰度（稀疏/标准/繁密）+ 档位（**成图**为默认 / 骨架）+
  含地名 / 划分区块开关，一次生成「陆地 + 素材 + 地名（+ 区块）」，
  全部落为可编辑对象（选中 / 拖动 / 改四件套 / 删除），单 commit 可撤销。
- **五档重掷**（review §5.3 铁律 3）：`换一张 / 只换陆地 / 只换素材 /
  只换地名 / 只换分区` 就地按钮。确定性引擎（domain/generator.ts）三条
  mulberry32 子流各管一层，局部重掷互不惊动；同 seed 同参数可复现。
- **结果摘要**：`已生成：陆地 N 块 · 山岳 X · 林木 Y · … · 地名 K（seed S）`
  就地展示，密度按碰撞自适应（目标数是上限，实际如实统计）。
- **底图家族选择器**：「更多」面板新增底图档（深海青绿 / 蔚蓝晴海 /
  古卷羊皮 / 玄夜墨海，2.22.1 的 4 张 AI 底图），切换即时生效且进撤销栈。
- **S1 地形语义层**（`domain/`）：`TerrainKind` 20 项枚举 +
  `TERRAIN_META`（中文名 / 地名池 / 回退链）+ `isTerrainKind` 收敛口
  （将来 AI 返回值唯一闸门）；53 张素材全量标注 `terrains` 多标签 +
  可选 `weight`。
- **选材引擎**（`domain/terrain-assets.ts`）：`pickTerrainSprites` 主地形
  优先、回退链补位、加权不放回；素材池由调用方注入（生成器禁直接摸
  SPRITES——导入素材 S2 归一后天然进配方）。
- **热门地图预设骨架**（`domain/mapPresets.ts`）：`terrainMix` 配比 +
  `expandTerrainMix` 最大余数法精确换算。
- 纯函数单测 19 条（`domain/generator.test.ts`：确定性 / 布点合法性 /
  地名查重 / 摘要）+ 集成 3 条（生成落库 / 五档语义 / 首次确认）。

### Changed

- `store/useMapDocStore`：新增 `applyGenerated`（生成产物单 commit）、
  `relabelElements`（批量重排联动地名）、`setBaseImage`；
  `DocSnapshot` 扩容 `baseImageId`（换底图可撤销）。
- `useMapEditor.buildRegions` 增 `seedOverride`（「只换分区」档换种子重切）。
- 纹理缓存预载 4 张底图家族（换底图零等待）；`MapCanvas` 底图按
  `doc.baseImageId` 取纹理（未登记 id 回落默认海面，不白屏）。

### Notes

- **布点允许层叠**：手绘地图的山脉/森林本来就是层叠着画的，碰撞只拦
  「核心盒深叠」（55% 收缩）——完全不重叠会让 120 个目标物理上放不下。
- **只有自带名池的点要素被点名**（城郭/港渡/遗迹，与手动落位同规则）；
  纯地貌不吃预设池点名，防一张图冒出几十个山名。
- 已知取舍（v1）：「只换陆地」保留素材原位，个别素材可能落到新海面上，
  文案已提示手动挪回；河流折线依赖 B4 折线能力，本批不含。
