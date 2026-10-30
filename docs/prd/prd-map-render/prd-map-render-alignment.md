# PRD：地图渲染观感对齐改造（R-MAP-16 ~ R-MAP-20）

---

**文档负责人：** 前端 / 地图模块
**状态：** 草稿（待评审）
**版本：** 0.2（自包含版：不依赖外部截图与外部链接，可单独作为实施依据）
**基线代码分支：** `origin/map2`（提交 `64b2d23`）
**参考实现：** makeamap 地图编辑器（机制摘录见 §11 附录 A，原文已不必再查）

**相关文档：**

- 项目架构与开发规范：`AGENTS.md`
- 地图产品需求（v1 首版，在 `origin/map2` 分支的 `docs/novel-map-prd.md`）
- 文档索引：`docs/README.md`

> **与 v1 PRD 的关系**：v1 PRD 定义的 R-MAP-01 ~ R-MAP-15 以「地点标记 / 连线 / 导出」为主线，
> 而 `origin/map2` 的实际实现走的是另一条路（层级行政区划 + LOD 无极缩放 + 地形素材），
> 两者已脱节。本文**只覆盖渲染观感**，编号从 **R-MAP-16** 起，不复用 01~15；
> v1 PRD 中尚未实现的标记 / 连线不在本文范围，也不因本文而作废。

---

## 0. 阅读指引

本文面向**没有见过参考产品、也打不开对比截图**的实施者，因此：

- **§2「目标画面」用文字重建成品长什么样** —— 先读它，建立画面预期；后面所有参数都是为了得到那张图。
- **§4「视觉规范」是参数表** —— 数值可直接抄进代码，不要自己调；每条都写了"为什么是这个值"和"偏了会怎样"。
- **§5「改造思路」讲取舍** —— 为什么这样改、为什么不那样改，避免接手后推翻重来。
- **§6「需求与实现」是施工图** —— 每条需求含数据结构、实现步骤、伪代码、易错点、测试点。
- **§7「实施手册」按文件列改动清单** —— 照着做即可，顺序不能乱。
- **§8「验收与自检」** —— 关键：里面写了「看不到参考图时，怎么判断自己做对了」。

术语与单位统一在 §12，遇到「世界单位」「屏幕像素」分不清时先看那一节。

---

## 1. 执行摘要

**问题一句话：** `map2` 的渲染引擎不弱，但画面读起来像「行政区划专题图」，不像「手绘世界地图」——
差距不在渲染技术，而在**画面构成**。

**要做的事：** 在不推翻现有「Pixi v8 场景图 + 帽函数 LOD + 屏幕恒定线宽」骨架的前提下，
补齐三件决定观感的构成要素，并对既有图层做降权：

1. **陆地 / 海洋二分** —— 一张海面纹理之上浮一块有机形状的陆地，带海岸白边、外发光、浅海大陆架（R-MAP-16）
2. **标注文字层** —— 地名压在素材与图形之上，白描边、无底框（R-MAP-18）
3. **色调统一** —— 区块从七彩降为同色系淡彩，并给三档全局风格预设（R-MAP-17 / R-MAP-19）

**一句话验收标准：** 一个没看过设计稿的人，看到成品第一反应应该是「这是一张手绘的世界地图」，
而不是「这是一张按省份上色的统计图」。

**明确不做：** 不做 WebGL 之外的渲染后端、不做真实地理投影、不做逐像素拾取、不做画笔笔刷体系（见 §10）。

---

## 2. 目标画面（用文字重建成品）

本节是全篇的锚。后面所有参数，都是为了得到这里描述的画面。
若实施中某处拿不准，回到本节对照：**这个改动让画面更接近这段描述，还是更远。**

### 2.1 整张图（适应窗口，缩放约 0.8）

想象一张方形的纸铺在桌面上，纸比窗口小一圈，四周留白，纸下面有一层极淡的投影，
让人读得出「这是一张纸，不是一块屏幕」。

纸的底色是**深墨绿色**（`#2C4640` 附近），带细微的斑驳肌理 —— 这是**海**。
放大看能看到石材/水纹一样的颗粒，不是纯色块。

纸上浮着**一块不规则的陆地**，米黄色（`#C8BD9D`），占纸面的一半多一点，
形状是圆润的有机曲线（像被海水侵蚀过的海岸），不是多边形的折线感。
它偏在画面中央或略偏左下，四周围着海。

陆地边缘有三道东西，从内到外：

1. 一条 **2.4 世界单位的白线**（`#F6F0E0`），很亮、很连续 —— 这是整张图最"锐"的元素，
   像钢笔沿地图勾的一圈岸线。**它断不断，决定这张图成不成立。**
2. 白线外侧一圈**淡光晕**（白，宽 10，模糊 6），让陆地边缘微微发亮。
3. 再外侧一圈**比海略亮的浅绿带**（`#2F4A3C`，宽 28，模糊 12，透明度 0.35）—— 浅海大陆架。
   这一带是海陆之间的过渡，没有它，陆地会像一张剪贴画直接盖在海面上。

陆地上散着山与树，都是 PNG 素材，脚底对齐地面。山有大小，近处的山比远处的山大 ——
但这不是透视，是因为它们属于不同的图层（层级）。

图上还有**几十条地名**：宋体，深墨绿（`#1B1F1C`），每个字外面包 3 像素米白描边，
所以压在深绿的山林上也读得清，不用加半透明底框。字号分三档，大的给大陆/洲，小的给郡。

陆地内部还有**一条条极淡的分界线**（1.2 屏幕像素，深绿，透明度 0.32），
把陆地切成若干区块；区块本身填的是**同色系淡彩**（透明度 0.10），
所以看起来几乎不显色 —— 只有分界线在提示"这一片属于哪一块"。
**这一层必须"退到背景里去"，它一旦显眼，整张图就变回专题图。**

### 2.2 三个缩放级别的观感

| 缩放 | 看到什么 | 此时画面成立的判据 |
|---|---|---|
| 远（整纸入画，`scale ≈ 0.8`） | 一大块陆地的完整轮廓，海面占比大；只有"大陆 / 洲"级分界若隐若现；只有大字号地名；山缩成小色点 | 一眼能说出"这是一块大陆，四周是海" |
| 中（`scale ≈ 1.5`） | 陆地充满视野，海岸线在画面边缘；"国家"级分界清晰；山与树可辨；中号地名出现 | 能看出陆地内部有分区，但分区不抢地貌 |
| 近（`scale ≈ 3~4`） | 只看得到某一个郡；海岸线仍然**锐利**（不糊）；素材细节完整；文字依旧清爽 | 海岸白边不出现"锯齿/发虚"，文字不变胖不变糊 |

**近处不糊是本项目对参考实现的一处有意超越**：参考实现的海岸线是位图，
放大到 2 倍以上会明显发虚（它自己也承认"放大后是插值模糊"，只能靠用户手动开"高清增强"重绘）。
我们用烘焙纹理 + `resolution` 分级重建，近处依然锐利（机制见 §6.1.4）。这条不要为了"跟它一样"而退化。

### 2.3 改造前后逐层对照

同一份数据（同一次"生成区块 + 摆素材"），改造前后看到的差别：

| 画面元素 | 改造前 | 改造后 |
|---|---|---|
| 背景 | 深绿底图整铺，像一块桌布 | 深绿海面 + 纹理九宫格拉伸，像海 |
| 陆地 | **没有这个层次**，区块直接铺满整纸 | 米黄陆地，有机轮廓，三件套海岸 |
| 区块 | 每块颜色不同（黄金角撒色），透明度 0.32，**是画面主体** | 同色系淡彩，透明度 0.10，**退成背景** |
| 区块边界 | 1.6px，透明度 0.6，抢眼 | 1.2px，透明度 0.32，只做提示 |
| 素材 | 有，但直接压在色块上，像贴纸 | 有，落在陆地上，像地形 |
| 文字 | **没有** | 几十条地名，白描边，压在最上层 |
| 整体观感 | 统计图 / 分类图册 | 手绘世界地图 |

### 2.4 为什么学它、学哪些、不学哪些

参考实现（makeamap）是一套 Canvas 2D 的绘图软件，把整张地图当一张 A4 画布来画。
值得学的**只有三件事**，都是"画面构成"层面的：

1. **海陆二分 + 海岸三件套**（白边 / 外发光 / 浅海带）—— 这是它观感成立的根因。
2. **文字压顶 + 白描边无底框** —— 古地图的信息密度几乎全靠地名。
3. **整层色调统一**（用 `hue-rotate/saturate/brightness` 换风格，而不是逐要素重配色）。

**不学**的是它的渲染机制：整页位图缓存 + 缩放时切"高清重绘"两档，本质是 Canvas 2D 的性能妥协
（低倍用缓存换帧率，代价是放大糊）。我们的 Pixi 场景图 + LOD 权重 + 屏幕恒定线宽已经更好，
照搬反而退化。唯一借用的是它的"脏标记"思想 —— 用在**海岸层的烘焙**上（见 §6.1.4）。

它还有两处「便宜但有效」的手法，我们以更可控的方式复刻：

- 它的陆地是**低分辨率位图放大**，所以边缘天生柔 —— 我们用 `BlurFilter(1.6)` 在烘焙期做一次，效果等价。
- 它的底图是 **2000×2000 拉伸 + 四边 30px 九宫格保护** —— 我们用 `NineSliceSprite` 做同一件事。

---

## 3. 现状诊断

### 3.1 现有渲染栈

`MapCanvas/index.tsx:327`：

```
stage
└ world（承载 viewport 的 position + scale，视口变化只改这两个值）
   ├ sheetShadow   Graphics    纸张投影（10 圈矩形叠加，SHEET_SHADOW）
   ├ baseSprite    Sprite      底图 1024×1024（基底1.jpg，深墨绿纹理）
   ├ regionLayer   Container   区块层：按层级分容器 → 每级 填充 Graphics + 边界 Graphics
   ├ elementLayer  Container   地形素材：按层级分容器，容器 alpha 跟 LOD 权重
   └ overlay       Graphics    选中框
```

### 3.2 数据流（改造前）

```
MapEditorPage（UI 编排）
   └ useMapEditor（唯一状态源）
       ├ doc: { version, regions: MapRegion[], elements: MapElement[] }
       ├ viewport: { x, y, scale }            ← 唯一事实源（coords.ts）
       ├ levelAlphas: number[]                ← lod.ts 帽函数算出，和恒为 1
       ├ history: DocSnapshot[]（上限 50）
       └ useTextureCache → TextureMap（6 张 PNG/JPG）
              ↓ props
        MapCanvas（纯消费，不持有业务状态）
              ↓ 事件
        世界坐标 / 像素位移 → 回传 useMapEditor
```

三个关键契约（改造中不得破坏）：

1. **`levelAlphas` 由上层算、画布只消费**（`MapCanvas` props 注释写明）：工具栏的层级指示与画面
   必须用同一份权重，两边各算一次必然显示不一致。
2. **`screen↔world` 换算只允许出现在 `coords.ts`**：画布点击回传的是世界坐标，上层不得二次换算
   （历史上双重换算导致过"落点偏离光标、缩放越小偏得越狠"）。
3. **视口变化不触碰元素**：`world` 改变换，素材精灵的世界坐标不动。这是 2000+ 元素时帧率的底线。

### 3.3 已经优于参考实现的三处，改造中不得回退

| 机制 | 位置 | 为什么不能丢 |
|---|---|---|
| LOD 帽函数（权重和恒为 1） | `lod.ts:129` | 参考实现只有「缓存 / 直绘」两档硬切换；我们是连续过渡，缩放时边界自然长出/融掉 |
| 屏幕恒定线宽 + 量化档 | `MapCanvas:101` `BORDER_WIDTH_QUANTIZE = 1.06` | 参考实现每帧按 `width/scale` 重算并重建几何；我们把缩放吸附到 1.06 幂次档，重建频率降到 1/十几 |
| 素材按层级容器分组、改容器 alpha | `MapCanvas:601` | 滚轮每格只写几个浮点数，不遍历 2000 个精灵 |

### 3.4 观感差距清单（按贡献排序）

| # | 差距 | 参考实现的做法 | 现状与代码位置 |
|---|---|---|---|
| 1 | **无陆地 / 海洋二分** | 海面纹理 + 陆地画笔位图 + 海洋修饰层（PaintCover id 9999：海岸浪花 / 浅海光晕）+ 浅海大陆架 | 完全缺失，无图层也无数据 |
| 2 | **无文字层** | `TEXT ×98` 压在图层栈最顶；样式 16 个字段（`font:黑体`、`border_size:4` 白描边、`shadow:4`、`bg_alpha:0`） | `types.ts` 无标注类型，画布无 Text |
| 3 | **区块色相黄金角随机** | 国界只是细线，色块几乎不可见 | `regions.ts:1008` `i * 137.508` 撒色，`REGION_FILL_ALPHA 0.32` |
| 4 | **底图整铺无九宫格** | 2000×2000 非等比拉伸至 3234×2306，四边 30px 保护 | `BASE_IMAGE` 1024 直接按 `width/height` 铺满，实为拉伸 |
| 5 | **无全局风格** | 整层 `ctx.filter = hue-rotate() saturate() brightness()`，三档风格 | 无 |
| 6 | **无静态层烘焙** | 整页离屏 canvas + 两个脏标记，每帧一次 `drawImage` | 静态几何每帧重新提交 |
| 7 | **无视口剔除** | 变换后 AABB 与画布 + 64px 余量求交 | 同层 160 块郡级区块全画 |
| 8 | **无导出** | 高倍重绘 + 分块 + 超分 | 无（v1 PRD 有 R-MAP-09，`map2` 未实现） |

> 注：`useMapEditor.ts` 目前是**纯内存态**（`useState` + 撤销栈），没有 IPC、没有落库。
> 本文不引入持久化，但所有新增字段都进 `MapDocument`，为后续落库留位（见 §6.5）。

---

## 4. 视觉规范（参数唯一出处）

本节数值**直接抄进代码**。反驳某个值之前，先读它的"为什么"与"偏了会怎样"。

### 4.1 图层栈（z 序，从下到上）

| z | 图层 | 实现手段 | 更新时机 | 是否烘焙 |
|---|---|---|---|---|
| 0 | `paperShadow` | Graphics（沿用 `SHEET_SHADOW`） | 仅初始化 | 否 |
| 1 | `sea` | `NineSliceSprite`（海面纹理，四边 32 不拉伸） | 换图 / 加载完成 | 否 |
| 2 | `shelf` | 陆地路径 stroke + 模糊 | 陆地 / 风格变化 | **是** |
| 3 | `coastGlow` | 陆地路径 stroke 白 + 模糊 | 同上 | **是** |
| 4 | `landFill` | 陆地路径 + 纹理填充 + 轻模糊 | 同上 | **是** |
| 5 | `landStroke` | 陆地路径 stroke 白，实心 | 同上 | **是** |
| 6 | `regionLayer` | 现有分层容器（填充 + 边界） | 现有逻辑不变 | 否 |
| 7 | `elementLayer` | 现有分层容器 | 现有逻辑不变 | 否 |
| 8 | `labelLayer` | `Text`，按层级容器分组 | 标注 / 层级数 / 视口缩放 | 否 |
| 9 | `overlay` | Graphics（选中框） | 选中变化 | 否 |

**排序理由（每条都不是随手放的）：**

- 海岸四层必须在区块之下：区块是"地表的划分"，要能透出陆地材质；反过来盖住就成了色块图。
- 素材在区块之上：山是"长在地表上的东西"，不能被分区线切断。
- 文字在最上：任何缩放、任何地形都要读得到地名。
- `paperShadow` 在最下：它撑的是"这是纸"的心理暗示，被陆地盖住才是对的。

### 4.2 两个口径，不能混

| 类别 | 口径 | 例子 | 换算 |
|---|---|---|---|
| 地物（海岸、浅海带、陆地模糊） | **世界单位**，随缩放一起变 | 海岸白边 2.4 | 直接写 |
| 结构性线条（区块界、选中框） | **屏幕像素**，任何缩放下粗细一致 | 区块界 1.2px | `width = px / scale` |
| 文字字号 | 屏幕恒定（视觉字号不随缩放变） | 12 | `text.scale = 1 / viewport.scale` |

参考实现的海岸白边是 3~5 纸面像素（纸宽 3174），换算到 1024 基准约 1~1.6。
**我们取 2.4，比换算值粗一档** —— 因为它的陆地边缘是柔的位图，我们的线条是硬边，
不补偿一档，缩远就看不见了。这是有意偏离，不是笔误。

### 4.3 配色与海岸参数

| 项 | 值 | 为什么 |
|---|---|---|
| 海面底色 | 沿用 `基底1.jpg`（`#2C4640` 附近墨绿） | 不换图，只换铺设方式（省一张资源，观感也够） |
| 陆地填色 | `#C8BD9D`，叠纹理 `multiply` 0.35 | 米黄纸色；与深绿海面对比足够，且接近羊皮纸，天然"古地图" |
| 海岸白边 | `#F6F0E0`，alpha 0.92，width **2.4** | 整图最亮最锐的线；它是"陆地成立"的唯一依据 |
| 海岸外发光 | `#F2EAD6`，width **10**，blur **6**，alpha **0.5** | 让陆地"浮"在海面上，而不是"贴"上去 |
| 浅海大陆架 | `#2F4A3C`（比海亮一档），width **28**，blur **12**，alpha **0.35** | 海陆过渡带；没有它，海岸线像剪贴边缘 |
| 区块填充 | 同色系，alpha **0.10** | 从 0.32 降下来；再高就变专题图 |
| 区块边界 | `#2B3A31`，**1.2px**，alpha **0.32** | 从 1.6px / 0.6 降下来；只做提示 |
| 文字 | `#1B1F1C`，白描边 `#F6F0E0` 3px，无底框 | 对齐参考实现的 `border_size:4` + `bg_alpha:0` |
| 纸张投影 | 沿用 `SHEET_SHADOW`（10 圈叠加，最内侧约 0.36） | 已验证，不动 |

**区块色相规则（R-MAP-17 的核心）**：

- 同一 level-0（大陆）的全部子孙共享色相基准，逐级只做微调：`hueSpread` 由 8 降到 **3**。
- 饱和度 **0.10 ~ 0.16**（现在 0.30 ~ 0.50），亮度 **0.62 ± 0.04**（现在 0.56 ~ 0.70）。
- 语义目标：**"同一片国土上的淡彩分区"**，不是"相邻两国颜色互斥"。
  判断标准：缩到洲级看，相邻两块的颜色差应该小到"要盯着看才发现不一样"。

### 4.4 文字基线

| 属性 | 值 | 说明 |
|---|---|---|
| 字体 | `"Songti SC", "Noto Serif SC", serif` | 宋体更贴古地图；黑体留给"墨色"风格预设 |
| 字号档 | 10 / 12 / 16（世界单位） | 小 / 中 / 大；手动选，不按层级自动绑 |
| 描边 | 3px `#F6F0E0` | `TextStyle.stroke = { color, width: 3 }` |
| 定位 | 锚点居中；默认在所属素材上方 8 世界单位 | 对应参考实现的 `name_link` |
| 层级 | 与所属层级同权重淡入淡出；未归属层级者恒 1 | 复用 `elementWeight()`，不要另写一套 |
| 分辨率 | `Text.resolution = devicePixelRatio`（上限 2） | 否则高分屏文字发虚 |
| 上限 | 单图 300 条 | 超过只渲染主层级内前 300 条 + 视口剔除 |

### 4.5 三档风格预设

| 预设 | 实现 | 观感 | 用在哪 |
|---|---|---|---|
| 原色（默认） | 无滤镜 | 当前配色，深绿海 + 米黄陆 | 日常编辑 |
| 羊皮纸 | 自定义 `ColorMatrixFilter` 矩阵：去饱和 0.55 + 暖偏 + 提亮 0.04 | 泛黄的旧地图 | 导出给读者 |
| 墨色 | `saturate(0.15)` + `brightness(0.95)` | 单色雕版/木刻 | 严肃向作品 |

**挂载点纪律：滤镜挂在 `sea` 之外的静态烘焙层 + `regionLayer` + `elementLayer` 上，
绝对不挂 `world`。** 挂 `world` 会把 `overlay` 的选中框一起染色（蓝色选中框变灰），
用户会以为"选中态坏了"。

---

## 5. 改造总体思路

### 5.1 三条不改的底线

1. **`MapCanvas` 的对外契约不变**（props / 事件签名），因此 `useMapEditor` 与页面组件几乎不用改。
   新增能力只加可选 props（`land`、`labels`、`style`），缺省值保证老用法照常渲染。
2. **坐标换算只在 `coords.ts`**。新增的海岸、标注都吃世界坐标，不引入第二套几何。
3. **视口变化只改 `world` 的两个值**。任何"每帧遍历全部要素"的写法都是回退，不做。

### 5.2 为什么要"烘焙"，而不是每帧加滤镜

这是本次改造最容易走错的一步，先说清：

参考实现的整页缓存（离屏 canvas + 脏标记）在 WebGL 下的等价物，不是 `cacheAsTexture` 一把梭，
而是**把"只随内容变、不随视口变"的图层合并渲染进一张 `RenderTexture`**，之后每帧只画这张纹理。

海岸四层（shelf / glow / landFill / landStroke）正好符合"只随内容变"：

- 它们依赖陆地几何与风格，**不依赖 viewport**。
- 它们需要 `BlurFilter`，而滤镜会强制离屏渲染 —— 若挂在每帧重绘的容器上，
  等于每帧做 3 次高斯模糊，600 区块的场景直接掉到个位数帧率。
- 烘焙一次（约 80~120ms），之后滚轮缩放零成本。

**判定规则（写进代码注释）**：一个图层如果要满足"随 viewport 重绘 + 带 filter"，就说明它该被烘焙，
或者它根本不该带 filter。本次改造后者只有一处例外：文字描边用 `TextStyle.stroke`，不是滤镜。

### 5.3 为什么要独立生成陆地，而不是复用最粗一级区块

考虑过三条路，记下结论免得后人重走：

| 方案 | 问题 |
|---|---|
| 复用 level-0 区块并集当陆地 | level-0 区块**铺满整张纸**，没有外轮廓。描出来的白边会贴着纸边，做不出海岸 |
| 加画笔涂抹 | 观感上限最高，但要新增笔刷系统 + 笔迹持久化 + 撤销粒度，成本是生成器的三倍以上 |
| **独立生成器（选定）** | 陆地是陆地、行政区是行政区，两者解耦；确定性种子可复现；成本可控 |

代价要认：**区块树必须改成"在陆地多边形内切分"**，否则陆地上的区块会跑到海里。
这是 B1 里唯一有回归风险的一步，处置见 §6.1.3。

### 5.4 批次依赖

```
B1 陆地与海岸 ──┬── B2 区块降级（必须跟在 B1 后，两者合起来才是完整观感）
                ├── B4 风格预设（依赖烘焙层存在）
                └── B5 剔除 / 缓存 / 导出（依赖陆地包围盒）
B3 文字层（只依赖 types 变更，可与 B2/B4 并行）
```

**交付顺序建议**：B1 单独出截图对比 → B2 紧跟 → B3 / B4 并行 → B5 收尾。
B1 结束前不要动 B2 的参数，否则分不清"观感变化是陆地带来的还是降权带来的"。

### 5.5 数据流（改造后）

```
useMapEditor
  ├ doc.land     ← generateLand(seed)（新增，纯函数）
  ├ doc.labels   ← 素材联动 / 手动放置（新增）
  ├ doc.style    ← 三档枚举（新增）
  ├ viewport / levelAlphas / regions / elements（不变）
  └ 新增派生：bakeKey = hash(land, style)   ← 烘焙脏标记的唯一依据
        ↓
MapCanvas
  ├ 烘焙 effect：bakeKey 变化 → 重建海岸 RenderTexture（约 100ms）
  ├ 视口 effect：只改 world.position / world.scale
  ├ 标注 effect：viewport.scale 变化 → 改每个 Text 的 scale（1/scale）
  └ 其余 effect 不变
```

注意 `bakeKey` 是**内容哈希**而不是布尔脏标记：用布尔标记容易漏置位
（参考实现就吃过这个亏，要维护 `refresh_baselayer` 和 `refresh_baselayer_once` 两个标记，
业务侧 6 处手动置位）。哈希比较天然幂等，改完不用记得"置脏"。

---

## 6. 需求与实现

### 6.1 R-MAP-16 陆地与海岸线（P0）

**目标**：让地图有「一块陆地浮在海上」的成立感。这是本次改造唯一"从无到有"的图层，也是观感的地基。

#### 6.1.1 数据结构

```ts
// MapEditorPage/types.ts
export interface Point { x: number; y: number }

export interface MapLand {
  /** 生成种子，用于复现同一形状 */
  seed: number;
  /** 一个或多个岛，每个是闭合多边形（首尾不重复存），世界坐标 */
  polygons: Point[][];
  /** 生成时的世界矩形，用于烘焙时算纹理原点 */
  bounds: { x: number; y: number; width: number; height: number };
}
```

`MapLand` 存进 `doc.land`（见 §6.5）。**只存多边形，不存位图** —— 位图是派生物，
换风格/换分辨率都要重画，存了反而成为负担。

#### 6.1.2 形状算法（新增 `MapEditorPage/land.ts`，纯函数）

复用 `regions.ts` 已有的 `createRng`（:234）、`valueNoise`（:265）、`fbm`（:285），**不重复实现噪声**。

```
generateLand({ seed, bounds, islands? }):
  rng = createRng(seed)
  n = islands ?? (1 + floor(rng() * 3))          // 1~3 块
  按面积权重分配各岛半径 R_i（总面积占纸面 55%~70%）
  for each 岛:
    圆心 = 抖动网格撒点，保证彼此距离 > r1 + r2 + 24（24 = 两圈海岸的最大外扩）
    取 N = 64 个方向角 θ_k：
       r(θ) = R * (0.72 + 0.28 * fbm(cos θ * f, sin θ * f, seed))   // f ≈ 1.6
       // 0.72 的下限保证形状不塌陷成细长条；0.28 的振幅保证"有机"但不"破碎"
    按 θ 递增采样成闭合多边形（64 点）
    若与已有的岛相交（包围盒 + 采样点判定）→ 缩小 8% 重试，最多 5 次
  抽稀：顶点 > 512 时用 Douglas–Peucker，容差 1.5 世界单位
  返回 { seed, polygons, bounds }
```

几条设计取舍：

- **为什么用极坐标半径扰动，而不是先撒点再做形态学**：前者一次成型、顶点数可控、
  且天然闭合无自交（θ 单调递增）；后者要额外做腐蚀/膨胀与去自交，成本不成比例。
- **`0.72` 与 `0.28` 的分工**：`0.72` 是"最窄处不能细过长条"的下限，`0.28` 是"海岸要有湾"的振幅。
  调大振幅会让形状碎裂成群岛，调小则变成圆形 —— 这两个值经手感确定，不要单独调其中一个。
- **为什么保留 `bounds`**：烘焙时要把世界坐标映射到纹理像素，需要知道纹理覆盖哪块世界区域。

#### 6.1.3 区块树改为在陆地内切分

`generateHierarchy()` 目前的根容器是矩形 `bounds`，`voronoiCellIn`（:404）用半平面裁剪求单元。
改法：

1. `GenerateHierarchyOptions` 增加可选 `container?: Point[]`（陆地多边形）。
2. `voronoiCellIn` 的初始 cell 由 `bounds` 的四个角改为 `container` 的顶点序列。
   半平面裁剪与初始多边形的顶点数无关，**函数体一行不用改**，只换入参。
3. `sampleSeeds`（:754）加一道"种子必须在 container 内"的过滤（已有 `pointInPolygon`，:423）。
4. **矩形路径必须保留**：`container` 缺省时走原逻辑，这样 `regions.test.ts`（631 行）不受影响；
   新路径单独加测。

**已知残余问题（沿用现有结论，不要试图在本次修掉）**：子块受噪声影响可能微越出父块
（实测 0.09% 自交 / 0.6% 越出，最大 3.2 世界单位）。修它要做真正的多边形求交，
成本与风险不成比例；在郡一级几乎不可见。

**多岛时的一个陷阱**：`regions.ts` 内部用模块级计数器生成区块 id（`nextId`）。多个岛分别调用
`generateHierarchy` 时必须共享同一个 `idPrefix`，否则 id 会重号 —— React key 冲突、
撤销栈错乱，而且**测试不一定报**。给 `GenerateHierarchyOptions` 加可选 `idPrefix`，
缺省保持现有行为（单次调用不受影响）。

#### 6.1.4 烘焙实现（本次技术含量最高的一段）

```ts
// MapCanvas 内新增
const BAKE_MARGIN = 64;          // 容纳浅海带 28 + 模糊 12 的外扩，留余量
const BAKE_MAX_SIDE = 4096;      // WebGL 纹理保守上限

function bakeCoast(renderer, land, style): Texture {
  const b = land.bounds;
  // 1) 纹理尺寸：世界矩形 + 两侧 margin，乘分辨率
  const res = Math.min(devicePixelRatio || 1, 2);
  const wWorld = b.width + BAKE_MARGIN * 2;
  const hWorld = b.height + BAKE_MARGIN * 2;
  let side = Math.max(wWorld, hWorld) * res;
  const k = side > BAKE_MAX_SIDE ? BAKE_MAX_SIDE / side : 1;   // 超限降采样
  const rt = RenderTexture.create({
    width: Math.round(wWorld * res * k),
    height: Math.round(hWorld * res * k),
    resolution: 1,                 // 尺寸已乘 res，避免重复放大
    antialias: true,
  });

  // 2) 装配四层：全部用世界坐标画，holder 负责把"世界原点"搬到纹理左上角
  const holder = new Container();
  holder.position.set(-(b.x - BAKE_MARGIN), -(b.y - BAKE_MARGIN));
  holder.scale.set(res * k);

  const shelf = new Graphics();
  drawLandPath(shelf, land.polygons);
  shelf.stroke({ width: 28, color: 0x2f4a3c, alpha: 0.35, alignment: 0.5 });
  shelf.filters = [new BlurFilter({ strength: 12, quality: 3 })];

  const glow = new Graphics();
  drawLandPath(glow, land.polygons);
  glow.stroke({ width: 10, color: 0xf2ead6, alpha: 0.5, alignment: 0.5 });
  glow.filters = [new BlurFilter({ strength: 6, quality: 3 })];

  const fill = new Graphics();
  drawLandPath(fill, land.polygons);
  fill.fill({ color: 0xc8bd9d });                       // 底色
  // 纹理叠加：用第二遍 fill + texture + multiply 不成立（Graphics 一次填充一种样式）
  // → 改用「底色 Graphics + 纹理 Sprite(mask=陆地路径)」两条子节点
  // paperTexture 的来源：直接用 textures[BASE_IMAGE.id]（已有资源，免新增），
  // 想更"纸"可以另加一张 512² 的纸纹 PNG，走 useTextureCache 同一条加载链路。
  const texSprite = new Sprite(paperTexture);
  texSprite.anchor.set(0);
  texSprite.position.set(b.x, b.y);
  texSprite.width = b.width;
  texSprite.height = b.height;
  const maskG = new Graphics();
  drawLandPath(maskG, land.polygons);
  texSprite.mask = maskG;
  texSprite.alpha = 0.35;
  texSprite.blendMode = "multiply";
  fill.filters = [new BlurFilter({ strength: 1.6, quality: 2 })];

  const stroke = new Graphics();
  drawLandPath(stroke, land.polygons);
  stroke.stroke({ width: 2.4, color: 0xf6f0e0, alpha: 0.92, alignment: 0.5 });

  holder.addChild(shelf, glow, fill, texSprite, maskG, stroke);
  renderer.render({ container: holder, target: rt, clear: true });
  holder.destroy({ children: true });                    // rt 已独立，holder 可弃
  return rt;
}
```

**五个坑，逐条记住：**

1. **`filters` 会扩大 bounds，但 `RenderTexture` 尺寸固定** → 边缘模糊被裁掉。
   所以 `BAKE_MARGIN` 必须 ≥ 最大模糊半径 × 3（这里 12×3=36 < 64，够用）。
2. **`resolution` 不要和尺寸重复放大**：若 `width` 已乘 `devicePixelRatio`，`resolution` 必须给 1，
   否则等于放大两次，显存翻四倍。
3. **坐标系要显式搬**：`renderer.render` 到 target 时**不应用** `world` 的视口变换，
   holder 必须自己承担「世界原点 → 纹理左上角」的平移。漏了这一步，海岸会跑到画布外面，
   表现为"烘焙有输出但画面上什么都没有"，且不报错。
4. **纹理填充不能一次 `fill` 搞定**：Pixi 的 `Graphics.fill()` 一次只接受一种样式，
   「底色 + 纹理」要拆成两个节点（底色 Graphics + 纹理 Sprite + `mask`），见上面代码。
5. **`holder.destroy()` 不能带 `texture: true`**：rt 是独立创建的，跟着销毁会连烘焙结果一起没。

**重建触发**（`bakeKey`）：

```
bakeKey = `${land.seed}|${land.polygons.length}|${style}|${res}|`
```
`land.polygons` 变化（重新生成）→ seed 或 length 变；只改顶点不改数量（比如未来支持编辑）
→ 需要额外带一个 `landVersion` 计数，或用 `polygons[0].length` 参与哈希。**本次用后者即可**。

#### 6.1.5 视觉降级与边界

| 场景 | 行为 |
|---|---|
| 未生成陆地（`doc.land === null`） | 跳过海岸四层，`sea` 照常铺满，画面 = 当前观感，不报错 |
| 陆地面积占比 < 25% 或 > 85% | 生成后提示「形状过于极端，可重新生成」，但不阻止 |
| 陆地多边形顶点 < 3 | 丢弃该环，不抛异常 |
| 烘焙尺寸超 4096 | 按 `k` 降采样并 `console.warn` 一条（不要静默） |
| 撤销「生成陆地」 | 整次生成记为一步，撤销后海岸四层随之消失（`bakeKey` 变回 null → 清空 RT） |

#### 6.1.6 测试点

```
land.test.ts
  · 同种子两次生成，多边形逐点相等（确定性）
  · 每个多边形首尾不重复、点数 ≥ 8、闭合
  · 无自交（相邻边不相交；用 O(n²) 朴素判定，n ≤ 512 可接受）
  · 面积占比落在 25%~85%
  · 多岛时两两不相交（采样点互不在对方多边形内）
  · 极端 seed（0 / 负数 / 2^31）不抛异常
```

### 6.2 R-MAP-17 区块视觉降级（P0）

**目标**：区块从「画面主体」退为「背景划分」。改动量最小、观感收益第二高，必须在 B1 之后立刻做。

**改动清单**

| 位置 | 改前 | 改后 |
|---|---|---|
| `regions.ts:101` `REGION_FILL_ALPHA` | 0.32 | **0.10** |
| `regions.ts:110` `REGION_BORDER_PX` | 1.6 | **1.2** |
| `regions.ts:119` `REGION_BORDER_ALPHA` | 0.6 | **0.32** |
| `regions.ts:1008` `hslToRgb(hue, 0.3+rng*0.2, 0.56+rng*0.14)` | 七彩 | `hslToRgb(hue, 0.10+rng*0.06, 0.62+(rng-0.5)*0.08)` |
| `REGION_WOBBLE.hueSpread` | 8 | **3** |

**新增工具栏开关「显示分区」**（默认开）：

- 关闭时 `regionLayer.alpha = 0`（不改几何，不做条件渲染分支）——
  这是"给读者看的成品图"与"给自己看的设定图"的分界，用户会频繁切换，必须零成本。
- 开关状态进 `doc.showRegions`，随撤销栈一起回滚（它影响画面，用户会期望能撤销）。

**为什么保留区块而不是直接删掉**：层级区块是 `map2` 的核心玩法（无极缩放的分区），
删了等于抽掉功能。降权的目的是让它"退到背景"，不是"消失"。

**验收**

- 缩到洲级截图，区块填充与其下方陆地/底图的 RGB 差 < 12（用吸管抽样 5 点）。
- 关开关后 `regionLayer` 与 `elementLayer` 的 draw call 减少 ≥ 1/3（渲染器统计）。

### 6.3 R-MAP-18 文字标注层（P1）

**目标**：补上给图「点名」的能力。参考实现的图里有 98 条文字 —— 古地图的信息密度主要来自这里。

#### 6.3.1 数据结构

```ts
export interface MapLabel {
  id: string;
  text: string;
  /** 世界坐标，锚点居中 */
  x: number; y: number;
  /** 世界单位字号档 */
  size: 10 | 12 | 16;
  /** 归属层级；null = 层级无关（任何缩放都可见） */
  level: number | null;
  /** 联动素材 id；有值时随素材移动、删除 */
  elementId?: string;
  /** 自动避让产生的额外偏移（世界单位），不持久化也可 */
  offsetY?: number;
}
```

**为什么 `size` 是枚举而不是数字**：只有三档，枚举能在 UI 上一键切换，
也避免用户拖出 13.7 这种值导致"同一层级字号不一致"。

#### 6.3.2 渲染实现

```ts
// MapCanvas 新增 labelLayer（按层级分容器，结构与 elementLayer 完全一致）
useEffect(() => {
  const root = labelLayerRef.current;
  if (!root) return;
  syncLabels(root, doc.labels, textures, levelAlphas.length);   // 增量增删，同素材层
}, [doc.labels, levelAlphas.length, app]);

// 视口变化：只改每个 Text 的 scale，不重建
useEffect(() => {
  const inv = 1 / Math.max(1e-6, viewport.scale);
  for (const t of textByIdRef.current.values()) {
    t.scale.set(inv);            // 屏幕恒定字号
  }
}, [viewport.scale]);
```

**为什么用 `scale.set(1/scale)` 而不是把 labelLayer 放到 world 外面**：
放外面就要每帧算 `worldToScreen` 并改写 300 个 position，滚轮时更贵；
改 scale 只是改一个标量，且 Pixi 的 transform 更新是懒计算的。
代价：文字在缩放过程中会有一帧的视觉抖动（scale 改变但位置由 world 矩阵算），
可接受 —— 参考实现的文字也是跟着地图缩放的。

**描边**：

```ts
new Text({
  text,
  style: new TextStyle({
    fontFamily: '"Songti SC","Noto Serif SC",serif',
    fontSize: l.size,
    fill: 0x1b1f1c,
    stroke: { color: 0xf6f0e0, width: 3 },
    align: "center",
  }),
});
text.resolution = Math.min(devicePixelRatio || 1, 2);
```

**避让**：同层级内标注包围盒相交时，后放置的 `offsetY -= 6`，最多让 3 次。
不做全局排版求解 —— 300 条文字的最优排布是 NP 问题，6 单位一档的贪心已经够用。

#### 6.3.3 交互

| 操作 | 行为 |
|---|---|
| 选中素材 → 属性区填地名 | 生成 `label.elementId = el.id` 的联动标注，位置在素材上方 8 单位 |
| 拖动素材 | 联动标注跟着走（在同一个 effect 里更新 `label.x/y`） |
| 删除素材 | 联动标注一起删（同一事务进撤销栈，不要留孤儿） |
| 双击标注 | 画布上覆盖 DOM `<input>`（绝对定位在 `worldToScreen(label)` 处），Enter 提交、Esc 取消 |
| "加标注"工具 | 画布单击落位，进入编辑态；空文本不创建 |

**双击编辑必须用 DOM 覆盖层**：Pixi 没有输入控件，模拟光标/选区/IME 是纯浪费。
覆盖层的定位复用 `coords.ts` 的 `worldToScreen`，不要另写换算
（参考实现也是这么做的：canvas 只负责画，交互与文字编辑全用 DOM 覆盖）。

#### 6.3.4 测试点

```
MapCanvas/label.test.tsx
  · 300 条标注挂载后，视口变化只改 scale，不重建 Text（mock 计数）
  · 层级切换时容器 alpha 等于 levelAlphas[i]（与素材同一份权重）
  · 删除素材后联动标注消失
  · 字号档位对应 10/12/16
```

### 6.4 R-MAP-19 全局风格预设（P1）

**目标**：一套数据出多种气质，成本接近零。

```ts
// MapEditorPage/style.ts
export type MapStyle = "none" | "parchment" | "ink";

export function filterFor(style: MapStyle): ColorMatrixFilter | null {
  if (style === "none") return null;
  const f = new ColorMatrixFilter();
  if (style === "ink") {
    f.saturate(0.15, false);
    f.brightness(0.95, false);
    return f;
  }
  // 羊皮纸：去饱和 + 暖偏 + 提亮。矩阵按行主序：
  // R' = a*R + b*G + c*B + d*offset
  f.matrix = [
    0.62, 0.20, 0.10, 0, 0.06,
    0.16, 0.58, 0.10, 0, 0.04,
    0.08, 0.14, 0.52, 0, 0.02,
    0,    0,    0,    1, 0,
  ];
  return f;
}
```

**挂载纪律（重申，这是最容易出错的一处）**：

```
sea (不动)  ← 不挂滤镜：海面本身就是深绿，染色后会更脏
coastFill 组（烘焙层）  ← 挂
regionLayer            ← 挂
elementLayer           ← 挂
labelLayer             ← 挂（墨色风格下文字要一起变暗，否则字比图亮）
overlay（选中框）       ← 绝对不挂
```

实现上给每个挂载点一个 `Container` 包一层，或直接赋 `filters` 数组。
切风格时：`bakeKey` 变化 → 海岸层重建一次（约 100ms），其余图层只换 `filters` 数组（零成本）。

**验收**：三档切换后选中框颜色恒定；切换耗时 < 200ms（`performance.now()` 打点）。

### 6.5 数据模型与迁移

```ts
// MapEditorPage/types.ts
export interface MapDocument {
  version: 2;                    // 1 → 2：本次改造
  land: MapLand | null;
  style: MapStyle;
  labels: MapLabel[];
  showRegions: boolean;          // 默认 true
  regions: MapRegion[];          // 不变
  elements: MapElement[];        // 不变
}
```

**迁移（`migrateDoc(raw)`，纯函数）**：

```
version 1 → 2：
  land        ??= null
  style       ??= "none"
  labels      ??= []
  showRegions ??= true
其他未知字段原样保留（不要 strict 丢弃）
```

**降级**：`land` 为 null / `polygons` 为空 → 跳过海岸四层；`labels` 里的 `level` 越界 →
用 `resolveElementLevel`（`lod.ts:179`）并入最细一级，与素材同规则（否则标注会永久不可见）。

**持久化不在本轮**（见 §3.4 注），但字段先就位，避免二次迁移。
落库时整文档进 `novel_maps.doc_json` 单列，主进程负责 normalize（裁剪超量标注、校验多边形闭合）。

### 6.6 R-MAP-20 性能骨架与导出（P2）

#### 6.6.1 视口剔除

```
viewport 变化时（不是每帧）：
  worldRect = screenRectToWorld(canvasRect, viewport) 扩 64 世界单位
  对 regionLayer 的每个层级容器、elementLayer / labelLayer 的每个层级容器：
      bounds = 该容器内所有子节点包围盒的并集（缓存，内容变化时重算）
      container.visible = intersect(bounds, worldRect)
```

**为什么按层级粗剔除、不做逐块剔除**：逐块遍历 600 个区块每帧要算 600 次相交，
省下的绘制反而更少 —— 因为同一层级的区块本来就在屏幕附近成簇。
粗剔除能把"缩到国家看时仍然绘制 160 个郡块"这种浪费干掉，已经够了。

#### 6.6.2 静态层缓存

`paperShadow` / `sea` / 海岸烘焙层整组 `cacheAsTexture()`，`bakeKey` 变化时 `updateCacheTexture()`。

**跨 2 倍缩放阈值重建一次**（复刻参考实现的 A/B 两档），阈值判断复用 `BORDER_WIDTH_QUANTIZE`
同款幂次档位（`Math.log(scale)/Math.log(2)` 取整），避免每格重建：

```
zoomTier = Math.round(Math.log2(scale))      // -2, -1, 0, 1, 2
zoomTier 变化 → updateCacheTexture()
```

#### 6.6.3 导出 PNG

| 项 | 值 |
|---|---|
| 尺寸档 | 长边 1024 / 2048 / 4096，默认 2048 |
| 切块阈值 | 单边 8192px（WebGL 纹理上限比浏览器 canvas 保守） |
| 落盘通道 | 主进程 `novel-export-binary`（按字节写，`writeFile` **不带 encoding**） |
| 导出前 | 清空 `overlay`（不能把选中框画进成品）；临时隐藏 `labelLayer` 的编辑态 DOM 覆盖层 |

**绝不能复用 `novel-export-file`** —— 它是 `writeFile(..., "utf8")`，写 PNG 会文件损坏且零报错
（这条是项目里已经踩过的坑，`AGENTS.md` §2.1 有记录）。

导出实现：

```
for each tile (col, row):
    world.position = 按 tile 偏移设置
    canvas = renderer.extract.canvas({ target: stage, resolution: exportScale })
    drawImage 到 offscreen 拼接 canvas
恢复 world.position / scale
```

#### 6.6.4 验收

- 4096 导出：拼接缝处相邻像素差 < 2（脚本抽样 3 条缝）。
- 导出后恢复视口，画面与导出前抽 3 点逐像素一致。
- 600 区块 + 300 素材 + 300 标注：连续滚轮缩放 ≥ 50fps（`requestAnimationFrame` 采样 3 秒取中位数）。

---

## 7. 实施手册（按文件、按顺序）

### 7.0 开工准备

```bash
cd "D:/mine/CheckIn"                       # 必须大写盘符，小写会让 vitest module runner 键错乱
git fetch origin && git checkout -b feat/map-render origin/map2
pnpm install
node node_modules/vitest/vitest.mjs run src/windows/MapWindow   # 基线必须全绿再动手
npx tsc --noEmit -p tsconfig.app.json
```

改造期间每完成一步就跑一次上面两条（测试 + 类型），**不要攒到最后一起跑** ——
地图渲染的回归往往表现为"某个 effect 静默没跑"，越晚发现越难定位。

### 7.1 B1 · 陆地与海岸（8 步，顺序不可换）

| 步 | 文件 | 做什么 | 怎么验 |
|---|---|---|---|
| 1 | `types.ts` | 加 `MapLand` 接口 + `MapDocument.land`（初值 `null`）+ `migrateDoc` | 全量测试仍绿（此步只加字段，没有任何消费者） |
| 2 | `land.ts`（新建） | `generateLand()` + `pointInLand()` + `drawLandPath()` 辅助 | `land.test.ts` 全绿（纯函数，先测后用） |
| 3 | `useMapEditor.ts` | `generateLand(seed?)`：生成后写 `doc.land` 并压撤销栈；`doc` 初值补字段 | 单测：调用后 `doc.land !== null`，撤销后回 null |
| 4 | `index.tsx`（页面） | 工具栏加「生成陆地」按钮；已有区块时弹确认「将重新划分区块」 | 手点，控制台无报错 |
| 5 | `regions.ts` | `GenerateHierarchyOptions.container?: Point[]`；`voronoiCellIn` 入参换成 container；`sampleSeeds` 加过滤 | `regions.test.ts` 631 行**必须全绿**（矩形路径未动） |
| 6 | `useMapEditor.ts` | 「生成陆地」连带调 `generateHierarchy({ container: land.polygons[0] })`（多岛时逐岛切分后合并） | 手测：区块不再出现在海里 |
| 7 | `MapCanvas/index.tsx` | 新增 `sea`（NineSliceSprite）、海岸烘焙层（Sprite 承接 RenderTexture）、`bakeCoast()`、`bakeKey` effect | 见 §8.1 结构自检 |
| 8 | 全链路 | 出截图对比（改前 / 改后各一张适应窗口） | 见 §8.2 反模式排查 |

**第 6 步的坑**：多岛时 `generateHierarchy` 要跑多次再合并，而 `regions.ts` 内部用全局计数器
生成 id（`nextId`）。多次调用必须传同一个 `idPrefix`，否则 id 会重号，React key 与撤销栈全乱。
建议给 `GenerateHierarchyOptions` 再加 `idPrefix?: string`，缺省时保持现有行为。

### 7.2 B2 · 区块降级（3 步）

| 步 | 文件 | 做什么 | 怎么验 |
|---|---|---|---|
| 1 | `regions.ts` | 改 5 处常量/公式（§6.2 表格） | `regions.test.ts` 里凡断言具体颜色的用例会红 → 按新值更新，**不要改判据逻辑** |
| 2 | `types.ts` + `useMapEditor.ts` | 加 `showRegions`（默认 true）+ `toggleRegions()`；`MapCanvas` 用它控制 `regionLayer.alpha` | 单测：切换后 `regionLayer.alpha` 为 0 / 1 |
| 3 | `index.tsx` | 工具栏开关 | 手测：关掉后只剩地貌与地名 |

### 7.3 B3 · 文字层（5 步）

| 步 | 文件 | 做什么 | 怎么验 |
|---|---|---|---|
| 1 | `types.ts` | `MapLabel` + `MapDocument.labels` + 迁移 | 全量绿 |
| 2 | `MapCanvas/index.tsx` | `labelLayer`（按层级分容器）+ 增量同步 + `scale=1/scale` effect | `label.test.tsx`（4 条，见 §6.3.4） |
| 3 | `index.tsx` | 属性区「地名」输入框；素材选中时读写 | 手测：填字后画布出现标注 |
| 4 | `MapCanvas/index.tsx` | 双击 → DOM `<input>` 覆盖层（`worldToScreen` 定位），Enter/Esc | 手测 + IME 输入不丢字 |
| 5 | `useMapEditor.ts` | 素材移动/删除时联动标注（同一事务） | 单测：删素材后 `labels` 无残留 |

### 7.4 B4 · 风格预设（2 步）

| 步 | 文件 | 做什么 |
|---|---|---|
| 1 | `style.ts`（新建） | `MapStyle` 枚举 + `filterFor()` 三档矩阵 |
| 2 | `MapCanvas` + `index.tsx` | 按 §6.4 挂载纪律赋 `filters`；工具栏下拉；切换时 `bakeKey` 变化触发重烘 |

### 7.5 B5 · 剔除 / 缓存 / 导出（3 步）

| 步 | 文件 | 做什么 |
|---|---|---|
| 1 | `MapCanvas` | 视口剔除（按层级容器包围盒 + 64 世界单位余量） |
| 2 | `MapCanvas` | `cacheAsTexture` + `zoomTier` 跨档重建 |
| 3 | `export.ts`（新建）+ 主进程 | 分块导出 + `novel-export-binary` 落盘 |

### 7.6 文件改动总表

| 文件 | 类型 | 批次 | 预估行数 |
|---|---|---|---|
| `MapEditorPage/land.ts` | 新建 | B1 | 160 |
| `MapEditorPage/land.test.ts` | 新建 | B1 | 120 |
| `MapEditorPage/region-container.test.ts` | 新建 | B1 | 90 |
| `MapCanvas/render-stack-guard.test.ts` | 新建 | B1 | 40 |
| `MapCanvas/bake.test.ts` | 新建 | B1 | 80 |
| `MapEditorPage/style.ts` | 新建 | B4 | 60 |
| `MapEditorPage/style.test.ts` | 新建 | B4 | 50 |
| `MapEditorPage/export.ts` | 新建 | B5 | 150 |
| `MapEditorPage/export.test.ts` | 新建 | B5 | 70 |
| `MapEditorPage/types.ts` | 改 | B1/B3 | +45 |
| `MapEditorPage/regions.ts` | 改 | B1/B2 | +40 / 改 5 处 |
| `MapEditorPage/coords.ts` | 不改（复用 `worldToScreen`） | — | 0 |
| `MapEditorPage/lod.ts` | 不改（复用 `elementWeight`） | — | 0 |
| `MapEditorPage/hooks/useMapEditor.ts` | 改 | B1/B2/B3 | +120 |
| `MapEditorPage/components/MapCanvas/index.tsx` | 改 | B1/B3/B4/B5 | +400 |
| `MapEditorPage/components/MapCanvas/label.test.tsx` | 新建 | B3 | 90 |
| `MapEditorPage/index.tsx` | 改 | B1/B2/B3/B4 | +90 |

---

## 8. 验收与自检

### 8.1 分层自检（每完成一个批次跑一遍）

**结构自检（不看画面也能查）**

1. 场景图子节点顺序，用 DevTools 或在 `bakeCoast` 后打一行日志：
   `sheet, sea, shelf, coastGlow, landFill, landStroke, region, element, label, overlay`。
   顺序错会让素材钻进区块底下、或文字被陆地盖住，且**不报错**。
2. `bakeKey` 变化前后，打印烘焙耗时（`performance.now()` 差值）。首次应在 60~150ms；
   若 > 300ms 说明分辨率或模糊质量取高了。
3. 滚轮连续缩放时，打印一帧内遍历元素的数量（应在 0 附近 —— 视口变化不应触碰元素）。

**观感自检（按 §2.1 的描述逐条对）**

4. 眯眼看：能不能看出一块"完整的陆地"？看不出 → 海岸白边太细或浅海带被裁。
5. 站远看：第一印象是"地图"还是"色块"？是色块 → B2 没做到位（填充 alpha 仍高）。
6. 找海岸：随便挑一段海岸，白边有没有断口/变细？有 → 见 §8.2 第 2 条。
7. 找文字：压在深色山林上的字读不读得清？读不清 → 描边宽度不够或颜色太浅。

**性能自检**

8. `600 区块 + 300 素材 + 300 标注` 下滚轮缩放：`requestAnimationFrame` 采样 3 秒，中位数 ≥ 50fps。
9. 首次进图到可交互 < 800ms。

### 8.2 八个"一眼假"的反模式（症状 → 根因 → 修法）

这些是实施中最可能出现的偏差。**看不到参考图的人，靠这张表判断自己做错了没有。**

| # | 症状 | 根因 | 修法 |
|---|---|---|---|
| 1 | 陆地像一张剪贴画贴在海上 | 缺浅海带或外发光，海陆之间没有过渡 | 检查 `shelf` / `coastGlow` 是否真的加进了 holder；`BAKE_MARGIN` 是否够（≥ blur×3） |
| 2 | 海岸白边断断续续 / 粗细不均 | 填充与描边在同一个 Graphics 里交替绘制，后画的填充盖掉了前一段描边的一半 | **填充与描边必须是两份独立 Graphics**，先全填再全描；`alignment: 0.5` |
| 3 | 岸边一圈"雾团"糊进海里 | 模糊半径超出 `BAKE_MARGIN`，被 RenderTexture 边缘裁掉 | `BAKE_MARGIN ≥ max(blur) × 3`，本例 64 够；若加大模糊必须同步加 margin |
| 4 | 烘焙"成功"但画面什么都没有 | `holder` 没做「世界原点 → 纹理左上角」的平移，海岸画到纹理外了 | `holder.position.set(-(b.x - MARGIN), -(b.y - MARGIN))` |
| 5 | 区块还是抢眼（改了 alpha 没用） | 改的是 `REGION_FILL_ALPHA` 但填充样式在别处被 `levelAlphas` 乘过；或改到了边界的常量 | 检查 `MapCanvas` 的权重 effect：`container.alpha = levelAlphas[i]`，**填充 alpha 在样式里、层级权重在容器上，两者相乘**，任一处为 0 结果都是 0 |
| 6 | 文字随缩放变大变小 | `scale` 没反向，或反向写成了 `scale.set(viewport.scale)` | `text.scale.set(1 / viewport.scale)` |
| 7 | 文字发虚 / 有彩边 | `Text.resolution` 没设（默认 1） | `text.resolution = min(devicePixelRatio, 2)` |
| 8 | 滚轮一顿一顿，区块越多越卡 | `BlurFilter` 挂在了每帧重绘的容器上 | 模糊只允许出现在烘焙期；运行期图层不许带 filter |

### 8.3 交付时需要提供的截图（给评审用，也给自己留证据）

1. 适应窗口（整纸），改前 / 改后并排
2. 洲级（`scale ≈ 1.5`），展示区块降权效果
3. 郡级（`scale ≈ 3.5`），展示海岸锐利与文字清晰
4. 关闭「显示分区」，展示成品图形态
5. 三档风格各一张（同视口，便于比对）
6. 4096 导出图（检查拼接缝）

**每张都要带同一随机种子**（工具栏显示 seed），否则改前改后不可比。

---

## 9. 测试与护栏

现有 5 个测试文件合计约 2000 行（`MapCanvas/index.test.tsx` 319、`lod.test.ts` 353、
`regions.test.ts` 631、`useTextureCache.test.tsx` 121、`MapEditorPage/index.test.tsx` 621），
改造必须保持全绿。新增：

| 测试 | 断言 | 批次 |
|---|---|---|
| `land.test.ts` | 确定性 / 闭合 / 无自交 / 面积占比 25%~85% / 多岛不重叠 | B1 |
| `MapCanvas/render-stack-guard.test.ts` | 源码守卫：子节点顺序固定 `[sheet, sea, shelf, coastGlow, landFill, landStroke, region, element, label, overlay]` | B1 |
| `region-container.test.ts` | `container` 缺省走矩形（老行为不变）；传入多边形时所有区块顶点都在陆地内 | B1 |
| `MapCanvas/label.test.tsx` | 视口变化只改 scale 不重建 Text；层级权重与素材同源；删素材清标注 | B3 |
| `style.test.ts` | 三档矩阵对纯白输出在预期区间；`overlay` 不带滤镜 | B4 |
| `MapCanvas/bake.test.ts` | 同 `bakeKey` 不重建（计数 0）；`bakeKey` 变重建 1 次；`land=null` 时清空 | B1 |
| `export.test.ts` | 分块数与 8192 阈值关系；`overlay` 在导出前被清空 | B5 |

**写源码守卫的两条禁忌（项目里已踩过）**：

1. **不要断死一整行**：格式化会把属性拆成多行，`toContain('a && b')` 会假红。
   用 `toMatch(/<MapCanvas\s+view="a"/)` 这种容错正则。
2. **读源码别用 `new URL(..., import.meta.url)`**：沙箱 fs 代理只认 file scheme。
   用 `path.resolve(process.cwd(), ...)`。

**跑测试的两个已知陷阱**：

- 整仓扫描型守卫（scss imports 等）并行跑会撞 5000ms 假超时 → 单跑复核，别改源码。
- 源码 CRLF → 跨行断言前先 `.replace(/\r\n/g, "\n")`。

---

## 10. 风险与明确不做

### 10.1 风险

| 风险 | 影响 | 处置 |
|---|---|---|
| 海岸烘焙占显存 | 4096² RT 约 64MB | 超限降采样到 2048 并 `console.warn`；同时只保留一份缓存（重建时先释放旧的） |
| 区块改「陆地内切分」破坏老测试 | `regions.test.ts` 631 行可能大面积红 | 保留矩形路径，用可选参数切换；新路径单独加测，不改老断言 |
| 多岛时 id 重号 | React key 冲突、撤销栈错乱 | 给 `generateHierarchy` 传同一个 `idPrefix`（§7.1 第 6 步） |
| 文字量上去后掉帧 | 300 条以上 Text 各自上传纹理 | 按层级容器分组 + 视口剔除；上限 300；超过转 `BitmapText`（中文字符集需预生成，留待后续） |
| 滤镜与烘焙交互 | 切风格要重建，可能闪一帧 | 重建期间保留旧纹理，完成后原子替换 |
| 陆地形状"每次都不一样"导致截图不可比 | 评审无法判断改动效果 | 工具栏显示 seed 且可手填；生成即记录，写进截图文件名 |

### 10.2 明确不做

- 不做画笔 / 笔刷体系（参考实现有 12 种 `PaintTypeEnum`）：本轮陆地靠生成器，不靠涂抹。
- 不做真实经纬度 / 投影：世界坐标就是纸面坐标，`coords.ts` 的语义不变。
- 不做像素级拾取：命中测试继续走几何判定（`hitTestElement` 已是这个思路）。
- 不做超分（waifu2x）：导出靠分辨率档位，不引入第三方模型。
- 不做持久化与多地图管理：字段先就位，落库留给后续批次。
- 不做标注的全局自动排版：贪心避让（最多 3 次）已够用，最优排版是 NP 问题。

---

## 11. 附录 A：参考实现的关键机制（原文摘录，供无网访问时参考）

以下摘自《makeamap_渲染逻辑分析.md》（WorkBuddy 资料库），**只为说明"这些参数是从哪来的"**，
实施时不需要访问原文。

**A1 · 它的整体策略（一句话）**

> 不是 Mapbox 那类地图库，而是把整张地图当成一张 A4 画布来画的矢量绘图软件：
> 自研 Canvas 2D 场景图引擎 + 整页离屏缓存纹理 + 放大后切换到逐帧高清重绘。

**A2 · 双档渲染**

> 缩放 < 2 倍时：所有矢量要素只在脏标记置位时画一次，落到与纸张等大的离屏画布；每帧只做一次
> `drawImage(缓存)`；平移/缩放通过矩阵变换整张缓存图 —— 零重绘成本，但放大后是插值模糊。
> 缩放 ≥ 2 且开启"高清增强"时：绕过缓存，逐帧直接画，叠加视口剔除、线要素 2× 超采样、点要素批处理。

**A3 · 图层栈（真实叠放顺序，从下到上）**

```
BASEMAP          海面纹理（2000×2000 非等比拉伸到 3234×2306，四边 30px 九宫格保护）
PaintCover 9999  海洋修饰层（海岸浪花 / 浅海光晕）
PaintCover #2    浅海大陆架
PAINT            陆地画笔层（1754×1240 放大到 3174×2246，约 1.81 倍）
LayerBaseLine    面基线 → POLYGON
LayerBaseLine    线基线 → LINE ×137
LayerBaseLine    点基线 → POINT ×436（素材 PNG）
TEXT ×98         文字（最上层）
```

> 它的陆地边缘"雾雾的"不是滤镜，是**分辨率不够 + 双线性放大**；山体素材却很锐利，
> 因为素材本身是高分辨率 PNG 按 1:1 贴。

**A4 · 海岸三件套（复刻清单原文）**

> 海岸：在陆地蒙版上做 3~5px 白色描边 + 外发光（海洋修饰层），再叠一层更宽的浅色带（浅海大陆架）。
> 文字统一：黑体、shadow 4、border_size 4 白描边、bg_alpha 0。

**A5 · 文字要素的样式字段（实测样本）**

```json
{ "name": "长虹城", "size": 18, "font": "黑体", "color": "#171717",
  "alpha": 1, "shadow": 4, "angle": 0,
  "bg_alpha": 0, "bg_color": "#ffffff",
  "border_size": 4, "border_color": "#ffffff", "border_alpha": 0,
  "shadow_color": "#ffffff", "vertical": 0, "word_spacing": 0, "curve": 0 }
```

**A6 · 风格实现**

> 风格不是重新配色，而是把整张缓存图换个色相/饱和度/亮度：
> `ctx.filter = "hue-rotate(h) saturate(s%) brightness(b%)"`。成本极低，风格统一。

**A7 · 几何算法清单（它做了哪些"手绘感"处理）**

> `smoothPoints` 折线平滑 / `optimizePolyline` 抽稀 / `createPolygonBuffer` 内外缩 /
> `erodeGeoJSON` 形态学腐蚀（海岸线柔化）/ `BottomEdgeSoftness`、`LineEdgeSoftness` 边缘柔化 /
> `relief` 浮雕 / `PointInPoly`、`TouchPtLine` 命中测试。

**A8 · 缩放档位**

> 步长 0.1，常规上限 **2**，超大画布上限 1，下限 0.1。上限 2 与高清模式的触发阈值 2 完全吻合 ——
> 这是有意设计的档位分界。

**我们从 A1~A8 各取了什么**

| 它的机制 | 我们的处置 |
|---|---|
| A2 整页缓存 | **改用烘焙**：只烘"不随视口变"的海岸层，不烘整页（因为 Pixi 下整页缓存会牺牲近处锐度） |
| A3 图层栈 | **照搬顺序**（海 → 浅海 → 陆地 → 面 → 线 → 点 → 文字），映射到 §4.1 |
| A4 海岸三件套 | **照搬手法**，参数按 1024 基准换算（§4.3） |
| A5 文字字段 | **取子集**：字号档 / 描边 / 无底框；不做 shadow / curve / vertical |
| A6 风格 | **照搬思路**，用 `ColorMatrixFilter` 替代 `ctx.filter` |
| A7 几何算法 | **只取"边缘柔化"一件事**（`BlurFilter` 1.6 复刻）；平滑/抽稀/浮雕不做（我们的区块由 fbm 生成，本身已是曲线） |
| A8 缩放档位 | **不照搬**：我们上下限 0.1~8（`coords.ts:29`），LOD 已覆盖"缩到哪看到多细"，不需要 2 倍硬阈值 |

---

## 12. 术语与单位

| 术语 | 含义 |
|---|---|
| **世界单位** | 地图逻辑坐标的度量。整张纸宽 1024（由 `BASE_IMAGE` 决定），原点在纸中心 |
| **屏幕像素** | 画布 CSS 像素。屏幕恒定线宽用这个口径，`width = px / scale` |
| **层级 / level** | 行政区划的粗细级别：0 大陆 → 1 洲 → 2 国家 → 3 郡 |
| **LOD 权重 / levelAlphas** | 每个层级当前的可见权重，和恒为 1（`lod.ts` 帽函数） |
| **烘焙 / bake** | 把不随视口变化的图层渲染进一张 `RenderTexture`，运行期只画这张纹理 |
| **bakeKey** | 烘焙内容哈希，变了才重建（替代布尔脏标记，避免漏置位） |
| **九宫格 / NineSlice** | 把一张图切成 9 块，四角不拉伸、四边单向拉伸、中间双向拉伸，用于底图铺满不变形 |
| **海洋三件套** | 白描边 / 外发光 / 浅海带，海岸观感的三个构成，缺一不可 |
| **反模式** | §8.2 的八条"做了但做错"的典型症状，用于自检 |
| **`map2`** | 地图功能的开发分支，本文基线 |

---

## 13. 变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| 0.1 | 2026-10-30 | 首版：差距诊断 + 视觉规范 + 五条需求 + 验收清单 |
| 0.2 | 2026-10-30 | 改为自包含：新增 §2 目标画面（文字重建成品）、§5.2 烘焙取舍、§6 每条需求的实现步骤与伪代码、§7 实施手册（按文件按顺序）、§8.2 八个反模式、§11 参考实现机制摘录、§12 术语表 |
