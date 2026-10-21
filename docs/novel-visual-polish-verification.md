# novel 域「立体感 · 交互感」改造 — 对照与验收清单

> 配套文档：改造方案 `novel-visual-polish-plan.md`、图形主题化规范 `graphic-theming-spec.md`、
> 开发规范 `AGENTS.md §6.1.3 / §6.1.4`。
> 本文是**落地后的对照 + 验收**，用于留档与真机走查。全部改动均为纯视觉/动效（SCSS + 极少量 TSX），无业务逻辑变更。

---

## 一、改造总览

### 1.1 一句话结论

不是「加更多阴影」，而是把「hover 才出现的层次」提前到「静止态就有的层次」，
并把散落的动效收敛成一组可被守卫校验的 token。

### 1.2 两条不可破的红线（全程守住）

1. **暗色（midnight）靠「明度 + 描边」不靠阴影** —— 黑底阴影打不出来；
2. **编辑正文区是「零动效区」** —— 动效只为确认交互、不为娱乐，写作专注优先。

### 1.3 完成批次

| 批次 | 对象 | 状态 |
|------|------|------|
| 基础设施 | shadow 分级 + motion token + mixin + 规范 | ✅ |
| P0-A | 书架页 BookshelfPage | ✅ |
| P0-B | 编辑页 NovelPage（编辑器主面 + 状态条） | ✅ |
| 批次 A | NovelWindow 全量散落动效收敛 | ✅ |
| P1 | 行囊 PackWindow / CharacterPack | ✅ |
| P1/P2 | 关系图 RelationWindow（阴影双轨收敛） | ✅ |

---

## 二、基础设施对照

### 2.1 阴影：3 档 → 5 档

| 档位 | 用途 | 改造前 | 改造后 |
|------|------|--------|--------|
| `--app-shadow-ambient` | 静止卡片/内容面的环境阴影 | ❌ 不存在 | ✅ 新增（`0 1px 3px`，透明度 0.04~0.05，midnight 0.28 补偿） |
| `--app-shadow-card` | 内容面卡片基准 | ✅ 已有 | 沿用 |
| `--app-shadow-raised` | hover 抬升 | ❌ 不存在 | ✅ 新增（`0 8px 20px`，透明度 0.10~0.11，midnight 0.42 补偿） |
| `--app-shadow-pop` | 浮层/抽屉/右键菜单 | ✅ 已有 | 沿用 |
| `--app-shadow-window` | 窗口外壳（inset） | ✅ 已有 | 沿用 |

**色值随主题 tint**（aurora 冷紫 `rgba(53,64,101)` / cream 暖橘 `rgba(120,95,60)` /
mint 冷绿 `rgba(30,90,66)` / midnight 黑高不透明度），禁用单一纯黑。

### 2.2 动效：散落硬编码 → 统一 motion token

**时长标尺（新增 `:root` 全局块，不进 data-theme 块）**

| Token | 值 | 用途 |
|-------|-----|------|
| `--app-t-instant` | 80ms | 按下 / 焦点环 |
| `--app-t-fast` | 120ms | 按钮 hover / 图标态 / 颜色微反馈 |
| `--app-t-normal` | 180ms | 卡片 hover 抬升 / 选中态 |
| `--app-t-slow` | 260ms | 抽屉 / 面板滑动 / 入场 |

**缓动标尺**

| Token | 值 | 用途 |
|-------|-----|------|
| `--app-ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | 默认（Material 标准） |
| `--app-ease-emphasized` | `cubic-bezier(0.3, 1, 0.5, 1)` | 强调入场 |
| `--app-ease-spring` | `cubic-bezier(0.32, 0.72, 0, 1)` | 抽屉/拖拽释放 |

**改造前的问题**：时长 100/120/140/150/160/180/200/220/240/260/320ms 混用、缓动
`ease` / `cubic-bezier(0.4,0,0.2,1)` / `cubic-bezier(0.3,1,0.5,1)` 三套并存、甚至存在
`var(--nv-t-fast, 120ms)` 这种带 fallback 的局部私有写法。

### 2.3 可复用动画 mixin（`src/shared/styles/motion.scss`，新增）

| Mixin | 作用 |
|-------|------|
| `transition-fast / normal / slow` | 按属性名声明 transition（用对应 token） |
| `hover-lift` | 卡片 hover 抬升（`translateY(-2px)` + raised 阴影） |
| `press-feedback` | 按下回弹（`scale(0.97)` + 80ms 即时档） |
| `rise-in` | 内容进场（fadeRise，配合 stagger） |
| `reduced-motion` | `prefers-reduced-motion` 统一降级 |

### 2.4 开发规范（`AGENTS.md` 新增两节）

- **§6.1.3 动效与立体感规范**：两条红线 + 5 档阴影 + motion 标尺 + 性能/可访问性硬约束；
- **§6.1.4 图形素材主题化规范**：图形用色三档纪律 + Lottie 专项规则（哨兵色替换、禁 hue-rotate、统一 wrapper 收口）。

---

## 三、逐窗口改造前后对照

### 3.1 书架页 BookshelfPage（P0-A）

| 组件 | 改造前 | 改造后 |
|------|--------|--------|
| `BookCard` | 静止态仅 `1px 描边`，`box-shadow-pop` 只写在 `:hover`；`0.18s ease` + 箭头 `160ms` | 静止态补 `ambient`；hover 换 `raised` + `translateY(-2px)`；统一 `--app-t-normal/fast` |
| `BookCard` 列表视图 | hover 已 `box-shadow:none`，但静止态无显式声明 | 列表视图静止态显式 `box-shadow:none`（满宽行不浮起，保持底色+描边语言） |
| `IdeaNoteCard` | 静止态无阴影、hover 才 `card`；`0.18s/0.15s` | 静止态 `ambient`、hover `raised`；统一 token |
| `NewWorkCard` | `--ant-button-default-shadow: none` 静止、hover `card`；`0.18s` | 静止 `ambient`、hover `raised`；transition 补 box-shadow 平滑 |
| `ContinueHero` 进度条 | `transition: transform 0.3s ease` | `--app-t-slow --app-ease-emphasized`（保持 transform 合成属性） |

### 3.2 编辑页 NovelPage（P0-B）

| 组件 | 改造前 | 改造后 |
|------|--------|--------|
| `.nv-editor`（编辑器主面） | 仅 `background: surface`，无描边无阴影，与 `--app-bg` 差 ~1.04 亮度 | 静止态 `ambient` 阴影，从 bg 浮起；**不做 hover**（零动效区） |
| `StatusBar` 进度条 `__fill` | `transition: width 320ms`（**布局属性反例**，触发 reflow）+ inline `width:N%` | `transform: scaleX()` 合成属性 + `--app-t-slow`；inline `scaleX(progress/100)` |
| `EditorPane` 标注层 | `var(--nv-t-fast, 120ms) ease` ×4（带 fallback 私有写法） | `var(--app-t-fast) var(--app-ease-standard)` |
| `StatusBar` `__anno-dot` | `120ms ease` | motion token |

**三栏层次**：编辑器 `surface` 比左右栏（`sidebar-bg` / `surface-alt`）高一档，方向本正确；
补 ambient 阴影后构成「编辑器浮起、左右栏后退」的完整 Z 递进，**未改动左右栏**。

### 3.3 NovelWindow 全量散落动效收敛（批次 A）

| 项 | 改造前 | 改造后 |
|----|--------|--------|
| 范围 | 13 个 transition 文件 + 5 处 animation + 1 处秒单位，约 45 处 | 全部 token 化 |
| 时长映射 | `120/140/150/160ms`、`180ms`、`200/220/240/260ms`、`100ms` | `--app-t-fast` / `normal` / `slow` / `instant` |
| 缓动映射 | `ease`、`cubic-bezier(0.4,0,0.2,1)`、`cubic-bezier(0.3,1,0.5,1)` | `standard` / `standard` / `emphasized` |

**刻意保留**（非状态过渡，不纳入标尺）：光标闪烁 `steps(1)`、加载脉冲 `infinite`、
业务防抖 `300/500/800ms`、Tooltip `400ms` 延迟、`duration:0ms`（reduced-motion 降级）。

### 3.4 行囊 PackWindow / CharacterPack（P1）

| 组件 | 改造前 | 改造后 |
|------|--------|--------|
| `PackModuleShell`（模块壳） | 静止态仅 `1px 描边`，无阴影 | 静止态 `ambient` 阴影；**不做 hover 抬升**（模块壳是不可点 `<section>`） |
| `PackModuleShell` 折叠 | `grid-template-rows 0.22s ease` | `--app-t-slow --app-ease-standard`（保留 grid 0fr/1fr 平滑折叠手法） |
| `EffectEditor` ×2 | `border-color/background 0.16s ease` | `--app-t-fast` |
| `RealmModule` 进度条 `__fill` | `transition: width 0.22s ease`（**布局属性反例**）+ inline `width:N%` | `transform: scaleX()` + `--app-t-slow`；inline `scaleX(sub/subMax)` |

**刻意保留**：`cpk-mod-ripple 0.45s`（自绘点击涟漪）、`cpk-breathe 1.5s`（保存呼吸）、
`cpk-spin 0.8s linear infinite`（加载循环）。

### 3.5 关系图 RelationWindow（P1/P2）

| 组件 | 改造前 | 改造后 |
|------|--------|--------|
| `NodeDetailCard` / `EdgeDetailCard` | `0 12px 32px var(--app-mask)`（**阴影双轨**） | `var(--app-shadow-pop)` |
| `RelationCanvas` stats/dense/btn | `0 2px 6px var(--app-mask)` | `var(--app-shadow-card)` |
| `RelationCanvas` controls | `0 2px 8px var(--app-mask)` | `var(--app-shadow-card)` |
| `EntityNode` 静止态 | `0 1px 3px var(--app-mask)` | `var(--app-shadow-ambient)` |
| `EntityNode` hover | `0 3px 10px var(--app-mask)` | `var(--app-shadow-raised)` |
| `EntityNode` 散落动效 | `0.15s/0.12s ease` | `--app-t-fast` |
| `EntityPool` | `0.18s ease` ×2 | `--app-t-normal` |

**收敛意义**：`--app-mask` 本义是「遮罩」（midnight 下 `rgba(0,0,0,.5)`），与 `--app-shadow-*`
四主题按色相校准的 rgba 不一致；收敛后节点阴影随主题正确 tint。

**刻意保留**：`EntityNode` 选中态 `0 0 0 2px color-mix(...)`（外发光 focus ring 语义）。

---

## 四、验收清单

### 4.1 自动化验证（已全绿，可作为回归基线）

| 验证项 | 命令 | 结果 |
|--------|------|------|
| 主题守卫 | `node node_modules/vitest/vitest.mjs run src/shared/theme/themes.test.ts` | 23 例 ✅ |
| scss 引用守卫 | `... run src/shared/styles/scss-imports.test.ts` | 3 例 ✅ |
| novel UI 守卫 | `... run src/windows/NovelWindow/novel-ui-kit.test.ts` | 171 例 ✅ |
| 行囊守卫 | `... run src/shared/components/CharacterPack` | 594 例 ✅ |
| 关系图守卫 | `... run src/windows/RelationWindow` | 196 例 ✅ |
| 类型检查 | `npx tsc --noEmit -p tsconfig.app.json` | ✅ |

> ⚠️ 跑测试前须 `cd "D:/mine/CheckIn"`（**大写盘符**），小写 `d:/` 会让 vite module runner
> 键错乱、全量报 runner 缺失（详见项目记忆）。

### 4.2 守卫红线（改造全程未触碰，回归时须确认仍成立）

1. **常驻色块阶梯**：`hover/active` 色只能出现在 `:hover/:active/:focus`，禁当常驻填充；
2. **`--app-surface-elevated` 白名单**：浮层文件清单未变（本次只改阴影，未新增浮层文件）；
3. **四套主题同名变量**：新增 token 四套同步补齐（themes.test 自动校验）。

### 4.3 真机走查清单（逐项目测，四套主题各过一遍）

> 走查时依次切 aurora / cream / mint / midnight，每项记「通过 / 需调」。

**书架页**
- [ ] 书卡静止态有轻环境阴影，不再「描边平贴」；
- [ ] 书卡 hover 轻微抬升（-2px）+ 阴影加深，手感顺滑不突兀；
- [ ] 列表视图下书卡仍「满宽行」不浮起（保持底色+描边语言）；
- [ ] 继续写作进度条填充动画顺滑（无卡顿）。

**编辑页**
- [ ] 编辑器主面从左右栏「轻轻浮起」，Z 递进清晰；
- [ ] 编辑器正文区**无**任何 hover 位移/阴影跳动（零动效区）；
- [ ] 底部状态栏进度条动画顺滑（`scaleX` 无跳变）。

**行囊**
- [ ] 模块静止态有轻环境阴影，不再「纯线分家」；
- [ ] 折叠/展开动画顺滑（grid 0fr/1fr 过渡）；
- [ ] 阶内进度条动画顺滑（`scaleX`）。

**关系图**
- [ ] 节点阴影随主题正确 tint（尤其 aurora 冷紫 / cream 暖橘不再发脏灰）；
- [ ] 节点 hover 阴影抬升自然；
- [ ] 详情卡 / 工具栏浮层阴影层次正确（pop 重于 card）。

**全局（跨窗口）**
- [ ] **暗色（midnight）**下立体感靠「明度+描边」成立（阴影不糊、层次靠 elevated 面）；
- [ ] 无「阴影过重 / 过轻」的观感失衡（若需微调，改对应 `--app-shadow-*` 色值即可）；
- [ ] 键盘操作（Tab 聚焦）时 focus 态清晰可见（未被阴影改动影响）。

### 4.4 可访问性与性能确认

- [ ] 系统开启「减少动态」后，位移/缩放动画降级为即时状态（`prefers-reduced-motion`）；
- [ ] 动画仅作用于 `transform/opacity`（合成属性），无 `width/height/margin` 过渡残留；
- [ ] 无大面积 `filter: blur` 等重绘大户引入。

---

## 五、后续可选项（未在本批实施）

1. **图形主题化落地**：等第一个 Lottie 资源进场时，按 `graphic-theming-spec.md` 实现统一
   `ThemeLottie` wrapper + 对应守卫（当前项目尚无 Lottie，规范已先行）。
2. **阴影/缓动微调**：真机走查若发现某档阴影偏重/偏轻，改 `themes.scss` 对应 token 色值即可，
   无需动业务样式（这是 token 化的核心收益）。
3. **关系图字号**：架构师诊断附带指出关系图存在 `10px/10.5px/11px/11.5px` 满天飞的可读性问题，
   属独立议题，未纳入本次视觉立体感改造范围，建议单独评估。
