# Changelog · 2.5.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

## [2.5.1] - 2026-10-23

### Changed

- **文档治理：`docs/` 按「是否还有约束力」三级重排**（规范落 `AGENTS.md` §5.3 / §8.8）。
  原 13 份文档平铺在 `docs/` 与 `docs/prd/`，活规范、一次性审查报告、已交付过程稿混在一起，
  无法判断哪份还能约束代码。现分三级：`docs/spec/`（活规范，违反即缺陷）、
  `docs/review/`（审查报告，清单里未闭环的待办仍可执行）、`docs/archive/`（已闭环/已作废，
  只读留档），并新增 `docs/README.md` 作唯一导航索引（每篇标注一句话结论与闭环版本）。
  新增需求稿约定放 `docs/prd/<需求编号>-<主题>.md`，交付后整组移入 `docs/archive/prd-<编号>/`。
- R27 关系网络 7 篇立项过程稿（scope / preresearch / acceptance / analysis / delta-v2 /
  architecture-decision-v2 / batch-plan-v2）归档至 `docs/archive/prd-r27/`，
  `r27-architecture-decision-v2.md` 补齐组内前缀；1.47.0 视觉改造方案与验收对照归档至
  `docs/archive/visual-polish/`；图形主题化规范移至 `docs/spec/`。
  归档时只在标题下补「已归档 · 闭环版本 · 现行为准的去处」，正文未改。
- `AGENTS.md` 目录树补 `docs/` 与 `changeLogHistory/`，并新增 §5.3（三级目录、命名规则、
  归档与删除判定、移动文档的引用自查）、§8.8（文档变更检查清单）。

### Removed

- 删除 `docs/prd/r27-relationship-network-batch-plan.md`（v1 排期）：方案基线是**已作废的
  页内浮层**（后续 delta-v2 改为独立窗口 `RelationWindow`），工作量 19.0 人日与 6 批划分
  均为无效数据，正文已无任何可执行条款。
- 删除 `.cache-shots/`（16 张 2026-09-29 的临时界面截图，`.gitignore` 已忽略、无任何引用）。
- 删除 `AGENTS.md` §6.8 中对 `docs/packaging/bundle-slimming-2.0.0.md` 的引用
  （该文件此前已删，体积数据与结论本就在本节与 CHANGELOG 内），
  明确改为指向 CHANGELOG 对应条目，避免「同一事实两处维护」。

### Fixed

- `README.md` 三处过时内容：① 「`pnpm electron:setup` 为 Electron 编译 better-sqlite3」
  已不成立（13.x 起 Node-API 免编译）；② 把「Electron 二进制缺失 / `pnpm dev` 卡住」
  归因为「pnpm ≥10 拦截 electron postinstall」是**已被证伪的旧结论**（Electron 42+ 无
  postinstall，真因是首次 `require` 时无镜像无超时的同步下载），改为 `pnpm ensure:electron` /
  `pnpm dev:doctor` 的正确处置，并补「二进制看着齐全仍秒退 = 解压不完整」的形态；
  ③ pnpm 9 的构建脚本白名单位置写错（写成 `package.json` 的 `pnpm` 字段，实际在
  `.npmrc` 的 `only-built-dependencies[]`）。顺带修重复的小节编号（两个「5.」）。
- `pnpm-workspace.yaml` 注释称「`package.json` 的 `pnpm.onlyBuiltDependencies` 是 pnpm 9
  唯一认的位置」，与 `.npmrc` 注释及实测矛盾，改为 `.npmrc`。
- `src/shared/novel/guide-doc.ts` 文件头仍指向已删除的 `docs/novel-onboarding-guide.html`
  （「改文案同步三处」实为两处），改为以本文件为唯一内容源。
- `docs/spec/graphic-theming-spec.md` 的配套文档路径随归档更新。

## [2.5.0] - 2026-10-23

### Added

- **回收站从「数据安全」弹窗拆成独立页面**（`pages/RecycleBinPage`，设计稿见 Ardot
  「CheckIn · 回收站页面设计」的默认 / 空态两屏）。书架顶栏新增「回收站」入口，图标用
  设计给的 `recycle-bin.svg`（`?raw` 内联，`fill=currentColor` 才能跟着主题色走），带条目数
  角标。弹窗只留「全量备份 / 从备份恢复」—— 回收站要逐条判断「捞回还是销毁」，需要类型 /
  归属作品 / 规模 / 剩余天数 / 两个动作的横向空间，560px 的弹窗里每行只能靠省略号过日子。
- 页面能力：类型分段（全部 / 作品 / 卷 / 章节，各带计数）、关键词搜索（同时匹配条目名与
  所属作品名 —— 章节名往往认不出来，作者记得的是书名）、按删除时间倒序、剩余天数分档
  （≤3 天转警示色、今天到期与已过期转错误色）、勾选后批量恢复 / 批量彻底删除、清空回收站、
  进入页面即清理过期条目并提示清理了几项。
- 统计条：可恢复条目（按类型拆分）/ 保留期 / 最近一次删除；页面底部「恢复规则」写明
  同批删除、原位置被占时落到同级末位、过期自动清理，减少「点恢复之前」的犹豫。
- 书架区新增二级页面状态 `shelfScreen`（`useEntityJumpStore`）：进回收站不再借道 `view`，
  关系图跳转的 `onShelf` 判定不会被误判成「不在书架」；打开作品 / 返回书架 / 导入三个出口
  都会把它同步归零，不会回到书架时还停在上次的二级页面。

### Changed

- 书架顶栏「数据安全」与「回收站」拆成两颗入口按钮，角标从前者移到后者。
- 卷 / 章节删除确认框里的恢复路径改为「书架「回收站」里恢复」（旧文案指向的弹窗已不含回收站）。
- **书架顶栏布局收敛**（真机反馈「头部按钮太密集」）：原先右侧是「搜索 + 四颗带文字的描边
  胶囊 + 主按钮」六件平铺，视觉上像一排并列的按钮、主次全糊在一起。现在收成三段 ——
  `书架·规模摘要 │ 搜索 │ 工具条 + 新建作品`，工具条用一条竖分隔线分组。其中只有
  「全局设定中心」保留文字（跨书共享库是本页最需要被发现的次级入口，也是新手引导第 6 步的
  锚点），数据安全 / 回收站 / 导入降为 32px 纯图标，语义交给 Tooltip 与 `aria-label`；
  规模摘要从 primary-weak 胶囊降为静音小字 —— 它与下方四张统计卡是同一个数字，顶栏再放一颗
  同色色块只会跟主按钮抢焦点。
- **窗口标题栏徽标跟随二级页面**：进回收站后标题栏显示「回收站」，不再一直写「书架」
  （`badge` 由只读 `view` 改为同时读 `shelfScreen`）。
- **回收站页头固定**：改为「页头 + 滚动区」两段结构，页头（返回 / 刷新 / 清空回收站）
  不随列表滚动 —— 条目一多，滚到列表底部还想动它时不必先滚回顶部。试过 `position: sticky`
  配负 margin 抵消父 padding：实测吸附点会偏一个 padding 高度，且窄窗改了 padding 之后
  负 margin 要跟着改，漏一处就从页头两侧漏出滚动内容，耦合更脆。
- 窄窗口（≤1240px）下搜索框与工具条同步收紧内边距与图标位宽度，摘要文字在 ≤1080px 让位。

### Removed

- `DataSafetyModal` 里的回收站列表、批量操作与过期清理逻辑（连同其单测）全部迁到
  `RecycleBinPage`；彻底删除仍按类型分派到各自既有的级联通道，渲染层没有新增任何删除顺序。
