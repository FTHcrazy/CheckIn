# 行囊（CharacterPack）· 功能登记表

> 对应 PRD：`docs/character-pack-prd.md` v1.5
> 本轮落地范围：**按步骤实现 PRD 的 P0 主体 + 可直接落地的 P1**；形态固定为「右侧让位」。
> 登记日期：2026-09-29 ｜ 代码基线：`1.18.0`

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
├── pack-config.ts                  # 面板尺寸、出厂布局、量纲模板、长按参数
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

主进程侧：`electron/handlers/novel-pack-handlers.ts`（9 条通道）、`electron/db.ts`（10 张表 + `novel_levels` 两条补列）、`electron/preload.ts`、`src/shared/types/electron.d.ts`。

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
| REQ-046 | 境界 ↔ R25 双向同步 | 🟡 | `pack-realm.ts`、`novel-link-set`、`novel-level-meta-set` | 复用 `novel_levels` + `novel_links`（不另建表）✅；小层数 / 战力当量补列 ✅；阶内进位 `carryRealm()` ✅；**EntityPanel 侧尚未订阅 `pack-realm-changed`**（面板 → 行囊的反向刷新靠重载，未做实时） |
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
| `vitest run`（全量） | 35 files / **447 passed**（其中行囊 45 例：纯函数 30 + 境界口子 15） |
| 真实 Electron 目视验证 | ⬜ **未做**（沙箱禁 GUI）—— 下一次开发前建议先 `pnpm dev:novel` 走一遍「打开 → 改数 → 保存 → 关闭拦截 → 载入回退点」 |

## 7. 下一批建议顺序

1. **REQ-043 的剩余部分**：切章 / 退出应用拦截 —— 这是「防误操作丢数据」承诺的最后一环。
2. **REQ-018 + REQ-037**：同一套「假想输入」能力，做一次解决两条（换装预览 + 临时估算）。
3. **REQ-027 + REQ-028 + REQ-030**：三条都依赖「正文 ↔ 面板」的桥，一起做边际成本最低。
4. **REQ-046 的剩余部分**：EntityPanel 订阅 `pack-realm-changed`，把「面板 → 行囊」也变成实时。
5. **REQ-010 / REQ-014 的收尾**：稀有度可改 + 熟练度进度条，各半天以内。
