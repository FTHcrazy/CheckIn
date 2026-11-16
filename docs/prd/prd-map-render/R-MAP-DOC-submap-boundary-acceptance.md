# 子图边界羽化 · 验收判据

> 状态：**定稿**（判据可执行；ΔE 阈值为行业经验值，首测后回填见 §2.3）
> 输入：[`nested-submap-boundary.md`](nested-submap-boundary.md)（§2.2「落地口径」，2.32.0）、[`../../spec/map-export-spec.md`](../../spec/map-export-spec.md)（**§6.1 基线图命名的唯一来源**）、[`map-window-overview.md`](map-window-overview.md)（§5.3-3 递归深度缺口）
> 基线：CheckIn **2.36.0**（工作区）｜羽化带（`erase` 混合 + `AlphaFilter` 隔离）已于 **2.32.0** 落地；`MapWindow` 44 文件 / 750 用例

> 本文只答一个问题：**边界羽化做到什么程度算通过**。`nested-submap-boundary.md` §2.2 给了参数
> （24 本地单位 / 6 段 / `erase`），没给判据；本文补四组可判据，每条标 **自动** / **人眼**。

---

## 0. 结论速览

| # | 判据 | 通过线（一句话） | 判法 |
|---|---|---|---|
| **A** | 渐隐宽度 | 羽化带外沿→内沿的**像素跨度** ∈ 公式算出的 ±2px 区间 | 自动（纯函数断言）+ 人眼（基线图 B1） |
| **B** | 色差阈值 | 带内相邻像素 ΔE(CIEDE2000) ≤ **3**；带外两侧同材质 ΔE ≤ **1.5** | 自动（取样脚本）+ 人眼复核 |
| **C** | 基线图 | 每组用例 1 张，目录/命名/档位**全部引 `spec/map-export-spec.md` §6.1** | 人眼（看基线图） |
| **D** | 递归深度 | **验收覆盖 4 层**（P0 必须过）；**5 层为已知边界**（P1 记录不阻塞） | 自动（vitest 断言） |

---

## 1. 判据 A · 渐隐宽度（给区间数值）

### 1.1 实现事实锚点（先固定分母，再谈区间）

| 事实 | 值 | 落点 |
|---|---|---|
| 羽化**总宽** | `SUBMAP_FEATHER_WIDTH = 24`（**子图本地单位**） | `submapRender.ts:267` |
| 分段数 | `SUBMAP_FEATHER_STEPS = 6` | `submapRender.ts:270` |
| 每段宽 | `step = width / steps` = **4** 本地单位 | `submapRender.ts:356` |
| 每段 alpha | `1 - (i-0.5)/steps`（环带中点的线性值） | `submapRender.ts:362` |
| 环带几何 | 内缩多边形的**中点描边**（`alignment: 0.5`，`join: "round"`） | `submapRender.ts:360`、`:639-645` |
| miter 限幅 | `gain` 钳在 `1/0.35 ≈ 2.86`（尖角处带距偏窄） | `submapRender.ts:329` |
| **挂载条件** | 只有 **`hasLand`** 的子图才挂羽化（路径 A′ 的色差缝；路径 B 无自己的海，无缝可糊） | `submapRender.ts:497`、`:633` |
| 子图标准纸 | `SUBMAP_PAPER_BOUNDS` = 1024×1024 | `submapBind.ts:32` |
| 父图纸张 | `BASE_IMAGE` = 1024×1024 | `sprites.ts:264-271` |
| 贴合缩放 | `fit.scale = min(目标宽/子图宽, 目标高/子图高)` | `coords.ts:384` |
| 导出倍率 | `exportScale = longSide / max(纸宽, 纸高)` | `map-export-spec.md:39` |

### 1.2 换算公式（唯一口径，照用）

羽化画在**子图本地坐标**里，随贴合变换一起缩放，再随导出倍率落到像素：

```
羽化跨度_px = 24 × fit.scale × exportScale
            = 24 × min(目标宽, 目标高) / 1024 × longSide / 1024
```

意即：**羽化跨度与区块尺寸成正比**，同一张纸上大区块的羽化更宽、小区块更窄——这是刻意的
（`submapRender.ts:263-266`：「郡图的羽化和大陆图的羽化在各自的纸上看起来一样宽」）。

### 1.3 判据（两个数据点，必须同时成立）

固定试卷：正方形区块，子图 bounds = 1024²，1024 档导出（`exportScale = 1`）。

| 用例 | 区块包围盒长边 | 标称跨度 | **通过区间** |
|---|---|---|---|
| A-1 | 512（半张纸） | `24 × 0.5 = 12 px` | **∈ [10, 14] px** |
| A-2 | 256（四分之一纸） | `24 × 0.25 = 6 px` | **∈ [4.5, 7.5] px** |

容差 ±2px 的来源：① `erase` + `AlphaFilter` 的合成边缘有 1~2px 抗锯齿过渡；② 判据要求
**在直边段取样**（直边 `gain = 1`，无 miter 偏差；尖角处带距偏窄属预期，不计入）。A-2 存在的意义：
证明跨度随区块尺寸**成比例**，而不是一个固定像素值。

### 1.4 测量方法（可复现，不靠"看着差不多"）

1. 用固定试卷导出**同 seed 两张图**：一张有子图绑定（羽化生效），一张同配方但**不绑定子图**；
2. 两张图做逐像素差（`|ΔRGB|max`），得到「子图贡献」灰度图；
3. 在**直边段**（非尖角）取一条垂直于边界的扫描线；
4. 数差值从 **≤5%（满值）** 升到 **≥95%（满值）** 的像素个数 = 实测跨度；
5. 与 §1.3 区间比对。

> 对照组**不入库**（`spec/map-export-spec.md` §6.1 只允许 1024 档**通过态**入库），只在对照记录里
> 写度量数字 + 生成命令——与 spec 对 2048/4096 档的处置同款。

**人眼复核基线图**：`2.36.0-seed20260411-地图-1024.png`（版本 + seed + 1024 档，三要素写全）。

---

## 2. 判据 B · 色差阈值（给具体阈值 + 说清依据从哪来）

### 2.1 阈值

| 位置 | 指标 | 通过线 |
|---|---|---|
| 羽化带**内**（相邻像素之间） | ΔE（CIEDE2000） | **≤ 3** |
| 羽化带**外**两侧同材质区域（子图海面 vs 父图海面） | ΔE（CIEDE2000） | **≤ 1.5** |

取样规则：带内沿扫描线取 **5 对相邻像素**（取最大值）；带外每侧取 **32×32 同材质块**的
中位色（各 1 块）。

### 2.2 依据状态：**当前无实测依据，取行业经验值**

CIEDE2000 的「刚可察觉差」（JND）公开共识约 **2.3**：低于它基本不可辨，3 属"贴近下限 + 工程余量"
（覆盖 PNG 编码与显示器差异）；1.5 取 JND 的约 65%，因为带外两侧是**同一材质**（同纸纹同海面），
本应几乎无差，留 1.5 已是宽松值。**这是经验值，不是本项目的实测值。**

### 2.3 回填责任（必须有，否则 §2 不算判据）

| 项 | 规定 |
|---|---|
| 谁回填 | 执行 **T14 终检**的工程师（T14 定义见 `R-MAP-DOC-batch-plan.md` §8.2 流程第 5 步） |
| 何时回填 | **首组基线图入库的同一提交**（即 §3.2 的 B1 入库当次） |
| 回填到哪 | 本文 §2.1 表新增「实测值」列 + `R-MAP-DOC-batch-plan.md` 的「执行结果」段 |
| 偏离处置 | 实测与经验值差 **> 1.0** 时以实测值为准，并在 §2.1 表下登记偏离理由与取样条件 |
| 未回填的后果 | 判据 B 记「**未验证**」，不记「通过」——与 `R-MAP-DOC-render-seed-review.md` 对观感项的处置一致 |

### 2.4 判法

**自动**：取样脚本读两张导出图（同 §1.4 的两张），按 §2.1 规则算 ΔE 并打印最大/中位值。
**人眼**：基线图 B1 上确认「边界无硬边、无错位重影、无色差缝」（`nested-submap-boundary.md:198-199`
的观感口径）。

---

## 3. 判据 C · 基线图（**引用 `spec/map-export-spec.md` §6.1，不自创**）

### 3.1 规则（全部来自 spec，本文只复述取用）

| 项 | 规定 | 出处 |
|---|---|---|
| 目录 | `docs/assets/map-baselines/`（新建目录可用；**目录本身不入 `docs/README.md` 索引**） | `map-export-spec.md:160` |
| 档位 | **只允许 1024 档**，单张 ≤300KB；2048/4096 不入库，只在对照记录写度量 + 生成命令 | `map-export-spec.md:161` |
| 命名 | `<版本>-seed<seed>-地图-<长边像素>.png` | `map-export-spec.md:162` |
| 引用 | 必须同时写出「**版本 + seed + 档位**」三要素，不得只引文件名 | `map-export-spec.md:166-167` |

### 3.2 本批需要的 2 组（文件名写全）

| # | 文件名（写全） | 拍什么 |
|---|---|---|
| **B1** | `2.36.0-seed20260411-地图-1024.png` | 单图 + 1 个绑定子图（**正方形区块包围盒 512×512**，子图自带陆地与海面 / 路径 A′）。拍：直边段的羽化过渡（判据 A-1 的测量对象）+ 带内外色差（判据 B） |
| **B2** | `2.36.0-seed20260412-地图-1024.png` | 单图 + 1 个绑定子图（**正方形区块包围盒 256×256**）。拍：羽化跨度成比例变窄（判据 A-2），并作为「小区块羽化更窄是正确的、不是 bug」的留证 |

> 三要素写全的写法：`2.36.0` + `seed 20260411` + `1024 档`。两张 seed 不同是**刻意的**
> —— `spec` §6.1 已明说同版本同 seed 同档位会**同名互相覆盖**，无法用图注区分。

---

## 4. 判据 D · 递归深度（**这条不写，本文即不合格**）

> 触发依据：`map-window-overview.md:230`（§5.3-3）「子图递归深度无上限测试：现状允许无限嵌套，
> 深链（4 层以上）的缩放/剔除/导出没有用例。」

### 4.1 现状事实（先把"无限"说准）

| 事实 | 内容 | 落点 |
|---|---|---|
| **有护栏** | `SUBMAP_MAX_DEPTH = 16` | `submapRender.ts:78` |
| 护栏性质 | **防爆栈**，不是产品上限——触发条件是「文档被手工编辑出环」，不是「用户嵌太深」 | `submapRender.ts:72-77` |
| 产品上限 | **无**（UI 没有任何"最多嵌 N 层"的限制） | — |
| 现有覆盖 | 绑定只到 **2 层**；渲染纯函数全部**单层**；LOD 嵌套段只测单次相乘 ⇒ **4 层以上零用例** | `submapBind.test.ts:77`；`submapRender.test.ts:109-243`；`lod.test.ts:835` |

### 4.2 结论

- **验收覆盖上限 = 4 层**（P0，必须通过）。
- **5 层 = 已知边界**（P1，记录不阻塞）。量化理由：每层 `fit.scale = 0.5` 时，第 5 层区块在
  1024 档导出里长边仅 `512 × 0.5⁴ = 32 px`——**能渲染、不可判读**，故到此为止。
- **16 层护栏只做"不崩"断言**（L5-1），不列入体验验收。

### 4.3 4 层用例（P0，4 条）

| ID | 落点文件（vitest） | 断言什么 |
|---|---|---|
| **L4-1** | `src/windows/MapWindow/pages/MapEditorPage/components/MapCanvas/submapRender.test.ts`（新增 `describe("递归深度 4 层")`） | 4 层链每层 `fit.scale = 0.5`、根 `scale = 0.8` ⇒ 逐层 `effectiveScale = 0.8 × 0.5^k`（k=1..4），`toBeCloseTo(…, 12)`；且每层 `submapNodeSpec(...).hasSubmap === true`（不被深度截断） |
| **L4-2** | 同上（`submapRender.test.ts`） | 4 层 `enterWeight` 相乘的总可见权重 ∈ [0,1] 且 **≤ 任一层单值**；把第 2 层压到 0（父图缩放远低于阈值）后整链乘积 = 0，第 3/4 层**不得越级可见**（0 传染） |
| **L4-3** | `src/windows/MapWindow/pages/MapEditorPage/coords.test.ts`（`fitSubmapTransform` 已在此文件） | 4 层链末端内容中心的**世界坐标** == 逐层手算值（误差 ≤ 1e-9，无累积漂移）；任一层的 `bounds.width = 0` 时该层退回 `scale: 1`，不产生 `NaN`/`Infinity`、不抛错 |
| **L4-4** | `src/windows/MapWindow/pages/MapEditorPage/submapBind.test.ts`（现有 `:77` 只到 2 层，**扩展为 4 层**） | 4 层嵌套的 region / 要素 / 地名 / 折线 id 全部带 **4 级前缀**；全树 id 集合大小 == 总数（无重复）；源文档零改动（拷贝隔离仍成立） |

### 4.4 5 层用例（P1，3 条，记录不阻塞）

| ID | 落点文件（vitest） | 断言什么 |
|---|---|---|
| **L5-1** | `submapRender.test.ts` | `SUBMAP_MAX_DEPTH === 16` 且 `> 5`（余量 11 层）；5 层链逐层 `submapNodeSpec(...).hasSubmap === true` ⇒ 5 层**不会因护栏被截断** |
| **L5-2** | `submapBind.test.ts` | 第 k 层 id 以第 k-1 层前缀 `startsWith`（4 层前缀可追溯）；5 层全树 id 唯一（`Set` 大小 == 总数） |
| **L5-3** | `lod.test.ts`（嵌套 LOD 段 `:835` 之后） | 5 层 × `fit.scale = 0.5` ⇒ `submapEffectiveScale` 逐层递推末端 `= 0.5⁵ = 0.03125`（`toBeCloseTo`）；并断言 `512 × 0.5⁴ === 32`（第 5 层区块在 1024 档的屏幕长边），作为 §4.2「已知边界」的量化依据 |

---

## 5. 复核命令

```bash
# ① 常量与公式分子（期望 24 / 6 / 4）
grep -n "SUBMAP_FEATHER_WIDTH = \|SUBMAP_FEATHER_STEPS = \|const step = width / steps" \
  src/windows/MapWindow/pages/MapEditorPage/components/MapCanvas/submapRender.ts
# ② 羽化只挂有陆地的子图（路径 A′）+ 深度护栏
grep -n "const hasLand = \|if (hasLand) {\|SUBMAP_MAX_DEPTH = " \
  src/windows/MapWindow/pages/MapEditorPage/components/MapCanvas/submapRender.ts
# ③ 贴合缩放公式
grep -n "Math.min(tw / sw, th / sh)" src/windows/MapWindow/pages/MapEditorPage/coords.ts
# ④ 基线图命名规则出处（唯一来源）
sed -n '153,167p' docs/spec/map-export-spec.md
# ⑤ 4 层 / 5 层用例落点存在性
ls -l src/windows/MapWindow/pages/MapEditorPage/components/MapCanvas/submapRender.test.ts \
      src/windows/MapWindow/pages/MapEditorPage/submapBind.test.ts \
      src/windows/MapWindow/pages/MapEditorPage/coords.test.ts \
      src/windows/MapWindow/pages/MapEditorPage/lod.test.ts
```
