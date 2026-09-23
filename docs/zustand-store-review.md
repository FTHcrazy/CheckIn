# Zustand 减重渲染 Review（全项目）

> 评审范围：`src/` 全部 3 个窗口 + `AGENTS.md` 约束
> 技术依据：React 19 渲染模型 + zustand v5 selector 订阅
> 结论口径：只列「改用 store 后确实能少渲染组件」的点，**不推荐为了用而用**

## 0. 现状

| 项 | 结果 |
|---|---|
| 依赖 | `zustand ^5.0.15` 已在 `package.json` dependencies（未装到 node_modules，需 `pnpm install`） |
| 已落地 store | **7+ 处**（截至 1.16.0）：NovelPage 4 个（`useSearchStore`/`useHoverStore`/`useAppearanceStore`/`useNovelEditorStore`）、MemoPage 2 个（`useMemoStore`/`useMemoSearchStore`）、LedgerPage 1 个（`useLedgerViewStore`）；CodePage 走 `useCodePage` 显式调度（未单独立 store 文件） |
| 落地范式 | runner 注册 + store 内防抖调度 + 请求票据 —— 这是本项目应当沿用的标准写法 |
| 其余所有页面 | 全部走「页面根 Hook 聚合 → props 透传」 |

`AGENTS.md` §6.2 已给出 store 的三个准入信号（回调入 deps / 父层重渲染冲掉子层结果 / 面板卸载丢状态）。
本次 review 用这三条逐页核对，命中 **7 处**，另有 2 处「看起来该改、实测不该改」。

---

## 1. 评分维度

- **触发频率**：打字 / 悬停 / 拖拽 / 自动保存 = 每秒数十次；筛选输入 = 每键一次；路由切换 = 每次导航
- **波及面**（每次触发被迫重渲染的组件数，按代码结构估算）
- **props 能否自救**：切成兄弟组件还是否需要一个共同 state 持有者 —— 不能自救的才是 store 的真收益区

---

## 2. P0：打字即全屏重渲染（最高优先）

### P0-1 NovelPage：敲一个字，整棵编辑器树重渲染

**位置**：`NovelPage/hooks/useNovelEditorState.ts:27,86-88` → `hooks/useNovelPage.ts:69-73` → `NovelPage.tsx:45-103`

```ts
// useNovelEditorState.ts:27 —— draft 的唯一持有者就在这一层
const [draftMap, setDraftMap] = useState<Record<string, string>>({});
// :86-88 content 由此派生 → 每次按键都是新引用
```

**链路**：按键 → `setDraftMap` → `content` 变 → `useNovelPage()` 返回值整体变化 → `NovelPage.tsx:232-452` 全树重渲染。

受波及但与 `content` **完全无关**的组件（全部未 memo）：

| 组件 | 说明 |
|---|---|
| `ChapterTree` | 上百卷章节点；即使 Virtual 列表也得重建每行的 React 元素 |
| `SupportPanel` | 要素/灵感/大纲/检索/起名五个面板，`<SupportPanel open={view.rightOpen}>` 即便折叠也照渲染 |
| `NovelTopBar` | 作品下拉 + 8 个导出菜单项 |
| `SnapshotDrawer` / `SettingsDrawer` / `ChapterJumpPalette` / `ReorderConfirmModal` | 均为 `open=false` 的常驻抽屉/弹框 |

同时 `useNovelPage.ts` 里的 `terms / breadcrumb / outline / appearanceCounts / workMeta / namingExclude / namingFavorites` 全部以 `data`、`settings` 为依赖；`data` 来自 `useNovelData()`，其返回对象每次渲染都是**新对象字面量**（`useNovelData.ts:1236-1303`），因此这些 `useMemo` 在 data 引用变化时会被整体击穿。

**波及面**：估算每次按键 ≈ 20-30 个组件（长篇>`100` 章时 ChapterTree 单项上量）。

**为什么 props 自救不了**：`content` 的唯一持有者是改不改都在页面根的三个 Hook 组合层，任何「拆兄弟组件」都只是把 state 往上再抬一层。**只有把状态搬到组件外的 store，才能让 EditorPane 单独订阅 `content`。**

**改法**：
```ts
// NovelPage/store/useNovelEditorStore.ts（沿用 useSearchStore 的 runner 范式）
export const useEditorStore = create<EditorState>()(...);
// EditorPane/StatusBar：const content = useEditorStore(s => s.draft[aId] ?? "");
// ChapterTree/SupportPanel/NovelTopBar：不订阅 → 打字时零重渲染
```
预计：打字重渲染组件数 **20-30 → 2（`EditorPane` 壳 + `StatusBar`）**。

---

### P0-2 NovelPage：鼠标悬停术语，每秒数十次全树重渲染

**位置**：`NovelPage/hooks/useEntityHover.ts:39-49`，被 `EditorPane/index.tsx:434-455` 的 `mousemove` 驱动

```ts
// useEntityHover.ts:42 —— 卡片已显示时，每次 mousemove 都更新 x/y
setTarget((current) => (current ? { ...current, x, y } : null));
```

`EditorPane` 的 `handleMove` 在指针**停留在高亮词上移动时持续触发** → `setTarget` 产生新对象 → `hover.target` 变化 → `NovelPage` 全树重渲染。
此外 `handleSelectChapter`（`:208-214`）与 `handleOpenEntity`（`:456-462`）都会调 `hover.dismiss()`，点一次正文/要素卡同样推整整棵树。

**波及面**：悬停期间 ≈ **每秒 20-60 次** × 20-30 个组件（等同 P0-1 的整棵树）。

**为什么 props 自救不了**：同 P0-1 —— hover 是「横向关注点」，它被 MainTree 之外的组件（`HoverEntityCard`）消费，但触发点在 `EditorPane` 深处。

**改法**：
```ts
// store/useHoverStore.ts：target / enter / leave / dismiss
// 只有 <HoverEntityCard> 订阅 target；NovelPage 不再读取 hover.target
```
预计：悬停期重渲染 **每秒数十次 × 全树 → 仅 1 个浮层组件**。
> 顺带收益：`hover.enter/leave` 变成模块级常量后，`EditorPane.tsx:474` 的 `[onTermHover, onTermLeave, onTermClick]` effect 不再需要参与依赖比较（尽管它们现在是稳定的，属于防御性的）。

---

### P0-3 NovelPage：`bundle` 单块 state → 一次自动保存把全书重扫一遍

**位置**：`hooks/useNovelData.ts:92`（`setBundle`）、`:213-230`（`updateChapterContent`）、`:136-178`（全部派生 useMemo）

```ts
// updateChapterContent:215 —— 防抖保存时更新 bundle
setBundle((current) => ({ ...current, chapters: current.chapters.map(...) }));
```

`bundle` 一变，下游这些 `useMemo` **全部**重算（依赖均为 `[bundle, activeWorkId]`）：
`allEntities / entities / links / levelSystems / volumes / chapters / notes / allNotes / outlineEntries / works / chapterNumbers / groups`。

由此产生两条实打实的卡顿：

1. **全书术语重扫** —— `NovelPage.tsx:147-156`：
   ```ts
   const appearanceCounts = useMemo(() => {
     for (const chapter of data.chapters)
       findTermMatches(chapter.content, terms)   // 逐章全文正则
   }, [data.chapters, terms]);
   ```
   `terms` 依赖 `[data.entities, settings.annotationTypes, customTypes]`，`entities` 依赖 `[allEntities, activeWorkId]` → **每次自动保存 = 全书所有章节 × 全部词条重扫一遍**。100 章 × 每章数千字 × 数十词条，这是肉眼可见的输入后掉帧来源。

2. **CodeMirror 标注层被无谓重建** —— `EditorPane/index.tsx:366-376`：
   ```ts
   useEffect(() => { viewRef.current?.dispatch({ effects: [termsCompartment.reconfigure(...), refreshAnnotation.of(null)] }) },
   [terms, enabled]);
   ```
   `terms` 每次 bundle 更新都是**内容相同的新数组** → 标注层（`novel-editor.ts` 的 ViewPlugin）被强制 `refreshAnnotation` 重建 decoration。结果：**每保存一次，正在码字的编辑区闪一下**。

**波及面**：每次自动保存 ≈ 全书 O(章数 × 章节字数) 的字符扫描 + 标注层全量重建 + SupportPanel/ChapterTree 全树重渲染。

**为什么 props 自救不了**：根因是「`bundle` 一个 state 装 9 张表」，不是透传方式问题 —— 只要任何一张表写一行，其余 8 张的派生全废。**必须按实体切片。**

**改法**：
```ts
// 按实体切片：useChapterStore / useEntityStore / useNoteStore / useOutlineStore …
const groups = useBookStore(s => s.groups);              // ChapterTree
const entities = useBookStore(s => s.entities);          // SupportPanel
// terms 在 store 内做「内容级」守卫（entities 引用变但内容不变则复用旧 terms 引用）
// appearanceCounts 改为 store 内 Map<chapterId, {hash, ids}> 增量缓存，只重算内容真的变的章
```
预计：自动保存时的 O(全书) 扫描降为 O(1 章)；SupportPanel 与 CodeMirror 标注层不再被无意义更新。

---

## 3. P1：输入/导航类的明确收益

### P1-1 MemoPage：逐字输入 → 侧栏虚拟列表 + 全文转义高亮

**位置**：`MemoPage/MemoPage.tsx:12-20`、`hooks/useMemoViewState.ts:42-45`

```ts
// useMemoViewState.ts:42 —— 每敲一键对全文跑一次 escape + 高亮
const highlightedEditorHtml = useMemo(
  () => highlightText(content, activeSearchQuery, activeSearchIndex),
  [activeSearchIndex, activeSearchQuery, content]);
```

`content` 由 `useMemoEditorState` 上提到 `MemoPage` 根 + `:115 onChange={setContent}` → 每键导致：

- `MemoSidebar`（未 memo）连同其 `Virtuoso` 列表、`menu={{ items, ... }}` 对象字面量重渲染
- `MemoHeader`、 Antd `Card`/`Modal` 重渲染
- 上述全文 `highlightText`

**注意**：`MemoPage.tsx:66-81` 给 `MemoSidebar` 传了 **8 个内联箭头**（`onCreate={() => setCreateModalOpen(true)}` 等）。**所以「给 MemoSidebar 加 memo」是无效修法**，必须先消除内联 props —— 而 store 方案天然不需要 props，一举两得。

**波及面**：每键 ≈ 30-40 个组件 + 一次全文 escape。

**改法**：`useMemoStore`（`content / files / selected / search*`）；`MemoSidebar` 只订阅 `files/selected`，`MemoEditor` 只订阅 `content`；`highlightedEditorHtml` 作为 store 派生 + 防抖。

---

### P1-2 LedgerPage：筛选框逐字输入 → 三张图表 + 流水时间线全重绘

**位置**：`LedgerPage/LedgerPage.tsx:35-44`（`view` 在根）、`:110-119`（keyword 透传 FilterBar）、`:90-131`（其余组件）

`view.keyword` 每键变化 → `LedgerPage` 根重渲染 → 所有兄弟组件无条件重渲染，**其中只有 `filtered/groups` 是真需要重算的**（`:48-58`）：

| 组件 | 是否受 keyword 影响 | 是否 memo |
|---|---|---|
| `LedgerPeriodBar` | 否 | 否 |
| `LedgerOverviewCard`（趋势图 30 点 SVG） | 否 | 否 |
| `LedgerCategoryPie` | 否 | 否 |
| `LedgerTimeline`（GroupedVirtuoso） | 是 | 否 |
| `LedgerEditModal` | 否 | 否（且 `:158-166` 的 `draft={editor.editDraft ?? {...}}` 每次新建对象字面量，加了 memo 也会被击穿） |

另外 `LedgerTimeline` 内部 `itemContent/computeItemKey/groupContent` 均为内联 → `LedgerTxRow` 虽已 `memo`（`LedgerTxRow/index.tsx:64`），仍挡不住因 `itemContent` 身份变化导致的可见行全量重算。

**波及面**：每键 ≈ 40+ 组件 + 一张折线图重绘。

**改法**：筛选条件进 `useLedgerViewStore`；`LedgerTimeline` 订阅筛选结果（`groups`），图表组件订阅 `transactions/range`，与 keyword 彻底解耦。

---

### P1-3 CodePage：邮箱输入框每敲一个字符发一次网络请求（不只是性能问题）

**位置**：`CodePage/hooks/useCodePage.ts:32-57`、`:78-85`

```ts
const loadMonthOutput = useCallback(async () => { … fetchGitWebhookLogs(email, …) }, [email]);  // :32-57
useEffect(() => { … void loadMonthOutput(); }, [loadMonthOutput]);                              // :78-85
```

`setEmail`（每次输入变更）→ `loadMonthOutput` 身份变 → effect 重跑 → **每键一次月度统计请求**。输入 `zhangsan@example.com` = 15+ 次请求，且**响应无票据守卫**，乱序返回会把旧结果写进 `monthOutput`（`AGENTS.md` §6.2 第 1 条准入信号的教科书案例）。

**改法**：照 `useSearchStore` 的做法 —— `email` 进 store，**请求改为显式「查询」动作 + store 内 debounce + 票据作废旧响应**，彻底切断「输入 → effect → fetch」链；顺手消除竞态。

---

### P1-4 路由切换 → 页面状态全丢（含未保存内容）

**位置**：`BaseWindow/App.tsx:13-19,77-88`（lazy Routes，离开即 unmount）

各页面的自救现状说明了一切：

| 页面 | 丢失的状态 | 现状补丁 |
|---|---|---|
| TodoPage | `outlineCollapsed` / `collapsedSection` 手写落 localStorage（`hooks/useTodoViewState.ts:28-35`） | 有 |
| MemoPage | `selected` / **`content`（可能未保存）** / `newFileName` | 无 |
| LedgerPage | `keyword` / `type` / `categoryId` / `pieType` | 无 |
| 面板级 | `LedgerPage.tsx:122` `groups.length===0` 时 Timeline 卸载，清空筛选后滚动位置丢失 | 无 |

**改法**：store 是模块级单例，跨路由天然保活；顺手可以把 `useTodoViewState` 那段 localStorage 手写同步删掉（store 在这里不需要持久化，若确实要持久化再加 `persist`）。

---

## 4. P2：可选

### P2-1 Bookshelf ↔ NovelPage 来回切视图

`WorkerWindow/App.tsx:20-33`：`view / editorMounted / openRequest` 三个 state 在窗口根，`openWork` 一次 setState 会让 `BookshelfPage` 与 `NovelPage` 同时重渲染；且 `BookshelfPage.tsx:80-86` 的 effect 每次回到书架都 `refresh()` 重新拉全量。
收益：把 bookshelf 数据放 store 后，来回切可以不重新 IPC、不闪 loading。**优先度低**（框架组件切换本身不慢），建议等 P0 做完再评估。

### P2-2 HomePage

`HomePage/index.tsx:104,151,161`：`filterText` 在页面根，`onOpen={handlePosterOpen}` 每次新函数、`PosterWidget` 未 memo、`HomeSidebar` 未 memo。每键 ≈ 20-30 个组件，但**单个渲染很便宜**，收益不明显。若要动，优先只在这页加 memo + `useCallback`，不必上 store。

---

## 5. 明确不要改的地方（避免过度改造）

| 位置 | 为什么不用改 |
|---|---|
| **`ThemeProvider.tsx:96-99`** | `value` 已 `useMemo([theme, meta, setTheme])`，全项目只有 2 处 `useTheme()`（`ThemeSwitcher`、`PosterWidget`）。Context 穿透面极小，换 store 收益为负。**别动。** |
| **TodoPage 全页** | 全项目优化最好的一页：`useTodoData:334` / `useTodoEditorState:40` / `useTodoViewState:140` 返回值全部 `useMemo`，handler 经 ref 稳定化（`TodoPage.tsx:32-39`），`renderItem` 依赖显式声明（`:151-163`），`TodoListItem`/`TodoSection`/`TodoOutlineSidebar`/`EditableText` 均已 memo。打字只重算 `filteredTodoItems`（必要开销）。**维持现状即可。** |
| **`EditorPane` 内部** | CodeMirror 单例 + `handlersRef`（`:214-227`）+ compartment 热更新（`:337-341,:366-376`）已经写得很克制，编辑器本身不会因为 props 抖动而重建。**要改的是它上面的层，不是它。** |
| `usePosterVisibility.ts:100` | 60s `setInterval` 看似每轮 setState，实际 `tick()` 在 cycle 未变时直接 return（`:92-97`）。不是问题。 |
| `useDailyPage.ts:27-42` / `useNewsData.ts:65-90` | 依赖均为值语义（`currentMonth` / `selectedDateStr` / `payload`），不会无意义重跑。 |

---

## 6. 落地顺序与约束

**顺序（按收益/改动比）**：`P0-2 hover` → `P0-1 editor draft` → `P0-3 bundle 切片` → `P1-1 Memo` → `P1-2 Ledger` → `P1-3 CodePage 请求` → `P1-4 路由保活`

**必须遵守的项目约束**（见 `AGENTS.md` §6.2）：

1. store **只存状态与调度动作**，通过模块级 runner 注册拿数据层函数，**不在 store 里 import hooks / service**；组件挂载时注册、卸载时注销；**注册动作不得触发任何请求**
2. store 放在使用方目录内（`pages/XxxPage/store/useXxxStore.ts`），只有跨窗口/跨页面复用才提升到 `src/shared/store/`
3. 测试就近放 `*.test.ts` 同级（现有 `useSearchStore.test.ts` 可作模板）
4. 改前后必须跑对应模块单测，交付前跑全量 `pnpm test`
5. zustand 尚未安装到 `node_modules`，动手前先 `pnpm install`

**验证方法**：React DevTools Profiler 记录「编辑器连打 20 个字」与「鼠标扫过一段高亮正文」两段操作，对比改动前后的 commit 数量与单帧耗时；P0-3 可用 `performance.now()` 在 `appearanceCounts` 内外打点，对比自动保存前后的耗时。

---

## 7. 落地进度（截至 1.16.0）

| 项 | 状态 | 落地文件 |
|---|---|---|
| P0-1 编辑器草稿/打字统计 | ✅ 已完成 | `NovelPage/store/useNovelEditorStore.ts` |
| P0-2 悬停术语 | ✅ 已完成 | `NovelPage/store/useHoverStore.ts` |
| P0-3 出场章数增量缓存 | ✅ 已完成（派生依赖细化 + 按章缓存，非全量 bundle 切片） | `NovelPage/store/useAppearanceStore.ts` |
| P1-1 Memo 编辑/筛选 | ✅ 已完成 | `MemoPage/store/useMemoStore.ts` + `useMemoSearchStore.ts` |
| P1-2 Ledger 筛选 | ✅ 已完成 | `LedgerPage/store/useLedgerViewStore.ts` |
| P1-3 CodePage 请求 | ✅ 已完成（显式调度，未单独立 store） | `CodePage/hooks/useCodePage.ts` |
| P1-4 路由保活 | ✅ 已完成（store 模块级单例天然保活） | 上述各 store |
| P2-1 Bookshelf ↔ NovelPage | ⏸ 未做（优先度低，框架切换本身不慢） | — |
| P2-2 HomePage | ⏸ 未做（单渲染便宜，收益不明显，仅加 memo 即可） | — |

> 说明：P0-3 实际范围是「`useNovelData` 派生依赖细化 + 出场章数按章增量缓存」，未做 review 原文设想的「`bundle` 全量按实体切片」（那是更大的重构，当前增量缓存已消除自动保存时的全书重扫，性价比已达标）。如后续仍有大长篇自动保存卡顿，再评估按实体切片。
>
> 验证结论：全量单测 389 passed，类型检查 0 error，ESLint 0 error（仅 1 处与本次无关的预存 warning）。
