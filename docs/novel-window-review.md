# Novel 窗口代码审查报告

- **审查日期**：2026-10-08
- **审查依据**：`AGENTS.md`（架构分层 / §6.0 TypeScript / §6.1 样式与主题 / §6.1.2 组件库优先 / §6.2.1 状态归属 / §6.4 动画 / §6.5 迁移 / §6.6 测试）+ 历史踩坑记录
- **审查范围**：
  - 主进程 `electron/handlers/novel-handlers.ts`(1293) / `novel-pack-handlers.ts`(1101) / `db.ts` novel 表段
  - 渲染层 `src/windows/NovelWindow/**`（NovelPage / BookshelfPage / CharacterPack / store / hooks / services）
- **方法**：分区并行审查 + 交叉复核。标注 🔍 的条目为**已逐行读码复核确认**的结论，其余来自分区审查（同样有代码依据，但未二次复核）。
- **架构重构开关**：`novelArch = compat`（默认），本报告所有建议均按「必须兼容旧数据」给出。

---

## 一、总览

| 严重度 | 数量 | 一句话 |
|---|---|---|
| **P0 数据丢失 / 损坏** | 3 | 删作品触发清库误删全局灵感；保存失败后永不重试；跨窗口监听注销不掉 |
| **P1 功能错误** | 19 | 集中在字数统计、崩溃恢复、跨作品隔离、行囊汇总闸门与关闭链路 |
| **P2 健壮性 / 性能 / 规范** | 26 | 105 处原生 `<button>` 违反强制条款；N+1；缓存失效缺失；17 个纯函数缺单测 |

先修这三条（改动小、收益大）：**P0-3（preload 一行）→ P0-1（播种加判据）→ P1-5（收藏夹加 `parseJsonOrNull`）**。

---

## 二、P0 — 数据丢失 / 损坏

### P0-1 🔍 删光作品后自动播种，误删「全局灵感池」与行囊草稿

`electron/handlers/novel-handlers.ts:804-810` + `:523-546`

```ts
// 804：works 为空就无条件播种
if (works.length === 0) { seedTemplateBook(); ... }

// seedTemplateBook 内（527 / 542-544）
dbRun("DELETE FROM novel_notes");          // ← 全表，含 work_id='' 的全局灵感池
dbRun("DELETE FROM novel_pack_drafts");    // ← 未提交的行囊编辑
dbRun("DELETE FROM novel_pack_records");   // ← 盘点记录（回退点）
```

- **触发链（真实可达）**：用户把若干灵感通过 `novel-note-move(id, '')` 退回全局池（`preload.ts:116-117` 注释明确这是合法业务状态）→ 删掉最后一部作品 → 渲染层 `useNovelData.ts:548-562` 在 `remaining.length === 0` 时 `void load()` → 主进程判定 `works.length === 0` → 全表清库。
- **后果**：与任何作品无关的原创灵感被静默删除，无确认、无备份。`novel_pack_drafts` 里未提交的行囊编辑、`novel_pack_records` 的回退点同样清零。
- **修法**：播种前判断「是否真的首次使用」，不要只看 `works.length === 0`（可用 `config.novel_seeded` 标记或 `usage_log` 计数）；播种时只清模板 `workId` 名下的行，`work_id = ''` 的灵感必须保留。

> 附带：`novel-editor-reset-template`（`:800`）是**无二次确认**的一键清空全库入口，经 `preload.ts:85-86` 直接暴露。若 UI 上可见，建议复用导出路径（`:1229-1237`）已有的 `dialog.showMessageBox` 加确认。

### P0-2 🔍 保存失败后永不重试，且 UI 谎报「已转入快照」→ 静默丢字

`store/useNovelEditorStore.ts:128-147`、`hooks/useNovelEditorState.ts:116-123`、`hooks/useNovelPage.ts:1010-1019`、`novel-config.ts:238`

```ts
// store：失败只置 failed，且 await 无 try/catch
const ok = runner ? await runner.persistChapter(...) : false;   // IPC reject → 整个 async 抛错
set({ saveState: ok ? "saved" : "failed" });

// 两条兜底通道都只认 pending
if (useNovelEditorStore.getState().saveState === "pending") void editorActions.flushSave();
```

- **后果（两层）**：
  1. IPC 抖动一次 → `saveState = "failed"` → 30s 兜底与 `beforeunload` flush **都不再触发**，此后若用户不再敲键，正文只存在于内存 `draftMap`，关窗即丢；
  2. 顶栏文案 `failed: "已转入快照"` 与事实相反——快照是主进程在 `saveChapter` 同事务里写的，保存失败根本不会有快照，用户完全不会察觉；
  3. `await runner.persistChapter()` 无 `try/catch`，IPC reject 时 `void persistChapterNow(...)` 变成 unhandled rejection，`set({saveState})` 永不执行 → **顶栏永久卡在「保存中」**。
- **修法**：`persistChapterNow` 包 `try/catch` 并置 `failed`；兜底条件改为 `pending || failed && 草稿与已落库正文不一致`；`failed` 文案改成「保存失败，稍后重试」；`flushSave` 返回 `boolean`，`handleSaveNow`（`useNovelPage.ts:214-217` 无条件弹「已保存」）按结果选文案。

### P0-3 🔍 跨窗口订阅注销不掉（全应用级，不止 novel）

`electron/preload.ts:225-230`

```ts
on:  (event, handler) => { ipcRenderer.on(event, (_event, ...args) => handler(...args)) },  // 匿名 wrapper
off: (event, handler) => { ipcRenderer.removeListener(event, handler) },                    // 按引用删，永远匹配不到
```

- **后果**：`removeListener` 按引用比对，删不掉那个匿名 wrapper → 每次开关面板泄漏 2 个 `ipcRenderer` 监听（含整个闭包）。开合 N 次后，一次主角/境界变更会触发 N 次 `syncMeta()`（每次都是一遍完整 `novel-pack-load` 全表读）。属于「越用越卡」型缺陷。
- **波及订阅点**：`usePackPanel.ts:383-388 / 410-416`、`useNovelData.ts:182-187`、`usePackProtagonist.ts:63-68`。
- **修法**：preload 里用 `Map<event, Map<handler, wrapper>>` 缓存，`off` 查表删真 wrapper；或让 `on` 直接返回 unsubscribe 函数（更彻底，需同步改调用方）。

---

## 三、P1 — 功能错误

### P1-1 🔍 字数基线取错 → 今日字数 / 码字速度被整章字数污染（可为负）

`components/EditorPane/index.tsx:293-304` + `store/useNovelEditorStore.ts:189-218`

```ts
// EditorPane：整篇替换 dispatch 也走同一条上报通道
handlersRef.current.onChange(
  update.state.doc.toString(),        // next = 新章正文
  update.startState.doc.toString(),   // base = 变更前正文（上一章 / 空串）
);
// store
const previous = state.draftMap[chapterId] ?? baseContent ?? "";
```

`previous === next` 的早返回**在任何真实路径上都命中不了**（`??` 不会跳过空串）：

| 场景 | previous | delta |
|---|---|---|
| 首次进入编辑器 | `""` | **= 整章字数**（打开 4200 字的章，「今日 +4200」立即出现） |
| 切到无草稿的 B 章 | A 章正文 | `words(B) - words(A)`（A 5000 → B 3000 ⇒ **-2000**，进度条倒退） |

`EditorPane:299-301` 的注释（"previous === next，store 据此提前返回"）与实现不符；`useNovelEditorStore.test.ts:97` 手工构造 `setContent(id, X, X)` 绕开了真实路径，所以测不出来。

- **修法**：EditorPane 区分「用户输入」与「程序化灌入」两条通道 —— 灌入走 `hydrateDraft(chapterId, content)`（`delta: 0` 语义、不排保存），只有真实输入才传 `update.startState.doc`；store 侧加第二道防线；补一条走真实 EditorPane 路径的集成测试。

### P1-2 🔍 起名收藏夹永远读不回来，且首次「加收藏」会清空历史

`hooks/useNovelData.ts:129` + `novel-utils.ts:1072` + `services/novel-service.ts:351`

```ts
const favoritesJson = await fetchNameFavorites();        // 返回 string | null（原始 JSON 字符串）
setNameFavorites(sanitizeNameFavorites(favoritesJson));  // 少了 parseJsonOrNull
// sanitizeNameFavorites 首行：if (!Array.isArray(raw)) return [];   → 字符串恒返回 []
```

同文件 `:111` 的 `sanitizeCustomTypes(parseJsonOrNull(raw))` 才是正确写法。
- **后果**：每次启动收藏夹恒为空；`useNovelData.ts:1056-1077` 的 `addNameFavorite` 用 `current`（= `[]`）拼新数组后整读整写 → 重启后第一次收藏把库里原有收藏**全部覆盖**。
- **修法**：`sanitizeNameFavorites(parseJsonOrNull(favoritesJson))`。

### P1-3 🔍 删除作品不级联清理 `novel_pack_*`，留下一整棵孤儿

`electron/handlers/novel-handlers.ts:439-486`

事务里清了 chapters / snapshots / volumes / notes / outline_entries / entities / links / level_* / works，**唯独没有任何 `novel_pack_*` 清理**（全文件 pack 相关只有 `seedTemplateBook` 的 `:535-544`）。而同文件 `:534` 的注释写着「行囊随作品一起清空，行囊角色留着会成孤儿」——作者知道这条约束，但 `novel-work-delete` 没落实。

- **后果**：`novel_pack_characters`（含 `work_id`）及其 9 张子表全部残留；`entity_id` 指向已删除的 `novel_entities.id`；这些行只能按 `work_id` 查到，删了作品后**永远查不到也删不掉**。多态表 `novel_pack_modifiers` 的 `owner_id` 仍指向存在的 item/skill，所以 pack-save 的孤儿清理也扫不到。
- **修法**：同事务内先 `SELECT id FROM novel_pack_characters WHERE work_id = ?`，再按 `character_id` 删 9 张子表；注意 `modifiers` 必须先于 items/skills 删（同 `novel-pack-handlers.ts:759-772` 顺序约束）。

### P1-4 🔍 行囊：状态载体共用一个 key，passive 状态被误杀 / sustained 开关串扰

`hooks/usePackPanel.ts:1029`（`ownerId: state.character.id`）、`:197-210`、`pack-utils.ts:85-87`、`:229-231`

所有 `ownerType === "status"` 的 effect 共用同一个 `ownerId`（角色 id），`buildActiveCarriers` 把它们折叠成**同一个** `status:<charId>` 键：

- **全部状态都关闭** → 集合里没有 `status:<charId>` → **所有 passive 状态被静默丢弃**（passive 按约定是「计入」档，不该受载体开关影响）；
- **任意一条 sustained 开启** → 键进集合 → UI 上 passive 的开关（见 `StatusModule/index.tsx:19-22, 82-88`）彻底失效。

- **修法**：状态每条用自己的 `mod.id` 作 `ownerId`；或在 `buildActiveCarriers` 里按 `mod.id` 逐条入集合，不按 `ownerId` 折叠。

### P1-5 🔍 熟练度缩放对装备 / 状态宿主静默 ×0.5

`pack-utils.ts:236-242` + `hooks/usePackPanel.ts:212-216` + `components/EffectEditor/index.tsx:261-270`

`proficiency` 只有 `skill.id` 的键，而 `computeSummary` 里是 `input.proficiency[mod.ownerId] ?? 0` → 非技能宿主查不到 → ratio 0 → `factor = minScale = 0.5`（`:104-125`）→ **贡献值腰斩**，且列表仍显示原始数值（`ModifierList/index.tsx:132-135`），只在汇总与 `SourceDetailDrawer` 里看得出来。单测只覆盖了 skill 宿主（`pack-utils.test.ts:195-215`）。

- **修法**：`ownerType !== "skill"` 时不缩放；`EffectEditor` 按宿主类型隐藏该开关。

### P1-6 行囊写路径零校验，一条脏数据导致「从此每次保存都失败」且无诊断

`electron/handlers/novel-pack-handlers.ts:720-967`

文件里定义了 `NATURES / OPS / OWNER_TYPES` 三个白名单（`:455-457`），**只在读方向用**，写方向 `modStmt.run(m.ownerType, m.nature, m.op, ...)` 直接入库。DB 侧有三处 `CHECK`（`db.ts:318/321/325`）与多处 `NOT NULL`。

- **后果**：任一值越界 → `CHECK constraint failed` → 整事务回滚 → 只返回裸 `false`，原因仅进 `console.error`。因为是「整文档替换」，**每次保存都在同一位置失败**，用户在 UI 里怎么编辑都存不进去，也不知道是哪一条出问题。
- **修法**：写入前用 `:455-457` 白名单兜底（非法值落默认值）；对每条子行单独 try/catch，回传 `{index, id, error}`。

### P1-7 子表全部裸 `INSERT`，跨 character 的 id 冲突会让整笔保存永久失败

`novel-pack-handlers.ts:819-954`

删除按 `character_id` 维度（`:782-791`），但 `id` 的 UNIQUE 是**全表维度**。若 payload 里出现「库中已存在但不属于当前 character」的 id（如 `modifier.ownerId` 指向别的角色的宿主），第一条 DELETE 不匹配、孤儿清理（`NOT IN 全部 items`）也不匹配 → 每次都在同一位置撞主键 → 用户无法自救。

- **修法**：子表改 `INSERT ... ON CONFLICT(id) DO UPDATE SET ...`；主进程侧校验 `modifier.ownerId ∈ payload.items ∪ payload.skills`（`status` 则必须等于 `characterId`），越界项丢弃。

### P1-8 行囊关闭链路三个洞：Esc 绕过拦截、卸载无 flush、失败照样关

- **A3** `index.tsx:81-87` 输入框内 Esc 只 `return` 不 `stopPropagation` → `useNovelShortcuts.ts:68-71` 不区分输入元素 → `useNovelPage.ts:951-954` 直接 `closePack()` → **没有 CloseGuard、没有 flushDraft**，防抖最后一段输入蒸发。
- **A5** `usePackData.ts:147-165 / 211-224`：切作品与卸载都只有 `clearTimeout`，无 `flushDraft` 兜底。连续打字时防抖每帧重置，可能吃掉整段连续输入。
- **A7** `usePackPanel.ts:454-458`：`await data.save()` 后**无条件** `onClose()`，失败照样关闭且无 toast（`saveFailed` 状态随即随组件卸载消失）。

- **修法**：Esc 分支对 INPUT/TEXTAREA/contentEditable 直接 return；`usePackData` 加 unmount + workId 变更前 `flushDraft()`；`if (!ok) { setCloseGuardOpen(false); showToast("保存失败", "error"); return; }`。

### P1-9 崩溃恢复的两处判定缺陷

`novel-handlers.ts:886-922` + `:361-375`

1. **孤儿快照屏蔽恢复**：对不存在的章节 id 保存时（`:890` 查不到就当 delta 0），仍会写入一条 `chapter_id` 悬空的快照并 `return true`。而 `buildRecovery()` 取的是**全局最新**快照（`:362`）→ 这条孤儿快照 created_at 最新 → **崩溃恢复提示被彻底屏蔽**，直到别的章产生新快照。
2. **只检测恰好拥有全局最新快照的那一章**：A 章写了 500 字触发快照 → 切 B 章写少量（不足 500 字 / 5 分钟，不产生快照）→ 崩溃。`buildRecovery` 查到的是 A 章快照，`A.content === snapshot.content` → `return null` → **B 章未保存改动被完全忽略**。

- **修法**：① 事务开头查不到章节就 `return false` 并中止；② 恢复判定下推到「有未落库差异的章节」（`SELECT s.* FROM novel_snapshots s JOIN novel_chapters c ON c.id = s.chapter_id WHERE c.content <> s.content ORDER BY s.created_at DESC LIMIT 1`）。

### P1-10 写操作命中 0 行仍返回 `true`，前端无法区分成功与失败

`novel-handlers.ts:434 / 962 / 969 / 975 / 1008 / 1094 / 1062 / 1088 / 1123 / 1194` 等 10+ 处

```ts
dbRun("UPDATE novel_chapters SET title = ? WHERE id = ?", [title, id]);
return true;   // 影响 0 行也 true
```

渲染层 `useNovelData.ts` 里这类写调用大多是 `void xxxRemote(...)`（不 await 不 catch），UI 已乐观更新 → 用户以为改成功，下次启动数据回滚且无提示。
- **修法**：rename / move 类必须命中，`return dbRun(...).changes > 0`；删不存在的行可放宽。

### P1-11 快照列表无陈旧响应守卫 → 回滚可能把 A 章正文写进 B 章

`hooks/useNovelData.ts:1281-1284` + `NovelPage.tsx:137-140` + `useNovelPage.ts:456-468`

`loadSnapshots` 无请求序号；`handleRollback` 直接 `applyExternalContent(data.activeChapterId, content)`，**不校验快照属于哪一章**。快照抽屉开着时切章 → 两个请求并发，先发的 A 章响应后到会覆盖成 A 的列表 → 点回滚把 A 章历史正文写进 B 章并立即落库。
- **修法**：加 `requestSeqRef`（参照 `usePackProtagonist.ts:31-45`）；`handleRollback` 校验 `snapshot.chapterId === activeChapterId`。

### P1-12 `load()` 无 catch、无并发序号 → 异常时编辑器永久空态

`hooks/useNovelData.ts:108-133`

只有 `finally { setLoading(false) }`，没有 `catch`。`fetchNovelBundle()` reject 时 bundle 保持 `null`，页面无任何错误态（`void load()` 产生未捕获 rejection）。并发入口有 4 处（挂载 effect、删最后一部作品、resetTemplate、`NovelPage.tsx:121` 的 `reload()`），旧响应后到会覆盖新 bundle。
- **修法**：加 `requestSeqRef` + `catch` 进入可重试错误态。

### P1-13 跨窗口境界事件不校验 `workId`

`hooks/useNovelData.ts:174-188`

对比 `usePackProtagonist.ts:58` 有 `if (detail.workId !== workId) return;`，这里没有。`applyRealmLinkChange` 只校验 `fromId` 是否在当前 bundle（bundle 含**全部**作品要素）→ 别作品/别窗口的境界变更会被打进当前内存 links。
- **修法**：补 `detail.workId !== activeWorkId` 直接 return。

### P1-14 载入回退点会把主角绑定一起回滚

`hooks/usePackData.ts:271-279`（`revertAll` 明确保留 `entityId`）vs `:287-296`（`restoreFromRecord` 直接 `setDocState(restored)`，record payload 是含 `entity_id` 的整份快照）

- **后果**：载入设主角之前的回退点 → `entityId` 变旧值/空 → 境界模块回到未绑定或绑到旧实体；此后 `setRealm` 按陈旧 entityId 写 `novel_links`，**污染别的实体 / 别的书的关系行**。
- **修法**：`restoreFromRecord` 与 `revertAll` 一致，保留当前 `entityId`。

### P1-15 等级体系读取不带 `work_id` → 跨作品串数据

`electron/handlers/novel-pack-handlers.ts:593-611`

`novel_level_systems.work_id` 是 NOT NULL（`db.ts:159`），等级体系按作品私有，但 `readLevelSystems()` **全表捞取且连 workId 参数都没有**。用户有 ≥2 部作品且都建过体系时，行囊会把**另一部小说的等级体系**返回过来；`novel-link-set`（`:1010-1053`）对 `toId` 也不校验归属 → 写出跨作品 `novel_links`，界面上看不出来。
- **修法**：`readLevelSystems(workId)` + `WHERE work_id = ?`；rungs 用 `WHERE system_id IN (...)` 一次取回；`novel-link-set` 补「to_id 与 from_id 同作品」校验。

### P1-16 检索结果缓存永不失效

`store/useSearchStore.ts:50-51 / 93-97 / 108-119`

`searchedFor` 只在换关键词、清空、换作品时失效，**没有任何「正文本体变了」的失效通道**。搜「灵潮」得 3 处 → 又写了 5 处 → 切范围再切回、或原样重输同一关键词 → 仍是 3 处。
- **修法**：把章节内容版本并入缓存键；`chapters` 变化时调 `invalidateSearch()`（只清 `searchedFor`，不重发请求，保持「注册不触发请求」约定）。

### P1-17 排版设置每次改动打一次 IPC，拖滑块连发

`store/useNovelEditorStore.ts:242-262` + `components/SettingsDrawer/index.tsx:65-119`

`updateSetting` / `toggleAnnotationType` 结尾直接 `runner?.persistSettings(...)`，无防抖、无错误处理；antd `Slider` 的 `onChange` 在拖动中连续触发 → 拖一次字号 = N 次 IPC + N 次全树重渲染。
- **修法**：加 300ms 防抖（与 `PANEL_WIDTH.debounceMs` 同款）。

### P1-18 保存态是全局单值，换章时旧章落库会把新章状态覆盖成「已保存」

`store/useNovelEditorStore.ts:154-175`

`scheduleSave` 在 `:165` 落旧章 → 内部 `set({saveState:"saving"})` → `:168` 置 `pending`（新章在途）→ 旧章完成后 `:143-146` 又置 `saved` → **新章输入还没落库，顶栏却显示「已保存」**；两章并发保存还会互相覆盖 `lastSavedAt`。
- **修法**：保存态改为 `Record<chapterId, SaveState>`，展示按 `activeChapterId` 取值；或给 `persistChapterNow` 加章节票据。

### P1-19 乐观写全部无失败补偿

`useNovelData.ts` 中 `void saveEntity(...)` / `void addLinkRemote(...)` / `void removeNoteRemote(...)` 等 **20+ 处**：本地先改、远端结果丢弃，失败无回滚无提示，UI 与库的不一致会一直持续到下次重载。
- **修法**：统一封装 `runWrite(remote, rollback)`，失败时回滚 + toast。

---

## 四、P2 — 规范符合性与性能

### 规范（§6.1.2 组件库优先是**强制条款**）

| # | 条款 | 结论 |
|---|---|---|
| 1 | **§6.1.2 原生 `<button>`** 🔍 | **违规：105 处 / 30 个文件**（`CharacterPack` 已清零，其余全中）。`OutlinePanel` 16、`EntityDetail` 15、`NameGeneratorPanel` 8、`NovelTopBar` 7、`InspirationPanel`/`SupportPanel` 各 6、`SettingsDrawer`/`SearchPanel`/`EntityCard`/`IdeaNoteCard` 各 4。原生 `<input>/<select>/<textarea>` **0 处**，`<button>` 嵌套 **0 处**。三种例外（CodeMirror / Memo 镜像 / 行内 textarea）**均不适用** —— 特别点名 `EditorPane/index.tsx:548`（章节标题点击改名）与 `:587`（空态 CTA）不属于例外。 |
| 2 | **§6.1.2 div/span 冒充按钮** | **3 处**：`BookCard/index.tsx:23-34`（卡片入口）、`ChapterTreeItem/index.tsx:132-138`（状态切换 `<span role=button>` **连 tabIndex 都没有 → 键盘不可达**）、`:161-173`（整行可点）。改 `Button` 时必须同步按 §6.1.2 第 4 条改成「行容器 + 两个并列真按钮」，否则会引入真嵌套。 |
| 3 | **§6.1.1 硬编码色值** | SCSS **5 处违规**：`ChapterTreeItem/index.scss:182` 的 `var(--app-danger, #d4380d)` —— **themes.scss 里根本没有 `--app-danger`（只有 `--app-error`），这个 var() 恒回退成死值**；`CharacterPack/index.scss:13` 遮罩（应用 `--app-mask`）；`EntityTypeManager/index.scss:103`；`OutlinePanel/index.scss:296`、`SupportPanel/index.scss:218` 的 `#fff`（应用 `--app-text-inverse`）。另有 4 处可豁免（压在用户自选封面色上的高光/阴影、mask 的 `#000`）。**TSX 内联样式 0 处硬编码，合规**。 |
| 4 | **§6.1.1 index.scss 必须被 import** | **合规（59/59 已引入）**。附带 3 处重复 import：`main.tsx:6` 与 `App.tsx:8` 重复引根级；`RecordDrawer/index.tsx:6-7`、`SourceDetailDrawer/index.tsx:6-7` 各重复两行相同 import。 |
| 5 | **§6.0 禁止 any** | **合规（0 命中）**。窗口内的 `any` 全是字符串字面量（`"male"\|"female"\|"any"`）与局部变量名 `anyModalOpen`。 |
| 6 | **§2.2.0 窗口隔离** | **合规**：无跨窗口代码 import，SettingsWindow 经 IPC 唤起。`NovelFloatButton` 只有 1 个使用方（BaseWindow/HomeSidebar）却放在 `shared/` —— 违反 §2.2.1，建议下沉。 |
| 7 | **§6.4 布局动画** | 布局折叠**全部合规**（SupportPanel / ChapterTree / PackModuleShell 走 CSS 过渡）。**1 处软违规**：`NovelPage.tsx:414` 行囊面板条件渲染，既无过渡（开合瞬跳）也会丢掉面板内全部状态，与 §6.2 第 3 条信号冲突。建议常驻渲染 + `is-collapsed`。 |
| 8 | **§6.6 纯函数单测** | **17 个纯函数缺单测**，集中在 `pack-utils.ts`（`carrierKey`/`isItemActive`/`clamp`/`castOwnerIds`/`sortLadder`/`clampRealm`/`stepQty`/`matchesKeyword`/`formatAttrValue` 等 11 个）、`bookshelf-utils.ts`（`formatThousands`/`isUnassignedNote`）、`novel-utils.ts`（`formatRelativeTime`/**`sanitizeNameFavorites` 必须补，它是外部输入守卫**）。4 个 store 已全覆盖。 |
| 9 | **重复实现** | `formatRelativeTime` **三份**（bookshelf-utils:80 / novel-utils:77 / pack-utils:561）、`formatThousands` **两份**。已满足「两个以上使用方」门槛，应抽到 `src/shared/utils/format.ts`。 |

### 性能

| # | 位置 | 问题 |
|---|---|---|
| 10 | `NovelPage.tsx:152-174` + `EntityPanel/index.tsx:177` | 出场章节查询无缓存，`getAppearances` 在渲染体内遍历**全书每章**跑 `findTermMatches`（O(字数×词条)）。自动保存每 800ms 触发根重渲染 → 详情卡开着时每 800ms 全本扫一遍。应复用 `useAppearanceStore` 的按章缓存 + 按 entityId 建倒排索引。 |
| 11 | `novel-service.ts:131-143` | `searchAcrossBook` 对**每章**都做 `content.split(trimmed)` 分配数组，且 `content.replace(/\s+/g," ")` 在 `filter(count>0)` **之前**执行 → 非命中章也跑全文正则。百章长篇每次防抖触发就是一遍全书级同步 CPU 工作，会卡输入法。改 `indexOf` 循环计数，只对命中章建 snippet。 |
| 12 | `novel-handlers.ts:442-479` | `novel-work-delete` 事务内 N+1 删除（逐章删快照、逐要素删 links、逐等级删换算）。长篇产生上千条独立 DELETE，每条都重新 `prepare`。改成集合删除（子查询 `IN`）。 |
| 13 | `novel-handlers.ts:821-836`、`novel-pack-handlers.ts:593-611` | levelSystems 的 rungs N+1 查询。改 `WHERE system_id IN (...)` 一次取回后 JS 分组。 |
| 14 | `NovelPage.tsx:114-134` | 首次从书架打开编辑器**必然发两次**全量 `fetchNovelBundle`（`openWork` 与挂载 effect 各一次）。 |
| 15 | `useNovelData.ts:111-129` | `load()` 三个 IPC 串行，且 `setBundle` 被第二个请求拖后（注释写「并行加载」与实际不符）。三个请求无依赖，应 `Promise.all`。 |
| 16 | `useNovelPage.ts:645-648`、`NovelPage.tsx:176-179` | `useMemo` 依赖写成 `[data]`（`data` 每次渲染新建对象字面量）→ 记忆化完全失效。 |
| 17 | `useNovelPage.ts`（约 40 处） | 大量 `useCallback` 依赖 `[data, view]` → 回调身份每次渲染都变 → `useNovelShortcuts.ts:76` 的 keydown 监听每次渲染都解绑/重绑。建议把 `useNovelData` / `useNovelViewState` 的返回值整体 `useMemo` 化。 |
| 18 | `useNovelViewState.ts:141-166` | 拖右栏时 effect 依赖含 `rightWidth`，每帧解绑/重绑 resize 监听。该 hook 已建 `rightWidthRef` 但依赖数组没用上。 |
| 19 | `useNovelViewState.ts:97-103` | 右栏宽度 300ms 防抖，cleanup 只 `clearTimeout`；拖完立刻关窗就丢了（位置记忆有 `beforeunload` 兜底，宽度没有）。 |
| 20 | `useNovelData.ts:684` | `sort: bundle.entities.length + 1` 用**全库**要素数，跨作品会撞号。应按 `activeWorkId` 过滤后再取。 |

### 健壮性

| # | 位置 | 问题 |
|---|---|---|
| 21 | `novel-handlers.ts:419-428 / 941-958 / 1024-1048 / 1067-1084 / 1099-1119 / 1130-1139` | DTO 零校验。缺字段时 `JSON.stringify(undefined)` → 绑成 NULL → 撞 `NOT NULL` 抛错 → IPC reject（配合 P0-2 变成静默丢字）。建议入口做最小必要校验并补默认值。 |
| 22 | `novel-handlers.ts:983 / 1013 / 1214` | 三个 order 接口未校验 `updates` 是数组（`undefined` 时 `for...of` 抛 TypeError）；`novel-chapter-order` 不校验 `volumeId` 存在（无外键）→ 章节被挂到不存在的卷下，从左栏消失但数据还在。 |
| 23 | `novel-handlers.ts:489-497` | 删章只清快照，`novel_outline_entries.chapter_id` / `novel_pack_items.source_chapter_id` / `novel_pack_records.chapter_id` 悬空。 |
| 24 | `novel-handlers.ts:815 / 819 / 838 / 847` | 缺 `ORDER BY`。渲染层有排序兜底所以目前不乱，但 `useNovelData.ts:125` 的「无位置记忆取首章」会随顺序变化选中不同章。 |
| 25 | `novel-handlers.ts:895-898` | `shouldSnapshot` 只看正向增量，删字场景最长 5 分钟无快照；`:906-911` 环形裁剪 `ORDER BY created_at` 在同毫秒并列时顺序不定（应加 `rowid DESC`）。 |
| 26 | `novel-handlers.ts:404-414` | `novel-config-get/set` 无键名白名单，渲染层可覆盖 `novel_editor_session`（干扰崩溃恢复）、`legacy_migration_completed`（影响迁移）等主进程内部键。建议加 `novel_*` 前缀白名单 + 内部键黑名单。 |
| 27 | `novel-pack-handlers.ts:729-735` | 回退点判定 `hasData` 漏了 `modifiers` 与 `character` 本身 → 首次从空白建行囊保存时**没有任何记录可回退**，「撤销到上次保存」失效。 |
| 28 | `novel-pack-handlers.ts:970-984` + `usePackData.ts:211-224` | 草稿「复活」：编辑后 800ms 内点保存 → 主进程已删草稿，但防抖定时器到点后用旧闭包重建草稿行 → 重开面板显示「保存 (1)」并触发关闭拦截，实际并无未保存改动。建议主进程侧加时间戳保护，渲染侧 `save()` 一开始就 `clearTimeout`。 |
| 29 | `db.ts:251-263` | `novel_pack_characters` 缺 `work_id` 索引（`ensurePackCharacterRow` 的 `WHERE work_id = ? ORDER BY sort_order LIMIT 1` 每次 load 全表扫）；整文档替换无版本列，并发冲突无法检测。 |
| 30 | `usePackData.ts:192-203` | `mutate` 在 `setState` updater 内部调 `setDirty()` —— React 明确禁止在 updater 里做副作用；项目用了 `StrictMode` → updater 双调用 → **每次编辑 dirty +2**。建议 `{doc, dirty}` 合进同一个 `useReducer`。 |
| 31 | `AttributesModule/index.tsx:98-106` | 属性分组改名用 `<section key={groupName}>` → 改一个字就换 key → React 卸载重建 → **输入框失焦 / IME 中断**，只能逐字重命名。key 换成分组 id，或本地草稿 + onBlur 提交。 |
| 32 | `useNovelShortcuts.ts:34-76` | 快捷键不判断焦点是否在输入框：在「新建作品」弹框 Input 里按 Ctrl+Enter 会新建章节并切走；章节标题输入框按 Esc 会同时退出标题编辑和专注模式。建议加 `isEditableTarget` 守卫。 |
| 33 | 死代码 | `resetForChapter`（`useNovelEditorStore.ts:99 / 282`，全仓无调用 → 切章不清选区）、`resetAppearances`（`useAppearanceStore.ts:111`，无调用 → 切作品后短暂读到上一本书的 counts）、`replaceDoc` / `exportDraftJson`（PRD G-4 逃生出口**没接线**）、`inventoryKeyword` / `prefs.form` / `changedReadAt`。 |
| 34 | `pack-utils.ts:40` | `HAN_PATTERN` 缺 CJK 扩展 B（U+20000 起，需代理对的生僻字不计入字数）。建议加 `u` 标志并补区间。 |
| 35 | `novel-utils.ts:164-189 / 199-215` | 用小写串的 `indexOf` 下标去 `slice` 原串。`toLowerCase()` 改变长度时（如 `İ`）索引错位，命中段被切错甚至被 filter 丢掉。命中判断用小写串、切片用原串下标。 |
| 36 | `useNovelEditorStore.ts:111 / 205-209` | 会话采样与今日统计**不跨天/跨作品重置**（窗口常驻进托盘跨过零点后「今日 +N」继续累加昨天的值）。 |
| 37 | `useNovelEditorStore.ts:221-228` | `applyExternalContent` 即使内容相同也 `scheduleSave()`，多一次落库 + 一次快照写入。加 `if (state.draftMap[chapterId] === next) return;`。 |
| 38 | `novel-service.ts:34-36` | `fetchNovelBundle` IPC 返回值**零结构校验**直接当 `NovelBundle`（同类 config 键都做了 sanitize）→ 主进程返回缺字段时 `load()` 抛错、bundle 停留 null → 编辑器永久空态白屏。建议加 `sanitizeBundle`。 |
| 39 | `novel-pack-handlers.ts:1000` | `record-list` 的 `limit` 未 clamp，传 0/负数 → SQLite `LIMIT -1` = 不限，一次捞全表。 |
| 40 | `novel-pack-handlers.ts:663/693/970/986/993` | load / protagonist-get / draft-* / record-list 无 try/catch，畸形参数时 TypeError 直接 reject 而非契约里的 `false`/`null`。 |
| 41 | `useNovelData.ts:552-554` | 删当前作品后按存储顺序 `bundle.chapters.find(...)` 取首章，与展示顺序（`groups`）不一致，可能跳到中间某章。应改用 `groups[0].chapters[0]`。 |
| 42 | `useNovelViewState.ts:112-114` | toast id 用 `Date.now()`，同一毫秒两次提示 key 冲突。改自增 ref。 |
| 43 | `usePackPanel.ts:434-442` | 5 分钟自动保存计时器 deps 含 `data`（每次渲染新对象）→ 任何宿主重渲染都重置倒计时，「5 分钟无操作」变成「5 分钟无宿主渲染」。 |
| 44 | `pack-realm.ts:154` | 关系名 `"当前境界"` 硬编码，绕过 `pack-config.ts:7-11` 已导出的 `PACK_LEVEL_RELATION`（全项目无人 import）→ 将来改名会「隔着两张皮」静默不同步。 |
| 45 | `usePackPanel.ts:638-661` | `shrinkSlotCapacity` 用 `(item.slotIndex ?? 0) >= next`，`slotIndex` 为 null 的穿戴物不会被退回 → 留在槽位上但 `isItemEquipped` 为假 → 界面显示「穿戴但不生效」的幽灵项。 |
| 46 | `CloseGuardModal/index.tsx:52` | 文案「草稿已持久化」与行为不符 —— 「丢弃改动」走 `revertAll → clearPackDraft`，草稿会被清空。 |
| 47 | `SkillsModule:120-126`、`ModifierList:180-186` | 删除无确认，而 Inventory/Attributes 都做了确认，标准不一致。 |
| 48 | `SummaryModule:92-110`、`SourceDetailDrawer:74-98` | 覆盖（override）生效时 add/percent/mul 全部不参与最终值，但分段照常显示。建议给无效条目加删除线/置灰。 |

---

## 五、修复优先级建议

**第一批（改动小 / 收益大，建议立刻做）**
1. P0-3 `preload.ts` 监听注销（一行改法，影响全应用）
2. P0-1 播种加「是否首次使用」判据，保留 `work_id=''` 灵感
3. P1-2 收藏夹补 `parseJsonOrNull`
4. P1-1 字数基线区分「用户输入」与「程序化灌入」
5. P0-2 保存失败重试 + `try/catch` + 修正「已转入快照」文案

**第二批（正确性）**
6. P1-3 删作品级联清理 `novel_pack_*`
7. P1-4 / P1-5 行囊汇总闸门与熟练度缩放
8. P1-9 崩溃恢复两处判定
9. P1-8 行囊关闭链路三洞
10. P1-10 / P1-11 / P1-12 / P1-13 写返回值与并发守卫

**第三批（规范与性能，可排期）**
11. 105 处原生 `<button>` → 分批替换（先把 `pack-ui-kit.test.ts` 的守卫 ROOT 扩到整个 NovelWindow，防止回潮）
12. 5 处硬编码色值（含 `--app-danger` 恒回退的真 bug）
13. N+1 与出场/检索缓存
14. 17 个纯函数补单测（优先 `sanitizeNameFavorites`）

---

## 六、已检查且未发现问题的项（避免重复排查）

- **SQL 注入**：novel 相关 handler 全部 `?` 绑定，无标识符/IN 列表拼接；导出文件名做了 `[\\/:*?"<>|]` 过滤。
- **事务同步性**：所有 `db.transaction()` 回调均为纯同步，无事务内 `await`。
- **多态加成删除顺序**：`modifiers` 先于宿主、孤儿清理排在宿主删除之前，顺序正确（`novel-pack-save-order.test.ts` 已钉住）。
- **主角绑定不被 save 覆盖**：`ON CONFLICT DO UPDATE` 列清单显式排除 `entity_id`，渲染侧还有第二重保险。
- **Zustand selector 无限重渲染**：四个 store 订阅点均返回原始值或稳定引用，无「selector 返回新对象」。
- **store 未违规 import hooks/service**：数据层全部走 runner/resolver 注册，且注册不触发请求（符合 §6.2）。
- **XSS**：novel 窗口无 `dangerouslySetInnerHTML`、无 `escapeHtml` 需求面，检索结果走 React 文本节点。
- **IME 守卫**：`useNovelShortcuts` 有 `isComposing`，`EditorPane` 另有 `composingRef` 冻结组合期上报。
- **切章不丢尾部编辑**：`scheduleSave` 检测到在途防抖属于另一章时立即落库旧章，链路设计正确。
- **事件/定时器清理**：除 P0-3 的 `windowAPI.off` 外，其余清理路径完整。
- **`<button>` 嵌套**：0 处。

---

*本报告仅做只读审查，未修改任何代码。修复时请按 §6.6 先跑对应模块单测建立基线，改完重跑，并在 `CHANGELOG.md` 登记。*
