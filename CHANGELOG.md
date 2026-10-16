## [Unreleased]

### Added

- **行囊「主角信息看板」L0 首页**（UI 需求稿 UI-01）：行囊打开首屏从「十模块
  编辑器平铺」转为「一屏看懂主角当前状态」的只读看板，四个分区常驻不收起 ——
  B 境界卡（大读数 +「实体面板显示」对照条）/ C 核心属性总览（`base → 最终` +
  被动 / 持续 / 映射增量段，点行开来源明细）/ D 生效状态（仅列 `active`，行内
  开关）/ E 关键设定摘要行（一行一模块，点击即展开并**滚动到**该模块）。
  - 编辑能力零删减：十模块仍在看板下方（E 区一行即入口），看板只负责「看」，
    L1 负责「改」，职责分开但入口不缺。
  - 纯函数落在 `pack-layout.ts`：`dashboardAttrLimit`（默认条数随档位
    宽 8 / 中 6 / 窄 4）、`dashboardSummaryModules`（原样透传启用模块，保作者
    拖拽顺序）、`dashboardActiveStatuses`（只留 `ownerType=status && active`）。
  - 属性增量片段 `attrSegments` 从 `SummaryModule` 提到 `pack-utils.ts`，看板
    C 区与总属性模块**同源**，避免「同一项属性两处显示不一致」的静默分叉；
    `.cpk-seg` 色板同步收敛到公共原语 `pack-common.scss`。
  - 新增组件 `components/PackDashboard/`（`index.tsx` + `index.scss`）；
    **不新增数据表、不改表结构**（`compat` 语义成立）。

- **行囊空态分层引导**（UI-03）：看板各区分层空态从「纯文字说明」改为
  「说明 + 下一步动作按钮」：无属性 → 「套用通用 / 玄幻 / 网游模板」+
  「自己建属性」；无等级体系 → 「去设定中心创建」；未绑定主角 →
  「设为主角」（展开选择器，无候选时置灰并说明）；无生效状态 →
  「+ 持续 / + 被动」。
  - 新增跨窗口导航频道 `novel-open-setting-center`（`src/shared/novel/
    open-setting-center.ts`）：行囊窗口（独立窗口）自己开不了小说窗口的设定
    中心，靠此频道把「打开设定中心并定位到等级分类」的意图送过去。
  - 投递路径沿用既有范式：渲染层 `send` → preload 白名单 → 主进程 focus /
    拉起 NovelWindow 并把负载**点对点**转发回去（`sendTo`，不是 broadcast）
    → NovelWindow 侧 `subscribeDualChannel` 订阅消费、`openSettingCenter`
    定位。负载带 `workId`（多作品过滤）+ `categoryId`（无体系时为 `null`，
    接收方回落默认态，不报错）。

- **行囊境界卡「阶 + 小层」直选**（UI 需求稿 UI-02）：境界卡新增两条直选路径 ——
  阶（阶梯尺 chip；阶数 > 8 时以阶下拉为主路径）与小层（层号条 `1..N`；
  N > 12 时改下拉），保留原有 `± 1 层` 微调。选定「阶 + 小层」≤ 2 次点击、
  全程不离开行囊窗口。
  - 阈值抽成纯函数（`REALM_RUNG_DROPDOWN_THRESHOLD=8` /
    `REALM_SUB_DROPDOWN_THRESHOLD=12` / `realmLadderUsesDropdown` /
    `realmSubUsesDropdown` / `realmSubBarVisible` / `realmSubAriaLabel`），
    组件与测试读同一份。
  - 层号条与下方「阶内进度条」**分开成两块 DOM**：进度条仍是纯读数（沿用
    「无按钮」守卫），层号条是可点选择，视觉与语义都不混淆；`subMax <= 1` 时
    整块层号区不渲染（单选项 `[1]` 是噪声）。
  - 严格走 REQ-048：读写仍只经 `writeRealm → setRealm`，toast 文案取
    `plan.position` 不二次计算；层号按钮带可读名（「元婴 第 2 层（中期）」）
    与 `aria-current`。

- **行囊模块渐进披露与钉选**（UI-04）：非核心模块**默认收成摘要行**（点击就地
  展开为 L1 编辑器），作者可把常用模块**钉选常驻**（打开行囊即展开）。
  - `PackUiPrefs` 新增 `pinned: PackModuleKey[]`（走 `novel_pack_ui`，即改即存，
    不计未保存改动）；旧偏好文件无本字段按空数组处理，不弹迁移、不丢既有偏好。
  - `isAutoCollapsed` 默认策略从「仅窄档折叠」改为「全档一致」（钉选优先 >
    核心三块永不折叠 > 作者显式表态 > 未表态默认收起）。
  - `withEffectiveCollapse` 代理改为**按生效值翻转**折叠（`setModuleCollapsed`）：
    否则未表态模块的 `prefs.collapsed[key]` 是 `undefined`，`!undefined` 翻出来
    仍是收起，表现为「点了展不开」。
  - 模块壳头部新增钉选按钮（`PushpinOutlined/Filled`），钉选态 `aria-pressed`
    + `is-pinned`；核心三块不参与钉选（永远展开）。

- **弱提示补齐 T-05 / T-06 / T-07**（UI 需求稿 UI-06）：`guide-copy.ts` 里这三条文案
  早已定义却一直没挂载，新手在对应场景里看不到任何提示。本次接入：
  - T-05 大纲：挂在**全局第一个「梗概还空着」的章行**的「＋ 一句话梗概」上。只挑一行
    是因为每行各包一层会产生十几个 400ms 定时器同时起跳，冒出多个气泡；虚拟化下这行
    可能在可视区外，滚到时才出现 —— 可接受，总比同屏多个气泡好。
  - T-06 标注层：包在高亮词悬浮卡（`HoverEntityCard`）自身 —— 它出现的地方正是
    「高亮词能点」这句要解释的对象。
  - T-07 排序确认：做成 `ReorderConfirmModal` 标题旁的**常驻说明图标**（气泡只弹一次，
    图标一直点得到），解释「这个确认是防误触排序的，可在排版与偏好里关掉」。
  - 三处都走新增的统一入口 `consumeGuideTooltip(id)`：先让位给正在播的 Tour
    （让位时**不记账**，Tour 结束后同点位仍会弹），再走窗口 store 的**同步**判定 +
    打字保护。不走 `GuideTooltip` 默认的异步落盘判定，是因为这三处宿主会**反复挂载**
    （虚拟列表滚进滚出 / 悬浮卡随指针进出 / 弹窗可多次打开），每次挂载读一次
    `novel_config` 是白花的 IPC。

### Changed

- **色块阶梯改按「基面」记，浮层里的槽不再跨层**（真机反馈：蓝 / 黄主题下
  「红框里的背景跟其余模块对比度不一致，很割裂」）：
  底色 token 都是**绝对色**，「差多少档」取决于它贴在谁身上 —— 同一支
  `--app-surface-alt` 贴内容面只差一档（aurora 1.027 / cream 1.052 / mint 1.030），
  贴纯白浮层就**跨过 `surface` 一整层**（1.071 / 1.087 / 1.064），比同屏兄弟块重一倍
  而且丢掉蓝 / 暖色相。三张真机截图分别是三处成因，用纯 Python 解 PNG 采样 + WCAG
  对比度比定位（不靠肉眼比截图）：

  - **行囊窗口底越级**（图1）：`.cpk` 铺的是 `--app-surface`，而全仓其它页面
    （打卡 / 备忘 / 资讯 / 账本 / 书架 / 写作）一律 `--app-bg` —— 页面底被抬高
    整整一档，于是 L1 模块壳与底**同色 1.00** 只剩描边撑着；为救场，看板卡
    `.cpk-board__card` 借了 `--app-surface-elevated`，是**全仓唯一一处把浮层
    token 用在流内卡片**上。真机 1080px 截图实测：看板卡 `#ffffff`、
    下方模块 `#f5f7fd`，同窗口两种卡片重量。改为 `.cpk → --app-bg` +
    看板卡 `→ --app-surface`，「谁浮谁沉」交给已有的 `--app-shadow-card`。
  - **浮层里的块借了「相对内容面」的档**（图2）：`设定中心` 弹窗是浮层（底 =
    纯白），里面的「进位规则条」却取 `--app-surface-alt`（1.071），而旁边「阶段」
    容器取 `--app-surface`（1.043）—— 同一弹窗内两种档。同类一并修掉：
    行囊的 `SourceDetailDrawer` / `RecordDrawer` 行与空态、`CategoryManager`
    引导条（它原本取 `--app-surface-elevated`，与弹窗**同色 1.00**，其实完全
    没显形、只剩一圈描边）。浮层里的槽一律改用 `--app-surface`。
  - **antd 组件槽位从未主题化**（图3）：**修复前**全仓 `--ant-slider-*` / `--ant-segmented-*`
    **零覆盖**，落到出厂值 —— `Slider.railBg = colorFillTertiary`（黑透明 4%，在
    白浮层上退化成**无彩度**中性灰 `#f5f5f5`，实测 1.090，是全屏唯一没有色相的
    元素）、`Segmented.trackBg = colorBgLayout`（= 页面底，比内容面还深一档，1.089）。
    两者都比浮层应有的 1.043 重一倍。在 `.nv-setting` 作用域里显式指回
    `--app-surface`（与同面板 chip 按钮的 `--ant-button-default-bg` 同档）。
  - **antd `colorBorder` 补上主题化**：此前只给了 `colorBorderSecondary`，
    输入框 / 选择器 / 默认按钮走的是 **antd 出厂中性灰 `#d9d9d9`**（真机图2 的
    「＋ 新建」按钮实测到 `#f5f5f5` 底 + `#d9d9d9` 边，与同排输入框的 `#f9fafe`
    不是一族）。四套主题全部补 `colorBorder = --app-border`，并在 ThemeProvider
    接线。

- **静态色块统一到「常驻色阶」，不再借交互态色**（真机反馈：新界面比其余界面"重"）：
  `--app-surface-hover` / `--app-surface-active` 的本义是**相对所在面的交互态**（hover
  加深、按下更深），不是色阶里的一档。全仓有 **14 处**把它们当常驻填充用，于是这些色块
  直接跳过全站色阶 —— cream 下 `surface-active` 的对比度比是 **1.20**，而同主题最重的
  常驻弱底 `--app-primary-weak` 才 1.13、凹槽 `--app-surface-alt` 只有 1.05。
  - 最刺眼的一处是行囊看板 E 区「已展开的模块行」：整行铺 `surface-active`，几个模块
    同时展开就是一列深棕（真机截图里占屏 10.5%，而基线界面最深的常驻块只有 1.04）。
  - 同族对照更能说明这是系统性误用：`.cpk-bdg` 四个效果性质徽标里 `被`（灰）用 1.20，
    另外三个用强调色弱底 ≈1.05；`.cpk-seg` 四个来源分段同理 —— **「灰」的那个永远
    比兄弟深一档**。
  - 按语义重新分派：常驻中性底 → `--app-surface-alt`（贴在 surface / elevated 上的槽）；
    贴在页面底 `--app-bg` 上的槽（状态条 / 书架 Hero 的进度条轨道）→
    `--app-surface-hover`（alt 与 bg 在浅色主题下近乎同色，会直接消失）；禁用态底 →
    `--app-surface-alt` + `--app-border`（禁用应当更**弱**，不是更深）；凹槽小标签 /
    页码输入底 / 抽屉来源行标记 → `--app-surface-alt`。
  - **立规矩并加守卫**：`themes.test.ts` 新增「静态色块不用按下态色」——递归扫描全仓
    SCSS，`var(--app-surface-active)` 只允许出现在最近祖先选择器带 `:hover / :active /
    :focus` 的规则里，或写在属性名自带状态的 `--ant-*-hover-bg / *-active-bg` 上；配套
    一条数值用例钉住「浅色主题下 `surface-active` 必须严格重于最重的常驻弱底」。规矩
    同步写进 `themes.scss` 文件头；`themes.test.ts` 的 WCAG 工具提到模块级供两组守卫共用。

- **浅色主题「内容面 vs 浮层」拉开一档**：三个浅色主题（aurora / cream / mint）的
  `--app-surface` 与 `--app-surface-elevated` 此前都是 `#ffffff` —— 看板卡、模块壳
  与下拉 / 弹窗只能靠 1px 描边分家，「浮层压在内容之上」这层关系在浅色下完全看不见
  （只有暗色 midnight 分了层）。
  - 改法不是把浮层调暗（那会连累所有下拉 / 弹窗的纯白观感），而是给**内容面**
    `--app-surface` 轻染主题色（aurora `#f9fafe` / cream `#fdfbf7` / mint `#f9fcfa`），
    并同步下调 `surface-alt` / `header-bg` / `sidebar-bg` / `input-bg`，保持既有
    「比 surface 再退一档」的凹槽语义；`elevated` 保持纯白。浅色下的层次方向是
    「越低越深」：elevated(纯白) > surface > alt/header > bg。
  - antd 侧 `colorBgContainer` 逐值跟随 `--app-surface`（否则 antd 组件底色与应用
    自绘面不一致，边界又糊回去）；`colorBgElevated` / `colorBgLayout` 不动。
  - **分层不变量数值化**：新增 5 条守卫（`themes.test.ts`「面板分层」），用 WCAG
    相对亮度算对比度比 —— elevated vs surface ≥ 1.025、bg / surface-alt 对 surface
    ≥ 1.02、顶栏 chip 默认→hover ≥ 1.05、hover→激活 ≥ 1.03。人眼比对截图判不准这种
    3% 的差，数值判据才挡得住「谁把 surface 改回纯白」的回潮。

- **顶栏图标激活态补主色内描边**（UI 需求稿 UI-07 收尾）：三档层次（默认 chip 底 /
  hover 加深 / 持久激活主色弱底）本已齐全，但默认底与主色弱底都是「极浅底」——
  aurora 下两者亮度只差约 1.2%，激活与否只能靠图标换色分辨，整排扫过去仍然糊。
  - `.is-on` 上补 `--ant-button-default-shadow: inset 0 0 0 1px var(--app-primary)`：
    1px 内描边是不依赖亮度的几何信号。走这个变量而不是直接写 `box-shadow` 属性，
    是因为 antd 只在 outlined / solid / dashed 变体上把它落成 `box-shadow`，
    且**不分状态**，hover / active 也不会掉。
  - 4 颗开关型图标（章节栏 / 支撑面板 / 历史快照 / 排版偏好）补 `aria-pressed`，
    屏幕阅读器能听出当前态；行囊与小说设定是唤起型入口，语义上没有「开 / 关」，
    不加该属性。

- **「今日」字数读数口径统一**（UI 需求稿 UI-08）：同一指标此前在三处各写各的
  术语与取值 —— 书架统计条卡「今日新增（字）」、继续写作 Hero「今日 N / M 字」、
  编辑器状态条「今日 +N」。现在统一为：术语`今日新增`（单位`字`跟在数字后，
  不写进标签，与同排「12 部 / 48.2 万 / 5 天」一致）、取值同一来源
  （`usage_log` 净增聚合 + 会话内续加）、格式统一走 `formatThousands`。
  - 口径真相源落在 `src/shared/novel/today-stats.ts`（术语与单位常量 + 决策说明），
    任一消费方就地写文案即由守卫测试拦下。
  - `docs/novel-editor-prd.md` 开放问题「今日字数口径：净增 vs 保存累计」正式拍板为
    **净增**（删字扣回，即现状口径，无历史数据迁移）。

- **设定中心单体拆分**（UI-10）：`SettingCenter/index.tsx` 1494 行单体按功能拆为
  子组件目录（左栏分类列表 / 分类卡 / 等级序列 / 顶部工具头 / 四个弹窗），状态机与
  全部提交动作收敛到 `hooks/useSettingCenter.ts`，父组件只做组合。
  - **对外契约零变化**：`SettingCenter` 的 props 接口、`export default`、
    既有回归用例涉及的全部回调时机与参数保持原样 —— 只搬移内部结构，不改对外行为。
  - 样式随组件就近：公共块级零件收在 `setting-primitives.scss`，其余各归组件
    `index.scss`；自带造型按钮的清零点（`__set-realm` / `__sub-chip` / `__ins-btn`）
    一并迁移，`novel-ui-kit.test.ts` 守卫全绿。

- **设定中心信息架构去术语化**（UI-05）：把「境界体系 = `kind='realm'` 的一条
  等级序列」翻译成新手能按常识找到的入口 —— 左栏分组名从中性的「设定分类」改为
  「等级序列」，并在该区顶部补一句人话说明「境界 / 品阶 / 功法等级都在这里 ——
  一种体系建一个分类」；右侧阶梯小节标题同步改称「阶梯」，避免与分组名重复。
  - 不向用户暴露 `kind='realm'` / `level` / `rank` 等内部字段名；**不新增数据表、
    不改表结构、不改 IPC 契约**（纯前端信息架构调整）。
  - 保留并确认 FR-05 订正过的提示「重命名与删除在右侧卡片的「编辑 / 删除」按钮」，
    不回潮到已废弃的「右键 / 行尾菜单」承诺。

### Removed

- 编辑器 store 的 `todayAdded`（会话内新增字数）字段：状态条改用今日累计后它不再
  有任何渲染消费方，留着就是「同一个今日两个数」的复发温床。要新增「本次写作字数」
  这类读数请另起字段并显式命名，不要再挂回今日口径。

### Fixed

- **工具 Tab 的「规划中」占位卡点了没反应**（UI 需求稿 UI-09）：右栏「工具」Tab 的
  「人物关系网络」「架空地图」两张卡此前是 `<div>` —— 没有按钮语义，键盘 Tab 到不了，
  鼠标点了也一片安静，与旁边的「起名器」摆在一起像是坏了。改为 antd `Button`
  （虚线描边 + 显式弱化配色），点击给一次 info toast
  （「「人物关系网络」还在规划中，上线后会出现在这里」），**不触发**既有的工具回调。
  - 弱化不再靠整卡 `opacity: .68`（那会把文字一起糊掉、对比度掉到读不清），改为分别
    下调前景 / 底色 / 描边三色，文字保持可读。

- **编辑器状态条里的「今日」自相矛盾**：状态条显示的是**会话内**计数（`todayAdded`），
  紧挨着的今日目标进度条却按今日累计（`todayTotal`）走 —— 打开编辑器时左边「今日 +0」、
  右边进度条却已填了大半，且两个数都和书架的「今日新增」对不上。改为一律读今日累计。
  同一根因还顺带修掉：继续写作 Hero 用 `toLocaleString()` 格式化（跟着系统区域设置变，
  千分位可能不是逗号），改为与其它两处同一格式化函数。

- **行囊看板与 L1 编辑器之间没有间距**（看板落地后的版式回归）：看板 `.cpk-board`
  与下方 `.cpk__zones` / `.cpk__flow` 都是滚动容器 `.cpk__body` 的直接子项，块级流
  没有默认外边距 → 看板最后一行摘要**贴着**第一个模块卡上沿，两级结构糊成一片。
  补相邻兄弟外边距（宽 / 中档 14px、窄档 8px）。不用「容器上 flex + gap」是因为
  滚动容器改成 flex 会让子项默认 `flex-shrink: 1`，内容超高时反而把看板压扁。

- **看板点摘要行「没反应」**：看板在上、编辑器在下，点摘要行只改折叠状态时，变化
  发生在**视口之外** —— 手点了、画面没动，用户以为按钮坏了，得自己往下滑才找到刚
  展开的模块。改为**导航语义**：点行 = 确保该模块展开 + 平滑滚动到它（已展开则只滚动）。
  收起一律留给 L1 模块壳自己的折叠按钮（那儿松手就见效）—— 从看板「远程收起」一个
  视口外的模块，只是把「点了没反应」换个方向再犯一次。
  - 判据抽成纯函数 `moduleScrollDelta(target, viewport)`：目标已完整可见返回 `null`
    （一像素都不动，避免「点了画面乱跳」），否则返回把目标顶部对齐到可视区顶部所需的
    位移（留 8px 呼吸）。抽出来是因为 jsdom 没有布局引擎，`getBoundingClientRect` 与
    元素级 `scrollTo` 在渲染测试里量不出真值。
  - 模块外层新增 `.cpk__module` 定位块（挂 `data-pack-module`）。渲染端与查询端是
    **成对字符串**，改一边会静默失效，故加了源码断言守卫 `pack-board-nav-guard.test.ts`。

- **境界卡上的「收起」点了没变化**：B 境界卡按展开态把按钮文案切成「收起」，但它切的是
  **下方 L1 的境界模块**，而这张卡本身没有可收起的内容 → 观感是「这颗按钮没用」。
  改为恒显示「调整」，语义统一为「展开并跳到境界编辑器」。

- **看板身份卡与头部逐项重复**：头部横向概览带（设计稿 §8.6.1）已完整承担
  「我是谁 + 存没存 + 工具」，看板的 A 区身份卡把名字 / 境界 / 绑定态 / 改动计数又
  抄了一遍，两行叠着纯属噪音。删掉看板这边的 A 卡；它唯一独有的「角色首字头像」上移到
  头部头像位（名字为空才退回人形图标），改动计数由头部既有的「全部已读 N」承担。

- **行囊境界关联「半保存」**（审查报告 TX-01）：改境界原本分两步落库——先
  `novel-pack-save` 写文档，再单独调 `novel-link-set` 写 `novel_links`。两步之间
  任一步失败（进程被杀 / 库忙 / 校验抛错）即留下「文档已变、关联未变」的半保存态，
  下次打开行囊读到的境界与实体面板对不上。
  - 渲染层保存折叠为**一次 `novel-pack-save`**：`realmLink` 随文档一起进
    `PackSavePayloadDto`，仅在「与上次保存态有净变化」时才带上（避免每次保存都重写
    `novel_links`）。`usePackData.save()` 不再单独调 `writeRealmLink`。
  - 主进程在 `novel-pack-save` 事务内新增第 ③ 步 `upsertRealmLinkRow()`（先删后插，
    复用 `dbRun` 并入外层事务），与清草稿、写文档同生共死——要么都成功、要么都回滚。
  - `novel-link-set` 处理器同步改走同一 helper，消除两处 SQL 漂移。

- **卸载时 flush 与保存竞态**（审查报告 TX-13）：行囊在**保存进行中**被关闭/卸载时，
  卸载 flush 会把保存前的旧草稿再抖一次写回，覆盖刚落库的新内容。
  - 新增 `savingRef` 同步闸门：`save()` 进入即置位（同步，卸载 flush 读得到）并取消
    在途草稿防抖；`flushDraft()` 开头 `if (savingRef.current) return;` 直接跳过；
    保存结束复位。

- **灌入正文触发的字数基线漂移**（审查报告 TX-02）：打开章时 CodeMirror 把库中原正文
  灌进编辑器，该次 `setContent` 被当作「用户编辑」，以旧 draft/base 当 `previous`
  基线、把灌入本身算成净增，导致「本章字数 / 今日 +N」在上手瞬间虚高。
  - `setContent(chapterId, next, baseContent, source)` 新增第 4 参 `source:
    "user" | "hydrate"`；`"hydrate"` 分支只按 `baseContent` 刷新基线、零草稿写入。
    好处：灌入路径不再污染字数统计，切换章时基线始终等于库内真值。

### Tests

- 色块阶梯新增 **4 条守卫**（`themes.test.ts` 18 → **22 例**），并逐条做**变异测试**
  （改坏必红，证明非空转）：
  - 「窗口 / 页面根一律铺 `--app-bg`」：扫 `src/windows/*/pages/*/index.scss`
    （9 个页面骨架）+ 行囊窗口内容根，取**最外层规则**的 `background` 断言 ——
    不写可以（窗口壳已铺 bg），写了就必须是 bg。**M1**（行囊 `.cpk` 退回
    `--app-surface`）→ RED。
  - 「`--app-surface-elevated` 只出现在白名单里的浮层文件」：11 个文件白名单
    （下拉 / 弹窗 / 抽屉 / 悬浮卡 / portal 浮层）+ 反向自证「至少 6 个文件真在用」。
    **M2**（看板卡退回 elevated）→ RED。防的是本轮行囊看板那类「流内卡片借浮层
    token」的复发。
  - 「浮层里的槽一律用 `--app-surface`」：6 处定点断言（进位规则条 / 两个弹窗
    的行与空态 / 分类引导条 / `.nv-setting` 的两个组件槽位 token），并检查该规则
    **自身**声明里不得出现 `background: var(--app-surface-alt)`（嵌套子规则如
    `&.is-base` 属 surface 上的合法一档，排除在外）。**M3**（进位规则条退回 alt）、
    **M5**（滑块轨道退回 antd 出厂 `#f5f5f5`）→ RED。
  - 「antd 边框色与 `--app-border` 同步」+「ThemeAntdTokens 每个字段都被
    ThemeProvider 透传」：后者防「加了 token 忘接线」这类静默失效。
    **M4**（aurora 去掉 `colorBorder`）→ RED。
  - 数值依据用例补第二条：同一支 `alt` 贴浮层 > 贴内容面 + 0.02、`surface` 贴浮层
    < 1.06、`alt` 贴 `bg` < 1.02 —— 把「按基面记」这条结论钉成数字。

- `usePackData.test.tsx` 补 TX-01（境界净变化才提交 / 随保存同事务 / 未变不带）与
  TX-13（保存中卸载不 flush 旧草稿）回归用例；`beforeEach` 加 `mockReset()` 修复
  `mockResolvedValueOnce` 队列跨用例泄漏。全套 25 文件 500 用例通过。
- UI-02 / UI-04 新增守卫与用例：`pack-layout.test.ts`（全档默认折叠 + 钉选优先）、
  `pack-utils.test.ts`（阈值边界 / 层号可读名）、`types.test.ts`（`pinned` 缺省安全）、
  `RealmModule/index.test.tsx`（层号条 / 阶下拉 / 小层直选）、
  `PackModuleShell/index.test.tsx`（钉选按钮显隐与态）、
  `pack-close-guard.test.ts`（`writeRealm` 调用点计数随 UI-02 更新为 3，
  并新增「带 carry 的推进只允许一处」断言）。行囊套件 24 文件 496 用例通过。
- UI-03 / UI-01 新增用例与守卫：`open-setting-center.test.ts`（频道负载归一出
  与脏负载拒绝）、`pack-window-guards.test.ts`（新增「preload 白名单放行 +
  主进程 focus 后点对点转发、不得 broadcast」断言）、`pack-layout.test.ts`
  （看板条数 / D 区过滤 / E 区透传）、`PackDashboard/index.test.tsx`（五区关键
  行为：默认条数、点行开明细、只列 active、摘要行触发展开）、
  `RealmModule/index.test.tsx`（空态「去设定中心创建」与「设为主角」按钮）、
  `AttributesModule/index.test.tsx` + `StatusModule/index.test.tsx`（空态动作按钮）；
  `pack-ui-kit.test.ts` 收录新增自带造型按钮（`cpk-emptyblock__cta`、
  `cpk-board__*`）。行囊套件 26 文件 529 用例通过。
- UI-08 新增口径守卫 `src/shared/novel/today-stats.test.ts`：钉住术语与单位常量；
  断言三处消费方都引用常量（不硬编码文案）；断言状态条读 `todayTotal` 而非会话内计数；
  **全仓扫描「今日新增」字面量只允许出现在真相源模块**（防第四次分叉）；
  断言三处都不用 `toLocaleString`。`useNovelEditorStore.test.ts` 随字段删除调整
  （断言由等效的 `todayTotal` 承担，另有一例改写为「水合只写 todayTotal、不动恢复横幅开关」）。
- 浅色分层 / UI-06 / UI-07 / UI-09 用例：`themes.test.ts` 新增「面板分层」5 条（亮度 +
  对比度比数值判据，含 antd `colorBgContainer / colorBgElevated / colorBgLayout` 与
  token 逐值一致）；`novel-ui-kit.test.ts` 新增「顶栏图标三档层次」（读编译产物，取
  **最后一次** `--ant-button-*` 声明再比对 —— 清零点 mixin 自己就会写一行
  `--ant-button-default-bg: transparent`，用 `toContain` 会被它糊弄过去）；
  新建 `NovelTopBar/index.test.tsx`（六图标结构契约 + `aria-pressed` + 回调互不串扰）、
  `useGuideStore.test.ts`（T-05/06/07 消费入口：只吃一次 / 点位互不影响 / Tour 在播时
  让位且不记账 / 打字保护期内不记账）、`ToolLauncher/index.test.tsx`（三卡皆按钮 +
  占位 toast 不触发既有回调）；`OutlinePanel/index.test.tsx` 补 T-05「全屏只弹一个气泡」
  （含「多章都空着」与「都填满」两端）；`guide-guard.test.ts` 补三处挂载点 + 统一消费
  入口 + `guide-copy.ts` 文案同源的源码路径断言。
- 本轮变异验证（证明用例非 vacuous）：浅色 `surface` 改回 `#ffffff` → 2 例 RED；
  antd `colorBgContainer` 改回 `#ffffff` → 1 例 RED；T-05 改成「每行都挂」→ 守卫 RED；
  T-06 去掉 `consume` 回调 → 守卫 RED。还原后全绿。
- 静态色块守卫（`themes.test.ts`）自带反向自证：断言扫描到的 SCSS 文件数 > 20、
  交互态里 `--app-surface-active` 的真实使用处 > 3（否则「零违规」可能只是因为全仓
  没人用它）。变异：把行囊展开行改回 `surface-active` → RED（且报错行号与真实文件一致，
  因为新增的 `stripCommentsKeepLines` 按原行数换空行）；把 cream 的 `--app-primary-weak`
  调深到越过 1.15 → 数值用例 RED。还原后 16/16 GREEN。

## [1.45.0] - 2026-10-16

### Added

- **全局设定中心（跨书共享设定库，独立窗口）**：一本书里维护的设定分类与等级，可以
  一键放到「全局库」，供其他作品引用——同一套「境界体系」不必在每本书里重建一遍。
  - **入口**：书架顶栏新增「全局设定中心」（`ClusterOutlined` + 文字标签），点开为
    **独立窗口**（单实例，与行囊窗口同范式；已开则只聚焦不新开）。full / novel 版
    包含，lite 版不含。
  - **引用 = 实时同步**：本书设定中心左栏新增「从全局库选择」，可多选全局分类引入。
    引入后是**引用**而非副本——全局侧改名 / 调层级顺序 / 增删等级，引用它的每本书
    即时跟随（跨窗口广播 `global-setting-changed`，带「排除发送窗口」的防回声逻辑）。
  - **引用项只读，且权威在主进程**：被引用的分类在本书侧显示「全局 · 自动同步」徽标，
    编辑 / 删除 / 排序 / 批量生成 / 拆分层级等 **10 个写入通道**一律收走入口，且主进程
    写通道首行校验 `source_global_id` 非空即拒——UI 禁用只是第二层，防绕过。
  - **放置到全局（复制上架）**：本书分类「放置到全局」→ 复制一份到全局库，**本书不
    受影响**。命中同名走冲突三选，默认「新建为副本」；`kind='realm'` 撞车默认不替换；
    本书已有境界体系时，引入全局境界降级为普通分类（保住「每书至多一个境界体系」）。
  - **全局删除不丢数据**：删除被引用的全局项需二次确认；确认后引用方**就地固化为本书
    副本**（内容保留、可继续编辑，标注「原全局项已删除，已转为本书副本」），且不动
    该书既有的 `novel_links` 关系。
  - **数据落点**：新增两张全局表 `novel_global_setting_categories` /
    `novel_global_setting_levels`（不带 `work_id`——与本书域物理分表，避免与「空
    workId 播种垃圾数据」的既有语义冲突）；本书侧新增可空列 `source_global_id` /
    `detached_from_name` 记录引用来源。全部走启动期 `pragma table_info` 探测 +
    `ALTER TABLE ADD COLUMN` / `CREATE TABLE IF NOT EXISTS` 增量迁移，老库新库结构
    收敛一致。每库至多一个境界体系由 `WHERE kind='realm'` 偏唯一索引 + 三处应用层
    校验共同兜底。
  - **导出**：全局库支持导出 JSON（模板库 / 导入列为后续项）。
- **要素境界可选「小境界」**：未拆分小层级、但 `sub_levels > 1` 的境界阶，现可直接点选
  「第 N 层」（阶下方的层号 chip 组），与「已拆分的初期 / 中期 / 后期 / 圆满」互斥
  呈现；再点当前层即解除绑定。此前最多只能选到「阶」，表达不了「筑基第七层」。
- **引导新增第 6 步「一套设定，多本书共用」**（书架视图，可关闭；1–4 强制段不变）。
- **架构调整**：设定中心三栏组件从 `NovelPage/components` 提升到
  `src/shared/components`（新增 `source: "book" | "global"` 入参）；提升时**保留了
  本书侧 UI-10 的拆分结果**（`components/` 8 个子组件 + `hooks/useSettingCenter` +
  `setting-primitives.scss` 随迁，而非回退成单体），NovelPage 直接引用 shared，原路径
  不再留垫片；设定纯函数与编号中文转换下沉 `src/shared/novel/*`（旧路径同样留垫片）；
  两个设定域 handler 的共有内核（rank 三件套 / 引用只读守卫 / 建立引用·同步·固化·
  上架·引用计数）抽出为 `novel-setting-shared.ts`，单向依赖无环。
- **类型管理入口更显眼**：要素面板的纯图标按钮改为「图标 + 文字」（热区 28px），并在
  空态补充引导 CTA。

### Changed

- **顶栏「本书设定」改为 toggle**：与「行囊 / 排版与偏好 / 快照」一致，再点一次关闭
  （此前它只开不关）。
- **行囊境界文案**：由 `筑基 1/4` 改为 `筑基 * 初期 1/4`、`练气 * 第七层 7/13`
  （`阶 * 小层名 进度`）；数字是否转中文跟随本书「编号样式」设置，无小层名时回退原
  格式，`sub_levels <= 1` 只出阶名。
- **出场章节列表行间距**：4px → 8px（`APPEAR_ROW_HEIGHT` 34 → 38 成对调整，保证虚拟
  列表行高一致、滚动不跳白条）。
- **工具卡描述换行**：描述文字不再撑破卡片。根因是它继承了 antd `.ant-btn` 的
  `white-space: nowrap`（`ant-button-reset` 未清零），现显式改回 `normal` +
  `overflow-wrap: anywhere`。
- **引导第 5 步主按钮**：跨视图那一步文案变为「下一步 · 去书架」，点击后**自动切回
  书架**续播第 6 步（此前点了整屏无反馈、要用户自己想到返回书架）。判据取自「前后两步
  视图不同」，不写死步号，1→2→3→4→5 行为逐字不变。
- `formatSubLevel` 的 `{n}` 模板由「只替换首个」改为全局替换，与拆分预览 `previewSplit`
  同口径（当前仓库内无多占位模板，属预防性对齐）。

### Fixed

- **「行囊 / 本书设定要点两次才出窗口」**：真因不是抽屉遮罩，而是「上一层全视口浮层
  （Modal / 引导蒙层）以『点击即关』收自己」与「这两颗按钮只开不关」在同一次点击上
  争用——第一击被上层收走，按钮根本没接到。修法：抽屉的「点外部关闭」从覆盖式捕获
  遮罩改为**文档级 `mousedown` 分流**（只关自己，绝不 `preventDefault` /
  `stopPropagation`，同一次点击既关抽屉又触发被点元素），并把这两颗按钮改为 toggle。
  「点抽屉外部关闭」的既有能力完整保留，`Esc` 逐层关闭链（设定中心 → 排版 → 快照 →
  专注）不受影响，连续开合 20 次无监听器泄漏。
- **伏笔的章节名可点击跳转**：大纲面板里伏笔条目的来源章节名改为链接，点击切换到该章；
  卷级伏笔（没有具体章）仍为纯文本、不可点。
- `guide-state.ts` 中「红点显示条件」的注释与实现不符（实现为 `state !== "done"` 时
  显示，即 done 必消失），已改正注释，行为未变。

## [1.44.1] - 2026-10-15

### Changed

- **性能优化**：`app://` 产物响应补缓存策略，并为 `app` scheme 开启 V8 代码缓存、
  渲染侧 `v8CacheOptions:"bypassHeatCheck"`，降低功能窗口（行囊 / 设置）与主窗
  启动时对同一批产物（尤其 1.4MB antd chunk）的重复解析
  （预研见 `docs/window-pool-preresearch.md` §7.1 P0-1、§4.2）。
  - 哈希资产（`assets/*-<hash>.js|css|woff2` 等内容寻址文件）→
    `Cache-Control: public, max-age=31536000, immutable`。同一 URL 的字节跨版本
    不变，若 Chromium 对自定义协议响应启用磁盘缓存则可跨窗口免主进程读盘（**未验证
    假设**，不成立也无害，最坏退回每次读盘）；真正的跨窗口收益锚点在下方 codeCache。
  - HTML 入口与固定文件名资源（`src/windows/*/index.html`、favicon、tray 图标）→
    `Cache-Control: no-store`。这两类跨版本会被同名覆盖，一旦被缓存，升级后仍会
    被喂上一版 HTML，而它引用的旧哈希资产已从磁盘删除 → 白屏。
  - `protocol.registerSchemesAsPrivileged` 的 `app` scheme 增加 `codeCache: true`：
    Chromium 默认只对 http(s) 方案写 V8 字节码缓存，自定义 scheme 必须显式打开，
    否则一次编译的成果无法跨渲染进程复用。但 Chromium 对「不够热」的脚本仍跳过热度
    判断，故渲染侧 `createWebPreferences` 同步设 `v8CacheOptions:"bypassHeatCheck"`，
    二者配套才真正生效（效果验证见预研 §7.3 #4）。
  - 分档判定抽为纯函数 `electron/app-protocol-cache.ts`
    （`isHashedAssetPath` / `resolveAppProtocolCacheControl`），单测
    `app-protocol-cache.test.ts` 用 `dist/` 真实产物文件名覆盖，并加源码守卫
    防止 `Cache-Control` 接线与 `codeCache` 被误删。
  - dev 模式不受影响：`VITE_DEV_SERVER_URL` 存在时走 vite server，不经 `app://`。

## [1.44.0] - 2026-10-14

### Added

- **左栏卷删除（二次确认）**：卷头悬浮出现删除图标（紧贴「＋」左侧，hover 转危险色），
  点击后弹出与章节删除共用的确认浮层——文案按卷内章数分支（「将删除『第N卷 · 名字』
  及其下 N 章、全部历史快照与大纲条目，不可恢复」/ 空卷变体），确认才执行。
  - 主进程 `novel-volume-delete` 单事务级联（叶 → 根：大纲条目 → 快照 → 章 → 卷；
    大纲条目必须先行，其 `chapter_id` 子查询依赖 `novel_chapters`，删章后会变空集
    留下孤儿）。
  - 渲染层用 `buildSortOrder` 把幸存卷的 sort 紧实成 1 基稠密，再走既有
    `novel-volume-order` 批量落库，不新增 SQL 复杂度；删除前逐章
    `dropChapterDraft`（不用 `clearDrafts`，免连累其他卷的未存草稿）。
  - 激活章在被删卷内时自动切到相邻卷（先下一卷首章、再上一卷末章），口径同删单章。
  - 虚拟化列表行例外：行内不挂 Popconfirm，全列表共享唯一浮层 + 视口坐标锚点
    （行被回收也不丢定位）；组件测试覆盖「卷删 / 章删 / 取消」三条路径。

### Changed

- **新手引导改「强制引导」**（用户反馈）：第 1-4 步（新建作品 → 建卷章 → 本书设定
  → 行囊）的步骤卡片不渲染右上角关闭叉、不响应 Esc，唯一出口是「下一步」——
  零基础作者见叉就点，设定中心与行囊会被整段跳过。第 4 步行囊讲完即强制引导结束；
  第 5 步（选中文字，右键建资料卡）保留为普通可关闭步骤（叉 / Esc 可跳过），
  它讲的是要先选中文字的交互，硬按着头看效果差。

### Fixed

- **「点下一步，下一张引导卡片不出现」**：单步 Tour 实例下 antd 的「下一步」恒走
  finish 路由（`current === total - 1` 恒真），rc-tour 的 `onFinish` 先调
  `handleClose()` 触发 `onClose={skip}`——`playingStep` 被清空后 `goNext` 读到
  null 直接空转，且引导状态被误写成 `skipped`。现在 `onClose` 只在可关闭步骤上接
  `skip`（强制步传 `undefined`），守卫测试钉住该形态。
- **「Tour 偶现不显示」三个根因**：① 目标探测一失败即 `pause()` 且无续播机制
  （终态暂停）→ 改 rAF 重试到 600ms 预算尽头才暂停；② 侧栏折叠是
  `width:0; opacity:0`，元素仍有布局盒，老可见性判断（仅 `getClientRects`）
  误判可见，卡片被定位到看不见处 → 改三关口（布局盒 / 视口交集 / 祖先链
  `visibility`·`opacity`）+ Tour 实例收 `visible` 收摊；③ store `start()` 遇
  `playingStep` 非空一律 return，两个实例各握对方的步会互等死锁、引导永不再现
  → 允许跨视图改拍续播。

### Removed

- **编辑器空态弱提示 T-01**（「写下第一章」气泡，用户反馈）：空态按钮本身就是强
  CTA，再挂一个气泡属重复提示，且 Tour 第 2 步已覆盖起步路径。T-03 选区气泡不变。

## [1.43.1] - 2026-10-14

### Changed

- **Tour 步骤顺序调整**（用户反馈）：编辑器内的顺序改为 2 建卷章 → 3 本书设定
  按钮 → 4 行囊按钮 → 5 右键建资料卡。原顺序是设定 → 右键 → 行囊；行囊作为
  「主角状态面板」紧跟设定讲解更顺，右键收尾。`guide-copy.ts`、帮助中心数据
  （`guide-doc.ts` flow）、PRD §6.2/§7.2 与帮助文档 HTML 已同步，守卫测试钉住
  新顺序防止漂移。

### Added

- **弱提示 T-03：选中文字 → 右键建资料卡**（`docs/novel-onboarding-prd.md` §7.3）：
  作者在正文里选中 ≥2 个字时，选区下方浮出一次性提示，说明右键可以把选中的
  名字建成资料卡（角色 / 地点 / 势力 / 物品）或记进行囊。
  - 新增 `SelectionGuide`：气泡仍用 antd `Tooltip` 计算位置与避让，但锚点是
    运行时由 `view.coordsAtPos` 算出的零尺寸定位点——`GuideTooltip` 只能把
    气泡挂在被包裹的真实元素上，而选区没有元素，只有坐标。
  - 出现调度（延时 400ms / 停留 6s / 一动就撤）从 `GuideTooltip` 抽出为
    `use-guide-bubble`，两个气泡共用一套规则。顺带修掉一个隐性 bug：原实现
    把 `consume` 放进 effect 依赖，调用方传内联函数时定时器每次渲染都重置，
    编辑器里敲字会让 T-01 永远等不到出现时机。
  - 四条排除条件：单字符选区不弹（多半是拖动误选）、输入法组合期不弹（候选
    替换范围会被误判成选区）、Tour 正在播时不弹（第 4 步讲的正是这件事）、
    打字保护窗口内不弹；打字与滚动都会撤掉气泡（选区坐标随即失效）。

### Fixed

- **新手引导 Tour 卡片遮挡「新建作品」弹窗的书名输入框**。弹窗打开时第 1 步
  的卡片仍钉在「新建作品」按钮上，正好压住输入框。现在弹窗打开即让位
  （`pause()`，PRD §11「引导不与弹窗抢焦点」）；点「取消」关闭后续播第 1 步，
  创建成功则由视图切换的既有编排自然接到编辑器第 2 步。守卫测试钉住
  「弹窗开着必须暂停、OK 回调不得续播」两条规则。
- **新建作品：空书名点「创建并开写」不再静默无反应**（PRD 遗留问题 L-03）。
  原先 `createWork` 直接返回 null，弹窗不关也不提示，作者只会以为软件卡住。
  现在提交前先走 `validateWorkName`：不通过则输入框进 error 态、下方给出
  「先给书起个名字（后面随时能改）」并自动聚焦，一敲字即撤掉报错。校验是
  `bookshelf-utils.ts` 里的纯函数，文案唯一事实源，附单测（空串 / 纯空格 /
  全角空格均拦截）。

## [1.43.0] - 2026-10-14

### Added

- **新手引导体系（L1 漫游 + L2 弱提示 + L3 帮助中心）**，对齐
  `docs/novel-onboarding-prd.md`：
  - **L1 漫游引导**（antd `Tour`）：首次创作闭环 5 步——新建作品 → 建卷章 →
    建总设定 → 正文右键 → 行囊盘点。因书架页与编辑器页是 `display` 切换的
    两个兄弟容器（`display:none` 内元素取不到有效 rect），Tour **按视图拆成
    两个实例**，靠窗口级 `useGuideStore` 的 `playingStep` 串联；目标用
    `data-tour-target` 稳定锚点定位（10 处），探测走 `getClientRects()`
    ——目标不可见时**暂停等待**而非写死状态，等条件到位后续播。
  - **L2 弱提示**（`GuideTooltip`）：不遮罩、不拦截点击（浮层
    `pointer-events: none`）、每点位仅 1 次。本期接入 T-01（编辑器空态
    「写下第一章」）、T-02（设定中心「模板库」）、T-04（行囊「模块管理」）。
  - **L3 帮助中心**（标题栏「？」+ `F1`，单实例）：快速上手五步 / 功能索引 /
    常见问题 / 快捷键四段 + 关键词检索；首屏「重看新手引导」可重置引导重放
    （按当前视图定位起始步）。行囊窗口同样常驻（不提供「重看」，那里没有 Tour）。
  - **打字保护（FR-06）**：编辑器键入 3 秒窗口内不触发任何引导；播放中
    开始打字则整体让位并延后。
  - 引导状态存 `novel_config` 新增键 `novel_guide_state_v1`（**不新增数据表**，
    不绑 workId，安装实例级一次），损坏时按 `not_started` 兜底不崩。
  - 新增共享模块 `shared/novel/guide-copy.ts`（文案唯一事实源）、
    `guide-state.ts`（状态机 + 持久化）、`guide-doc.ts`（文档数据 + 检索），
    以及 `shared/components/HelpCenter`、`shared/components/GuideTooltip`；
    窗口级 `src/windows/NovelWindow/store/useGuideStore.ts`。
  - 守卫测试 `shared/novel/guide-guard.test.ts` 钉住 10 个锚点归属、
    Tour 挂载点与打字保护收口点（防 RK-03 目标漂移）。

### Fixed

- **设定中心左栏过期提示**（FR-05）：原提示承诺「右键或『⋯』可重命名 / 删除
  分类」，但分类行既无 `onContextMenu` 也无「⋯」按钮，作者会一路找下去；
  已改为「重命名与删除在右侧卡片的『编辑 / 删除』按钮」，与实际交互一致。
- **设定中心空态补齐 CTA**（E-02）：「还没有设定分类」只有描述没有出口，
  现增加「套用内置预设」按钮直达模板库（空态必须给下一步动作）。

## [1.42.0] - 2026-10-14

### Changed

- **行囊装备栏下线「分组」功能**（用户要求）：装备栏头部的「分组设置」入口与
  `GroupManager` 弹框删除（组件目录一并移除），`usePackPanel` 的
  `addGroup` / `updateGroup` / `removeGroup` / `groupManagerOpen` /
  `openGroupManager` 等 API 同步撤下。`novel_pack_groups` 表与物品
  `groupId` 列保留（compat，旧数据不丢）：模板播种的分组（法宝 / 功法 / 随身）
  仍参与部位「仅接受」匹配与整组停用闸门，只是不再有创建 / 改名 / 删除的
  管理入口 —— 与 1.41.0 物品栏下线分组同一口径（数据层不动，只收 UI）。
- **要素详情卡「出场章节」改整行列表**（`EntityDetail`）：原浮动药丸改为
  整行可点的列表行，章名序号（「第7章」）做成主色弱底徽标，hover 整行染
  主色弱底；行高 28 → 34px（`APPEAR_ROW_HEIGHT` 与样式同步上调，
  `index.test.tsx` 的高度断言同改）。
- **要素详情卡「新建境界体系」按钮改实心主色**：空态里唯一的行动点此前是
  主色描边虚框，与虚框容器混为一体；现在实心主色承载，与「编辑」按钮同档，
  是该区块的视觉重心。
- **编辑器右上角动作图标常驻浅色底**（`NovelTopBar`）：六颗图标此前默认
  透明底，只有 hover / 激活才显色，扫过去是一团灰点、看不出可点；现在默认
  `--app-surface-hover` chip 底，hover / active 加深一档（`--app-surface-active`），
  持久激活态仍走主色弱底，三档层次分明。
- **书架灵感卡编辑时隐藏悬浮操作栏**（`IdeaNoteCard`）：编辑态操作栏整条
  不渲染 —— 此前编辑时它仍浮在 TextArea 上方，既挡文本又容易误触
  （置顶 / 删除都在一拍之内）。操作栏底色同时改明显：`--app-surface-alt`
  + 1px 描边（原与卡片同色的 elevated 底只剩一层投影，看不出「这里有一排
  按钮」），图标色由 muted 提到 secondary，hover 染主色弱底。
- **设定中心「等级序列」列表可读性**（`SettingCenter`）：行容器收成一张卡
  （描边 + 圆角 + 4px 内边距），行内边距 4px → 7px，奇数行铺斑马纹
  （`is-alt`，hover 仍可压过）；小境界标签（「13 小境界」）改成主色弱底
  徽充当行首锚点，小层名去掉灰底改无底浅签（hover 才染主色弱底）——
  原来八阶各一排 11px 灰字灰底方块，是整个列表最「费眼」的来源。
- **章节名输入框下划线改直角**（`EditorPane`）：antd Input 自带 6px 圆角会
  作用在不可见的边框盒上，把只画 `border-bottom` 的下划线两端顶成翘角
  （用户原话：「圆不圆方不方」）；显式 `border-radius: 0` 后是一条干净的
  直线，与「下划线式行内编辑」的意图一致。

## [1.41.0] - 2026-10-14

### Added

- **书架灵感库支持编辑灵感**（`IdeaNoteCard` / `useBookshelfData.updateNoteContent`）。
  此前灵感卡只有置顶 / 归属迁移 / 删除，写错了只能删掉重记；现在悬浮操作多出
  「编辑」，行内 TextArea 直改（Enter 保存 · Shift+Enter 换行 · Esc 取消），
  空内容与未改动不落库，与编辑器灵感面板同口径。落库后照常广播
  `novel-note-changed`，编辑器侧就地补丁。
- **书架灵感库列表虚拟化**（`IdeaRail` → `Virtuoso`）。此前是 `.map` 全量挂载，
  灵感攒到上千条会把右栏拖垮；滚动改由列表自己接管（外层 `overflow: hidden`，
  避免双滚动条），与编辑器灵感面板同一套方案。

### Changed

- **编辑器右侧灵感列表并入「未分组」灵感**（`useNovelData.notes`）。
  workId 为空串的灵感是书架灵感库的「未归属」收集池，此前被 workId 过滤
  排掉 —— 在书架记一条未归属灵感，回编辑器灵感面板却一片空白。现在并入
  当前列表且可编辑（不走「外部灵感只读」路径，不带来源标签）。
- **物品栏下线「分组」功能**（用户要求）：物品「更多」菜单的「分组」行与
  头部的「分组设置」按钮删除，物品不再逐个标分组；`groupId` 列保留（compat，
  旧数据不丢），装备限制仍由部位 accepts × 物品 groupId 匹配 —— 分组管理
  入口迁到**装备栏**头部（部位设置旁边），分组与部位本就是同一条装备链路。
- **物品栏下线「宫格视图」**（用户要求）：布局切换按钮与 `is-grid` 样式删除，
  只保留列表形态；`prefs.inventoryView` 字段保留（compat），不再被读取。
- **物品行内 icon 加大加明显**：物品行的 `tiny` 图标按钮（稀有度点 / 数量
  步进 / ⋯）在物品栏局部放大一号（20→22px，数量步进 24px / 15px 字形 / 700
  字重），−/ + 提到主文字色；「装备 / 已穿戴」加弱描边，从一行小字变成一眼
  可点的按钮。全面板密度的 `.cpk-iconbtn.tiny` 本体不动（十几处使用点）。
- **编辑器顶栏「行囊 / 小说设定」换用设计侧定制图标**（`pack.svg` /
  `book-setting.svg`，新增 `shared/components/SvgIcon` 内联渲染 `?raw` SVG，
  `fill="currentColor"` 跟随文字色）；行囊头部「量纲」图标换 `dimension.svg`；
  物品栏「分类管理」图标换 `category.svg`。

### Fixed

- **行囊头部缺「小境界」展示**：头部此前只显示「合体 2/4」，与境界模块的
  「合体 2/4 · 中期」不同口径（同源数据两处读数不一致）。头部现在并排显示
  当前小层别名 chip（`subLabelAt` 同源，空别名不渲染）。
- **行囊「境界」的设置图标改为 hover 提示**：齿轮（点击弹 toast）换成问号
  （antd Tooltip 悬停即读，不用点）。

## [1.40.0] - 2026-10-14

### Added

- **行囊物品分类管理**（`novel_pack_categories` 表 + `InventoryModule` /
  新组件 `CategoryManager`）。物品栏头部新增「分类管理」入口：创建 / 行内改名 /
  删除分类（删除前确认并报受影响物品数，物品退回「未分类」）；首次使用自动
  播种默认五类（装备 / 丹药 / 材料 / 消耗品 / 杂物）。分类支持**绑定
  小说设定的等级体系**：绑定后，该分类下的新增物品在「更多」菜单里多出
  「品阶」一项，可把物品标注成该体系的某一阶（如 小刀·神器、鞭子·仙器）。
  未绑定体系的分类给引导文案，书里一个体系都没有时引导去「设定中心」创建。
  `item.category` 仍按名字关联（零迁移）：改名由前端传播到同分类物品行、
  撞名拒绝。守卫：`pack-grade-guards.test.ts`（建表 / 索引 / 增量迁移 /
  `PACK_CHILD_TABLES` 登记 / 保存事务落库）+ `CategoryManager/index.test.tsx`
  四例 + `pack-dirty.test.ts` 分类计数三例。
- **物品 / 技能的体系品阶标注（1.40.0 核心）**。物品与技能的名称旁新增品阶
  chip（`cpk-inv__grade` / `cpk-skl__grade`）：未标注时显示「品阶」灰态占位
  入口，标注后显示品阶名。品阶选项来自**设定域根阶**（`novel_setting_levels`
  中 `parent_id` 为空的阶，`readGradeSystems` 投影 `{id, name, levels}`）；
  技能没有分类维度，品阶菜单直接按体系分组（`type: "group"`）挑选，另附
  「清除品阶」。等级名不落行囊库（单一事实源在设定域）：`grade_id` 只存
  `novel_setting_levels.id`，改名实时跟随；查不到的 id 不渲染 chip（不出现
  裸 id）。导出与快速复制同步携带品阶：`小刀 ×1（装备 · 神器）`、
  `听潮步（功法品阶 · 天阶）`。守卫：`SkillsModule/index.test.tsx` 品阶四例 +
  `pack-utils.test.ts` 导出三例。
- **行囊「境界」模块的阶 chip 显示小层级名称**。此前只有「拆出子层级」的阶
  有 `subLabels`；配置了**固定名单**模板（如「初期,中期,后期,圆满」）但未
  拆分时，只显示「1/4」不带名。现在未拆分时按名单模板取名（`{n}` 编号模板
  不算名字，不生成 chip）——「筑基 · 初期 1/4」如期出现。
- **小说设定模板库新增热门体系预设**（`utils/setting-presets.ts`）：法宝品阶
  （凡器→神器）、功法品阶（黄阶→圣阶）、丹药品阶（一品→九品），与行囊物品 /
  技能的品阶标注配套。

### Fixed

- **导出整本小说时每章第一段不缩进**（`novel-utils.ts`
  `normalizeParagraphIndent`）。编辑器的段首缩进是 CSS `text-indent`（不落
  文本），作者手工补的空格又往往第二段起才有 → 导出文本首段顶格。现在导出
  时对每个非空行「剥掉既有行首空白 → 统一补全角两格」，幂等（跑多少遍都是
  同一份文本），跟随设置里的「首行缩进」开关。守卫：`novel-export.test.ts`
  缩进四例。

## [1.39.1] - 2026-10-14

### Fixed

- **设定中心「应用内置预设」只建出分类壳、等级序列永远是空的**（`hooks/useNovelData.ts`
  新增 `createSettingCategoryWithLevels` / `NovelPage.tsx`）。此前预设应用是
  `createSettingCategory` + `batchAddSettingLevels` 两连调：后者从当前闭包的
  bundle 里 find 刚建好的分类，而 `setBundle` 是异步的，同一次点击里它还不在
  里面 → find 失败、静默返回 0。现在分类与等级在**同一次**状态更新里落地，
  远端也是 category-add 后对新分类一次 batch（守卫：`useNovelData.setting-preset.test.tsx`
  四例，钉「分类+等级同帧出现」「远端两条挂同一 id」「realm 降级回执修正」
  「空名单不发 batch」）。顺带把预设的分类级字段（说明 / 每阶小层数 / 进位
  方向 / 小层命名）也带进落地分类——此前这些被整包丢弃，「练气十三层」的
  分类小层数一直是缺省的 1。
- **行囊「境界」模块的阶设置弹框右上角 × 关不掉**（`CharacterPack/RealmModule`）。
  antd Modal 的 × 与 ESC 走的都是 `onCancel`，此前漏传，弹框只剩 footer 的
  「关闭」能关。补上 `onCancel`（守卫：`RealmModule/index.test.tsx` 新增
  「× 能关掉弹框」回归例）。（1.39.1 追加：弹窗随后整体删除，见 Removed。）
- **行囊「境界」阶设置弹框在没有等级体系时是一张空表**（同文件）。书里还没
  建体系时 metas 列表为空，弹框只剩一句说明、看起来「没有实际作用」；现在
  直接给出「先到设定中心新建或从模板库应用一套」的指引（守卫：空态与有体系
  两例）。（1.39.1 追加：弹窗随后整体删除，见 Removed。）
- **行囊「备注速记 / 模块开关与排序」存不上**（`pack-dirty.ts`）。未保存计数的
  实体清单漏了 `character`（备注）与 `layouts`（模块启用 / 顺序 / 恢复默认）两类
  —— 这两类改动永远算不出脏数：保存按钮保持禁用（「没有未保存的改动」）、
  草稿防抖与关闭前的必写路径都按 dirty=0 早退，关掉窗口改动即丢，用户视角
  就是「行囊无法保存」。修复：两类实体纳入计数（身份键：character.id /
  moduleKey；`orderSignature` 改用 `spec.id`，否则 layouts 无 `id` 字段、排序
  变化永远算不出来）。刻意**不比** displayName / name / avatar（派生或即时
  落库）与 entityId（主角绑定即时落库），避免顶栏常亮按不掉的角标。
  守卫：`pack-dirty.test.ts` 新增备注 / 开关 / 排序 / 派生格四例。
- **右栏「设定」tab 下线**（`SupportPanel` / `useNovelViewState` / `useNovelPage` /
  `NovelPage.tsx`，删除 `SettingQuickPanel`）。它与「设定中心」功能重合：分类
  与阶梯的管理本就归设定中心，速查的插入 / 一致性检查又只有这一个入口在用。
  PanelTab 收窄为 outline / entity / note / search / tools 五个（会话级状态，
  无持久化迁移）；`setting-utils` 的正文一致性扫描（`scanConsistency` /
  `scanUnregistered` 及其辅助）随唯一消费方一并删除。
- **行囊「人物属性」两段合一，直接编辑当前角色的属性**（`AttributesModule`）。
  去掉「属性模型 · 全书共用 / 属性值 · 当前角色」两段与分组改名，改为一张
  每角色的属性行列表：名称 / 数值 / 单位 / 小数位一行编完（底层仍是 def +
  value 两份数据与原增删改 API，效果与映射的 defId 引用不变）。属性名称从此前
  的无边框样式改为**带边框输入框**——此前完全看不出名称能编辑（报障点）；
  新增属性即建即出现在列表里。存储结构零变更（compat 语义成立）。
- **行囊整文档保存对残缺字段不再整体回滚**（`novel-pack-handlers.ts`）。保存
  事务的逐行 INSERT 此前大量字段直绑渲染层值（属性名 / 单位 / 物品描述 / 效果
  备注 / 熟练度原始值……），better-sqlite3 对 undefined 绑定直接抛错 → 整事务
  回滚，用户侧只有一句「保存失败 · 草稿已保留」而无从排查（报障：套用属性
  模板后保存失败）。现在全部 SQL 绑定补 `??` 兜底（缺省值与建表 DEFAULT 一致），
  跨版本草稿里任何一个字段缺省都不再让整份文档存不进去。已用 node:sqlite
  内存库复现整条事务验证：规范数据保存成功、缺省字段落入默认值。
- **设定中心左栏点其它分类切不过去**（`SettingCenter`）。`focusCategoryId`
  （从角色卡「管理境界」进入 / 应用模板后传入）此前在选中解析里**永久优先**于
  用户点选，只要它还指向存在的分类，左栏点击永远不生效——应用模板境界后再
  手动新建分类必然踩中。现在 focus 只作初始选中（打开与变化时采纳一次），
  此后以用户点选为准；关闭时清空上一次选中，重开仍按外部聚焦定位。

### Removed

- **行囊「战力当量」下线**（`RealmModule`）。阶设置弹框的当量列、阶梯 chip 的
  当量提示与相关文案整体移除——「跨阶比较基准」的描述让人无法理解，且无任何
  消费方。`novel_setting_levels.power` 列与 DTO 字段保留（compat：不删列），
  仅不再提供写入口。
- **行囊「总属性汇总」的估算 / 临时加成下线**（`SummaryModule` / `usePackPanel` /
  `types.ts`）。REQ-037 的试算与真实汇总同管线同源，却总被当成「没保存的
  数据」，鸡肋大于价值；穿戴 Δ 预览（REQ-018）仍走 `computeHypotheticalSummary`
  不受影响。临时加成本就不落库，无数据清理。
- **行囊「阶设置」弹窗下线**（`RealmModule` / `usePackPanel` / `pack-service.ts`）。
  小层数 / 子层级的编辑统一收进「设定中心 → 等级序列」，行囊只读：齿轮点击
  改为 toast 指引（「境界层级在设定中心设置」），不再弹窗。`setRungMeta` 与
  `writeLevelMeta` 写入口随唯一消费方一并删除（设定域的 level-update 通道本身
  保留，SettingCenter 仍在用；守卫：`RealmModule/index.test.tsx` 钉「点齿轮只
  出指引、无弹窗」）。
- **行囊「技能分组」下线**（`SkillsModule` / `GroupManager` / `usePackPanel`）。
  技能行的「未分组」下拉与分组设置入口删除，熟练度体系恒用默认体系（组绑定
  `profSchemeId` 失去绑定方，编辑入口撤下）。物品分组不受影响；`skill.groupId`
  与 `profSchemeId` 字段保留（compat），旧数据不再参与判定。
- **效果参数概念下线：消耗 / 持续时间 / 剩余回合**（`EffectEditor` /
  `StatusModule` / `ModifierList`）。这些时效语义统一由作者写进效果备注；
  持续型的「默认开启」开关保留，`roundsLeft` 判定逻辑（isCounted / isExpired）
  与字段保留（compat），仅 UI 与写入口撤下——旧数据里已填的回合数继续生效。
  状态行 / 导出文本的「时效」与「持续 X」展示一并移除。
- **释放型效果的独立参数概念下线：效果量 / 单位（攻击力% 等）/ 目标 / 冷却**（
  `EffectEditor` / `types.ts` 的 `CAST_UNITS` / `CAST_TARGETS`）。释放型改为与
  被动 / 持续同一份加成表单（目标属性 + 运算 + 数值），性质说明仍写明
  「不计入总属性」；`valueUnit` / `cooldown` / `target` 字段保留（compat）。

### Changed

- **行囊所有导出统一为系统流小说的 txt 排版**（`pack-utils.ts` / `PackExportButton`）。
  Markdown 表格（`## 行囊 · X` + 竖线表）整体换成「【模块名】+ 一行一条冒号句」：
  `攻击力：150（基础 100，被动 +30，持续 +20）`、`回春丹 ×3（丹药 · 精良 · 丹药匣）`、
  `1 金 = 100 银 = 10,000 铜`——参考系统流 / 网游小说的面板写法，粘进正文不破坏
  叙事节奏。菜单项改为「复制面板文本 / 下载 .txt 文件 / 插入本章末尾」；
  `buildPackMarkdown` / `buildPackTable` / `toMarkdownTable` 更名重写为
  `buildPackText` / `buildPackLines`（守卫：`pack-utils.test.ts` 导出段全量重写）。
- **本书设定的等级序列只支持两个层级**（`SettingCenter` / `useNovelData`）。
  主等级下可挂一层子层级，子层级不再提供「新增子层级」入口（拆分函数同样加
  守卫）——三层嵌套（「初级·第1段·第1段」）在境界 chip 与层级表达上都没有
  意义。已存在的三层旧数据不受影响（只挡新增）。
- **分组名称支持直接输入，导出实时跟随**（`GroupManager`）。分组名从无边框样式
  改为带边框输入框（此前看不出能改名），说明里写明「物品下拉与导出文本用的是
  这里实时改的名字」（导出本就按 id 查现值，补了守卫用例）。
- **技能栏的「分组设置」按载体语境显示**（`GroupManager` / `usePackPanel` /
  `SkillsModule` / `InventoryModule`）。弹框新增 scope：技能栏打开时隐藏
  「可穿戴」开关（技能没有「穿」的概念，只制造困惑）并切换说明文案；三颗
  开关全部补可见标签（可穿戴 / 载体开关 / 整组）与悬浮说明——「整组」此前
  是一颗无标签的裸开关。
  （1.39.1 追加：技能分组随后整体下线，scope 机制随之拆除，见 Removed。）
- **行囊境界头部显示当前小层别名**（`novel-pack-handlers.ts` / `electron.d.ts` /
  `pack-utils.ts` / `RealmModule`）。拆出子层级的阶，「合体 1/4」旁现在跟一枚
  别名 chip（取子层级的首个别名，缺省回落段名）——「X n/m」只答了走到哪，
  别名才回答「现在是什么」；纯数字小层与未写别名不显示。主进程阶梯投影随
  `PackLevelRungDTO` 增补 `subLabels`（按阶内层号索引，子层段整段共享显示名），
  `LadderRung` 同步透传（守卫：`pack-utils.test.ts` 的 `subLabelAt` 三例、
  `RealmModule/index.test.tsx` 有别名 / 空别名 / 纯数字小层三例）。
- **左栏章节树拖拽排序改用 @dnd-kit**（`ChapterTree` / `ChapterTreeItem` /
  `VolumeNode`，撤下 `DRAG_MIME_*`）。HTML5 dataTransfer 换成 PointerSensor
  （distance 6，点击不误触）：拖拽内容浮为跟随光标的小卡片（DragOverlay），
  拖到列表边缘时自动滚屏；章 → 章（重排 / 跨卷）、章 → 卷头（移入卷末）、
  卷 → 卷头（重排）三条路径与原先一致。行只挂 dnd-kit listeners 不挂
  attributes——attributes 会给行容器塞 `role="button"`，与行内三个真按钮叠成
  嵌套交互语义；可达性仍由行内按钮承担（与 HTML5 时代同为指针拖拽）。
- **行囊模块壳折叠头换自绘涟漪**（`PackModuleShell`）。标题是占满整行的透明
  按钮，antd wave 环（6px currentcolor 描边 + 2s 淡出）罩上去就是「点了挂
  两秒的色框」（OutlinePanel 1.34.0「点击效果只有一半」的同构问题）：按钮上
  关掉 wave，改为从点击位置扩散的淡主色小涟漪（0.45s 收场、结束即卸载）。
  守卫：`PackModuleShell/index.test.tsx` 两例（点击出涟漪 + 动画后卸载）。

## [1.39.0] - 2026-10-13

> 行囊「负重 / 容量」（REQ-033 / F-5）整体下线，并按设计稿把头部横向带与
> 物品栏收敛到「无读数」形态。**旧数据不兼容** —— 三个字段直接删列，
> 旧的重量与上限数值不保留、不迁移（§6.7 `refactor` 口径）。

### Fixed

- **行囊「新书打开一屏全开」（`pack-config.ts` / `novel-template.ts` / `hooks/usePackPanel.ts`）**。
  新作品改为**只默认启用核心三块**（总属性汇总 / 人物属性 / 境界），其余七块以
  「存在但关闭」出厂 —— 模块管理弹窗里十条都在、顺序照旧，变的只是打开行囊先给
  一张干净的仪表盘。清单收口到 `CORE_PACK_MODULE_KEYS` 一份，四处默认源统一读它：
  `DEFAULT_LAYOUTS`（含「恢复默认」）、主进程 `novel-template.ts` 播种（不 import
  渲染层，靠 `novel-template.test.ts` 跨进程钉住一致）、`mergeLayouts` 与
  `setModuleOrder` 对**缺失行**的兜底（旧写法写死 `true`，等于「以后每加一个模块，
  所有老书都自动多开一块」—— 这是同一毛病换入口复发的根）。守卫：
  `pack-config.test.ts` 正/反面钉「启用集合恰好等于核心三块」与两处兜底读
  `isCorePackModule`；`pack-layout.test.ts` 的窄档核心集合同源。
- **行囊宽档初始版面「一角挤三卡、半窗留白」（`index.tsx` / `index.scss` / `pack-layout.ts`）**。
  上条收口后新书只开核心三块，而它们全属 stats 栏 —— 宽档仍按写死的
  `56fr / 44fr` 渲染两栏，左「装备类」一个模块都没有，只剩一个孤零零的栏眉标，
  右栏三张空态卡缩在右上角。修复：空分区**整个不渲染**（`activeZones` /
  `missingZoneOf` 抽在 `pack-layout.ts`，纯函数可测），唯一分区居中收窄
  （`--solo`，上限 720px）成单栏单重心；被关掉的对面栏补一张虚线引导卡
  （antd `Button type="dashed"`，列出该栏未启用的模块名），点按直达「模块管理」
  —— 作者才知道行囊还能开装备栏 / 技能栏 / 背包。双栏都有模块时版面照旧。
  守卫：`pack-layout.test.ts` 四例钉「新书出厂态只渲染 stats + 引导卡指向 gear」
  及装备类-only / 双栏 / 全空三个对称分支。
- **行囊宽档改为「左数值与状态 / 右装备类」（`pack-layout.ts` / `index.scss`）**。
  左上是视线起点，作者开行囊第一眼找的是属性汇总 / 人物属性 / 境界，此前它们被
  排在右栏（装备类占了左侧）。落位顺序收口到 `PACK_ZONE_ORDER` 一份，栏宽配比
  跟着内容走：装备类是「部位名 + 按钮 / 物品行 + 数量 + 按钮」的长行，反而更宽
  （44 : 56，原为左 56 : 右 44）。守卫新增「stats 在左、gear 在右」与
  「核心三块落在第一栏」两例，注释里钉死与样式层栏宽同序。
- **核心三块在仪表盘里钉顶（`pack-layout.ts` `coreFirstOrder` +
  `hooks/usePackPanel.ts`）**。存量书的布局顺序里核心三块（汇总 / 属性 / 境界）
  可能排在末尾（老版本播种 / 作者拖过），每新开一个模块它就插在核心三块上面，
  把主内容越顶越深。现在展示顺序统一走 `coreFirstOrder`：核心三块恒在最前
  （保持彼此的相对顺序），其余模块按作者排序跟在后面；宽档分区与窄/中档单栏流
  共用这一份。代价是仪表盘里核心三块拖不动（模块管理里拖了也不影响它们的
  落位），这是「钉顶」的题中之义。守卫三例：沉底输入钉回最前 / 两段相对顺序
  稳定 / 空输入。
- **行囊窗口弹窗右上角 × 点不动（`WindowHeader/index.scss`）**。
  `.window-header` 整条是 `-webkit-app-region: drag`，而 Windows 在**命中测试阶段**
  （`WM_NCHITTEST → HTCAPTION`）就把落在带内的像素判成标题栏 —— 收不到任何鼠标消息
  （没有 `:hover`，更没有 click），**且与 z-index / 绘制层级无关**，把浮层画在它
  「上面」照样点不动。antd 浮层一律 portal 到 `document.body`，落在 `.window-shell`
  里那两处 `no-drag` 声明之外；弹窗越高 × 越靠上，掉进 34px 拖动带后表现为
  「看得见、能拖窗口、点不出反应」（点遮罩与 Esc 不走指针，所以不露馅）。修复按
  「浮层自己的盒子」扣除拖动区：`.ant-modal-container` / `.ant-modal-render`（传
  `modalRender` 时才有）/ `.ant-dropdown` / `.ant-select-dropdown` /
  `.ant-picker-dropdown` / `.ant-popover` 各自 `no-drag`，拖动带其余部分照旧能拖窗口。
  守卫 `WindowHeader/drag-region.test.ts` 编译 SCSS 后断言豁免组 —— **新增浮层须一并补入**。
- **境界拆分口径收口：`findRealmPosition` 与实体卡高亮（`utils/setting-utils.ts`、
  `components/EntityDetail/`）**。1.38.1 起父阶是纯分组、绑定统一落 `(根阶, note.sub)`，
  但渲染层两处没跟上：① 实体卡**根阶行只在「没落在任何段上」时才高亮**，于是绑在
  「炼气 第1段」上会出现「段小条亮着、炼气那一行反而不亮」，看着像当前境界不在这一阶
  —— 改为绑定落点属于这一阶就高亮（段只是阶内进度，不是独立阶）；② 点没有子层级的阶
  时第二参漏传，`onSetEntityLevel(id)` 的实参个数与「note 里不写 `{sub}`」的约定对不上
  —— 改为显式传 `undefined`。`setting-utils.test.ts` 的 fixture 同步补上「第3段」
  （原 fixture 只有两段，`sub=3` 的折算根本无从命中），并把「未覆盖区间」用例从
  `sub=1`（第 1 段恰好覆盖 1–1，与「sub=2→第2段 / sub=3→第3段」自相矛盾）移到真正
  没被任何段覆盖的层号 5。
- **拆分守卫按新模型重写（`electron/novel-setting-guard.test.ts`）**。该守卫仍钉旧模型
  「第一段复用原 id、父阶自己占第一段」的 SQL，而数据层早已是「原阶降级为分组
  （`seg_from` / `seg_to` 置 NULL、`sub_levels` 落整阶总数）+ 各段新建并挂 `parent_id`」。
  改写后保留原意图（原阶 id 不变 → 绑在这一阶上的「当前境界」不会失效），并补反面断言
  禁止退回旧模型。
- **设定速查面板走组件库按钮（`components/SettingQuickPanel/`）**。三处原生 `<button>`
  （分组头 / 词条 chip / 打开设定中心）换成 antd `Button`，样式选择器补 `.ant-btn` 且
  `@include widget.ant-button-reset` 写在覆盖之前（拆成两个类会因打包顺序静默失效，
  §6.1.2 第 1、3 条）。顺带修两处：`components/SettingCenter/index.scss` 的
  `nv-sc__set-realm` 缺 `.ant-btn` 清零点；`components/NovelToast/index.scss` 引用了
  不存在的 `--app-danger`（真名 `--app-error`）。

### Removed

- **负重 / 容量：数据层三列删除（`electron/novel-db.ts`）**。建表语句不再写
  `novel_pack_characters.weight_limit` / `capacity_limit` 与 `novel_pack_items.weight`；
  增量迁移区新增幂等 `dropColumnIfExists()`（PRAGMA 探测列存在性后再
  `ALTER TABLE … DROP COLUMN`，并 try/catch 兜底），老库升级时三列**连同数值一起被丢弃**。
  ⚠️ **旧数据不兼容**：重建方式是「重新在物品栏记一遍重量与上限」——该功能已从产品中移除，
  故本次不提供任何回归通路。注意「部位容量」（`novel_pack_slots.capacity`，戒指能戴两枚）
  是**另一套东西**，完整保留。
- **负重 / 容量：DTO 与 handler 出入参（`electron/handlers/novel-pack-handlers.ts`、
  `src/shared/types/electron.d.ts`）**。`PackCharacterRow/Dto` 的
  `weight_limit` / `capacity_limit` / `weightLimit` / `capacityLimit`、`PackItemRow/Dto`
  的 `weight` 全部删除；快速记账桥的物品 INSERT 由 14 列降为 13 列、整文档保存的
  角色 UPSERT 由 11 列降为 9 列、物品 `itemStmt` 由 15 列降为 14 列。
- **负重 / 容量：领域层纯函数（`pack-utils.ts`）**。整段删除 `itemWeight` /
  `totalWeight` / `weightStatus` / `capacityStatus` / `normalizeLimit` / `formatWeight`
  及其类型；模块导出表 `inventoryTable()` 去掉「重量」列（8 列 → 7 列）。
  `roundTo` 保留（汇总管线仍在用）。
- **顶部概览带读数（`pack-layout.ts` + `components/PackHeader/`）**。
  删除 `headerReadings()` / `PackHeaderReadingsInput` / `formatNumber()`
  （`formatNumber` 仅被读数与自身测试使用，属随读数一起下线的死代码）。
  头部回到设计稿的两块布局：左「我是谁」、右「存了没有 + 工具」，
  中间的 `cpk-head__readings` 整块消失（含其 5 条样式规则与 `.cpk-head` 里
  「中读数区最先牺牲」那段优先级声明 —— 现在只剩左 / 右两块）。
- **物品栏的负重条、上限面板与单件重量（`components/InventoryModule/`）**。
  `cpk-inv__load` 读数条、「上限」设置面板（格数上限 / 负重上限两个 `InputNumber`）、
  详情行的单件重量录入与小计全部删除；连带 `OVERLOAD_STATUS_NAME` 常量、
  `overloadStatus` 判定、「记为状态」入口（它只在超载时出现，超载已无判据）。
  「更多」菜单的「描述 / 标签 / 重量」回退为「描述 / 标签」。SCSS 侧删掉
  `__load*` / `__limit*` / `__meta*` / `__weight` / `__subtotal` 共 9 组规则。
- **`setLoadLimits` / `load` 两个面板 API（`hooks/usePackPanel.ts`）**。
  连同 `addItem` 里的「满格拒绝」一起删除：不再有「背包已满，加不进去」这条分支，
  `addItem` 现在恒写入、不再返回 `null` 表达失败，依赖数组随之收窄。
- **相关测试**：`pack-utils.test.ts` 删「负重与容量」整组（6 例）、
  `pack-layout.test.ts` 删 `headerReadings`（6 例）与 `formatNumber`（4 例）、
  `PackHeader/index.test.tsx` 删「顶部概览带读数」整组（3 例）、
  `InventoryModule/index.test.tsx` 删「负重与容量」整组（5 例）；
  另有 7 个测试文件的夹具清掉 `weightLimit` / `capacityLimit` / `weight` 三字段。
  其中「状态表导出时效」用例语义与负重无关，移入新组 `导出表 —— 状态时效口径` 保留。

### Changed

- **`QTY_MAX` 的注释去掉对 F-5 的引用**（`pack-config.ts`）：它本来就只是
  「显示用的大数保护」，防止长按把数量推到溢出，与负重无实现耦合。

## [1.38.0] - 2026-10-13

> 跨窗口审查报告第二、三批修复：第二批（P2）堵四个健壮性缺口，第三批（P3）
> 做卫生与重构——删掉拆窗后失去调用方的进程内桥、收口双通道订阅与 toast
> 计时样板、补齐草稿 IPC reject 防护。无表结构变更，旧数据照常读取。

### Fixed

- **书架 ↔ 编辑器灵感不同步（P2-4）**：书架与编辑器是同窗口的两个常驻页面
  （display 切换显隐、都不卸载），书架侧增删改灵感后编辑器的内存快照不会
  自己变 —— 灵感面板显示旧内容，作者会基于旧笔记续写。新增共享事件模块
  `src/shared/novel/note-events.ts`：书架四个灵感写操作（新增 / 置顶 /
  归属迁移 / 删除）落库后广播 `novel-note-changed`，编辑器（useNovelData）
  订阅后就地 patch `bundle.notes`（新增插头部、更新整行替换、内容未变返回
  原引用），不触发整体重载。装载在途时补丁跳过（等装载响应带回库内真值，
  与 loadSeqRef 同一范式）。
- **空 workId 可打开行囊、主进程播种垃圾角色行（P2-5）**：编辑器零作品时
  `openPackWindow` 此前照样发 `pack-window-open`，主进程会播种 `work_id=''`
  的角色行（下次打开还复用它），且没有 UI 入口能删。三道守卫：渲染层
  `openPackWindow` 空作品直接 toast 提示；主进程 `pack-window-open` 对空
  workId 拒绝开窗（`novel-work-changed` 的空值广播语义不同，不受影响）；
  `ensurePackCharacterRow` 对空 workId 抛错拒绝播种。
- **书架装载失败被渲染成「书架还是空的」（P2-6）**：`useBookshelfData.load`
  此前不收 reject（异常冒成 unhandled error）且失败时 bundle 恒为 null，
  页面把失败当空态。新增 `loadError` 状态 + `&__error` 视图（与空态严格
  分离），带重试按钮；静默刷新失败时界面照旧不打扰。
- **登出用 destroy() 绕过行囊关闭守卫（P2-7）**：`auth-logout` 对行囊窗口
  直接 destroy，dirty>0 时未保存编辑连窗口一起销毁。改走 `close()`，让
  close-guard 三通道弹出「保存并关闭 / 放弃 / 取消」；用户选取消时窗口留在
  原地，登出流程照常继续（logoutUser 只清 authDb 用户行、不关 novel.db，
  「保存并关闭」仍能正常落库）。
- **行囊草稿 IPC reject 未收（P3-6）**：`usePackData.flushDraft` 与面板
  `requestGuard` 对主进程异常无防护 —— cleanup 里的 `void flushDraft()` 会
  变 unhandled rejection，await 方会卡死裁决链。就地 try/catch（仿
  `persistChapterNow` 先例），失败置 `saveFailed` 交 UI 提示重试。

### Changed

- **删除拆窗后无调用方的进程内桥（P3-1）**：行囊拆成独立窗口后，pack-config
  的关闭桥（registerPackCloser / requestClosePackPanel）与闸门桥
  （registerPackGuard / guardPackBeforeAction）再无生产调用方 —— 面板内已改
  用主进程 close-guard 三通道（onCloseRequest / respondCloseRequest +
  setCloseGuardEnabled），整对删除，`PackGuardReason` 类型保留；
  `registerPackInsertIntoChapter` 本地桥同删，`runPackInsertIntoChapter`
  恒走跨窗口广播。相关守卫测试翻成「不得复活」的反向断言。快速记账的
  「同进程回退」路径**刻意保留**并补注释（未来面板重新挂回同窗时直接生效）。
- **双通道订阅样板收口（P3-2）**：新增 `src/shared/novel/dual-channel.ts`
  （纯函数、不含 React），CustomEvent + broadcast 双注册 / 注销样板在
  8 个订阅点（useNovelData ×3 / usePackPanel ×3 / usePackData /
  usePackProtagonist）统一改走 `subscribeDualChannel`；负载归一化与 origin
  去重仍归各事件的 handler。后续加事件只接一处，不再出现「忘了接双通道」。
- **toast 自动消失收口（P3-3）**：新增 `src/shared/novel/use-auto-toast.ts`，
  NovelPage（2.4s）与行囊面板（2.6s）两份计时样板合一；tone 集合并成
  `success | info | warning | error`（取两处并集），NovelToast 补 error 图标
  与样式。类型经各 hook 原名 re-export，展示组件 import 路径不变。
- **注释卫生（P3-5）**：useNovelData 主角名同步的上下两段重复 JSDoc 删一份；
  useNovelShortcuts 的 Esc 链注释更新为拆窗后现状（设定中心 → 排版设置 →
  快照 → 专注模式）。

## [1.37.1] - 2026-10-12

> 修「设了练气九层，阶梯里却只有光秃秃『练气』一行」与「『在末尾插入』点了
> 没反应」两个设定中心的可见缺陷。无表结构变更，旧数据照常读取。

### Fixed

- **小境界此前完全不可见**：`subLevels`（每阶小层数）一直只是「进位示例」
  文案里的一个数字，等级序列里每个阶永远只占一行 —— 作者设了练气九层，
  界面上看不到「一层、二层」到底存不存在，看起来就像小境界被平铺丢了。
  现在每一阶下**平铺出真实的小境界清单**（按本阶生效的命名模板渲染，
  点一下复制「练气 第2层」），并把「共 N 小境界」计入底部状态条。
  与「拆分」互补：拆分是把一阶变成多行阶（写库、改层级结构），
  这里是只读速览（不写库、不动阶梯）。
- **「在末尾插入」点了没反应**：末尾插入条此前只渲染按钮、没有输入框分支
  （`insertAt === index` 的判断只存在于每个等级行上方的插入条里，末尾这条
  不落在任何行上），点它只是把状态设成行数、没有任何组件渲染输入框。
  已补上输入框分支，回车即插入。
- **落点按行序算，不再用 `max(rank)` 当行数**：删过 / 拆过 / 裁剪过历史的
  分类里 rank 会有空洞（如 1、2、5，行数却是 3），旧实现拿 `长度 + 1 = 4`
  当落点，会把新行**插到金丹之前**；rank 倒序残留时更会插到行首。
  主进程改用 `COUNT(*)` 取行数、末尾落点取 `max(rank) + 1`，
  渲染层 `insertLevel` 与主进程同一坐标系。本地 `insertLevel` 顺带压实
  rank 空洞，插入后的序列恒为连续序号。

### Changed

- **新增等级项继承分类的小层数与命名**：主进程此前把 `sub_levels` 硬编码
  写死为 1，新阶在「练气九层」这类体系里会缺小境界；现与渲染层乐观更新
  同一口径，取分类的 `sub_levels` / `sub_pattern`。

## [1.37.0] - 2026-10-12

> 等级 / 境界模块二次改造：拆分支持批量与自定义命名，小层命名下放到每一阶，
> 模板库补内置文体预设。数据结构在 `novel_setting_levels` 上**增量加列**，
> 旧数据（列缺省为空 = 沿用分类模板）全部平滑保留，无破坏性变更。

### Added

- **批量生成等级**：等级序列头新增「批量生成」，两种模式——
  **逐行输入**（每行一个名称，空行过滤、行内去重）与**模板生成**
  （数量 1–99 + 命名模板）。模板与拆分共用同一套语义：
  `{n}` 占位、固定名单（`初期,中期,后期,圆满`，顿号/中英文逗号都认）、
  纯文本自动补序号；弹窗内实时预览。新通道
  `novel-setting-level-batch-add` 单事务落库（单批上限 99 条，脏数据整批回滚）。
- **拆分弹窗化**：拆分从固定「2/3/4 段」子菜单升级为弹窗——段数自由输入
  （2–30，默认按本阶小层数建议）+ **段名模板**（`{name}` 原名 / `{n}` 段号 /
  固定名单，如把练气 12 层一次拆成 初期/中期/后期/圆满）+ 分段预览。
  第一段仍复用原 id（角色的「当前境界」绑定不失效）。
- **逐级小层命名**：`novel_setting_levels` 新增 `sub_pattern` 列（增量迁移，
  PRAGMA 探测后 `ALTER TABLE`，幂等）。行内编辑新增「小层命名」字段，
  留空沿用分类模板——同一分类下不同境界可各自定义小层结构
  （练气 9 层「第{n}层」、筑基 4 层「初期,中期,后期,圆满」互不干扰）。
  等级行上有徽标提示本阶生效的小层命名。
- **内置预设模板**：模板库新增「内置预设」分组，一键灌入、灌完随便改——
  修仙·经典九层（练气 9 层 + 筑基至大乘各分初期/中期/后期/圆满）、
  修仙·练气十三层、玄幻·灵武八境（各分初期/中期/圆满）、
  都市·异能评级（F→SSS 倒序）、洪荒·仙道品位（人仙→圣人）。
  预设是前端常量而非模板表数据，「删除模板」不会误删；
  kind='realm' 的预设遇已有境界体系自动降级为普通分类。
- **导入导出/模板快照带上逐级命名**：`subPattern` 随分类快照与书籍模板
  一起搬运；旧版快照缺省按空串处理（继续沿用分类），向前兼容。

### Changed

- **拆分落库口径对齐**：主进程拆分时把每段的 `sub_levels` 落成段长
  （此前固定写 1，与渲染层乐观更新不一致——重载后行囊境界换算会把每段
  当 1 层算错）；派生段继承本阶 `sub_pattern`。
- 进位示例按**每阶自己**的小层数与命名模板演示满层进位
  （「练气 第1层 → 练气 第13层 →（满层进位）→ 筑基 初期」）。

## [1.36.0] - 2026-10-12

> 新增「小说设定」：一部作品的全部等级序列（境界体系 / 功法等级 / 丹药稀有度 /
> 法宝品阶…）收进同一处管理，写作时可速查、插入并校验正文用词是否前后一致。
>
> ⚠️ **破坏性变更（旧数据不兼容）**：R25 的三张等级体系表
> `novel_level_systems` / `novel_levels` / `novel_level_conversions` 已删除，
> 数据并入 `novel_setting_categories` / `novel_setting_levels`。**没有迁移脚本**，
> 旧版本建的等级体系在升级后不再可见（新建的分类从空开始）。这是 §6.7
> `refactor` 窗口期的既定口径：不写迁移、不写新旧兼容适配层。

### Added

- **设定中心（顶栏「设定」按钮 / `Ctrl+Shift+S`）**：左栏分类列表（可新增、
  改色、重命名、删除、拖拽排序），右栏分类头 + 进位规则条 + 等级序列表。
  分类按 `work_id` 隔离到单本小说，互不共享。

  - **进位规则**：`sub_levels`（每阶小层数）+ `carry_dir`（由低到高 / 由高到低，
    倒序承载「九品 → 一品」）+ `sub_pattern`（小层命名模板，`{n}` 为层号）。
    规则条实时给出「引气 第1层 → 引气 第9层 →（满层进位）→ 筑基 第1层」示例。
  - **等级序列**：拖柄拖拽调序（落点显示插入线）、行间悬停插入新等级、
    行尾「⋯」收口编辑 / 拆分 / 合并 / 删除。别名与说明一并可编辑。
  - **拆分层级**：按小层分界把一阶切成多段（如「金丹 · 第1段 / 第2段」）。
    第一段**复用原 id 与原名** —— 绑在这一阶上的角色「当前境界」因此不失效；
    合并是它的逆操作，且会把小层总数还原（不还原会让境界换算永久算错）。
  - **导入导出与模板**：分类可导出为 JSON（再导入）或 Markdown 设定集（人读）；
    可另存为模板、从模板库套用到本书。
- **写作态设定速查（右栏 Tab「设定」）**：按分类给等级 chips，点一下插到
  编辑器光标处；底部「一致性检查」报两类问题 —— **用词不符**（正文「金丹期」
  vs 设定「金丹」，可一键替换）与 **未登记词**（形似等级但设定里没有，可一键
  登记）。替换走编辑器命令式 `replaceAll`（CodeMirror dispatch），与打字同一
  链路、能 `Ctrl+Z` 撤销。
- **领域纯函数 `utils/setting-utils.ts`**：进位示例、插入 / 删除 / 移动的 rank
  重排、拆分 / 合并的层段计算、一致性扫描。拖拽很难测，纯函数很容易测 ——
  25 项单测钉住 rank 连续性与拆分合并的可逆性。

### Changed

- **境界体系降级为一个设定分类**：它不再是独立实体，而是 `kind='realm'` 的那
  一个分类（全书唯一，主进程对第二个 realm 请求会降级为 custom）。角色卡
  「当前境界」与行囊境界换算仍绑在同一份等级 id 上，语义不变。
- **角色卡「当前境界」区块**：去掉「选哪个体系」的下拉（境界体系唯一了），
  阶梯按进位方向展示；空态文案改为「还没有境界体系」+「新建境界体系」。
- **快捷键 `Ctrl+Shift+S`** 打开设定中心；判定必须排在裸 `Ctrl+S` 之前，
  否则会被保存吃掉。`Esc` 关闭层级把设定中心放在最上。

### Removed

- **删除「等级体系管理」弹框 `LevelSystemManager`**：其入口（角色卡「管理」/
  「新建等级体系」）改为打开设定中心并定位到境界体系分类。
- **删除等级体系三张表与对应 IPC**（`novel-level-system-add` 等 7 条通道、
  `novel-level-meta-set`），改由 `novel-setting-*` 通道承担。

## [1.35.0] - 2026-10-12

> 行囊新增「属性映射」：把一条属性的加点按固定系数折算成另一条属性
> （「每 1 点力量 → 生命 +100」）。数值口径上它和被动 / 持续加成同池，
> 但**输入是源属性的最终值**，所以汇总管线从一趟拆成两趟；成环时整组不生效
> 并在界面如实标明原因，而不是给出一个随书写顺序变化的数。

### Added

- **属性映射（成长换算）**：新模块「属性映射」，一行一条「源属性 → 目标属性
  每 1 点 +N」。纯函数层 `pack-mapping.ts`（`evaluateMappings`）负责求值，
  面板只渲染结果。

  - **源取最终值**：`computeSummary` 退掉原来的单趟写法，先把所有效果词条
    累加得到「不含映射的最终值」（新增 `SummaryRow.preMapping` 留痕），
    再按**依赖顺序**叠加映射。这样「穿上 +20 力量的剑」会连带抬高生命，
    而不是先算的映射读到基础值、后算的读到含加成的值。
  - **折算量并入加算池**：`final = (base + Σ被动 + Σ持续 + Σ映射) × (1 + Σ%) × Π乘`。
    与被动 / 持续是同一个运算池，只在展示层分段 —— 汇总行多一段「映射加算」
    （紫），来源明细多一类「映」标记的来源行，导出汇总表多一列「映射加算」。
  - **覆盖仍然优先，且覆盖值「钉死」**：属性被 `覆盖` 型效果命中时，映射进来
    的量照算、照记账（列表上要能看见「这条算出了多少」），但不改写它的值，
    也不顺着它流向下游 —— 否则「生命覆盖为 9999」+「生命→战力」会算成
    9999 再加一遍映射量，与面板上写着的 9999 对不上。
  - **成环不猜**：`力量→生命` 与 `生命→力量` 同时存在时没有唯一解。Kahn
    拓扑排序排不到的（环 + 环的下游）整组不生效，属性保持不含映射的值，
    并用**出度剥离**把两种情形分成「循环引用」与「被循环挡住」分别上报 ——
    标着「循环引用」的人会去那条 `d→c` 里找环（那里没有），标着「被挡住」
    才知道要去查上游。
  - **系数为 0 即停用**：不设 `enabled` 列。两种「关」（开关 + 系数 0）会让
    未保存计数与「与本章初对比」都说不清哪个才是作者的意思；摘要也只数
    非 0 的条数，有停用的才写成 `生效 / 总数`。
  - **删除属性连带清换算**：`removeAttribute` 会清掉两端引用该属性的映射
    （只判加成的话，一个纯换算属性会被静默删掉、连带清掉别处的折算量）。
    删除确认框逐类说明条数，并提示「想停用就把系数改成 0」。

- **数据层**：新表 `novel_pack_mappings`（`idx_pack_mapping_char` 索引）
  + `PackMappingDto` / `PackSavePayloadDto.mappings`；随草稿保存
  （`PackDoc.mappings`）、随盘点记录落库、随模板书种下四条示例
  （含一条 `根骨→气血` 链式与一条 `剑意→气血 ×0` 停用示例）。
  级联清单 `PACK_CHILD_TABLES` 同步登记 —— 它被「删作品」与「重置模板清库」
  两处共用，漏一张表就永远删不掉。

- **未保存计数 / 与本章初对比**：`countNetChanges` 的实体清单加入 mappings
  （带 `updatedAt`，走 `stripTouch`）；「与本章初对比」新增「属性映射」组，
  排在「属性」之后（属性那行的变化常常正是它解释的）。老记录**没有这一格**
  时整组跳过 —— 当成空数组会把当时的全貌报成「本章新增了 N 条换算」，
  纯粹是把「当时没这个功能」渲染成「当时一条都没有」。数值后果仍由属性组
  如实呈现，只是老记录没法告诉我们「为什么涨」。

### 守卫

- `pack-mapping.test.ts`（27 例）：链式 / 逆序书写 / `attrOrder` 变化不影响
  结果、二元与三元环、环的下游与被环挡住要分开报、环外映射不被牵连、
  `rate = 0` 视同关闭且不报 problem。
- `pack-utils.test.ts`：映射计入加算池（百分比对它生效）、源取最终值、
  override 优先且冻结下游、成环上报、换装预览顺带抬高生命、省略 `mappings`
  时行为不变。
- `SummaryModule/index.test.tsx`：映射折算量单独成 `.cpk-seg.is-mapped`，
  且源确实用的是含装备加成的最终值。
- `ModuleManager/index.test.tsx`：拖拽用例里的位置改为**从模块清单现算**，
  不再写字面量 —— 模块清单每加一项，写死的索引都会静默错位，而这条断言
  恰恰是在验「插入 vs 交换」。

## [1.34.1] - 2026-10-11

> 按 AGENTS.md 做的一次全仓代码走查：修掉 1 个会持续打断写作的错误行为、
> 3 处会导致界面与数据对不上的竞态、2 处会留下不一致数据的事务缺失，
> 并把几条热路径上的无谓开销（每敲一个字的全文档扫描、每次渲染的近万条过滤、
> 每次打开书架的全表正文跨进程）降下来。

### Fixed

- **自动保存后正文跳回第一行**（写作期间持续打断）：`EditorPane` 换章滚动复位的
  effect 依赖的是 `chapter` **对象引用**，而防抖保存（800ms）会 `setBundle` 出一个
  新的 chapter 对象（content / wordCount / updatedAt 变了）—— 引用必变、章节没换，
  于是每保存一次就走一遍「没有恢复点 → `scrollTop = 0」`分支。改为依赖
  `chapterId`：换章才触发，保存正文不触发。守卫
  `scroll-reset-guard.test.ts` 同步改为钉「依赖必须是 id，不许是 chapter 对象」。

- **日历快速连点 / 连续翻月后活动与日期对不上**：`useDailyPage.refreshData`
  没有请求序号，先发的不一定先回，旧响应会盖掉新数据（要刷新窗口才恢复）。
  加 `reqSeqRef` + `aliveRef` 双守卫；顺带把弹窗表单的两处 `setTimeout`
  收进可清理的 `scheduleFormFill`（切走路由后不再碰已卸载组件的 form）。

- **记账连续切周期后流水与周期条错位**：`useLedgerData.load` 同样无序号守卫，
  「本年」区间返回最慢却常常最后到达，把一整年流水写进「本月」视图，
  环比基准也跟着错。加序号守卫，并补 `catch`（失败不再静默保留旧数据 + 转圈不停）。

- **换邮箱查询时月度产出显示上一个邮箱的数据**：`useCodePage.loadMonthOutput`
  加请求序号；`useTodoData.loadItems` 同样加序号（十几个写操作都以
  `void loadItems()` 收尾，并发时中间态会盖回界面，表现为勾选偶发回弹）。

- **Todo 父子勾选可能留下对不上的数据**：`handleToggleChildLogic` /
  `handleToggleParentLogic` 原先连发 2~3 条裸 SQL 无事务，中途失败会留下
  「父项已完成而子项没有」。整段包进 `db.transaction`，并把「兄弟项是否全完成」
  从「捞回全部兄弟行 + JS `every`」改成 SQL 里一次 `COUNT/SUM`。
  `ledger-category-delete` 的「流水重指派 + 删分类」同样补事务（该表无外键约束，
  两步之间失败会留下指向已删分类的悬空 id）。

- **收藏夹每次收藏发两次 IPC**：`addNameFavorite` / `removeNameFavorite` 把
  `saveNameFavorites` 写在了 setState 的 **updater 里** —— updater 必须是纯函数，
  而 NovelWindow 启用了 StrictMode，开发态双调用即双写。落库移到以
  `nameFavorites` 为唯一触发的 effect，并用 `favoritesSavedRef` 跳过「刚从库里
  读出来、与库内一致」那一次。

### Changed

- **字数统计不再逐字符跑正则**：`countWords` 的含标点口径原先是
  `for (const ch of text) if (!/\s/.test(ch))`，3 万字章节就是 3 万次正则调用，
  而打字链路每键要跑 2~3 遍（新值 + 旧值 + 状态条）。改为一次原生
  `/\S/gu` pass（`u` 标志保证按码点计数，与原语义一致）；
  `useNovelEditorStore` 再加一层单槽缓存 —— 连续输入时「上一次的 next 就是
  这一次的 previous」，命中率接近 100%。

- **书架不再把全书正文拉过 IPC**：`novel-editor-load` 原先无条件
  `SELECT * FROM novel_chapters`，而书架只算章节数 / 字数 / 状态，从不读正文。
  新增可选入参 `includeContent`（默认 true，编辑器行为不变），书架显式传
  `false` 时 SQL 不取 content 列。2000 章 × 3000 字场景下少跑约 12MB 字符串的
  structured-clone。

- **打开书架不再全表扫快照**：崩溃恢复的「找最新一条与正文不一致的快照」
  原先没有时间下界，SQLite 要对整张 `novel_snapshots` 逐行读出 content 做整串
  比较（每章保留 20 版，2000 章就是 4 万条 × 3000 字），而它挂在装载通道上。
  加 7 天时间窗 + 索引 `idx_novel_snapshots_created`（从最新往回扫，命中即停）。
  `novel-usage-today` 的连续码字天数同样补 400 天时间下界
  （`LIMIT` 在 `DISTINCT` 之后才生效，没有下界就要扫完只增不减的历史表）。

- **CodePage 输入邮箱不再卡**：`Statistic` 的 Tooltip 文案原先是写在 JSX 里的
  IIFE，**每次渲染同步执行**近万条数据的过滤 + reduce，而敲邮箱每个字符都会
  触发重渲染。提为 `useCodePage` 的 `selectedRangeHint` memo，比较改用时间戳
  避免逐条构造 dayjs 实例。`trendMax` 从裸 `Math.max(...arr)`（无 memo，
  且元素超 6 万会抛栈溢出）改为 memo + `reduce`；趋势数组加 366 天上限，
  避免选到几年前时渲染几千个节点把页面拖死。

- **行囊装备栏 / Δ预览不再每敲一个字重算整条汇总管线**：`EquipDeltaPreview`
  的 `useMemo` 依赖整个 `api`（每次渲染都是新对象）导致缓存恒失效，改为只依赖
  用到的 `previewEquipDeltas`；`EquipmentModule` 把「每个部位全表 filter + sort」
  改为按部位预建 `Map` 索引 + 一个未装备候选池（12 部位 × 200 物品从约 4800 次
  遍历降到一次建表）；`modifiersOf` 改为按 (ownerType, ownerId) 预建索引并复用
  模块级空数组常量（原先每行调用都 filter + sort，且每次返回新引用，
  把下游 `ModifierList` 的 memo 判成恒失效）。

- **全局快捷键每次渲染都解绑重绑**：`useNovelShortcuts` 改为用 ref 持有最新
  回调、effect 依赖置空 —— 整条全局输入通道整个会话只绑一次（原先因上层传
  内联箭头，每次重渲染都要 `remove` + `add` 一遍 `window` 监听）。

- **主进程两处同步 IO 改异步**：`app://` 协议处理器的 `readFileSync`
  （冷启动时几十次 1~5MB 同步读盘堵主进程）与 `memo-list` / `memo-backup-export`
  的 N 次 `statSync` / `readFileSync` 循环改为 `fs.promises` + `Promise.all`。
  `novel-chapter-save` 取最近快照不再 `SELECT *`（高频路径只用到两个标量，
  长章每次白读 20KB+ 正文）；`novel-level-system-delete` 的逐等级项循环删除
  改为子查询集合删除。

- `MemoSidebar` 补 `memo`（父层已把 8 个回调全部 `useCallback` 化，但组件本身
  没包，等于白做），导出/导入菜单项提到模块作用域（原先每次渲染新建含 JSX 的
  数组，让 antd `Dropdown` 的 `menu.items` 身份每次都变）。日历格子 key 从
  数组下标改为日期字符串（翻月时格子整体换人而 key 不变，className 逐格 diff
  会闪一帧错位）。

## [1.34.0] - 2026-10-11

> 导入图书的四项增强：章节名不再带序号、序号规则按书独立、跳转正文时左栏跟着滚、
> 点正文高亮自动切回「要素」。

### Added

- **导入时自动剥离章节序号**：解析器新增 `stripChapterNumbering()`，
  「第1章 黑暗恐惧」→「黑暗恐惧」、「第003章 无缩进」→「无缩进」、
  「Chapter 12 The End」→「The End」，序号与章名之间的
  `：:·．.。、-—_*～~` 等分隔符一并剥掉。序号本就由左栏序号列派生展示，
  存两份是重复。只有序号、没有章名时剥成空串，由落库层按本书规则补
  「第N×」占位。
- **章节序号规则按书独立**（`src/shared/novel/work-numbering.ts` + config 的
  `novel_work_numbering` 键）：新增 `detectChapterNumbering()` 从导入书的
  标题样本里统计「章/回/节/集 × 阿拉伯/中文」的多数派，随导入写进**该书的**
  规则记录。设置里的「章节后缀 / 数字样式 / 卷后缀」从全局一份降级为
  「无记录作品的默认值」——某本书有记录就覆盖，换书不再串味。
  `saveWorkNumberingRule` 走读改写，写乙书不会抹掉甲书。
- **跳转正文时左栏滚动定位**：`ChapterTree` 盯 `activeChapterId`，
  变则 `scrollToIndex({ align: "center" })`。大纲、要素详情的「出场章节」、
  Ctrl+P 跳转全部收口 —— 逐个入口埋滚动调用必漏，盯状态才是收口。
  目标章被搜索词滤掉或所在卷折叠时（下标 -1）静默跳过。

### Fixed

- **大纲面板虚拟化后行宽不自适应**（横向滚动条 + 激活高亮框右侧被裁）：应用没有
  全局 box-sizing 重置，`.nv-outline__line` 是普通 div，`width: 100%` +
  `padding-inline-end: 34px` + 1px 描边在 content-box 下恰好宽出 **36px**。
  虚拟化后行挂在 Virtuoso 滚动容器里（`overflow-y: auto` 连带 `overflow-x: auto`），
  这 36px 直接变成横向滚动条 —— 而行内的 antd 按钮早已由 `ant-button-reset`
  的 border-box 兜住，唯独这个普通 div 漏了。修复：`__line` 显式
  `box-sizing: border-box`。Playwright 实测：修复前行宽 376/容器 340、
  `hasHScroll: true`；修复后 340/340、无滚动。
- **点正文高亮不切回「要素」tab**：右栏切到笔记 / 搜索 / 工具后再点正文里的
  高亮词，只开了面板和详情、没切 tab，详情渲染在看不见的地方，表现为
  「点了没反应」。`openEntityDetail` 现在一并 `selectPanelTab("entity")`，
  正文高亮与悬浮卡两条入口同时修好。
- **同一本书里「第N章」形式的章会互相吞掉**：相邻重复标题折叠原先拿
  **剥离序号后**的标题比较，多章都叫「第N章」（无章名）时剥完全是空串，
  第二个往后全被当成「相邻重复」丢弃。改为按**原始行**比较
  （`openChapter` 的 `dedupeKey` 参数）。
- **书架 Hero 在渲染期调 `Date.now()`**：`resolveHero` 的入参 `now` 提为
  state，由 `load()` 写入 —— 渲染期取时间违反 React 纯度规则
  （同一份输入在不同渲染间产出不同结果），且 Hero 的时间口径现在与数据同刻。

### Removed

- **打字机模式**：顶栏开关、光标行垂直居中 effect（keyup/click 监听 +
  `scrollIntoView`）、`nv-editor--typewriter` 的上下留白样式全部移除；
  PRD R8 收窄为「专注模式」。定位光标后的滚动由 CodeMirror 默认滚动行为承担，
  需要沉浸写作用 F11 专注模式。

### 守卫

- `work-numbering.test.ts`（新增 17 例）：解析损坏 JSON / 逐字段校验、
  读改写不抹它书、字段合并而非整体替换、传 null 删记录、IPC 失败降级、
  泛型叠加（含书架 Hero 的 `dailyGoal` 字段）、workId 为空的安全边界。
- `work-numbering-guard.test.ts`（新增 22 例）：跨四层钉住「按书独立」的收口点 ——
  存储层（config 键、不含 React）、导入层（剥序号、**折叠按原始行**、worker 透传、
  落库写记录、失败不阻塞）、编辑器层（基线与映射分开、按 activeWorkId 叠加、
  改序号只进本书且全局基线回退、updater 纯函数）、书架层（按书取样式、
  不在渲染期取时间）。
- `novel-import-parser.test.ts` +2 组 11 例：剥离序号各形态（阿拉伯 / 中文 /
  Chapter N / 各种分隔符 / 只有序号 / 不误伤「第一次相遇」）、规则检测
  （章回节集、多寡数派、样本不足返回 null）。原 9 条断言标题带序号的用例
  同步改为新契约。
- `import-service.test.ts` +7 例：规则写进本书记录、两本书各写各的互不覆盖、
  识别不出不写记录、空标题兜底走本书规则（`第1回` / `第一章`）、写失败不影响导入。
- `ChapterTree/index.test.tsx`（新增 5 例）：挂载带激活章即滚、激活章变化再滚、
  未变不重复滚（不抢用户手动滚动）、无激活章不滚、目标被搜索滤掉不滚不报错。
- `useNovelViewState.test.ts`（新增 4 例）：非要素 tab 下打开详情会切回、
  各个 tab 都覆盖、换要素仍在要素 tab、关闭详情不动 tab 与右栏开关。
- `novel-ui-kit.test.ts` +1 例：虚拟化行内 `width: 100%` 的普通元素必须显式
  `border-box`（钉住 OutlinePanel `__line`，防 box-sizing 回潮）。

## [1.33.2] - 2026-10-11

> 退出时序修复：「保存并退出」曾必然失败 —— 库先关了，行囊窗口才弹「未保存」。

### Fixed

- **托盘「退出」绕过了关闭守卫**：退出菜单在 `app.quit()` 之前就把 `isQuitting`
  置真，`before-quit` 的询问分支（`!isQuitting && hasArmedCloseGuard()`）被整体
  跳过 → 直接清理 + 关库。修复：交给 `before-quit` 统一裁决，托盘只负责发起。
- **清理阶段窗口还会「诈尸」弹未保存提示**：退出确认后窗口销毁期间，
  `attachCloseGuard` 的 `close` 处理器仍会 `preventDefault() + show()`，把行囊
  窗口弹回来问「未保存」—— 此时库已关，点「保存」必然报
  「尚未初始化 novel 数据」（其余窗口都关了、只有行囊弹出来，正是这个样子）。
  修复：新增 `standDownCloseGuards()`，`before-quit` 清理开始前先给所有窗口
  的守卫缴械 —— 退出是用户已拍板的决定，最后一次「保存机会」在询问分支给过。
- **`closeDb()` 时机从 `before-quit` 挪到 `will-quit`**：before-quit 阶段窗口
  还活着，销毁过程中渲染层的最后一次保存（防抖兜底 / 退出前 flush）仍可能
  到达；will-quit 时窗口已全部销毁，不再有「库已关却收到保存请求」的时间窗。
- **`novel-pack-save` / `novel-config-get|set` 在库未就绪时优雅拒绝**：原先
  `getDb()` 在 try 块外抛「尚未初始化 novel 数据」，渲染层拿到的是无法理解的
  异常；现在返回 `false` / `null`，走各自的失败分支（草稿仍在主进程表，不丢）。
- **`closeDb()` 幂等收紧**：什么都没关时不再广播 `onClosed`，避免监听者重复收到。

### 守卫

- **`pack-close-guard.test.ts` +1 组 6 例**：托盘退出不得提前置 `isQuitting`、
  before-quit 清理前必须缴械、`closeDb()` 只许在 will-quit、缴械后的守卫不得
  再拦 close、`closeDb` 幂等不发空广播、库未就绪时保存/配置读写优雅拒绝。

## [1.33.1] - 2026-10-11

> 两处行囊缺陷修复：一个让「阶内进位」**完全点不动**，一个让未保存计数**按按键次数涨**。

### Fixed

- **「阶内进位」按钮点击无效**：按钮只传了 `{ delta: 1 }`，漏掉 `carry: true`，
  而写入口按 `options.carry` 分支 —— 缺了就走 `clampRealm`，位置**原样返回**，
  却仍然标脏 + 弹「境界已更新」的 toast。表现为「点了没反应、还提示已更新」。
  - 修法：补上 `carry: true`；并让 `setRealm` 在计划里回带 `position`（进位后的
    唯一真相），`writeRealm` 不再自己算第二遍 —— 两份规则漂移正是这个 bug 的温床。
  - 已在最高阶最后一层时按钮**置灰**并提示原因：此前「到顶」与「坏了」长得一模一样，
    这正是本次报障的最初观感。
- **未保存计数按「按键次数」涨**：`updateAttribute` / `updateItem` / `updateSkill` /
  `updateSlot` 每次 `onChange` 都调一次 `mutate`，而计数是 `setDirty((n) => n + 1)`
  的自增计数器 —— 「破境丹」三个字算 3 处改动，改回原样仍显示改过 3 处。
  - 修法：计数改为**派生值**，由 `countNetChanges(上次保存态, 当前文档)` 重算，
    口径即用户要求的「新增 / 修改 / 删除 / 移动 的最终净变化」：
    同一字段连敲 10 个字算 1 处、改回原值算 0 处、一次拖动排序算 1 处（不是每行各 1）。
  - `updatedAt` 不参与比较（它是「碰过」的打点，不是内容变化）；主角绑定不参与
    （它即时落库，算进来会让顶栏常亮一个按不掉的角标）。
  - 新增发生时**不额外计一次「移动」**：增删本就会让顺序整体位移，那属于副产物。
  - 新增 `pack-dirty.ts`（纯函数）承接这套口径，与展示用的 `pack-diff.ts` 分开
    （后者比的是「汇总后的值」，服务的是「与本章初对比」那张表）。

### 守卫

- **`pack-dirty.test.ts` +15 例**：逐字输入只算 1 处、改回原值算 0 处、`updatedAt`
  不算改动、增删各 1 处、纯移动 1 处、跨 7 类实体都要计到、境界算 1 处、主角绑定不算、
  无基线时返回 0。
- **`RealmModule/index.test.tsx` +4 例**：点「阶内进位」必须带 `carry: true`、
  顶阶末层置灰并给出原因、非顶阶可按且 title 说明会进位、小层数 = 1 时不渲染小层区。
- **`pack-close-guard.test.ts` +2 组**：禁止回退成自增计数器（`setDirty((count) => …)`
  必须消失）、`updatedAt` 不得进比较、主角绑定不得进计数、增删时不得重复计移动。
- **`pack-realm.test.ts` +2 例**：`plan.position` 回带真实落点；漏传 carry 时位置
  原样返回（把根因钉成断言，防止再犯）。

## [1.33.0] - 2026-10-11

> 小说与行囊的存储**从 `checkin.db` 拆出为独立的 `novel.db`**（§6.7 `refactor` 窗口期，
> **旧数据不兼容**：见下方「旧数据如何重建」）。拆分过程中顺带把两个窗口 review 出来的
> 9 个漏洞一并修掉——其中 3 个是**会静默丢数据**或**让保存态永久卡死**的。
>
> ⚠️ **旧数据不兼容**：升级后 `checkin.db` 里残留的 `novel_*` / `novel_pack_*` /
> `usage_log` 表**不再被读取**，小说与行囊表现为「回到空书架」。
> **老数据如何重建**：用书架页的「导入」把此前导出的 `.txt` / `.docx` 原稿重新导入；
> 没有导出过的原稿请先**降级到 1.32.1 并在书架里导出**后再升级（1.32.1 仍能读旧库）。

### Changed

- **小说 + 行囊的存储独立为 `novel.db`**：新增 `electron/novel-db.ts`，24 张
  `novel_*` / `novel_pack_*` 表与 `novel_config` / `novel_usage_log` 全部迁到
  `user-data/{用户目录}/novel.db`，与 `checkin.db` 同级。
  - `electron/db.ts` 移除全部 novel 域建表（约 200 行 SQL）与 4 段 novel 增量迁移，
    `config` 表回归只服务 checkin 域。
  - 生命周期靠 `registerUserDbLifecycle()` 桥接：`switchUserDb` / `closeDb` 触发
    `onSwitched` / `onClosed`，novel 库跟着开关；`registerNovelDbBridge()` 在
    novel handler 注册**之前**调用（启动期顺序是 `switchUserDb → register`，
    注册时若已有当前用户会立即补开一次）。桥接是单向的（novel-db → db），避免循环 import。
  - 历史 `ALTER TABLE` 增量迁移一次性写进建表语句（`novel_levels.sub_levels/power`、
    `novel_pack_attributes.updated_at`、`novel_pack_items.weight`、
    `novel_pack_characters.weight_limit/capacity_limit`、`novel_pack_modifiers.rounds_left`），
    并补齐 9 个外键查询索引。
  - `novel_editor_session`（崩溃恢复标记）随小说库走：放在 checkin.db 会出现
    「换了用户库但标记还在」的错配。

### Fixed

- **删章 / 删作品 / 重置模板库后保存态永久卡在「保存失败」**：草稿的生命周期与库里的
  章节是两套账，章节删掉后指向它的在途防抖（800ms）仍会拿这个 `chapterId` 落库，
  而 `novel-chapter-save` 找不到章节会如实返回 `false` —— `saveState` 就此停在
  `failed`，30s 兜底每半分钟重试一次注定失败的请求，顶栏一直红着。
  - 新增 `dropChapterDraft` / `clearDrafts`，三条删除路径先撤草稿与在途防抖再删数据。
- **删作品 / 清库漏删 `novel_pack_presets`**：级联清单只有 8 张表，预设表留下孤儿数据；
  现在清库与删作品复用同一份 9 张表的清单，消除清单漂移。
- **`ensurePackCharacterRow` 并发建出两个主角**：面板装载与右侧「设为主角」两个入口
  首次并发触发时各插一行。改为 `transaction(...).immediate()` 并在事务内二次查询。
- **行囊脏计数在严格模式下翻倍**：`mutate` 的 `setDocState` updater 里调了 `setDirty`
  副作用，StrictMode 下 updater 跑两次 → 一次编辑计成两次。改为先算后写、手动推进 `docRef`。
- **行囊自动保存永不触发**：自动保存 effect 的依赖里放了 `usePackData` 每次渲染都新建的
  对象，等于只要有周期渲染就无限重建定时器。改为依赖标量 + `saveRef` 转发。
- **只开过行囊也会误报「上次未正常关闭」**：`novel-editor-load` 被书架与行囊
  （`fetchPackBindableEntities`）共用，而它会写 `novel_editor_session = running`；
   PackWindow 关闭时没人清标记 → 下次启动凭空弹恢复横幅。新增专用通道
  `novel-session-open`，只有真正进入编辑器才会调。
- **回滚 / 崩溃恢复后「今日新增字数」与库中统计对不上**：`applyExternalContent`
  此前只改草稿不计字数，而主进程是按 `wordCount - 库里旧字数` 记负 delta 的，
  状态条会一直错到下次重启。现在跟着回退。
- **冗余查询**：`readCharacterSnapshot` 对 `novel_pack_characters` 重复 `dbGet`、
  `readLevelSystems` 全表扫 `novel_levels`（改为 `WHERE system_id IN (...)`）。

### 守卫

- **新增 `electron/novel-db-split.test.ts`（9 例）**：断言 checkin.db 不再建任何 novel
  域表（含 `usage_log`）、novel.db 建齐 24 张表且路径独立同目录、生命周期回调存在、
  两个 novel handler 不得 `from "../db"` 且必须 `from "../novel-db"`、handler 不再
  `INSERT INTO config` / `usage_log`、`PACK_CHILD_TABLES` 覆盖 9 张表（含
  `novel_pack_presets`）。均为源码断言——better-sqlite3 的 native 按 Electron ABI
  编译，vitest 的 node 进程加载不了。
- **`useNovelEditorStore.test.ts` +4 例**：删章后草稿与在途防抖一起撤掉（防抖到点不再
  拿已删除 id 落库）、撤单章不影响他章、删作品清空全部草稿、回滚要回退今日字数。
- **`pack-close-guard.test.ts`**：`DB` 常量改指 `electron/novel-db.ts`；REQ-028 的断言
  改为按建表块分段截取（原写法全文件 `toContain` 会命中别的表）。

### 兼容

- §6.7 架构重构开关已由 `refactor` 改回 `compat`：novel 结构重设完成，此后 novel 域的
  表结构变更重新受 §6.5 增量迁移约束（`novel.db` 自己的建表函数里写 `ALTER`）。

## [1.32.1] - 2026-10-10

> 1.32.0 的性能重构漏了两处，这一版补齐并修掉一个由它引入的**可见性事故**。

### Fixed

- **出场章节列表整个不可见**（1.32.0 引入的回归）：上一版把出场列表换成 `Virtuoso` 时，容器只写了 `max-height: 240px` 而没有确定高度。Virtuoso 的行是**绝对定位**、不参与父级尺寸计算，容器高度由 `auto` 塌成 0 —— 列表仍在 DOM 里但渲染在一个 0 高盒子里，表现是「只剩『出场章节 1996』这个标题，下面的章条目全部消失、点不了也跳不了」。
  - 修法：容器高度按 `min(240, 行数 × 行高)` 内联给 `height`（几条出场时自适应收缩、不留空白；上千条时封顶 240 内部滚动），行高与样式里的行盒对齐。
  - 这一块此前**没有任何测试**（测试桩里 `appearances` 恒为 `[]`），所以 bug 一路发到用户手里 —— 本版补上 3 例守卫。
- **`VolumeNode` 卷头有重复的 `aria-expanded`**：1.32.0 加可访问名时没注意该属性已存在，JSX 重复属性被 `tsc -b` 拦下（而 `tsc --noEmit` 走的是根 tsconfig 的 `"files": []`，**什么都没检查**，所以当时没发现）。

### Changed

- **右栏大纲面板的章节视图虚拟化**（1.32.0 漏掉的一处）：原先直接 `volumeNodes.map` 渲染「卷 → 章」两层，三千章 = 3000 个 `<li>` 一次挂载，每行还带 4~5 个 antd 组件（整行 `Button` / 旗标 `Tooltip`+`Button` / 梗概 `Button` / 「＋伏笔」`Button`）—— 打开大纲面板就是几千次组件挂载。
  - 改为把树压平成一维行（卷头 / 章行 / 空卷提示 / 卷级表单）交给 `Virtuoso`，只挂可视区。行高不固定（展开的伏笔清单与内联表单会撑高），由 Virtuoso 实测自动校正。
  - 折叠语义随之从「CSS 隐藏 `.nv-outline__vol.is-fold` 下的列表」改为「压平时不产生章行」。20 例既有行为测试全部保留通过。
- **`SupportPanel` 的 `flatScroll` 增加 `outline`**：章节列表已自持滚动，若外层 `.nv-panel__scroll` 再留 `overflow-y: auto` 会形成双滚动条（滚轮落在内层虚拟列表时外层永远滚不到）。伏笔子视图（条数少、未虚拟化）因此改为自持滚动容器。

### 守卫

- **`novel-ui-kit.test.ts` 新增「虚拟化列表容器必须有确定高度」**：对每个用到 `Virtuoso` 的组件断言其样式给了**确定高度**（显式 `height`，或 `flex: 1` 配 `min-height: 0`），并禁止只写 `max-height`。这条守卫专门抓上面那个「不报错、不抛异常、元素还在但看不见」的事故类型 —— 已注入原写法验证会红。
- **`EntityDetail/index.test.tsx` +3 例**：容器高度自适应且封顶 240px、点出场条目跳转带真实 `chapterId`、无出场章时整块不渲染。
- **`OutlinePanel/index.test.tsx` +2 例**：折叠某卷只影响该卷的章行（其余卷不受影响）、卷级伏笔表单排在章行之后。
- 两个测试文件均按既有先例 `vi.mock("react-virtuoso")` 平铺渲染替身（jsdom 无真实布局，Virtuoso 视口高度为 0 不渲染任何行）。

## [1.32.0] - 2026-10-10

> 导入一本 3000 章的长篇后，小说窗口从「滚一下卡一下、切一章卡一下」变回可以正常书写。这一版没有加功能，全是把**在千章量级下退化成 O(n²) 的计算**拉回线性，并把「一次性同步处理全书」改成「分批让出主线程」。

### 症状与根因

导入 3000 章后依次出现五个卡顿点，实测后各自对应一处算法或装载策略问题：

| 症状 | 根因 |
|------|------|
| 划线正文卡顿 | 每个可见分片都重新 `[...terms].sort()`，再逐字符 `startsWith` 线性扫全词库 |
| 打开右侧边栏长时间冻结（约 9s） | 出场章数统计在**同步**首扫里跑完 3000 章 × 全词库，全程不让出主线程 |
| 切换章节卡顿 | 每次切章都重算整棵大纲树，且 `buildChapterGroups` 被重复调用 2–3 次 |
| 右侧大纲未虚拟化 | 章节树按「卷 → 章」嵌套渲染，3000 章 = 3000 个 `Button` + `Tooltip` + `Popconfirm` 全量挂载 |
| 要素的出场章节未作虚拟化 | 出场列表直接 `appearances.map`，同样全量挂载 |

### Changed

- **词条匹配改为首字分桶索引**（`novel-utils.ts`）：`findTermMatches` 原先每次调用都排序词库、再从每个字符起 `startsWith` 逐词比对；改为按首字建 `Map` 桶、桶内长词优先，并用 `WeakMap` 以词库数组作键缓存索引。命中结果与原实现**逐字节一致**（有回归测试钉住）。
  - 单章（3000 字 × 300 词条）：**3.16ms → 0.08ms**（约 39×）
  - 全书 3000 章：**19.59s → 0.42s**（约 47×）
- **标注层复用同一套匹配**（`novel-editor.ts`）：`AnnotationPlugin` 删掉自己的排序副本，改为对 `view.visibleRanges` 的每个分片调用 `findTermMatches` 并补上分片偏移；另加 `colorCache`（`WeakMap`）避免每个命中都重扫全部词条取色。
- **出场章数统计改分批空闲调度**（`useAppearanceStore`）：新增 `pending` 状态；待扫章数 ≤ `BATCH_THRESHOLD`（400）时同步完成，超过则每 `BATCH_SIZE`（200）章让出主线程（`requestIdleCallback`，退化到 `setTimeout(0)`）。`pending` 在 `syncAppearances` 里**立即置位**，侧栏先渲染出「统计中…」再回填数字。
  - 重复调用 / `resetAppearances` 会 `cancelPending`，旧批次的结果不会写回（有测试覆盖「重置后不泄漏旧结果」）
- **大纲与章节分组的派生只算一次**（`novel-utils.ts` / `useNovelData` / `useNovelPage`）：
  - `buildChapterGroups` 由「每卷 `filter` 一遍全部章节」改为按 `volumeId` 分桶（O(卷×章) → O(章+卷)）
  - 抽出 `buildChapterNumbersFromGroups(groups)`，调用方已有 groups 时不再重建
  - `buildOutlineTree` 首个参数改为接受 `NovelVolume[] | ChapterGroup[]`（结构化类型守卫区分），复用同一次分组；伏笔条目按卷预分桶，去掉每卷一次的 `entries.filter`
- **要素面板与出场列表虚拟化**（`EntityPanel` / `EntityDetail`）：`statsOf` 由遍历全部要素改为只统计过滤后可见的集合；出场章节列表改用 `Virtuoso`，从「3000 个 antd `Button` 全量挂载」降为只挂可视区。
- **章节树行组件轻量化**（`ChapterTreeItem` / `VolumeNode` / `ChapterTree`，AGENTS.md §6.1.2 新增例外）：行内控件由 antd `Button` / `Tooltip` / `Popconfirm` / `Input` 换成语义化 `<button>` / `<input>`，外观在各自的 `index.scss` 里用 `var(--app-*)` 全量声明。**删除确认浮层提升到列表容器**：全列表只渲染一个共享 `Popconfirm`，行只上报「章节 id + 锚点 DOM」，锚点用点击时的视口坐标做固定定位，行被虚拟滚动回收也不影响。

### 守卫

- **`novel-ui-kit.test.ts`** 新增 §6.1.2 例外的三条补偿性断言：
  - 例外组件里的原生控件必须自带可访问名（取**真开标签**为搜索域，花括号配平找到 `>`，而不是「向下看 N 行」——后者既会漏也会误放行）
  - 例外组件必须**自带完整造型**（`height` / `border` / `padding` 必须显式声明，不得靠组件库兜底），且不得残留指向组件库的死 `.ant-btn` 清零规则
  - 白名单**收得很紧**：条目必须精确到 `.../index.tsx`、必须真实存在、且不得顺带命中同目录兄弟文件
- 该文件的按钮清零点断言样本由 76 降至 71：`nv-chapter__del` / `__hit` / `__status`、`nv-volume__add` / `__head` 五个类换掉 antd `Button` 后，对应的 10 条清零点断言断的是**已不存在的死 CSS**，随重构一并移除，由上述三条新断言接管。
- **`novel-utils.test.ts`** 新增 3 例：未排序词库同样长词优先、首字不匹配不产生命中、空词条不污染索引。
- **`useAppearanceStore.test.ts`** 新增 5 例：`pending` 立即置位后完成、重复同步取消在途批次、重置不泄漏旧结果、小体量保持同步、分批后倒排索引可用。

## [1.31.0] - 2026-10-10

> 新用户打开小说窗口，看到的是**空书架**，而不是一本不知从哪冒出来的「未命名作品」。模板书没被删掉 —— 它退到了编辑器里的「重置为模板书籍」，只在用户明确点名时才出现。这一版删掉的是一条**装载路径上的隐式写库**：它平时不声不响，一旦判据失误就是整库清空。

### Removed

- **装载路径的自动播种（`novel-editor-load`）**：原先「works 为空且 config 里没有 `novel_seeded` → `seedTemplateBook()`」这条分支整条删除，连同它的 `SEEDED_KEY` 常量一起。移除有两个各自的理由：
  1. `seedTemplateBook` 是**清库重播种**（先 `DELETE` 全部 `novel_*` 行再写模板），把判据失误的代价从「多出一本书」放大到「用户灵感全局池 + 行囊草稿一起没了」；
  2. 判据依赖 config 键 `novel_seeded`，而**老版本升级上来的用户从来没有这个键** —— 他们删光自己作品的下一刻就会撞上一次清库，表现是「删掉的书全回来了，还多出一本模板书」。修法是给判据打补丁（例如升级时补写这个键），但一个「不确定存不存在」的判据天生不该承担写库授权，所以整条拿掉

### Changed

- **新用户默认空书架**：装载只读不写，`novel_works` 为空就是空。模板书的获取途径收敛到**唯一一条显式通道** —— 编辑器菜单里的「重置为模板书籍」（`novel-editor-reset-template`）
- **编辑器空态分两支**：`EditorPane` 新增 `emptyKind`（`no-work` / `no-chapter`，默认后者）。
  - `no-work`（整个书架没有作品）：文案「书架还是空的 · 新建一部作品开始写，或从 TXT／DOCX 导入整本书」，并给「新建作品」「导入书籍」两个动作。**旧文案「写下第一章」在这个态是错的** —— 没有作品时点了无处可落
  - `no-chapter`（有作品但未选中章节）：维持原样（「还没有选中章节 / 写下第一章」）
- **`WorkManageMenu` 暴露命令式句柄**（`forwardRef` + `useImperativeHandle`）：空态里的「新建作品」直接复用顶栏那个「新建作品」弹窗（同一个菜单项、同一套校验），而不是另造一个入口。`NovelTopBar` 透传 `menuRef`
- **删光最后一部作品停在空态**：`deleteWork` 清掉活动作品 / 章节 id 后重载，`works` 为空是**正常终态**（此前注释写着「主进程会重新播种」，与实现一起改了）

### 守卫

- `novel-seed-guard.test.ts`（重写，8 例）：把「绝不自动播种」钉在源码上（better-sqlite3 的 native 模块按 Electron ABI 编译，vitest 下加载不了，只能做源码断言，先例 `themes.test.ts`）。断言包括：`novel-editor-load` 可执行代码里不出现 `seedTemplateBook()`、`SEEDED_KEY` 常量与引用一并清除、装载体里没有「works 为空 → 播种」分支、移除原因（清库重播种 / 老版本升级）在注释里留痕（否则后来者会「顺手加回来」）、`seedTemplateBook()` 的**调用点**只允许出现在 `novel-editor-reset-template` 那一行（抓取时排除函数定义行与注释行）
- 灵感全局池的两条约束同文件保留：`DELETE FROM novel_notes` 必须带 `WHERE work_id <> ''`（否则清库会连 `work_id = ''` 的全局池一起抹掉）、不得残留裸的全表 `DELETE FROM novel_notes`
