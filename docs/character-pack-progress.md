# 行囊（CharacterPack）· 功能登记表

> 对应 PRD：`docs/character-pack-prd.md` v1.5
> 本轮落地范围：**按步骤实现 PRD 的 P0 主体 + 可直接落地的 P1**；形态固定为「右侧让位」。
> 登记日期：2026-10-08 ｜ 代码基线：`1.19.2`
>
> **1.19.0 追加**：① 右侧要素栏补「主角」设定（行囊 ↔ 实体面板的挂钩落地）；② 模板书预设一份完整模板行囊 + 等级阶梯补小层/当量（见 §8）。
> **1.19.1 追加**：修掉主角 / 联动三项静默失效，根因是跨模块事件的负载形状有两套而监听器只认了一套（见 §9 —— 新增双投递事件必须走 `readEventDetail`）。
> **1.19.2 追加**：修掉行囊保存「从第二次起必然失败」（`UNIQUE constraint failed: novel_pack_modifiers.id`），根因是整文档保存里**多态加成表的删除排在了它的宿主表之后**（见 §10 —— 多态表的删除顺序是硬约束）。
> **1.21.0 追加**：行囊全量切换到组件库控件，原生表单控件清零；`AGENTS.md` §6.1.2 升级为强制条款（见 §11 —— 覆盖组件库外观只该改变量，以及三份长期不生效的样式这个真缺陷）。

## 0. 怎么用这张表

- **状态**：✅ 已完成 ｜ 🟡 部分完成（缺口写在「缺口」列）｜ ⬜ 未开始 ｜ ➖ 本批有意不做
- 「落点」列是**唯一入口点**，改动时优先从那里进去，避免全局搜索。
- 下一批开发直接挑 ⬜ / 🟡 行；**表里的「缺口」列就是待办**。

## 1. 形态与迁移（本轮的三个硬约束）

| 约束 | 落地方式 |
|---|---|
| **右侧让位**（不遮挡正文） | 面板是 `.nv-page__body` 里的一个 flex 兄弟项，宽度从正文里扣，正文重排收窄；宽度 340–620 可拖，双击复位 |
| **窄窗降级** | 窗口宽 < `PACK_PANEL.overlayBelow`(1100) 或用户显式选 overlay 时，切为「全屏浮层 + 遮罩」，点击遮罩走同一套关闭拦截 |
| **收束到一起、便于窗口化迁移** | 全部代码在一个目录 `CharacterPack/` 下；对外只吃 `workId / chapterId / onClose` 三个入参；数据装载、草稿、保存、界面偏好全部自持 |

**迁移到独立窗口的改动面**（未来做 REQ-026 时）：

1. 新建 `src/windows/PackWindow/{index.html,main.tsx,App.tsx}`；
2. `App.tsx` 里渲染同一个 `CharacterPackHost`，把 `onClose` 换成 `window.close`；
3. `electron/edition.ts` 登记窗口 + `main.ts` 加创建函数（照既有 `NovelWindow` 抄）。

`CharacterPack/` 目录下**零改动**。草稿与界面偏好已经落在主进程侧（`novel_pack_drafts` / config 键），因此分离窗口下不会出现「localStorage 不共享」。

## 2. 落点地图

```
NovelPage/components/CharacterPack/
├── index.tsx / index.scss          # 面板宿主：形态（让位/浮层/速览）、宽度拖拽、模块遍历、浮层挂载
├── types.ts                        # 领域别名 + 模块清单 + 常量（性质/稀有度/模板/阈值）
├── pack-config.ts                  # 面板尺寸、出厂布局、量纲模板、长按参数、跨模块事件与四条「桥」
├── pack-utils.ts / .test.ts        # 纯函数：两道闸门 + 时效、汇总管线、进位、量程换算、负重/容量、导出表
├── pack-units.ts                   # 量纲 JSON 导入导出的纯函数层（REQ-022）
├── pack-presets.ts / .test.ts      # 换装方案：收方案 / 解析脏数据 / 试穿与套用（REQ-032）
├── pack-realm.ts / .test.ts        # 境界读写口子（REQ-048），15 例
├── styles/pack-common.scss         # 跨模块公共原语（按钮/徽标/开关/下拉浮层）
├── services/pack-service.ts        # IPC 语义化转发
├── hooks/
│   ├── usePackData.ts              # 装载 / 草稿 / 保存 / 撤销 / 回退点（草稿里含 presets）
│   └── usePackPanel.ts             # 唯一 API 面：视图状态 + 约 50 个业务动作 + 派生
└── components/
    ├── PackHeader/ PackModuleShell/ PackToast/ CloseGuardModal/ ModifierList/ EffectEditor/
    ├── SummaryModule/ AttributesModule/ EquipmentModule/ InventoryModule/ SkillsModule/
    ├── RealmModule/ CurrencyModule/ StatusModule/ NoteModule/
    ├── ModuleManager/ SlotManager/ UnitSystemManager/
    └── RecordDrawer/ SourceDetailDrawer/
```

主进程侧：`electron/handlers/novel-pack-handlers.ts`（11 条通道）、`electron/db.ts`（11 张表 + `novel_levels` 两条补列）、`electron/template`（`novel-template.ts` 的 `TemplatePack` 模板行囊）、`electron/preload.ts`、`src/shared/types/electron.d.ts`。

**行囊 ↔ 宿主的五条桥**（行囊**不** import 编辑器 / 页面 / 侧栏，理由见 §17.5）：

| 桥 | 方向 | 用途 |
|---|---|---|
| `registerPackCloser` / `requestClosePackPanel` | 宿主 → 面板 | 顶栏图标 / `Ctrl+Shift+B` / 页面 Esc 的关闭必须走面板的受保护路径 |
| `registerPackGuard` / `guardPackBeforeAction` | 宿主 → 面板 | 切章 / 切作品 / 退出应用前先过未保存闸门 |
| `registerPackQuickAdd` / `runPackQuickAdd` | 宿主 → 面板 | 正文选区右键「记入背包」，面板没开时返回 `handled: false` 由主进程兜底 |
| `registerPackPeek` / `requestPackPeek` | 宿主 → 面板 | 顶栏 Alt+点击切速览（未挂载时记待办，见 §17.1） |
| `registerPackInsertIntoChapter` / `runPackInsertIntoChapter` | 宿主 → 面板 | 导出菜单的「插入本章末尾」（REQ-034） |

**主角绑定**（行囊 ↔ 右侧要素栏的交叉点，1.19.0 新增）：

```
NovelPage/hooks/usePackProtagonist.ts          # 页面侧读数 + 写入口（主角绑定要在行囊关闭时仍可用）
NovelPage/components/EntityCard|EntityDetail|EntityPanel/  # 「设为主角」入口与角标
CharacterPack/pack-config.ts                   # 事件定义 + notify（PACK_PROTAGONIST_EVENT / PACK_REALM_EVENT）
CharacterPack/services/pack-service.ts         # fetchProtagonistBinding / writeProtagonistBinding
```

## 3. 功能登记

### Epic A · 入口与容器形态

| REQ | 项 | 状态 | 落点 | 缺口 / 备注 |
|---|---|---|---|---|
| REQ-001 | 三形态（让位 / 窄窗浮层 / Peek） | ✅ | `CharacterPack/index.tsx`（`.cpk.is-peek`）、`pack-config.ts` 的 `PACK_PEEK` / `registerPackPeek`、顶栏按钮 `Alt+点击` | 三形态齐全。⚠️ Peek 是**运行时状态而不是界面偏好**（3 秒自动收起，写进 `novel_pack_ui` 会变成「下次打开又自己没了」）；入口是顶栏「行囊」按钮 **Alt+点击**，窄窗下降级为 overlay（只做窄窗浮层） |
| REQ-002 | 独立于侧边栏的入口 + 快捷键 | ✅ | `NovelTopBar/index.tsx`（行囊按钮）、`hooks/useNovelShortcuts.ts`（`Ctrl+Shift+B`） | — |
| REQ-003 | 宽度可调且记忆 | ✅ | `pack-config.ts` 的 `PACK_PANEL`、`usePackPanel` 的 prefs 防抖 | 落 config 键 `novel_pack_ui`（即改即存），未复用 `novel_panel_width` —— 两者是不同面板，混用会互相打架 |

### Epic B · 核心四模块

| REQ | 项 | 状态 | 落点 | 缺口 / 备注 |
|---|---|---|---|---|
| REQ-004 | 属性增删改序 + 分组 + 模板 | ✅ | `AttributesModule`、`usePackPanel`（`renameAttributeGroup` 整组一次改动） | 三套模板：通用 / 玄幻 / 网游 |
| REQ-005 | 属性基础值行内编辑 | ✅ | 同上 | — |
| REQ-006 | 通用预设部位 + 增删改名排序禁用 | ✅ | `SlotManager`、handler 的 `seedDefaultSlots()`（12 个部位） | 删除部位时已穿戴物**退回物品栏**而非删除 |
| REQ-007 | 部位槽位数量（默认 1，上限 ≥ 8） | ✅ | `SlotManager` | 缩容时溢出的那件自动退回（`shrinkSlotCapacity`） |
| REQ-008 | 部位「仅接受物品类型」 | ✅ | `SlotManager`、`equipItem` 的 accepts 校验 | 不匹配时给 toast 而不是静默拒绝 |
| REQ-009 | 穿戴 / 卸下；满位给「替换」 | ✅ | `EquipmentModule`、`usePackPanel.equipItem/replaceInSlot` | `equipItem` 返回 `{ok, conflict}` 三态，满位弹确认框说明「会顶掉谁」 |
| REQ-010 | 物品增删改查 + 分类/数量/稀有度/描述/标签 | ✅ | `InventoryModule` | 名称 / 分类 / 数量行内可改；稀有度**圆点即下拉入口**；描述与标签在行尾「更多」菜单里展开（标签走「草稿 → 失焦提交」） |
| REQ-011 | 数量行内 +/- 与长按连加 | ✅ | `InventoryModule`（`useHoldRepeat`，400ms 后 60ms/次） | 长按与单击共用同一按钮，第一下立即生效 |
| REQ-012 | 列表 / 宫格切换 + 搜索过滤 | ✅ | `InventoryModule` | ≥20 条才出现搜索框；200ms 防抖；宫格视图走 `prefs.inventoryView` |

### Epic B · 技能

| REQ | 项 | 状态 | 落点 | 缺口 / 备注 |
|---|---|---|---|---|
| REQ-013 | 技能增删改查 + 启用停用（载体闸门） | ✅ | `SkillsModule` | 停用后该技能**全部**效果不计入（含其持续型） |
| REQ-014 | 熟练度展示开关 + 数值 + 等级名 + 进度条 | ✅ | `SkillsModule`、`thresholdOf()` | 开关关闭时**整块缺席**（不是置灰）；数值与「档位名 + 进度条」**可见条件分开** —— 没配等级体系时数值仍可改 |

### Epic C · 效果性质与汇总

| REQ | 项 | 状态 | 落点 | 缺口 / 备注 |
|---|---|---|---|---|
| REQ-015 | 共用编辑器：先选性质再填内容 | ✅ | `EffectEditor` | 释放型**不出现「目标属性」字段**；选触发条件会二次确认「该效果将不计入总属性」 |
| REQ-016 | 基础值 → 总览值 + 增量标识 | ✅ | `SummaryModule` | — |
| REQ-017 | 来源明细（每一条贡献） | ✅ | `SourceDetailDrawer` | 汇总行点击进入，含来源载体名与运算符号 |
| REQ-018 | hover 未穿戴装备 Δ 预览 | ✅ | `EquipDeltaPreview`、`previewEquipDeltas`、`computeHypotheticalSummary` | 装备栏候选列表悬停浮出；只列真的会变的属性（见 §13） |
| REQ-019 | 汇总缓存 ≤ 100ms / 150 条 | ✅ | `computeSummary` + `useMemo` 依赖级缓存、`InventoryModule` 的渲染窗口 | 汇总侧：依赖级 `useMemo`，变更范围外的编辑不触发重算。列表侧：**刻意不用 `react-virtuoso`** —— 行囊九个模块共用一条 `.cpk__body` 滚动条，嵌套虚拟滚动会变成两级滚动；改为窗口化渲染（`INVENTORY_RENDER_WINDOW = 80`）+「显示更多」，80 条以下默认路径逐字节不变 |
| REQ-038 | 每条效果声明性质 + `被/持/放` 徽标 | ✅ | `NATURE_META`、`ModifierList` | 灰 / 蓝 / 橙三色 + 独立开关 + 折叠，一眼可分 |
| REQ-039 | 持续型独立开关（与载体开关分离） | ✅ | `ModifierList` 的 `.cpk-sw2`、`toggleModifierActive` | 同一载体下 passive 与 sustained 互不影响 |
| REQ-041 | 汇总与明细按被动/持续分段 + 「另有 N 项主动」 | ✅ | `SummaryModule`、`segments()` | 被动灰段、持续蓝段、覆盖型警示段 |

### Epic D · 量纲与 R25 联动

| REQ | 项 | 状态 | 落点 | 缺口 / 备注 |
|---|---|---|---|---|
| REQ-048 | 境界读写收敛为三个函数 | ✅ | `pack-realm.ts`（15 例单测） | 契约：**每次改动后 grep 一遍**，禁止业务层直接引用 `realm_at` / 「当前境界」行 |
| REQ-046 | 境界 ↔ R25 双向同步 | ✅ | `pack-realm.ts`、`novel-link-set`、`novel-level-meta-set`、`hooks/usePackProtagonist.ts` | 复用 `novel_levels` + `novel_links`（不另建表）；小层数 / 战力当量补列；阶内进位 `carryRealm()`；**双向实时**：两边任一改动都广播 `pack-protagonist-changed`，另一侧立刻跟随（同窗口 CustomEvent + 跨窗口 broadcast 各发一次） |
| REQ-047-主角 | 右侧要素栏「设为主角」 | ✅ | `EntityCard`（皇冠角标 + 快捷按钮）、`EntityDetail`（主角区 + 「行囊同源」角标）、`novel-pack-protagonist-get/-set` | 唯一事实源是 `novel_pack_characters.entity_id`，**不另建表、不另加列**；主角卡在列表里置顶；仅角色卡可见入口（地点 / 派系卡上不给，避免误以为也能设主角）。⚠️ 1.19.1 修掉一处静默失效：双投递事件监听器只认了一种负载形状，导致同窗口这条路读不到值（见 §9） |
| REQ-040 | 释放型结构化参数 | ✅ | `EffectEditor` 的 cast 分支 | 效果量 / 单位 / 冷却 / 消耗 / 目标 |
| REQ-022 | 量纲统一入口 + 三模型 + JSON 导入导出 | ✅ | `UnitSystemManager`、`pack-units.ts`、`pack-utils` 的 `formatRatio/thresholdOf` | 三模型齐全 ✅（ladder 由境界承担）；JSON 复制 / 下载 / 导入 ✅ —— 只覆盖 currency + proficiency，**境界不在内**（走 R25，避免第二份真相源）；导入是**覆盖同用途那一套**而不是合并（合并会让「删档位」静默失败）。量纲目前只用于展示与试算，不参与属性汇总 |
| REQ-023 | 货币：自定义进制 + 自动进位可关 | ✅ | `CurrencyModule` | 「铜钱换不成银」= 关掉自动进位 |
| REQ-024 | 境界模块：阶梯进位 + 战力当量 | ✅ | `RealmModule` | 双读数（行囊 / 实体面板）并列显示，**故意分叉可见** |
| REQ-025 | 状态效果（Buff/Debuff） | ✅ | `StatusModule`、`EffectEditor` 的 sustained 分支、`pack-utils.isExpired` | 复用性质模型与独立开关 ✅；**时效自动过期** ✅：`roundsLeft` 可空（NULL = 不限时），到 0 由 `isCounted` 的时效闸门挡在汇总之外，汇总结果里单列 `expired` 一桶。⚠️ **过期不翻 `active`** —— 那是作者的开关，翻了就是工具偷偷改设定，而且不可逆 |

> **1.22.2 补的入口缺口**：`EntityDetail` 的「当前境界」区块原来整块挂在 `levelSystems.length > 0`
> 上 —— 新开的书还没有等级体系时它**连「管理」按钮一起消失**，作者在资料卡上找不到任何入口去设
> 境界关联。现在角色卡**永远**渲染这一格：无体系时给「还没有等级体系」空态 + 一步到位的
> 「＋新建等级体系」（走既有 `onOpenLevelManager`），有体系时才显示「管理」（避免两个按钮一件事）；
> 非角色卡且无体系仍不出现。回归由 `EntityDetail/index.test.tsx`（4 例）钉住。

### Epic E · 模块拼装

| REQ | 项 | 状态 | 落点 | 缺口 / 备注 |
|---|---|---|---|---|
| REQ-020 | 模块启用/禁用/排序/折叠，按角色独立存储 | ✅ | `ModuleManager`、`usePackPanel` 的 layout 动作 | 启用 + 顺序 ✅（走草稿，按角色）；**折叠走全局界面偏好**（有意偏离，理由见 §4）；排序走**原生 HTML5 拖拽 + 手柄方向键**（后者是键盘可达性，拖拽对键盘用户完全不可达；不引入 dnd-kit） |
| REQ-021 | 全空态引导 + 恢复默认组合 | ✅ | 各模块空态 + `ModuleManager` 的「恢复默认」 | 面板本体也有「所有模块都被关掉了」的兜底文案 |

### Epic F · 快捷盘点增强

| REQ | 项 | 状态 | 落点 | 缺口 / 备注 |
|---|---|---|---|---|
| REQ-027 | 正文选区右键「记入背包」 | ✅ | `EntityContextMenu`（`onAddToPack`）、`pack-config.runPackQuickAdd`、`pack-service.quickAddPackItem`、handler `novel-pack-quick-add` | 面板开着走面板内存文档、没开落主进程（有草稿则并入草稿） |
| REQ-028 | 本章变动高亮（24h / 全部已读） | ✅ | `pack-utils.hasRecentChange/countRecentChanges`、`PackChangedDot`、`PackHeader` 的「全部已读」、属性 / 技能补 `updated_at` | 覆盖属性 / 物品 / 技能三类；效果词条改动经 `touchCarrier` 记到宿主 |
| REQ-029 | 盘点记录 + 与本章初对比 | ✅ | `pack-diff.ts`、`RecordDrawer`、`usePackPanel.chapterBaseline`、`novel-pack-save` 记录存 `realmLink` | **本章初 = 当前章节里时间最早的记录**（记录存的正是「保存前的库内状态」，所以不需要另做「打开章节自动落盘」）；差异按 境界 / 属性 / 穿戴 / 物品 / 技能 / 主动效果 / 设置 七组归类；属性比的是**汇总后的值** |
| REQ-030 | 导出 Markdown 表格 | ✅ | `pack-utils.buildPackTable/buildPackMarkdown`、`PackExportButton`、`pack-export.ts`、IPC `novel-export-file` | 七个模块各有入口，复制 / 下载 .md 两种落点 |
| REQ-031 | 备注速记 | ✅ | `NoteModule` | 走草稿（它是设定数据，不是界面偏好） |

### Epic G · 保存、草稿与回退

| REQ | 项 | 状态 | 落点 | 缺口 / 备注 |
|---|---|---|---|---|
| REQ-042 | `保存 (N)` / 无改动禁用 / 保存前落回退点 | ✅ | `PackHeader`、`novel-pack-save` | 保存前先对**改动前**状态写 `novel_pack_records`（滚动保留 20 条） |
| REQ-043 | 草稿 + 关闭拦截三选一 | ✅ | `usePackData`（800ms 防抖 + 关闭必写）、`usePackPanel` 的 `requestGuard`、`CloseGuardModal`、`pack-config.ts` 的 `guardPackBeforeAction`、`electron/close-guard.ts` | 关闭面板 / 切章 / 切作品 / 退出应用**四处**都拦，共用同一个三选一弹窗；草稿落主进程 ✅（1.24.0 收尾，见 §12） |
| REQ-044 | 撤销全部 / 撤销到上次保存 | ✅ | `revertAll()`、`restoreFromRecord()` | 撤销到回退点只改内存，需再保存才写库（界面已说明） |
| REQ-045 | 失败不静默 / 整体回滚 / JSON 逃生出口 | ✅ | handler 的 `db.transaction()`、`PackHeader` 的失败态（「导出草稿」按钮） | 事务回滚 ✅ 失败态可视 + 草稿保留 ✅；JSON 逃生出口 ✅ —— 只在**失败态**出现（它不是常规导出：常规导出是 REQ-030 那七张给人读的 Markdown 表） |
| REQ-047 | 自动保存兜底（5 分钟，可关） | ✅ | `usePackPanel` 的 autosave effect | 关闭后 `关闭拦截` 仍生效 |

### P2 / 有意不做

| REQ | 项 | 状态 | 备注 |
|---|---|---|---|
| REQ-026 | 分离窗口形态 | ➖ | **PRD 自己划在 v1 范围外**（迁移路径见 §1，改动面已压到 3 个文件） |
| REQ-032 | 换装方案 Preset | ✅ | 独立表 `novel_pack_presets`（**不进** `novel_pack_records` —— 那里滚动保留 20 条，方案会被挤掉）；payload 只存「谁穿在哪个部位的哪一格」，不存物品快照；见 §17.3 |
| REQ-033 | 负重 / 容量上限 | ✅ | 物品 `weight` + 角色 `weight_limit` / `capacity_limit`（两个独立口径）；满格时 `addItem` **真的拦下新增**（PRD F-5 原话）；超载只给「记为状态」的显式入口，**不自动挂 Debuff**（理由见 §17.2） |
| REQ-034 | 行囊表格插入本章末尾 | ✅ | 走 `registerPackInsertIntoChapter` 桥 + `EditorPaneHandle.appendText`；行囊**不 import 编辑器 store**（否则绑死宿主、与分离窗口冲突） |
| REQ-035 | 派生属性公式 | ➖ | **PRD 自己划在 v1 范围外**（「复杂度与收益不匹配」，需表达式引擎） |
| REQ-036 | 多角色 | ➖ | **PRD 自己划在 v1 范围外**（「当前先实现主角的」）；数据模型已按 `character_id` 全量预留，UI 只暴露主角 |
| REQ-037 | 估算模式 | ✅ | `SummaryModule` 的 `.cpk-est`、`estimateEntries` —— 临时加成只活在内存（不落库、不计未保存改动），见 §13 |

## 4. 偏离 PRD 的两处决定（需要回看）

1. **模块「默认折叠」放全局界面偏好，而不是按角色存**
   判据用的是 PRD §8.6.2 那条自问：「改了这个值，别人的这本书会变吗？」——折叠不会。
   因此它和形态 / 宽度 / 视图一起走 config 键 `novel_pack_ui`，**不计入未保存改动数**，
   也不会因为「忘了保存」而丢。代价：多角色时折叠状态是共享的。
2. **量纲不参与属性汇总**
   PRD 没要求量纲参与算式；把它接进汇总会让「属性单位」与「量纲体系」互相纠缠。
   当前量纲只用于**展示与试算**（货币换算 / 熟练度档位 / 境界阶梯）。

## 5. 本轮修掉的两个真实缺陷（回归价值高，别改回去）

1. **`novel_links.note` 只存 `{sub}`，读取时曾复用要求 `levelId` 的 `parseRealmRaw`**
   → 已绑定状态下小层永远读成 1，表现为「小层改了、重开面板又回第 1 层」。
   现由 `parseSub()` 专职解析，并有 4 例单测锁死（`pack-realm.test.ts`）。
2. **`replaceInSlot` 只改新物品的槽位，不卸下原占用者**
   → 同一槽位出现两件，`isItemActive` 判定 `itemsInSlot.length > capacity`，**两件双双失效**；
   界面看不出异常，只有总属性悄悄回落。现改为「先卸原占用者、再放新物品」。

## 6. 验证记录（本轮）

| 项 | 结果 |
|---|---|
| `tsc --noEmit -p tsconfig.app.json` | exit 0 |
| `tsc --noEmit -p tsconfig.node.json` | exit 0 |
| `eslint`（新增 / 改动文件） | 0 problems |
| `vitest run`（全量） | 37 files / **465 passed**（其中行囊 53 例：纯函数 30 + 境界口子 15 + 事件归一化 4 + 保存删除顺序 4；模板 22 例，含行囊 10 例） |
| 真实 Electron 目视验证 | ⬜ **未做**（沙箱禁 GUI）—— 下一次开发前建议先 `pnpm dev:novel` 走一遍「打开 → 改数 → 保存 → 关闭拦截 → 载入回退点」 |

### 顺带修掉的两处既有 lint 报错

`react-hooks/refs` 认为「把 `useEdgeFade()` 的返回值整体读属性」是在渲染期访问 ref
（`chipsFade.ref` / `chipsFade.fadeLeft` 都被判为 ref 值）。改为解构后消失，
`EntityPanel` 与 `SearchPanel` 各一处，行为不变。

## 7. 下一批建议顺序

1. ~~**REQ-043 的剩余部分**：切章 / 退出应用拦截~~ —— 1.24.0 已收尾（见 §12）。
2. ~~**REQ-018 + REQ-037**：同一套「假想输入」能力~~ —— 1.25.0 已收尾（见 §13）。
3. ~~**REQ-027 + REQ-028 + REQ-030**：都依赖「正文 ↔ 面板」的桥~~ —— 1.26.0 已收尾（见 §14）。
4. ~~**REQ-010 / REQ-014 的收尾**：稀有度可改 + 熟练度进度条~~ —— 1.27.0 已收尾（见 §15）。
   实测结论要记住：**340px 面板下物品行只剩 285px，行尾图标按钮最多两个** ——
   往后往物品行加东西，一律并进行尾「更多」菜单，不要再加图标按钮。
5. ~~**REQ-040**：释放型效果的结构化参数~~ —— **本条是过期条目**：进度表里
   早在 `1.27.0` 之前就已标 ✅（`EffectEditor` 的 cast 分支 + `ModifierList.castParamText`
   展示），不必再做。以后重排 §7 时先回表对一遍状态。
6. ~~**REQ-029 的剩余部分**：与本章初对比的差异视图~~ —— 1.28.0 已收尾（见 §16）。
7. ~~**剩余的 9 条**：REQ-001 / 019 / 020 / 022 / 025 / 032 / 033 / 034 / 045~~ ——
   1.29.0 一次性收尾（见 §17）。**行囊的 PRD 需求至此全部结清**：
   ✅ 可做项全做完；➖ 三条是 PRD 自己划在 v1 范围外的（REQ-026 分离窗口 /
   REQ-035 派生公式 / REQ-036 多角色），已按需求方「三条都跳过」的决定跳过。

> **下一批没有既定条目了。** 再要动行囊，按这个顺序找活干：
> ① 把 ➖ 三条里的任一条重新立项（都有明确的迁移/实现路径写在 §1 与 §17.5）；
> ② 修「已知限制」里那些（§13.6 / §14.5 / §15.8 / §16.8 / §17.6）；
> ③ 新需求进来时先回表对一遍状态 —— §7 曾长期挂着一条早就做完的 REQ-040。

## 8. 1.19.0 追加：主角设定 + 模板行囊

### 8.1 为什么要补「主角」这一格

行囊只承载主角一人，境界要同步就必须知道**主角对应设定库里的哪张角色卡**。
此前这件事只能靠在行囊面板里手动选一个实体（`RealmModule` 的下拉），
两边的认知是断开的：右侧要素栏看不出谁是主角，行囊也看不出这张卡是不是主角。

现在把「谁是主角」明确定义为 **`novel_pack_characters.entity_id` 这一格**：

- **不另建表、不另加列**（v1 只有一条主角，`is_protagonist` 已按多角色预留）；
- 「设为主角」= 把该角色实体绑成行囊主角；换一个即改写同一格；取消即置空；
- 右侧要素栏与行囊面板的绑定下拉是**同一格的两个入口**，写的是同一份数据。

### 8.2 落点

| 面 | 落点 | 说明 |
|---|---|---|
| 主进程 | `novel-pack-handlers.ts` 的 `ensurePackCharacterRow()` + `novel-pack-protagonist-get/-set` | 「首次使用」有两个入口（开面板 / 在要素栏设主角），共用同一个播种函数；读取不建行（没打开过行囊就不该有角标） |
| 右侧要素栏 | `EntityCard`（皇冠角标 + 快捷按钮）、`EntityDetail`（主角区 + 当前境界标题的「行囊同源」角标）、`EntityPanel`（主角置顶） | 入口**只在角色卡上出现**：地点 / 派系卡给这个按钮会让人误以为也能设主角 |
| 页面接线 | `hooks/usePackProtagonist.ts` → `useNovelPage` → `SupportPanel` → `EntityPanel` | 主角绑定要在行囊面板关闭时依然可用 |
| 事件 | `pack-config.ts` 的 `PACK_PROTAGONIST_EVENT` / `PACK_REALM_EVENT` + 两个 `notify*` | 定义放在行囊模块里：主角与境界都是行囊的数据，右侧栏只是另一个展示面；未来迁独立窗口时事件随模块走 |

### 8.3 双向实时（本轮把闭环接完）

| 方向 | 触发 | 另一侧的反应 |
|---|---|---|
| 要素栏 → 行囊 | `setProtagonist` → 写库 → 广播 `pack-protagonist-changed` | 行囊**只打内存补丁**（`dirtyDelta=0`）并重读元数据，不重载文档——重载会吃掉未保存的编辑 |
| 行囊 → 要素栏 | 行囊绑定下拉 → 同一条 IPC → 同一广播 | 角色卡角标立即跟随；不再需要等到保存 |
| 行囊 → 要素栏（境界） | `writeRealm` → 写 `novel_links` → 广播 `pack-realm-changed` | `useNovelData` 对 `links` 打补丁（不整体重载）→ 角色卡上的境界名立刻变 |
| 要素栏 → 行囊（境界） | `setEntityLevel` → 广播 `pack-realm-changed`（`origin='panel'`） | 行囊重读元数据；`origin='pack'` 的广播被自己跳过，避免无谓的整体重读 |

**边界**：主角绑定与境界关联都属于「跨模块共享的那一份」——**即时落库、不计入未保存改动数、不参与「撤销到上次保存」**。
理由同 §4 的判据：这一格改了，别人的这本书的那个角色也会变，它本来就不是行囊私有的编辑。

### 8.4 模板行囊（模板书里的范例）

`electron/novel-template.ts` 新增 `TemplatePack`，由 `seedTemplateBook()` 落到 `novel_pack_*` 表。
一份「填满了的范例」比空壳更能说明怎么用：

- **主角直接绑到 `tpl-e-char-shen`（沈青梧）**，而模板第 9 条关联已把她的「当前境界」落在**凝丹**
  → 打开行囊即可看到「行囊 ↔ 实体面板同源」是活的，不需要先自己配一遍；
- **三档性质各留范例**：被动（锋锐 / 剑势 / 静心 / 蕴灵 / 通明）、
  持续（踏浪 / 持灯 / 听潮 开着；灯影护体 **关着** 作对照）、释放（引魂照影 / 观星问潮）；
- **两条「不计入」的边界情况**：被动 + 触发条件（残卷·窥机，触发「潮汐之夜」）、
  技能总开关关掉（观星术，其被动同样不计入）；
- **戒指 capacity=2**，素银戒 / 星砂戒 分别占 0 / 1 号槽位；
- **熟练度缩放**：执灯诀 熟练度 500（满）→ 持灯 +4 实际按 1.5 倍计为 +6；
- **量纲**：1 金 = 100 银 = 10000 铜；熟练度三档（入门 / 熟练 / 大师）；
- **等级阶梯补齐 R25 两个缺口**：每阶都有 `sub_levels` 与 `power`（引气 9 层 / 当量 10 → 登仙 当量 65610）。

`electron/novel-template.test.ts` 新增 10 例锁死这些约束（尤其「主角必须绑到角色要素」
「穿戴位置不越容量且不重复占格」「每条效果都指向有效载体与属性」）。

⚠️ 已知缺口（未处理，属于既有行为）：若在**行囊面板打开的情况下**执行「重置为模板书籍」，
面板里的文档仍是重置前那份，保存会把旧数据写回去。重置是调试入口，暂不额外拦截。

---

## 9. 1.19.1：主角/联动三项静默失效的根因与修复

> 起因：作者实测反馈「设为主角的功能无用 / 行囊和面板信息还是不同步 / 预设的模板需要预设一个主角」。
> 结论：前两条是**同一个根因**造成的静默失效，第三条的模板数据本来是对的、但被同一个形态问题掩盖。

### 9.1 根因：跨模块事件的负载形状有两套，监听器只认了一套

`pack-config.ts` 的 `notify*` 每次都发两次（同窗口 `CustomEvent` + 跨窗口 `windowAPI.broadcast`），
这是**刻意的**——因为 `window-broadcast` 会 **排除发送者**（`broadcast(event, data, senderName)`），
只发 broadcast 的话，同窗口的另一个展示面收不到。但两条路的负载形状不同：

| 路径 | 监听器收到的第一个参数 | 负载位置 |
|---|---|---|
| 同窗口 | `CustomEvent` 实例 | `.detail` |
| 跨窗口 | 负载对象本身 | 第一个参数 |

而四个订阅点全部写成 `args[0] as Detail` → **同窗口这条路永远读出 `undefined`**：

| 订阅点 | 读到 `undefined` 后的行为 | 作者看到的现象 |
|---|---|---|
| `usePackProtagonist` | `setEntityId(undefined ?? "")` → **清空** | 点「设为主角」角标一闪就没 → 「无用」 |
| `usePackPanel`（主角） | `undefined !== workId` → `return` | 右侧设的主角，行囊不知道 |
| `usePackPanel`（境界） | 同上 → `return` | 右侧改境界，行囊不知道 |
| `useNovelData`（境界） | `detail.link` 为 `undefined` → `return` | 行囊改境界，右侧不知道 |

**修复**：`pack-config.ts` 导出 `readEventDetail<T>(args)` 统一归一化（`first instanceof Event` 就取
`.detail`），四个订阅点全部改用它；`pack-config.test.ts` 补 4 例（含「广播后同窗口监听器拿到的必须是
负载而不是事件对象」这条回归）。**这是一类缺陷，不是一个 bug**：以后新增任何「同窗口 + 跨窗口」
双投递事件，都必须走这个读取函数。

### 9.2 第二处：保存会把刚设的主角冲掉

`novel-pack-save` 的 upsert 此前连带回写 `entity_id`。而草稿（`novel_pack_drafts`）里存着
`character.entityId` 的快照——若草稿是设主角**之前**写的，一次保存就把它覆盖回去。
**修复**：主角绑定只保留一个写入口（`novel-pack-protagonist-set`），保存不再写该列。

### 9.3 第三处：行囊「主角」下拉读不到名字

`RealmModule` 的角色选项原本 `if (bindOpen)` 才加载。未展开时 `Select` 处于
「value 有值 + options 为空」的形态，antd 会把**裸 id**（模板书里就是 `tpl-e-char-shen`）显示出来，
看着和「没设主角」几乎一样——所以模板其实一直有主角，只是没显示成人名。
**修复**：改为模块挂载即加载。

### 9.4 一致性收敛：主角绑定以库为准

- 装载（`usePackData.applyBundle`）：**不从草稿取 `character.entityId`**，一律用正式行的值；
- 「撤销全部改动」（`revertAll`）：保留当前的 `entityId`，不跟着撤销回退。

理由是它属于跨模块共享数据（判据 §4 / PRD §8.6.2），不属于「可撤销的设定数据」。

### 9.5 验证

`tsc`（渲染层 / 主进程）exit 0 ｜ `eslint src/windows/NovelWindow electron src/shared` → **0 errors** ｜
`vitest run` 全量 **36 files / 461 passed**（+4 例事件归一化）｜ `vite build` exit 0
⬜ 仍需真机目视（沙箱禁 GUI）——重点复测四条方向：右侧设主角 → 行囊下拉是否立刻变、
行囊换主角 → 右侧皇冠是否跟着走、两边各改一次境界是否互见、重置模板后行囊是否自带沈青梧。

## 10. 1.19.2：行囊保存「第二次起必然失败」

### 10.1 现象与根因

保存直接报 `SqliteError: UNIQUE constraint failed: novel_pack_modifiers.id`，整个事务回滚
→ 用户侧看到的就是「改了存不上」。

`novel_pack_modifiers` 是**多态表**：`(owner_type, owner_id)` 指向 item / skill / status，
**没有 `character_id`**，所以「这本书的加成」只能靠子查询从宿主表反查：

```sql
DELETE FROM novel_pack_modifiers
 WHERE (owner_type = 'item'  AND owner_id IN (SELECT id FROM novel_pack_items  WHERE character_id = ?))
    OR (owner_type = 'skill' AND owner_id IN (SELECT id FROM novel_pack_skills WHERE character_id = ?))
    OR (owner_type = 'status' AND owner_id = ?)
```

而整文档替换原本写的是「**先删宿主、再删加成**」——宿主一删，反查子查询立刻变成空集，
**一条加成也删不掉**；紧接着重新 INSERT 同 id（id 来自文档，保存前后不变）→ 主键冲突 → 事务回滚。

第一次保存之所以没事：库里还没有这些 id。**从第二次起必失败**；
用模板行囊（固定 id `tpl-pm-*`）时 100% 复现，因为每次保存的 id 完全一样。

### 10.2 修复

1. 加成删除**提到宿主循环之前**，并在原处写明「这是硬约束，不是风格问题」。
2. 顺带加一次**孤儿清理**：`owner_type = 'item' | 'skill'` 而宿主已不存在的加成直接删掉。
   它们是历史上这个顺序写反而残留的，既不显示也不参与汇总，只会在将来某次 id 复用时突然报冲突。
3. 新增 `electron/novel-pack-save-order.test.ts`（4 例）把顺序钉住。
   **为什么用源码断言**：better-sqlite3 的 native 模块按 Electron ABI 编译，
   vitest（node 进程）下 `require` 直接抛 → 这类顺序不变量在单测里只能断言源码。
   项目已有先例（`themes.test.ts` / `line-geometry.test.ts`）。

### 10.3 验证

`tsc`（渲染层 / 主进程）exit 0 ｜ `eslint src/windows/NovelWindow electron src/shared` → **0 errors** ｜
`vitest run` 全量 **37 files / 465 passed** ｜ `vite build` exit 0
⬜ 仍需真机复测，且**必须连做两次保存**：打开模板书 → 改一处（如某件装备的加成值）→ 保存
→ **再改一次、再保存**（第二次才是原缺陷的触发点，只存一次看不出问题）。

## 11. 1.21.0：行囊 UI 全量切换组件库 + 三份「不生效的样式」

### 11.1 为什么必须换（不是风格洁癖）

原生控件在暗色主题下不跟随 antd 的 `darkAlgorithm`（会变成浅色斑块），且拿不到
组件库给的键盘可达性、焦点环、禁用与 `aria` 语义；更要紧的是**每个状态都得自己再写一套**
hover / active，改主题时总有一两处漏掉。所以 `AGENTS.md` §6.1.2 从"描述性偏好"
升级为**强制条款**。

本轮清零的范围：7 个 `<input>`、1 个 `<textarea>`、60 个 `<button>`（无原生 `<select>`，
下拉本来就是 `Select`），共 68 处，涉及 15 个组件文件 + 4 份公共原语。

### 11.2 覆盖组件库外观：只改变量，不写状态属性

这是本轮最重要的一条经验，**别退回老写法**：

```scss
// ✅ 改变量：antd 自己的 hover / active / disabled 规则会跟着变
.cpk-btn.ant-btn {
  --ant-button-default-bg: var(--app-surface);
  --ant-button-default-hover-bg: var(--app-surface-hover);
}

// ❌ 写属性：压不过组件库，换主题也不联动
.cpk-btn:hover { background: var(--app-surface-hover); }
```

原因是特异性：antd 的状态规则（`.ant-btn-color-default.ant-btn-variant-outlined:not(:disabled):hover`）
是 **(0,4,0)**，自写 `.cpk-btn:hover` 只有 (0,2,0)。而这些规则读的正是上面那些变量——
**改状态只需改变量**。

**两处必须记住的实现事实**（都已核对过 antd 6.6.2 的真实产物）：

| 事实 | 结论 |
|---|---|
| 组件级变量的默认值写在 `.css-var-<hash>.ant-btn`（(0,2,0)）上，与 `.cpk-btn.ant-btn` **同特异性** | 胜负由源码顺序决定。antd 的 cssinjs 用 `insertBefore(firstChild)` 把样式插到 `<head>` **最前面**，应用 CSS 的 `<link>` 在后 → **我们的规则胜出**，不需要 `!important`（状态覆盖除外，见 `EntityDetail` 的既有写法） |
| `.ant-btn` 的 height / padding / border-radius / font-size / gap 都只**消费一次**对应变量（(0,1,0)） | `.cpk-btn.ant-btn`（(0,2,0)）稳定压过它 → **行囊统一不传 `size`**，密度由样式表给 `--ant-control-height`，杜绝"漏传 size 就变形" |

另外两条容易踩的：

- **图标作 `icon` 属性传**会让 antd 包一层 `.ant-btn-icon` 并推 `ant-btn-icon-only`；
  **作 children 传**时图标与文字都是按钮的 flex 子项，间距由 `--ant-button-icon-gap` 决定 ——
  此时 JSX 里**不要再留空格**，否则间距翻倍（`<PlusOutlined />物品` 而不是 `<PlusOutlined /> 物品`）。
- **`<button>` 里不能嵌 `<button>`**：浏览器会拆坏 DOM，React 不报错、类型也过。
  效果编辑器原来的"整行可点 + 行尾删除"是 `<button>` 里放 `span[role=button]`，
  换成组件库按钮后必须重构为**行容器 + 两个并列真按钮**（行容器不是交互元素）。

### 11.3 「清零点」mixin：`styles/pack-widget.scss`

行囊里有一批**视觉是设计定的**控件（阶梯格子、候选物品行、折叠头、性质卡、属性汇总行、
释放提示条、属性引用胶囊、角色名、效果选择行）。做法是仍用 `Button` 承载
（拿到波纹 / 键盘 / 禁用语义 / focus 环），再用 mixin 把 antd 自带外观清零后重绘。

**必须是 mixin，不能是 `pack-common.scss` 里的公共类**：清零与控件自己的变量要写在
**同一个选择器**里，才能靠源码先后决定胜负；写成两个类则要靠文件先后，而组件样式先于
`pack-common.scss` 打包，顺序恰好是反的 —— **会静默失效**。

```scss
// 组件自己的 index.scss
@use "../../styles/pack-widget" as widget;

.cpk-xxx.ant-btn {
  @include widget.cpk-widget;                    // 先清零
  --ant-button-default-bg: var(--app-surface);   // 再按需声明
  width: 100%;                                   // antd 不接管的属性直接写
}
```

虚线边框不要写 `border-style`，改 `--ant-line-type: dashed` —— antd 的边框恒读这个变量
（`border: var(--ant-btn-border-width) var(--ant-btn-border-style) var(--ant-btn-border-color)`），
写变量比写属性更不容易漏掉某个状态。

### 11.4 顺带发现的真缺陷：三份「改了没反应」的样式

`NoteModule` / `StatusModule` / `SummaryModule` 的 `index.scss` **从未被任何地方引用**
（构建产物里连 `cpk-note__area` / `cpk-stt__top` / `cpk-sum__rows` 这些类名都不存在）。
表现就是"改了样式、界面毫无反应"，而且**不报错、类型也过**。已按 `AGENTS.md` §8.3
补上 `import "./index.scss"`，并把这条写进守卫测试。

> 排查手法：换完类名后 `grep -l -F "<新类名>" dist/assets/*.css`。产物里没有 = 样式根本没进包，
> 不要再去纠结特异性。

### 11.5 验证方式（比截图强，可复用）

1. **先核对 antd 真实产物，不要凭记忆猜变量名**：用 `ConfigProvider` +
   `@ant-design/cssinjs` 的 `createCache` / `extractStyle` 打一份真实 CSS，
   确认变量名（实际是 kebab-case 的 `--ant-button-*`，不是文档里的 camelCase token 名）
   与它消费的属性。
2. **可视验证台**（`.probe-visual.cjs` 的思路）：把 antd 真实 CSS 与编译后的 SCSS
   按「antd 在前、应用 CSS 在后」的顺序注入一个静态页面，再用无头 Chrome 在页面内
   `getComputedStyle` 逐条断言（高度 / 内边距 / 颜色 / 边框样式 / flex 间距 / 是否被清零）。
   本轮 58 条断言全绿。比看截图可靠得多。

   > 一个反例：`variant="borderless"` 的 `Input` 块内边距是 **1px** 而不是 0 ——
   > antd 做了 `calc(padding-block + line-width)` 补偿，让无边框输入框与同尺寸带边框的
   > 兄弟保持文字基线一致。这是**预期行为**，别去"修"它。
3. `tsc`（渲染层 / 主进程）｜ `eslint` ｜ `vitest run` 全量 ｜ `vite build`（见 §11.6）。
4. 产物顺序确认：`dist/src/windows/NovelWindow/index.html` 里应用 CSS 是
   `<link rel="stylesheet">`（在 antd 运行时注入的 `<style>` **之后**）—— 这是
   「同特异性下我们胜出」这个前提的落地依据。

### 11.6 验证记录

`tsc --noEmit -p tsconfig.app.json` exit 0 ｜ `eslint .` **0 errors**（1 条既有 warning，与本次无关）｜
`vitest run` 全量 **38 files / 487 passed** ｜ `vite build` exit 0 ｜ 无头 Chrome 计算样式 **58/58 PASS**
⬜ 仍需真机复测：四套主题各看一眼行囊（按钮/输入框/开关/虚线提示条/阶梯格子），
重点看**暗色主题**下有无"浅色斑块"，以及效果编辑器的"整行可点 + 行尾删除"两处是否都可点。

## 12. 1.24.0：未保存拦截管到底（REQ-043 收尾）

### 12.1 之前缺的是什么

拦截只挂在「关闭面板」这一条路上。另外三条路能让编辑离开当前上下文，却一声不响：

| 路径 | 之前的行为 | 为什么算丢失 |
|---|---|---|
| 切章（章节树 / 跳转面板 / 大纲） | 直接切走 | 面板不卸载、也不问 —— 作者切走后就再不会回来保存，改动一直挂在内存里到某次关面板才被问到 |
| 切作品（顶栏下拉） | 直接换书 | 换书会让行囊**整体重载**，当前这本的编辑只有草稿兜底，用户没有任何知情机会 |
| 退出应用 / 关闭子窗 | 直接销毁渲染层 | `useEffect` 的 cleanup 不保证跑完，最后一次 800ms 防抖窗口内的草稿可能丢 |

### 12.2 两条闸门，不要合并

| 闸门 | 签名 | 语义 | 用户看到 |
|---|---|---|---|
| `requestClosePackPanel()`（1.21.0 起） | 同步返回 `boolean` | 「**关面板**这件事谁接手」：false = 当前没有面板 | 关面板弹窗 |
| `guardPackBeforeAction(reason)`（本轮） | 异步返回 `Promise<boolean>` | 「**这件事**能不能继续做」 | 同一个弹窗，文案带原因 |

为什么不能只留一条：调用方要的东西不一样。顶栏 / Esc 只关心「面板接没接手」（同步够用，
异步反而要在组件里挂 then）；而切章 / 切作品 / 退出必须**等**用户答完才知道该不该继续走。
两条都注册在同一个 `open` 生命周期里（`registerPackCloser` / `registerPackGuard`），
卸载时一起摘掉。

**闸门对「已有弹窗在问」的处理是直接取消本次动作**（`if (guardResolveRef.current) return false`）。
不能让新问题顶掉旧问题：旧 Promise 会永远不 settle，它的调用方（例如切章）就永远停在
`await` 上 —— 表现是「点了章节没反应」，而且没有任何报错。同理，面板卸载时要把未决的
弹窗判为取消，否则同样留下一个悬空的 await。

### 12.3 主进程那侧：`electron/close-guard.ts`

渲染层只负责「报有没有脏」，主进程只负责「销毁前问一句」。三条通道：

```
window-close-guard    渲染层 → 主进程   有未保存改动时武装，脏计数归零即解除
window-close-request  主进程 → 渲染层   { reason }（"退出应用" / "关闭窗口"）
window-close-response 渲染层 → 主进程   boolean，true = 放行
```

四条不能省的实现约束（都写进守卫测试了）：

1. **只在脏计数 >0 时武装**。常态退出零往返 —— 「每次关窗都等渲染层回话」本身就是一类
   稳定性风险（渲染层无响应 = 退不出去）。
2. **询问必须在 `before-quit` 的清理之前**。`main.ts` 那段清理里有 `closeDb()`；先清理再问，
   用户慢慢选完「保存并继续」时库已关闭，保存必然失败 —— 拦截承诺直接落空。现在
   `before-quit` 里先判 `hasArmedCloseGuard()` → `preventDefault()` → 问 → 放行后才
   `isQuitting = true` 并重退。**询问期间不能置 `isQuitting`**：置了主窗的 `close` 就不再
   进托盘，会直接销毁。
3. **主窗「隐藏到托盘」不拦**（`attachCloseGuard(novelWin, () => isQuitting)`）：点 X 只是
   `hide()`，渲染层还活着、草稿安全，弹拦截纯属打扰。子窗形态（full 版）即关即销，
   `attachCloseGuard(novelWin)` 默认拦。
4. **渲染层崩了 / 窗口已销毁就放行**，并给询问 2 分钟超时（超时按「取消关闭」处理）。
   守卫状态是渲染层写入的，渲染层死了没人来清 —— 不留兜底就变成「应用永远退不出去」。
   同理，用户取消退出时要把这一轮已放行的窗口**恢复成未放行**，否则下次点 X 静默关闭。

另外一个容易漏的细节：**询问前先 `show()`**。主窗点 X 进托盘后，用户从托盘选「退出」，
此时窗口是不可见的 —— 不发 `show()` 就等于把弹窗发给了看不见的窗口，表现成
「点了退出，应用没反应，也没有任何提示」。

### 12.4 验证

`tsc`（渲染层 / 主进程）exit 0 ｜ `eslint src electron` → **0 errors**（1 条既有 warning）｜
`vitest run` 全量 **46 files / 741 passed** ｜ `vite build` exit 0
⬜ 仍需真机复测（沙箱禁 GUI），**四件事各走一遍**：
① 在行囊里改数 → 点另一章 → 应弹「切换章节前有 N 处改动尚未提交」；
② 同上点顶栏换作品；
③ 改数后从托盘选「退出」（窗口处于隐藏态）→ 窗口应自己弹出来问；
④ 子窗形态（full 版）改数后点标题栏 X → 应弹拦截。

### 12.5 已知限制

- **退出登录**走 `destroy()` 而不是 `close()`，不经守卫；渲染层 cleanup 不保证跑完，
  最后一次 800ms 防抖窗口内的草稿可能丢。退出登录是显式动作，本轮不扩范围。
- 「重置为模板书籍」在面板打开时仍不清面板内文档（§8.4 已登记的既有行为）。

## 13. 1.25.0：一次「假想输入」，两条需求（REQ-018 + REQ-037）

### 13.1 先修一个纯静默的汇总缺陷：状态效果从来没被算进去

动手之前拿探针跑了一遍现状，结果是：

```
buildActiveCarriersFrom 得到载体集合：[ 'status:m1' ]
computeSummary 的结果：final = 100（= 基础值），countedCount = 0
```

**原因**：载体集合按 `status:<效果自己的 id>` 建键（`buildActiveCarriers`），
而 `computeSummary` 的闸门 1 却拿 `carrierKey(mod.ownerType, mod.ownerId)` 去查 ——
所有 status 效果的 `ownerId` 都是**同一个角色 id**（多态表约定），两边永远对不上。

所以：状态效果（Buff / Debuff / 阵法增益）开着也不计入总属性，**界面上没有任何提示**，
只有对着数字才发现。这属于「看着像在工作、实际什么都没做」那一类。

修法不是「把其中一侧改对」，而是**让判定键只有一个产出点**：

```ts
carrierKeyOf(mod)   // status → carrierKey("status", mod.id)
                    // item/skill → carrierKey(mod.ownerType, mod.ownerId)
```

闸门 1 改用它；`buildActiveCarriersFrom(parts)` 收拢「从文档切片组装载体集合」这件事，
面板的实时汇总与预览的假想汇总共用同一份 —— 各写一遍，只要有一侧忘了状态取 `mod.id`，
两边就会长期不一致（且静默）。

⚠️ `isCarrierActive(ownerType, ownerId)` 这个对外 API **只适用装备 / 技能**（它们的载体键就是
`ownerId`）。它保留了，但加了警告注释：别再往这条路上加状态调用点。

### 13.2 核心能力：`computeHypotheticalSummary`

「假想输入」= 把一次**还没发生**的改动应用到文档切片上，再走**同一条**汇总管线：

```ts
applyHypothetical(input, patch)            // 纯函数，不改原对象
computeHypotheticalSummary(input, patch)   // → SummaryResult
summaryDeltas(base, next)                  // → 只回传变化非零的行
```

`patch` 目前两种：`equip`（穿上某件，满位顶替）与 `extraModifiers`（临时加成）。

**为什么不给 `computeSummary` 开一个「额外加成」旁路参数**：旁路意味着闸门 1（载体在效）、
闸门 2（性质可计入）与运算顺序都要再实现一遍，两份实现迟早分叉 ——
而分叉的表现是「预览说 +200，装上后只加了 150」，属于最难查的一类。走同一条管线则
「预览里出现的每个数，真做那件事之后都会原样出现」是结构上保证的，不靠自觉。

**满位顶替的语义必须与 `equipItem → replaceInSlot` 严格对齐**：只改新物品的 `slotIndex`
会让同槽位同时存在两件，`isItemActive` 的 `itemsInSlot.length > capacity` 判定让两件双双失效
—— 界面看不出异常，只有总属性悄悄回落。所以 `equipHypothetically` 是「先找空位，
满位才顶替，且占用被顶者的槽位序号」。

### 13.3 REQ-018：候选列表悬停 Δ

落点在**装备栏的候选物品列表**（点某个部位的「穿戴」后展开的那个列表）——
它是「这个部位能穿的未穿戴装备」这一集合的唯一呈现处，部位是确定的，Δ 才不会有二义。
实现上把候选行包进 antd `Popover`（`trigger="hover"`）：

- **浮层内容惰性挂载**，所以「每件候选都跑一遍完整汇总管线」不会发生在列表渲染时，
  只在你真的悬停某一件时才算一次；
- Δ 清单**只列真的会变的属性**：一张大半是「0」的表会把真正在意的那两行淹掉；
- 一行没变时给一句话（「穿上后总属性不变」），而不是弹一个空白浮层。

**未做**：物品栏列表里的悬停预览。那里「这件该穿到哪个部位」需要猜（可能被多个部位接受、
可能都满位），猜错就会给出误导性的数字 —— 与其显示一个不确定的 Δ，不如不显示。

### 13.4 REQ-037：估算模式

总属性汇总模块头部加「估算」开关。打开后是一块虚线框住的编辑器（属性 / 运算 / 数值 / 删除），
属性行右侧给出「估算值 + Δ」。

**临时加成只活在内存里**（`useState`，不进草稿、不进正式表、不计入未保存改动数）——
面板一关就没了，这是刻意的：一旦它被持久化，就变成一份要维护的真数据，
估算模式也就不再是「试算」。

实现细节两条：

1. **临时加成挂成 `status` 型、`active` 恒真**。状态效果「自己就是载体」，无需真造一件装备 /
   一个技能；`active` 恒真才能过闸门 1 与闸门 2。id 加 `est-` 前缀：它不是真数据，
   任何按 id 回查文档的地方都查不到它，前缀让这类落空一眼可辨。
2. **`sortOrder` 排在真实词条之后**（900000+）：override 冲突时估算值要能盖住真实值 ——
   否则「估算」被真实数据反盖，很反直觉。

⚠️ **估算编辑器必须渲染在属性行按钮之外**。属性行本身是 antd `Button`（整行可点开明细），
`<button>` 里套 `Select` / `InputNumber` 是无效 HTML，浏览器会把内层控件踢出按钮，
表现成「点了没反应」或「点输入框结果打开了明细」。`SummaryModule/index.test.tsx` 用
`document.querySelectorAll(".cpk-sum__row button, ...")` 钉死这一条（一旦被挪进去立刻红）。

### 13.5 验证

`tsc`（渲染层）exit 0 ｜ `eslint src electron` → **0 errors**（1 条既有 warning）｜
`vitest run` 全量 **47 files / 758 passed**（`pack-utils.test.ts` 50 例、新增
`SummaryModule/index.test.tsx` 5 例、`pack-close-guard.test.ts` 23 例）｜ `vite build` exit 0

⚠️ **本轮最有价值的一条回归**：`pack-utils.test.ts` 里「开着的状态效果真的计入总属性」那条，
在修复前必然失败（final = 基础值、countedCount = 0）。

⬜ 仍需真机确认（沙箱禁 GUI）：① 装备栏点「穿戴」→ 悬停候选看 Δ 浮层；
② 汇总模块开「估算」→ 加一条 → 行上出现估算值与 Δ；③ 关面板再开，估算条目应清空。

### 13.6 已知限制

- 估算条目**跨面板关闭不保留**（会话级状态）。若将来要保留，应存 config 而非草稿表 ——
  它不属于「这本书的设定数据」。
- REQ-018 未覆盖物品栏列表（理由见 §13.3）。
- 状态效果修复会**改变已有数据的汇总读数**：此前一直没被计入的状态效果，从此开始计入。
  这是修正而非回归，但对作者而言是可见的数值变化，CHANGELOG 已写明。

## 14. 1.26.0：快捷盘点的三段闭环（REQ-027 + REQ-028 + REQ-030）

### 14.1 REQ-027：右键「记入背包」——两条路，别混

作者在正文里写「风雷双匕」，选中 → 右键 → 记入背包，物品栏立刻多一条，来源章节自动填当前章。
难点不在 UI，而在**面板开着与没开着时的写入方不是同一个**：

| 场景 | 谁是数据主人 | 落点 | 脏计数 |
|---|---|---|---|
| 面板开着 | 面板的内存文档 + 草稿 | `registerPackQuickAdd` 注册的同步处理器 | +1（需保存） |
| 面板没开 | 主进程的正式表 / 草稿 | IPC `novel-pack-quick-add` | 无 |

**为什么面板开着时不能直接写库**：面板在会话里持有整份文档，它的草稿是**整文档**写入的。
绕过它往库里插一行，下一次防抖（800ms）就会把那行覆盖掉 —— 表现为「记了东西，过一会儿没了」。

**为什么面板没开时不能无脑插正式表**：草稿优先于正式行（`applyBundle` 的合并顺序）。
若库里还留着一份改动前的草稿，插进正式表的那行会被草稿整个盖住 —— 同样是静默丢失。
所以主进程那条路是「**有草稿就并入草稿，没有才直插正式表**」。

这条桥与 `registerPackCloser` / `registerPackGuard` 是同一套模式（模块级单例 + `open` 生命周期注册 + 卸载摘除），
`runPackQuickAdd` 返回 `{handled, ok}` 而不是 `boolean` —— 需要区分「没面板」与「面板处理失败」，
否则没面板时会被当成失败（或反过来，失败被当成成功）。

### 14.2 REQ-028：本章变动角标

判定条件三个，缺一不可（`hasRecentChange`）：

```
updatedAt > 0            // 有改动落点：旧数据补列后是 0，不能凭空亮
updatedAt > readAt       // 晚于「全部已读」底线
now - updatedAt < 24h    // 自动过期，不依赖用户点已读
```

用「晚于」而不是「不早于」：`readAt` 取的就是点击那一刻的 `Date.now()`，
用 `>=` 会让「点已读那一毫秒刚好也改了这条」永远亮着。

**补列默认 0 是关键决定**：`novel_pack_attributes` / `novel_pack_skills` 此前没有时间戳列，
增量迁移给 `DEFAULT 0`。若图省事补成 `Date.now()`，作者一打开行囊会看见满屏「刚改动」的假角标 ——
而角标一旦不可信，它就退化成装饰。

**效果词条的改动要传播到宿主**（`touchCarrier`）：给装备加 / 改 / 删 / 开关一条加成，
物品那一行也该亮。不传播的话，「我刚才动了哪些东西」这个问题就答不全 —— 而那正是角标存在的意义。
⚠️ `removeModifier` 必须**先取宿主再过滤**：条目一删，`carrierOfModifier` 就查不到了。

**不传播的例外**：状态效果没有宿主行（它自己就是载体），跳过。
**有意不覆盖**：状态效果模块本身不显示角标（PRD F-2 的原话只点名「属性 / 物品 / 技能」三类）。

**已读底线走界面偏好**（`prefs.changedReadAt`，即改即存），不进草稿：
判据是 §8.6.2 那句「改了这个值，别人的这本书会变吗」—— 不会。
⚠️ 代价是它**全局共享**：在 A 书点「全部已读」会顺手清掉 B 书的角标。
24 小时窗口让这个影响有限，但确实是已知限制（见 §14.5）。

### 14.3 REQ-030：导出 Markdown 表格

组装全是纯函数（`buildPackTable` / `toMarkdownTable` / `buildPackMarkdown`），
DOM 侧只剩两件事（`services/pack-export.ts`）：写剪贴板、弹保存框。

**单元格转义的顺序是硬约束**：先反斜杠、后竖线。
反过来会把刚补上的 `\` 又转一遍，得到 `\\|` —— Markdown 里那仍然是一个转义符 + 一个列分隔符，
粘贴出去照样断列。换行同理折成 `<br>`。

**「下载」走主进程原生保存框**，不是渲染层 `Blob` + `<a download>`：
后者不弹框、不回报路径，作者点了之后既不知道存到哪、也不知道成没成。
实现上把既有的 `novel-export-txt` 泛化成 `novel-export-file`（多两个可选参数，TXT 导出零改动），
而不是为「换个扩展名」再抄一份 `showSaveDialog`。

**货币表导的是换算体系本身**，不是某个余额：面板里的金额输入框只是「试算」，
活在 `CurrencyModule` 的局部 state 里（行囊不持有余额字段），拿不到也不该硬凑一个数。

**Markdown 只在点击时组装**（`buildModuleMarkdown` 在菜单 handler 里调，不在渲染期）：
七个模块的表格全建一遍是要走完整汇总管线的，而它们 99% 的时间不会被用到。

### 14.4 验证

`tsc`（渲染层 / 主进程）exit 0 ｜ `eslint src electron` → **0 errors**（1 条既有 warning）｜
`vitest run` 全量 **47 files / 787 passed**（`pack-utils.test.ts` 68 例、`pack-close-guard.test.ts` 34 例）｜
`vite build` exit 0

⬜ 沙箱禁 GUI，真机待确认五件事：
① 正文选中一件物品名 → 右键「记入背包」→ 物品栏出现该条目（面板**关着**时应写库，重开面板仍在）；
② 同上但**面板开着** → 条目进面板且未保存改动数 +1；
③ 改动某属性 / 物品 / 技能 → 该行出现主色小圆点，头部出现「全部已读 N」；
④ 点「全部已读」→ 圆点全清、按钮消失；关面板重开仍不亮（底线已落库）；
⑤ 任一模块头部「导出」→ 复制 / 下载 .md，粘进正文是一张完整表格。

### 14.5 已知限制

- **「全部已读」是全局偏好**，不按书区分：在一本书点掉会清掉另一本的角标。要按书区分就得把
  底线从 `novel_pack_ui` 挪到角色行（`novel_pack_characters`），那是数据模型变更，本轮不做。
- **状态效果模块不显示变动角标**（效果词条没有独立行，PRD F-2 的三类里也不含它）。
  改状态效果时只有宿主（若有）会亮，纯状态效果则无任何标记。
- 快速记账的物品分类固定为「杂物」、稀有度「普通」：正文选区给不出这两项，
  猜不如不猜（PRD F-1 的验收点也只要求名字与来源章节）。

## 15. 1.27.0：物品行的一次宽度清算（REQ-010 + REQ-014 收尾）

### 15.1 两条需求为什么会撞在同一行

REQ-010 的缺口是「稀有度只能看」「描述与标签没入口」，REQ-014 的缺口是「进度条没渲染」。
前者要往**物品行**里加东西，后者要往**技能行**里加东西 —— 物品行是本模块最挤的地方，
所以这一轮真正的工作量不在那两个字段本身，而在「怎么塞进去还不把行压坏」。

### 15.2 先量，再改（285px 是怎么来的）

「会不会溢出」这种事用手算表格算不准：`scrollbar-gutter: stable` 实占多少、
antd 的 small 控件到底多宽、`flex-shrink` 又压到了什么程度，都不在样式表里写着。
所以搭了一个**一次性**静态 harness（用完即删，不要留在仓库里当常驻工具 —— 它必须把行的
DOM 手抄一遍，组件一改它就开始量幻觉）：

1. 用 antd 组件把这一行**渲染成真实 DOM**，再用 `@ant-design/cssinjs` 的 `extractStyle`
   把 antd 的运行时样式一次性抽出来（jsdom 没有布局引擎，在单测里量出来全是 0）；
2. 页面加载 `dist/assets/*.css`（我们的 SCSS 产物）；
3. 尾部注入 `<script>` 报 `scrollWidth / clientWidth` 与每个子项宽，
   由无头 Chrome 的 stderr 抓回来（`--enable-logging=stderr --v=0 2>&1 | grep -oE 'H .*'`）。

**这次量出来的账（340px 面板）**：

```text
340  面板宽
- 1  .cpk 的 border-left
- 10 scrollbar-gutter: stable（--hide-scrollbars 也照样占）
- 16 .cpk__body padding
- 2  .cpk-mod 边框
- 16 .cpk-mod__inner padding
- 2  .cpk-inv__item 边框
- 8  .cpk-inv__item padding
= 285  ← 一行真正可用的宽度
```

而「**已穿戴 + 刚改动角标**」这一行（最宽的一种）在只保留必要控件后的不可再压缩宽度是
**292px**：9(稀有度按钮) + 6(角标) + 14(名称输入) + 74(分类) + 72(数量组) + 52(已穿戴)
+ 行尾按钮 + 间距。每个行尾图标按钮哪怕被压到 11px，连间距仍要吃掉 **15px** ——
**340px 下只放得下两个**。原设计是「✦ + 🗑」正好两个；我一开始加的第三个
（详情箭头）让这一行溢出 7px，且行尾图标被压到 11px。

### 15.3 结论：新入口并进行尾「更多」菜单

最终编排：行尾保留 **✦（加成效果）** 与 **⋯（更多）**，删除挪进「更多」，
「描述与标签」也并进去。

- **加成效果刻意留在菜单外**：那是这个面板存在的理由（汇总加成），不该被推进二级；
- **删除进菜单反而更安全**：它本来就带一步确认，现在是三步；
- 改完 `scroll=285 / client=285`，**不溢出**，且行尾图标从被压到 11px 回到 13px
  （比改动前还宽松一点）。

**给后续改动的硬约束**：往物品行加东西一律并进行尾「更多」菜单，不要再加图标按钮。
`InventoryModule/index.test.tsx` 里锁了 `.cpk-inv__line .cpk-iconbtn` 的数量为 5。

### 15.4 行结构：两段式，不用 `flex-wrap`

`.cpk-inv__item` 从「控件直接铺平的一行」改成 **「控制行（`.cpk-inv__line`）+ 详情块」**
的列向布局（同 `SkillsModule` 的做法）。

不用 `flex-wrap: wrap` 让详情块自己换行：**wrap 的触发条件是「行内放不下」**，
面板缩到 340px 时会把「装备」按钮一起挤到第二行 —— 同一份样式在 420px 和 340px 下
表现不同，而且这种差异只在拖窄时才出现。宫格视图下 `.cpk-inv__line` 改回列向，
观感与改动前一致。

### 15.5 标签为什么要「草稿 → 失焦提交」

标签在库里是 `string[]`，输入时用户敲的是「空格分隔的一整串」。若每个字符都
`split` 回写模型，敲到一半的空格会被立刻规范化（值被 join 回来），
表现成**「打不出第二个词」**。所以草稿留在组件本地，**失焦 / 回车 / 收起详情**时才解析一次；
收起时也要提交，否则「打了字、面板一收就没了」。

分隔符收 `[\s,，、]+`：空格、中英文逗号、顿号都算。

### 15.6 熟练度：数值与「档位名 / 进度条」不是一回事

REQ-014 的原文是「展示则显示数值+等级名+进度条」，但三者的**前置条件不同**：

- **数值**是熟练度的本体 —— 效果可以按它缩放（`scaleByProficiency`），没配等级体系时照样该能改；
- **档位名与进度条**要有阈值体系才有意义。

此前两者绑在同一个 `position` 上（`thresholdOf` 在 levels 为空时返回 `null`），
于是**刚新建的行囊（没有等级体系）会发现熟练度根本改不了** —— 而
`UnitSystemManager` 里是可以把等级体系整个删掉的。现在数值只看开关，进度条另看 `position`。

进度条只表达「档位内走了多少」，右侧标出该档量纲（`100–299`）；末档无上限时标 `300+`
且条固定满 —— 网文里「超越大师」是常态，不该为它编一个上限。

### 15.7 验证

`tsc`（渲染层 / 主进程）exit 0 ｜ `eslint src electron` → **0 errors**（1 条既有 warning）｜
`vitest run` 全量 **50 files / 809 passed** ｜ `vite build` exit 0，8 个新类名
（`cpk-inv__line` / `cpk-inv__detail` / `cpk-inv__raropt` / `cpk-inv__rarchk` /
`cpk-skl__prog` / `cpk-skl__bar` / `cpk-skl__scale` / `cpk-iconbtn.ant-btn.is-on`）
全部确认在 `dist/assets/*.css` 内，中途试错留下的 `cpk-inv__rar` 已不在包里

新增守卫：`types.test.ts` 5 例、`InventoryModule/index.test.tsx` 10 例、`SkillsModule/index.test.tsx` 7 例

⬜ 沙箱禁 GUI，真机待确认四件事：
① 点物品行首圆点 → 菜单选中「传说」→ 圆点变amber色、重开面板仍在；
② 行尾「⋯」→「描述与标签」→ 填描述与标签（空格分隔两个词）→ 收起到别处再展开，值还在；
③ 技能行开「熟练度」开关 → 有档位时出现进度条与 `100–299`；把等级体系删空后数值仍能改、进度条消失；
④ 面板拖到最窄 340px → 物品行（尤其是**已穿戴 + 有角标**那行）右侧不出现被裁的控件。

### 15.8 已知限制

- **340px 下名称输入会被挤到 ~14px**：这是这一行控件太多的既有限制（本轮已缓解，
  但没有根治）。根治要么砍控件（把分类也收进菜单，但那会让行内直改变两步），
  要么改两行布局（行高翻倍）。默认宽度 420px 下名称有 73px，正常可用。
- **标签没有「点一下变 chip」的呈现**：库里是数组，界面上是空格分隔的一串。
  对作者来说够用（可见可改），但不像标签云那样一眼看出有几个。
- **稀有度是自由字符串**：未知取值走中性兜底（圆点灰色 + 原样显示该值），
  不会把历史数据「修正」成 5 档之一。

## 16. 1.28.0：与本章初对比（REQ-029 收尾）

### 16.1 这一条真正难的不是 diff，是「本章初」从哪来

差异视图本身是道送分题：两份同构文档比一比。难的是**拿谁当基准**。

`novel_pack_records` 里只有一类记录：`novel-pack-save` 在写库**前**对「改动前状态」
落的存档（REQ-042 的回退点）。它天然是「保存前的库内状态」。于是：

> 本章第一次保存落下的那条记录，正好就是本章开始时角色的样子。

所以「本章初」= **当前章节里时间最早的那条记录**，不需要新增任何落盘通道。

**没有**按 PRD F-3 的字面去做「每次打开章节自动记录一次」。那条要求在本 PRD 里
没有配套的去重口径（重开同一章五次就落五条？），而 `novel_pack_records` 的滚动
保留只有 20 条 —— 一个纯噪声的写入源会把 REQ-044 的回退历史挤掉，是**负收益**。
代价是「本章一次都没保存过」时没有起点，此时如实显示空态并告诉作者怎么才能有，
而不是拿 `latestRecord`（那是「上次保存之前」，会把上一章末尾的改动算进本章）冒充。

⚠️ 一个必须记住的坑：**不能看位置来判断「有没有设过境界」**。`getRealm` 在
`levelId` 为空时会回落到第 0 阶（刻意的：面板总要有东西可显示），于是
「从没设过」与「第一阶」拿到同一个 `RealmPosition`。按位置判断的话，开局没设
境界的角色会被写成「炼气 1/9 → 筑基 3/9」，读起来像是他本来就在炼气一层。
`realmTextOf` 因此自己判「有没有」，把结果分成三态：

| 返回 | 含义 | 处置 |
|---|---|---|
| `null` | 这份文档没带可比对的境界信息（旧记录没有那一格） | 整组跳过，不猜 |
| `""` | 明确「没设过」 | 报 `add` / `remove` |
| `"筑基 3/9"` | 正常文案 | 比字符串 |

### 16.2 境界那格必须额外存，而且要只搬数据

境界的真实值住在两处：未绑定主角时是 `novel_pack_characters.realm_at`（JSON），
绑定后是 `novel_links` 的「当前境界」行。**后者不随行囊文档走** ——
记录 payload 里那份快照根本没有它，直接做的话「境界 炼气 → 筑基」这一行
会永远不出现，而且是静默的。

处置：`novel-pack-save` 落记录时多塞一格 `realmLink`（当时的关联行原样搬过来）。
主进程**只搬数据、不解释数据** —— 关联行的解析、小层换算、排序与排版全部仍在
渲染层的 `pack-realm.ts`，不在 main 里重写第二份真相源。

`realmLink` 用 `undefined` / `null` 区分两种含义，这个区分是必须的：

- **没有这一格**（本次改动之前落的记录）→ 不知道当时的境界 → 整组跳过；
- **这一格是 `null`**（本次改动之后落的）→ 当时确实没绑境界 → 是有效信息，可参与比较。

`parsePackDiffDoc` 里用 `"realmLink" in doc` 判断，不能用 `doc.realmLink ?? undefined`
（那会把两者压成同一种）。回归用例见 `pack-diff.test.ts` 的
「『没有 realmLink 这一格』与『这一格是 null』必须能区分」。

### 16.3 属性比的是汇总后的值

作者问的是「攻击 3,400 → 3,840」，而 3,400 是**加完装备与被动之后**的总和。
只比 `baseValue` 的话，换一件武器、开一个被动都不会出现在这张表上 ——
而那是点开它的首要原因。所以属性组跑**两次完整汇总管线**
（`buildActiveCarriersFrom` + `computeSummary`，与面板、与假想输入同一口径），
比 `final`。

比较的是**格式化之后的文案**而不是浮点原值：`0.1 + 0.2` 之类的尾巴会被
`formatAttrValue` 吃掉，不会冒出一行「3,400 → 3,400」的假变更。

### 16.4 只报「角色身上发生了什么」

七组，从「最像剧情」排到「最像设置」：**境界 / 属性 / 穿戴 / 物品 / 技能 /
主动效果 / 设置**（部位与量纲）。空组不出现在界面上。

两条刻意的取舍：

- **不报被动 / 持续效果的逐条改动**。它们会以汇总值的形式出现在属性组里，
  再逐条列一遍就是重复；而**主动效果（cast）不计入总属性**，属性组看不见它们，
  所以必须单独成组 —— 否则「本章学会了一招」在对比里完全不存在。cast 的
  参数改动走**整串文案比较**（`castParamText`），逐字段写的话每加一个参数字段
  都要回来补一处判断，漏一次就是静默不报。
- **物品只报增 / 减 / 数量**，不报改名 / 改分类。这类字段级 diff 会把表淹掉，
  而且改名的表达方式（`玄铁剑 → 玄铁重剑`，标签该用哪个名字）本身就不干净。
  物品的**穿戴**变化另立一组（那才是读者关心的「他现在拿着什么」）。

`castParamText` 因此被提到 `pack-utils.ts`：它现在有两个消费方
（`ModifierList` 展示 / `pack-diff` 比较），两边各写一遍的话，只要一边漏拼一个
字段，「参数改过」就永远判不出来 —— 而且不报错，只是那一行静默消失。

### 16.5 空态必须是三个分支

| 情况 | 文案 |
|---|---|
| 本章没有起点记录 | 「本章还没有盘点起点。在本章点一次『保存』，这里就会列出此后发生的所有变动。」 |
| 起点 payload 读不出来 | 「这条起点的内容读不出来（更早版本的记录），无法对比。」 |
| 有起点、确实没变 | 「与本章初相比没有变化。」 |

混成一个「暂无数据」就等于把「旧记录读不出来」长期藏起来。`parsePackDiffDoc`
解析失败返回 `null` 而不是空文档，也是同一个理由：把「读不出来」渲染成
「所有东西都被移除了」比不显示难查得多。

回退点列表里，本章初那条会多打一个**「本章初」标记**（蓝色，与「最新」的绿色不同 ——
本章只保存过一次时两个标记会落在同一条记录上，同色读起来像重复标了两次）。

### 16.6 界面形态：一个弹窗、两个分区，没有引入新控件

「与本章初对比」是**只读的答案**，「回退点」是**有后果的动作**（载入会覆盖草稿）。
分成上下两段而不是合成一张表：前者想反复看，后者不该被顺手点到。
入口仍是面板头部那个时钟按钮（它的 tooltip 本来就叫「盘点记录 / 与本章初对比」），
对比区不再藏到二级点击后面。

仓库里没有任何 antd `Tabs` 先例，就没有为这个弹窗引入 Tabs / Segmented ——
宽度 460 → 520，对比区自带 `max-height: 260px` 滚动。

### 16.7 验证结果

`tsc` 双配置 exit 0 ｜ `eslint src electron` **0 errors**（1 条既有 warning，
在 `shared/http/useHttpClient.ts`，与本轮无关）｜ `vitest run` **52 files / 840 passed**
（较上轮 +31 例）｜ `vite build` exit 0。

新增守卫：

- `pack-diff.test.ts`（新，23 例）：payload 三态解析（坏 JSON / 缺 attributes / `realmLink`
  在不在）；**属性比汇总值**（base 不动、只让加成生效，必须报出来）；格式化噪声不报；
  物品三态；穿戴变化；新物品不在穿戴组重复报；技能三态；cast 整串比较；被动不进 cast 组；
  境界三态（含「旧记录整组跳过」与「没有等级体系整组不做」）；设置组；分组顺序固定。
- `RecordDrawer/index.test.tsx`（新，8 例）：三种空态各一条；变更行按组归类并给出总条数；
  「本章初」标记的出现与缺席；回退点列表与「载入」流程的回归（仍要先确认）。

⬜ 沙箱禁 GUI，真机待确认四件事：

① 在同一章里改点东西 → 保存 → 再改 → 打开「盘点记录」，对比区应列出变动、标题带总条数；
② 打开一个**从未保存过**的章节 → 对比区显示「本章还没有盘点起点」；
③ 主角绑定了实体（境界存在 `novel_links`）→ 同一章内改境界 → 对比区出现「境界 X → Y」；
④ 回退点列表里本章初那条带蓝色「本章初」标记，点它的「载入」流程与别条一致。

### 16.8 已知限制

- **本章没保存过就没有起点**：见 16.1 的取舍。作者在意时保存一次即可（这也是
  他本来就该做的事）。
- **跨章节访问同一章时，基准是「第一次进入该章时的状态」**：同一条记录只落一次，
  第二次进入该章不会重新划一条起点。这与「本章初」的字面含义一致，但如果作者
  期望「每次进入都重新划起点」，需要先补一条有去重口径的落盘通道。
- **属性组只覆盖有汇总值的属性**：属性本身被删掉时能报（走 `remove`），
  但「某个效果被删掉」只体现为属性值的回落，不会单独成行 —— 这是 16.4 的取舍。

---

## 17. 1.29.0：行囊需求一次性结清（9 条）

> 这一轮把进度表里剩下的 9 条 P1/P2 一次做完：REQ-001 / 019 / 020 / 022 / 025 / 032 / 033 / 034 / 045。
> 三条 ➖（REQ-026 分离窗口 / REQ-035 派生公式 / REQ-036 多角色）是 PRD 自己划在 v1 范围外的，
> 经确认**跳过**，不在本轮。做完之后行囊的 PRD 需求**全部结清**。
>
> 下面按「值得回看的判断」组织，不按需求编号 —— 逐条清单在 §3 的登记表里。

### 17.1 一条需求写「已能表达三值」，但代码里没有第三个值

REQ-001 的进度备注长期写着「`prefs.form` 已能表达三值，加一个值即可」。实际打开
`types.ts`：`form: "reflow" | "overlay"` —— **两个值**，而且全仓**没有任何 UI 写它**。
这类「文档说做完了、代码里没有」的条目是最难发现的：它不在 ⬜ 里（不会被排期），
也不在 ✅ 里（没有落点），只在一句备注里。

Peek 的落地里有两个判断值得记住：

- **它是运行时状态，不是界面偏好**。判据（§8.6.2）问「改了这个值，别人的这本书会变吗」，
  Peek 过不了这一关当然不是「设定数据」；但它也**不是界面偏好** ——
  它 3 秒后自动收起，写进 `novel_pack_ui` 就变成「下次打开行囊它自己又没了」，
  这个行为没法向用户解释。所以它是 `usePackPanel` 里的一个 `useState`，面板一关随组件复位。
- **不能用 `setTimeout` 猜 React 的提交时机**。顶栏 Alt+点击时面板可能还没挂载
  （`packOpen` 从 false 翻到 true，React 要等这一拍 commit 之后才跑 effect）。
  桥的实现改成「没人在听 → 记一个待办，注册时立刻消费」：快设备上偶然通过、
  慢机器上偶然失败的写法一律不要。

宽度边界也补上了：**窄窗下不提供 Peek**（那里已经是 overlay 全屏浮层，再叠一层半透明没有意义）。

### 17.2 负重与容量：两个独立口径，而且「0 = 不限」

PRD F-5 其实提了两件事，是很不一样的两把尺子：

| 口径 | 字段 | 判定 | 到顶时 |
|---|---|---|---|
| 格数容量 | `capacity_limit` | `used >= limit` | **拦下新增**（F-5 原话「阻止新增」） |
| 负重 | `weight_limit` | `total > limit` | 只报警 + 给「记为状态」入口 |

两处刻意的不对称，都不是笔误：

- `>=` vs `>`：**有第 20.0 公斤，没有第 41 件**。作者写「上限 20（公斤）」时想的是
  「20 以内都行」；写「40 格」时想的是「第 41 件放不下」。
- **`limit = 0` 一律表示「不限」**，且 `over` / `full` 恒 false。把「不限」和
  「上限为零」合并的实现在空库上**看不出任何异常**，只在作者真填了重量时集体变红 ——
  所以这一条单独有测试。
- 重量是**单件 × 件数**（数量即件数）。「×20 只算一份重量」在网文里没有对应直觉。
- 重量输入放在**详情行**而不是主行：主行在 340px 面板下只剩 285px，
  而「已穿戴 + 角标」已经占掉 292px（见 §15.2 的实测），塞不下第三个数字输入框。

**超载 Debuff 没有做成自动挂载**。PRD 写的是「超出负重量时给主角挂一个『超载』Debuff
（复用状态模块）」，但「超载该扣什么属性、扣多少」是每本书自己的规则，工具猜不出来。
自动塞一条 `value = 0` 的「超载」进设定，作者要过很久才会发现它在汇总里什么都没干 ——
**那比不做更糟**。落地是：超载时给一个「记为状态」按钮，建出骨架并**直接打开效果编辑器**
让作者当场填数值；已经有一条同名状态时不再重复给入口（按名字去重，
状态是作者自己的数据，他可能删了重建）。

### 17.3 换装方案：存映射，不存快照；套用是「一整套」

- **payload 只存 `[{itemId, slotId, slotIndex}]`**，不存物品本身。存快照会造出第二份
  「物品」数据，从此两边各自维护 —— 而物品改名、改分类、改加成都是常态。
  存映射的代价是「方案里的东西被删了」，这个代价用**如实报数**（`已穿上 5 件 ·
  2 件物品已不在物品栏`）来还，而不是让整个方案不可用。
- **套用 = 先全体卸下，再按方案穿**。只做加法会留下「两套叠加」的半成品，
  作者还得自己回头一件件脱。卸下的物品**退回物品栏**（清 `equippedSlotId`，不删行）。
- **用新表 `novel_pack_presets`，不进 `novel_pack_records`**：后者是滚动保留 20 条的
  回退点，方案放进去会被挤掉 —— 而「方案」的语义是长期资产。
- 逐条试穿与真套用**共用同一个内层判定**（`planPreset`）。两边各写一遍的话，
  「菜单显示 5/6 件可用、点下去只穿了 4 件」这种差异是纯静默的。
- 界面是 **Popover 而不是 Dropdown 菜单**：每行要就地改名、要显示可用件数、
  还要并列两个真按钮（套用 / 删除）。菜单项里塞按钮会让点击冒泡到菜单项本身
  （点删除同时触发套用）—— 这个坑在本仓库已经踩过一次（见 §15.3 的同类取舍）。

### 17.4 状态效果时效：判过期，但不碰作者的开关

`rounds_left INTEGER`（可空，**不写 DEFAULT**）。这里有两个必须记住的决定：

- **NULL = 不限时**，所以迁移时不能补 0。补 0 会让所有旧状态效果在下次打开时
  集体判定为「已过期」。新建条目默认也是 `null`，不是 1 —— 给 1 会让它下一拍自己过期。
- **过期不翻 `active`**。`active` 是作者的开关（「这条现在开着」），工具擅自关掉属于
  偷偷改设定，而且**不可逆**（改成 0 之后再也看不出作者原本开着它）。
  过期的唯一后果是「暂时不计入汇总」，回合数加回去就恢复。
- 判定只对 `sustained` 成立（被动是常驻、释放不进汇总，给它们判过期是玄学）。
- 汇总结果里单列 `expired` 一桶，**不并进 `eventOnly`**：前者是期望内的暂停
  （加回合数就恢复），后者是设计如此（它本来就不该进汇总）。混着写提示，
  作者会去改自己的触发条件。
- 两条提示分处两地：`StatusModule` 行内标「已过期」+ 黄色预览，
  `SummaryModule` 底部提示行说「N 项时效已过，暂时不计入」。

### 17.5 三处「桥」而不是 import

REQ-034 让行囊能把表格插进正文。**行囊没有 import 编辑器的 store** —— 那会把它绑死在
「宿主是 NovelPage」上，而 PRD §1 要求它将来能整体搬去独立窗口（分离窗口下根本没有正文可插）。
落地是页面那侧注册一个 `registerPackInsertIntoChapter`，行囊只发一句
「把这段 Markdown 追加到当前章末尾」。

编辑器那侧新增 `EditorPaneHandle.appendText` 而不是「移光标到末尾再调 `insertText`」：
后者会经过一次光标定位 + 一次插入，两次 dispatch 之间还能被 IME / 协同逻辑插一脚；
`appendText` 一次 dispatch 完成「插到文末 + 把选区放到末尾 + 聚焦」。

另外两处同构的桥是 `registerPackPeek`（17.1）与既有的 `registerPackCloser` /
`registerPackGuard` / `registerPackQuickAdd`。**新增行囊入口时先看有没有对应桥，
不要 import**。

### 17.6 已知限制

- **Peek 在窄窗下不可用**（那里已经是 overlay 全屏浮层）。想在窄窗里也要速览，
  得先决定「两层浮层谁在上」，目前没有这个需求。
- **满格拦的是「新增」，不是「导入 / 快速记账」之外的一切**：正文选区记账走同一条
  `addItem`，所以也会被拦（这是有意的：容量上限在网文里是叙事约束）。
  但它**不会**拦住「把已有物品改成其它东西」，那本来就不增加格数。
- **换装方案没有「撤销套用」**：套用是一次普通的文档改动，`Ctrl+Z` 不覆盖它
  （它不在编辑器的撤销栈里），但「撤销全部 / 撤销到上次保存」能回去。
- **重量只有一个全局单位（无单位数字）**：`weight` 是纯数字，作者自己决定
  「这是公斤还是斤」。做单位换算需要一张单位表 + 换算率进设定数据，
  与需求方确认过的「先做最简」不一致。
- **`roundsLeft` 不会自己掉回合**：它是作者手动维护的数字。做「每章自动 -1」
  需要先定义「什么算一个回合」（一章？一次保存？），这个前提 PRD 里没有。
