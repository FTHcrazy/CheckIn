# CheckIn 小说窗口 / 行囊窗口 · 全面审查报告

> 版本：v1.0 ｜ 日期：2026-10-15 ｜ 基线：CHANGELOG 1.44.1
> 审查对象：`src/windows/NovelWindow/`（书架 + 编辑器）、`src/shared/components/CharacterPack/` + `src/windows/PackWindow/`（行囊）、`electron/` novel 域
> 对照材料：`docs/novel-editor-prd.md` v0.8、`docs/novel-onboarding-prd.md` v1.0、`docs/pack-dashboard-prd.md` v1.0、`AGENTS.md`、`CHANGELOG.md`
> 审查方式：产品侧（PRD 对照 + 体验洞察）+ 架构侧（源码级审计）双线并行，所有结论附文件:行号或 PRD 章节证据。仅审查，未修改任何代码。
> 配套文档：`docs/novel-ui-requirements.md`（UI 需求稿，独立成篇）

---

## 一页纸结论（TL;DR）

产品功能面（M1+M2）已收口，代码质量整体可控；但存在 **6 类问题**，按性质归纳：

| 类别 | 数量 | 代表问题 |
|---|---|---|
| 🔴 数据正确性缺陷（会导致半保存 / 字数漂移 / 保存后被回退） | 3 | TX-01 行囊境界半保存、TX-02 切章字数基线误判、TX-13 草稿覆盖已保存文档 |
| 🟠 退出可靠性缺口 | 3 | TX-03 hide 吞掉退出意图、TX-04 两条 quit 入口竞态、TX-09 关闭弹窗连锁取消 |
| 🟠 数据完整性 / 性能 | 4 | TX-06 孤儿清理全表扫、TX-07 级联清单漂移无守护、TX-11 大纲条目跨卷误删、TX-16 改名跨窗不同步 |
| 🟡 需求缺口（PRD 明确立项未落地） | 3 组 | 行囊「主角看板」整份未落地、引导 M3 埋点全缺、T-05~T-07 弱提示未接 |
| 🟡 体验痛点 / 逻辑不合理 | 6 | 设定中心信息架构违反常识、行囊小层无法直选、今日口径两处不一致 |
| ⚪ 文档与实现不一致 | 3 | PRD 仍写 WorkerWindow、行囊空态用过期术语「设定→等级体系」、看板/仪表盘命名混用 |

**最高优先建议**：先修 TX-01/TX-02/TX-13 三个数据正确性缺陷（会造成用户对「保存」失去信任），再补关闭守卫边界（TX-03/TX-04），然后按新增的 UI 需求稿推进行囊看板与设定中心重组。

---

## 第一部分 · 技术问题清单（架构侧）

> 排序：按风险等级从高到低。已修复且有守卫测试的历史问题（见 `.workbuddy/memory/character-pack.md`）不计入本清单。

### 🔴 高风险

#### TX-01 行囊保存非原子：文档已提交、境界关联可能写失败 → 半保存态
- **位置**：`src/shared/components/CharacterPack/hooks/usePackData.ts:488` / `:498` / `:502-507`
- **问题**：`save()` 先 `await savePackDocument(...)`（整文档事务，含 `character.realm_at`），成功后再**单独** `await writeRealmLink(nextLink)`。两次 IPC = 两个独立事务。
- **根因**：境界真实值住在 `novel_links`，不属行囊文档（设计如此），但「文档写 + 关联写」被拆成两次 IPC。
- **触发**：绑定主角后用行囊改境界 → 保存 → 文档写成功、`novel-link-set` 因瞬时异常返回 false。
- **后果**：文档/物品/属性**已全部落库**，但函数 `return false` → UI 报「保存失败」（第 502-507 行），用户以为整单回滚、继续重试或丢弃；`savedRef.current` 不推进（第 509 行在失败分支之后），脏计数保持 N，境界关联与文档分叉（右侧栏显示旧境界）。
- **修复**：把 `realmLink` 合进 `novel-pack-save` 同一事务（主进程在 apply 事务内 upsert `novel_links`）；或文档写成功后失败时回滚文档并如实提示「已保存文档，境界同步失败」。
- **测试**：无。

#### TX-02 章节 `setContent` 的 previous 取草稿优先，切章首字会误判字数基线
- **位置**：`src/windows/NovelWindow/pages/NovelPage/store/useNovelEditorStore.ts:249-284`；灌入路径 `components/EditorPane/index.tsx:422-424`
- **问题**：`const previous = state.draftMap[chapterId] ?? baseContent ?? ""`。当某章**已有未保存草稿**时，外部灌入（快照回滚 / 崩溃恢复）发生在 `EditorPane` 的 `hydratingRef` 覆盖范围之外，`previous` 取到的是**旧草稿**而非 `baseContent`。
- **触发**：某章已有未保存草稿 → 快照回滚/崩溃恢复灌入该章正文。
- **后果**：把「草稿 → 恢复文本」的差值当作今日新增，今日/会话字数**静默错误**，与库内 `chapter_save` 口径漂移（直到重启由 `hydrateUsage` 拉回）。
- **修复**：灌入路径统一走 `applyExternalContent`（语义即「确实改了正文」），不要在 `EditorPane` 用 `onChange(next, next)` 的 hack；或让 `setContent` 显式区分 user / hydrate / external 三类来源。
- **测试**：部分（未覆盖「已有草稿 + 外部灌入」交叉）。

#### TX-13 `usePackData` 卸载 flush 与 `save()` 并发时草稿可能覆盖已保存文档
- **位置**：`src/shared/components/CharacterPack/hooks/usePackData.ts:446-463`（`flushDraft`）、`:473-478`（卸载 flush）、`:480-525`（`save`）
- **问题**：`flushDraft` 仅以 `dirtyRef.current <= 0` 早退。保存成功后才 `recomputeDirty` 得 0；若在 `setSaving` 期间组件卸载，`dirtyRef` 可能尚未更新为 0，卸载 flush 会写入**脏草稿**。
- **触发**：点保存 → 立即关闭窗口 → 卸载 flush 在 save 完成前跑。
- **后果**：库中已是新版文档，但草稿仍是旧脏版 → 下次打开 `applyBundle` 草稿优先 → 用户看到「**保存了却回退了**」。
- **修复**：`save()` 开始时 `cancelDraftTimer` 或置 `savingRef`，`flushDraft` 检查 `savingRef` 后跳过。
- **测试**：无。

### 🟠 中风险

#### TX-03 关闭守卫：`hide` 事件把在途询问判为取消，可能吞掉真实退出意图
- **位置**：`electron/close-guard.ts:143-147`（`win.on("hide", () => pending.get(id)?.(false))`）、`:105`（询问前 `win.show()`）
- **问题**：主窗「点 X → hide 到托盘」与「退出时 askCloseGuards → show 窗口」共享 hide 事件。退出流程对已隐藏主窗先 `show` 再 `send`；此后窗口因任何原因被 hide（点托盘、系统最小化）即 `settle(false)`，退出被取消。
- **后果**：退出被静默取消，与用户主动取消无法区分。
- **修复**：区分主动/被动 hide；或给 settle 加原因参数，`askCloseGuards` 路径不因 hide 作废（只看超时与显式 response）。
- **测试**：无。

#### TX-04 `before-quit` 与 `window-all-closed` 的竞态可能绕过守卫
- **位置**：`electron/main.ts:896-939`、`:235-237`
- **问题**：`before-quit` 仅在 `!isQuitting && hasArmedCloseGuard()` 时拦截；`window-all-closed` 无条件 `app.quit()`。两条 quit 入口未统一收口。
- **后果**：极端时序下未保存改动无询问直接退出（仅草稿保底）。
- **修复**：退出裁决收口到一处，避免两条 quit 入口。
- **测试**：无。**⚠️ 属边界，需实机复现**（见「待验证假设」）。

#### TX-07 级联删除清单与快照读取清单漂移，无一致性守护
- **位置**：`electron/handlers/novel-handlers.ts:320-348`（`PACK_CHILD_TABLES`）、`electron/handlers/novel-pack-handlers.ts`（`readCharacterSnapshot`）
- **问题**：两份独立硬编码清单，注释要求「必须覆盖 snapshot 读到的每张表」，但**无一致性测试**。历史已漏过 `novel_pack_presets`（代码注释自述）。
- **后果**：新增表只加读取、忘加级联 → 删作品后孤儿行永久残留，只能清库。
- **修复**：加单测对两清单做集合相等断言，或从 DB schema 动态派生。
- **测试**：部分（`novel-pack-save-order.test.ts` 守删除顺序，非清单完整性）。

#### TX-11 大纲条目删除的双条件语义微妙（跨卷误删风险）
- **位置**：`electron/handlers/novel-handlers.ts:1352-1373`
- **问题**：`DELETE FROM novel_outline_entries WHERE volume_id = ? OR chapter_id IN (SELECT id FROM novel_chapters WHERE volume_id = ?)`。挂卷 A 但 `chapter_id` 属卷 B 的条目（章节跨卷移动后未同步条目）会被一并删除。
- **后果**：取决于产品语义——「条目随卷」则正确，「条目随章」则误删。
- **修复**：明确语义并加注释/测试固化；若应随章则去掉 `OR volume_id = ?`。

#### TX-16 行囊头部改名不广播名称变更事件
- **位置**：`electron/handlers/novel-pack-handlers.ts:1368-1398`、`usePackPanel.ts:706-723`
- **问题**：行囊侧 `renameCharacter` 调用主进程窄通道后，未触发 `notifyNameChanged`；而 `PACK_NAME_EVENT` handler 明确 `if (detail.origin === "pack") return`，事件通道未打通。
- **触发**：在行囊头部改主角名 → 右侧要素栏名称不实时更新（直到重载）。
- **后果**：跨窗显示不同步（体验，不丢数据）。
- **修复**：`renamePackCharacter` 成功后 `notifyNameChanged(workId, displayName, "pack")`。

#### TX-06 `novel-pack-save` 孤儿加成清理是全表扫描，随库增长劣化
- **位置**：`electron/handlers/novel-pack-handlers.ts:1570-1574`
- **问题**：`DELETE ... WHERE owner_id NOT IN (SELECT id FROM novel_pack_items) OR ...`，无作品限定，全表口径；`NOT IN` 遇 NULL 会整条失效。
- **后果**：多作品/大库时 O(modifiers × items) 子查询，是「保存变慢」潜在热点；理论上有跨作品误删风险。
- **修复**：改用 `EXISTS` 或按当前 character 的宿主集合限定。

#### TX-05 `novel-chapter-save` 未校验 `wordCount` 合法性 / 无长度上限
- **位置**：`electron/handlers/novel-handlers.ts:1205-1254`
- **问题**：`wordCount` 直接落库，无类型守卫、无上限。渲染层 bug 传入 `NaN`/负值时，`delta = NaN`，快照阈值恒 false，`logUsage` 写入 NaN。
- **后果**：今日统计污染（SUM(delta) 异常）、快照不再产生。
- **修复**：入口 `Number.isFinite(wordCount) ? Math.max(0, Math.floor(wordCount)) : 0`。

#### TX-08 自动保存 effect 的 `lastEditAt` 未被跨窗事件更新
- **位置**：`src/shared/components/CharacterPack/hooks/usePackPanel.ts:765-773`（autoSave effect）、`:880`（`touch`）、`:685/712`（跨窗事件 handler）
- **问题**：仅经 `callMutate` 的改动才 `touch()`；跨窗事件（`PACK_REALM_EVENT` / `PACK_PROTAGONIST_EVENT`）走裸 `mutate`，抬高 dirty 但**不更新 `lastEditAt`**。
- **触发**：只在右侧要素栏改境界 → 自动保存计时与作者预期不符（偏早/偏晚）。
- **后果**：体验问题，不丢数据。
- **修复**：把 `touch()` 收进 `mutate` 本身，或在事件 handler 补 touch。

#### TX-09 `requestGuard` 依赖整个 `data` 对象，关闭弹窗期间可能连锁取消
- **位置**：`src/shared/components/CharacterPack/hooks/usePackPanel.ts:787-805`、`:842`
- **问题**：`requestGuard` 依赖含整个 `data`（每次渲染新对象）→ 频繁换身份 → `requestClose` 跟着换。虽有 `guardResolveRef` 保护，但根因是依赖不稳。
- **后果**：表现为「点关闭没反应」的健壮性隐患。
- **修复**：依赖改为标量（`data.dirty`、`data.flushDraft`）。

#### TX-12 标注层 `requestRefresh` 的 `isConnected` 早退 + 组合期切章
- **位置**：`src/windows/NovelWindow/pages/NovelPage/novel-editor.ts:159-193`
- **问题**：`if (!this.view.dom.isConnected) return`（第 160 行）防抖回调到达时静默丢弃刷新；组合输入期切章，新章高亮延迟到下次文档变化/滚动。
- **修复**：`compositionend` 后确保补一次强制刷新，确认 `suspended` 复位。

### 🟡 低风险 / 已知安全（记录备查）

| 编号 | 位置 | 结论 |
|---|---|---|
| TX-14 | `useNovelEditorStore.ts:42-51` | `countWords` 单槽缓存键完整（text+mode），**安全，无需修复** |
| TX-15 | `usePackPanel.ts:127-137` | 模块顺序兜底绑定数组下标，新增中间模块会跳序（轻微） |
| TX-17 | `usePackData.ts:473-478` | 窗口 hide（未卸载）时草稿靠防抖兜底，内存仍在，**安全**；可加 `visibilitychange` 增强 |
| TX-18 | `novel-handlers.ts:1485-1500` | 导入一次性传全量 ArrayBuffer，超大 TXT 有内存峰值；加流式或上限 |
| TX-19 | `dual-channel.ts` / `pack-config.ts` | falsy 负载被各 handler 的 object 守卫拦截，**安全** |
| TX-20 | `usePackPanel.ts:2000-2516` | return 对象未 useMemo；如出现性能问题再处理 |
| TX-10 | `close-guard.ts:167-181` | `askCloseGuards` 逐窗口 await 期间快照过期，低概率 |

### 〇 · 代码卫生（主理人核查发现）

- **残留空目录**：`src/windows/NovelWindow/pages/NovelPage/components/CharacterPack/` 下 **5 个空目录、0 文件**，git 未追踪——行囊迁往 `shared/components/CharacterPack/` 后的清理遗留。建议删除。
- **重复命名空间**：`shared/components/CharacterPack/`（实使用）与上述空目录并存，易误导后续开发。

---

## 第二部分 · 产品问题与改进点清单（产品侧）

> 类别：需求缺口 / 体验痛点 / 逻辑不合理 / 文档与实现不一致 / 数据口径问题

| 编号 | 类别 | 问题描述 | 证据 | 影响 | 改进建议 | 优先级 | 需UI |
|---|---|---|---|---|---|---|---|
| PX-01 | 需求缺口 | 作者写正文想「一眼确认主角当前状态」，打开行囊看到的仍是十模块分区仪表盘/摘要行，非「当前状态一屏」。pack-dashboard-prd FR-01~FR-10 **全部未落地** | pack-dashboard-prd 全文；代码无「看板/dashboard」；CHANGELOG 无记录；`CharacterPack/index.tsx:220-318`、`pack-layout.ts` | 高 | 落地 L0 看板五区（身份/境界/核心属性/生效状态/摘要行）；`moduleSummary` 纯函数已具备可复用 | P0 | 是→UI-01 |
| PX-02 | 需求缺口 | 境界从「练气 3 层」切「练气 7 层」只能用 `±1 层` 递推；等级多的书点选成本高 | pack-dashboard-prd FR-04/FR-05；`RealmModule/index.tsx:67-69,131-155` | 高 | 加「阶下拉（>8阶）+ 层号条（1..N，>12 改下拉）」，写入唯一走 `writeRealm`→`clampRealm`，toast 取 `plan.position` | P0 | 是→UI-02 |
| PX-03 | 体验痛点 | 无等级体系时境界模块只给**纯文字**提示，且文案是过期术语「设定 → 等级体系」，无可点下一步 | `RealmModule/index.tsx:93-97`；pack-dashboard-prd FR-06 | 中 | 换成「未设置 + 去设定中心创建」按钮；文案改「设定中心」；新增跨窗口频道 `novel-open-setting-center` | P1 | 是→UI-03 |
| PX-04 | 需求缺口 | FR-03「钉选常驻」与 FR-09「全档默认摘要行」未实现，行囊首屏信息密度仍偏「编辑器」 | pack-dashboard-prd FR-03/FR-09；`pack-layout.ts:134-142`；`types.ts` 无 `pinned` | 中 | 加 `PackUiPrefs.pinned`（走 `novel_pack_ui`，零新表）；默认折叠策略可先局部调整 | P1 | 是→UI-04 |
| PX-05 | 体验痛点 | 新手按「世界观/人物/大纲」常识找「人物设定」，设定中心找不到——境界体系只是 `kind='realm'` 的一条分类 | onboarding §2.1 P-02；`SettingCenter/index.tsx:234-239` | 高 | 信息架构分组 + 顶部说明去术语化；确认 FR-05 过期文案未回潮 | P0 | 是→UI-05 |
| PX-06 | 需求缺口 | 弱提示 T-05/T-06/T-07 未接入；文案已在 guide-copy 定义但无锚点消费 | onboarding §14.2；`guide-copy.ts:183-201`；仅 T-02/T-04 已挂 | 中 | 统一「挂 `data-tour-target` + 包 `GuideTooltip`」，无新机制 | P1 | 是→UI-06 |
| PX-07 | 体验痛点 | 编辑器顶栏 6 颗图标默认态可点性弱 | CHANGELOG 1.42.0 已修一轮；`NovelTopBar/index.tsx:165-228` | 低 | 收尾确认三档层次（默认/hover/激活）齐全 | P2 | 是→UI-07 |
| PX-08 | 数据口径问题 | 「今日」指标两处术语/口径不同源：书架用「今日新增」（净增口径），编辑器用「今日 +N」；PRD §10.3 开放问题仍在问「净增 vs 保存累计」 | `ShelfStats/index.tsx:17`；`StatusBar/index.tsx:39-50`；novel-editor-prd §10.3 | 中 | 统一「净增」口径 + 同一术语/格式；PRD 开放问题正式拍板并回填文档 | P1 | 是→UI-08 |
| PX-09 | 需求缺口 | R27 人物关系网络 / R28 架空地图 只有「规划中」占位卡，点按行为未定义 | `ToolLauncher/index.tsx:29-59`；novel-editor-prd §6.5.3 | 低 | 占位卡给明确反馈（toast/禁用说明）；R27 数据基础已就位，建议优先排 | P2 | 是→UI-09 |
| PX-10 | 逻辑不合理 | `SettingCenter/index.tsx` 1494 行单体，迭代成本高、易漏改 | `SettingCenter/index.tsx` 行数 1494；AGENTS §5.2 | 中 | 拆分为子组件目录（左栏/右栏/两弹窗） | P1 | 是→UI-10 |
| PX-11 | 逻辑不合理 | Tour 与关闭守卫的「让位」未接线：守卫在场时 Tour 不暂停，可能连击弹窗 | onboarding §14.3/§11/§7.1 | 中 | `CloseGuardModal` 打开时调 `useGuideStore.getState().pause()`；守卫后本会话不恢复 | P1 | 否 |
| PX-12 | 需求缺口 | 引导埋点（§10 九事件）未接入，M3 目标无法观测 | onboarding §10/§14.3；`useGuideStore.ts` 仅有注释无 dispatch | 中 | 复用既有 `logUsageEvent`（`novel_usage_log`）通道接入，无需新表 | P1 | 否 |
| PX-13 | 文档与实现不一致 | PRD §6.5 描述载体为「WorkerWindow」，实际已是 `src/windows/NovelWindow/`（NovelPage + BookshelfPage 双视图） | novel-editor-prd §6.5/§7；`NovelWindow/App.tsx:74-204` | 低 | 更新盘点基准路径 + §7 工程落点字样 | P2 | 否 |
| PX-14 | 数据口径问题 | 「行囊→设定中心」跳转与「行囊内建梯」职责边界两份 PRD 都假设 `novel-open-setting-center` 频道可用，但**从未实现** | pack-dashboard §7.4/§12；onboarding §2.3；代码无该频道 | 中 | 与 PX-03 合并：实现跨窗口频道 + 主进程唤起（复用 `pack-window-open` 范式） | P1 | 是 |
| PX-15 | 需求缺口（重估） | 未落地需求站在今天基线上价值需重估 | novel-editor-prd §6.5.3/§9 | — | **保留**：R11 自动排版、R15 敏感词、R22 人名推荐。**上调**：R27 关系网络（R24 数据红利）。**缓做**：R12/R16/R19/R26。**砍/长期缓**：R17 AI | P2 | 部分 |
| PX-16 | 体验痛点 | 顶栏同时有窗口级「设置」（标题栏齿轮）与页面级「排版与偏好」（滑杆），新手易混 | `NovelTopBar/index.tsx:217-227`；`App.tsx:36-48` | 低 | 刻意设计，建议 Tooltip/帮助文档强化区分文案 | P2 | 是（文案） |

### 三份 PRD 与实现的差距小结

| PRD | 落地情况 | 关键缺口 |
|---|---|---|
| novel-editor-prd v0.8 | M1+M2 功能面收口，R32 书架主页已落地 | R11/R12/R15/R16/R19/R22/R26/R27/R28 未实现；§6.5 路径描述过期（PX-13） |
| novel-onboarding-prd v1.0 | M1+M2+FR-05 已落地（1.43.0~1.44.0），T-01 下线 | T-05/T-06/T-07 未接入（PX-06）；M3 埋点全缺（PX-12）；Tour↔守卫让位未接线（PX-11） |
| pack-dashboard-prd v1.0 | **完全未落地**（代码/CHANGELOG 无任何痕迹） | FR-01~FR-10 全部（PX-01~PX-04）；跨窗口频道缺失（PX-14） |

### 口径冲突汇总

1. **字数「今日」口径**：PRD §10.3 开放问题未拍板 vs 现状净增（PX-08）。
2. **「等级体系」术语漂移**：PRD 称 R25「等级体系管理」，实际已重构进 `novel_setting_categories/levels`（1.36.0）；行囊空态文案仍写「设定 → 等级体系」过期术语（PX-03）。
3. **「看板」vs「仪表盘」**：pack-dashboard 称「看板」，代码注释叫「分区仪表盘」，同一区域两套名词（PX-01）。

---

## 第三部分 · PRD 声称实现抽样验证

对 novel-editor-prd §6.5.1 抽查 8 项关键声明：

| # | PRD 声明 | 结论 | 证据 |
|---|---------|------|------|
| 1 | R2 标注层 IME 冻结、300ms 防抖、仅扫可视区、不污染撤销栈 | ✅ 属实 | `novel-editor.ts:102-165` |
| 2 | R3 防丢稿：800ms 防抖 + 30s flush；快照 500字/5分钟、环形 20 版 | ✅ 属实 | `novel-config.ts:86-88`、`useNovelEditorState.ts:194-199`、`novel-handlers.ts:1225-1241` |
| 3 | R3 会话标记法崩溃恢复 + RestoreBanner | ✅ 属实 | `novel-handlers.ts:489-523`、`:581` |
| 4 | R9 拖拽重排防误触确认 | ✅ 属实 | `useNovelPage.ts:1009-1015`、`novel-config.ts:123` |
| 5 | R21 出场章节统计全量白名单匹配 | ⚠️ 部分属实 | 白名单口径为 `findTermMatches`；「全量」与标注层「可视区」口径不同，**需产品确认是否有意分离** |
| 6 | R6 位置记忆四元组 500ms 防抖 + 关窗 flush | ✅ 属实 | `useNovelPage.ts:328-355`、`EditorPane/index.tsx:545-570` |
| 7 | R29 作品删除单事务级联清理 | ✅ 属实 | `novel-handlers.ts:610-701`（叶→根完整顺序） |
| 8 | R13 导出：章节标题按 numberStyle 派生、序号全书连续 | ✅ 属实 | `novel-export.test.ts`、`buildBookPlainText` 系列 |

**结论**：§6.5.1 声明基本属实，无「声称已实现实为占位」的情况。

### 关键契约与守卫有效性抽查

- **REQ-048 境界写入口契约**：✅ 仍成立。唯一写入口 `setRealm`（`pack-realm.ts`），`usePackPanel.writeRealm` 经它；note 只存 `{sub}`；origin 路由正确。**未发现绕过契约的新直连点**。
- **关闭守卫四条规定**：✅ 基本成立（脏计数武装 / before-quit 顺序 / isQuitting 语义 / 超时取消恢复），但 TX-03/TX-04 指出 hide 与 window-all-closed 两条边界健壮性缺口。
- **双通道事件防串书**：✅ 有效（各订阅点均有 `workId` 过滤 + origin 排除）。
- **性能**：标注层已按首字分桶，大章只扫可视区 ✅；`buildRecovery` 已加 7 天窗口 ✅；`novel-pack-save` 孤儿清理全表扫 ⚠️（TX-06）。

---

## 第四部分 · 修复优先级建议与待验证假设

### 修复优先级

| 级别 | 项目 | 理由 |
|---|---|---|
| **P0** | TX-01、TX-02、TX-13 | 数据正确性 / 半保存 —— 会让用户对「保存」失去信任 |
| **P1** | TX-03、TX-04、TX-09（退出可靠性）；TX-07、TX-11、TX-16（数据完整性） | 影响退出与跨窗一致性 |
| **P1（产品）** | PX-03/PX-14（跨窗频道）、PX-12（埋点）、PX-05/PX-10（设定中心） | 阻塞引导与需求落地 |
| **P2** | TX-05、TX-06、TX-08、TX-12；PX-01~PX-04（行囊看板可分批） | 性能与边界 |
| **P3** | TX-10、TX-15、TX-17、TX-18、TX-20；PX-07、PX-09、PX-13、PX-16 | 体验与增强 |

### 待验证假设（需运行时复现，未列入主清单）

1. **TX-04** 的 `window-all-closed` 与 `before-quit` 竞态 —— 多窗口 + 未保存 + 托盘退出时序实机复现。
2. **TX-02** 的「已有草稿 + 外部灌入」字数漂移 —— 构造 e2e（导入书 → 编辑不保存 → 崩溃恢复灌入）。
3. **TX-08** 自动保存时机偏差 —— 仅右侧栏改境界时实测。
4. **TX-18** 大文件导入内存峰值 —— 真实大 TXT 压测。
5. **R21** 出场统计与标注层口径一致性 —— 产品确认。

---

## 第五部分 · 建议实施路线

> 原则：先修数据正确性，再补退出可靠性，然后按 UI 需求稿推需求。
>
> **进度（2026-10-15）**
> - ✅ 阶段一 1/2/3（TX-01 / TX-13 / TX-02）已完成并验收。
> - ✅ 阶段三 7（PX-14 跨窗频道，落地为 UI-03a）、8（UI-02 + `pinned`）、9（UI-01 看板）、11（UI-05 + UI-10）已完成。
> - ✅ PX-08（UI-08 今日口径统一，未在上表编号中列出）已完成：三处读数统一术语 / 取值 / 格式，PRD 开放问题拍板为净增。
> - ⬜ 阶段二 4/5/6、阶段三 10（引导埋点）、阶段四 12/13 待做。
> - 未完成 UI 项：UI-06 弱提示 T-05/06/07、UI-07 顶栏图标分层、UI-09 工具 Tab 占位规范。

**阶段一 · 数据正确性修复（P0，建议立即做）**
1. TX-01：`realmLink` 合进 `novel-pack-save` 事务；补「保存失败不误报」测试
2. TX-13：`save()` 置 `savingRef`，`flushDraft` 跳过；补卸载竞态测试
3. TX-02：灌入路径统一走 `applyExternalContent`；补「草稿 + 外部灌入」单测

**阶段二 · 退出可靠性 + 数据完整性（P1）**
4. TX-03/TX-04：退出裁决收口一处，hide 语义区分
5. TX-07：加级联清单一致性单测
6. TX-11/TX-16：语义明确化 + 改名广播打通

**阶段三 · 需求落地（按 UI 需求稿）**
7. PX-14：实现 `novel-open-setting-center` 跨窗频道（P1 阻塞项）
8. PX-04/UI-02：行囊小层直选 + `PackUiPrefs.pinned`（零新表，低成本）
9. PX-01/UI-01：行囊 L0 看板五区（可分批）
10. PX-12：引导埋点接入（复用 `novel_usage_log`）
11. PX-05/UI-05 + PX-10：设定中心信息架构重组与拆分

**阶段四 · 收尾**
12. 代码卫生：删除 5 个残留空目录
13. PX-13：更新 PRD §6.5/§7 路径描述

---

## 附：完整 UI 需求稿

见 `docs/novel-ui-requirements.md`。
