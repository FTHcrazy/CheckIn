# Changelog · 1.40.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

## [1.40.0] - 2026-10-14

### Added

- **行囊物品分类管理**（`novel_pack_categories` 表 + `InventoryModule` /
  新组件 `CategoryManager`）。物品栏头部新增「分类管理」入口：创建 / 行内改名 /
  删除分类（删除前确认并报受影响物品数，物品退回「未分类」）；首次使用自动
  播种默认五类（装备 / 丹药 / 材料 / 消耗品 / 杂物）。分类支持**绑定
  小说设定的等级体系**：绑定后，该分类下的新增物品在「更多」菜单里多出
  「品阶」一项，可把物品标注成该体系的某一阶（如 小刀·神器、鞭子·仙器）。
  未绑定体系的分类给引导文案，书里一个体系都没有时引导去「设定中心」创建。
  `item.category` 仍按名字关联（零迁移）：改名由前端传播到同分类物品行、
  撞名拒绝。守卫：`pack-grade-guards.test.ts`（建表 / 索引 / 增量迁移 /
  `PACK_CHILD_TABLES` 登记 / 保存事务落库）+ `CategoryManager/index.test.tsx`
  四例 + `pack-dirty.test.ts` 分类计数三例。
- **物品 / 技能的体系品阶标注（1.40.0 核心）**。物品与技能的名称旁新增品阶
  chip（`cpk-inv__grade` / `cpk-skl__grade`）：未标注时显示「品阶」灰态占位
  入口，标注后显示品阶名。品阶选项来自**设定域根阶**（`novel_setting_levels`
  中 `parent_id` 为空的阶，`readGradeSystems` 投影 `{id, name, levels}`）；
  技能没有分类维度，品阶菜单直接按体系分组（`type: "group"`）挑选，另附
  「清除品阶」。等级名不落行囊库（单一事实源在设定域）：`grade_id` 只存
  `novel_setting_levels.id`，改名实时跟随；查不到的 id 不渲染 chip（不出现
  裸 id）。导出与快速复制同步携带品阶：`小刀 ×1（装备 · 神器）`、
  `听潮步（功法品阶 · 天阶）`。守卫：`SkillsModule/index.test.tsx` 品阶四例 +
  `pack-utils.test.ts` 导出三例。
- **行囊「境界」模块的阶 chip 显示小层级名称**。此前只有「拆出子层级」的阶
  有 `subLabels`；配置了**固定名单**模板（如「初期,中期,后期,圆满」）但未
  拆分时，只显示「1/4」不带名。现在未拆分时按名单模板取名（`{n}` 编号模板
  不算名字，不生成 chip）——「筑基 · 初期 1/4」如期出现。
- **小说设定模板库新增热门体系预设**（`utils/setting-presets.ts`）：法宝品阶
  （凡器→神器）、功法品阶（黄阶→圣阶）、丹药品阶（一品→九品），与行囊物品 /
  技能的品阶标注配套。

### Fixed

- **导出整本小说时每章第一段不缩进**（`novel-utils.ts`
  `normalizeParagraphIndent`）。编辑器的段首缩进是 CSS `text-indent`（不落
  文本），作者手工补的空格又往往第二段起才有 → 导出文本首段顶格。现在导出
  时对每个非空行「剥掉既有行首空白 → 统一补全角两格」，幂等（跑多少遍都是
  同一份文本），跟随设置里的「首行缩进」开关。守卫：`novel-export.test.ts`
  缩进四例。
