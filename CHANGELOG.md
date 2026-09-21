# Changelog

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
