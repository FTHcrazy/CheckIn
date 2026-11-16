# 线要素「自动生成 vs 手画」口径裁定

> 状态：**定稿**（本批只产文档、不动代码；本文是口径裁定，不新增方案）
> 输入：[`nested-submap-road.md`](nested-submap-road.md)（方案稿）、[`nested-submap-elements.md`](nested-submap-elements.md)（方案稿）、[`map-b4-layers-polyline-prd.md`](map-b4-layers-polyline-prd.md)（2.29.0~2.31.0 已实施）、[`map-window-overview.md`](map-window-overview.md)（总览 §3.2 / §5.3-5）
> 基线：CheckIn **2.36.0**（工作区）｜`src/windows/MapWindow/` 44 文件 / 750 用例

> 适用：本文是三篇文档的**冲突裁定稿**。`map-window-overview.md` §5.3-5 已登记「道路篇说自动连路、
> elements 篇说水系只预留，两篇各自成立但没有一张表说清哪条自动、哪条手画」——本文就是那张表。
> **冲突时以本文为准**；三篇原文的结论不删，只在头部加指向本文的一行。

---

## 0. 结论速览（一句话）

**四类线（`road` / `river` / `ridge` / `border`）当前一律只能手画：一键成图对折线零产出（`domain/generator.ts` 对 `polyline` 的引用计数为 0），所有「自动生成」都是设计态。**

三条派生事实，本文后面逐条展开：

1. 折线的**唯一创建路径**是绘制态（`index.tsx:585` → `useMapDocStore.addPolyline`），没有第二个入口。
2. `road` 的自动生成（road 篇 D2「地点连路」）与 `river` 的自动生成（R-MAP-21「沿地势画河」）
   **是两件不同的事**，且**都不该在现状表里被写成已实现**——前者被 B4 明确判「不做」，
   后者是「有号未设计」。
3. `kind` 四类（+`route`）的结构与样式**已落**（2.30.0 / 2.31.0），与「自动生成」是
   **两个不同时态**：结构是完成时，生成能力是没有时。

---

## 1. 四类线 × 3 维 = 12 格现状表

> 每格的三件事：**是什么状态** / **什么时候产生** / **归谁负责**，格末是该格的证据行号。
> 状态取值只有三种：`自动`（代码产出）/ `手画`（用户逐点绘制）/ `预留不生成`（结构留位、无产出路径）。

### 1.1 `road`

| 维 | 内容 | 证据 |
|---|---|---|
| **现状** | **手画**。`styleId` 有 `road-main` / `road-trail` 两档，渲染走 `polylineRender`；一键成图不产 | `polylineStyle.ts:95`、`:104`；`generator.ts` polyline 计数 = 0 |
| **生成时机** | 仅在绘制态：单击落点 → Enter / 双击 / 点回起点收尾。**无自动档** | `index.tsx:582-594`（`finishPolyline`） |
| **归属 + 需求号** | `nested-submap-road.md` §2「D2 地点连路」；**无需求号**（B4 判定不做，见 §2 裁定 2） | `nested-submap-road.md:92`、`:186`、`:187`；`map-b4-layers-polyline-prd.md:412` |

### 1.2 `river`

| 维 | 内容 | 证据 |
|---|---|---|
| **现状** | **预留不生成 + 手画**。`river` 样式已落（0.35→1 变宽，2.31.0），但没有任何程序化产河路径 | `polylineStyle.ts:113`；`map-b4-layers-polyline-prd.md:242`、`:298` |
| **生成时机** | 用户手画走向 + 线纹理笔刷。**自动档 = 设计态**：「沿地势画河」在生成器侧**未设计** | `nested-submap-elements.md:212`；`map-window-overview.md:100` |
| **归属 + 需求号** | `nested-submap-elements.md` §3.4 + 纪律段；**R-MAP-21 取舍②**（有号、未设计） | `nested-submap-elements.md:183`、`:210`；`map-b4-layers-polyline-prd.md:413` |

### 1.3 `ridge`

| 维 | 内容 | 证据 |
|---|---|---|
| **现状** | **手画**。`ridge` 样式已落（影线笔刷 `hatch`，2.31.0），确定性落点、重绘不跳动 | `polylineStyle.ts:124`；`map-b4-layers-polyline-prd.md:299` |
| **生成时机** | 用户手画。**自动档 = 设计态**：「沿边界生成一圈山脊」是 boundary 篇的可选增强，非承诺 | `nested-submap-boundary.md:169-171` |
| **归属 + 需求号** | `nested-submap-elements.md` §2.3 与 §3.2；`nested-submap-boundary.md` §3.4；**无需求号**（可选增强，未立号） | `nested-submap-elements.md:124`、`:176` |

### 1.4 `border`

| 维 | 内容 | 证据 |
|---|---|---|
| **现状** | **手画**。`border` 样式已落（长虚线 + 两端渐隐 `fadeEnds`，随 B4-2 样式表一并交付） | `polylineStyle.ts:140`；`map-b4-layers-polyline-prd.md:291-292` |
| **生成时机** | 用户手画。**无自动档**；注意它是**势力边界折线**，与区块自动生成的 `region` 轮廓**不是同一样东西**（前者是用户画的线，后者是生成器的面） | `types.ts:108`；`map-b4-layers-polyline-prd.md:194` |
| **归属 + 需求号** | `nested-submap-elements.md` §3.1 并入通用折线；`map-b4-layers-polyline-prd.md` §4.4；**无需求号** | `map-b4-layers-polyline-prd.md:194`、`:409` |

### 1.5 表外但必须知道的第 5 个 `kind`：`route`

`MapPolyline.kind` 枚举是**五值**（`road | river | ridge | border | route`），但样式表只有
**五档四类**——`route`（航线）没有 `styleId`，因此它在 UI 里**既不能自动生成、也不能手画**
（无默认样式可选）。结论：`route` 是**纯类型预留**，本文四类表不含它，也不要把它算成"第五类已支持"。
证据：`types.ts:108`（枚举五值）、`polylineStyle.ts:95-142`（五档样式全部落在前四类）、
`map-b4-layers-polyline-prd.md:409`。

---

## 2. 三条裁定（本文的价值所在）

### 裁定 1 · 四类线当前一律手画，没有例外

代码侧只有一条创建链：`index.tsx:582-594` 的 `finishPolyline` → `editor.addPolyline`
→ `useMapDocStore.addPolyline`（`useMapDocStore.ts:795`）。全仓 `addPolyline(` 的非测试调用点
**只有这一处**。生成器是另一个函数族（`generateMap` `generator.ts:651`），它对 `polyline`
的引用计数是 **0**。

推论：任何"某类线已经能自动生成"的说法，都必须先给出生成器里的产出代码；给不出，就是设计态。

### 裁定 2 · `road` 自动生成（D2）与 `river` 自动生成（R-MAP-21）是两件事，且两件都没做

| | road · D2「地点连路」 | river · R-MAP-21「沿地势画河」 |
|---|---|---|
| 输入 | 两个 `isPlace` 地点 | 地势高程（尚不存在） |
| 算法 | `buildInitialRoad`：中点 + 垂直 fbm 偏移插 1~2 控制点 | flux 水流累积（业界成熟但不"贴 PNG 好看"） |
| 代码现状 | **函数不存在**（`generateRoad` / `buildInitialRoad` 全仓零命中） | **无设计**（生成器侧一行未写） |
| 归属结论 | **B4 明确"不做"**：需要连接图模型，先把「手画」做对 | **P1 有号未设计**：折线能力已就绪，等排期 |
| 需求号 | **无**（不立号） | **R-MAP-21 取舍②** |

两者**不可互相引用为"已实现"**：D2 的 `buildInitialRoad` 产出的是「两点之间的路」，
R-MAP-21 产出的是「贴地势的水系」；即使将来做了 D2，也不等于河流能自动生成。

**并且，本文把它们与 §3.4 的「无主遗留」严格区分**：R-MAP-21 有号、有归属、有解锁条件，
是"有号未设计"；§3.4 的 R-MAP-06 等是"没人认领"。不要混为一谈（`map-window-overview.md:100`
vs `:119`）。

### 裁定 3 · 三篇文档的冲突点逐条落判

| # | 冲突 | 一方说法 | 另一方说法 | **本文裁定** |
|---|---|---|---|---|
| C1 | 道路能不能自动生成 | road 篇：道路自动生成 = 给初始折线路径（D2） | 生成器零产线；B4 判「不做」 | **不能**。road 篇 `:27` / `:92` 是**设计提案**，`:186-187` 的 `generateRoad` / `buildInitialRoad` 是**改动清单的待办项**，不是交付记录；B4 `:412` 的「不做」是**最终裁定**，早于且高于 road 篇 |
| C2 | 「自动」的范围 | elements 篇：水系**不**自动生成（§3.4） | road 篇：道路**自动**生成（§2） | **两句都对，只是说的不是一件事**——但拼起来会误读成「道路已自动、水系没做」。统一口径：**四类全部手画**；「道不道自动」与「水不水自动」是两个未开工的设计项，不是两个实现状态 |
| C3 | `kind` 到底落没落 | b4 篇：`kind` 四类 + 五档样式已落（2.30.0 / 2.31.0） | road / elements 篇：大量「自动生成」表述 | **不矛盾，是时态差**。结构层是**完成时**（`types.ts:108` 五值、`polylineStyle.ts:95-142` 五档）；生成层是**没有时**（生成器零产线）。任何句子都要标清说的是结构还是生成 |
| C4 | R-MAP-21 算不算欠账 | 总览 §3.2：P1「折线能力已就绪，生成器侧未设计」 | road 篇把自动连路写成方案主体 | **算"有号未设计"，不算"无人认领"**。它有编号、有归属、有明确缺口形态；不要归到 §3.4 无主遗留，也不要因为 road 篇有方案就认为它已排期 |

---

## 3. 本文不裁定的两件事（防越界）

1. **`road` D2 要不要真做**：本文只裁定「现在没做」，不裁定「该不该做」。取舍属产品决策，
   依据见 `map-b4-layers-polyline-prd.md:412`（需要连接图模型）。
2. **R-MAP-21 什么时候做**：本文只裁定它「有号、未设计」，排期看
   `map-window-overview.md` §3.2，不在此处给时间。

---

## 4. 复核命令（四条，缺一即本文失据）

```bash
# ① 一键成图对折线零产出（期望输出 0）
grep -c "polyline\|Polyline" src/windows/MapWindow/pages/MapEditorPage/domain/generator.ts

# ② 折线唯一创建链（期望只有一处非测试调用点：index.tsx）
grep -rn "addPolyline(" src/windows/MapWindow --include=*.ts --include=*.tsx | grep -v test

# ③ road 篇的自动生成函数在代码里不存在（期望无输出）
grep -rn "generateRoad\|buildInitialRoad" src/

# ④ 四类样式已落、route 未落（期望只出现四个 kind 值）
grep -n "kind: \"" src/windows/MapWindow/pages/MapEditorPage/polylineStyle.ts
```

---

## 附：一句话速记

> **结构已落（四类 + 一档预留），生成全无（零产线），四类一律手画。**
> 谁想让某类线自动生成，先交生成器代码，再改本文 §1 对应格的状态。
