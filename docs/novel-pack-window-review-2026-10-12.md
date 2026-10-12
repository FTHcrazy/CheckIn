# Novel 窗口 × 行囊窗口 跨窗口审查报告

- **审查日期**：2026-10-12
- **审查依据**：`AGENTS.md`（架构分层 / §6.0 TypeScript / §6.1.2 组件库优先 / §6.2.1 状态归属 / §6.6 测试）+ 项目长期记忆中的历史踩坑记录（退出时序、React 纯度、双库分立、行囊脏计数、跨页共享隔离）
- **审查范围**：
  - 窗口根：`src/windows/NovelWindow/{App.tsx,main.tsx}`、`src/windows/PackWindow/{App.tsx,main.tsx}`
  - 页面与 hooks：`NovelWindow/pages/NovelPage/*`（NovelPage.tsx / hooks/useNovelPage.ts / useNovelData.ts / useNovelEditorState.ts / useNovelViewState.ts / useNovelShortcuts.ts）、`pages/BookshelfPage/*`
  - store：`useNovelEditorStore.ts` / `useAppearanceStore.ts` / `useSearchStore.ts`
  - 编辑器：`components/EditorPane/index.tsx`
  - 行囊：`src/shared/components/CharacterPack/*`（index.tsx / hooks/usePackPanel.ts / usePackData.ts / services/pack-service.ts / pack-close-guard.ts / pack-config.ts / pack-dirty.ts / pack-realm.ts）
  - 主进程：`electron/main.ts`、`electron/close-guard.ts`、`electron/handlers/novel-pack-handlers.ts`、`electron/preload.ts`
  - 共享：`src/shared/services/novel-shared.ts`
- **方法**：分区并行审查 + 交叉复核。标注 🔍 的条目为**已逐行读码复核确认**的结论。
- **约束**：所有建议遵循「不改整体架构、沿用现有代码风格」前提，只给最小化修法。

---

## 修复状态

- **第一批（P1×3）已于 2026-10-12 实施并验证**：P1-1 / P1-2 / P1-3 全部落地，
  `pnpm typecheck`、`pnpm build`、行囊 + PackWindow 全部 443 个测试通过。
  新增行为测试 `hooks/usePackData.test.tsx`（7 条）与 `src/windows/PackWindow/App.test.tsx`（7 条）。
  剩余 P2×4 / P3 六组未动（见第六节批次建议）。

---

## 一、总览

### 1.1 两窗口打开 / 关闭流程

| 维度 | NovelWindow | PackWindow |
| --- | --- | --- |
| 形态 | novel 域主窗，双视图 shelf↔editor；editor **懒挂载后常驻**，靠 display 切换 | 独立子窗，**即关即销单实例** |
| 打开 | `openWork` token（带 count 递增防重复消费）驱动 shelf→editor | `windowAPI.packWindowOpen` → 主进程 `createPackWindow`（已存在则 focus） |
| 上下文 | `novel-work-changed` 广播（`workId\0chapterId` 签名去重） | `pack-window-context`（主进程 did-finish-load 后 sendTo）+ `novel-work-changed` 双通道兜底 |
| 重挂载 | 不重挂（editor 常驻） | `CharacterPackHost` 以 `key={context.workId}` 重挂载 |
| 关闭守卫 | `window-close-guard`（dirty>0 才武装）/ `window-close-request` / `window-close-response` 三通道（ASK_TIMEOUT 120s） | 同左，另 `pack-close-guard.ts` 在面板内动作前先行 `guardPackBeforeAction` |
| 退出 | `beforeunload` flush 草稿 | `beforeunload` flush + `auth-logout` 时 `destroy()` |

### 1.2 数据加载与刷新时机

- **NovelWindow**：`useNovelData` 以 `loadSeqRef` 防竞态；书架 `includeContent:false` 只取元数据；正文按章加载；快照抽屉按需加载。**已知 work 的 openRequest 不 reload bundle**（见 P2-4）。
- **PackWindow**：`loadPackBundle` 全量文档装载；编辑只改内存 + 800ms 防抖写草稿（`novel_pack_drafts`）；保存 = 整文档事务（先落 `novel_pack_records` 盘点记录，再 delete+insert，成功后清草稿）；脏计数为派生值 `countNetChanges`。
- **境界**：唯一入口 `pack-realm.ts` 的 `setRealm`，回带进位/夹取后的 `RealmWritePlan.position`，调用方不得重算。

### 1.3 UI 状态同步

- 同窗口 `CustomEvent` + 跨窗口 `windowAPI.broadcast`（主进程排除发送者）；负载归一化在 `pack-config.ts` 的 `readEventDetail`；`origin` 字段防自触发（`pack-protagonist-changed` / `pack-name-changed` / `pack-realm-changed`）。
- 行囊侧 `syncMeta()` 订阅主角/作品名/境界变更，`bindEntity` 绑主角。

### 1.4 事件监听注册与销毁

- preload `windowAPI.on/off` 为**去重包装**（历史 P0-3 已修：`off` 现在按引用删得掉）。
- 渲染层订阅点集中在 `usePackPanel.ts`、`useNovelData.ts`、`usePackProtagonist.ts`；editor 侧订阅集中在 `useNovelEditorState`。
- **风险面**：双通道订阅样板在多个 hook 重复（P3）；跨窗口数据合并缺少「外部写入」事件（P1-1）。

### 1.5 严重度总览

| 严重度 | 数量 | 一句话 |
| --- | --- | --- |
| **P1 数据丢失 / 功能错误** | 3 | 快速记账跨窗静默丢物品；重置模板后行囊窗口持旧文档；换主角后境界显示旧主角 |
| **P2 健壮性 / 一致性** | 4 | 书架↔编辑器灵感不同步；空 workId 可开行囊；书架装载失败无错误态；auth-logout 绕过关闭守卫 |
| **P3 规范 / 死代码 / 重复** | 6 组 | 跨窗失效桥与死代码；重复订阅样板；误导性空态文案；重复 JSDoc 与过期注释；IPC reject 未收；全量 syncMeta 备查 |

先修这三条（改动小、收益大）：**P1-1（广播 + mergeExternalItem）→ P1-3（realmLink 同步替换）→ P2-5（空 workId 守卫，一处渲染层 + 一处主进程）**。

---

## 二、P1 — 数据丢失 / 功能错误

### P1-1 🔍 快速记账跨窗口静默丢物品

`src/shared/components/CharacterPack/*`（`registerPackQuickAdd` / `runPackQuickAdd` 模块级桥）+ `src/windows/NovelWindow/hooks/useNovelPage.ts`（`openPackWindow` / 记账入口）+ `electron/handlers/novel-pack-handlers.ts`（`novel-pack-quick-add`）+ `hooks/usePackData.ts`

- **触发链**：`registerPackQuickAdd`/`runPackQuickAdd` 是**渲染进程内模块级桥**。在 compat 单窗时代，记账面板与行囊同进程，桥直接命中。拆窗后：novel 渲染层调 `runPackQuickAdd` 永远 `handled:false` → 降级走主进程 `novel-pack-quick-add` **直接写 DB 草稿**；而 PackWindow 的内存文档对此**不知情**——行囊窗口的下次保存（手动或 800ms 防抖自动保存）以整文档事务覆盖，**先清草稿再落旧文档**。
- **后果**：用户刚记入的物品被静默丢弃，且草稿已被清，无恢复点。这是本报告唯一的**静默数据丢失**路径。
- **修法（最小化）**：
  1. novel 侧记账成功后广播 `pack-quick-added`（负载带 `workId` + `itemId`）；
  2. `usePackData` 订阅该事件，新增 `mergeExternalItem(workId, itemId)`：若内存文档中无此 itemId，则读 `draftGet` 解析出该条并 append-if-absent 合入文档；已有则不动作（幂等）。
  3. `readEventDetail` 归一化照旧复用。
- **影响**：仅新增一条广播与一个合并分支，不改现有记账/保存主链路；行囊窗口未打开时行为不变（仍走 DB 草稿，下次打开装载时天然带上）。
- **验证**：① 单测 `pack-quick-added` 合并的幂等性（已存在 itemId 不重复 append）；② 手工双窗口：novel 记账 1 件 → 行囊窗口保持打开 → 触发任一保存 → 重开行囊确认物品仍在；③ 回归既有 `novel-pack-quick-add` 单测。

### P1-2 🔍 重置模板后行囊窗口不失效，旧内存文档可覆盖重播种数据

`src/windows/PackWindow/App.tsx`（`key={context.workId}`）+ `hooks/useNovelPage.ts`（`handleResetTemplate`）+ `electron/handlers/novel-handlers.ts`（`resetTemplateBook`）

- **触发链**：`resetTemplateBook` 对**同一 workId** 重播种（代码注释自证），不换 id。PackWindow 的 `key={context.workId}` 因此**不重挂载**，且没有任何广播通知行囊窗口。
- **后果**：行囊窗口继续持重置前的内存文档；其下一次保存（手动/自动）用旧文档覆盖重播种后的数据——`novel_pack_drafts` 已随重置清掉，保存时反而把旧内容写回记录表。
- **修法（最小化）**：上下文载荷加 `nonce`（reset/删光作品时由 novel 侧生成并随 `pack-window-context` / `novel-work-changed` 下发），`CharacterPackHost` 的 key 改 `` key={`${workId}#${nonce}`} ``。同 workId 但 nonce 不同即重挂载，天然重新装载。
- **影响**：只改 key 拼接与广播负载；nonce 不影响现有上下文消费方（多余字段被忽略）。reset 后行囊窗口若正开着，会重挂载（等价于重开），符合用户预期。
- **验证**：① 单测 key 拼接规则；② 手工：行囊窗口开着 → novel 侧重置模板 → 行囊窗口应刷新为重播种内容；再触发一次保存，重开后数据仍是模板数据而非旧文档。

### P1-3 🔍 换主角后行囊显示旧主角的境界

`hooks/usePackPanel.ts`（PACK_PROTAGONIST_EVENT handler / `bindEntity`）+ `pack-realm.ts` / `realmState.link` 取值逻辑

- **触发链**：`pack-protagonist-changed` 的 handler 与 `bindEntity` 只 mutate `entityId`；`doc.realmLink` 里存的仍是**旧实体的 fromId**。`realmState.link` 优先取 `doc.realmLink`，于是境界显示的是旧主角的境界行。
- **后果**：换主角后境界区显示错人的境界；若此时用户点保存，`novel_links` 的「当前境界」行按旧 fromId 幂等写，把新主角的境界挂到旧实体上。
- **修法（最小化）**：`syncMeta` 返回后，仅当 `current.realmLink.fromId !== 新 entityId` 时，用 `meta.realmLink` 整体替换 `doc.realmLink`（相等则不动，避免无谓抖动）。
- **影响**：只动 realmLink 同步一处；不碰 `setRealm` 写入链路。未绑定主角的作品 `meta.realmLink` 为空时应清空而非保留旧值——需在替换分支里显式处理（无 link → 置空）。
- **验证**：① 单测：绑定 A→切 B，`realmState.link.fromId === B`；未绑定主角时 link 为 null；② 回归境界 stepper 进位/夹取单测（确保没碰 `setRealm`）；③ 手工双窗口换主角后核对境界区文案。

---

## 三、P2 — 健壮性 / 一致性

### P2-4 🔍 书架↔编辑器灵感不同步（编辑器常驻隐藏）

`pages/NovelPage/NovelPage.tsx`（openRequest 消费）+ `hooks/useNovelData.ts` + `pages/BookshelfPage/*`

- **触发链**：editor 视图懒挂载后**常驻**（display 切换，不卸载）。openRequest 对**已知 work 不 reload**（有意为之，避免打断编辑器）。但用户在书架改了一条笔记/作品名后切回编辑器，bundle 是陈旧的。
- **后果**：灵感面板显示旧内容；用户可能基于旧笔记续写。目前只观察到 notes/作品名不同步，章节元数据因按章加载基本不受影响。
- **修法（最小化）**：书架侧广播 notes 变更（现有 `novel-note-changed` 类事件即可承载，负载带 workId + note 摘要），`useNovelData` 订阅后**就地 patch `bundle.notes`**（零额外 IPC，不动其它字段，不触发重载）。
- **影响**：仅新增一处订阅与一处不可变 patch；不影响 editor 常驻策略。若担心 patch 与 load 竞态，patch 前比对 `loadSeqRef` 代数（与既有 seq 防护同一范式）。
- **验证**：① 单测 patch 幂等（旧事件不覆盖新 load）；② 手工：编辑器开着 → 书架改笔记 → 切回编辑器核对。

### P2-5 🔍 空 workId 可打开行囊，主进程播种 `work_id=''` 垃圾行

`NovelTopBar`（行囊按钮）+ `hooks/useNovelPage.ts`（`openPackWindow`）+ `electron/handlers/novel-pack-handlers.ts`（`ensurePackCharacterRow`）

- **触发链**：NovelTopBar 行囊按钮无 `works.length` 守卫；`isPackWindowContext` 对空串放行；主进程 `ensurePackCharacterRow("")` 不校验空 workId，直接播种 `work_id=''` 的角色行。
- **后果**：零作品状态下点行囊，DB 里留下 `work_id=''` 的垃圾行；行囊窗口打开后显示一份空壳，关闭再开仍复用该垃圾行。
- **修法（最小化）**：① 渲染层 `openPackWindow` 入口加 `works.length > 0` 守卫（无作品时按钮 disabled 或点击 toast 提示）；② 主进程 `ensurePackCharacterRow` 对空 workId 直接 return false，双保险。
- **影响**：纯防御性改动，不影响正常路径。按钮 disabled 会改变零作品时的可点性——若产品不希望 disabled，改用 toast 提示亦可。
- **验证**：① 单测主进程空 workId 拒绝；② 手工零作品状态点行囊按钮，确认不开窗且 DB 无 `work_id=''` 行。

### P2-6 🔍 书架装载失败无错误态 / 无重试，空态文案误导

`pages/BookshelfPage/hooks/useBookshelfData.ts`（`load`）

- **触发链**：`load` 无 try/catch，IPC 失败时 bundle 永为 null；书架据此渲染「书架还是空的」。
- **后果**：DB 抖动/损坏时用户看到空书架而非错误；无法重试，只能重启应用。`useNovelData` 已有 `loadError + 重试按钮` 的成熟范式，书架没跟上。
- **修法（最小化）**：仿 `useNovelData` 加 `loadError` state 与重试按钮；`load` 包 try/catch/finally，finally 里清 loading。
- **影响**：仅新增错误态渲染分支；正常路径不变。空态判断需改为 `!loadError && !loading && !bundle`，避免把失败态显示成空态。
- **验证**：① 单测 mock IPC reject → 错误态 + 点击重试重新 load；② 手工（可临时让 handler throw）核对文案。

### P2-7 🔍 auth-logout 用 `destroy()` 绕过关闭守卫

`electron/main.ts`（auth-logout 分支）

- **触发链**：登出时对 pack 窗直接 `destroy()`，关闭守卫三通道（`window-close-request/response`）完全没有机会询问。
- **后果**：行囊有未保存编辑（dirty>0）时，登出直接销毁窗口——渲染层的 `beforeunload` flush 依赖页面生命周期，`destroy()` 不等页面跑完，草稿可能只落了一半。记忆里已标注「已知未修」。
- **修法（最小化）**：对 pack 窗改走 `close()`，让 close-guard 有机会问（保存/放弃/取消）；若登出流程要求窗口必须消失，保留 destroy 但在其前 `standDownCloseGuards` + 显式 flush 草稿（或至少广播一次 `pack-flush-drafts` 让渲染层先落盘）。
- **影响**：改 `close()` 会多一步守卫交互（用户可能看到保存确认），登出耗时略增；这是安全性换体验，建议默认 `close()`。
- **验证**：① 手工：行囊改几个字段 dirty>0 → 登出 → 确认出现保存确认且草稿完整；② 回归 `close-guard` 既有单测。

---

## 四、P3 — 规范 / 死代码 / 重复实现（六组）

### P3-1 跨窗失效桥与死代码

- `registerPackQuickAdd` 面板路径在拆窗后**跨窗不可达**（novel 侧永远 handled:false）——与 P1-1 同源，修 P1-1 时顺带删除面板侧死路径或明确保留「同进程回退」语义并注释。
- `registerPackInsertIntoChapter` **无生产注册方**，只有测试在用——删注册入口或补生产调用，二选一，别留半座桥。
- `requestClosePackPanel` / `guardPackBeforeAction` **仅测试引用**——确认面板内已改用关闭守卫三通道后删除。
- `useNovelEditorState.ts` 的 `settingsLoadedRef` **只写不读**；`useNovelViewState.ts` 的 `openSnapshot` / `openSettings` **无消费方**——删。
- **验证**：`pnpm typecheck` + 全量单测；死代码删除后若有守卫测试引用需同步删测试。

### P3-2 双通道订阅样板重复 ×6

`usePackPanel.ts` / `useNovelData.ts` / `usePackProtagonist.ts` 等处，「CustomEvent + broadcast 双通道订阅 + origin 去重 + readEventDetail 归一化」样板重复 6 次。建议抽 `src/shared/novel/`（或 shared 下对应域）一个 `subscribePackEvent(event, handler)` hook，内部收口双通道与 origin 过滤；沿用 §跨页共享必须放 `src/shared/novel/*` 且不含 React 的纪律（hook 包装放页面侧）。
- **影响**：纯重构，行为等价；需逐点回归事件流。收益：后续加事件只改一处，避免 P1-1 这类「新事件忘了接双通道」的漏接。
- **验证**：重构后跑既有事件相关单测 + 手工双窗口事件流回归。

### P3-3 toast 自动消失重复 ×2

`pack-config.ts` 与另一处各有一份 toast 自动消失计时。抽到 shared 一个小 hook。
- **验证**：单测计时清理（卸载时 clearTimeout，别在卸载后 setState）。

### P3-4 误导性空态文案

装载失败（P2-6）时显示「书架还是空的」；修 P2-6 后空态需与错误态分离。另确认零作品 vs 零章节的 `emptyKind` 文案与触发条件一一对应（`emptyKind={works.length===0?"no-work":"no-chapter"}` 已正确，保留）。
- **验证**：手工两种空态 + 失败态各核对一次文案。

### P3-5 重复 JSDoc 与过期注释

- `useNovelData.ts:257-279` 上下两段重复 JSDoc，删一份。
- `useNovelShortcuts.ts` 注释残留「行囊」Esc 链描述（拆窗后 Esc 链已不在该快捷键文件内），更新为现状。
- **验证**：`pnpm typecheck`（注释不影响运行，此项纯卫生）。

### P3-6 `flushDraft` / `requestGuard` 未收 IPC reject + syncMeta 全量装载备查

- `usePackData.flushDraft` 与 close-guard 的 `requestGuard` 对 IPC reject 无 try/catch，主进程异常时会 unhandled rejection。按 store 侧 `persistChapterNow` 已修的先例（try/catch 收 reject 并置失败态）补齐。
- `syncMeta` 每次主角/作品名变更都全量 `loadPackBundle`。当前为**点击级低频**操作，可接受；备查：若将来做批量/高频元数据同步，改增量接口。
- **验证**：单测 mock reject → 不抛、状态正确；syncMeta 项记入备查不动作。

---

## 五、已逐行复核、确认健壮**不需改**的部分

| 主题 | 位置 | 结论 |
| --- | --- | --- |
| seq 竞态防护 | `useNovelData`（loadSeqRef）等 4 处 requestSeq/loadSeq | 代数比对完整，无过期响应覆盖 |
| StrictMode / React 纯度 | editor store、pack hooks | 无渲染期 `Date.now()/Math.random()`；setState 声明先于使用；updater 逐字段比 |
| 关闭守卫三通道 | `electron/close-guard.ts` | ASK_TIMEOUT + standDown 完整，preload on/off 引用可删（历史 P0-3 已修） |
| `beforeunload` flush | `useNovelPage` / `usePackData` | 关窗前草稿落盘，`needsFlushSave()` 判据正确 |
| 出场章数索引 | `useAppearanceStore` | 按章缓存 + 增量重扫 + 超阈值分片（BATCH 200 / 阈值 400） |
| 滚动复位 | `EditorPane` | rAF + cancelAnimationFrame，依赖 chapterId 不用对象引用（历史 bug 已修且有守卫） |
| 事件负载归一化 | `pack-config.ts` readEventDetail | 双通道负载统一解析 + origin 防自触发 |
| 书架元数据装载 | BookshelfPage | `includeContent:false` 落实，不拉正文 |
| 编辑器实例 | `EditorPane` | 会话唯一 + hydratingRef 区分灌入/输入 + IME 冻结上报 |

---

## 六、修复批次建议

1. **第一批（数据丢失，必修）**：P1-1 → P1-3 → P1-2。三条互不相交，可并行开发；P1-1/P1-3 各有单测可先钉。
2. **第二批（健壮性）**：P2-5（最小，一行守卫 + 主进程拒绝）→ P2-6 → P2-4 → P2-7（P2-7 涉及产品决策，先确认登出交互预期再动）。
3. **第三批（卫生 / 重构）**：P3 六组，随日常迭代携带；P3-1 死代码删除务必与 P1-1 同批做，避免出现「桥修好了但死路径没删」的中间态。

每批完成后跑：`pnpm typecheck`（注意必须用 `tsc -b` 方案式入口）+ 相关单测 + 双窗口手工回归清单（开行囊 / 记账 / 换主角 / 重置模板 / 登出五条主路径）。
