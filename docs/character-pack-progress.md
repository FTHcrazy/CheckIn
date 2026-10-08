# 行囊（CharacterPack）· 功能登记表

> 对应 PRD：`docs/character-pack-prd.md` v1.5
> 本轮落地范围：**按步骤实现 PRD 的 P0 主体 + 可直接落地的 P1**；形态固定为「右侧让位」。
> 登记日期：2026-10-08 ｜ 代码基线：`1.19.2`
>
> **1.19.0 追加**：① 右侧要素栏补「主角」设定（行囊 ↔ 实体面板的挂钩落地）；② 模板书预设一份完整模板行囊 + 等级阶梯补小层/当量（见 §8）。
> **1.19.1 追加**：修掉主角 / 联动三项静默失效，根因是跨模块事件的负载形状有两套而监听器只认了一套（见 §9 —— 新增双投递事件必须走 `readEventDetail`）。
> **1.19.2 追加**：修掉行囊保存「从第二次起必然失败」（`UNIQUE constraint failed: novel_pack_modifiers.id`），根因是整文档保存里**多态加成表的删除排在了它的宿主表之后**（见 §10 —— 多态表的删除顺序是硬约束）。

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
├── index.tsx / index.scss          # 面板宿主：形态、宽度拖拽、模块遍历、浮层挂载
├── types.ts                        # 领域别名 + 模块清单 + 常量（性质/稀有度/模板/阈值）
├── pack-config.ts                  # 面板尺寸、出厂布局、量纲模板、长按参数、跨模块事件
├── pack-utils.ts / .test.ts        # 纯函数：两道闸门、汇总管线、进位、量程换算（30 例）
├── pack-realm.ts / .test.ts        # 境界读写口子（REQ-048），15 例
├── styles/pack-common.scss         # 跨模块公共原语（按钮/徽标/开关/下拉浮层）
├── services/pack-service.ts        # IPC 语义化转发
├── hooks/
│   ├── usePackData.ts              # 装载 / 草稿 / 保存 / 撤销 / 回退点
│   └── usePackPanel.ts             # 唯一 API 面：视图状态 + 约 40 个业务动作 + 派生
└── components/
    ├── PackHeader/ PackModuleShell/ PackToast/ CloseGuardModal/ ModifierList/ EffectEditor/
    ├── SummaryModule/ AttributesModule/ EquipmentModule/ InventoryModule/ SkillsModule/
    ├── RealmModule/ CurrencyModule/ StatusModule/ NoteModule/
    ├── ModuleManager/ SlotManager/ UnitSystemManager/
    └── RecordDrawer/ SourceDetailDrawer/
```

主进程侧：`electron/handlers/novel-pack-handlers.ts`（11 条通道）、`electron/db.ts`（10 张表 + `novel_levels` 两条补列）、`electron/template`（`novel-template.ts` 的 `TemplatePack` 模板行囊）、`electron/preload.ts`、`src/shared/types/electron.d.ts`。

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
| REQ-001 | 三形态（让位 / 窄窗浮层 / Peek） | 🟡 | `CharacterPack/index.tsx` | ① 右侧让位 ✅ ② 窄窗浮层降级 ✅ ③ **Peek 半透明速览未做**（`prefs.form` 已能表达三值，加一个值即可） |
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
| REQ-010 | 物品增删改查 + 分类/数量/稀有度/描述/标签 | 🟡 | `InventoryModule` | 名称 / 分类 / 数量行内可改；**稀有度只展示不可改**（圆点色），**描述与标签未暴露 UI**（库表已存） |
| REQ-011 | 数量行内 +/- 与长按连加 | ✅ | `InventoryModule`（`useHoldRepeat`，400ms 后 60ms/次） | 长按与单击共用同一按钮，第一下立即生效 |
| REQ-012 | 列表 / 宫格切换 + 搜索过滤 | ✅ | `InventoryModule` | ≥20 条才出现搜索框；200ms 防抖；宫格视图走 `prefs.inventoryView` |

### Epic B · 技能

| REQ | 项 | 状态 | 落点 | 缺口 / 备注 |
|---|---|---|---|---|
| REQ-013 | 技能增删改查 + 启用停用（载体闸门） | ✅ | `SkillsModule` | 停用后该技能**全部**效果不计入（含其持续型） |
| REQ-014 | 熟练度展示开关 + 数值 + 等级名 + 进度条 | 🟡 | `SkillsModule`、`thresholdOf()` | 开关 ✅ 数值 ✅ 档位名 ✅ **进度条未做**（`thresholdOf` 已返回 `progress`，只差渲染） |

### Epic C · 效果性质与汇总

| REQ | 项 | 状态 | 落点 | 缺口 / 备注 |
|---|---|---|---|---|
| REQ-015 | 共用编辑器：先选性质再填内容 | ✅ | `EffectEditor` | 释放型**不出现「目标属性」字段**；选触发条件会二次确认「该效果将不计入总属性」 |
| REQ-016 | 基础值 → 总览值 + 增量标识 | ✅ | `SummaryModule` | — |
| REQ-017 | 来源明细（每一条贡献） | ✅ | `SourceDetailDrawer` | 汇总行点击进入，含来源载体名与运算符号 |
| REQ-018 | hover 未穿戴装备 Δ 预览 | ⬜ | — | 下一批；需要汇总管线支持「假想穿戴」输入 |
| REQ-019 | 汇总缓存 ≤ 100ms / 150 条 | 🟡 | `computeSummary` + `useMemo` 依赖级缓存 | 已避免无谓重算，**未做基准测试与虚拟滚动** |
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
| REQ-022 | 量纲统一入口 + 三模型 + JSON 导入导出 | 🟡 | `UnitSystemManager`、`pack-utils` 的 `formatRatio/thresholdOf` | 三模型齐全 ✅（ladder 由境界承担）；**JSON 导入导出未做**；量纲目前只用于展示与试算，不参与属性汇总 |
| REQ-023 | 货币：自定义进制 + 自动进位可关 | ✅ | `CurrencyModule` | 「铜钱换不成银」= 关掉自动进位 |
| REQ-024 | 境界模块：阶梯进位 + 战力当量 | ✅ | `RealmModule` | 双读数（行囊 / 实体面板）并列显示，**故意分叉可见** |
| REQ-025 | 状态效果（Buff/Debuff） | 🟡 | `StatusModule` | 复用性质模型与独立开关 ✅；**时效自动过期未做**（只有 `duration` 文本） |

### Epic E · 模块拼装

| REQ | 项 | 状态 | 落点 | 缺口 / 备注 |
|---|---|---|---|---|
| REQ-020 | 模块启用/禁用/排序/折叠，按角色独立存储 | 🟡 | `ModuleManager`、`usePackPanel` 的 layout 动作 | 启用 + 顺序 ✅（走草稿，按角色）；**折叠走全局界面偏好**（有意偏离，理由见 §4）；排序用 ↑↓ 按钮而非拖拽 |
| REQ-021 | 全空态引导 + 恢复默认组合 | ✅ | 各模块空态 + `ModuleManager` 的「恢复默认」 | 面板本体也有「所有模块都被关掉了」的兜底文案 |

### Epic F · 快捷盘点增强

| REQ | 项 | 状态 | 落点 | 缺口 / 备注 |
|---|---|---|---|---|
| REQ-027 | 正文选区右键「记入背包」 | ⬜ | — | 需要接 `EntityContextMenu` |
| REQ-028 | 本章变动高亮（24h / 全部已读） | ⬜ | `types.ts` 已留 `CHANGED_TTL_MS` + `prefs.changedReadAt` | 字段先落，逻辑未做 |
| REQ-029 | 盘点记录 + 与本章初对比 | 🟡 | `RecordDrawer`、`novel-pack-record-list` | 记录列表 + 载入 ✅；**「与本章初对比」差异视图未做**（`latestRecord` 已可用） |
| REQ-030 | 导出 Markdown 表格 | ⬜ | — | — |
| REQ-031 | 备注速记 | ✅ | `NoteModule` | 走草稿（它是设定数据，不是界面偏好） |

### Epic G · 保存、草稿与回退

| REQ | 项 | 状态 | 落点 | 缺口 / 备注 |
|---|---|---|---|---|
| REQ-042 | `保存 (N)` / 无改动禁用 / 保存前落回退点 | ✅ | `PackHeader`、`novel-pack-save` | 保存前先对**改动前**状态写 `novel_pack_records`（滚动保留 20 条） |
| REQ-043 | 草稿 + 关闭拦截三选一 | 🟡 | `usePackData`（800ms 防抖 + 关闭必写）、`CloseGuardModal` | 面板关闭拦截 ✅ 草稿落主进程 ✅；**切章 / 退出应用拦截未接**（需要 NovelPage 与主进程分别接线） |
| REQ-044 | 撤销全部 / 撤销到上次保存 | ✅ | `revertAll()`、`restoreFromRecord()` | 撤销到回退点只改内存，需再保存才写库（界面已说明） |
| REQ-045 | 失败不静默 / 整体回滚 / JSON 逃生出口 | 🟡 | handler 的 `db.transaction()`、`PackHeader` 的失败态 | 事务回滚 ✅ 失败态可视 + 草稿保留 ✅；**JSON 导出 UI 未接**（`exportDraftJson()` 已在数据层就绪） |
| REQ-047 | 自动保存兜底（5 分钟，可关） | ✅ | `usePackPanel` 的 autosave effect | 关闭后 `关闭拦截` 仍生效 |

### P2 / 有意不做

| REQ | 项 | 状态 | 备注 |
|---|---|---|---|
| REQ-026 | 分离窗口形态 | ➖ | 迁移路径见 §1，改动面已压到 3 个文件 |
| REQ-032 | 换装方案 Preset | ⬜ | 数据结构可直接用「盘点记录」承载 |
| REQ-033 | 负重 / 容量上限 | ⬜ | `QTY_MAX` 只做显示保护 |
| REQ-034 | 行囊表格插入本章末尾 | ⬜ | 需编辑器写入能力 |
| REQ-035 | 派生属性公式 | ⬜ | 需表达式引擎，`computeSummary` 已有 override 占位 |
| REQ-036 | 多角色 | ⬜ | **数据模型已按 `character_id` 全量预留**，UI 只暴露主角 |
| REQ-037 | 估算模式 | ⬜ | 与 REQ-018 同一套「假想输入」能力 |

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

1. **REQ-043 的剩余部分**：切章 / 退出应用拦截 —— 这是「防误操作丢数据」承诺的最后一环。
2. **REQ-018 + REQ-037**：同一套「假想输入」能力，做一次解决两条（换装预览 + 临时估算）。
3. **REQ-027 + REQ-028 + REQ-030**：三条都依赖「正文 ↔ 面板」的桥，一起做边际成本最低。
4. **REQ-010 / REQ-014 的收尾**：稀有度可改 + 熟练度进度条，各半天以内。

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
