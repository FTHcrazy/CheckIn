# Changelog · 1.34.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

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
