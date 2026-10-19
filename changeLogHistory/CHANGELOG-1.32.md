# Changelog · 1.32.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

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
