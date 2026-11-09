# Changelog · 2.20.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

## [2.20.0] - 2026-11-03

> 地图**存档落地**（B0）：地图从"纯内存、关窗即失"变成"独立 `map.db` + 自动保存"。
> 新增一本库、两组进程侧文件、两个渲染层模块；无新依赖。
> 规范见 `docs/spec/map-db-spec.md`，不变量由 `electron/map-db-guard.test.ts` 钉住。

### Added

- **独立地图库 `map.db`**（`electron/map-db.ts`）：`user-data/{hash}/map.db`，与
  `checkin.db` / `novel.db` 平级；四张表 `map_docs` / `map_revisions` / `map_assets` / `map_config`。
  库挂在 `registerUserDbLifecycle` 上（切用户 / 退出同步开关），lite 版整组不注册。
- **地图 IPC 全通道**（`electron/handlers/map-handlers.ts`）：列表（不含 `doc_json`）、
  读、建、存、关窗 flush、改名、软删、恢复、彻底删（连带历史与资源目录）、绑定作品、
  缩略图、历史版本与回退、作品下拉、配置键值。列表/回收站共用一条查询（只换 WHERE）。
- **乐观锁 + 自动保存**：`baseRev !== 当前 rev` 时拒绝并回传最新 rev，界面在
  「载入最新 / 覆盖保存」间选；编辑后 800ms 防抖写库，`rev` 每 10 版留一档历史（保留 10 份）。
- **关窗 flush**：主进程拦 `close` → 向渲染层取快照 → 强制写一次 → 回执后真正关闭；
  1.5s 超时兜底（宁可丢最后一次，也不能关不掉窗口）。
- **地图库弹窗**（`components/MapLibraryModal/`）：缩略图 + 名称 + 更新时间 + 所属作品，
  支持新建 / 打开 / 内联改名 / 移入回收站 / 恢复 / 彻底删除 / 绑定作品（下拉菜单，不铺表单）。
- **地图库入口与存档状态**：工具栏最左显示当前地图名 + 一个状态点（dirty / saving /
  saved / conflict / error）；`Ctrl/Cmd+S` 手动存一次。
- **纯函数工具**（`electron/map-utils.ts`）：标题归一、rev 冲突、版本节奏、视口解析、
  缩略图 data URL —— 主进程与 handler 共用一份规则，避免"两边各自截断到不同长度"。

### Changed

- 地图窗口不再是"无草稿状态、关闭即销毁"：关闭前会把最后一次改动落库
  （`main.ts` 的 `createMapWindow` 注释与 `close` 拦截同步改写）。

### Notes

- 缩略图按需生成（打开地图库前抓一张 320px），未抓过的图显示占位图标；
  不在每次保存时抓，避免给画布加持续抖动。
- 首屏仍是编辑器（直接打开最近一张），列表做在弹窗里 —— 地图是画布工具，
  「换一张」是低频动作，不该让每次使用都多一次点击。
- 作品被彻底删除后的「降级为独立地图」钩子尚未接（novel 侧 purge 未调用 map 库）；
  在此之前表现为列表里显示「独立地图」，库里留一个悬空 `work_id`，功能上等价。
