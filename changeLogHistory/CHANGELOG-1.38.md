# Changelog · 1.38.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

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
