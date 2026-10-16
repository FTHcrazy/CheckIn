# 小说窗口 + 行囊窗口 · UI 需求稿

> 版本：v1.0 ｜ 日期：2026-10-15 ｜ 基线：CHANGELOG 1.44.1
> 关联文档：`docs/novel-audit-report.md`（总审查报告）、`docs/novel-editor-prd.md` v0.8、`docs/novel-onboarding-prd.md` v1.0、`docs/pack-dashboard-prd.md` v1.0
> 覆盖范围：**仅界面交互 / 视觉表现类改进点**；数据层与逻辑缺陷见总报告技术清单（TX-*）
> 适用环境：Electron + React 19 + antd 6.6；四套主题（aurora / cream / mint / midnight）自动跟随

---

## 1. 技术约束（所有需求共用，先读）

| 项 | 约束 | 来源 |
|---|---|---|
| 组件库 | 一律 antd（Button / Select / Input / Modal / Tooltip / Segmented / Slider / Switch…）；**业务代码禁原生表单控件** | AGENTS §6.1.2 |
| 例外 | 码字区 CodeMirror；超长虚拟化列表行（须满足 4 条件） | AGENTS §6.1.2 |
| 主题 | 色值一律 `var(--app-*)`，禁硬编码；四主题联动 | AGENTS §6.1.1 |
| 外观覆盖 | 只改组件级 CSS 变量（`--ant-button-*` kebab-case），**不写 `:hover` 属性规则** | AGENTS §6.1.2 |
| 组件结构 | 组件文件夹 + `index.tsx` + `index.scss` 就近；样式不上移父组件 | AGENTS §5.2 |
| 布局 | 网格轨道 `minmax(0, 1fr)`、flex 子项 `min-width: 0` | AGENTS 硬规范 |
| 虚拟化 | 用 `Virtuoso` 的容器必须有**确定高度**（禁只写 `max-height`） | `novel-ui-kit.test.ts` 守卫 |
| 动画 | CSS transition 优先于条件渲染 | AGENTS §6.4 |
| 行囊特有 | 行囊内 `Button` 一律不传 `size`（高度由 `.cpk-btn.ant-btn` 决定）；`Input` 保留 `size="small"` | character-pack.md |
| 字号 | 最小 12px，尽量双数 | AGENTS |

---

## 2. 需求总览表

| 编号 | 名称 | 对应问题 | 优先级 | 涉及文件（主要） |
|---|---|---|---|---|
| UI-01 | 行囊「主角信息看板」L0 首页（A/B/C/D/E 五区） | PX-01 | P0 | `CharacterPack/index.tsx`、新建 `components/PackDashboard/` |
| UI-02 | 行囊境界卡「阶 + 小层」直选 | PX-02 | P0 | `components/RealmModule/index.tsx(+scss)` |
| UI-03 | 行囊空态分层引导（每区给下一步动作） | PX-03 / PX-14 | P1 | `RealmModule`、`AttributesModule`、`StatusModule`、`PackHeader` |
| UI-04 | 行囊模块「摘要行 → 展开 → 钉选」渐进披露 | PX-01 / PX-04 | P1 | `pack-layout.ts`、`types.ts`、`ModuleManager`、`PackModuleShell` |
| UI-05 | 设定中心信息架构重组（常识化分组） | PX-05 | P0 | `shared/components/SettingCenter/index.tsx(+scss)` |
| UI-06 | 新手引导弱提示补齐 T-05 / T-06 / T-07 | PX-06 | P1 | `OutlinePanel`、`HoverEntityCard`、`ReorderConfirmModal`、`guide-copy.ts` |
| UI-07 | 顶栏图标 hover / 状态分层统一 | PX-07 | P2 | `NovelTopBar/index.tsx(+scss)` |
| UI-08 | 「今日目标 / 连续码字」跨窗口口径统一 | PX-08 | P1 | `ShelfStats/index.tsx`、`StatusBar/index.tsx` |
| UI-09 | 工具 Tab「规划中」占位交互规范 | PX-09 | P2 | `SupportPanel/components/ToolLauncher/index.tsx` |
| UI-10 | 设定中心可维护性支撑（拆分 + 分区锚点） | PX-10 | P1 | `shared/components/SettingCenter/` 拆为子组件目录 |

---

## 3. 需求详细规格

### UI-01 行囊「主角信息看板」L0 首页 ｜ P0

**功能描述**
行囊打开首屏从「十模块分区仪表盘 / 摘要行平铺」转为「一屏看懂主角当前状态」的只读看板。五个分区常驻不收起：A 主角身份卡 / B 境界卡 / C 核心属性总览 / D 生效状态 / E 关键设定摘要行。编辑能力（十个模块）降为 L1，一次点击可达，能力零删减。

**交互流程**
- 正常流：打开行囊 → 首屏不滚动可见 A、B 与 C 前 N 条、至少 4 行 E → 点 E 中某行 → 该模块**就地展开**为完整编辑器（L1）→ 再点收起回摘要行。
- 异常流：
  - 十模块全关 → 保留看板常驻区 + 既有「齿轮重开」空态；
  - 数据未装载 → 骨架 / 加载态；
  - 装载失败 → 保留现有 `cpk__error` 独立错误视图。

**页面元素与状态**

| 区 | 元素 | 状态 |
|---|---|---|
| A 主角身份卡 | 头像位（无则首字色块）/ 名字（可改）/ 主角绑定态 / 保存三态（已保存·N 分钟前 · 保存中 · 保存失败） | 默认 / hover / 编辑态 |
| B 境界卡 | 当前境界大读数 + 阶梯尺 + 层号条 + `±1 层` 微调 + 「实体面板显示」对照条 | 见 UI-02 |
| C 核心属性总览 | 每行「属性名 base → final 增量段」；默认条数随档位（宽 8 / 中 6 / 窄 4）；「展开全部」入口；点行开 `SourceDetailDrawer` | 默认 / 展开 |
| D 生效状态 | 仅列 `active` 生效项，每行含开关 | 默认 / 开关态 |
| E 关键设定摘要行 | 一行一模块：标题 + 右侧**派生摘要**（取现有 `moduleSummary()`，不新增口径） | 默认 / hover / 展开箭头 |

**预期效果**
- 首屏零编辑控件聚焦；
- 「看到摘要 → 进入编辑」≤ 1 次点击；
- 过渡用 CSS transition（宽高 / 透明度），不条件渲染；
- 摘要文案与 L1 一致（同源 `moduleSummary`）。

**落地提示**
- 复用资产：`pack-layout.ts` 的 `moduleSummary` / `splitByZone` / `PACK_ZONE_OF`；
- 核心三块（汇总 / 属性 / 境界）并入看板常驻区，不再是独立折叠块；
- **不新增数据表、不加表结构**（pack-dashboard PRD §2.3 明确 `compat` 下成立）；
- 新增组件建议 `components/PackDashboard/`（文件夹 + index.tsx + index.scss）。

---

### UI-02 行囊境界卡「阶 + 小层」直选 ｜ P0

**功能描述**
境界卡提供**阶**（阶梯尺 chip；阶数 > 8 时下拉为主路径）与**小层**（层号条 1..N；N > 12 时改下拉）两条直选路径，保留 `±1 层` 微调。选定「阶 + 小层」≤ 2 次点击，全程不离开行囊窗口。

**交互流程**
- 选阶：点阶梯尺 chip 或阶下拉 → `writeRealm({index, sub:1}, "pack")` → 夹取到该阶第 1 层 → toast；
- 选小层：点层号条 `1..N` → `writeRealm({index, sub}, "pack")` → `clampRealm` 夹取 → toast；
- 微调：`−1 层 / +1 层`（跨阶自动进位 / 退位）；
- 边界：已到顶阶满层 / 首阶首层 → 微调按钮置灰并说明原因（现状已做，保留）。

**页面元素与状态**

| 元素 | 状态 |
|---|---|
| 阶梯尺 | 一条尺子、不换行、横向滚动；当前阶高亮 / 已过阶置灰 / hover |
| 阶下拉（阶 > 8） | 默认 / 打开 / 选中 |
| 层号条（1..N） | 默认 / hover / 当前层选中 / 禁用（N = 1 时**不渲染**，避免出现单选项 `[1]`） |
| 小层下拉（N > 12） | 默认 / 打开 |
| `±1 层` 按钮 | 可用 / 置灰（到顶到底） |

**预期效果**
- toast 文案唯一真相源取 `plan.position`，**不二次计算**；
- 保存后实体面板经既有广播链路同步（B 区「实体面板显示」对照条继续承担「已分叉」可视化）。

**硬约束（继承 REQ-048，逐条保留）**
- 读取走 `getRealm` / `getPanelRealm`，写入走 `writeRealm` → `setRealm`，**组件禁直连 `realmAt` / `novel_links`**；
- 未绑定主角时直选同样生效（写 `realmAt`，仅行囊内使用），界面明示该语义；
- 阶设置弹窗（小层数 / 战力当量）保持「改的是体系」说明，不混入「选当前境界」语义。

**阈值与可访问性**：阶 > 8 切下拉、小层 > 12 切下拉（纯函数定阈值便于测试）；阶梯 chip / 层号条键盘可达（Tab / 方向键），当前阶 `aria-current`，层号按钮带可读名（如「炼气第 7 层」）。

---

### UI-03 行囊空态分层引导 ｜ P1

**功能描述**
看板各区空态给「下一步动作按钮」而非纯文字说明。

| 空态 | 引导动作 | 写入路径 |
|---|---|---|
| 无属性 | 「套用模板（通用 / 玄幻 / 网游）」（复用 `ATTR_TEMPLATES`）+「去建属性」 | 既有属性模板链路 |
| 无等级体系 | 「去设定中心创建」 | 跨窗口频道（见下） |
| 未绑定主角 | 「设为主角」 | 走 `bindEntity`，即时落库 + 广播 |
| 无生效状态 | 一句说明 + 「+ 持续 / + 被动」 | 复用 StatusModule 动作 |

**跨窗口跳转（novel-open-setting-center）**
- 点击「去设定中心创建」→ 新频道 `novel-open-setting-center`（负载带 `workId` + 目标分类 id）→ 主进程 focus / 拉起 NovelWindow 并打开设定中心定位到等级分类；
- 沿用既有 `subscribeDualChannel` + `readEventDetail` 双通道范式（同 `pack-window-open`）；
- **失败必须 toast + 保留可重试按钮**，不得静默失败。

**页面元素与状态**：每空态 = 一句说明 + 主按钮；按钮 loading / 禁用态；跳转失败态。

**现状证据**：`RealmModule/index.tsx:93-97` 当前为空态**纯文字**，文案还写着过期术语「设定 → 等级体系」，且代码搜不到 `novel-open-setting-center` 频道。

---

### UI-04 行囊模块渐进披露与钉选 ｜ P1

**功能描述**
模块默认「摘要行」；点击就地展开为 L1；作者可**钉选**常驻；「展开全部」一键回旧态（照顾配设定场景）。

**状态机**

| 模块状态 | 进入条件 | 退出条件 |
|---|---|---|
| 摘要行（默认） | 初始加载；作者未表态 | 点击行内任意处 |
| 展开（L1 编辑器） | 点击摘要行 / 看板入口 | 点击收起；或钉选后不再变化 |
| 钉选常驻 | 模块管理 / 行内点「钉」 | 取消钉选 |

**规则要点**
1. 默认态改革：`isAutoCollapsed` 从「仅窄档自动折叠」改为「全档默认摘要行」；核心三块并入看板常驻区（见 UI-01）。作者手动展开过的模块记入 `prefs.collapsed`，显式偏好接管规则不变。
2. 钉选写 `PackUiPrefs.pinned: PackModuleKey[]`（走 `novel_pack_ui`，**即改即存**，不计未保存改动）。
3. 旧偏好文件无 `pinned` 字段 → 按空数组处理，不弹迁移、不丢既有偏好。

**预期效果**：常用模块钉选后从两层点击变零层；未钉选模块重开行囊回摘要行。

**低成本独立选项**：**若 UI-01 暂不落地，本项仍应作为独立改进先做**——只改默认折叠策略 + 加一个 config 字段，零新表。

**证据**：`pack-layout.ts:134-142`（现状仅窄档折叠）、`types.ts:161-172`（`PackUiPrefs` 无 `pinned`）。

---

### UI-05 设定中心信息架构重组 ｜ P0

**功能描述**
设定中心当前把「境界体系」当作 `kind='realm'` 的一条**等级序列分类**，新手按「世界观 / 人物 / 大纲」常识找不到入口。需在左栏 / 标题层引入常识化分组与说明，降低认知门槛。

**交互流程**
- 打开设定中心 → 左栏分组（「等级序列」直白命名 + 顶部一句「境界 / 品阶 / 功法等级都在这里」说明）→ 点分类 → 右栏编辑；
- 空态给「套用内置预设」直达模板库（E-02 已完成，保留）。

**页面元素与状态**
- 左栏分类行：默认 / hover / 选中 / 拖拽；
- 右栏：分类头 + 进位规则条 + 等级序列表（列表行斑马纹 1.42.0 已加，保留）；
- 空态（有 CTA）/ 加载 / 错误。

**预期效果**：新手 1 次找到「人物设定在哪」类答案；文案去术语化。

**注意**：FR-05 过期文案已修（1.43.0），需确认未回潮（`SettingCenter/index.tsx:229-238` 原证据）。

---

### UI-06 新手引导弱提示补齐 T-05 / T-06 / T-07 ｜ P1

**功能描述**：接入三个未挂载的弱提示点位。

| 点位 | 触发时机 | 挂载目标 | 落地方式 |
|---|---|---|---|
| T-05 | 首次进入大纲空态 | 「＋ 一句话梗概」 | 挂 `data-tour-target` + 包 `GuideTooltip` |
| T-06 | 标注层首次高亮出词 | 高亮词悬浮卡（`HoverEntityCard`） | 在其首次挂载时消费，锚点为悬浮卡自身 |
| T-07 | 首次拖动章节触发序号确认 | `ReorderConfirmModal` 标题旁 | 弹框打开时消费 |

**页面元素与状态**：Tooltip 单次出现（6s 或点击后淡出）、不拦截点击、出现即记 `tooltipSeen`；同一时刻全窗口至多 1 个 Tooltip。

**证据**：onboarding §14.2 已给统一方案（「挂锚点 + 包一层 `GuideTooltip`」，无新增机制成本）；`guide-copy.ts:183-201` 文案已定义但未挂载；`GuideTooltip` 当前仅被 T-02（SettingCenter）、T-04（PackHeader）使用。

---

### UI-07 顶栏图标 hover / 状态分层统一 ｜ P2

**功能描述**：编辑器顶栏 6 颗图标（章节栏 / 支撑面板 / 行囊 / 历史快照 / 小说设定 / 排版偏好）统一「默认浅色 chip 底 / hover 加深 / 持久激活主色弱底」三档层次。

**交互流程**：hover 出 Tooltip 说明 + 状态切换（`is-on`）。

**预期效果**：扫过去不再是一团灰点，可点性一眼可见。

**性质**：CHANGELOG 1.42.0 已做过一轮，本项为**收尾确认项**（待验证是否仍有默认透明底的遗漏态）。证据：`NovelTopBar/index.tsx:165-228`。

---

### UI-08 「今日目标 / 连续码字」跨窗口口径统一 ｜ P1

**功能描述**：统一书架统计条「今日新增 / 连续码字」与编辑器状态条「今日 +N / 今日目标」的视觉口径与术语，避免同指标两处说法不一。

**页面元素与状态**
- 书架四卡：累计作品 / 累计字数 / 今日新增 / 连续码字（`ShelfStats/index.tsx:17`）；
- 编辑器状态条：本章 / 今日 +N / 字每分 / 目标进度条（`StatusBar/index.tsx:39-85`）。

**预期效果**：两处读数采用同一术语与单位格式（数字用 `tabular-nums` 防跳动），可互相印证。

**配套**：novel-editor-prd §10.3「净增 vs 保存累计」开放问题应正式拍板为**净增**（推荐，现状即净增口径）并回填文档。

---

### UI-09 工具 Tab「规划中」占位交互规范 ｜ P2

**功能描述**：右栏「工具」Tab 以占位卡呈现「人物关系网络（R27）」「架空地图（R28）」。需明确占位卡不是死链——点击应给明确反馈（如「该功能规划中」toast 或禁用态说明），避免「点了没反应」观感。

**证据**：`SupportPanel/components/ToolLauncher/index.tsx:29-59`（注释「尚在规划中，以占位卡同构呈现」）。

---

### UI-10 设定中心可维护性支撑 ｜ P1

**功能描述**：`SettingCenter/index.tsx` 1494 行单体，按「左栏分类列表 / 右栏等级序列 / 批量生成弹窗 / 拆分弹窗」拆分为子组件目录（AGENTS §5.2），并补分区锚点。

**预期效果**：后续 UI 迭代（如 UI-05 重组）成本可控；避免改一处漏一处。

---

## 4. 多窗口协同（行囊 ↔ 小说窗）流转说明

| 场景 | 现状 | 本稿要求 |
|---|---|---|
| 编辑器顶栏「行囊」/ Ctrl+Shift+B 打开行囊 | 独立 PackWindow，单实例 | 保留；单实例唤起仅聚焦 |
| 行囊「去设定中心创建」（无等级体系 / 空态引导） | **不存在** | 新增跨窗口频道 `novel-open-setting-center`（带 workId + 目标分类 id），主进程 focus / 拉起 NovelWindow 并定位；失败 toast + 可重试（UI-03） |
| 行囊改境界 → 实体面板同步 | 双通道事件 `PACK_REALM_EVENT`（同窗 CustomEvent + 跨窗 broadcast），走 `readEventDetail` 归一化 | 保留；B 区「实体面板显示」对照条继续承担「已分叉」可视化 |
| 行囊 ↔ 编辑器灵感 | 共享 `novel-note-changed` | 不改 |
| 关闭守卫 | 行囊用主进程 close-guard 三通道（CloseGuardModal）；Tour 与守卫的冲突**让位未接线** | 需补：`CloseGuardModal` 打开时调 `useGuideStore.getState().pause()`（逻辑改进 PX-11，影响 UI 编排） |

**跨窗口流程示意（UI-03 跳转）**

```
行囊窗口 (PackWindow)                主进程                小说窗口 (NovelWindow)
  点「去设定中心创建」
      │
      ├─ broadcast("novel-open-setting-center", {workId, categoryId})
      │                                   │
      │                            windowManager 定位/拉起 ──▶ NovelWindow focus
      │                                   │
      │                                   └──────────────▶ 打开 SettingCenter 定位等级分类
      │
      └─ 失败 → toast「未能打开设定中心，请重试」+ 按钮可重试
```

---

## 5. 视觉与一致性约束清单（验收用）

1. **组件库强制**：一律 antd；业务代码禁原生表单控件。
2. **主题 token**：色值全部 `var(--app-*)`；覆盖外观只改组件级 CSS 变量，不写 `:hover` 属性规则。
3. **文件组织**：组件文件夹 + `index.tsx` + `index.scss` 就近；行囊组件在 `shared/components/CharacterPack/`，小说窗口私有组件在 `NovelWindow/pages/NovelPage/components/`。
4. **虚拟化容器尺寸**：用 `Virtuoso` 的容器必须有确定高度，禁只写 `max-height`。
5. **布局动画**：CSS transition 优先于条件渲染。
6. **行囊尺寸约定**：行囊内 `Button` 不传 `size`；`Input` 保留 `size="small"`。
7. **图标**：自带造型按钮须补清零点 mixin（`pack-ui-kit.test.ts` / `novel-ui-kit.test.ts` 守卫）。
8. **可访问性**：阶梯 chip / 层号条键盘可达，当前项 `aria-current`；Tour 步骤卡片键盘可达。
9. **文案同源**：引导类文案以 PRD §7.2 / §7.3 表格为唯一事实源（`guide-copy.ts`），与帮助文档 `docs/novel-onboarding-guide.html` 同源维护。
10. **常驻色块阶梯**（2026-10-15 补，同日按真机反馈扩写）：底色 token 都是**绝对色**，
    「差多少档」取决于**贴在谁身上** —— 同一支 `--app-surface-alt` 贴内容面只差 1.03，
    贴纯白浮层就跨过 surface 一整层变成 1.07。所以按**基面**记：

    | 基面 | 「块」= 高一档 | 「槽」= 低一档 |
    |---|---|---|
    | 页面底 `--app-bg` | `--app-surface` 1.042~1.044 | `--app-surface-hover` 1.035~1.052（alt 与 bg 近乎同色会消失） |
    | 内容面 `--app-surface` | `--app-surface-elevated`（**仅浮层**：下拉/弹窗/抽屉/悬浮卡） | `--app-surface-alt` 1.027~1.052 |
    | 浮层 `--app-surface-elevated` | ——（已是最贴观察者） | `--app-surface` 1.033~1.043 |

    语义上限 `--app-primary-weak`（1.094~1.135）=「选中 / 当前 / 已展开」，常驻块不许超它。
    派生三条硬规矩（都是真机反馈「跟其它模块不是一个风格」逼出来的）：
    ① **窗口 / 页面根一律铺 `--app-bg`**，不许铺 `--app-surface` —— 铺 surface 等于把页面底
    抬高一整档，之后每张卡片都少一档只剩描边，还逼着某些卡片越级去借浮层 token（先例：
    行囊 `.cpk`）；② **`--app-surface-alt` 只允许贴在 `--app-surface` 上**，贴浮层会跨层、
    比同屏兄弟块重一倍且丢色相，浮层里的槽一律用 `--app-surface`；③ **浮层里的组件级槽位
    必须显式指回**：antd 出厂 `Slider.railBg = colorFillTertiary`（黑透明 4%，在白浮层上退化成
    **无彩度**中性灰 `#f5f5f5` = 1.090）、`Segmented.trackBg = colorBgLayout`（= 页面底 = 1.089），
    都比浮层应有的 1.043 重一倍（先例：`.nv-setting` 补 `--ant-slider-rail-bg` /
    `--ant-segmented-track-bg`）。
    ⚠️ `--app-surface-hover` 与 `--app-surface-active` 的本义是**交互态**，**不得**当常驻
    填充（cream 下 `surface-active` 达 1.20，越过全站最重的常驻弱底，大面积铺开整屏就重
    一档）；禁用态底算常驻，应当更**弱**而不是更深。
    ⚠️ antd 的 `colorBorder` **必须显式主题化**（= `--app-border`）：缺省会落到出厂的中性灰
    `#d9d9d9`，而四套主题的内容面都是带色相的，一个无彩度的灰边框同屏就很割裂。
    守卫：`themes.test.ts`「静态色块不用按下态色」+「色块阶梯：页面根铺 bg、浮层底只给浮层用」
    （全仓扫描 + 数值依据 + 白名单 + 定点断言，共 6 条）。

---

## 6. UI 需求与问题清单映射

| UI 编号 | 对应 PX | 对应 TX（如同一改动涉及） | 备注 |
|---|---|---|---|
| UI-01 | PX-01 | — | 需新建 `components/PackDashboard/` |
| UI-02 | PX-02 | — | 严格走 REQ-048 契约 |
| UI-03 | PX-03 / PX-14 | — | 需架构侧先实现跨窗频道 |
| UI-04 | PX-01 / PX-04 | TX-08（touch 口径） | 可独立先落地 |
| UI-05 | PX-05 | — | 与 UI-10 拆分同批做 |
| UI-06 | PX-06 | — | 复用 `GuideTooltip` 无新机制 |
| UI-07 | PX-07 | — | 收尾确认项 |
| UI-08 | PX-08 | TX-02（字数口径） | 口径修正后同步 |
| UI-09 | PX-09 | — | 占位交互规范 |
| UI-10 | PX-10 | — | 纯重构，不改行为 |

---

## 7. 实施进度

> 更新于 2026-10-15。**只看这一节就能知道还剩什么**；细节见 CHANGELOG `[Unreleased]`。

| 编号 | 状态 | 落地位置（关键） | 备注 |
|---|---|---|---|
| UI-01 | ✅ 已交付 | `CharacterPack/components/PackDashboard/`、`pack-layout.ts` | 五区看板；A 区身份卡因与头部重复已删（改动计数上移头部） |
| UI-02 | ✅ 已交付 | `RealmModule/`、`pack-realm.ts` | 阶 + 小层直选，阈值抽纯函数 |
| UI-03 | ✅ 已交付 | `RealmModule` / `AttributesModule` / `StatusModule` / `PackHeader`、`shared/novel/open-setting-center.ts` | 含跨窗频道 `novel-open-setting-center`（UI-03a） |
| UI-04 | ✅ 已交付 | `pack-layout.ts`、`PackModuleShell/` | 摘要行 → 展开 → 钉选 |
| UI-05 | ✅ 已交付 | `SettingCenter/`、`CategoryList/` | 去术语化：「等级序列」「阶梯」 |
| UI-06 | ✅ 已交付 | `OutlinePanel`、`HoverEntityCard`、`ReorderConfirmModal`、`useGuideStore.consumeGuideTooltip` | T-05 只挂第一个空梗概章行；T-07 为常驻说明图标 |
| UI-07 | ✅ 已交付 | `NovelTopBar/index.tsx(+scss)` | 三档层次 + 激活态**主色 1px 内描边** + 4 处 `aria-pressed` |
| UI-08 | ✅ 已交付 | `shared/novel/today-stats.ts` | 术语 / 取值 / 格式三处统一；PRD 口径拍板为**净增** |
| UI-09 | ✅ 已交付 | `SupportPanel/components/ToolLauncher/` | 占位卡改真按钮 + info toast |
| UI-10 | ✅ 已交付 | `SettingCenter/` 子组件目录 + `hooks/useSettingCenter.ts` | 纯重构，对外契约零变化 |

**计划外但已落地（同批）**：浅色主题「内容面 vs 浮层」分层补齐（`themes.scss` +
`theme/themes.ts`）。三个浅色主题原先 `surface` 与 `surface-elevated` 同为 `#ffffff`，
浮层关系不可见；现给 surface 轻染主题色、同步下调 alt/header/sidebar/input，
`elevated` 保持纯白，并加了 WCAG 亮度判据的不变量守卫。

**剩余待办**：本稿 10 项 UI 需求已全部落地。后续若继续，见
`docs/novel-audit-report.md` 第五部分的 TX 阶段（退出可靠性 / 数据完整性）与
R27 人物关系网络、R28 架空地图的功能本体（当前仅有占位卡）。

