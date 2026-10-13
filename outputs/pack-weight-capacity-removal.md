# 行囊「负重 / 容量」下线 —— 改动清单

- 版本：1.39.0（package.json / CHANGELOG.md 同步）
- 授权：AGENTS.md §6.7 `novelArch: "refactor"`（本次为破坏性删列，旧数据不兼容）
- 范围：仅 novel 域的行囊（CharacterPack）；**「部位容量」不在范围内，完整保留**
- 改动规模：28 个已跟踪文件，+50 / −1030 行左右；另新增 1 处迁移函数

---

## 一、数据层

| 文件 | 改动 |
|---|---|
| `electron/novel-db.ts` | ① 建表语句删 `novel_pack_characters.weight_limit` / `capacity_limit` 与 `novel_pack_items.weight`（含列注释）；② 增量迁移区新增三行幂等删列调用；③ 新增私有函数 `dropColumnIfExists(database, table, column)` —— PRAGMA `table_info()` 探测列存在性后再 `ALTER TABLE … DROP COLUMN`，并 try/catch 兜底（避免「少一个已下线字段」升级成「整个行囊打不开」）。**旧数值不保留、不迁移**；重建方式 = 重新在物品栏记一遍（该功能已移除，故不提供回归通路）。 |

## 二、主进程 handler 与共享类型

| 文件 | 改动 |
|---|---|
| `electron/handlers/novel-pack-handlers.ts` | `PackCharacterRow`、`PackItemRow`、`PackCharacterDto`、`PackItemDto` 四个接口删对应字段；`toCharacterDto` / `toItemDto` 删映射（含 `?? 0` 兜底）；快速记账桥的物品 INSERT 14 列 → 13 列、整文档保存的角色 UPSERT 11 列 → 9 列、物品 `itemStmt` 15 列 → 14 列，参数数组逐项对齐。 |
| `src/shared/types/electron.d.ts` | `PackCharacterDTO` 删 `weightLimit` / `capacityLimit`；`PackItemDTO` 删 `weight`。 |

## 三、领域层纯函数

| 文件 | 改动 |
|---|---|
| `pack-utils.ts` | 整段删除「负重与容量（REQ-033 / F-5）」区块：`itemWeight` / `totalWeight` / `WeightStatus` / `weightStatus` / `CapacityStatus` / `capacityStatus` / `normalizeLimit` / `formatWeight`。`inventoryTable()` 导出表删「重量」列（8 列 → 7 列）。`roundTo` **保留**（汇总管线仍在用）。 |
| `pack-layout.ts` | 删 `PackHeaderReading` / `PackHeaderReadingsInput` / `headerReadings()` / `formatNumber()`（后者仅被读数与自身测试使用，属随读数下线的死代码）。保留 `PACK_ZONE_OF` / `PACK_ZONE_LABEL` / `splitByZone` / `isAutoCollapsed` / `moduleSummary`。 |
| `pack-config.ts` | `QTY_MAX` 注释去掉对 F-5 的引用（它只是显示用的大数保护，与负重无实现耦合）。 |
| `hooks/usePackPanel.ts` | 删导入 `capacityStatus` / `normalizeLimit` / `weightStatus`、`load` 派生量、整段 `setLoadLimits`、返回对象里的 `load` / `setLoadLimits`、`addItem` 的「满格拒绝」分支与 `weight: partial.weight ?? 0`（依赖数组随之收窄）。 |

## 四、界面层

| 文件 | 改动 |
|---|---|
| `components/PackHeader/index.tsx` | 删 `readings` prop、`headerReadings` 导入、`export type { PackHeaderReadingsInput }`、`READING_KEYS`、中间 `<div className="cpk-head__readings">` 渲染块。保留左侧角色（头像 / 改名 / 境界 / 绑定态）与右侧保存三态 + 全部已读 + 撤销全部 + 导出草稿 + 保存 + 工具 / 窄档「更多」下拉。 |
| `components/PackHeader/index.scss` | 删 `&__readings` / `&__r` / `&__rlabel` / `&__rvalue` / `&__rhint` / `&__r.is-alert &__rvalue`（6 组）；文件头注释与 `.cpk-head` 里「三块优先级」改为「两块」（去掉「中读数区最先牺牲」那段）。 |
| `components/InventoryModule/index.tsx` | 删 `formatWeight` / `itemWeight` 导入（`InputNumber` 随之不再使用）、`OVERLOAD_STATUS_NAME` 常量、`limitsOpen` state、`load = api.load`、`overloadStatus` 判定、`addOverloadStatus()`；删 `cpk-inv__load` 读数条与 `cpk-inv__limits` 上限面板整块、详情行的单件重量 `InputNumber` 与小计；「更多」菜单与 `title` 的「描述 / 标签 / 重量」→「描述 / 标签」；注释同步。 |
| `components/InventoryModule/index.scss` | 删 `&__meta` / `&__metalabel` / `&__weight` / `&__subtotal` / `&__load` / `&__loadseg` / `&__loadsep` / `&__loadwarn` / `&__limits` / `&__limitfield` / `&__limitlabel` / `&__limitnum` / `&__limithint`（13 组）；`&__detail` 注释去掉「重量」。 |
| `index.tsx`（宿主） | 删 `readings={doc && tier !== "narrow" ? { load: api.load } : null}` 及其 6 行长注释。 |

## 五、测试

| 文件 | 改动 |
|---|---|
| `pack-utils.test.ts` | 删「weightStatus / capacityStatus」整组 6 例与 `inventoryTable` 重量小计 1 例；导入去掉 6 个已删符号；4 处夹具去 `weight: 0`。**「状态表导出时效」语义与负重无关，移入新组 `导出表 —— 状态时效口径` 保留。** |
| `pack-layout.test.ts` | 删 `headerReadings`（6 例）与 `formatNumber`（4 例）两组；导入同步。 |
| `PackHeader/index.test.tsx` | 删 `READINGS` 夹具与「顶部概览带读数」整组（3 例）；`props()` 去 `readings`；窄档注释去掉「与读数抢宽度」。 |
| `InventoryModule/index.test.tsx` | 删「负重与容量（REQ-033）」整组（5 例）；`makeApi` 去 `load` / `setLoadLimits`；夹具去 `weightLimit` / `capacityLimit` / `weight`。 |
| `RealmModule` / `RecordDrawer` / `SkillsModule` / `StatusModule` / `SummaryModule` / `hooks/usePackData` / `pack-diff` / `pack-dirty` / `pack-presets` 的 9 个 `*.test.ts(x)` | 仅清夹具字段（`weightLimit` / `capacityLimit` / `weight`）。 |

## 六、文档与版本

| 文件 | 改动 |
|---|---|
| `CHANGELOG.md` | 新增 `## [1.39.0] - 2026-10-13`，`### Removed` 逐条记录（含**「旧数据不兼容」**与重建方式）、`### Changed` 记 `QTY_MAX` 注释。 |
| `package.json` | `version` `1.38.0` → `1.39.0`（§8.6 要求与 CHANGELOG 同步）。 |
| `AGENTS.md` | §6.7 开关声明由 `refactor` **改回 `compat`**（规则 4），变更记录追加 1.39.0 一条，并写明「下次行囊看板重构须重新置 refactor」。 |
| `docs/pack-dashboard-prd.md` | L0 线框去掉头部「负重 128/200 容量 18/30格」，FR-01 R1 说明改为「不新增读数口径，负重/容量已于 1.39.0 下线」。 |

## 七、设计稿同步（Ardot fileId `736052353502827`）

- 删三处读数节点：`2:241`（01 宽档读数组）、`2:451`（02 L1 读数组）、`2:1105`（06 中档读数）。
- 五条 `A 头部横带`（`2:231` / `2:444` / `2:868` / `2:1096` / `2:1285`）宽度由 `hug_contents`
  改 `fill_container`，身份列（`2:234` / `2:450` / `2:871`）改 `fill_container`。
  原因：原稿头带只 hug 到内容宽，右侧留出大片窗口底色（hug 宽度下 `margin-left:auto` 无参照物），
  与实现的 `cpk-head` 满宽 + `__ops` 靠右不一致；删掉中间读数后这条缝更大。
- 复核截图：宽 / 中 / 窄三档头带均满宽、右组贴边、无读数、无裁切。

---

## 八、验证结果

- `pnpm typecheck`（`tsc -b`）：**通过**。
- `npx vitest run src/shared/components/CharacterPack`：**22 文件 / 431 用例全绿**。
- 全量 `npx vitest run`：17 失败 / 1308 通过。其中：
  - **11 处为改动前就存在的红守卫**（与本改动无关）：`electron/novel-setting-guard`（拆分复用原 id）、
    `NovelPage/utils/setting-utils`（境界子层级坐标 ×3）、`EntityDetail`（同上）、
    `novel-ui-kit`（`--app-danger` 变量名、`nv-sc__set-realm` 清零点 ×2、SettingQuickPanel 原生控件）。
    判据：`git stash push -- .` 在 HEAD 复跑同一批**全部复现**。
  - 其余为并行 CPU 争用导致的 `Test timed out in 5000ms` flake（SettingCenter / InventoryModule 等），
    隔离运行即绿。

## 九、未做项 / 下一步

- 本轮只做「移除负重容量 + 头部与物品栏对齐设计稿」，**看板重构（L0 五区 + L1 渐进展开）留待下一轮**；
  下一轮若需继续放弃兼容承诺，须先把 §6.7 开关重新改为 `refactor` 并提交。
- 上述 11 处红守卫属本轮之前遗留，未在本次修复（避免混入无关改动）。
