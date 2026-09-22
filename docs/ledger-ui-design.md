# CheckIn 记账功能 · UI 设计规格

> 版本 v1 ｜ 依据 `docs/记账页面PRD.md`（v0.1 草案）与项目现行设计系统产出
> 交互原型：`docs/ledger-ui-prototype.html`（四主题可切换、含空状态 / 加载态 / 快捷记一笔）
> 覆盖范围：M1（F-01～F-07、F-09）+ M2（F-08、F-10、F-11、F-20）的完整视觉与交互；M3 仅留扩展位

---

## 1. 设计目标与范围

| 维度 | 目标 |
|---|---|
| 用户目标 | 3 步完成一笔（金额 → 分类 → 确认），首笔到保存 < 15s；月度收支一眼看清 |
| 视觉目标 | 100% 复用主窗口设计系统，不引入任何新主题变量、不引入图表库 |
| 工程目标 | 页面以文件夹化组件落地，零新增依赖（图表用纯 SVG），单测可覆盖 |

**里程碑映射**

| 里程碑 | 功能 | 本设计状态 |
|---|---|---|
| M1 | F-01 快速记账 / F-02 常驻入口 / F-03 收支切换 / F-04 智能默认 / F-05 备注 / F-06 分类体系 / F-07 时间线 / F-09 总览看板 | ✅ 完整设计 |
| M2 | F-08 搜索筛选 / F-10 分类占比 / F-11 环比 / F-20 首页迷你卡 | ✅ 完整设计（原型已含） |
| M3 | F-12～F-19 账户 / 标签 / 预算 / 多维 / 导入导出 / 提醒 | ⬜ 仅预留扩展位（顶部「更多」菜单、筛选条右侧插槽） |

---

## 2. 设计基础（Foundation）

### 2.1 令牌映射 —— 全部走 `var(--app-*)`，零新增变量

| 用途 | 令牌 | 说明 |
|---|---|---|
| 页面底色 / 卡片 | `--app-bg` / `--app-surface` / `--app-surface-alt` | 卡片浮在 `--app-bg` 上，圆角 + `--app-shadow-card` |
| 分隔与描边 | `--app-splitter` / `--app-border` / `--app-border-strong` | 列表分组线用 splitter，卡片描边用 border |
| 文本层级 | `--app-text` / `-secondary` / `-muted` / `-disabled` | 金额用 text，单位/时间用 muted，占位用 disabled |
| 主色 | `--app-primary` / `-strong` / `-weak` / `-gradient` | FAB、主按钮、选中态 |
| 语义色 | `--app-success` / `--app-error` / `--app-warning` / `--app-info` | 收入 / 支出 / 预算预警 / 中性提示 |
| 强调色 | `--app-accent-{blue,purple,green,amber,rose,teal,orange}` | 分类色板（见 §3） |
| 圆角 | `--app-radius-card 20 / panel 16 / chip 14 / item 10 / pill 999` | 卡片 20、面板 16、图标底 14、列表行 10 |
| 阴影 | `--app-shadow-card` / `--app-shadow-pop` | 常驻用 card，悬浮/弹层用 pop |
| 滚动条 | `--app-scrollbar` / `-hover` | 时间线滚动区域 |

> ⚠️ 分类色板刻意只使用**已存在的 7 个 accent + success + primary + text-muted**，
> 因此四套主题无需改 `themes.scss`，换肤自动跟随。若后续分类超过 10 个，再走
> 「新增变量 → 四主题同步补齐 → themes.test.ts 校验」流程。

### 2.2 间距 / 圆角 / 动效

| 项 | 规范 |
|---|---|
| 栅格 | 4px 基准，页面外留白 12px，卡片间距 12px，卡片内边距 16–18px |
| 圆角 | 见 §2.1；悬浮条与主按钮用 pill |
| 动效 | 仅 `transform` / `opacity` / `box-shadow`；禁止对布局属性与 `background-color` 做过渡 |
| 时长 | 120ms（微交互）/ 180ms（默认）/ 260ms（覆盖层进出）；缓动 `cubic-bezier(.22,.61,.36,1)` |
| 常驻动画 | 默认 `paused`，指针进入才 `running`；尊重 `prefers-reduced-motion` |

### 2.3 数字排版

金额统一 `font-variant-numeric: tabular-nums` + 等宽数字字体栈，避免列表跳动；
结余大数字 28px/700，统计卡 18px/700，列表行 15px/700，图例 12px。

---

## 3. 配色决策：收支配色（设计决策 D-1）

PRD 要求「国内习惯 + `--app-*` 语义色」，此处做明确裁决：

| 语义 | 令牌 | 额外非色线索 |
|---|---|---|
| 支出 | `--app-error` | 前缀 `−` |
| 收入 | `--app-success` | 前缀 `+` |
| 结余（正） | `--app-success` | 前缀 `+` |
| 结余（负） | `--app-error` | 前缀 `−` |
| 环比上升 | `--app-error`（红涨）+ 上箭头 | 文案「较上月 ↑12.4%」 |
| 环比下降 | `--app-success`（绿跌）+ 下箭头 | 文案「较上月 ↓12.4%」 |

**不依赖颜色单独传达信息**：金额一律带 `+ / −` 符号，趋势带箭头图标，满足 WCAG 1.4.1。

### 3.1 分类体系（F-06）· 预设 10 类

| # | 分类 | 图标（antd） | 色 token | 弱底 token | 类型 |
|---|---|---|---|---|---|
| 1 | 餐饮 | `CoffeeOutlined` | `--app-accent-orange` | `--app-accent-orange-weak` | 支出 |
| 2 | 交通 | `CarOutlined` | `--app-accent-blue` | `--app-accent-blue-weak` | 支出 |
| 3 | 购物 | `ShoppingOutlined` | `--app-accent-rose` | `--app-accent-rose-weak` | 支出 |
| 4 | 居住 | `HomeOutlined` | `--app-accent-purple` | `--app-accent-purple-weak` | 支出 |
| 5 | 娱乐 | `GiftOutlined` | `--app-accent-amber` | `--app-accent-amber-weak` | 支出 |
| 6 | 医疗 | `MedicineBoxOutlined` | `--app-accent-teal` | `--app-accent-teal-weak` | 支出 |
| 7 | 教育 | `BookOutlined` | `--app-accent-green` | `--app-accent-green-weak` | 支出 |
| 8 | 工资 | `WalletOutlined` | `--app-success` | `--app-success-weak` | 收入 |
| 9 | 理财 | `LineChartOutlined` | `--app-primary` | `--app-primary-weak` | 收入 |
| 10 | 其他 | `EllipsisOutlined` | `--app-text-muted` | `--app-surface-alt` | 通用 |

- 图标底：`40px` 列表 / `36px` 行内，圆角 `--app-radius-chip`，底色 `-weak`，图标本色。
- 自定义分类（增/改/删）：复用同一色板轮转；删除时历史记录归「其他」并弹提示重指派。
- 「其他」作为兜底分类不可删除。

---

## 4. 信息架构与页面布局（F-02 / F-09 / IA）

```
.window-shell（圆角窗口）
└ .window-header（34px，拖动区 + 三按钮）
└ .window-shell__body
  └ .page
    ├ NavHeader（52px 圆角胶囊，仅「返回」）
    └ .ledger-page（flex column，gap 12，padding 0 12 12）
      ├ 顶部 .ledger-topbar.card（h≈72）
      │   左：周期切换 Segmented（本月/本季/本年/自选）+ 月份胶囊
      │   右：本月结余大数字 + 环比 + 「更多」菜单
      ├ 中部 .ledger-mid（grid 1.55fr / 1fr，gap 12）
      │   ├ 总览卡：收入/支出/结余三统计 + 近 30 天趋势折线（h≈96）
      │   └ 分类占比卡：环图(132px) + 图例列表（金额降序）
      ├ 下部 .ledger-flow.card（flex:1，min-height:0）
      │   ├ 筛选条（h≈52）：搜索 + 类型胶囊 + 分类 + 计数
      │   └ 时间线（滚动）：按日期倒序分组，粘性分组头含当日合计
      ├ .ledger-fab（右下 24/24，48px pill，「＋ 记一笔」）
      └ .quick-bar（快捷记一笔，底部居中悬浮条 640px）+ .quick-mask
```

关键尺寸：

| 元素 | 尺寸 |
|---|---|
| 页面外留白 | 左右 24px（与 NavHeader 卡片对齐）+ 底部 20px |
| 卡片内边距 | topbar 12/18，overview 16/18，pie 16/18，flow 10/14 |
| 统计卡 / 行 | 三等分 grid，gap 10 / 列表行高 56px |
| 图标底 | 列表 36px / 功能卡 40px |
| FAB | 48px 高 pill，右下 24px |
| 悬浮条 | 宽 640px（上限 calc(100% - 48px)），距底 28px |

**布局红线**：页面根 `flex:1; min-height:0`，禁止 `100vh`；滚动只发生在时间线内部；
`flex:1` 子项不得反向依赖容器高度。

---

## 5. 组件清单

| 组件（目录） | 职责 | 关键态 |
|---|---|---|
| `LedgerPeriodBar/` | 周期切换 + 结余大数字 + 环比 | Segmented 选中 / 结余正负 / 更多菜单 |
| `LedgerOverviewCard/` | 三统计 + 趋势 | 正常 / 骨架 / 零数据 |
| `LedgerTrendChart/` | 纯 SVG 折线 + 面积渐变 | hover 显示「日期 · 金额」气泡 |
| `LedgerCategoryPie/` | 纯 SVG 环图 + 图例 | hover 联动高亮（其余降到 28% 透明度） |
| `LedgerFilterBar/` | 搜索 / 类型 / 分类 / 计数 | 选中态 pill（primary-weak 底） |
| `LedgerTimeline/` | 日期分组流水 | 粘性分组头 / 滚动 |
| `LedgerTxRow/` | 单行（memo + 稳定回调） | 默认 / hover（显示操作）/ 编辑中 / 删除确认 |
| `LedgerEmpty/` | 空状态 | 「记第一笔」主 CTA |
| `LedgerFab/` | ＋记一笔 | 默认 / hover 上浮 / active 缩放 / focus-visible |
| `QuickAddBar/` | 快捷记一笔悬浮条 | 收起 / 展开 / 金额错误态 |
| `CategoryPicker/` | 分类 chips 网格 | 默认 / 选中 / 按类型过滤 |
| `constants/categories.ts` | 预设分类元数据 | — |

**性能规范**：`LedgerTxRow` 用 `memo()`；行内操作回调稳定（不要每行新建函数）；
hover 只改 `box-shadow` 与 `opacity`，不改布局属性。

---

## 6. 核心流程

### 6.1 快捷记一笔（F-01 / F-02）· 3 步闭环

1. **唤起**：点击 FAB，或全局快捷键 `⌘/Ctrl + Shift + L`（不离开当前页）。
2. **输入**：金额框自动聚焦并全键盘优先（`inputmode="decimal"`）→ 选分类 chip → `Enter` 保存。
3. **反馈**：悬浮条收起，时间线顶部即时插入该笔，底部 Toast「已记一笔 −¥28.50」。
   - 金额校验：空 / 0 / 负数拦截，边框转 `--app-error` + 文案「请输入大于 0 的金额」。
   - `Esc` 关闭；遮罩点击关闭。
   - **设计决策 D-2**：采用**底部居中悬浮条**而非独立弹窗 —— PRD 的「不离开当前页」是 P1 硬需求，
     弹窗会打断上下文；悬浮条同时保留页面可见性，3 步闭环更短。快捷键槽位建议 `⌘/Ctrl + Shift + L`。

### 6.2 时间线（F-07）

- 按 `happened_at` 倒序分组：今天 / 昨天 / MM-DD 周X；粘性分组头右侧显示当日支出/收入合计。
- 行内点「编辑」弹小窗改分类 / 金额 / 备注；点「删除」→ 行内二次确认 → 删除后
  Toast「已删除 1 笔 · 撤销（5s）」，5 秒内可撤销。
- 空状态：插画 + 「还没有记账记录」+「3 步记第一笔」引导 + 主按钮「记第一笔」。

### 6.3 分类占比（F-10）

- 环图：`r=54 / stroke-width=22`，段间留 2px 间隙，中心显示本月支出合计。
- 图例按金额降序；**超过 7 类由数据层聚合为「其他」**后再渲染（原型已演示 8 类含其他）。
- hover 图例 → 对应扇区高亮，其余降透明度，中心数值切换为该分类金额 + 占比。

---

## 7. 状态设计

| 状态 | 表现 |
|---|---|
| 加载 | 骨架屏（总览卡 / 环图 / 列表），骨架用 `--app-surface-alt` + 扫光动画 |
| 空 | 见 §6.2；总览三数字显示 ¥0.00，环图显示空环 |
| 错误（金额） | 输入边框 + 弱底转 `--app-error`，下方 12px 错误文案 |
| 禁用 | 主按钮 `opacity:.6` + `cursor:not-allowed` + `pointer-events:none` |
| 焦点 | `:focus-visible` 2px `--app-primary` 描边，`outline-offset:2px` |
| 删除中 | 行内二次确认胶囊（确认 / 取消） |

---

## 8. 可访问性（WCAG AA）

- 文本对比 ≥ 4.5:1，大号数字 ≥ 3:1（四主题均使用既有令牌，已满足）。
- 金额不依赖颜色：`+ / −` 前缀 + 箭头图标 + 文案。
- 键盘全链路可达：FAB → 悬浮条（自动聚焦金额）→ Tab 切分类 → Enter 保存 → Esc 关闭。
- 语义结构：时间线用 `ul / li`，分组头 `h3`，周期切换 `role="tablist"`。
- 触控/点击目标 ≥ 36px（行内 mini 按钮 28px，仅作补充操作，主操作另有行内编辑入口）。
- 尊重 `prefers-reduced-motion`；图表为静态 SVG，无动画依赖。

---

## 9. 工程落地清单（与现有架构对齐）

```
src/windows/BaseWindow/pages/LedgerPage/
├─ LedgerPage.tsx                 # 页面根：Page 容器 + 三大区块 + FAB + QuickAddBar
├─ index.scss                     # 页面级布局（样式就近，不上移）
├─ constants/categories.ts        # 预设分类（图标 / 色 token / 类型）
├─ components/                    # 见 §5 组件清单（每个组件一个目录 + index.scss）
├─ hooks/
│  ├─ useLedgerData.ts            # 拉取与派生：汇总 / 分类聚合 / 分组流水
│  ├─ useLedgerEditorState.ts     # 快捷记一笔、行内编辑、删除撤销
│  └─ useLedgerViewState.ts       # 周期 / 筛选 / 图表 hover
└─ __tests__/                     # 金额校验、分组、占比聚合、>7 类折叠
```

| 层 | 落地 |
|---|---|
| 路由 | `App.tsx` 加 `const LedgerPage = lazy(() => import("./pages/LedgerPage/LedgerPage"))` + `<Route path="/ledger" .../>` |
| 侧栏入口 | `HomeSidebar` 的 `NAV_ITEMS` 追加 `{ path: "/ledger", label: "记账", icon: <AccountBookOutlined /> }`（置于「日程」之后） |
| 首页入口 | HomePage 功能卡加「记账」（accent-green 图标底）；统计区加「本月支出 / 本月结余」迷你卡（F-20） |
| 主进程 | `electron/handlers/ledger-handlers.ts` 导出 `registerLedgerHandlers()`，`main.ts` 与 `registerTodoHandlers` 同位置注册 |
| 数据层 | `db.ts` 在 `userDb` 迁移式建表：`ledger_transactions / ledger_categories / ledger_accounts / ledger_tags / ledger_budgets` |
| 服务层 | `shared/services/ledger.ts`：`addTransaction / listTransactions / updateTransaction / deleteTransaction / getSummary / getCategoryBreakdown / upsertCategory` |
| 图表 | 纯 SVG（环图 stroke-dasharray + 折线 polyline），**不引入图表库、不用 lottie（jsdom 禁）** |
| 快捷键 | 主进程 `globalShortcut` 注册 `Cmd/Ctrl+Shift+L` → 广播唤起悬浮条 |
| 迁移 | 复用 migration 体系 zip + manifest，迁移页追加 ledger 范围（F-18） |
| 交付 | `pnpm test` / `typecheck` / `lint` 三件套 |

---

## 10. 设计决策与开放问题答复

| PRD 开放问题 | 设计答复 |
|---|---|
| 【设计】快捷记一笔用全局悬浮条还是独立弹窗？ | **底部居中悬浮条**（决策 D-2），快捷键 `⌘/Ctrl+Shift+L`，不占用既有槽位 |
| 【产品·阻塞】是否需要「转账」独立类型？ | v1 仅支出 / 收入；数据模型保留 `type='transfer'` 与 `to_account_id` 字段，UI 不暴露入口 |
| 【产品】默认币种 / 多币种字段 | UI 统一 `¥`；`ledger_transactions` 预留 `currency` 字段，v1 不展示切换 |
| 【工程】预算超支提醒走后台轮询还是打开页计算？ | 设计上先做「打开页计算 + 顶部警示条」，M3 再接 `activitiesTask` |
| 【数据】导入是否支持第三方 App 格式？ | v1 仅自有 zip；UI 预留导入入口于顶部「更多」菜单 |
| 【合规】是否需要额外加密？ | 沿用现有 per-user 隔离，UI 层不新增加密交互 |

**待确认项已拍板（工程落地时确认）**：

| 待确认 | 结论 |
|---|---|
| ① 周期「自选」是否做 antd `RangePicker` 弹层 | ✅ 做：`Popover` + `RangePicker`（`LedgerPeriodBar`） |
| ② >500 笔是否引入虚拟滚动 | ✅ 做：时间线用 `react-virtuoso` 的 `GroupedVirtuoso`（`LedgerTimeline`） |

**落地修正（相对原型）**：原型的自绘 `quick-mask + quick-bar` 悬浮条已改为 antd `Drawer`
底部弹层（`placement="bottom" size="auto"`），仍满足 D-2「不离开当前页」的语义，
同时白拿遮罩 / Esc / 焦点陷阱 / 层级管理；其余弹层一并组件化
（编辑 `Modal`、周期 `Popover`、分类筛选 `Popover`、删除 `Popconfirm`）。
