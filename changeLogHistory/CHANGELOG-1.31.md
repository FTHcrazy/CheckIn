# Changelog · 1.31.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

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
