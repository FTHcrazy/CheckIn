# novel 域窗口「立体感与交互感」改造方案

> 定位锚点：柔和 · 轻量 · 卡片式 · 桌面（hover/点击为主）· 四主题（aurora 柔雾紫蓝 / cream 奶油暖橘 / mint 薄荷清新 / midnight 月夜暗色）· 写作工具。
> 交付形态：**方案文档（本文）**，不含代码改动。落地按 `P0-A → P0-B → P1 → P2` 分批实施，每批独立可验证。
> 一句话定位：**不是"加更多阴影"，而是把"hover 才有的层次"提前到"静止态就有的层次"，并把散落的动效收敛成一组可被守卫校验的 token。**

---

## 0. 总览（TL;DR）

| 维度 | 现状 | 目标 | 手段 |
|------|------|------|------|
| 立体感 | 静止态 Z 轴塌陷，只剩 1px 描边 + ~1.04 亮度差分家 | 静止态即有「内容面浮起」的完整递进 | 新增 5 档阴影 + 明度分层 + 细边框 + 轻阴影「三件套」 |
| 交互感 | 动效各自为政（100~320ms + 3 种缓动混用） | 一组可守卫校验的 motion token | 时长标尺 120/180/260ms + 标准缓动 + 按下即反馈 + 三态明确 |
| 一致性 | 阴影双轨（`--app-shadow-*` vs `--app-mask`）、hover 反馈两套语言 | 全域一套阴影体系 + 一套 hover 语言 | 收敛 shadow token、统一网格/列表/节点 hover 反馈 |

**两条红线（贯穿全程）：**
1. **暗色靠「明度 + 描边」不靠阴影**——midnight 下阴影打不出来，立体感由 `--app-surface-elevated` 更亮的面 + 描边兜底；
2. **动效确认交互、不娱乐**——写作工具每一帧都回答「刚才发生了什么」，编辑正文区是「零动效区」。

---

## 1. 现状问题诊断（逐页）

### 1.0 总体病灶（两句话）

1. **阴影几乎全部退化成 hover 才出现的"隐藏反馈"**：静止态下 `bg → surface` 只剩 1px 描边 + 约 1.04 的亮度差分家，Z 轴在"内容面"这一层塌了。
2. **动效各自为政**：时长 100/120/140/150/160/180/200/220/320ms 混用；缓动 `ease`（多数）、`cubic-bezier(0.22,0.61,0.36,1)`（账本域）、`cubic-bezier(0.4,0,0.2,1)`（抽屉/进度条）、`cubic-bezier(0.3,1,0.5,1)`（EntityDetail）并存。→ 整体读起来「平、静、散」。

> 关键认知：**这不是零基础的补课，而是"有但不统一"的收口。** 项目里已存在大量精良细节（BookCard `translateY(-2px)`、章节树拖拽 drop 高亮、删除按钮宽度展开、状态点缩放、EntityDetail 滑入、关系图节点 hover + 手柄缩放、行囊折叠 0fr/1fr、全局设定 hover 才亮操作钮……），问题在于它们**散落、未成体系、未统一缓动、且阴影/层级偏保守**。

### 1.1 书架页 BookshelfPage

- **现状**：页面底 `--app-bg` ✓；统计条 / ContinueHero 有 `--app-shadow-card` ✓；但**书卡网格、灵感卡、新建卡静止态全部无阴影**。
- **扁平成因（证据）**：`BookCard/index.scss:24-36` 基础态只有 `border:1px solid var(--app-border)`，`box-shadow` 只写在 `:hover`；`IdeaNoteCard` / `NewWorkCard` 同理（hover 才出 `--ant-button-default-shadow`）。
- **做得好**：BookCard 有 `translateY(-2px)` hover + `0.18s ease`；Cover 有径向光斑；ShelfToolbar / IdeaRail 的 chip hover 通过改 `--ant-button-default-shadow` 变量出投影（正确姿势）。
- **缺口**：① 静止态缺一档「ambient 环境阴影」；② 三套时长（0.18s / 160ms / 0.15s）并存；③ 网格（浮起）/ 列表（换底色）两套 hover 语言。

### 1.2 编辑页 NovelPage（最高频主场景，扁平最集中）

- **现状**：结构齐全，但**编辑器主面 `.nv-editor` 连 border 和 box-shadow 都没有**。
- **扁平成因（证据）**：`EditorPane/index.scss:6-13` `.nv-editor { background: var(--app-surface); }` 无描边无投影，与页面底只差 1.04 亮度；左栏 `--app-sidebar-bg`、右栏 `--app-surface-alt`，与编辑器之间只靠 1px `border-right/left` 分家；`EntityCard` 基础态仅描边、hover 才 `translateY(-1px)+shadow-card`。
- **做得好**：EntityDetail 滑入入场；进度条用 transform 填充；浮层类（HoverEntityCard / ContextMenu / Palette / Drawer）正确用 `elevated + pop`；EditorPane 已用 `var(--nv-t-fast,120ms)` 私有 motion 变量 + `prefers-reduced-motion`。
- **缺口**：① 编辑器主面无「内容面浮起感」；② 左/中/右三栏是「三块平铺的面」，缺完整 Z 递进；③ `StatusBar__fill` 用 `transition: width 320ms`（布局属性，触发 reflow），与 Hero `__bar-fill` 用 transform 的做法**自相矛盾**（Hero:90 注释自己都写「禁止 transition width」）。

### 1.3 行囊 PackWindow

- **现状**：底色已修为 `--app-bg` ✓；zone / board 卡有 `--app-shadow-card` ✓；但**模块壳 PackModuleShell 静止态只有 border**。
- **扁平成因**：`PackModuleShell/index.scss:5-8` `.cpk-mod` 无阴影；工作区内模块被退化成「发丝线分节」，立体感只靠外层 zone 那一层。
- **做得好**：折叠用 `grid-template-rows 0fr/1fr` 平滑过渡；自绘 ripple；保存按钮呼吸动画；头部图标放大有守卫钉住。
- **缺口**：① 折叠 `transition: grid-template-rows` 是布局属性过渡（可接受非最优）；② 模块行 hover 只有底色变，缺轻量抬升/描边；③ 静止态模块无 ambient 阴影。

### 1.4 全局设定中心 GlobalSettingWindow（改造优先级最低）

- **现状**：**已是四页里「卡片化」最完整**——三张卡都 `surface + 1px 描边 + shadow-card`。
- **缺口**：行 hover 只有 `--app-surface-alt` 底色，无 transform/阴影；字号 11px 残留被窗口皮肤强制抬到 12px（说明此处更关心密度/可读性而非立体感）。

### 1.5 关系图 RelationWindow

- **现状**：节点/详情卡/工具条用 `--app-surface-elevated` ✓，但**阴影走第二套体系**。
- **关键证据**：全窗口 0 处用 `--app-shadow-*`，而是用 `var(--app-mask)` 当阴影色 + 手写偏移（`EntityNode:17` `0 1px 3px var(--app-mask)`、`NodeDetailCard:16` `0 12px 32px var(--app-mask)`、`RelationCanvas:43` `0 2px 6px var(--app-mask)`）。`--app-mask` 本义是「遮罩」，色相/浓度与 `--app-shadow-*` 三套 rgba 不一致。
- **做得好**：节点选中 `color-mix` 外发光；手柄 hover `scale(1.35)`；密度档过渡。
- **缺口**：① 阴影双轨需收敛；② 字号 10~11.5px 满天飞（可读性，附带）。

---

## 2. 立体感提升策略

> 原则：**「明度分层 + 细边框 + 轻阴影」三件套**是立体感最稳妥来源；质感走「轻盈抬升」而非「厚重浮雕」；**永不用大范围噪点 / 重内阴影**。

### 2.1 阴影分级（Elevation Scale）

现有 3 档不够，扩展为 **5 档**（新增 `ambient` 与 `raised` 两档）：

| Token | 用途 | 建议值（以 aurora 蓝 tint 为例，各主题换色值不改结构） |
|-------|------|------|
| `--app-shadow-ambient`（新增） | **静止卡片**环境阴影，解决「静止态全平」 | `0 1px 3px rgba(53,64,101,0.05)` |
| `--app-shadow-card`（沿用） | 内容面卡片基准 | `0 6px 16px rgba(53,64,101,0.07)` |
| `--app-shadow-raised`（新增） | **hover 抬升**，与 `translateY(-2px)` 配套 | `0 8px 20px rgba(53,64,101,0.10)` |
| `--app-shadow-pop`（沿用） | 浮层 / 抽屉 / 右键菜单 | `0 10px 30px rgba(53,64,101,0.14)` |
| `--app-shadow-window`（沿用） | 窗口外壳 inset | 不变 |

**四主题兼容**：themes.scss 每个 `[data-theme]` 块补同名变量，色值按各主题 bg 色相各写一份（aurora 蓝 / cream 棕 / mint 绿 / midnight 黑），**禁用单一纯黑**。守卫自动兜底：`themes.test.ts` 已有「四套主题共用同一组变量名」用例（`collectVars` 取第一块集合并 `toEqual` 其余块），新增变量四套不同步补齐会**自动红**，无需新写守卫。

### 2.2 层级（Z 轴递进）

- **浅色主题**：`bg（最底）→ sidebar/alt → surface（内容面）→ elevated（浮层）`，方向「越低越深」已成立，本次补齐的是**内容面这一层的「静止浮起」**——给 surface 卡片补 ambient 阴影，让它在 bg 上「站」起来，而不是只靠描边贴平。
- **暗色主题（midnight）**：阴影失效，改靠**更亮的 elevated 面 + 描边**兜底（现有 `--app-surface-elevated` #262b38 比 surface #1d2029 亮，方向正确，保持即可）。hover 不用微弱透明度变化（人眼难察觉），改「浅灰背景 + 柔和高亮」。

### 2.3 景深 / 透视

- **不做**真 3D 透视（`perspective` / `rotateX`）——与「柔和轻量」冲突，且四主题下难统一。
- 用**「抬升幅度 + 阴影扩散」的配合**模拟景深：越「近」的层阴影越轻、偏移越小（ambient 1px）；越「远」的浮层阴影越重、偏移越大（pop 10px）。层次差由「亮度 + 阴影」双重表达，而非几何透视。

### 2.4 质感（轻盈抬升三件套）

1. **顶部 1px 高光边缘**：`inset 0 1px 0 rgba(255,255,255,0.6)`（仅浅色主题），让卡片「轻轻浮起」；
2. **细微渐变填充替代纯色**：`linear-gradient(180deg, #ffffff 0%, #fbfaf8 100%)`（可选，P2 精修时用）；
3. **多层低不透明度阴影栈**（Notion 式）：`0 1px 2px + 0 2px 8px` 两层叠加，比单条硬阴影更轻盈自然。

> 已存在的「好质感」保留并推广：BookCard Cover 的径向光斑、封面字符的 `text-shadow` 微投影。

---

## 3. 交互感增强策略

> 原则：动效目的 = 确认交互，不是娱乐；`≤260ms` 克制；**按下即反馈（pointer-down）**；**三态明确**（Figma 式 hover→选中→拖拽）。

### 3.1 缓动曲线（3 条够用）

| Token | 值 | 用途 |
|-------|-----|------|
| `--app-ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | 默认：hover / 状态切换（与现有抽屉/进度条一致） |
| `--app-ease-emphasized` | `cubic-bezier(0.3, 1, 0.5, 1)` | 强调入场（与 EntityDetail 一致） |
| `--app-ease-spring` | `cubic-bezier(0.32, 0.72, 0, 1)` | 抽屉 / 面板滑动、拖拽释放（仅拖拽允许轻微回弹 damping≈0.8） |

### 3.2 时长标尺（写作工具更短更克制）

| Token | 值 | 用途 |
|-------|-----|------|
| `--app-t-fast` | 120ms | 颜色 / 描边 / 背景微反馈、按钮 hover、图标态 |
| `--app-t-normal` | 180ms | hover 抬升、卡片、选中态、侧栏项 |
| `--app-t-slow` | 260ms | 抽屉 / 面板滑动、入场（上限，不用 300ms+） |

> 说明：现行代码里有 100/140/150/160/200/220/240/320ms 等散值，收口到这三档（个别可保留 80ms「按下/焦点环」即时档，见 3.4）。

### 3.3 hover / active 反馈梯度（统一语言）

```
.card {
  transition: transform var(--app-t-normal) var(--app-ease-standard),
              box-shadow var(--app-t-normal) var(--app-ease-standard),
              border-color var(--app-t-normal) var(--app-ease-standard);
}
.card:hover  { transform: translateY(-2px); box-shadow: var(--app-shadow-raised); border-color: var(--app-border-strong); }
.card:active { transform: translateY(0); transition-duration: var(--app-t-fast); }
```

- **统一「网格 / 列表 / 节点」三套 hover 语言**：网格卡 = 抬升 + raised 阴影；列表行 = 底色 + 描边 + 箭头位移（保留现有 BookCard 列表行的正确决策，但时长/缓动统一到 token）；关系图节点 = 描边 + 阴影双轨收敛后统一。
- **enter/exit 非对称**：进场用 emphasized 稍长（260ms），退场用 ease-in 更短（160ms）且更快——「来得从容、走得利落」。

### 3.4 按下即反馈（Apple 原则）

```
.button:active { transform: scale(0.97); transition: transform 80ms ease-out; }
```

- 反馈在 **pointer-down** 而非 release；`80ms` 即时档可单独保留为 `--app-t-instant`。
- 项目已有 `NovelFloatButton:active scale(0.96)`、关系图节点 `cursor: grabbing` 等，收口统一即可。

### 3.5 拖拽手感（章节树排序 / 书架卡 / 关系图节点）

- 1:1 跟踪 + `setPointerCapture` + 释放继承速度（velocity handoff）；
- 仅拖拽释放用 `damping≈0.8` 的轻微回弹，其余场景临界阻尼；
- 目标位置给吸附对齐 + 插入提示线（章节树已有 `is-drop` 上缘指示线，保留并统一色值）。

### 3.6 内容进场 stagger（克制）

- 弹层 / 抽屉 / 面板首次展开用 `fadeRise 240ms + nth-child 30~50ms 递增`；
- 写作主界面**不启用**光标跟随 / parallax，避免干扰输入焦点。

### 3.7 焦点态（桌面键盘可达性）

- `:focus-visible` 用 2px ring（`0 0 0 2px var(--app-primary)`）+ 3:1 对比，**80ms 即时出现**，不能只依赖 hover；
- 项目已有大量 `:focus-visible outline 2px` 写法，保留并统一 ring 形态（用 box-shadow 而非 outline，避免与 antd 冲突）。

---

## 4. 分页面改造建议与优先级

| 优先级 | 页面 | 收益 | 风险 | 具体改造项 |
|--------|------|------|------|-----------|
| **P0-A** | 书架 BookshelfPage | 高（门面页） | 低 | ① 书卡/灵感卡/新建卡静止态补 `--app-shadow-ambient`；② hover 抬升统一 `raised` + `translateY(-2px)`；③ 时长/缓动收敛到 motion token |
| **P0-B** | NovelPage 编辑器主面 | 最高（主场景） | 中 | ① `.nv-editor` 加「内容面浮起感」（ambient 阴影 + 可选 1px 描边，不占布局、不干扰 CodeMirror）；② 统一左/中/右三栏层次递进；③ 修 `StatusBar width 320ms` → transform |
| **P1** | 行囊 PackWindow | 中 | 低（共享组件多处受益） | ① 模块静止态补 ambient；② 模块行 hover 加轻量抬升/描边；③ 折叠动画缓动统一；⚠️ 会同时影响 NovelPage 内嵌行囊，需回归 |
| **P1/P2** | RelationWindow | 中 | 中（第三方 React Flow） | ① 阴影双轨收敛：`--app-mask` → `--app-shadow-*`（或独立 graph 阴影 token）；② 节点立体感；③ 字号 10~11.5px 可读性 |
| **P2** | GlobalSettingWindow | 低 | 低 | 已最完整，仅行 hover 补轻量反馈，暂缓 |

**实施顺序建议**：先建基础设施（5 档 shadow token + motion token，见 §5），再以 **P0-A 书架为试点**验证 shadow 分级与 motion 标尺，通过后铺 P0-B 编辑器，再 P1、P2。

---

## 5. 技术实现要点

### 5.1 Token 落点（关键决策）

- **阴影 5 档**：进 `themes.scss` 每个 `[data-theme]` 块（四套各写色值），由「四套主题共用同一组变量名」守卫自动校验同步。
- **motion token（时长 + 缓动）**：**不进 data-theme 块**（不随主题变，四套重复违和），放全局 `:root`（可置于 themes.scss 顶部，或新建 `shared/styles/motion.scss` 由窗口入口引入）。
- **前缀拍板**：统一用 `--app-*` 前缀（如 `--app-t-fast` / `--app-ease-standard`），这样 `themes.test.ts` 的「`--app-*` 引用完整性」守卫会自动覆盖。**顺带收口** `EditorPane` 里 `var(--nv-t-fast, 120ms)` 这种带 fallback 的散落写法。

### 5.2 antd v6 边界（硬约束，不能踩）

- `transform / transition / animation / will-change` 是 antd 不接管属性，可直接写 scss；
- **hover/active 的颜色·背景·边框必须走 `--ant-*-hover-bg` 等组件级变量**，不能写 `:hover{background}`（会被 antd (0,4,0) 压掉）；
- **给 antd 按钮加 hover 抬升阴影只能改 `--ant-button-default-shadow` 变量**（antd 无 hover 阴影变量）——ShelfToolbar / NewWorkCard / EntityCard 已是这个正确姿势，改造沿用，不要写 `box-shadow` 属性。

### 5.3 性能

- **只动 `transform / opacity`**（合成属性，不触 layout/paint）；禁止 transition `width/height/margin` 等布局属性（`StatusBar width 320ms` 是现存反例，要改）；
- 阴影动画是重绘大户：hover 时「预置阴影层 + 只切透明度」，避免每帧重算多层阴影；
- `will-change` 只给抽屉滑入、卡片抬升这类高频元素，**不要**给每张 hover 卡都加（内存膨胀）；
- 窗口 resize / 内容重渲染避免 `@keyframes` 入场（会被钉在 0 帧），优先 CSS transition（可中断、可重定目标）。

### 5.4 外阴影安全性（已确认）

- **窗口内部组件的普通外阴影是安全的**，只有窗口外壳 `.window-shell` 这一层受限（透明窗口方形边界裁掉外阴影，故外壳用 inset）；
- 但**贴住窗口四角 / 外壳边缘的全屏面板**若用外阴影会延伸到圆角外被裁——贴边元素慎用外阴影（转描边或 inset）。

### 5.5 可访问性

- 全局 `prefers-reduced-motion: reduce`：把位移/缩放降级为「即时状态 + 轻微 opacity」，保留内容可见性（现有 7 处零散覆盖应收口到 motion.scss 统一处理）；
- 焦点态独立清晰（2px ring + 3:1 对比），不依赖 hover；
- 暗色主题 hover 用「浅灰背景 + 柔和高亮」，focus 给足描边/高光。

### 5.6 测试红线（改造不得触发）

- 新增阴影不碰「常驻色块不用按下态色」守卫（`--app-surface-active` 只留交互态）；
- 浮层加阴影仍用 `--app-shadow-pop`，**不动 `--app-surface-elevated` 白名单**；
- motion token 用 `--app-*` 前缀后，需在 themes.scss `:root` 定义，否则「引用完整性」守卫红。

---

## 6. 落地检查清单（实施时逐项勾选）

- [ ] themes.scss 四主题各补 `--app-shadow-ambient` / `--app-shadow-raised`（色值按色相 tint）
- [ ] 新建 / 扩展 motion token（`--app-t-fast/normal/slow` + `--app-ease-standard/emphasized/spring`）到 `:root`
- [ ] 收口 `--nv-t-fast` 散落写法 → `--app-t-fast`
- [ ] P0-A 书架静止态补 ambient，hover 统一 raised
- [ ] P0-B `.nv-editor` 补内容面浮起感 + 修 StatusBar width→transform
- [ ] P1 行囊模块 ambient + hover 轻抬升 + 折叠缓动统一
- [ ] P1/P2 关系图阴影双轨收敛
- [ ] 全局 `prefers-reduced-motion` 收口
- [ ] 跑 `themes.test.ts` / `novel-ui-kit.test.ts` / `pack-ui-kit` 相关守卫全绿
