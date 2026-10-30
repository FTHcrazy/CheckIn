# Changelog · 1.33.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

## [1.33.2] - 2026-10-11

> 退出时序修复：「保存并退出」曾必然失败 —— 库先关了，行囊窗口才弹「未保存」。

### Fixed

- **托盘「退出」绕过了关闭守卫**：退出菜单在 `app.quit()` 之前就把 `isQuitting`
  置真，`before-quit` 的询问分支（`!isQuitting && hasArmedCloseGuard()`）被整体
  跳过 → 直接清理 + 关库。修复：交给 `before-quit` 统一裁决，托盘只负责发起。
- **清理阶段窗口还会「诈尸」弹未保存提示**：退出确认后窗口销毁期间，
  `attachCloseGuard` 的 `close` 处理器仍会 `preventDefault() + show()`，把行囊
  窗口弹回来问「未保存」—— 此时库已关，点「保存」必然报
  「尚未初始化 novel 数据」（其余窗口都关了、只有行囊弹出来，正是这个样子）。
  修复：新增 `standDownCloseGuards()`，`before-quit` 清理开始前先给所有窗口
  的守卫缴械 —— 退出是用户已拍板的决定，最后一次「保存机会」在询问分支给过。
- **`closeDb()` 时机从 `before-quit` 挪到 `will-quit`**：before-quit 阶段窗口
  还活着，销毁过程中渲染层的最后一次保存（防抖兜底 / 退出前 flush）仍可能
  到达；will-quit 时窗口已全部销毁，不再有「库已关却收到保存请求」的时间窗。
- **`novel-pack-save` / `novel-config-get|set` 在库未就绪时优雅拒绝**：原先
  `getDb()` 在 try 块外抛「尚未初始化 novel 数据」，渲染层拿到的是无法理解的
  异常；现在返回 `false` / `null`，走各自的失败分支（草稿仍在主进程表，不丢）。
- **`closeDb()` 幂等收紧**：什么都没关时不再广播 `onClosed`，避免监听者重复收到。

### 守卫

- **`pack-close-guard.test.ts` +1 组 6 例**：托盘退出不得提前置 `isQuitting`、
  before-quit 清理前必须缴械、`closeDb()` 只许在 will-quit、缴械后的守卫不得
  再拦 close、`closeDb` 幂等不发空广播、库未就绪时保存/配置读写优雅拒绝。

## [1.33.1] - 2026-10-11

> 两处行囊缺陷修复：一个让「阶内进位」**完全点不动**，一个让未保存计数**按按键次数涨**。

### Fixed

- **「阶内进位」按钮点击无效**：按钮只传了 `{ delta: 1 }`，漏掉 `carry: true`，
  而写入口按 `options.carry` 分支 —— 缺了就走 `clampRealm`，位置**原样返回**，
  却仍然标脏 + 弹「境界已更新」的 toast。表现为「点了没反应、还提示已更新」。
  - 修法：补上 `carry: true`；并让 `setRealm` 在计划里回带 `position`（进位后的
    唯一真相），`writeRealm` 不再自己算第二遍 —— 两份规则漂移正是这个 bug 的温床。
  - 已在最高阶最后一层时按钮**置灰**并提示原因：此前「到顶」与「坏了」长得一模一样，
    这正是本次报障的最初观感。
- **未保存计数按「按键次数」涨**：`updateAttribute` / `updateItem` / `updateSkill` /
  `updateSlot` 每次 `onChange` 都调一次 `mutate`，而计数是 `setDirty((n) => n + 1)`
  的自增计数器 —— 「破境丹」三个字算 3 处改动，改回原样仍显示改过 3 处。
  - 修法：计数改为**派生值**，由 `countNetChanges(上次保存态, 当前文档)` 重算，
    口径即用户要求的「新增 / 修改 / 删除 / 移动 的最终净变化」：
    同一字段连敲 10 个字算 1 处、改回原值算 0 处、一次拖动排序算 1 处（不是每行各 1）。
  - `updatedAt` 不参与比较（它是「碰过」的打点，不是内容变化）；主角绑定不参与
    （它即时落库，算进来会让顶栏常亮一个按不掉的角标）。
  - 新增发生时**不额外计一次「移动」**：增删本就会让顺序整体位移，那属于副产物。
  - 新增 `pack-dirty.ts`（纯函数）承接这套口径，与展示用的 `pack-diff.ts` 分开
    （后者比的是「汇总后的值」，服务的是「与本章初对比」那张表）。

### 守卫

- **`pack-dirty.test.ts` +15 例**：逐字输入只算 1 处、改回原值算 0 处、`updatedAt`
  不算改动、增删各 1 处、纯移动 1 处、跨 7 类实体都要计到、境界算 1 处、主角绑定不算、
  无基线时返回 0。
- **`RealmModule/index.test.tsx` +4 例**：点「阶内进位」必须带 `carry: true`、
  顶阶末层置灰并给出原因、非顶阶可按且 title 说明会进位、小层数 = 1 时不渲染小层区。
- **`pack-close-guard.test.ts` +2 组**：禁止回退成自增计数器（`setDirty((count) => …)`
  必须消失）、`updatedAt` 不得进比较、主角绑定不得进计数、增删时不得重复计移动。
- **`pack-realm.test.ts` +2 例**：`plan.position` 回带真实落点；漏传 carry 时位置
  原样返回（把根因钉成断言，防止再犯）。

## [1.33.0] - 2026-10-11

> 小说与行囊的存储**从 `checkin.db` 拆出为独立的 `novel.db`**（§6.7 `refactor` 窗口期，
> **旧数据不兼容**：见下方「旧数据如何重建」）。拆分过程中顺带把两个窗口 review 出来的
> 9 个漏洞一并修掉——其中 3 个是**会静默丢数据**或**让保存态永久卡死**的。
>
> ⚠️ **旧数据不兼容**：升级后 `checkin.db` 里残留的 `novel_*` / `novel_pack_*` /
> `usage_log` 表**不再被读取**，小说与行囊表现为「回到空书架」。
> **老数据如何重建**：用书架页的「导入」把此前导出的 `.txt` / `.docx` 原稿重新导入；
> 没有导出过的原稿请先**降级到 1.32.1 并在书架里导出**后再升级（1.32.1 仍能读旧库）。

### Changed

- **小说 + 行囊的存储独立为 `novel.db`**：新增 `electron/novel-db.ts`，24 张
  `novel_*` / `novel_pack_*` 表与 `novel_config` / `novel_usage_log` 全部迁到
  `user-data/{用户目录}/novel.db`，与 `checkin.db` 同级。
  - `electron/db.ts` 移除全部 novel 域建表（约 200 行 SQL）与 4 段 novel 增量迁移，
    `config` 表回归只服务 checkin 域。
  - 生命周期靠 `registerUserDbLifecycle()` 桥接：`switchUserDb` / `closeDb` 触发
    `onSwitched` / `onClosed`，novel 库跟着开关；`registerNovelDbBridge()` 在
    novel handler 注册**之前**调用（启动期顺序是 `switchUserDb → register`，
    注册时若已有当前用户会立即补开一次）。桥接是单向的（novel-db → db），避免循环 import。
  - 历史 `ALTER TABLE` 增量迁移一次性写进建表语句（`novel_levels.sub_levels/power`、
    `novel_pack_attributes.updated_at`、`novel_pack_items.weight`、
    `novel_pack_characters.weight_limit/capacity_limit`、`novel_pack_modifiers.rounds_left`），
    并补齐 9 个外键查询索引。
  - `novel_editor_session`（崩溃恢复标记）随小说库走：放在 checkin.db 会出现
    「换了用户库但标记还在」的错配。

### Fixed

- **删章 / 删作品 / 重置模板库后保存态永久卡在「保存失败」**：草稿的生命周期与库里的
  章节是两套账，章节删掉后指向它的在途防抖（800ms）仍会拿这个 `chapterId` 落库，
  而 `novel-chapter-save` 找不到章节会如实返回 `false` —— `saveState` 就此停在
  `failed`，30s 兜底每半分钟重试一次注定失败的请求，顶栏一直红着。
  - 新增 `dropChapterDraft` / `clearDrafts`，三条删除路径先撤草稿与在途防抖再删数据。
- **删作品 / 清库漏删 `novel_pack_presets`**：级联清单只有 8 张表，预设表留下孤儿数据；
  现在清库与删作品复用同一份 9 张表的清单，消除清单漂移。
- **`ensurePackCharacterRow` 并发建出两个主角**：面板装载与右侧「设为主角」两个入口
  首次并发触发时各插一行。改为 `transaction(...).immediate()` 并在事务内二次查询。
- **行囊脏计数在严格模式下翻倍**：`mutate` 的 `setDocState` updater 里调了 `setDirty`
  副作用，StrictMode 下 updater 跑两次 → 一次编辑计成两次。改为先算后写、手动推进 `docRef`。
- **行囊自动保存永不触发**：自动保存 effect 的依赖里放了 `usePackData` 每次渲染都新建的
  对象，等于只要有周期渲染就无限重建定时器。改为依赖标量 + `saveRef` 转发。
- **只开过行囊也会误报「上次未正常关闭」**：`novel-editor-load` 被书架与行囊
  （`fetchPackBindableEntities`）共用，而它会写 `novel_editor_session = running`；
   PackWindow 关闭时没人清标记 → 下次启动凭空弹恢复横幅。新增专用通道
  `novel-session-open`，只有真正进入编辑器才会调。
- **回滚 / 崩溃恢复后「今日新增字数」与库中统计对不上**：`applyExternalContent`
  此前只改草稿不计字数，而主进程是按 `wordCount - 库里旧字数` 记负 delta 的，
  状态条会一直错到下次重启。现在跟着回退。
- **冗余查询**：`readCharacterSnapshot` 对 `novel_pack_characters` 重复 `dbGet`、
  `readLevelSystems` 全表扫 `novel_levels`（改为 `WHERE system_id IN (...)`）。

### 守卫

- **新增 `electron/novel-db-split.test.ts`（9 例）**：断言 checkin.db 不再建任何 novel
  域表（含 `usage_log`）、novel.db 建齐 24 张表且路径独立同目录、生命周期回调存在、
  两个 novel handler 不得 `from "../db"` 且必须 `from "../novel-db"`、handler 不再
  `INSERT INTO config` / `usage_log`、`PACK_CHILD_TABLES` 覆盖 9 张表（含
  `novel_pack_presets`）。均为源码断言——better-sqlite3 的 native 按 Electron ABI
  编译，vitest 的 node 进程加载不了。
- **`useNovelEditorStore.test.ts` +4 例**：删章后草稿与在途防抖一起撤掉（防抖到点不再
  拿已删除 id 落库）、撤单章不影响他章、删作品清空全部草稿、回滚要回退今日字数。
- **`pack-close-guard.test.ts`**：`DB` 常量改指 `electron/novel-db.ts`；REQ-028 的断言
  改为按建表块分段截取（原写法全文件 `toContain` 会命中别的表）。

### 兼容

- §6.7 架构重构开关已由 `refactor` 改回 `compat`：novel 结构重设完成，此后 novel 域的
  表结构变更重新受 §6.5 增量迁移约束（`novel.db` 自己的建表函数里写 `ALTER`）。
