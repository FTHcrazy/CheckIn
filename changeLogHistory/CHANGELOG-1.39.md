# Changelog · 1.39.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

## [1.39.1] - 2026-10-14

### Fixed

- **设定中心「应用内置预设」只建出分类壳、等级序列永远是空的**（`hooks/useNovelData.ts`
  新增 `createSettingCategoryWithLevels` / `NovelPage.tsx`）。此前预设应用是
  `createSettingCategory` + `batchAddSettingLevels` 两连调：后者从当前闭包的
  bundle 里 find 刚建好的分类，而 `setBundle` 是异步的，同一次点击里它还不在
  里面 → find 失败、静默返回 0。现在分类与等级在**同一次**状态更新里落地，
  远端也是 category-add 后对新分类一次 batch（守卫：`useNovelData.setting-preset.test.tsx`
  四例，钉「分类+等级同帧出现」「远端两条挂同一 id」「realm 降级回执修正」
  「空名单不发 batch」）。顺带把预设的分类级字段（说明 / 每阶小层数 / 进位
  方向 / 小层命名）也带进落地分类——此前这些被整包丢弃，「练气十三层」的
  分类小层数一直是缺省的 1。
- **行囊「境界」模块的阶设置弹框右上角 × 关不掉**（`CharacterPack/RealmModule`）。
  antd Modal 的 × 与 ESC 走的都是 `onCancel`，此前漏传，弹框只剩 footer 的
  「关闭」能关。补上 `onCancel`（守卫：`RealmModule/index.test.tsx` 新增
  「× 能关掉弹框」回归例）。（1.39.1 追加：弹窗随后整体删除，见 Removed。）
- **行囊「境界」阶设置弹框在没有等级体系时是一张空表**（同文件）。书里还没
  建体系时 metas 列表为空，弹框只剩一句说明、看起来「没有实际作用」；现在
  直接给出「先到设定中心新建或从模板库应用一套」的指引（守卫：空态与有体系
  两例）。（1.39.1 追加：弹窗随后整体删除，见 Removed。）
- **行囊「备注速记 / 模块开关与排序」存不上**（`pack-dirty.ts`）。未保存计数的
  实体清单漏了 `character`（备注）与 `layouts`（模块启用 / 顺序 / 恢复默认）两类
  —— 这两类改动永远算不出脏数：保存按钮保持禁用（「没有未保存的改动」）、
  草稿防抖与关闭前的必写路径都按 dirty=0 早退，关掉窗口改动即丢，用户视角
  就是「行囊无法保存」。修复：两类实体纳入计数（身份键：character.id /
  moduleKey；`orderSignature` 改用 `spec.id`，否则 layouts 无 `id` 字段、排序
  变化永远算不出来）。刻意**不比** displayName / name / avatar（派生或即时
  落库）与 entityId（主角绑定即时落库），避免顶栏常亮按不掉的角标。
  守卫：`pack-dirty.test.ts` 新增备注 / 开关 / 排序 / 派生格四例。
- **右栏「设定」tab 下线**（`SupportPanel` / `useNovelViewState` / `useNovelPage` /
  `NovelPage.tsx`，删除 `SettingQuickPanel`）。它与「设定中心」功能重合：分类
  与阶梯的管理本就归设定中心，速查的插入 / 一致性检查又只有这一个入口在用。
  PanelTab 收窄为 outline / entity / note / search / tools 五个（会话级状态，
  无持久化迁移）；`setting-utils` 的正文一致性扫描（`scanConsistency` /
  `scanUnregistered` 及其辅助）随唯一消费方一并删除。
- **行囊「人物属性」两段合一，直接编辑当前角色的属性**（`AttributesModule`）。
  去掉「属性模型 · 全书共用 / 属性值 · 当前角色」两段与分组改名，改为一张
  每角色的属性行列表：名称 / 数值 / 单位 / 小数位一行编完（底层仍是 def +
  value 两份数据与原增删改 API，效果与映射的 defId 引用不变）。属性名称从此前
  的无边框样式改为**带边框输入框**——此前完全看不出名称能编辑（报障点）；
  新增属性即建即出现在列表里。存储结构零变更（compat 语义成立）。
- **行囊整文档保存对残缺字段不再整体回滚**（`novel-pack-handlers.ts`）。保存
  事务的逐行 INSERT 此前大量字段直绑渲染层值（属性名 / 单位 / 物品描述 / 效果
  备注 / 熟练度原始值……），better-sqlite3 对 undefined 绑定直接抛错 → 整事务
  回滚，用户侧只有一句「保存失败 · 草稿已保留」而无从排查（报障：套用属性
  模板后保存失败）。现在全部 SQL 绑定补 `??` 兜底（缺省值与建表 DEFAULT 一致），
  跨版本草稿里任何一个字段缺省都不再让整份文档存不进去。已用 node:sqlite
  内存库复现整条事务验证：规范数据保存成功、缺省字段落入默认值。
- **设定中心左栏点其它分类切不过去**（`SettingCenter`）。`focusCategoryId`
  （从角色卡「管理境界」进入 / 应用模板后传入）此前在选中解析里**永久优先**于
  用户点选，只要它还指向存在的分类，左栏点击永远不生效——应用模板境界后再
  手动新建分类必然踩中。现在 focus 只作初始选中（打开与变化时采纳一次），
  此后以用户点选为准；关闭时清空上一次选中，重开仍按外部聚焦定位。

### Removed

- **行囊「战力当量」下线**（`RealmModule`）。阶设置弹框的当量列、阶梯 chip 的
  当量提示与相关文案整体移除——「跨阶比较基准」的描述让人无法理解，且无任何
  消费方。`novel_setting_levels.power` 列与 DTO 字段保留（compat：不删列），
  仅不再提供写入口。
- **行囊「总属性汇总」的估算 / 临时加成下线**（`SummaryModule` / `usePackPanel` /
  `types.ts`）。REQ-037 的试算与真实汇总同管线同源，却总被当成「没保存的
  数据」，鸡肋大于价值；穿戴 Δ 预览（REQ-018）仍走 `computeHypotheticalSummary`
  不受影响。临时加成本就不落库，无数据清理。
- **行囊「阶设置」弹窗下线**（`RealmModule` / `usePackPanel` / `pack-service.ts`）。
  小层数 / 子层级的编辑统一收进「设定中心 → 等级序列」，行囊只读：齿轮点击
  改为 toast 指引（「境界层级在设定中心设置」），不再弹窗。`setRungMeta` 与
  `writeLevelMeta` 写入口随唯一消费方一并删除（设定域的 level-update 通道本身
  保留，SettingCenter 仍在用；守卫：`RealmModule/index.test.tsx` 钉「点齿轮只
  出指引、无弹窗」）。
- **行囊「技能分组」下线**（`SkillsModule` / `GroupManager` / `usePackPanel`）。
  技能行的「未分组」下拉与分组设置入口删除，熟练度体系恒用默认体系（组绑定
  `profSchemeId` 失去绑定方，编辑入口撤下）。物品分组不受影响；`skill.groupId`
  与 `profSchemeId` 字段保留（compat），旧数据不再参与判定。
- **效果参数概念下线：消耗 / 持续时间 / 剩余回合**（`EffectEditor` /
  `StatusModule` / `ModifierList`）。这些时效语义统一由作者写进效果备注；
  持续型的「默认开启」开关保留，`roundsLeft` 判定逻辑（isCounted / isExpired）
  与字段保留（compat），仅 UI 与写入口撤下——旧数据里已填的回合数继续生效。
  状态行 / 导出文本的「时效」与「持续 X」展示一并移除。
- **释放型效果的独立参数概念下线：效果量 / 单位（攻击力% 等）/ 目标 / 冷却**（
  `EffectEditor` / `types.ts` 的 `CAST_UNITS` / `CAST_TARGETS`）。释放型改为与
  被动 / 持续同一份加成表单（目标属性 + 运算 + 数值），性质说明仍写明
  「不计入总属性」；`valueUnit` / `cooldown` / `target` 字段保留（compat）。

### Changed

- **行囊所有导出统一为系统流小说的 txt 排版**（`pack-utils.ts` / `PackExportButton`）。
  Markdown 表格（`## 行囊 · X` + 竖线表）整体换成「【模块名】+ 一行一条冒号句」：
  `攻击力：150（基础 100，被动 +30，持续 +20）`、`回春丹 ×3（丹药 · 精良 · 丹药匣）`、
  `1 金 = 100 银 = 10,000 铜`——参考系统流 / 网游小说的面板写法，粘进正文不破坏
  叙事节奏。菜单项改为「复制面板文本 / 下载 .txt 文件 / 插入本章末尾」；
  `buildPackMarkdown` / `buildPackTable` / `toMarkdownTable` 更名重写为
  `buildPackText` / `buildPackLines`（守卫：`pack-utils.test.ts` 导出段全量重写）。
- **本书设定的等级序列只支持两个层级**（`SettingCenter` / `useNovelData`）。
  主等级下可挂一层子层级，子层级不再提供「新增子层级」入口（拆分函数同样加
  守卫）——三层嵌套（「初级·第1段·第1段」）在境界 chip 与层级表达上都没有
  意义。已存在的三层旧数据不受影响（只挡新增）。
- **分组名称支持直接输入，导出实时跟随**（`GroupManager`）。分组名从无边框样式
  改为带边框输入框（此前看不出能改名），说明里写明「物品下拉与导出文本用的是
  这里实时改的名字」（导出本就按 id 查现值，补了守卫用例）。
- **技能栏的「分组设置」按载体语境显示**（`GroupManager` / `usePackPanel` /
  `SkillsModule` / `InventoryModule`）。弹框新增 scope：技能栏打开时隐藏
  「可穿戴」开关（技能没有「穿」的概念，只制造困惑）并切换说明文案；三颗
  开关全部补可见标签（可穿戴 / 载体开关 / 整组）与悬浮说明——「整组」此前
  是一颗无标签的裸开关。
  （1.39.1 追加：技能分组随后整体下线，scope 机制随之拆除，见 Removed。）
- **行囊境界头部显示当前小层别名**（`novel-pack-handlers.ts` / `electron.d.ts` /
  `pack-utils.ts` / `RealmModule`）。拆出子层级的阶，「合体 1/4」旁现在跟一枚
  别名 chip（取子层级的首个别名，缺省回落段名）——「X n/m」只答了走到哪，
  别名才回答「现在是什么」；纯数字小层与未写别名不显示。主进程阶梯投影随
  `PackLevelRungDTO` 增补 `subLabels`（按阶内层号索引，子层段整段共享显示名），
  `LadderRung` 同步透传（守卫：`pack-utils.test.ts` 的 `subLabelAt` 三例、
  `RealmModule/index.test.tsx` 有别名 / 空别名 / 纯数字小层三例）。
- **左栏章节树拖拽排序改用 @dnd-kit**（`ChapterTree` / `ChapterTreeItem` /
  `VolumeNode`，撤下 `DRAG_MIME_*`）。HTML5 dataTransfer 换成 PointerSensor
  （distance 6，点击不误触）：拖拽内容浮为跟随光标的小卡片（DragOverlay），
  拖到列表边缘时自动滚屏；章 → 章（重排 / 跨卷）、章 → 卷头（移入卷末）、
  卷 → 卷头（重排）三条路径与原先一致。行只挂 dnd-kit listeners 不挂
  attributes——attributes 会给行容器塞 `role="button"`，与行内三个真按钮叠成
  嵌套交互语义；可达性仍由行内按钮承担（与 HTML5 时代同为指针拖拽）。
- **行囊模块壳折叠头换自绘涟漪**（`PackModuleShell`）。标题是占满整行的透明
  按钮，antd wave 环（6px currentcolor 描边 + 2s 淡出）罩上去就是「点了挂
  两秒的色框」（OutlinePanel 1.34.0「点击效果只有一半」的同构问题）：按钮上
  关掉 wave，改为从点击位置扩散的淡主色小涟漪（0.45s 收场、结束即卸载）。
  守卫：`PackModuleShell/index.test.tsx` 两例（点击出涟漪 + 动画后卸载）。

## [1.39.0] - 2026-10-13

> 行囊「负重 / 容量」（REQ-033 / F-5）整体下线，并按设计稿把头部横向带与
> 物品栏收敛到「无读数」形态。**旧数据不兼容** —— 三个字段直接删列，
> 旧的重量与上限数值不保留、不迁移（§6.7 `refactor` 口径）。

### Fixed

- **行囊「新书打开一屏全开」（`pack-config.ts` / `novel-template.ts` / `hooks/usePackPanel.ts`）**。
  新作品改为**只默认启用核心三块**（总属性汇总 / 人物属性 / 境界），其余七块以
  「存在但关闭」出厂 —— 模块管理弹窗里十条都在、顺序照旧，变的只是打开行囊先给
  一张干净的仪表盘。清单收口到 `CORE_PACK_MODULE_KEYS` 一份，四处默认源统一读它：
  `DEFAULT_LAYOUTS`（含「恢复默认」）、主进程 `novel-template.ts` 播种（不 import
  渲染层，靠 `novel-template.test.ts` 跨进程钉住一致）、`mergeLayouts` 与
  `setModuleOrder` 对**缺失行**的兜底（旧写法写死 `true`，等于「以后每加一个模块，
  所有老书都自动多开一块」—— 这是同一毛病换入口复发的根）。守卫：
  `pack-config.test.ts` 正/反面钉「启用集合恰好等于核心三块」与两处兜底读
  `isCorePackModule`；`pack-layout.test.ts` 的窄档核心集合同源。
- **行囊宽档初始版面「一角挤三卡、半窗留白」（`index.tsx` / `index.scss` / `pack-layout.ts`）**。
  上条收口后新书只开核心三块，而它们全属 stats 栏 —— 宽档仍按写死的
  `56fr / 44fr` 渲染两栏，左「装备类」一个模块都没有，只剩一个孤零零的栏眉标，
  右栏三张空态卡缩在右上角。修复：空分区**整个不渲染**（`activeZones` /
  `missingZoneOf` 抽在 `pack-layout.ts`，纯函数可测），唯一分区居中收窄
  （`--solo`，上限 720px）成单栏单重心；被关掉的对面栏补一张虚线引导卡
  （antd `Button type="dashed"`，列出该栏未启用的模块名），点按直达「模块管理」
  —— 作者才知道行囊还能开装备栏 / 技能栏 / 背包。双栏都有模块时版面照旧。
  守卫：`pack-layout.test.ts` 四例钉「新书出厂态只渲染 stats + 引导卡指向 gear」
  及装备类-only / 双栏 / 全空三个对称分支。
- **行囊宽档改为「左数值与状态 / 右装备类」（`pack-layout.ts` / `index.scss`）**。
  左上是视线起点，作者开行囊第一眼找的是属性汇总 / 人物属性 / 境界，此前它们被
  排在右栏（装备类占了左侧）。落位顺序收口到 `PACK_ZONE_ORDER` 一份，栏宽配比
  跟着内容走：装备类是「部位名 + 按钮 / 物品行 + 数量 + 按钮」的长行，反而更宽
  （44 : 56，原为左 56 : 右 44）。守卫新增「stats 在左、gear 在右」与
  「核心三块落在第一栏」两例，注释里钉死与样式层栏宽同序。
- **核心三块在仪表盘里钉顶（`pack-layout.ts` `coreFirstOrder` +
  `hooks/usePackPanel.ts`）**。存量书的布局顺序里核心三块（汇总 / 属性 / 境界）
  可能排在末尾（老版本播种 / 作者拖过），每新开一个模块它就插在核心三块上面，
  把主内容越顶越深。现在展示顺序统一走 `coreFirstOrder`：核心三块恒在最前
  （保持彼此的相对顺序），其余模块按作者排序跟在后面；宽档分区与窄/中档单栏流
  共用这一份。代价是仪表盘里核心三块拖不动（模块管理里拖了也不影响它们的
  落位），这是「钉顶」的题中之义。守卫三例：沉底输入钉回最前 / 两段相对顺序
  稳定 / 空输入。
- **行囊窗口弹窗右上角 × 点不动（`WindowHeader/index.scss`）**。
  `.window-header` 整条是 `-webkit-app-region: drag`，而 Windows 在**命中测试阶段**
  （`WM_NCHITTEST → HTCAPTION`）就把落在带内的像素判成标题栏 —— 收不到任何鼠标消息
  （没有 `:hover`，更没有 click），**且与 z-index / 绘制层级无关**，把浮层画在它
  「上面」照样点不动。antd 浮层一律 portal 到 `document.body`，落在 `.window-shell`
  里那两处 `no-drag` 声明之外；弹窗越高 × 越靠上，掉进 34px 拖动带后表现为
  「看得见、能拖窗口、点不出反应」（点遮罩与 Esc 不走指针，所以不露馅）。修复按
  「浮层自己的盒子」扣除拖动区：`.ant-modal-container` / `.ant-modal-render`（传
  `modalRender` 时才有）/ `.ant-dropdown` / `.ant-select-dropdown` /
  `.ant-picker-dropdown` / `.ant-popover` 各自 `no-drag`，拖动带其余部分照旧能拖窗口。
  守卫 `WindowHeader/drag-region.test.ts` 编译 SCSS 后断言豁免组 —— **新增浮层须一并补入**。
- **境界拆分口径收口：`findRealmPosition` 与实体卡高亮（`utils/setting-utils.ts`、
  `components/EntityDetail/`）**。1.38.1 起父阶是纯分组、绑定统一落 `(根阶, note.sub)`，
  但渲染层两处没跟上：① 实体卡**根阶行只在「没落在任何段上」时才高亮**，于是绑在
  「炼气 第1段」上会出现「段小条亮着、炼气那一行反而不亮」，看着像当前境界不在这一阶
  —— 改为绑定落点属于这一阶就高亮（段只是阶内进度，不是独立阶）；② 点没有子层级的阶
  时第二参漏传，`onSetEntityLevel(id)` 的实参个数与「note 里不写 `{sub}`」的约定对不上
  —— 改为显式传 `undefined`。`setting-utils.test.ts` 的 fixture 同步补上「第3段」
  （原 fixture 只有两段，`sub=3` 的折算根本无从命中），并把「未覆盖区间」用例从
  `sub=1`（第 1 段恰好覆盖 1–1，与「sub=2→第2段 / sub=3→第3段」自相矛盾）移到真正
  没被任何段覆盖的层号 5。
- **拆分守卫按新模型重写（`electron/novel-setting-guard.test.ts`）**。该守卫仍钉旧模型
  「第一段复用原 id、父阶自己占第一段」的 SQL，而数据层早已是「原阶降级为分组
  （`seg_from` / `seg_to` 置 NULL、`sub_levels` 落整阶总数）+ 各段新建并挂 `parent_id`」。
  改写后保留原意图（原阶 id 不变 → 绑在这一阶上的「当前境界」不会失效），并补反面断言
  禁止退回旧模型。
- **设定速查面板走组件库按钮（`components/SettingQuickPanel/`）**。三处原生 `<button>`
  （分组头 / 词条 chip / 打开设定中心）换成 antd `Button`，样式选择器补 `.ant-btn` 且
  `@include widget.ant-button-reset` 写在覆盖之前（拆成两个类会因打包顺序静默失效，
  §6.1.2 第 1、3 条）。顺带修两处：`components/SettingCenter/index.scss` 的
  `nv-sc__set-realm` 缺 `.ant-btn` 清零点；`components/NovelToast/index.scss` 引用了
  不存在的 `--app-danger`（真名 `--app-error`）。

### Removed

- **负重 / 容量：数据层三列删除（`electron/novel-db.ts`）**。建表语句不再写
  `novel_pack_characters.weight_limit` / `capacity_limit` 与 `novel_pack_items.weight`；
  增量迁移区新增幂等 `dropColumnIfExists()`（PRAGMA 探测列存在性后再
  `ALTER TABLE … DROP COLUMN`，并 try/catch 兜底），老库升级时三列**连同数值一起被丢弃**。
  ⚠️ **旧数据不兼容**：重建方式是「重新在物品栏记一遍重量与上限」——该功能已从产品中移除，
  故本次不提供任何回归通路。注意「部位容量」（`novel_pack_slots.capacity`，戒指能戴两枚）
  是**另一套东西**，完整保留。
- **负重 / 容量：DTO 与 handler 出入参（`electron/handlers/novel-pack-handlers.ts`、
  `src/shared/types/electron.d.ts`）**。`PackCharacterRow/Dto` 的
  `weight_limit` / `capacity_limit` / `weightLimit` / `capacityLimit`、`PackItemRow/Dto`
  的 `weight` 全部删除；快速记账桥的物品 INSERT 由 14 列降为 13 列、整文档保存的
  角色 UPSERT 由 11 列降为 9 列、物品 `itemStmt` 由 15 列降为 14 列。
- **负重 / 容量：领域层纯函数（`pack-utils.ts`）**。整段删除 `itemWeight` /
  `totalWeight` / `weightStatus` / `capacityStatus` / `normalizeLimit` / `formatWeight`
  及其类型；模块导出表 `inventoryTable()` 去掉「重量」列（8 列 → 7 列）。
  `roundTo` 保留（汇总管线仍在用）。
- **顶部概览带读数（`pack-layout.ts` + `components/PackHeader/`）**。
  删除 `headerReadings()` / `PackHeaderReadingsInput` / `formatNumber()`
  （`formatNumber` 仅被读数与自身测试使用，属随读数一起下线的死代码）。
  头部回到设计稿的两块布局：左「我是谁」、右「存了没有 + 工具」，
  中间的 `cpk-head__readings` 整块消失（含其 5 条样式规则与 `.cpk-head` 里
  「中读数区最先牺牲」那段优先级声明 —— 现在只剩左 / 右两块）。
- **物品栏的负重条、上限面板与单件重量（`components/InventoryModule/`）**。
  `cpk-inv__load` 读数条、「上限」设置面板（格数上限 / 负重上限两个 `InputNumber`）、
  详情行的单件重量录入与小计全部删除；连带 `OVERLOAD_STATUS_NAME` 常量、
  `overloadStatus` 判定、「记为状态」入口（它只在超载时出现，超载已无判据）。
  「更多」菜单的「描述 / 标签 / 重量」回退为「描述 / 标签」。SCSS 侧删掉
  `__load*` / `__limit*` / `__meta*` / `__weight` / `__subtotal` 共 9 组规则。
- **`setLoadLimits` / `load` 两个面板 API（`hooks/usePackPanel.ts`）**。
  连同 `addItem` 里的「满格拒绝」一起删除：不再有「背包已满，加不进去」这条分支，
  `addItem` 现在恒写入、不再返回 `null` 表达失败，依赖数组随之收窄。
- **相关测试**：`pack-utils.test.ts` 删「负重与容量」整组（6 例）、
  `pack-layout.test.ts` 删 `headerReadings`（6 例）与 `formatNumber`（4 例）、
  `PackHeader/index.test.tsx` 删「顶部概览带读数」整组（3 例）、
  `InventoryModule/index.test.tsx` 删「负重与容量」整组（5 例）；
  另有 7 个测试文件的夹具清掉 `weightLimit` / `capacityLimit` / `weight` 三字段。
  其中「状态表导出时效」用例语义与负重无关，移入新组 `导出表 —— 状态时效口径` 保留。

### Changed

- **`QTY_MAX` 的注释去掉对 F-5 的引用**（`pack-config.ts`）：它本来就只是
  「显示用的大数保护」，防止长按把数量推到溢出，与负重无实现耦合。
