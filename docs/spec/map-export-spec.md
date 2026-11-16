# 地图导出规格（活规范）

> 状态：**定稿**（现行为即规格；本批不改代码，差异项登记在 §8）
> 输入：[`map-interaction-spec.md`](map-interaction-spec.md)（定稿，导出期间选中框时序）、[`../prd/prd-map-render/map-window-overview.md`](../prd/prd-map-render/map-window-overview.md)（维护中）
> 基线：CheckIn **2.36.0**（工作区）｜`src/windows/MapWindow/` 44 文件 / 750 用例

---

## 0. 实现唯一的两个文件

| 层 | 文件 | 职责 |
|---|---|---|
| 纯函数 + 取图 | `src/windows/MapWindow/pages/MapEditorPage/export.ts`（**216 行**） | `tilePlan`（切块方案）/ `exportMapPng`（渲成字节）/ `savePng`（落盘） |
| 触发与提示 | `src/windows/MapWindow/pages/MapEditorPage/index.tsx` | `handleExport`（用户导出，`:319`）/ `handleOpenLibrary`（缩略图，`:410`） |

**两个调用点，不是一个**（这是最容易写错的地方）：

| 调用方 | 传的 longSide | 落盘 | 代码 |
|---|---|---|---|
| 用户点「导出」 | `exportSize`（1024 / 2048 / 4096） | `savePng` | `index.tsx:324-339` |
| 打开地图库前抓缩略图 | **320**（写死） | `persistence.saveThumb`（走 `map-doc-thumb`，上限 256KB） | `index.tsx:414-425` |

---

## 1. DPR / 倍率

**现行为**：导出**与设备像素比（DPR）完全解耦**。`extract` 的 `resolution` 被硬编码为 `1`，倍率改在 `world.scale` 上。

| 事实 | 代码落点 |
|---|---|
| `resolution: 1`（注释：倍率已在 `world` 的 scale 上，这里保持 1 免得乘两遍） | `export.ts:176` |
| 每块渲染前 `world.scale.set(plan.scale)`、`world.position.set(-originX*scale, -originY*scale)` | `export.ts:169-170` |
| 倍率定义：`scale = longSide / max(纸宽, 纸高)` | `export.ts:66` |
| 取图开抗锯齿 | `export.ts:177`（`antialias: true`） |

**规格口径（换算公式，直接照用）**：

```
scale  = longSide / max(world.width, world.height)          // export.ts:66
W      = round(world.width  × scale)                        // export.ts:67
H      = round(world.height × scale)                        // export.ts:68
物理像素 = 逻辑世界单位 × scale；一次导出内 scale 恒定（不按块变）
```

- **长边定倍率、短边跟同一倍率**（`export.ts:56-58` 注释）：两张纸并排比对时比例必须一致，**不**分别按各自长边缩放。
- `scale` 有下限 `1e-6`、`W/H` 有下限 1（`export.ts:66-68`），退化输入（0 宽纸）不会产出 `Infinity` 或 0 像素。
- 例：1024×2048 的纸，`longSide=2048 → scale=1 → 1024×2048`；`longSide=4096 → scale=2 → 2048×4096`。

> 推论（写验收/对照图时按这条）：**同一张纸导 2048 与 4096，画面内容完全一致，只是像素翻倍**；不存在「4096 档换了取景」。

---

## 2. 目标尺寸

| 事实 | 代码落点 |
|---|---|
| 尺寸档 = 长边像素，三档 `[1024, 2048, 4096]` | `export.ts:23`（`EXPORT_SIZES`） |
| 默认档 **2048**（理由：4096 的图约 30MB，不该是默认动作） | `export.ts:25`（`EXPORT_DEFAULT_SIZE`） |
| UI 三档下拉，标签 `${size}px`，写在「更多」面板里 | `index.tsx:1929-1934` |
| 输出画布整幅尺寸 = `plan.width × plan.height` | `export.ts:152-154` |

**规格口径**：

1. 档位是**长边物理像素**，不是 DPI、不是厘米。纸是方形还是长条，由 `worldRect` 的宽高比决定。
2. **导出区域 = 纸张矩形本身**（`worldRect` 来自 `MapCanvas` 的 `rect: BASE_RECT`，`components/MapCanvas/index.tsx:1368`；传入点见 `index.tsx:329`）。因此成品图**不含**图纸投影（`SHEET_SHADOW`）、**不含**海岸余量、**不含**四周留白——那些都在 `world` 之外或 `frame` 之外。
3. 尺寸档与「纸张物理尺寸」无关，改纸张尺寸不会自动改档位。

---

## 3. 分块上限

| 事实 | 代码落点 |
|---|---|
| 单块最大边长 `EXPORT_TILE_MAX = 8192` | `export.ts:33` |
| 阈值下限 256（防「传 0 被切成上千条 1px 缝」） | `export.ts:71`（`Math.max(256, Math.trunc(tileMax))`） |
| 列数 / 行数 = `max(1, ceil(W / max))` / `max(1, ceil(H / max))` | `export.ts:72-73` |
| 单块像素 `ceil(W / cols)` / `ceil(H / rows)` | `export.ts:78-79` |
| 逐块 `drawImage` 拼到整幅输出画布 | `export.ts:179-185` |

**规格口径**：

```
max   = max(256, 8192) = 8192
cols  = ceil(W / 8192)   rows = ceil(H / 8192)
4096 档永远 1×1（4096 ≤ 8192）；三档 UI 均不会触发切块
```

- 8192 这档是**护栏**，不是体验路径：留给「纸张比例极端」与「将来放开尺寸档」（`export.ts:30-32` 注释）。
- 拼缝对齐的依据是「把这一块的世界左上角搬到输出画布左上角」（`export.ts:165-170`），每一块的像素位置是确定整数格，因此不需要额外缝合逻辑。

---

## 4. 透明底

**现行为**：输出 PNG 是 **RGBA**（`encodePng` 走 `canvas.toBlob(..., "image/png")`，`export.ts:120-129`）。代码**没有**给输出画布或渲染器设任何底色：

| 事实 | 代码落点 |
|---|---|
| 输出画布是新建的裸 `canvas`，**不填背景**，`extract` 的帧区内容原样 `drawImage` 上去 | `export.ts:152-155`、`:179-185` |
| 渲染应用 `new Application()` **未设 `backgroundColor`** | `components/MapCanvas/index.tsx:1230` |
| 纸面之所以不透明，是因为「海面纹理铺满整张纸」：`sea.width/height = BASE_IMAGE.width/height`、锚点居中 | `components/MapCanvas/index.tsx:1487-1499` |
| ⚠️ 但那个 effect 有 `if (tex)` 前置：**纹理未就绪时海面精灵没有纹理，什么也不画** | `components/MapCanvas/index.tsx:1490-1491` |

**规格口径**：

1. **纸面不透明性来自底图（海面）纹理，不是来自底色兜底**。纹理未加载时导出的纸面区域会保持透明（alpha=0），代码里没有第二道保险。
2. 实践中不会踩到：导出入口先判 `if (!scene || exporting) return`（`index.tsx:321`），`scene` 由 `onSceneReady` 在渲染器就绪后才交出，此时纹理已到；缩略图路径同款（`index.tsx:410`）。
3. **不做**「导出必带不透明底」这个保证：若将来出现「纹理加载慢 + 用户极快点击导出」的时序，成品会是透明底而非白底。此条登记为差异项（§8 序 4）。

---

## 5. 格式范围（SVG / PDF 做不做）

**现行为**：**只有 PNG**。

| 事实 | 代码落点 |
|---|---|
| 唯一编码格式 `image/png` | `export.ts:129` |
| 落盘参数固定 `"png", "PNG 图片"`（走 `electronAPI.novel.exportBinary`，主进程按 `Buffer.from` 原样写字节） | `export.ts:211` |
| ⚠️ 绝不能用 `exportFile`（utf8 文本通道）写 PNG：会得到**打不开的文件且零报错** | `export.ts:14-16`、`:201-203`，守卫 `export.test.ts`「只用 exportBinary，绝不出现 exportFile 调用」（:321） |

**SVG：本批不做。** 理由：渲染栈是 Pixi/WebGL 位图管线（9 层容器 + `RenderTexture` 静态烘焙 + 滤镜/羽化/纹理平铺，见 `components/MapCanvas/index.tsx:606` 的层序注释），**没有矢量源**。要出 SVG 必须另建一套矢量序列化器（陆地多边形 / 区块 / 折线其实有几何，但纸纹、海面纹理、海岸羽化、素材 PNG 无法矢量表达），产出会与屏幕所见**明显不同**，等于第二个渲染器。

**PDF：本批不做。** 理由与量化依据：
- PDF 的目标是**印刷**，需要「物理尺寸 + DPI」语义，而现有模型只有「长边像素」（§2 第 1 条），先要新增纸张尺寸/DPI 概念。
- 但**现状已够交付印刷级**：4096 长边在 A4 比例（1:0.707）下约 **2896×4096**，已超过 A4 @300 DPI 的 **2480×3508**。也就是说「不做 PDF 也不挡 A4 印刷」。

**解锁条件（可判定，不是「以后再看」）**：
1. SVG：出现「需要二次编辑成品图（AI/Inkscape）」的明确诉求 ≥1 次，且接受「与屏幕所见不一致」的取舍；
2. PDF：出现**指定物理尺寸 + ≥300 DPI** 的交付需求 ≥1 次（例如「出一张 A2 挂图」），或需要多页/出血。

---

## 6. 命名规则

| 事实 | 代码落点 |
|---|---|
| `savePng(bytes, defaultName)` 只透传名字，自身不拼名字 | `export.ts:204-216` |
| 用户导出传 **`地图-${exportSize}.png`** | `index.tsx:339` |
| 缩略图路径**不经过 `savePng`**（走 `map-doc-thumb` + `persistence.saveThumb`） | `index.tsx:425`、`persistence/useMapPersistence.ts:339-348` |

**规格口径（默认文件名）**：

```
地图-<长边像素>.png        例：地图-1024.png / 地图-2048.png / 地图-4096.png
```

- **不含**地图名、**不含**时间戳、**不含** seed、**不含**纸张尺寸。
- 用户导出永远是上面那个名字（同名由系统保存框处理，主进程不自动加序号）。
- 保存框返回 `null`（用户取消 / 主进程未提供 `exportBinary`）时，UI 提示「已取消导出」（`index.tsx:341`）。
- 程序默认名到此为止。**基线图（前后对照留证）的文件名另有规定，见 §6.1**——两者不要混用。

### 6.1 基线图命名与入库（**基线图命名的唯一来源**，T12 / T13 引用本节）

> 程序默认名（上节）与**基线图入库文件名**是两件事：前者由代码产出、本批不改；
> 后者是文档侧的入库约定，由本节规定。两者不要互相套用。

| 项 | 规定 |
|---|---|
| **存放目录** | `docs/assets/map-baselines/`（新建目录可用；**目录本身不入 `docs/README.md` 索引**，只有文档入索引） |
| **入库限制** | **只允许 1024 档**，且单张 **≤300KB**。2048 / 4096 档**不入库**，只在对照记录里写度量数字 + 生成命令（4096 单张 30MB 量级，进仓即毁 clone 体验） |
| **文件名** | `<版本>-seed<seed>-地图-<长边像素>.png`　例：`2.28.0-seed20260411-地图-1024.png` |
| **不使用程序默认名的理由** | §6 已明说程序默认名 `地图-<长边像素>.png` **不含** seed / 版本 / 纸张，同一张纸的前后两组对照图会**同名互相覆盖**；「靠图注区分」在文件系统层面不成立（同名文件只有一个） |
| **动作归属** | 基线图入库是**人工重命名**动作，不是代码改动；§8 序 1「默认名加地图名」仍属后续项，不因本节而提前 |

**引用规则**：`T12 子图边界验收` 与 `T13 2.28.0 同 seed 对照` **只能**用本节格式；
对照记录里引用基线图时，必须同时写出「版本 + seed + 档位」三要素，不得只引文件名。

---

## 7. 超大图与失败行为

### 7.1 超大图

| 场景 | 现行为 | 依据 |
|---|---|---|
| UI 三档（≤4096） | 永远 1 块，`out` 画布 4096 长边 | `export.ts:23`、`export.ts:68` |
| 「纸张比例极端」使 W 或 H > 8192 | 自动切块（16384 长边 → 2×2，每块 8192） | `export.ts:72-73`；守卫 `export.test.ts`「超过上限才切块：16384 长边 → 2 × 2，每块正好 8192」（:79） |
| 整幅尺寸超过浏览器 canvas 面积/边长上限 | **没有校验**：`out.width/height` 直接赋值（`export.ts:153-154`），超限时表现为取图抛错或得到空白/黑图 | 反向证据：`export.test.ts` 里没有任何面积断言 |

**规格口径**：切块是**单块边长的护栏**，不是**整幅面积的护栏**。整幅仍一次性分配 `W×H` 的 2D 画布。当前 UI 到不了这个边界（最大 4096），所以是「已知但暂不处理」项（§8 序 3）。

### 7.2 失败行为矩阵

| 现象 | 代码落点 | 用户看到 | 守卫 |
|---|---|---|---|
| 拿不到 2D 上下文（jsdom / 环境不支持） | `export.ts:161` `if (!ctx) return null` | 「当前环境不支持导出图片」（`index.tsx:336`） | — |
| `toBlob` 不可用 / 编码返回空 / `arrayBuffer` 失败 | `export.ts:116-130` 一律 `resolve(null)` | 同上 | `export.test.ts`「用户取消（返回 null）→ 不报错，返回 null」（:304） |
| `extract` 中途抛错（上下文丢失等） | **不捕获**：`finally` 复原视口后异常继续上抛（`export.ts:188-193`） | 「导出失败，请重试」（`index.tsx:343`） | `export.test.ts`「中途抛错也要复原视口，并重新画出选中框」（:257） |
| 用户取消保存框 | `savePng` 返回 `null`（`export.ts:212`） | 「已取消导出」（`index.tsx:341`） | `export.test.ts`「用户取消（返回 null）→ 不报错，返回 null」（:304） |
| 主进程写盘抛错 | `savePng` `catch → null`（`export.ts:213-215`） | 「已取消导出」（**与取消同一句**，见 §8 序 2） | `export.test.ts`「主进程抛错 → 吞掉并返回 null（不把异常抛到 UI 事件里）」（:309） |

**两条不可破的时序（`finally` + 选中框）**：

1. **视口必须复原**：`prevX/prevY/prevScale` 在进入循环前存下（`export.ts:147-149`），`finally` 里 `world.scale/position` 摆回并 `redrawOverlay()`（`:190-192`）。失败的导出**不能**把画面留在某个切块的偏移上——那比导出失败更难受。守卫：`export.test.ts:249`（成功也要复原）、`:257`（抛错也要复原）。
2. **成品图里不能有选中框**：导出前 `clearOverlay()`（`export.ts:158`），导出后 `redrawOverlay()`（`:192`）。守卫：`export.test.ts`「导出前清空选中框、导出后重绘回来」（:208）。相关交互口径见 [`map-interaction-spec.md`](map-interaction-spec.md) §2 S-6。

---

## 8. 差异表（现行为 vs 应有规格）

| # | 差异 | 影响 | 处置 |
|---|---|---|---|
| 1 | 默认文件名固定 `地图-<档位>.png`，无地图名/时间戳 | 连导两张不同图会在保存框里同名，靠用户自己区分 | **改代码（不在本批）** —— 登记为后续项：改为 `<地图名>-<档位>.png`。按现状也说得通：单机个人库、导出低频，且地图名进文件名会带来非法字符清洗与截断规则（新成本） |
| 2 | 写盘失败与用户取消**给同一句**「已取消导出」（`export.ts:213` vs `:212`） | 磁盘满/权限问题会被读成「我点了取消」，故障被掩盖 | **改代码（不在本批）** —— 登记为后续项：`savePng` 返回值从 `string \| null` 改为可区分 `cancel \| error` |
| 3 | 整幅面积无校验（只有单块 8192 的护栏） | 仅当未来放开尺寸档或纸比例极端时才可能黑图/抛错 | **归后续批** —— 与「放开尺寸档」同批做（本批 UI 上限 4096，触发不了） |
| 4 | 纸面不透明性依赖海面纹理，无底色兜底 | 纹理未就绪时导出会是透明底（当前时序下不可达） | **按现行为定稿** —— 导出入口已由 `scene` 就绪前置（`index.tsx:321`），加兜底底色会改变「纸面=海面」的既有观感 |
| 5 | 无 SVG / PDF 导出 | 无法二次编辑、无法指定物理尺寸交付 | **归后续批** —— 明确不做，理由与解锁条件见 §5（4096 长边已覆盖 A4@300DPI） |
| 6 | PNG 不写 sRGB / 元数据 | 不同看图软件的色彩可能略有差异 | **按现行为定稿** —— `toBlob` 的默认行为，加色彩管理属独立课题，现无诉求 |
| 7 | 导出区域**不含**投影与四周留白 | 与画布所见不同（画布上纸外有一圈投影） | **按现行为定稿** —— 成品图只要纸面；这是刻意选择（`export.ts:9-12` 注释），验收对照图须按此理解 |
| 8 | 缩略图与用户导出**共用同一函数**，仅 `longSide` 不同（320 vs 档位） | 缩略图也走切块/`extract`/`finally` 全套逻辑 | **按现行为定稿** —— 320 长边远小于 8192，恒为 1 块；共用保证「列表缩略图 = 成品图缩略」 |

---

## 9. 复核命令（六项 + 失败行为一次验完）

```bash
# ① 常量与函数行号
grep -n "EXPORT_SIZES = \|EXPORT_DEFAULT_SIZE: \|EXPORT_TILE_MAX = \|export function tilePlan\|export async function exportMapPng\|export async function savePng" \
  src/windows/MapWindow/pages/MapEditorPage/export.ts     # → :23 / :25 / :33 / :59 / :142 / :204

# ② 倍率与分辨率（DPR 解耦的唯一证据）
grep -n "resolution: 1\|const scale = " src/windows/MapWindow/pages/MapEditorPage/export.ts   # → :176 / :66

# ③ 命名规则的调用点
grep -rn "savePng(" src/windows/MapWindow                  # → 仅 index.tsx:339 传真实默认名
grep -rn "exportMapPng(" src/windows/MapWindow             # → index.tsx:324（导出）/ :414（缩略图 320）

# ④ 透明底：应用未设底色 + 海面铺满整张纸且有 if (tex) 前置
grep -n -A2 "new Application" src/windows/MapWindow/pages/MapEditorPage/components/MapCanvas/index.tsx
sed -n '1487,1500p' src/windows/MapWindow/pages/MapEditorPage/components/MapCanvas/index.tsx

# ⑤ 格式范围：只有 png
grep -n "image/png\|\"png\", \"PNG 图片\"" src/windows/MapWindow/pages/MapEditorPage/export.ts

# ⑥ 导出区域 = 纸矩形
grep -n "rect: BASE_RECT" src/windows/MapWindow/pages/MapEditorPage/components/MapCanvas/index.tsx
```
