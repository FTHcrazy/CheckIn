# Changelog · 2.19.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

## [2.19.0] - 2026-11-03

> 地图窗口的**区域编辑**能力（R-MAP 区域编辑 · 用户四点需求）。改动集中在
> `src/windows/MapWindow/pages/MapEditorPage/`，另有 1 个新增的跨模块样式守卫。
> 无新依赖、无数据表、无 IPC 通道；地图文档仍未落库（纯内存态），`regionSchema` 随文档快照
> 与撤销栈持久化，真正的存档读写等文档落库一并生效。

### Added

- **区域层级自定义（R-REG-01）**：`MapDocument.regionSchema`（`{name,count}[]`，长度即层数 1~4），
  层级名称与各级数量都可改、进撤销栈、随快照走；工具栏「层级」浮层取代原来的裸 Slider。
  `levelDepth` 组件 useState 删除，层数唯一事实源 = `regionSchemaOf(doc).length`；
  9 处 `REGION_LEVELS` 消费点统一改走 `levelLabelOf(schema, level)`，常量只剩定义与派生。
- **手动划分区域（R-REG-03）**：工具栏「选择 / 画区」双模式；画布上逐点画闭合多边形落成区块，
  可指定层级，选中父区块后画出的自动成为其子区块。新增纯函数层 `regionEdit.ts`
  （自交 / 重复边 / 同父兄弟与祖先链求交 / 父多边形包含 / 层级封顶校验，合并规划，命名取色）。
  `world` 新增第 8 层 `draftLayer`（草稿顶点、已定边、跟随光标的预览虚线），
  连同 `WORLD_LAYER_ORDER` 具名 z 序清单一并落地——原先散落在测试里的 7 层魔数下标全部改成按名取。
  四个闭合入口（双击最后一点 / 点首顶点 / Enter / 完成按钮）统一走 `closeDraft()`，都不增减顶点。
- **合并子区域（R-REG-04）**：选中非叶子区块→合并，删**整棵后代子树**、父区块变为叶子；
  父区块的 `polygon / level / name / color / seed / submap` 一律不变（边界不重贴合，顶点数不变）。
  确认弹窗列出将被删除的数量与名字，**子树含子图时单独 ⚠ 段**报数量与名字。
- **高亮分级（R-REG-05）**：面高亮（三笔）只对**叶子**区块生效；非叶子改为沿轮廓的单笔 1.6px
  强调描边 + 面板面包屑，不再用填充把内部子区块的边界糊掉。判据是**运行时子节点数**，
  不是 `level === 最深层级` —— 合并会把「国家」变成 `level=2` 的叶子，按层号判会让用户
  刚做完合并就失去选中反馈。
- `src/shared/styles/theme-tokens.test.ts`：跨模块样式守卫。扫描 `src` 下全部 `.scss` 的
  `var(--app-*)`，与 `themes.scss` 的定义集合比对。首轮就把它抓到的两处老代码一并修掉，
  因此豁免清单**为空**——要豁免必须往清单里加一条并改「清单为空」那条断言，会迫使解释
  「为什么不能用已有 token」。

### Changed

- 「生成陆地」**默认不再连带划出区块**（R-REG-02）：新增「陆地选项」下拉里的「同时划出区块」，
  默认不勾。`generateLand(seed?, { splitRegions })` 取代旧第二参 `levelCount`（无兼容重载）。
- **手画区块在重新生成时一律保留**，只替换 `origin === "generated"` 的区块（生成陆地不勾选时亦然）。
  只要存在手画块，确认弹窗追加提示「手动区块是基于当前陆地绘制的，重新生成陆地后可能不在
  新大陆范围内」——它被强行保留了，坐标就会与新陆地失配，这一点必须让用户知道。
- 撤销快照新增合并键：`commit(mutate, coalesceKey?)` / `breakCommitKey()`，层级面板的连续编辑
  并成一步；`undo` / `redo` / 拖拽起始三处强制断键（否则「撤销 + 接着改」会被并进上一步）。

### Fixed

- **样式引用了不存在的主题变量**：`--app-danger`（真名 `--app-error`，3 处）与 `--app-accent`
  （真名 `--app-primary`，5 处）。两处都带 fallback，所以一直是静默降级成写死的颜色、肉眼看不出来
  （`--app-accent` 的 fallback 恰好等于真值 `#5b6cf9`）。fallback 已一并删除，写错就直接失效。
  守卫跑出来后追加扫到的两处老代码也一并改掉（`AiConsentDialog`）：`--app-accent` → `--app-primary`
  （标题图标改为跟随品牌色，顺带获得换肤能力）；`--app-fill-quaternary` → `--app-surface`
  （弹窗内的凹槽按 themes.scss 顶部的分层规则用 surface，项目本就没有 quaternary 这一档）。
- **改「层数」会叠出两个一模一样的确认弹层**：`rc-input-number` 失焦会 flush 一次输入，
  导致 `onChange` 被调两遍。用 `pendingPruneRef` 按目标层数去重，并在 `onOk` / `onCancel` /
  `afterClose` 三处挂幂等释放——只挂前两者的话，程序化 `destroy()` 路径会让标记永久卡住，
  表现为「确认框从此不再弹，且没有任何报错」。
- **`migrateDoc` 没做注释里承诺的事**：非法 `regionSchema` 会原样写回存档。改为按
  `normalizeRegionSchema` 判定后剔除。零写入原则保留：没有该字段的老文档迁移后仍不凭空多出字段，
  合法的值原样保留、不替换成规范化副本（后者会把存档里的额外键抹掉）。
- **双击闭合多落一个顶点**：`dblclick` 是浏览器在两次 down/up **之后**才派发的事件，那时顶点
  已经落下了，只能事后补救。改为在 `pointerdown` 里判（时间差 < 350ms 且屏幕距离 <
  `DRAFT_CLOSE_PX`），第二下不落点，`dblclick` 监听移除。连带修掉「双击首顶点」会闭合成功
  但画布上残留一个孤立顶点的组合。
