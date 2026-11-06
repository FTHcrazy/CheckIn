# 地图编辑器交互与快捷键规范（活规范）

> 状态：**定稿**（本批只立口径、不改代码；口径冲突一律以本文为准）
> 输入：[`../review/map-vs-reference-interaction-review.md`](../review/map-vs-reference-interaction-review.md)（审查稿，§2.3 为历史分析）、[`../prd/prd-map-render/map-window-overview.md`](../prd/prd-map-render/map-window-overview.md)（维护中）
> 基线：CheckIn **2.36.0**（工作区）｜`src/windows/MapWindow/` 44 文件 / 750 用例

---

## 0. 本文的地位与读法

1. **本文以「代码现行为」为唯一事实源**。每条结论都给出可 `grep -n` 复核的文件:行号；
   凡与 `docs/review/` 里的历史分析不一致，**以本文为准**，并就地注明冲突点。
2. **本文是下一批功能（R-REG-10 子图内编辑）的准入门槛**：新功能会新增选中态与键位，
   没有这份口径就必然出现「同一个 Esc 在两个模式里语义不同」这类二次漂移。
3. **每行都标守卫落点**（= 用例文件 + 用例名），确实没有用例覆盖的标「无守卫」。
   「无守卫」不是免责，是登记风险：§8 汇总清单给出全部未覆盖条目与覆盖风险。
4. 关键实现位置（改交互前必读）：
   - 键盘总入口：`pages/MapEditorPage/index.tsx:1330`（`onKeyDown`，`window` 级监听，注册在 `:1437`）
   - 点击总入口：`pages/MapEditorPage/index.tsx:744`（`handleCanvasClickWorld`，入参已是**世界坐标**）
   - 撤销/合并键：`store/useMapDocStore.ts:423`（`commit`）、`:45`（`HISTORY_LIMIT = 50`）
   - 模式与待放意图的互斥：`pages/MapEditorPage/index.tsx:243`（`tool` / `pendingLabel` / `pendingSpriteId` 三者互斥）

---

## 1. 放置态（选择素材 → 画布落位）

**现行范式（一句话）**：点素材进入待放态 → 画布单击**落一张** → **落位成功即退出待放态**；要再放必须重新点素材。Esc 可退出待放态。

| # | 触发 | 结果 | 明确不做什么 | 守卫落点 |
|---|---|---|---|---|
| **P-1** | 点素材面板某项（`SpritePanel` 的 `onPick`，`index.tsx:2016`） | 进入待放态：光标变 `crosshair`（`components/MapCanvas/index.tsx:2532`）、面板底部提示改为「点击画布放置素材」（`components/SpritePanel/index.tsx:56`） | 不改文档、不压撤销步 | **无守卫** |
| **P-2** | 待放态下在画布空白处单击 | `placeSprite` 落一张素材，新素材**立即被选中**（属性面板随选中浮出）；落点 = 光标对应的世界坐标，不做二次换算 | 不吸附网格、不自动旋转/缩放以适配地形 | `pages/MapEditorPage/index.coords.test.tsx`「落位：素材落在光标对应的世界坐标，而非被二次换算」（:102） |
| **P-3** | 上一条落位**成功** | `setPendingSpriteId(null)`（`index.tsx:823-824`）—— **单次落位**，要再放需重新点素材 | **不做「连续落位」**（点一次放一串）—— **已裁定不做（2026-11-06）**，理由两条：①`isCenterCovered` 的 AABB 避让带 30 世界单位呼吸边（`coords.ts:248` `ELEMENT_PLACE_PAD = 30`，判定在 `:270-272`），连点会**连续被拦**、体验反而更差；②连续落位会把撤销粒度改成「一次点击一步」，与现有 `coalesceKey` 合并策略打架。本条与 `review/map-vs-reference-interaction-review.md` §2.3 的「继续单击继续落」不一致，**以本文为准** | **无守卫** |
| **P-4** | 落点被已有素材的「可见盒 + 呼吸边」压住 | 落位被拒（`placeSprite` 返回 `false`）、文档零变化、**待放态保留** + 提示「落点与已有素材重叠：换个位置，或先把压住的素材拖开」（`index.tsx:823-827`） | 不强行落位、不移开已有素材、不吞掉这一次点击 | `pages/MapEditorPage/hooks/useMapEditor.test.tsx`「验收：山拖到聚落正中心 → 落位被拦（返回 false、文档不动）」（:713）；待放态保留见同文件「第一次被拦（文档零变化）→ 同一 pending 换空地再点 → 成功落位」（:780） |
| **P-5** | 进入画区（`draw`）或折线（`polyline`）工具 | 先清掉 `pendingLabel` / `pendingSpriteId`（`index.tsx:534`）；此后画布左键只落顶点 | 画区/折线态下**不得**顺手落素材或改选中（模式隔离） | `pages/MapEditorPage/index.regions.test.tsx`「模式隔离：画区态在已有区块内点一下 ⇒ 选区不变、不新增区块、只多一个顶点」（:411） |

---

## 2. 选中态（单击对象 → 选中框 + 属性面板）

**现行范式（一句话）**：单击对象即选中，出现**只读描边选中框**（`overlay` 层）+ 画布**右上角浮出的属性面板**（`position: absolute; right: 16px; top: 16px; width: 232px`，`components/ElementPanel/index.scss:8-12`）。**没有独立的右侧栏**，也没有缩放手柄。

| # | 触发 | 结果 | 明确不做什么 | 守卫落点 |
|---|---|---|---|---|
| **S-1** | 单击素材 | 命中则选中该素材（`index.tsx:834-839`）；命中测试按素材外接盒，落在外盒外 1px 即不选中 | 不做像素级多边形命中 | `pages/MapEditorPage/index.coords.test.tsx`「郡级素材：点中心选中、点外接矩形外 1px 不选中」（:459） |
| **S-2** | 素材被选中 | 右上角浮出属性面板：尺寸 / 旋转 / 不透明 / 色相四个滑杆 + 层级下拉 + 地名输入 + 置顶/置底（`components/ElementPanel/index.tsx`） | 不弹独立窗口、不遮挡工具栏 | `pages/MapEditorPage/index.generate.test.tsx`「选中素材出属性面板：四件套滑杆 + 层级下拉 + 地名输入都在」（:86） |
| **S-3** | 单击折线 / 点空白 | 点线选中折线（面板切成折线属性：5 档样式 + 首尾相连开关）；点空白清空三类选中，面板收起 | 不保留「上次选中」 | `pages/MapEditorPage/index.polyline.test.tsx`「点线选中 / 点空白取消：属性面板随之浮出与收起」（:125） |
| **S-4** | 选中另一类对象 | 素材 / 折线 / 区块三者**互斥**：选中折线时 `selectedId` 被清空，反之亦然 | 不做多选、不做跨类型同时选中 | `pages/MapEditorPage/index.polyline.test.tsx`「Ctrl+C / Ctrl+V：粘贴出斜移 16 单位的副本并选中它」（:279，断言 `selectedPolylineId` 有值且 `selectedId === null`） |
| **S-5** | 折线被选中 | 可拖节点改形状、双击线段插点、双击节点删点 | 不做曲线平滑度滑杆（B4 已裁定不做） | `pages/MapEditorPage/index.polyline.test.tsx`「拖节点：按绝对世界坐标移动，且拖拽全程只占一步撤销」（:136）、「双击线上插点（取线上最近点，不是鼠标位置）；再双击该节点删掉它」（:156） |
| **S-6** | 素材被选中 | 选中框只是**描边**（素材框色 `0x5b6cf9`，`components/MapCanvas/index.tsx:301`）：**没有角/边控制点**，改尺寸与旋转只能走右侧滑杆；整体移动靠拖拽本体 | **不提供**素材缩放手柄、不提供旋转手柄 | **无守卫** |
| **S-7** | 在空白处按住拖动 | 平移画布（`g.kind === "pan"`，`components/MapCanvas/index.tsx:2423`） | **不做框选多选**（`框选` 一词在 `src/windows/MapWindow` 内仅出现在 `store/useMapDocStore.ts:322` 的注释里，无实现） | **无守卫** |

---

## 3. 右键

**现行范式（一句话）**：**无右键菜单**。全仓 `MapWindow` 没有任何 `contextmenu` / `onContextMenu` 监听，也没有 `button === 2` 分支。

复现命令与实测输出：

```bash
grep -rn "contextmenu\|onContextMenu" src/windows/MapWindow     # → 无输出
grep -rn "button === 2\|button !== 0\|e.button" src/windows/MapWindow
# → 仅 1 条：components/MapCanvas/index.tsx:2423  if (g.kind === "pan" && g.travel <= CLICK_SLOP && e.button === 0)
```

| # | 触发 | 结果 | 明确不做什么 | 守卫落点 |
|---|---|---|---|---|
| **C-1** | 画布空白处右键 | **无行为**（右键不落位、不选中、不平移） | 不弹上下文菜单、不当作「取消」使用 | **无守卫** |
| **C-2** | 对象（素材 / 折线 / 区块）上右键 | **无行为**（不会「右键选中」；上下文菜单与对象无关，因为不存在） | 不提供「右键删除 / 右键属性」 | **无守卫** |

> 结论归属：右键菜单**不是本批遗漏，是现状就没做**。若后续要做，须先补一组选中态用例，再改 `onKeyDown` / `pointerdown` 之外的第三套入口——本批不动。

---

## 4. `Ctrl+C` / `Ctrl+X` / `Ctrl+V` / `Ctrl+D`

**现行范式（一句话）**：应用内剪贴板（不与系统剪贴板互通），素材与折线**共用同一块剪贴板**；`Ctrl+D` 是**复制一份**，删除走 `Delete` / `Backspace`。

实现：键盘分发 `pages/MapEditorPage/index.tsx:1355-1371`；编辑器层 `hooks/useMapEditor.ts:581-628`；store 层 `store/useMapDocStore.ts`。

| # | 触发 | 结果 | 明确不做什么 | 守卫落点 |
|---|---|---|---|---|
| **K-1** | `Ctrl+C`（有选中） | 选中对象（素材或折线）的副本进应用内剪贴板，文档不变 | **不与系统剪贴板互通**：跨应用粘贴不成立，粘贴也不读系统剪贴板 | `index.generate.test.tsx`「Ctrl+C / Ctrl+V 连续粘贴：粘贴件可连贴、可撤销」（:99）；`index.polyline.test.tsx`「Ctrl+C / Ctrl+V：粘贴出斜移 16 单位的副本…」（:279） |
| **K-2** | `Ctrl+X`（有选中） | 复制进剪贴板 + 删除原件 + 清空选中；剪切占 1 步撤销 | 不「剪切后立即粘贴」自动连续 | `store/useMapDocStore.element-actions.test.ts`「cut：剪贴板持有副本、原素材删除；paste 落位斜移且可连贴」（:107） |
| **K-3** | `Ctrl+V` | 粘贴出新 id 的副本，**斜移 16 世界单位**落位，自动选中新件；剪贴板**不消耗**，可连贴 | 不粘贴到光标位置 | `index.generate.test.tsx`「Ctrl+C / Ctrl+V 连续粘贴：粘贴件可连贴、可撤销」（:99）；斜移量 16 见 `index.polyline.test.tsx`（:279，断言 `points[0]` 为 `{x:16,y:16}`） |
| **K-4** | `Ctrl+D`（有选中） | **复制一份并斜移落位**，副本自动选中 | **`Ctrl+D` 不是删除**。本条与 `review/map-vs-reference-interaction-review.md` §2.3 的「快捷键：**Delete、Ctrl+D 删除**」不一致，**以本文为准**：删除只走 `Delete` / `Backspace` | `index.generate.test.tsx`「Ctrl+D 复制一份并选中新副本（副本出现在原位右下方）」（:115）；`index.polyline.test.tsx`「Ctrl+D 复制一份；方向键整体微移…」（:299） |
| **K-5** | `Delete` / `Backspace` | 删除选中对象（折线优先于素材）；**绘制态**改为「退一个草稿顶点」，不动文档 | 绘制态下**不得**走文档撤销（会撤掉上一步素材操作） | `index.polyline.test.tsx`「Delete 键分两个语境：绘制态退一个草稿点，选中态删整条线」（:197）、「选中态 Delete 删整条线（折线优先于素材删除）」（:215） |
| **K-6** | `Ctrl+V` 但剪贴板为空 | 返回 `null`，文档不变、**不压撤销步** | 不提示错误、不产生空撤销步 | `store/useMapDocStore.element-actions.test.ts`「空剪贴板粘贴返回 null 且不动文档」（:124） |
| **K-7** | 切换地图（`resetMapStores`） | 剪贴板被清空，换图后粘贴失效 | 不跨图粘贴 | `store/useMapDocStore.element-actions.test.ts`「resetMapStores 清剪贴板：换一张图后粘贴必须失效」（:130） |
| **K-8** | 焦点在输入框内按 `Ctrl+C` | 浏览器语义（复制文字），不劫持 | 输入框内**不得**动剪贴板或文档 | `index.generate.test.tsx`「输入框里的 Ctrl+C 不会被劫持成复制素材（守卫在先）」（:161） |
| **K-9** | 无选中时按 `Ctrl+C` / `Ctrl+X` / `Ctrl+D` | 直接 `return`（`index.tsx:1357` / `:1361` / `:1369`），**不 `preventDefault`** | 不隐式选中最近对象、不报错 | **无守卫** |

---

## 5. 方向键 + WASD 微移

**现行范式（一句话）**：无修饰键的方向键 / `WASD` 对**当前选中对象**做世界坐标微移，精调 **4** 世界单位、`Shift` 加速 **16**；连按合并为**一步**撤销。

实现：方向表 `pages/MapEditorPage/index.tsx:71-80`（8 键）、步长 `:83-84`（`NUDGE_STEP_FINE = 4` / `NUDGE_STEP_FAST = 16`）、分发 `:1424-1435`。

| # | 触发 | 结果 | 明确不做什么 | 守卫落点 |
|---|---|---|---|---|
| **N-1** | 有选中时按方向键 / `WASD` | 选中对象按 4 世界单位移动 | 不改层级、不改样式 | `index.generate.test.tsx`「方向键微移：精调 4 / Shift 加速 16，连按合并为一步撤销」（:127） |
| **N-2** | `Shift` + 方向键 | 步长 16 世界单位 | 不是「层级微调」，`Shift` 只改步长 | `index.polyline.test.tsx`「Shift+方向键加速微移（步长 16 世界单位）」（:318） |
| **N-3** | 连按同键 | 合并为**一步**撤销（合并键 `nudge:{id}`，`store/useMapDocStore.ts:679`） | 不每按一次压一步（会吃光 50 步栈） | `store/useMapDocStore.element-actions.test.ts`「联动地名一起动；连按十次只占一步撤销」（:140）；`index.generate.test.tsx`（:127，页面级同款断言） |
| **N-4** | 换对象移动 | 断键：A 移三步 + B 移一步 = **两次**撤销 | 不把不同对象的移动并成一步 | `store/useMapDocStore.element-actions.test.ts`「移动别的素材断开合并键：A 移三步 + B 移一步 = 两次撤销」（:159） |
| **N-5** | 移动带联动地名的素材 | 地名与素材一起动（同一次 commit） | 不留下「人走了名字还在原地」 | `store/useMapDocStore.element-actions.test.ts`「联动地名一起动；连按十次只占一步撤销」（:140） |
| **N-6** | 绘制态（`tool !== "select"`）按方向键 | **不微移**（条件里有 `tool === "select"`，`index.tsx:1430`） | 不在画区/折线态偷偷移动上一个选中的对象 | **无守卫** |
| **N-7** | 焦点在滑杆上（`[role='slider']`） | 方向键归滑杆（antd 内建步进），不微移素材（`index.tsx:1337`） | 不允许「滑杆动一格 + 素材挪一步」两个消费者抢同一组键 | **无守卫** |

---

## 6. `Esc`（分层语义）

**现行范式（一句话）**：`Esc` 是**由内向外逐层退让**，一次只退一层；输入框内的 `Esc` 只作用于输入框。

两处实现（这就是「分岔」的全部，不要去找第三处）：

- `pages/MapEditorPage/index.tsx:1399` —— `window` 级监听里的画布语义（四级退让，注释在 `:1400-1404`）
- `pages/MapEditorPage/index.tsx:2156` —— 地名输入覆盖层自己的 `onKeyDown`（`IME` 组字期间整段短路，`:2152`）

| # | 触发 | 结果 | 明确不做什么 | 守卫落点 |
|---|---|---|---|---|
| **E-1** | 画布 `Esc`，①有画区草稿或折线草稿（`draftPoints.length > 0` / `polylinePoints.length > 0`） | 只清草稿 + 清折线草稿点，**不改选中、不退模式** | 画到一半按 `Esc` **不得**把父块选丢（否则「进入/退出子级」会被一次误按静默重置） | `index.regions.test.tsx`「画区态 + 已落 3 点 + 焦点在输入框：Esc 只作用于输入框，草稿与模式都不动」（:579，末段 «在画布之外按 Esc，第一下清掉草稿 / 仍在画区模式»，:601-604） |
| **E-2** | 画布 `Esc`，②无草稿但 `tool !== "select"` | 工具回「选择」（`index.tsx:1413-1416`）= 真退出画区 / 折线态 | 不连带删掉已落库的内容 | `index.regions.test.tsx`「「画区」进入模式：动作区出现、层级取自 schema、完成与撤销在点数不足时 disabled」（:336，含 «Esc 第一下：没草稿、在画区 ⇒ 回选择模式»，:369-371） |
| **E-3** | 画布 `Esc`，③选择模式且无草稿 | 依次清：`pendingSpriteId` → `selectedId` → `selectedRegionId` → `selectedPolylineId` → 标注中间态 `pendingLabel` / `draft`（`index.tsx:1417-1423`） | 不删对象、不撤销、不清画布 | **无守卫** |
| **E-4** | 焦点在**输入框**内按 `Esc` | 只作用于输入框；`window` 监听在 `:1333` 处对 `INPUT / TEXTAREA / contentEditable` **整段 return** | 输入框内 `Esc` **不得**清草稿、不得退模式、不得清选中 | `index.regions.test.tsx`「画区态 + 已落 3 点 + 焦点在输入框：Esc 只作用于输入框，草稿与模式都不动」（:579 / :595） |
| **E-5** | 地名覆盖层输入框按 `Esc` | `finishDraft(false)`（`index.tsx:2156-2158`）= 取消本次取名，已落库内容不动；`IME` 组字期间整个按键被短路（`:2152`），中文首词不会被截断 | 不提交半截文字、不当作「删除地名」 | `index.land-labels.test.tsx`「「加标注」：画布落位 → 输入 → 回车落库；空文本不创建」（:198，`Esc` 在 :206） |

---

## 7. 撤销 / 重做与「一步」的粒度

**现行范式（一句话）**：「一步」= **一次 `commit`**；连续同质编辑靠 `coalesceKey` 合并成一步；栈上限 **50**；撤销/重做后**断键**。

实现：`store/useMapDocStore.ts:423-437`（`commit` 与合并判定）、`:45`（`HISTORY_LIMIT = 50`）、`:446-470`（`undo` / `redo`，两者都置 `lastCommitKey: null`）。

| # | 触发 | 结果 | 明确不做什么 | 守卫落点 |
|---|---|---|---|---|
| **U-1** | `Ctrl+Z` 撤销 / `Ctrl+Shift+Z` 与 `Ctrl+Y` 重做 | 分别调 `editor.undo()` / `editor.redo()`（`index.tsx:1347-1354`） | 不做「按对象历史」、不做分支历史 | **无守卫**（现有用例都点工具栏「undo」按钮，**键盘路径没有用例**） |
| **U-2** | 同 `coalesceKey` 连续编辑（一次滑杆拖动 / 连按微移 / 连续改层级名） | 只压**一步**快照（`store/useMapDocStore.ts:428`） | 不每次 `onChange` 都压步 | `store/useMapDocStore.element-actions.test.ts`「同键连续三次只压一步：撤销一次回到初始值（滑杆一次拖动 = 一步）」（:57）；`index.polyline.test.tsx`（:299，同键合并断言） |
| **U-3** | 换键（先改透明度再改缩放 / 换素材再移） | 断步，各占一步 | 不把两个不同字段的编辑并成一步 | `store/useMapDocStore.element-actions.test.ts`「换键断步：先拖透明度再拖缩放是两步撤销」（:67）、「移动别的素材断开合并键…」（:159） |
| **U-4** | 一次复制 / 一次粘贴 / 一次剪切 | 各占**一步**（`duplicateElement` / `pasteElement` / `cutElement` 不带合并键） | 不把「剪切 + 连续两次粘贴」算成一步 | `store/useMapDocStore.element-actions.test.ts`「duplicate：新 id + 斜移落位，撤销一步整个副本消失」（:92）；`index.generate.test.tsx`（:99，«一次粘贴是一步撤销»） |
| **U-5** | 栈深超过 50 | 从栈底裁掉最老的快照（`nextUndo.slice(-HISTORY_LIMIT)`，`store/useMapDocStore.ts:432`） | 不无限增长、不提示「历史已满」 | **无守卫**（`HISTORY_LIMIT` 没有任何用例断言） |
| **U-6** | 撤销 / 重做之后接着编辑 | `lastCommitKey` 被置 `null`（`:455` / `:470`），下一次编辑**必压新步** | 不允许「撤销 + 接着改 schema」被并进上一步（会产生「区块回来了但层级数还是新的」这种半截状态） | **无守卫**（`lastCommitKey` 在测试里零引用） |
| **U-7** | 任意新编辑 | 清空重做链（`redoStack: []`，`:434`） | 不做「撤销后仍可重做被覆盖的分支」 | **无守卫**（`redoStack` 在 `store/*.test.ts` 里零断言） |

---

## 8. 无守卫清单（登记风险，不豁免）

正文表格里标了「无守卫」的条目共 **14** 条；对本文执行 `grep -c`（模式即上一句引号内那四个字）应得 **18** —— 差额固定为 4 处说明性出现（§0 两条、本节标题、本行）。改表后必须同步本行数字，否则自相矛盾。

| 类 | 编号 | 未覆盖的行为 | 覆盖风险 |
|---|---|---|---|
| ① 放置态 | **P-1** | 进入待放态的视觉反馈（光标 `crosshair` + 提示文案） | 低：纯展示；但文案与 `SpritePanel` 的实际状态若不同步，用户会误以为「点了没反应」 |
| ① 放置态 | **P-3** | 落位成功后清 `pendingSpriteId`（**单次落位**语义） | **低**：已裁定不做连续落位（理由见 §1 P-3），口径不再有分歧；剩余风险只是「没有用例钉住这条裁定」 |
| ② 选中态 | **S-6** | 素材选中框无缩放手柄 | 低：属「没做」而非「做错」；但若将来加手柄，`overlay` 与导出 `clearOverlay` 的时序必须一起改 |
| ② 选中态 | **S-7** | 拖空白 = 平移（不是框选） | 低：`coords` 用例覆盖了「拖拽移动素材」，但没覆盖「拖空白只平移、不产生框选」 |
| ③ 右键 | **C-1** | 画布空白右键无行为 | 低：无行为即无回归面；但将来做右键菜单必须补用例，否则会与 `Esc` 语义打架 |
| ③ 右键 | **C-2** | 对象上右键无行为 | 低：同上 |
| ④ 剪贴板 | **K-9** | 无选中时 `Ctrl+C/X/D` 直接 return | 低：不 `preventDefault` 是刻意的（不影响浏览器默认行为），但**没人钉** |
| ⑤ 微移 | **N-6** | 绘制态按方向键不微移 | **中**：与「滑杆焦点」同类，都是「谁消费这个键」的边界，最容易在加新工具时破 |
| ⑤ 微移 | **N-7** | 滑杆焦点时方向键归滑杆 | **中**：同上；破坏后表现为「拖滑杆时素材乱跑」，但只有人手动点才看得见 |
| ⑥ Esc | **E-3** | 选择模式下 `Esc` 清选中 / 清标注中间态 | **中高**：这是最常用的一层，却完全没用例；清漏一个字段就会留下「看不见的选中」 |
| ⑦ 撤销 | **U-1** | `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` 键盘路径 | **中高**：键盘分发与按钮是两条路（`:1347` vs 工具栏），按钮绿了不代表键位通 |
| ⑦ 撤销 | **U-5** | 栈上限 50 的裁剪 | 低：只影响超长会话；但裁剪写错会「撤销跳步」 |
| ⑦ 撤销 | **U-6** | 撤销/重做后断合并键 | **中**：这是 `架构 §6-8` 明确的纪律，破了会产生「半截状态」且难复现 |
| ⑦ 撤销 | **U-7** | 新编辑清空重做链 | 低：标准语义；破了表现为「重做回到了被覆盖的分支」 |

**覆盖风险总评**：14 条里 **4 条落在「中」及以上**（E-3 / U-1 为中高；N-6 / N-7 为中），
共同特征是「**行为正确但只靠注释与纪律维持**」。下一批（R-REG-10）落地后建议先补 E-3 / U-1 两条，
另给 P-3 补一条「落位成功后不再处于待放态」的用例 —— 它现在是**已裁定口径**（不做连续落位），
正需要一条用例把裁定钉住，否则下次「顺手改成连续落位」时 750 用例仍会全绿。

---

## 9. 与其他文档的口径关系

| 文档 | 关系 |
|---|---|
| [`../review/map-vs-reference-interaction-review.md`](../review/map-vs-reference-interaction-review.md) §2.3 | **历史分析**。两处不一致已在本文 K-4 与 P-3 就地裁定（`Ctrl+D` 是复制不是删除；放置态是单次不是连续），冲突时以本文为准 |
| [`map-export-spec.md`](map-export-spec.md) | 导出期间 `clearOverlay` / `redrawOverlay` 会临时摘掉选中框（见 §2 S-6 的风险说明），导出规格里写时序 |
| [`map-db-spec.md`](map-db-spec.md) | 撤销栈是**内存态**，不落库；一次 `map-doc-save` 与一步撤销**不是 1:1**（防抖 800ms 合并多次 commit） |
| `AGENTS.md` §6（图形与交互） | 键位若与全局快捷键冲突（如 `Ctrl+S` 走 `persistence.saveNow()`，`index.tsx:1342`），以本文的实现落点为准 |

---

## 10. 复核命令（本文所有行号都可一次验完）

```bash
# 键盘总入口与两处 Esc
grep -n "Escape" src/windows/MapWindow/pages/MapEditorPage/index.tsx          # → :1399 / :2156
grep -n "NUDGE_STEP_FINE\|NUDGE_STEP_FAST" src/windows/MapWindow/pages/MapEditorPage/index.tsx  # → :83 / :84

# 右键：没有任何监听
grep -rn "contextmenu\|onContextMenu" src/windows/MapWindow                    # → 无输出

# 撤销栈与合并键
grep -n "HISTORY_LIMIT = \|lastCommitKey" src/windows/MapWindow/pages/MapEditorPage/store/useMapDocStore.ts

# 属性面板定位（右上角浮层，不是右栏）
sed -n '8,12p' src/windows/MapWindow/pages/MapEditorPage/components/ElementPanel/index.scss
```
