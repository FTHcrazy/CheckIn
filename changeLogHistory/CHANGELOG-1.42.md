# Changelog · 1.42.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

## [1.42.0] - 2026-10-14

### Changed

- **行囊装备栏下线「分组」功能**（用户要求）：装备栏头部的「分组设置」入口与
  `GroupManager` 弹框删除（组件目录一并移除），`usePackPanel` 的
  `addGroup` / `updateGroup` / `removeGroup` / `groupManagerOpen` /
  `openGroupManager` 等 API 同步撤下。`novel_pack_groups` 表与物品
  `groupId` 列保留（compat，旧数据不丢）：模板播种的分组（法宝 / 功法 / 随身）
  仍参与部位「仅接受」匹配与整组停用闸门，只是不再有创建 / 改名 / 删除的
  管理入口 —— 与 1.41.0 物品栏下线分组同一口径（数据层不动，只收 UI）。
- **要素详情卡「出场章节」改整行列表**（`EntityDetail`）：原浮动药丸改为
  整行可点的列表行，章名序号（「第7章」）做成主色弱底徽标，hover 整行染
  主色弱底；行高 28 → 34px（`APPEAR_ROW_HEIGHT` 与样式同步上调，
  `index.test.tsx` 的高度断言同改）。
- **要素详情卡「新建境界体系」按钮改实心主色**：空态里唯一的行动点此前是
  主色描边虚框，与虚框容器混为一体；现在实心主色承载，与「编辑」按钮同档，
  是该区块的视觉重心。
- **编辑器右上角动作图标常驻浅色底**（`NovelTopBar`）：六颗图标此前默认
  透明底，只有 hover / 激活才显色，扫过去是一团灰点、看不出可点；现在默认
  `--app-surface-hover` chip 底，hover / active 加深一档（`--app-surface-active`），
  持久激活态仍走主色弱底，三档层次分明。
- **书架灵感卡编辑时隐藏悬浮操作栏**（`IdeaNoteCard`）：编辑态操作栏整条
  不渲染 —— 此前编辑时它仍浮在 TextArea 上方，既挡文本又容易误触
  （置顶 / 删除都在一拍之内）。操作栏底色同时改明显：`--app-surface-alt`
  + 1px 描边（原与卡片同色的 elevated 底只剩一层投影，看不出「这里有一排
  按钮」），图标色由 muted 提到 secondary，hover 染主色弱底。
- **设定中心「等级序列」列表可读性**（`SettingCenter`）：行容器收成一张卡
  （描边 + 圆角 + 4px 内边距），行内边距 4px → 7px，奇数行铺斑马纹
  （`is-alt`，hover 仍可压过）；小境界标签（「13 小境界」）改成主色弱底
  徽充当行首锚点，小层名去掉灰底改无底浅签（hover 才染主色弱底）——
  原来八阶各一排 11px 灰字灰底方块，是整个列表最「费眼」的来源。
- **章节名输入框下划线改直角**（`EditorPane`）：antd Input 自带 6px 圆角会
  作用在不可见的边框盒上，把只画 `border-bottom` 的下划线两端顶成翘角
  （用户原话：「圆不圆方不方」）；显式 `border-radius: 0` 后是一条干净的
  直线，与「下划线式行内编辑」的意图一致。
