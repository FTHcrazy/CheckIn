# Changelog

## [1.17.0] - 2026-09-23

### Added

- **小说架空地图编辑器（MapWindow，PRD novel-map RM1–RM13 全量落地）**：独立窗口
  `src/windows/MapWindow/`（默认 1120×720、即关即销、单实例唤起），由 WorkerWindow 工具箱
  「架空地图」经 `map-window-open` IPC 唤起；与编辑器互不 import，跨窗口联动靠 SQLite +
  主进程 `novel-map-updated` 广播（RM12 局部刷新）。
  - **程序化地形生成 RM8**：`map-terrain.ts` 纯函数（value-noise + 约束掩码，FNV hash
    `hashSeed` + mulberry32 PRNG），同 seed 同约束必出同图；支持三面环海/孤岛/西漠/北雪/
    中央湖/大河/荒芜等可多选约束模板，河流自高处最陡下降入海（到海距离 BFS 保证入海 + 支流树）。
  - **地形画笔 RM9**：9 类铺满型 + 3 类叠加型（悬崖/岛屿/瀑布）符号化编辑，圆/矩笔刷大小
    1/3/5，松手批量提交入 `terrain.cells` 并合并进撤销栈；贴章对象层 RM13（地点 8 + 地貌装饰
    8，Path2D 单一来源 SVG path，A/B/C 三风格，层级/编组/翻转/拖拽）。
  - **标注 CRUD + 绑定 RM3/RM4/RM5**：地点钉/区域框/自由标签/连线四类，要素类型取色；
    一键建卡绑定实体（`entityId`）、嵌套子图（`childMapId`）下钻面包屑；右侧属性面板内联编辑
    （不污染撤销栈的 live 更新 + 落库更新）。
  - **导出 PNG RM6**：`map-export.ts` 组装离屏 canvas（视图/整图、1×/2×/4×、地形/标注/图例
    开关），主进程 `novel-map-export-png` 经 `dialog.showSaveDialog` 落盘 pictures 目录。
  - **交互外壳**：顶栏（地图切换/撤销重做/导出/设置/侧栏收起/保存态）、左栏三态（标注/地形/
    符号库）、画布浮层（工具轨/比例尺/面包屑下钻/缩放条/图例入口/提示）、状态条（格坐标/缩放/
    数量/比例尺）、图例视图（9 填充 + 3 叠加说明）；键盘快捷键（Ctrl+Z/Y、V/H/B/S/P/R/T/L、Esc）。
  - **撤销/重做**：content 快照栈（上限 60），RM9 涂刷 / RM13 贴章 / 标注编辑统一入栈。

### Changed

- **状态分层落地 AGENTS.md 6.2.1**：`useMapData`（CRUD/自动保存/撤销栈/贴章/广播）+
  `useMapViewState`（视口/工具/选中/面板/下钻/图例）+ 页面仅编排；窗口级 IPC 桥接显式注册。
- **类型契约扩展**：`electron.d.ts` 新增 `MapContent` / `MapStamp` / `MapDTO` / `MapMetaDTO` 与
  `electronAPI.map.*`（list/load/add/rename/delete/save/exportPng），主进程 `map-handlers.ts`
  注册全部 handler 并在 `main.ts` 登记；preload 暴露 `map` 命名空间。
- **渲染零 DOM**：地形/纹理/等值线/河流/叠加符号/贴章全部 Canvas 2D 绘制（DOM ≤ 200），满足
  PRD §5.1 渲染约束；主题变量仅影响 UI 外壳，地形保持地图惯例 hex 配色。
- **孤儿代码清理**：移除未接线的 `TerrainPalette` 组件与 `useMapEditorState` / `useMapCanvas`
  钩子（标注/贴章编辑改为 MapPage 内联更新），与 AGENTS.md 模块边界约定一致。

### Verified

- `pnpm typecheck`（tsc -b strict）：0 错误
- `pnpm lint`：MapWindow/MapPage 0 error（仅存 useHttpClient 既有 warning）
- `pnpm test`：403/403 通过（map-terrain.test.ts 10 例覆盖确定性/约束边界/空池降级）
- `pnpm build`：渲染层 + 主进程 + preload 三段构建均通过

## [1.16.0] - 2026-09-23

### 性能优化

- **性能优化**：NovelPage 编辑器草稿与打字统计抽到 `NovelPage/store/useNovelEditorStore.ts`（P0-1）：`EditorPane` 只订阅 `draft[activeId]`，`ChapterTree`／`SupportPanel`／`NovelTopBar`／各常驻抽屉不再因每次按键重渲染；打字重渲染组件数由整棵编辑器树（20–30+）降为编辑器壳 + 状态栏
- **性能优化**：NovelPage 术语悬停状态抽到 `NovelPage/store/useHoverStore.ts`（P0-2）：仅 `HoverEntityCard` 订阅 `target`，`NovelPage` 根不再读取 `hover.target`；鼠标扫过高亮正文时由「每秒数十次 × 整树」降为仅 1 个浮层组件，`EditorPane` 的 term hover/leave/click effect 依赖比较随之简化
- **性能优化**：NovelPage 要素出场章数索引增量缓存 `NovelPage/store/useAppearanceStore.ts`（P0-3）：原 `useMemo` 依赖 `[chapters, terms]`，自动保存每写一次就全书重扫 `findTermMatches`；改为按章内容级缓存，只重扫 `content` 引用真变的章（通常 1 章），无任何变化连 `set` 都不做；`terms` 按引用守卫（引用不变即整表复用），CodeMirror 标注层不再被无意义重建
- **性能优化**：MemoPage 编辑与筛选状态抽到 `MemoPage/store/useMemoStore.ts` + `useMemoSearchStore.ts`（P1-1）：`content` 上提到 store，`MemoEditor` 只订阅 `content`、`MemoSidebar` 只订阅 `files/selected`；全文转义高亮改为订阅组件内按「已执行查找词」派生（逐字输入搜索词不再触发全文转义）；删去 `useMemoPage.ts`，根不再汇集高频状态，逐字输入不再带动侧栏虚拟列表与全文高亮
- **性能优化**：LedgerPage 筛选状态抽到 `LedgerPage/store/useLedgerViewStore.ts`（P1-2）：周期/区间/关键词/类型/分类/饼图口径进 store，配合 `LedgerTimeline`/趋势/饼图组件 `memo()`（筛选结果以 props 传入、身份稳定），与关键词输入彻底解耦，逐字筛选不再重绘三张图表
- **性能优化**：CodePage 邮箱查询改为显式「查询」动作调度（P1-3）：`useCodePage` 移除「输入 → effect → fetch」链，月度统计与列表查询统一收敛到 `loadData` 显式入口；输入 `zhangsan@example.com` 不再发 15+ 次请求，月度统计改按「已提交邮箱」而非输入框草稿刷新
- **性能优化**：路由切换保活（P1-4）：上述 store 均为模块级单例，跨路由天然保活；MemoPage 的 `selected`/未保存 `content`、LedgerPage 的 `keyword/type/categoryId/pieType` 切走再切回不再丢失

### Added

- **新增 6 个模块级 Zustand store 及配套单测**：`useNovelEditorStore`（14 例）、`useHoverStore`（7 例）、`useAppearanceStore`（7 例）、`useMemoStore`（12 例）、`useMemoSearchStore`（7 例）、`useLedgerViewStore`（6 例）；覆盖增量缓存（无变化不 set）、悬停订阅隔离、筛选解耦、显式调度防抖与换章保存等回归点

### Changed

- **docs/zustand-store-review.md 同步更新**：现状由「仅 1 处 store（useSearchStore）」刷新为全项目 7+ 处落地，并在文末列出已落地清单
- **AGENTS.md 6.2 补充「已落地 store 清单」**：登记各页面模块级 store 的路径与职责，便于后续页面沿用 runner 注册范式
- **Worker 书页输入控件全面接入组件库（AGENTS 6.1.2）**：右栏 12 处（大纲梗概行内编辑、伏笔标题 / 说明、要素搜索框与详情页名称 / 别名 / 一句话 / 性格 / 关系名、灵感速记框 / 行内编辑 / 搜索框、检索全书检索框）+ 范围外扫尾 8 处（左栏章节 / 卷改名、章节树搜索、章节快速跳转浮层、编辑器标题改名、设置抽屉章节 / 卷后缀、书架灵感速记框）原生 `input` / `textarea` 全部换为 antd `Input` / `Input.TextArea`；统一 `variant="borderless"`，外观继续由既有面板类以 `.类名.ant-input` 复合选择器承载（与 `.ant-select` 变量覆盖同思路，规避与组件库样式加载顺序的耦合），输入法守卫、Enter / Esc / ↑↓ 快捷键、受控值与 aria 标签行为不变；要素详情页输入顺带补齐面板密度外观（原为浏览器默认样式）。编辑器内查找（Ctrl+F）为 CodeMirror search panel 自渲染 DOM，不在 React 层，维持原生

### Fixed

- **字号规范全项目扫尾**：BaseWindow / LoginWindow / shared 其余 20 个 scss 完成 ≥12px、无小数、尽量双数映射（含 CodePage 两处内联 `fontSize: 11` → 12），全项目 grep 复核零残留
- **要素库类型 chips 选中项自动居中**：chips 行是隐藏滚动条的横向容器，类型较多时选中项可能落在两侧渐隐区。`EntityPanel` 切换筛选后按视口矩形差值把选中 chip 滚动到行中间（首次挂载恢复筛选不做动画，jsdom 环境守卫跳过），无需再手动 Shift+滚轮寻找
- **修复 useNovelEditorStore 测试用例缺步**：「flushSave 在换章后仍能落库旧章的在途草稿」用例首轮 flush 已清掉在途防抖，后续切章时并无在途可 flush（store 行为正确）；补一次 c1 真实输入制造在途，还原用例本意，14/14 通过
- **主题系统新增「高对比辅助」变量组（四主题同步）**：`--app-text-strong` / `--app-text-secondary-strong`（比 text / secondary 深（暗色亮）一档，用于 11px 上下的侧栏 / 抽屉小字）与 `--app-primary-weak-strong` / `--app-success-weak-strong`（高饱和弱底，用于折叠面板头）。修复 mint（薄荷）主题下 TodoPage 两个折叠板头完全同色——mint 的 primary 与 success 原本同为 `#2fa57e`，弱底 `primary-weak` / `success-weak` 均为 `#dcf2e8`；现 mint success 偏移为叶绿 `#4f9d5f`（antd `colorSuccess` 同步），两板从根上可分辨。Worker 书页右栏（大纲 / 灵感 / 检索 tab、章节行、一句话梗概、字数）与历史快照抽屉的小字号文本由 `text-muted` / `text-disabled` 升到高对比档，浅色主题下对比度由约 2~3:1 提升至 8:1 以上
- **WorkerWindow + TodoSection 字号规范化（≥12px、无小数、尽量双数）**：全窗口 35 个 scss 统一映射（9~12.5→12、13/13.5→14、15→16、19→20），消除 10.5px / 11px 级别的费眼小字；新规范已记入 AGENTS 约定，后续页面沿用
- **NovelPage 换章丢保存与今日字数虚增**（P0-1 收尾，修复抽 store 过程引入的回归）：
  - 程序化文档同步（切章灌入正文）现携带「变更前正文」作为字数基线——此前基线退化为空串，首次切到无草稿的章节会把整章字数误计入今日新增/今日累计
  - 防抖保存记录所属章节：换章后第一次真实输入时，旧章的在途保存立即落库，不再被新章的防抖重置悄悄取消；关窗/手动 flush 同样按章节定位，不再依赖「当前活动章」
- **修复右栏要素库类型 chips 行导致的列表高度跳动**：全局滚动条样式的未悬停规则（`scrollbar-width: thin`，特异性 0,2,0）会压过 `.nv-chips` 自己的 `scrollbar-width: none`（0,1,0），而悬停时页面规则又胜出——横向溢出的 chips 行（类型较多放不下时）随指针进出反复出现/消失滚动条占位，下方列表跟着频繁弹跳。现把标准属性 `scrollbar-width` 收敛为 `*` 上的一次性恒定声明（宽度永远 thin、页面覆盖两种状态下都生效），滚动条只按悬停切换颜色，不再切换占位；`SearchPanel` 最近搜索 chips 的同类隐患一并消除
- **chips 行溢出边缘渐隐提示**：chips 行滚动条为隐藏设计，溢出内容此前只能靠 Shift+滚轮盲滚到达。新增 `SupportPanel/useEdgeFade.ts` 按滚动位置探测两端不可见内容（scroll + ResizeObserver + MutationObserver，状态不变不触发渲染），配合 `.nv-chips` 的 `mask-image` 渐变遮罩，左侧/右侧还有内容时对应边缘渐隐 18px；要素库类型筛选与最近搜索两处 chips 行均已接入

## [1.15.0] - 2026-09-22

### Added
- **全书检索状态抽到模块级 Zustand store**：新增 `NovelPage/store/useSearchStore.ts`
  （依赖 `zustand ^5.0.15`），持有 keyword / scope / hits / loading / recent 与防抖
  调度动作（300ms、请求票据丢弃过期响应、同关键词复用缓存）；检索实现由组件挂载时
  经 `registerSearchRunner()` 注册、卸载时注销，注册本身不触发任何请求
- **检索 store 单测**：`store/useSearchStore.test.ts` 5 例（防抖时机、过期响应丢弃、
  同关键词切作用域零重查、要素名作用域零往返、清空作废在途请求）

### Fixed
- **检索跳章仍会闪一次**：根因不是 `activeChapterId`，而是点命中后编辑器失焦保存 →
  bundle 更新 → `chapters` 数组重建 → `searchBook` 身份变化 → SearchPanel 检索
  effect 重跑 → 骨架屏闪现。检索动作从 effect 依赖数组里彻底移出后，父层任何重渲染
  都不会再发起检索；顺带修掉「切走 Tab 再回来关键词与结果丢失」
- **起名器切换类型/风格/性别/数量后列表仍是旧类型**：四个 onChange 里用
  `setTimeout(() => regenerate(...), 0)` 读的是上一次渲染的闭包（`effectiveKind`
  仍是旧值）。改为 `buildBatch(显式参数)`：把变更后的值当参数传入，不再读闭包

### Changed
- **起名器四个原生 `<select>` 换成 antd `Select`**（类型／风格／性别／数量）：
  带禁用项（当前风格不支持的类型置灰）、`popupClassName="nv-name__dropdown"`
  单独声明弹层样式（portal 不继承组件根选择器），尺寸与配色覆盖为面板密度 +
  `var(--app-*)`；同步移除 select 上的 Enter 拦截（组件库自带键盘交互）
- **全部原生 `<select>` 换成 antd `Select`**（共 7 处）：起名器 4 处（类型／风格／
  性别／数量，当前风格不支持的类型置灰）、要素详情 2 处（关联要素／等级体系）、
  大纲 1 处（伏笔埋设章节）。均带 `popupClassName` 声明弹层样式（portal 不继承
  组件根选择器），尺寸与配色覆盖为面板密度 + `var(--app-*)`；空值改用
  `placeholder` 表达（「选择要素…」「卷级伏笔（不绑具体章）」）而不再是空 option
- **测试环境补齐 jsdom 缺失 API**：`vitest.setup.ts` 增加 `ResizeObserver` 与
  `matchMedia` 兜底——antd 6 的 Select / 虚拟列表挂载即用到，缺失会直接抛
  `ReferenceError`；同时新增起名器组件回归测试（切换类型必须带新 kind 调用生成器，
  锁定「旧闭包」这一回归点），大纲埋设章节用例改为走组件库 Select 交互
- **AGENTS.md 新增 6.1.2「UI 组件库优先规范」**：下拉/日期/弹层/开关等一律用
  Ant Design，禁止原生控件替代；列出三类例外（编辑器、面板即时输入、行内自增
  输入）；明确弹层必须用 `popupClassName` 命中样式
- **AGENTS.md 6.2 补充 Zustand 适用信号**：子组件 effect 依赖父层回调、父层重渲染
  清空子状态、面板卸载丢状态——命中任一即建模块级 store，且注册动作不得触发请求
- **换作品时清空检索缓存**：检索 store 是模块级的，`SupportPanel` 监听
  `activeWorkId` 变化调用 `clear()`，避免把上一本书的命中带到新作品

## [1.14.0] - 2026-09-22

### Added
- **右栏支撑面板宽度可调并记忆**：新增纯函数 `clampPanelWidth()`（`novel-utils.ts`，
  区间 280–460，非法值回退基准），`LAYOUT` 新增 `rightRailMinWidth` /
  `rightRailMaxWidth`，基准宽度 322 → 340；`useNovelViewState` 新增 `rightWidth` /
  `setRightWidth`，挂载时经 `novel-config-get`（键 `novel_panel_width`）恢复、
  变更后 300ms 防抖写回（`novel-service.ts` 的 `fetchPanelWidth` / `savePanelWidth`）
- **工具箱启动器**：新增 `components/SupportPanel/components/ToolLauncher/`，工具
  Tab 改为二级面板——起名器可直接进入，人物关系网络（R27）/ 架空地图（R28）以
  「规划中」占位卡呈现，避免拿不可用的入口占版面
- **大纲伏笔来源**：`OutlineNode` 的 foreshadow 节点新增 `source` 字段，
  `buildOutlineTree` 绑定章时拼「第三章 断碑」标签，卷级伏笔回退
  「卷级伏笔 · 不绑定具体章」
- **面板通用零件**：新增 `SupportPanel/panel-primitives.scss`（`.nv-field` /
  `.nv-sub` / `.nv-chips` / `.nv-sechead` / `.nv-empty` / `.nv-mini` / `.nv-kv` /
  `.nv-ghost`），供五个 Tab 与二级面板复用，避免各面板各写一份

### Changed
- **右栏骨架改为四段式**（面板头／分段 Tab／内容滚动区／常驻提示条）：面板头按
  Tab 显示语境计数与主操作（大纲「＋ 伏笔」、要素库齿轮进类型管理）；Tab 改为分段
  控件 + 白色滑块指示器（ResizeObserver 测量 + `transform` 滑动）；底部常驻快捷键
  提示条；左边界新增拖拽把手，收起后右边缘留竖向重开把手
- **大纲拆双视图**：章节与伏笔不再交错混排（长卷里伏笔会被章节挤到看不见），改由
  子分段切换并各自带计数；伏笔支持待回收／已回收／全部过滤与就地编辑，卷可折叠
- **要素卡与详情改版**：卡片显示别名／一句话／关联数／出场章数／当前境界，悬停浮出
  「插入正文／编辑」；详情改 hero 卡 + 基础字段／关联／境界阶梯／出场章节分区
- **要素库**：顶部搜索（名称／别名／简介）+ 带计数类型 chips（横向滚动），全部视图
  按类型分组；出场章数由页面层 `appearanceCountOf` 聚合下发
- **灵感面板**：速记框改为 Enter 记录 / Shift+Enter 换行且空草稿禁用「记录」，
  置顶独立成段，行内操作悬停浮出，其他书籍的灵感只读并标注来源
- **检索面板**：新增作用域（全书／本章／要素名），要素名作用域走内存比对零往返，
  最近搜索 chips，检索中骨架屏，命中高亮
- **起名器**：二维选项网格 + 结果卡 + 收藏夹，悬停浮出快捷操作

## [1.13.1] - 2026-09-22

### Fixed
- **备忘编辑器高亮层错位**（透明 TextArea + 底层高亮 div 镜像结构），修复两个
  独立根因，两层在任意滚动位置/任意内容下恢复逐像素对齐：
  - **滚动条槽位宽度差（主因）**：全局自定义滚动条是 classic 布局槽（8px 常驻），
    textarea 内容溢出时内容区比高亮层窄 8px；中文逐字断行 → 两层换行点/折行数
    不同且随深度累计漂移（实测 20 行临界内容偏移 476px）。修复：textarea 加
    `scrollbar-gutter: stable` 恒定预留槽位，高亮层 `padding-right: 20px` 补齐同宽
  - **末尾换行行盒缺失（次因）**：内容以 `\n` 结尾时 pre-wrap 的高亮 div 比
    textarea 少渲染最后一行空行盒，scrollHeight 矮一行，滚到底部时被 clamp 产生
    一行永久偏移。修复：高亮 HTML 恒追加 `<br />`（react-simple-code-editor
    同款手法），保证行盒数不少于 textarea
  - 根因均经独立 Chromium 复现页对照实验证实（现状 CSS 复现偏移、修复后全场景
    scrollHeight/底部 clamp 差值为 0）

## [1.13.0] - 2026-09-22

### Added
- **每日打卡**：首页「开始今日打卡」按钮改为直接打卡——点击记录打卡落库并
  message 反馈，**不再跳转日历页**；已打卡后按钮置为「今日已打卡」成功色态并
  禁点，**次日 5:00 业务日切换后自动重置**（应用跨夜常开时按主进程下发的
  `resetAt` 定时恢复），凌晨 0-5 点的打卡归属前一个业务日
- **打卡数据层**：userDb 新增 `checkins` 表（`checkin_date` 业务日 UNIQUE，
  `INSERT OR IGNORE` 幂等吸收重复点击）；新增 `electron/checkin-utils.ts`
  （业务日切分 / 下次重置时刻纯函数）与 `electron/handlers/checkin-handlers.ts`
  （`checkin-status` / `checkin-today` / `checkin-dates` 三通道）并在 main.ts 注册；
  `preload.ts` 暴露 `electronAPI.checkin` 命名空间，渲染层语义化服务
  `shared/services/checkin.ts`；首页按钮逻辑抽 `HomePage/hooks/useCheckin.ts`
- **统计口径**：首页「本月打卡」改从 checkins 表取数（原为「有活动的天数」）
- **日历打卡提示点**：日程页日历对应日期渲染打卡提示点，配色走新主题变量
  `--app-checkin-dot`（四主题同步新增，按主题与主色校准区分度），与活动点并存
  可区分——活动点改用主题色 `--app-primary`（原同为绿色，无法区分「已打卡」
  与「有日程」）

### Changed
- **数据迁移模块下线，功能并入待办/备忘页**：删除 `/migration` 路由、
  `MigrationPage/`、`electron/handlers/migration-handlers.ts` 与
  `electron/migration-utils.ts`；备份能力按业务拆入两个 handler——
  `todo-backup-export/import`（manifest + todos.json，导入重新分配自增 id 并修复
  父子指向）与 `memo-backup-export/import`（manifest + memos/*.md，导入重名自动
  追加序号）；zip 包格式与旧迁移包完全兼容（清单 `scopes` 数组保留）
  - 待办页工具栏新增「导出备份包 / 导入备份包」按钮：导入前弹确认说明追加合并
    语义（不覆盖现有数据），完成后刷新列表
  - 备忘页侧栏导入/导出按钮升级为下拉：导出 TXT / DOCX / 备份包（zip 全部备忘），
    导入文件（MD/TXT/DOCX）/ 导入备份包（zip）；备份导入同样弹确认
  - `electron/migration-utils.ts` 重构为 `electron/backup-utils.ts`（清单按单范围
    构造，`buildExportFilename` 带 `checkin-todo-` / `checkin-memo-` 前缀），
    测试同步迁移；`useHomeOverview` 与 HomePage 移除迁移入口
- 首页功能卡移除「数据迁移」（`/migration` 已删除）
- **全局滚动条改为 hover 展示**：三个窗口统一引入新共享样式
  `shared/styles/scrollbars.scss`——滑块默认透明，指针悬停到滚动容器（或容器内
  持有焦点）时才浮现（主题 token `--app-scrollbar` / `--app-scrollbar-hover`
  兜底）。实现上用 `:not(:hover):not(:focus-within)` 高特异性规则压过页面局部
  「常显」配色，hover 时与局部规则同特异性、页面样式后加载胜出，故 HomeSidebar /
  LedgerTimeline / LedgerCategoryPie 的局部滑块配色无需改动即自动兼容该交互

### Fixed
- **打卡提示点撞色**：mint 主题 `--app-primary` 与 `--app-success` 同为绿色，
  打卡点在主题色日历格上无法分辨——`--app-checkin-dot` 在 mint 下改用琥珀色
  `#d9a514`；选中格为实心主色底时，活动点 / 打卡点统一加一圈
  `--app-primary-contrast` 对比描边，避免主色系圆点隐形

### Verified
- 单测（vitest 直调）：300/300 通过（23 个测试文件；新增 checkin-utils 10 条，
  migration-utils → backup-utils 28 条，删除 useMigration 7 条）
- `tsc --noEmit`：tsconfig.app.json / tsconfig.node.json 双侧 0 错误
- 本轮样式改动（themes.scss / scrollbars.scss / DailyPage / 三窗口入口 scss）
  经 sass compile 逐一验证无语法错误；无 TS/TSX 改动，eslint 无目标文件

## [1.12.0] - 2026-09-22

### Added
- **记账模块（M1 + M2）**：新增 `/ledger` 页面与侧栏「记账」入口
  （`HomeSidebar` 置于「日程」之后）、首页功能卡「记账本」
  与首页统计「本月支出」迷你卡
- **数据层**：`electron/db.ts` 迁移式建 `ledger_transactions /
  ledger_categories / ledger_accounts / ledger_tags / ledger_budgets`
  五张表（含 `happened_at` 倒序索引）；新增
  `electron/handlers/ledger-handlers.ts` 导出 `registerLedgerHandlers()`
  并在 `main.ts` 注册；`preload.ts` 暴露 `electronAPI.ledger` 命名空间，
  DTO 同步进 `shared/types/electron.d.ts`
- **服务层**：`shared/services/ledger.ts` 提供语义化 API
  （listCategories / listTransactions / addTransaction / updateTransaction /
  deleteTransaction / restoreTransaction / upsertCategory / deleteCategory /
  sumExpense）与 10 类预设分类；分类预设由渲染进程持有，首次拉取为空时
  播种到主进程，避免两处各写一份而漂移
- **交互**：快捷记一笔走 antd `Modal` 居中弹层（⌘/Ctrl+Shift+L 唤起），
  行内编辑走 `Modal`，周期「自选」走 `Popover` + `RangePicker`，
  分类筛选走 `Popover`，删除走 `Popconfirm` + 5 秒可撤销 Toast；
  全部弹层均为标准组件，未自绘 mask
- **性能优化**：流水时间线用 `react-virtuoso` 的 `GroupedVirtuoso`
  虚拟化（日期分组 + 扁平行数组），长账目下只挂载可视行；行组件
  `LedgerTxRow` 用 `memo()` 且回调稳定；hover 只改 `box-shadow` 与 `opacity`
- **图表零依赖**：分类占比环图（stroke-dasharray）与近 30 天趋势折线
  （polyline + `vector-effect`）均为纯 SVG，未引入图表库
- **配色合规**：支出 `--app-error`、收入 `--app-success`，金额一律带
  `+ / −` 前缀与箭头，不依赖颜色单独传达信息；分类色板复用既有
  `--app-accent-*`，四主题自动跟随，`themes.scss` 零改动

### Fixed
- **记账页三处视觉问题**：
  - 快捷记一笔金额框聚焦出现「双圈」：antd 6 已废弃 `bordered={false}`（实际不生效），
    内层输入框自带边框与聚焦光晕叠加外层容器描边；改为 `variant="borderless"`，
    聚焦/错误态统一由外层容器表达（primary-weak / error-weak 软光圈）
  - 流水区底部冒出默认粗横滚条：Virtuoso 滚动容器的绝对定位 viewport 按
    padding-box 解析宽度，容器上 `padding: 0 4px` 恰好横向溢出 8px；
    移除容器水平内边距（内边距下沉到行/分组头）并显式 `overflow-x: hidden`，
    滚动条横竖两轴统一收细为 8px
  - 内容比页头宽一圈：`.ledger-page` 左右留白 12px 而 NavHeader 卡片是 24px，
    对齐为左右 24px + 底部 20px，FAB 右缘随之与内容边对齐
  - 流水行 hover 底色通栏顶到卡片边缘：行元素自带 `margin: 0 8px` 内收
    （水平内边距不可加回 Virtuoso 滚动容器，否则横向溢出复现横滚条），
    分组头与筛选条内边距同步对齐 16px，三者左缘一致
  - **最小窗口（高 600px）下左侧栏主题切换被挤出不可见**：侧栏导航 8 项在矮窗口
    超出卡片高度，底部工具区（`margin-top:auto`）因无剩余空间而溢出被祖先
    `overflow:hidden` 裁掉；改为导航区 `flex:1 1 auto; min-height:0; overflow-y:auto`
    （4px 细滚条），footer 设 `flex:0 0 auto` 永不被压缩，并加
    `@media (max-height:680px)` 压缩导航间距让最小尺寸下基本无需滚动
  - **快捷记一笔弹窗与设计稿差距过大**：原 `Drawer` 把控件纵向堆叠且带标题栏，
    与设计稿的「三行紧凑布局」不符；改为 antd `Modal`（`centered` 屏幕居中、
    `width=640`、`max-width: calc(100vw - 48px)`、无标题栏/无关闭钮，
    遮罩点击与 Esc 关闭），三行对齐设计稿：行1 支出/收入分段 + ¥ 金额胶囊 + 行内错误；
    行2 紧凑胶囊分类（30px pill，选中态 `inset 0 0 0 1px currentColor` 描边）；
    行3 备注 + 今天胶囊（`Popover` + `DatePicker` 可改期，今天显示「今天」否则 MM-DD）
    + Enter/Esc 提示 + 保存按钮，保存时按所选日期落库

### Changed
- **首页统计**：`useHomeOverview` 新增 `monthExpense`（本月支出，取整），
  与待办 / 备忘 / 打卡 / 代码并行拉取，任一项失败只置 `null` 渲染为「—」
- **主题色板扩展**：`FeatureCard` 新增 `green` tone、`HomeStats` 新增 `rose`
  tone，均取自既有 `--app-accent-*`，新增变量零成本

### Verified
- `pnpm test`：23 个文件 / 296 个用例全绿（新增 `ledger-utils.test.ts` 18 例
  覆盖金额校验、周期区间、环比、日期分组、>7 类折叠、趋势补桶、筛选；
  `LedgerPage.test.tsx` 2 例冒烟覆盖有数据态与空态）
- `tsc --noEmit -p tsconfig.app.json` 与 `tsconfig.node.json`：0 错误
- `eslint .`：0 error（仅剩 `useHttpClient.ts` 既有 warning）
## [1.11.1] - 2026-09-22

### Added
- **小说编辑器 · 起名工具（R18 + R31，零新表）**：右栏新增「工具」Tab，
  承载组合式随机起名器，服务网文作者「卡名字」高频场景。
  - **八类名称 × 东西方六风格**：人名 / 地名 / 门派名 / 法宝名 / 境界名 /
    丹药名 / 系统名 / 神名 × 东方四风格（仙侠 / 武侠 / 现代都市 / 日式）+
    西方两风格（西幻 · 史诗奇幻 / 西式现代）；不同 kind 用独立前缀 / 后缀
    双桶避免「天魔丹」「天魔宗」撞名；风格元信息 `applicableKinds`
    标注每个风格可生成的类型（如「现代都市」不产门派 / 法宝 / 境界）
  - **生成器纯函数 + 单测**：`naming/name-generator.ts` —— `generateNames`
    四维过滤（风格 × 类型 × 性别 × 避开本书已用名）、10 个 / 批、
    `generateNextBatch` 换批、带 seed 可复现；`name-generator.test.ts`
    覆盖去重 / 避开已用 / 空池降级 / 可复现性，23 例全绿
  - **双出口**：EditorPane `forwardRef` + `useImperativeHandle` 暴露
    `insertText(text)`，名字一键插入正文光标处；另一出口复用
    `handleSaveEntity` 一键建为角色卡（名称带入）
  - **收藏夹按作品持久化**：复用 `configGet / set`（零新 IPC、零新表），
    `sanitizeNameFavorites` 纯函数清洗防 config 损坏；`useNovelData`
    暴露 `nameFavorites` 状态与 `addNameFavorite / removeNameFavorite` 动作
  - **内置静态词库**：`naming/data/dictionary.ts` 静态资源随应用分发
    （姓氏池 + 男 / 女名用字 + 西方姓 / given 名 + 按风格 × kind 双桶）
- **PRD 同步更新**：R18 描述扩展为「八类 × 东西方六风格」；§9 步骤三
  标 ✅ 已完成；§6.5.1 M2 表 R31 状态更新；§6.5.3 从未实现清单移除
  R18；§10 开放问题 9 起名词库来源现状更新

## [1.11.0] - 2026-09-21

### Added
- **应用图标体系**：全新 CheckIn 品牌图标，取代 Electron 模板默认的紫色闪电。
  视觉语言为「单一笔势」——钢笔笔身与勾选长臂共用同一个笔尖端点，
  一条笔画同时表达「写作」与「待办」；配色取自主题变量
  （`#8E9CFF → #5B6CF9 → #7449E0` 对应 `--app-primary` 一系）
- **两套图标，按物理尺寸分流**：
  - 应用图标（桌面 / 窗口 / 安装包）：`public/icon.ico`（内嵌 16/20/24/32/40/
    48/64/128/256 九帧）、`public/icon.svg`（矢量母版）、`public/icon.png`（512）
  - 托盘图标（独立一套）：`public/tray/tray{,-16,-20,-24,-32,-48,-64}.png` +
    `public/tray.svg`，笔身与勾均加粗约 16%，笔尖缝改为实心底板色
- **小尺寸分级渲染**：<128px 的帧用实心笔身单独渲染（笔尖缝宽约
  0.0075×尺寸，64px 下不足 0.5px，切开后经 LANCZOS 降采样只会糊成灰线）；
  ≥128px 才保留真实笔尖缝
- **打包链路补齐**：
  - `electron/main.ts` 新增 `TRAY_ICON_PATH`，托盘改用 tray 专用图
    （原先与应用图标共用同一文件）
  - `package.json` 的 `build.icon` / `build.win.icon` 由 `icon.png` 改为
    `icon.ico`
  - `scripts/after-pack.js` 新增 rcedit 步骤写入多尺寸 exe 图标；
    rcedit 为可选依赖，缺失时跳过不影响打包
  - 确认 Vite 会递归复制 `public/` 子目录，`dist/tray/` 无需额外 copy 插件

### Fixed
- **任务栏图标勾选变紫（小尺寸帧丢白）**：`render_small()` 重建笔尖缝时
  色键遮罩用了 `CHROMA = 255`，与字形填充值完全相同，于是「选中色键区域」
  实际选中了**整个字形**，紧接着被刷成底板色 `#7449E0`。结果 16/20/24/32/40px
  五帧近白像素为 0%，而 Windows 任务栏恰好取这几帧。已彻底移除色键机制，
  小尺寸直接实心纯白渲染；现九帧白色占比随尺寸 4.7% → 8.1% 平滑递增
- **矢量母版笔尾凹陷**：`svg_app()` 里封住笔尾的半圆把扫掠标志写成了 `1`。
  该弧半径恰为 `hw_pen`、圆心就是 T1T2 中点，两条候选弧只有扫掠方向之别——
  取 1 时弧朝笔身内部凹进去，笔尾成了月牙缺口（位图无此问题，圆头是用
  `ellipse` 画的）。改为 `sweep=0` 后弧中点落在笔身外侧极值点上。
  同时把托盘矢量母版也改为由几何参数生成（原先手写坐标，同样是 sweep=1）

### Verified
- `pnpm build`（tsc -b + vite build）：0 错误
- 图标产物逐帧校验：`public/icon.ico` 九帧、`public/tray/*` 七件齐备，
  各帧白色字形占比随尺寸平滑递增，无丢白帧
- 待办：`pnpm electron:build` 需重跑一次，安装包 exe 图标通过
  `scripts/after-pack.js` 的 rcedit 步骤写入，未在本轮验证

## [1.10.1] - 2026-09-21

### Added
- **模板书籍预设化**：新用户（novel_* 空库）首次进入书架 / 编辑器时，
  主进程自动播种一部完整模板书籍《山海拾遗（模板示例）》（15 章 / 约 5 万字 +
  要素卡 / 关联 / 等级体系 / 灵感 / 伏笔），取代原先的空白「未命名作品」；
  播种逻辑抽为 `seedTemplateBook()`（novel-handlers.ts），与「一键重置为
  模板书籍」共用同一事务，删除全部作品后重新装载同样回到模板书
- **历史快照抽屉开关化**：顶栏「历史快照」按钮改为开关式——再点一次收起
  抽屉，按钮带高亮态与 aria-pressed，Tooltip 随开合切换
- **灵感全局搜索**：编辑器灵感面板搜索升级为全局口径——关键词命中全部
  书籍的灵感（含书架未归属池之外的已归档灵感），其他书籍的灵感只读展示
  并带来源书名标签；清空关键词回到当前作品列表，计数随口径切换

### Verified
- `pnpm typecheck`：0 错误
- `pnpm lint`：0 错误（仅 useHttpClient 既有警告）
- `pnpm test`：276/276 通过（21 个测试文件；新增 InspirationPanel
  全局搜索 1 条：命中外部书籍灵感 / 来源标签 / 只读 / 清空回退）

## [1.10.0] - 2026-09-21

### Added
- **数据迁移（导出 / 导入 zip）**：首页第 5 张卡片「数据迁移」进入新页面，
  可勾选「待办清单」「备忘笔记」两部分——导出打包为一个 zip 备份包
  （`manifest.json` + `todos.json` + `memos/*.md`，清单带应用标识与格式版本），
  导入选择一个 zip 后按**追加合并**落到当前账号
- 导出 / 导入全部在主进程完成（系统弹窗 + 文件 IO + zip 编解码走 jszip），
  渲染层只传勾选范围、拿结果；入口：`registerMigrationHandlers()`
  （`electron/handlers/migration-handlers.ts`，在 main.ts 注册）
- 导入语义：todo 重新分配自增 id 并保持父子结构（`planTodoInserts` 先父后子 +
  旧 id→新 id 映射修复 parent_id；父子成环或父项缺失时退化顶层，不丢数据）；
  备忘重名自动追加序号，绝不覆盖已有文件
- 清单校验：拒绝非 CheckIn 来源、缺失版本、版本高于当前、无有效范围的包
- 备忘目录路径抽到 `electron/user-paths.ts`，memo-handlers 与 migration-handlers 共用

### Verified
- `pnpm typecheck`（app + node 两段，strict）：0 错误
- `pnpm lint`：0 错误（仅 useHttpClient 既有警告）
- `pnpm test`：275/275 通过（20 个测试文件；新增 migration-utils 27 条 +
  useMigration 7 条）
- `vite build`：渲染层产出 MigrationPage chunk，主进程 jszip 保持 external
- zip 往返冒烟（node + jszip）：中文文件名与 emoji 备忘内容存取无损

## [1.9.5] - 2026-09-21

### Fixed
- **正文选中高亮滚动后偏移**：段距用 `.cm-line { margin-bottom }` 实现，而
  CodeMirror 6 的行高测量（heightMap）不含 margin——「文档位置估算 ↔ DOM
  实际位置」的偏差随行数线性累积：文档开头正常，滚动到下方后选中高亮 /
  点击落点 / 光标全部错位。段距改为 `padding-bottom`（计入 border-box
  高度、被测量捕获；`.cm-line` 是整段一个元素，段内软折行行距与段间距
  视觉均不变）；新增 EditorPane 样式契约单测（cm-line 禁止垂直 margin +
  段距必须走 padding-bottom）防回归

### Verified
- `pnpm typecheck`（app）：0 错误
- `pnpm test`：NovelPage 范围 99/99 通过（含新增 2 条样式契约）

## [1.9.4] - 2026-09-21

### Added
- **精简构建（lite）**：新增 `electron:build:lite` 脚本与 `CHECKIN_LITE=1`
  构建开关（vite.config.ts 顶部 `isLite`）——vite 不产出 WorkerWindow 入口
  （dist 无 worker 页面产物），主窗口侧栏隐藏 Worker 入口按钮与分隔线
  （HomeSidebar），主进程 `worker-window-open` 打开请求被编译期常量
  `__CHECKIN_LITE__` 屏蔽；常量声明见 `src/env.d.ts`（渲染层）与
  `electron/globals.d.ts`（主进程），vitest.config.ts 的 define 对齐为
  完整构建；常规构建不受影响

### Verified
- `pnpm typecheck`（app + node 两段，strict）：0 错误
- `pnpm lint`：0 错误（仅 useHttpClient 既有警告）
- `pnpm test`：239/239 通过（18 个测试文件）
- `CHECKIN_LITE=1 vite build`：dist 仅产出 BaseWindow/LoginWindow 两个入口，
  无任何 worker 产物；main.js 中 `worker-window-open` handler 被编译为空实现；
  渲染层产物无「打开 Worker 窗口」按钮文案
- 常规 `vite build`：三入口齐全，默认路径不受影响

## [1.9.3] - 2026-09-21

### Added
- **等级体系管理（R25）**：`novel-level-system-add/rename/delete` 与
  `novel-level-add/rename/delete/order` 六个 IPC（主进程事务 + 渲染层
  乐观同步）；新增 LevelSystemManager 弹框（体系增删改、等级项增删改 /
  上下移 / 拖序回写 rank）；EntityDetail 要素卡新增「当前境界」区块——
  体系下拉 + 境界按钮点选绑定，绑定为一条 `novel_links` 行
  （`toType: "level"` + `relation: "当前境界"`，一要素同时仅一条，先摘旧再落新），
  删除体系 / 等级项时级联摘除关联；模板书籍预置沈孤舟→凝丹境示例
- **TXT 导出（R13）**：作品管理菜单新增「导出整本 / 导出本卷 / 导出本章」；
  渲染层纯函数组装文本（`buildBookPlainText` / `buildVolumePlainText` /
  `buildChapterPlainText` / `buildEntityCardText`），主进程只做
  saveDialog + 写文件。章节标题按序号设置派生（`第一章 灵潮起` /
  `第12回 xxx`，与界面所见一致，章序号全书连续），卷标题对齐
  volumeDisplayName 口径；整本首行 `《书名》`。EntityDetail
  「导出设定卡」由 toast 占位做实（含当前境界单列一条）
- **使用统计埋点（R14）**：`novel-usage-log` / `novel-usage-today` IPC +
  `novel_usage_log` 表；editor_open / chapter_save / snapshot / goal_reach
  四类事件，goal_reach 在今日目标达成时上报；「今日累计」改为启动时
  从埋点表取净增字数（SUM delta）+ 会话内 delta 续加，替换原会话级内存口径
- **自定义要素类型（R23）**：用户新建类型（命名 + 8 色板选色，id 固定
  `ct-` 前缀），定义存 config 键 `novel_entity_types`（整读整写 +
  sanitizeCustomTypes 校验）；新增 EntityTypesProvider Context 运行期
  派生 meta（自建类型弱色 `color-mix` 派生），六组件改经
  `useEntityTypeMeta()` 查 meta；CodeMirror 标注层对自建类型经
  Decoration.mark 内联注入 `--nv-mark-color`；新增 EntityTypeManager
  弹框（增删改 + 各类型张数统计，删除类型时该类型要素迁移回「自定义」）

### Verified
- `pnpm typecheck`（app + node 两段，strict）：0 错误
- `pnpm lint`：0 错误（仅剩 `useHttpClient.ts` 既有 eslint-disable 警告）
- `pnpm test`：227/227 通过（17 个测试文件；新增 novel-export 4 组用例：
  章节标题序号派生 / 卷与整本组装 / 设定卡 / sanitizeCustomTypes）
- `vite build` 通过

## [1.9.2] - 2026-09-21

### Added
- **模板书籍 + 一键重置（调试功能）**：新增 `electron/novel-template.ts`
  确定性生成器——单作品「山海拾遗（模板示例）」3 卷 15 章，每章 ≥3200 字
  （全书约 6 万字，压测 CodeMirror 虚拟滚动 / 全书检索 / 快照 / 标注层预算），
  正文按 seed 伪随机织入要素名与别名（驱动高亮与悬浮卡）；覆盖全部功能面：
  六类要素卡（含别名、自定义字段）、8 条要素关联、两条等级体系（灵徒九境 /
  器阶七品）、灵感速记（置顶 / 已转伏笔）、伏笔（待回收 / 已回收、卷级 /
  章级挂载）、章节梗概与草稿 / 完稿混合状态
- **`novel-editor-reset-template` IPC**：主进程单事务清空全部 novel_* 表后
  重新播种模板（生成器每次实时构建，改模板定义后重置即生效）；排版设置保留，
  续写位置一并清除；preload / electron.d.ts 同步暴露 `novel.resetTemplate()`
- **作品管理菜单新增「重置为模板书籍（调试）」**：确认弹框明示清空范围；
  重置后渲染层清空活动作品 / 章节 id 并全量重载，toast 汇报章数与字数

### Fixed
- **mammoth / docx 幽灵依赖显式化**：1.7.1 备忘导入导出使用的两个包从未
  进入 package.json / lockfile（换机重装后 node_modules 缺失），删除
  tsbuildinfo 缓存后 `tsc --noEmit -p tsconfig.node.json` 暴露 TS2307。
  已显式声明进 dependencies 并补装

### Verified
- `pnpm typecheck`（app + node 两段，strict）：0 错误
- `pnpm lint`：0 错误（仅剩 `useHttpClient.ts` 既有 eslint-disable 警告）
- `pnpm test`：215/215 通过（16 个测试文件；新增 novel-template 12 例：
  结构 / 字数口径 / 类型覆盖 / 引用合法性 / 确定性幂等 / id 唯一）
- `vite build` 通过

## [1.9.1] - 2026-09-20

### Fixed
- **删除作品后作品名复活**：`novel-work-delete` 事务漏删 `novel_works` 行本身
  （只清了卷章 / 要素 / 灵感伏笔 / 快照），删光全部作品后重新装载时，
  库里残留的作品名全部回来。已在同一事务内补上 `DELETE FROM novel_works`

### Added
- **章节删除**：`novel-chapter-delete` IPC（同事务清理该章历史快照）；
  左栏章节行悬浮浮现删除按钮，Popconfirm 确认后删除；删除当前章节时
  按展示顺序自动切换到后一章（无后一章则前一章）

### Changed
- **点击正文下方空白也能聚焦**：CodeMirror content 只占文档实际高度，
  点击其下方（纸面 / 滚动容器）此前无响应；现在兜底聚焦并把光标落到
  点击坐标对应位置（命中不到内容点时落到文档末尾）
- **未命名卷展示统一**：新增 `volumeDisplayName` 纯函数，存储名为
  「未命名卷」时各处一律展示按 sort 派生的「第N卷」（此前面包屑、
  重排确认弹框裸显「未命名卷」）；VolumeNode 卷头改用同一口径

### Verified
- `pnpm typecheck`：0 错误；`pnpm lint`：0 错误；`pnpm test`：203/203 通过
  （新增 volumeDisplayName / 未命名卷面包屑用例）；`pnpm build` 通过

## [1.9.0] - 2026-09-20

### Added
- **小说编辑器 M1 收尾（PRD v0.5 §9 步骤一）**，四项缺口一次补齐：
  - **设置持久化（R5）**：排版 / 目标 / 字数口径 / 标注类型 / 序号后缀等全部
    `EditorSettings` 经 `novel-config-get/set` IPC 写入 userDb `config` 表，
    启动恢复；`mergeEditorSettings` 纯函数逐字段类型守卫（区间夹取、枚举校验、
    annotationTypes 过滤去重），损坏数据安全回退默认值
  - **续写位置记忆（R6）**：持久化「作品 / 章节 / 光标偏移 / 滚动位置」四元组
    （500ms 防抖 + 关窗 flush），启动时 `sanitizeRestorePosition` 校验归属后
    原位恢复（此前只回第一个章节）
  - **作品 CRUD（R29）**：`novel-work-add/rename/delete` 三个 IPC，删除在
    主进程单事务级联清理（卷章快照 / 要素关联 / 灵感伏笔 / 等级体系与转换）；
    顶栏新增「作品管理」下拉（新建 / 重命名 / 删除确认，删除弹框明示级联范围），
    作品下拉选项展示章节数与字数；删空后自动重新播种默认作品
  - **章节内查找替换（R10）**：接入 `@codemirror/search`（Ctrl+F 查找、
    Ctrl+H 打开替换面板，面板跟随四套主题变量）；窗口级快捷键增加
    `defaultPrevented` 守卫，避免编辑器已消费的 Esc / Ctrl+F 双跳

### Changed
- `useNovelShortcuts`：跳过已被编辑器消费的按键（`event.defaultPrevented`）
- `useNovelData.load()` 启动装载改为串联读取上次位置并校验恢复
- `package.json` 显式声明 `@codemirror/search@^6.7.2`（hoisted 布局下不得依赖幽灵依赖）

### Verified
- `pnpm typecheck`（tsc -b，strict）：0 错误
- `pnpm lint`：0 错误（仅剩 `useHttpClient.ts` 既有 eslint-disable 警告）
- `pnpm test`：201/201 通过（15 个测试文件；新增 mergeEditorSettings /
  sanitizeRestorePosition / parseJsonOrNull / buildWorkMeta 用例）

## [1.8.0] - 2026-09-20

### Added
- **小说编辑器数据 DB 本地化（PRD v0.4 §7 M1 落地）**：WorkerWindow/NovelPage
  的数据源由内存演示数据（`novel-demo-source.ts`）全量替换为 SQLite 持久化。
  `electron/db.ts` 新增 `novel_*` 全套表（works / volumes / chapters /
  snapshots / notes / outline_entries / entities / links / level_systems /
  levels / level_conversions），时间戳统一存毫秒整数对齐渲染层 `Date.now()`
- **主进程 `novel-handlers.ts`**：语义化 IPC（章节增删改、快照环形保留 +
  崩溃恢复标记、要素/关联/灵感/大纲/等级体系 CRUD、全书检索）。会话级崩溃
  恢复——窗口正常关闭与 `before-quit` 双路径清除 `running` 标记，异常退出
  下次启动触发恢复横幅
- **渲染层 `novel-service.ts`**：封装 IPC 调用，提供与原演示数据源一致的
  语义化 API；`useNovelData` 全量接线持久化，页面与组件层零改动即生效
- **类型契约**：`electron.d.ts` 补齐 `NovelBundleDTO` / `NovelRecoveryDTO`
  等 DTO 与 `electronAPI.novel.*` 接口
- **主进程 `user-handlers.ts` / `memo-handlers.ts`**：将此前散落在 `main.ts`
  的 user / memo 业务 IPC 全部抽出为独立 handler 模块，`main.ts` 回归
  「仅窗口生命周期 + 系统级」职责
- `db.ts` 新增 `getCurrentUserEmail()` 与 `initDb()` 内建 `user` 表，
  handler 不再依赖 `main.ts` 闭包变量

### Fixed
- **`pnpm build` 失败**：主进程打包时 rolldown 试图打包 `mammoth` / `docx`
  的传递依赖，撞上 pnpm 非扁平结构下 `core-util-is` 无法解析。
  `vite.config.ts` 的 electron `external` 补入 `mammoth` / `docx`
  （主进程 Node 运行时模块保持 require，不打入 bundle）

### Changed
- 删除 `src/windows/WorkerWindow/pages/NovelPage/services/novel-demo-source.ts`
  （演示数据源已被 DB 本地化取代）
- `AGENTS.md` 同步：handlers 模块表补齐 novel/user/memo 三模块；
  新增 WorkerWindow/NovelPage 数据层约定与崩溃恢复说明

### Verified
- `pnpm typecheck`（tsc -b，strict）：0 错误
- `pnpm lint`：0 错误（仅剩 `useHttpClient.ts` 既有 eslint-disable 警告）
- `pnpm test`：189/189 通过（15 个测试文件）
- `pnpm build`：渲染层 + 主进程 + preload 三段构建均通过

## [1.7.1] - 2026-09-20

### Added
- **备忘文章导入导出（.txt / .docx）**：导入文件选择器扩展为
  Markdown / TXT / DOCX 三种格式——txt 直读、docx 由主进程用 mammoth
  抽取段落文本，全部统一转存为 .md 备忘（重名自动追加序号，不再覆盖）；
  备忘列表头部新增导出下拉，可将当前选中的备忘导出为 TXT（markdown
  剥离标题 / 列表 / 引用 / 行内标记的纯文本）或 DOCX（docx 包生成，
  保留标题层级 / 无序列表 / 正文段落，保存位置由系统对话框决定）
- **新增 IPC 通道** `memo-export`，preload 与 `ElectronAPI` 类型同步暴露
  `memo.exportFile(filename, format)`
- **纯函数与单测**：`electron/memo-doc-utils.ts`（stripInlineMarkdown /
  collapseBlankLines / markdownToPlainText / markdownToDocxBlocks），
  vitest include 纳入 `electron/**/*.test.ts`

### Fixed
- **左栏拖拽相邻两章无法交换顺序**：`moveItemBefore` 先移除后插到
  `to-1`，当目标是被拖项的下一个相邻项时正好插回原位，顺序不变；
  改为移除后统一插在 `to`（向上拖 = 落在目标之前，向下拖 = 落在目标
  之后，相邻即交换），补齐相邻两方向的回归测试

### Changed
- **长列表全量虚拟化**（react-virtuoso）：左栏章节树扁平化为
  卷头行 + 章行（折叠状态提升到 ChapterTree，离屏行可安全卸载）、
  Ctrl+P 章节跳转面板（顺带把行内 `indexOf` O(n²) 序号改为 O(1) 查表，
  键盘移动光标自动滚入可视区）、全书检索命中列表、灵感速记卡片列表；
  BaseWindow 各列表此前已虚拟化，NewsList（固定 Top10）与 CodePage
  表格（分页）为有界列表无需处理

## [1.7.0] - 2026-09-20

### Added
- **大纲板升级为可编辑（R7）**：骨架改由真实卷 / 章派生（章节节点携带
  真实 chapterId，点击即跳转且高亮当前章，展示序号 / 字数 / 状态）；
  每章可写「一句话梗概」（行内编辑，Enter 保存 / Esc 取消 / IME 守卫，
  未改动不落库）；伏笔支持新增（可绑卷级或指定埋设章）、行内改名与说明、
  删除、待回收 ⇄ 已回收切换；卷头显示待回收计数，面板顶部汇总卷章数
- **灵感速记补齐（R7）**：行内编辑（Enter 保存 / Shift+Enter 换行 /
  Esc 取消）；置顶（置顶优先排序）；关键词过滤（计数切换为命中 / 总数）；
  **一键「转为伏笔」**——落到当前章所在卷并绑定当前章，写入后自动切到
  大纲面板，卡片标记「已转为伏笔」且不可重复转化
- **数据层占位接口**（对应未来 IPC）：`saveChapterOutline` / `saveOutlineEntry`
  / `removeOutlineEntry` / `saveNote` / `removeNote`，替换时页面层无需改动
- **纯函数与单测**：`buildOutlineTree`（卷章骨架 + 伏笔挂载 / 排序）、
  `sortNotes`、`filterNotes`、`firstLineTitle`、`buildForeshadowDraft`、
  `patchChapterOutlineNote` / `patchOutlineEntry` / `patchNote`
- **组件测试**：`OutlinePanel` 7 例、`InspirationPanel` 6 例，覆盖跳转 id、
  梗概与伏笔增删改、置顶、过滤、转伏笔与禁用态

### Changed
- **码字区栏宽改为按容器自适应**：正文栏以码字区实际宽度分档
  （<760px 吃满并收边距、≥900px 46em、≥1200px 50em、≥1500px 54em），
  宽屏不再把正文悬在正中、两侧空出 300px+ 白边，窄屏一行仍有 25~30 字
- **小屏自动让位**：可用宽度（窗口宽 − 当前已开栏宽）低于 560px 时自动
  收起左栏给码字区让位，窗口变宽自动还原；手动开合过左栏后本机制失效，
  改由用户决定
- `LAYOUT.autoCollapseWidth`（声明后从未使用）换成 `minStageWidth`，
  判据从「窗口宽度写死阈值」改为「窗口宽 − 已开栏宽」

### Fixed
- **大纲点击章节跳不到正文**：桩数据用「o-c7」这类假 id，与章节真实 id
  不通；现由真实卷章派生，章节节点自带 chapterId
- **新建章节时自动建卷的卷名写死「第一卷」**：卷头序号本就由 sort 派生，
  结果显示成「第一卷 · 第一卷」；改为存默认名「未命名卷」

## [1.6.10] - 2026-09-20

### Added
- **左栏双击快捷编辑章节名**：双击章节标题原位进入编辑（序号与状态圆点
  保持可见），Enter / 失焦保存、Esc 取消、IME 守卫，空名与同名不落；
  编辑态行渲染为 div，避免按钮嵌套输入框

### Changed
- **序号数字默认中文**：新会话默认「第一章 / 第一卷」样式（设置中仍可
  切回阿拉伯数字，与后缀自由组合）
- **卷名展示分隔符改为「·」**：命名后卷头显示「第一卷 · 风起云涌」
- **悬浮资料卡统一在文字下方展示**：移除触底翻转（flip）——此前中间
  段落的高亮词会从下到上缓动覆盖正文，现与首段行为一致，一律在词的
  下方展开

### Fixed
- **性格标签出现空白圆片**：历史数据「沉默寡言 · 重诺」这类分隔符带
  空格的格式，按「·」拆分后产生空白段直接渲染成空 chip；详情页与
  悬浮卡两处拆分均已 trim + 过滤空段

## [1.6.9] - 2026-09-20

### Added
- **卷命名**：左栏双击卷名进入编辑（「第2卷 - 风起云涌」），序号仍由 sort
  派生不受命名影响；默认名「未命名卷」只显示序号，Enter / 失焦保存、
  Esc 取消、IME 守卫，空名与同名不落
- **性格标签可编辑**：资料卡编辑态新增「性格」行（顿号 / 逗号分隔多标签），
  保存写入 `fields["性格"]`，只读态标签 chips 随之更新；清空即移除该字段
- **关联要素增删（R24 落地）**：详情页「关联要素」区支持——每行 hover
  显示 × 解除关联；「+ 添加关联」内联表单（下拉选目标要素 + 关系名，
  关系名留空记为「相关」）；同一对要素 + 同关系名不重复建，操作均有
  toast 反馈。数据走 NovelLink 多态关联表，为后期「一键生成人物关系
  网络图」预留结构（双向查询视图已就绪）

### Changed
- **支撑面板点击空白收起**：点击右栏内容区的空白处（列表未铺满的区域）
  即收起面板，与顶栏开合按钮等效；点击面板内内容不触发

## [1.6.8] - 2026-09-20

### Added
- **左栏底部「新卷」按钮**：一键在当前作品末尾追加一卷（默认名「未命名卷」，
  卷头展示序号随 sort 派生），配合拖拽把章节归入新卷
- **资料卡编辑**：详情页右上角「编辑」进入编辑态，支持修改名称、类型
  （六类可选）、别名（顿号 / 逗号分隔，自动去重且剔除与名称重复项）、
  一句话简介；名称必填，Esc 取消，切换查看对象自动退出编辑
- **出场章节升级为可跳转**：资料卡详情展示全部出场章节（不再截断前 6 个），
  每项为「序号标签 + 章节名」胶囊，点击即跳转该章；序号标签随
  「序号数字 + 章节后缀」配置实时派生（第3章 / 第三章…）
- **选区右键菜单标注**：选中正文后右键弹出标注菜单（替代原悬浮工具条）——
  上半部分按四类型一键新建资料卡，下半部分「绑定到现有资料卡」列表
  （已包含该称呼的卡禁用并标记「已绑定」），点击即把选中文本关联为
  该卡别名；菜单位置以鼠标为准并按菜单尺寸 clamp 在正文区内

### Changed
- **资料卡标注改走手动绑定路线**：选区标注由悬浮工具条改为右键菜单，
  识别与绑定完全由用户驱动；选区不再携带坐标（右键时以鼠标事件定位）
- SelectionToolbar 悬浮工具条组件下线，由 EntityContextMenu 接替

## [1.6.7] - 2026-09-20

### Changed
- **序号标签配置重组**：原「章节序号 / 卷名样式」组合预设拆为两个独立配置——
  「序号数字」（阿拉伯「第1章」/ 中文「第一章」）与「章节后缀 / 卷名后缀」，
  两者自由组合；后缀提供快捷项（章 / 张 / 回 / 节，卷 / 部 / 篇 / 集）并支持
  自定义输入，正文标题前缀、左栏卷头、防误触确认弹框实时跟随

## [1.6.6] - 2026-09-20

### Added
- **章节序号 / 卷名标签预设**：设置抽屉新增「章节序号」（第1章 / 第一章 /
  第1回 / 第一回 / Chapter 1）与「卷名样式」（第一卷 / 第1卷 / 第一部 /
  第1部 / Volume 1）便捷预设，选择即生效；序号是排序的派生属性，
  拖拽重排后自动跟随新样式
- **中文序号展示**：新增 `toChineseOrdinal`（1→一、12→十二、123→一百二十三、
  12345→一万二千三百四十五），预设中的中文样式据此渲染
- **防误触排序模式（默认开启）**：拖拽调整章节 / 卷顺序后，先弹确认框
  展示「谁的序号从几变成几」的完整变更清单，确认后才应用；可在设置关闭。
  重排计算抽为 `previewChapterReorder` 等纯函数，弹框预览与实际应用共用

### Fixed
- **跨卷拖拽到章节上未真正换卷**：`reorderChapters` 只回写了 `sort`，
  没有更新 `volumeId`，导致跨卷移动实际只改了序号（v1.6.2 引入的潜在缺陷，
  由新增单测捕获）

### Changed
- **左栏底部「排序」按钮与行内上下移按钮下线**：拖拽已成为唯一排序入口

## [1.6.5] - 2026-09-20

### Fixed
- **切换作品后无法创建第一章**：空作品（无卷无章）下 `createChapter` 因无
  目标卷直接返回 null——「写下第一章」永远失败。现无卷时自动创建「第一卷」；
  切换作品后旧的章节 id 不属于当前作品，已重置到该作品第一章
- **中文输入拼音候选期间字数按拼音递增**：IME 组合期间的文档中间态不再
  上报草稿与统计，确认（compositionend）后一次性上报最终文本，
  字数增量只按确认后的真实字数计算
- **设置抽屉打开后缺少关闭途径的感知**：抽屉本身关闭按钮正常，但无遮罩、
  点外部不关、顶栏齿轮只开不关。现补齐三种关闭方式：点抽屉外部（透明
  捕获层）、顶栏齿轮再点一次（toggle）、Esc 逐层关闭（设置 → 快照 → 专注）

### Changed
- 章节标题下方徽标只在「完稿」状态显示；草稿为默认态不再常驻显示

## [1.6.4] - 2026-09-20

### Improved
- **章节标题编辑输入框原地居中出现**：标题区为 column flex 布局，固定宽度的
  输入框此前落在交叉轴起点（最左侧），现显式 `align-items: center` 原地居中
- **章节序号改为排序的派生属性**：新增 `buildChapterNumbers` 全书连续编号
  （卷按 sort、卷内章按 sort），标题不再写死「第N章」前缀——左栏序号徽标与
  正文标题前缀均由序号派生，拖拽重排 / 跨卷移动后自动跟随变动；
  重命名只编辑章节名本身
- **标记要素后正文立即高亮**：词库 compartment 热更新时同事务携带
  `refreshAnnotation` 强制信号——此前标注插件不响应单纯的 facet 变化，
  新标记的词要等切章 / 滚动才出现高亮

## [1.6.3] - 2026-09-20

### Fixed
- **修复选区工具条 / 悬浮资料卡位置错误与超出视口**：坐标此前以编辑器 host
  （滚动容器内部）为基准计算，而弹层实际相对 `.nv-page__stage` 绝对定位——
  水平方向差正文栏内边距，垂直方向在滚动后 host 顶点变负导致弹层飘出可视区。
  现统一以 stage 为定位基准，并按弹层自身尺寸做边界 clamp（不再裁切出界）
- **修复切换章节后残留上一章正文高亮（闪一下才消失）**：外部灌文触发的标注层
  重建此前要走 300ms 防抖，旧 decoration 残留一个防抖周期。现在切章 / 回滚的
  灌文事务直接携带 `refreshAnnotation` 强制信号，标注层立即重建
  （连续输入的 300ms 防抖保持不变，不受影响）

### Added
- **章节名称可修改（PRD R1）**：点击正文区顶部章节标题进入编辑态，
  Enter / 失焦提交，Esc 取消，带 IME 组合输入守卫（拼音候选期间 Enter 不提交）；
  切换章节自动退出编辑态，避免标题草稿串章。数据层新增 `renameChapter`

## [1.6.2] - 2026-09-20

### Fixed
- **修复 NovelPage 正文编辑区完全不可用**：EditorPane 的 CodeMirror 初始化
  effect 只在首帧执行，而首帧时章节尚未加载（走空态分支、host 容器未挂载），
  编辑器实例永远不会创建，码字区空白无法输入。改为编辑器实例常驻渲染 +
  空态覆盖层（`__veil`），加载完成后即可正常输入
- **章节切换 / 快照回滚时撤销栈隔离**：外部灌入正文走
  `isolateHistory.of("full")`，避免 Ctrl+Z 跨章节回退出上一章正文（R2 撤销可靠性）

### Added
- **左栏拖拽排序（PRD R9）**：章节行与卷头均可拖拽——章节拖到章节上实现
  卷内重排或跨卷移动（落到目标章节位置），章节拖到卷头移入该卷末尾，
  卷拖到卷头重排卷顺序；drop 目标用 inset 阴影做指示线，颜色跟随主题变量。
  数据层新增 `reorderChapters` / `moveChapterToVolume` / `reorderVolumes`，
  排序算法抽为纯函数（`moveItemBefore` / `insertItemBefore` / `buildSortOrder`）
  并补充 5 组单测；原「排序模式」上下移按钮保留

## [1.6.1] - 2026-09-20

### Added
- **补建 `scripts/rebuild-native.mjs`（`pnpm electron:rebuild`）**：此前
  `package.json` 引用的 `scripts/rebuild-native.js` 文件缺失，该命令实际不可用。
  新脚本对 `better-sqlite3` 优先用 `prebuild-install -r electron` 下载与 Electron
  版本匹配的预编译二进制（命中缓存秒级完成，无需 MSVC 工具链），失败自动回退
  `@electron/rebuild` 源码编译；已端到端验证（exit 0）

### Fixed
- **修复 `pnpm dev` 主进程报 `better_sqlite3.node was compiled against
  NODE_MODULE_VERSION 127, requires 146`**：better-sqlite3 安装时下载的是系统
  Node ABI 的预编译包，Electron 42（ABI 146）加载即崩。执行
  `pnpm electron:rebuild` 重装 electron-v146 预编译二进制后恢复正常；
  以后升级 Electron 出现同类 ABI 报错直接跑该命令即可

### Changed
- **首页 news 提醒（右下角报纸）生命周期重构**：由「窗口生命周期内探测一次 +
  点击后永久消失」改为「**应用启动后展示一次，隔天 9 点重置状态后再展示一次**」。
  拉取成功（live）才展示，失败静默（下次进入首页或下个周期重试）；点击跳转
  资讯页后本周期内不再展示。实现为「周期 key」状态机（9 点前属昨天周期、
  9 点起属今天，状态随 key 翻转自动重置），抽取为
  `HomePage/hooks/usePosterVisibility.ts`，HomePage 仅保留渲染编排。
  新增 7 例单测：周期 key 9 点边界、live/非 live、点击后本周期静默、
  路由往返恢复、StrictMode 双挂载探测去重、隔天 9 点翻转重探

## [1.6.0] - 2026-09-19

### Added
- **WorkerWindow 改造为「CheckIn 小说编辑器」窗口**：新增窗口私有页面模块
  `src/windows/WorkerWindow/pages/NovelPage/`，按 PRD v0.4 与 UI 设计方案
  v0.4 落地 W1 主窗口（顶栏 44px / 左栏章节树 236px / 中央码字区 42em /
  右栏支撑面板 322px / 状态条 32px）、D1 快照抽屉、D2 设置抽屉、
  O1 Ctrl+P 章节跳转浮层、O2 悬浮资料卡、O3 选区标记工具条
- 码字区内核采用 **CodeMirror 6**（新增依赖 `codemirror` /
  `@codemirror/state` / `@codemirror/view` / `@codemirror/commands`）：
  虚拟滚动支撑三万字章节，IME 组合输入由内核原生处理
- 标注层扩展 `novel-editor.ts`：名称+别名白名单高亮，仅扫可视区，
  compositionstart 期间冻结计算、compositionend 与文档变化各 300ms 防抖，
  刷新走 `addToHistory(false)` 空事务不污染撤销栈（PRD §2 / 设计方案 §05）
- 右栏四支撑面板：大纲（卷/章/伏笔）、要素库（类型 chips + 卡片 + 详情，
  含自定义字段 / 关联要素 / 等级体系 / 出场章节）、灵感速记（Enter 提交 +
  IME 守卫）、全书检索（300ms 防抖 + 片段高亮）
- 数据层为占位实现：`pages/NovelPage/services/novel-demo-source.ts`
  按未来 IPC 的返回形态提供本地数据，`hooks/useNovelData.ts` 只依赖其函数签名，
  真数据接入时替换实现即可，页面与组件层无需改动
- `novel-utils.ts` 纯函数与 25 例单测：字数统计（含标点/纯汉字双口径）、
  词库构建、标注匹配、模糊检索、片段高亮
- **依赖链接自愈工具 `scripts/fix-pnpm-links.mjs`**：应对 pnpm 在 Windows 上
  把条目重命名为 `.ignored_*` 后搬迁中断、留下空壳且 `pnpm install` 不再自愈的
  问题。可重建断裂的顶层链接、清理 `.ignored` 空壳、纠正顶层误指向 peer 变体的
  链接（electron 的 `dist/` 二进制只在主变体，指到 peer 变体会「能 import
  但没二进制」）。配套 `pnpm check:deps`（体检，CI 可用）与
  `pnpm fix:deps`（应急修复），并挂在 `postinstall` 上自动体检

### Changed
- WorkerWindow 默认尺寸 720×520 → **1200×760**，最小 420×320 → **800×560**
- 移除 WorkerWindow 的 Esc 关窗（PRD §2 零打断原则）：Esc 现在只用于
  退出专注模式（F11 进入），关窗永不询问、由持久化兜底
- 锁定包管理器版本：`package.json` 新增 `"packageManager": "pnpm@11.25.0"`，
  避免跨 pnpm 大版本复用同一 `node_modules`（这是 `.ignored` 半损坏的诱因）

### Fixed
- **根治 `pnpm dev` 反复卡死**（自 1.4.7 起的老问题，此前归因均不准确）：
  根因是 Electron **42.4.1 已移除 `postinstall` 脚本**（实测 `pkg.scripts` 为
  undefined），二进制安装被推迟到首次 `require('electron')` ——`index.js` 会在
  require 的**同步调用栈里** spawnSync 跑 `install.js` 下载 ~140MB，且 **无超时、
  无进度、默认直连 github.com**，终端表现就是「卡住不动」。补充坑：`.npmrc` 的
  `electron_mirror` 只有在包管理器执行安装脚本时才会转成 `ELECTRON_MIRROR`，
  被 `index.js` 内部 spawn 时一个环境变量都没有。
  - 新增 `scripts/ensure-electron.mjs`：自行读取 `.npmrc` 镜像并**显式注入
    `ELECTRON_MIRROR`**，再带超时上限补装二进制；命中本地缓存时实测 **2.1s**
    （此前无镜像 >300s 无响应）
  - 挂到 `dev` / `dev:debug` / `dev:debug:log` / `electron:dev` / `postinstall`
    最前面，已装好时毫秒级返回，不影响启动手感
  - `scripts/start-electron.js` 补上此前只写在文档里、实际并不存在的 fail-fast
    守卫：二进制缺失时拒绝掉进无超时下载，直接输出修复指引
  - `start-electron.js` 额外剔除继承来的 `ELECTRON_RUN_AS_NODE` /
    `ELECTRON_NO_ATTACH_CONSOLE`：该变量会让 electron.exe 退化成普通 Node，
    `require('electron')` 返回路径字符串而非 API，主进程直接崩在
    `Cannot read properties of undefined (reading 'app')`（VS Code / WorkBuddy
    等 Electron 宿主的集成终端会泄漏该变量）
- 新增 `pnpm dev:doctor`（`scripts/dev-doctor.mjs`，**不能叫 `doctor`** —— 会被
  pnpm 自带的 `pnpm doctor` 内置命令吞掉）：体检关键依赖 + 实测 vite 能否在 5173
  提供服务 + 实测 wait-on 能否判定就绪 + **Electron GUI 冒烟测试**
- 诊断「`start-electron.js exited with code 1` 且零输出」的场景：Windows 上
  electron.exe 是 **GUI 子系统程序、不挂控制台**，连崩溃栈都看不到。改用「最小
  Electron 应用能否写出标记文件」作判据，`dev:doctor` 第 4 步给出明确结论，
  避免每次都靠猜
- **修复 Electron 解压不完整导致的秒退（本轮真正的元凶）**：`dist/electron.exe`
  与 `path.txt` 都在的情况下 Electron 仍在几十毫秒内 `exit(1)` 且零输出，原因是
  解压被中断后只剩 19 个根文件，**缺了 `locales/*.pak`（55 个 ICU 语言包）与
  `resources/default_app.asar`**（官方 zip 共 75 条目）。而 `install.js` 因
  `path.txt` 已写好而认定「已安装」，`pnpm install` 永远 Already up to date，
  不会自愈。`scripts/ensure-electron.mjs` 现在：
  - 体检新增 `dist/locales` 与 `dist/resources/default_app.asar` 两项
  - 识别出「仅这两项残缺」= 解压中断，**自动清空 dist 重新解压**（缓存命中约 2s）
  - `dev:doctor` 第 1 步同步加入这两项校验

## [1.5.0] - 2026-09-18

### Changed
- **HTTP 请求架构重构：主进程不再代理任何网络请求**。新增 `src/shared/http/`
  统一客户端（内部 `fetch` 封装，零第三方依赖），提供超时、重试（网络错误/5xx
  指数退避）、中断、错误归一（`HttpError`）、`{code,data}` 响应剥壳标准；
  各窗口按 `getScopedHttpClient(scope)` 持有独立实例，请求彼此隔离，
  页面卸载自动中断在途请求（`useHttpClient` / `abortScope`），
  多窗口高频请求不再影响主进程稳定性
- 移除 `http-request` IPC 通道与 `preload.httpRequest`（同步更新
  `src/shared/types/electron.d.ts`）；资讯与 Git 接口改为渲染进程直连
- 认证 Cookie 改为 session jar 播种：`ensureSessionCookie()` 一次性写入，
  请求带 `credentials: "include"` 由网络栈自动携带（Cookie 是 forbidden
  header，渲染进程无法手动设置）
- CORS 由主进程 session 级 `onHeadersReceived` 注入响应头放行（新文件
  `electron/httpSession.ts`），属启动期一次性注册，不参与逐请求链路

### Fixed
- 顺带消除主进程转发时代的 chunk 截断乱码隐患：响应改由 Chromium 网络栈
  按 UTF-8 解码（原 1.4.8 Buffer 契约随架构废弃）

## [1.4.8] - 2026-09-18

### Fixed
- 修复主进程 `http-request` 转发响应的中文/emoji 乱码：逐块 `data += chunk`
  隐式 utf8 解码会把跨 chunk 边界的多字节字符截成 U+FFFD（资讯标题
  "AI 🤖占比超九成" 的 emoji 被截成两个问号）。改为 Buffer 收集后
  `Buffer.concat(...).toString("utf8")` 统一解码

### Changed
- pnpm ≥10 兼容加固补全：`scripts/start-electron.js` 新增 fail-fast 守卫，
  electron 二进制缺失时直接输出修复指引（`pnpm install` / `pnpm rebuild
  electron`），不再以晦涩报错或静默卡住呈现；AGENTS.md 8.7 同步补充
  rebuild 修复路径与 http-request 编码契约

## [1.4.7] - 2026-09-18

### Fixed
- 修复 dev（StrictMode）下首页海报永不出现：探测标记在首次挂载即置位，StrictMode
  重挂载跳过订阅而首个挂载的回调又因 cleanup 判死，接口结果永远无法落到
  `setShowPoster`。改为模块级 Promise 缓存（同窗口仍只探测一次，每次挂载
  独立订阅），与 PosterWidget 的 loseContext 修复同属 StrictMode 双执行陷阱

### Changed
- 依赖管理加固：`package.json` 新增 `pnpm.onlyBuiltDependencies`
  （electron / better-sqlite3 / esbuild）——pnpm ≥10 默认拦截依赖构建脚本，
  新机器装完依赖 electron 二进制不会下载（dev 启动报缺二进制）；`.npmrc` 补
  `electron_builder_binaries_mirror`；AGENTS.md 新增 8.7「新机器环境搭建与依赖管理」
  （标准安装流程与 electron 二进制校验方法）

## [1.4.6] - 2026-09-18

### Added
- 代码记录页新增「查询当月」按钮（位于「查询」按钮后）：点击将日期范围自动选为
  本月 1 号至今日并立即查询，省去手动调整起止日期
  - 新增纯函数 `getThisMonthRange`（`code-utils.ts`）并补 3 条单测
    （月中 / 月初当天 / 跨年月切换）
  - `loadData` 支持显式传入日期区间（`setDateRange` 后同轮闭包读不到新 state，
    编程式查询必须带参）

### Verified
- `pnpm test`：91/91 通过（9 个测试文件）
- `pnpm typecheck`（tsc strict）：0 错误
- `pnpm lint`：0 错误（仅剩 CodePage 既有 exhaustive-deps 警告）

## [1.4.5] - 2026-09-18

### Added
- 新增「今日资讯」页（NewsPage，`/news`），承接首页海报与侧栏入口：
  - 左栏为今日热点 Top 10（热度前三按金/橙/铜高亮，热度固定条目右下角）
  - 右栏为摸鱼日报风格栏目：渐变日期卡（含农历）、打鱼状态与工作日徽标、
    周/月/年进度条、假期倒计时（≤1 天红标）、摸鱼计划表（当前时段背景高亮、
    单行省略）、每日语录
  - 侧栏导航最下方新增「资讯」入口
- 接入 60s API 真实数据源（数据层 `src/shared/services/news.ts`，首页探活与资讯页共用）：
  - `/v2/60s`（每天 60 秒读懂世界要闻）+ `/v2/moyu`（摸鱼日报进度/工作日/农历/语录）
    双端点并发，经主进程 `httpRequest` 转发防 CORS
  - 任一端点失败不影响另一端点；全部失败回退本地样例与本地文案，页面不空
- 首页海报改为**条件展示**：首次进入首页时探测一次新闻接口，成功才展示右下角海报；
  点击跳转资讯页后本窗口生命周期内不再出现；接口失败静默隐藏

### Fixed
- 修复 dev（React StrictMode）下海报完全不渲染：`dispose()` 不再调用
  `WEBGL_lose_context.loseContext()`——同一 canvas 重建时会拿到丢失上下文，
  导致着色器全部编译失败而静默降级
- 修复 midnight 主题下海报 NEWS 报头白字白底不可见（油墨色改为每主题固定深墨，
  新增纸色明度契约测试防回归），海报视觉同步现代化（无衬线报头、纸色去黄、噪点减半）
- 资讯真实接口无摘要/时间时不再渲染空摘要行与孤立分隔点

### Changed
- 首页海报显示尺寸缩小为 130×180（内部分辨率 260×360 超采样不变），
  不再遮挡统计卡与功能卡

### Verified
- `pnpm test`：88/88 通过（9 个测试文件；NewsPage 新增 15 条：假期倒计时边界、
  60s API 映射/兜底/单端点失败隔离/live 标识；海报新增纸色明度契约）
- `pnpm typecheck`（tsc strict）：0 错误（清 tsbuildinfo 缓存后全量确认）
- `pnpm lint`：0 错误（仅剩 CodePage 既有 exhaustive-deps 警告）

## [1.4.4] - 2026-09-18

### Added
- 新增首页右下角海报装饰件

### Verified
- `pnpm test`：72/72 通过（8 个测试文件，PosterWidget 新增 9 条：色板解析 4、
  手感/贴图契约 3、引擎降级与组件卸载 2）
- `pnpm typecheck`（tsc -b，strict 开启）：0 错误
- `pnpm lint`：0 错误（仅剩 CodePage 既有 exhaustive-deps 警告）
- `vite build` 通过

## [1.4.3] - 2026-09-17

### Added
- 首页「新建待办」支持快捷建立工时：输入内容后追加 `#2h` 即可同时写入工时
  （支持小数 `#1.5h`、大小写 `#2H`、`# 2 h` 等写法）。
  - 复用待办页的 `parseWorkHourTag`，两个入口行为完全一致，不新增第二套语法
  - 弹窗内实时预览解析结果（将记录工时 `2h` + 清洗后的内容），未输入标签时给出语法提示
- Todo 子项排序：**未完成子项排前面、已完成子项沉底**，同组内保持原有顺序
  - 新增纯函数 `sortChildrenByDone`（`todo-utils.ts`），全未完成 / 全已完成时短路复用原数组引用，避免无谓重渲染
  - 补齐 7 条单测覆盖沉底、稳定性、短路与不可变性

### Fixed
- 修复日程页**窗口拖拽 resize 时日期组件高度不变导致变形**（格子被拉成扁矩形）：
  - 根因是循环依赖：`.calendar-panel` 是 flex 容器，`.calendar-grid` 的 `flex: 1`
    只是 `flex-basis: 0`，其高度取决于内容；而内容高度又由格子宽度经
    `aspect-ratio: 1` 反推。窗口纵向拖拽时这条链不会重算，格子高度被冻结在旧值
  - 改为 grid 行高 `1fr`（`grid-auto-rows: 1fr`）平分面板高度，格子本身不再设宽高，
    彻底移除 `aspect-ratio` —— 高度由 grid 直接算出，resize 时必然跟随
  - 日历区新增 `.calendar-scroll` 滚动容器 + `min-height: 264px` 下限：
    窗口压得过矮时改为滚动，而不是把格子继续压扁到不可读
- 修复**窗口边缘残留直角阴影**（截图红框处四角与边缘的淡色直角）：
  - 根因：`.window-shell` 满视口，其常规（非 inset）`box-shadow` 全部落在元素矩形之外，
    被窗口的方形边界裁掉，只剩沿直角边缘的一圈残影
  - 改为 `inset` 内阴影：投影画进窗口内部，圆角处自然跟随 `border-radius` 收边
  - `--app-shadow-window` 同步从 `0 8px 32px rgba(...)` 改为 inset 形式，四套主题各自校准深浅
- 日程页高度不再使用 `calc(100% - 48px)` 魔法数，改为 `flex: 1` 吃满 `.page` 剩余高度，
  与 `Page` 的 flex 列布局对齐（此前该值在导航头部高度变化时即失配）

### Removed
- 移除首页底部的**账号管理卡片条**（头像 + 邮箱 + 「修改」入口）：
  账号信息统一从侧边栏「我的」进入，避免首页出现第二个冗余入口。
  同时清理 `.home-page__user*` / `__avatar` 共 5 组样式

### Verified
- `pnpm test`：63/63 通过（6 个测试文件，新增 `sortChildrenByDone` 7 条用例）
- `pnpm typecheck`（tsc -b，strict 开启）：0 错误
- `pnpm lint`：0 错误（仅剩 CodePage 既有 exhaustive-deps 警告）
- `vite build` 通过

## [1.4.2] - 2026-09-17

### Changed
- 首页侧边栏改为方案二的**圆角浮动**形态（此前是贴左边缘 + 右边框的实心栏）：
  - 去掉 `border-right`，改为 20px 圆角 + 软投影 + 主题描边
  - `.home-page` 四周留白 12px、栏间距 12px，让侧栏与内容区都浮在 `--app-bg` 之上
  - 内容区内边距由 20/24 拆为「外层 12 + 内层补 8/12」，总留白与改版前一致
  - 侧栏宽度 76 → 72px，导航项 60 → 56px
- WorkerWindow 入口从右下角悬浮按钮**集成进侧边栏底部**（主题切换器上方，中间用分隔线隔开）：
  - `WorkerFloatButton` 新增 `variant`：`float`（右下角悬浮圆钮，默认）/ `inline`（36px 圆角图标钮，不脱离文档流）
  - 类名由 `worker-float-btn` 统一为 `worker-btn` + `--float` / `--inline`
  - 首页不再有两个悬浮入口

### Fixed
- 修复窗口圆角在桌面底色接近时**显示为方角**（两处根因，先后修复）：
  - `roundedCorners: true` 在 Windows 上让 DWM 按**固定 8px** 系统圆角裁剪窗口，
    把 CSS 画的 12px 圆角和描边的四角切掉，四角只剩一段弧度很小、接近直角的边缘，
    叠加透明区透出的桌面浅色，表现为「圆角外还有一圈淡淡的直角底」→ 改为 `roundedCorners: false`，
    圆角完全交给 CSS
  - 根因是圆角外为透明（露出桌面壁纸），而描边用的是主题色 `--app-border`
    （如 aurora 的 `#e2e6f4`），在浅色桌面上几乎不可见
  - `.window-shell` 描边改为**刻意不跟随主题**的中性双层描边：
    外层 `rgba(0,0,0,0.12)`（浅色桌面）+ 内层 inset `rgba(255,255,255,0.1)`（深色桌面），
    保证四种「桌面深浅 × 主题深浅」组合下圆角轮廓都可见

### Verified
- `pnpm test`：56/56 通过
- `pnpm typecheck`（tsc -b，strict 开启）：0 错误
- `pnpm lint`：0 错误（仅剩 CodePage 既有 exhaustive-deps 警告）
- `vite build` 通过

## [1.4.1] - 2026-09-17

### Changed
- 主题色值枚举扩充至 55 项（较 1.4.0 增加 14 项），四套主题保持同一变量集合：
  - 新增底色 `surface-active`（按下态）、`sidebar-bg`、`input-bg`、`splitter`（分隔线）
  - 新增文本 `text-disabled`；主色新增 `primary-active`（按下态）
  - 新增语义色 8 项：`success` / `warning` / `error` / `info` 及各自的 `-weak` 弱底
  - antd token 同步补齐 `colorTextDisabled` / `colorSplit` / `colorSuccess` / `colorWarning` /
    `colorError` / `colorInfo` / `colorLink`，弹层与表单不再沿用 antd 默认蓝
- 全量页面样式变量化，消除暗色主题下的割裂（此前仅共享层接入主题，业务页仍为浅色硬编码）：
  - Todo：`TodoListItem` / `TodoOutlineSidebar` / `TodoSection` / `TodoToolbar`
  - Memo：`MemoPage` / `MemoSidebar` / `MemoListItem` / `MemoHeader` / `MemoEditor` / `MemoPreview`
  - Daily：`index.scss` 日历面板与时间带的白底、分割线、选中态全部改为主题变量
  - Code：趋势图基线、柱体、数值与日期文字改为主题变量
  - 共享：`WorkerFloatButton` 改用 `--app-primary` 系列与主题阴影；`ThemeSwitcher` 色块描边改用 `--app-border-strong`
  - TSX 内联色一并收敛（`CodePage` 增减行/统计值、`TodoOutlineSidebar` 分组色、
    `MemoListItem` 图标色、`TodoToolbar` 搜索图标、活动提醒默认色）
- `shared/styles/variables.scss` 标注颜色变量已废弃：新样式一律用 `--app-*`，避免暗色下残留浅色

### Removed
- 移除 `WindowHeader` 与 `LoginWindow` 的主题切换器：主题切换入口统一收敛到首页侧边栏底部，
  避免同一功能在多处出现且与窗口标题栏职责混淆

### Verified
- `pnpm test`：56/56 通过（6 个测试文件，含四套主题变量集合一致性校验）
- `pnpm typecheck`（tsc -b，strict 开启）：0 错误
- `pnpm lint`：0 错误（仅剩 CodePage 既有 exhaustive-deps 警告）
- `vite build` 通过

## [1.4.0] - 2026-09-17

### Added
- 新增四套主题（柔雾紫蓝 aurora / 奶油暖橘 cream / 薄荷清新 mint / 月夜暗色 midnight）
  - `shared/styles/themes.scss` 统一 `--app-*` CSS 变量（底色、描边、文本、主色、强调色、圆角、阴影、滚动条），
    业务样式一律写 `var(--app-*)`，切换 `<html data-theme>` 即整体换肤
  - `shared/theme/` 主题模块：`themes.ts`（主题清单与 antd 色板）、`theme-storage.ts`（读写/落盘/首帧初始化）、
    `ThemeProvider.tsx`（内聚 ConfigProvider，暗色走 `darkAlgorithm`）、`theme-context.ts`（`useTheme`）
- 新增 `shared/components/ThemeSwitcher/`：色块式主题切换器，切换后写 localStorage 并通过
  `windowAPI.broadcast('theme-changed')` 广播，三个窗口实时同步
  - 主窗口 / Worker 窗口挂在 `WindowHeader` 右侧；登录窗口无标题栏，固定在右上角
- 首页改造为侧边导航布局：图标导航栏 + 问候/搜索 + 快捷操作行（含首页直建待办）+ 数据概览 + 功能卡网格 + 用户信息横条
  - 数据概览取真实数据：待办未完成数、今日代码产出、备忘篇数、本月打卡天数（任一项失败只该项显示「—」）
- 新增 15 个主题单测（`themes.test.ts` / `theme-storage.test.ts`），其中一项校验
  `THEME_LIST` 与 `themes.scss` 的变量集合完全一致，防止新增主题漏写变量导致换肤后局部掉色

### Changed
- 三个窗口入口统一接入 `ThemeProvider`（内部已含 ConfigProvider），并在 `createRoot` 前调用
  `initThemeFromStorage()`，避免暗色主题首帧白闪
- 共享样式变量化：`window-shell.scss`、`NavHeader`、`WindowHeader`、Login/Worker/Base 的 `index.scss`
  全部改用主题变量，移除硬编码色值
- `HomePage` 业务逻辑下沉到 `hooks/useHomeOverview.ts`（数据）与 `hooks/useHomeActions.ts`（交互），
  卡片拆为 `components/HomeSidebar` / `components/HomeStats` / `components/FeatureCard`

### Removed
- 移除 `shared/styles/antd-theme.ts`：其职责已由 `ThemeProvider` 接管，避免两套 ConfigProvider 配置并存

### Verified
- `pnpm test`：56/56 通过（6 个测试文件）
- `pnpm typecheck`（tsc -b，strict 开启）：0 错误
- `pnpm lint`：0 错误（仅剩 CodePage 既有 exhaustive-deps 警告）
- `vite build` 通过，主题样式随各窗口 chunk 正确产出

## [1.3.0] - 2026-09-17

### Added
- 新增单元测试能力（vitest 4 + @testing-library/react + jsdom）
  - 新增 `vitest.config.ts`（独立于 `vite.config.ts`，测试环境不引入 Electron 插件）与 `vitest.setup.ts`
  - 新增 `pnpm test`（全量运行）与 `pnpm test:watch`（watch 模式）
  - 新增 41 个单元测试：`todo-utils`（工时标签解析/格式化）、`memo-utils`（HTML 转义/搜索高亮）、`code-utils`（工作日/节假日/调休计算）、`daily`（时间换算），测试文件与被测代码同目录就近存放
  - `AGENTS.md` 新增「6.6 单元测试规范」与「8.7 修改与交付检查」：修改功能前后必须运行对应单测，防止修复引入回归
- `tsconfig.app.json` / `tsconfig.node.json` 开启 `strict` 模式，全量代码零错误通过

### Changed
- `shared/services/code.ts` 的 Git Webhook 请求由渲染进程 `fetch` 改走主进程 `httpRequest`
  - `Cookie` 是浏览器 forbidden request header，渲染进程设置会被静默忽略导致请求未认证；主进程 `https.request` 可正常携带
- `typecheck` 脚本由 `tsc --noEmit` 修正为 `tsc -b`：根 tsconfig 为 solution-style（`files: []`），原命令实际未检查任何文件
- `AGENTS.md` 同步现状：登记 `WorkerWindow` 窗口与 `electron/handlers/` 拆分；页面表更新为分层 hooks（Todo/Memo/Daily/Code）；技术债务表移除已解决项
- ESLint 重新开启 `react-hooks/exhaustive-deps` 并修复全部 5 处警告（`useCodePage` 的 `loadMonthOutput`/`loadData` useCallback 化、`useTodoEditorState` 解构稳定引用）
- **性能优化**：`useCodePage` 的 `summaryStats` 统计由每次渲染重算改为 `useMemo`（数据最多 9999 条，此前每次 Table 渲染都全量 reduce）

### Fixed
- 修复 Memo 搜索高亮破坏 HTML 实体的问题：搜索词含 `&` / `<` 等字符时会命中转义实体（如 `&amp;`）的中间片段，把 `&amp;` 切断为 `&` + `amp;`；现在搜索词先做 HTML 转义再匹配，`<mark>` 始终包裹完整实体
- 修复 `window-broadcast` 不识别 Worker 窗口的问题：发送者名称只匹配 main/login，Worker 窗口广播时不会排除自己；改为 `windowManager.getNameOf()` 按实例反查
- 统一 `activitiesTask` 轮询间隔：启动 30s、睡眠唤醒恢复后 10s 且注释互相矛盾，收敛为常量 `POLL_INTERVAL_MS = 30s`（恢复时立即检查一次，不丢通知）
- `LoginWindow/main.tsx` 导入路径统一为 `@/` 别名（原为相对路径，与其他窗口不一致）

### Removed
- 移除 `todo-utils.ts` 中无任何使用方的 `getTotalRemainingWorkHour`（O(n²) 递归实现，`useTodoData` 已有 Map 索引版同逻辑）

### Verified
- `pnpm test`：41/41 通过（4 个测试文件）
- `pnpm typecheck`（tsc -b，strict 开启）：0 错误
- `pnpm lint`：0 错误、0 警告

## [1.2.0] - 2026-09-16

### Added
- 新增 `WorkerWindow` 临时工作窗口
  - 独立窗口目录 `src/windows/WorkerWindow/`，与其他窗口保持隔离，互不导入
  - 标准窗口行为：显示在任务栏，标题栏由通用 `WindowHeader` 提供（拖动 + 最小化/最大化/关闭），支持 `Esc` 快捷关闭
  - 不拦截 close 事件，关闭即随实例销毁，重新打开即全新实例
  - 重复触发打开时聚焦已有实例，避免重复创建
- 主页右下角新增 `WorkerFloatButton` 悬浮按钮，点击打开 Worker 窗口
  - 挂载于 `HomePage` 内，仅主页展示，切换到子页面后不再出现
  - 悬浮按钮沿用项目性能规范，仅过渡 `transform` / `box-shadow` / `background-color`
- 新增通用 `WindowHeader` 窗口级标题栏组件（`shared/components/WindowHeader/`）
  - 整条标题栏为拖动区，右侧提供最小化 / 最大化(还原) / 关闭三个控制按钮，支持可选 `title` / `icon` 标题
  - 主窗口与 Worker 窗口均已接入：BaseWindow 不传标题（页面有自己的头部），Worker 传 `title="Worker"`
  - 最大化状态由主进程推送（`window-maximize-state`），挂载时主动查询一次，图标随状态切换
  - 最大化时 `<html>` 挂 `is-window-maximized` 类，`.window-shell` 自动切换为方角（避免屏幕四角露出透明缺口）
  - 双击标题栏可直接切换最大化（Electron 拖动区的系统行为）
  - 新增 `window-control` / `window-maximize-query` IPC 通道；`window-control` 的 payload 为动作字符串本身；`close` 走 `win.close()`，由各窗口自身 close 语义决定行为（主窗口隐藏到托盘）
  - `preload.receive` 现返回取消订阅函数，组件卸载时可移除监听，避免重复注册
- 新增本地调试便捷入口
  - `Ctrl+Shift+I` / `F12` 可随时切换 DevTools（主窗口、登录窗口、Worker 窗口均支持）
  - 应用级 `globalShortcut` 兜底，窗口失焦时仍可唤出调试面板
  - 新增 `pnpm dev:debug`（启动即开 DevTools）与 `pnpm dev:debug:log`（附带主进程轮询日志）
  - 支持 `VITE_DEVTOOLS_MODE` 控制 DevTools 打开方式（默认 `detach` 独立窗口）

### Changed
- **性能优化**：路由级懒加载，`BaseWindow/App.tsx` 六个页面改为 `lazy()` + `Suspense`
  - 入口 chunk 由整体体积降至 46KB，`DailyPage`(307KB)、`TodoPage`(148KB) 转为按需加载
- **性能优化**：antd 主题开启 `cssVar` 变量模式并关闭 `hashed`
  - antd 样式表体积从数百 KB 降至约 3KB
- **性能优化**：列表渲染链路优化
  - `TodoListItem`、`TodoSection`、`TodoOutlineSidebar` 增加 `memo()`，稳定回调引用
  - `TodoPage` 将 `data`/`editor`/`view` 收敛至 ref，避免 Virtuoso 全量重渲染
  - `renderItem`、`itemContent`、`groupContent` 全部改用 `useCallback` 固定引用
- **性能优化**：数据计算去重与索引化
  - `useTodoData` 剩余工时递归由 `Array.find` 改为 `Map` 索引，消除 O(n²)
  - `TodoOutlineSidebar` 组偏移量由 `slice + reduce` 改为预计算前缀和
  - `useTodoViewState` 复用 `previousDoneRef` Map，不再每次重建
  - `DailyPage` 农历与节日结果增加模块级缓存，避免每次渲染重复计算 42+ 次
- **性能优化**：动画属性改为仅使用合成层属性
  - 大纲收起由过渡 `width` 改为 `transform: translateX()`，消除布局抖动
  - Todo 分区折叠移除 `flex` / `max-height` 过渡，仅保留 `opacity`
  - `todo-flash` 由 `background` 改为 `box-shadow`，`todo-enter` 时长收紧
  - 首页 `BorderBeam` 默认暂停动画，指针进入才播放，空闲时零动画开销
- **性能优化**：Memo 编辑器输入路径优化
  - `highlightText` 在无搜索词时短路返回，避免每次按键对全文执行 `escapeHtml`
  - `MemoPreview` 代码块按钮重构 effect 依赖收窄至 `html`
- **窗口外观**：三个窗口（BaseWindow / LoginWindow / WorkerWindow）统一改为圆角窗口
  - 主进程侧抽出 `ROUNDED_WINDOW_OPTIONS`，统一应用 `frame: false` + `transparent: true` + `backgroundColor: "#00000000"` + `hasShadow: false` + `roundedCorners: true`
  - 抽出 `createWebPreferences()`，避免三处 `webPreferences` 重复定义
  - 新增共享样式 `src/shared/styles/window-shell.scss`（`$window-radius: 12px`），提供 `.window-shell` / `.window-shell__body` 外壳，负责圆角、边框与投影
  - 三个窗口的 `index.html` 根节点统一加 `class="has-window-shell"`，`body` / `#root` 背景改为 `transparent`，圆角交由外壳绘制
  - 拖动区适配：`NavHeader`（主窗口）、`.login-window`（登录窗口）、`.worker-titlebar`（Worker 窗口）声明 `-webkit-app-region: drag`，内部可点击元素补 `no-drag`；窗口整体圆角继承自外壳（`border-radius: inherit`）
- `CodePage` 表格 `columns` 提升为模块级常量，避免每次渲染重建
- `scripts/start-electron.js` 显式透传 `VITE_OPEN_DEVTOOLS` 与 `VITE_DEVTOOLS_MODE`
- `activitiesTask` 高频日志收敛至 `debugLog()`，由 `CHECKIN_ACTIVITY_DEBUG=1` 控制

### Fixed
- 修复上一轮性能优化引入的 Todo 交互失效问题
  - `renderItem` 把 `editingId` / `childInputFor` / `flashIds` / `enterIds` 等显示状态藏进 ref，
    依赖里只剩稳定 handler，导致点击「新增子项」、双击编辑等纯 UI 状态变化不产生任何新 props，
    Virtuoso 不重渲染可见行——按钮看似无效，直到下一次数据变化（如保存备注）才把滞留状态一次性吐出
  - 修复：显示状态改为 `renderItem` 的真实依赖（基础类型/Set 引用，仅状态变化时重建），
    数据 handler 仍走 ref 保持稳定；Esc 关闭输入框等交互随之恢复正常
- 修复 WindowHeader 控制按钮在不带标题的窗口（BaseWindow）下显示在左侧的问题
  - `space-between` 布局在唯一子元素时落在起点，`.window-header__controls` 补 `margin-left: auto` 保证始终靠右
- 修复主窗口从托盘恢复时闪烁的问题
  - 透明窗口（`transparent: true`）在 `hide()` → `show()` 切换时 Chromium 重放窗口动画导致可见闪烁（Electron/Chromium 已知渲染问题）
  - Windows 下禁用窗口管理器动画：`app.commandLine.appendSwitch("wm-window-animations-disabled")`
- 修复 WindowHeader 三个控制按钮点击无效的问题
  - 渲染层发送 `{ action }` 对象，主进程 `switch` 按字符串匹配导致永远不命中
  - 统一约定：`window-control` 的 payload 为动作字符串本身，主进程同时兼容两种形式
- 修复主窗口主页无法拖动的问题
  - 根因：HomePage 自带头部不含拖动区，NavHeader 仅存在于子页面，主页没有任何可拖动区域
  - `NavHeader` 回归纯页面级头部（移除 `-webkit-app-region` 拖动声明），窗口拖动职责上移至 `WindowHeader`
- 修复引入窗口标题栏后页面高度溢出的问题
  - WindowHeader 占用 34px 后 `.window-shell__body` 不再等于视口高度，
    `Page`、HomePage、`app-route-fallback` 由 `100vh` 改为 `100%`，
    DailyPage / TodoPage 的 `calc(100vh - Xpx)` 同步改为 `calc(100% - Xpx)`，避免页面底部被裁剪 34px
- 修复在渲染期写 ref 的隐患（`TodoPage`、`useTodoData`、`MemoPreview` 三处）
  - React 19 并发渲染下，被丢弃的渲染可能将 ref 写入过期数据，导致难复现的状态不一致
  - 统一改为在 `useEffect` 中同步 ref
- 修复新增任务的入场动画定时器未清理导致的卸载后 setState 问题
- 修复 `useDailyPage` 的 `refreshData` 未记忆化导致每次渲染重复拉取数据的问题
- 修复 `TodoOutlineSidebar` 在大纲条目缺失时可能读取空对象属性的问题

### Verified
- `npx tsc --noEmit`、`npx eslint src electron scripts`、`npm run build` 均通过
- 构建产物确认三个 HTML 入口齐全：`BaseWindow/index.html`、`LoginWindow/index.html`、`WorkerWindow/index.html`

## [1.1.0] - 2026-09-15

### Changed
- Memo 文件列表支持双击文件名进入输入框并重命名文件。
- **状态管理规范落地**：TodoPage 和 MemoPage 直接组合分层 Hook，并将页面局部交互状态与复制逻辑下沉到直接使用组件。
- **开发规范**：补充状态管理约束，要求 Hook 状态优先在直接使用组件中消费，减少不必要的父组件状态透传。
- **架构重构**：将所有数据库操作从渲染进程迁移至主进程，消除 SQL 注入风险
  - 新增语义化 IPC 通道：`activity-list/add/update/delete`、`todo-list/add/update/toggle` 等
  - 移除通用 `db-all/get/run/exec` 通道，渲染进程不再直接传递 SQL
  - 主进程 handlers 模块化管理：`electron/handlers/activity-handlers.ts`、`electron/handlers/todo-handlers.ts`
- **窗口管理**：引入 `WindowManager` 统一管理所有窗口实例
  - 替换散落的 `mainWindow`/`loginWindow` 模块级变量
  - 支持跨窗口通信：`windowAPI.broadcast()`、`windowAPI.sendTo()`
  - 活动提醒改用 `windowManager.broadcast('activity-notify', ...)` 广播
- **类型定义**：重构 `electron.d.ts`，新增 `activity`、`todo`、`windowAPI` 语义化接口

### Removed
- 删除 `src/windows/BaseWindow/pages/TodoPage/todo-db.ts`（类型已迁移至 `types.ts`，初始化逻辑已在主进程完成）

### Added
- 新增 Memo 页面左侧文件列表名称支持双击修改
- Todo 备注支持点击复制，并在复制成功后显示短暂提示。
- 优化 Todo 标题和备注的长文本展示，超过可配置字数后省略，并可通过悬停查看全文。

### Fixed
- 修复开发模式自动打开 DevTools 导致页面渲染和弹窗响应明显变慢的问题，保留 `VITE_OPEN_DEVTOOLS=1` 调试开关。
- 优化 Todo 列表渲染：稳定数据与编辑状态回调，缓存子任务索引和剩余工时，减少列表项重复计算与重渲染。
- 修复 Todo 分区展开时已完成列表被卸载并从顶部闪动收缩的问题，保留列表位置并平滑过渡内容高度。
- 修复编辑 Todo 标题时未输入工时标签会清空原工时的问题，并确保备注、完成状态和特别关注等附属信息保持不变。
- 修复 Markdown 预览中单个 Enter 换行被合并为同一行的问题。
- 将 Todo 单项递归渲染逻辑抽离为独立的 `TodoListItem` 组件。
- 拆分 Todo 页面数据、编辑状态和视图状态，降低 `useTodoPage` 与页面组件的职责耦合。
- 移除仅负责转发的 `TodoModals` 包装组件，直接在 TodoPage 中使用备注和工时弹窗。
- 按通用页面规范拆分 MemoPage 的数据、编辑和视图状态，收缩 `useMemoPage` 为组合层。

## [1.0.2] - 2026-09-15

### Fixed
- 修复 Todo 子任务输入框在中文输入法（IME）下被提前提交或失焦的问题。
- 修复新增任务输入框在中文输入时被误触发 Enter / Blur 导致拼音中断的问题。
- 为新建任务和子任务输入框增加 composition 状态保护，避免中文输入过程被中断。
- 验证通过：`pnpm exec tsc -p tsconfig.app.json --noEmit`。
