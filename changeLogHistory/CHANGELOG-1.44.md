# Changelog · 1.44.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

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
