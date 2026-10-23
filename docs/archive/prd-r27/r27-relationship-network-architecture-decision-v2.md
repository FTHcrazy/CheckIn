# R27 人物关系网络 · 架构决策 v2（窗口化 + 成熟框架）

> 📦 **已归档**（2026-10-23）：本文属 R27 人物关系网络的**立项过程稿**，功能已于 2.x 交付，
> 现行为准请看 `src/windows/RelationWindow/`、`AGENTS.md` 与 `CHANGELOG.md`。正文保持归档时原样；
> 文内 `docs/prd/...` 路径已失效，实际位于 `docs/archive/prd-r27/`。

> 状态：**设计定稿，零代码改动**。本文只写决策、schema、SQL、目录树与清单，不含业务实现。
> 输入：`r27-relationship-network-scope.md`(v1.6) · `preresearch`(v1.4) · `acceptance`(167 例) · `batch-plan`(6 批 / 19.0d)
> 需求变更（用户原话）：*"授权其余的所有架构可允许重构…当前产品未上线，优先选择成熟的框架（需支持更换主题），需新增窗口，新业务落地新窗口，关联图中的拖拽元素应该是该小说所设置的所有元素资料卡，当在图谱中绑定关系后，二次确认保存后更新同步到小说右侧面板"*
> 既定输入（team-lead 已与用户确认）：画布 = **混合模型**（首次自动铺开已有关系 + 左侧全要素资料卡池可拖入补位/重排）；**成员集合与坐标一起按作品持久化**；**写回范围 = 连线新建 + 备注编辑**（删关系/改关系名仍回右栏）。

## §1 结论先行

1. **框架**：`@xyflow/react` **12.12.0**（MIT，peer `react >=17`，gzip **60.0KB**）；布局换 `d3-force` **3.0.0**（gzip 5.7KB）。Cytoscape / G6 因"节点不是 React 组件 + 主题是 JS 对象"被否。
2. **窗口**：新增独立窗口 `RelationWindow`，注册键 **`relation`**（full / novel 打包，lite 不打包）；非模态、单实例、即关即销，上下文走 `relation-window-context`（与 `pack` 同范式）。
3. **数据**：画布文档 **不建表**，落在既有 `novel_config` 单键 JSON（`novel_rel_graph_v1:<workId>:<graphId>`），一次 upsert 原子提交；连线复用 `novel_links` 主键，新增 `novel-graph-commit` 单事务通道。
4. **重构范围**：**不启用** §6.7 的 `refactor`——本次不需要新增表、不需要改 `novel_links` 结构、也不需要唯一约束；保持 `compat` 恰好把"要素与关联不得丢"变成机制约束。（⚠️ 工作区当前该开关已被改成 `refactor` 且**未提交**，见 §9-1。）
5. **作废**：浮层全套（`relGraphOpen` / `pageOverlayOpen` / Esc 链 / z-index 40）连同 `RG-G-02/03`、`RG-G-05`、计划中的 4 个 `useNovelViewState` 等价类一并作废；`RG-X`（导出 PNG）需重写实现路径。

## §2 图谱框架选型（ADR-27-01）

### 2.1 候选与硬指标（全部 `npm view` / bundlephobia / 官方文档实测，2026-10-20）

| 维度 | **@xyflow/react 12.12.0** | @antv/g6 5.1.1 | cytoscape 3.34.4 (+ wrapper) | 自研 DOM+canvas |
|---|---|---|---|---|
| 许可证 | MIT | MIT | MIT | — |
| 最后发布 | 2026-10-11 | 2026-09-21 | 2026-10-15 | — |
| **React 19.2.6** | ✅ peer `react >=17`（官方包声明） | ⚠️ 核心无 React peer；React 节点需 `@antv/g6-extension-react@0.2.7`（peer `@antv/g6 ^5.1.0`，**未到 1.0**） | ⚠️ `cytoscape-react` 5 的 peer 显式含 `^19.0.0`（社区包，非官方）；`react-cytoscapejs` 2.0.0 自 2022 无发布 | 原生 |
| **资料卡 = React 组件** | ✅ 原生 `nodeTypes` 映射，节点体就是本项目组件 | ⚠️ 需扩展包；本质是 canvas 上的 HTML/React 覆盖层 | ⚠️ 需 `cytoscape-dom-node` 覆盖层，位置由 cy 算 | ✅ |
| **主题吃 `--app-*`** | ✅ 节点是**真 DOM**，CSS 变量天然继承，切 `data-theme` 无需任何 JS | ❌ 主题是 JS 对象，`register(THEME)`+`setTheme()`；必须自建 `--app-* → theme object` 桥接并在每次换肤重设 | ❌ `stylesheet` 是 JS 对象，同样需桥接 | ✅ |
| 连线交互（handle 拖出→落点绑定） | ✅ `Handle` + `onConnect`，落点即完成绑定 | ✅ `create-edge` 行为 | ⚠️ 需自写 `tapstart/dragfree/tap` 状态机 | 自写 |
| 边标签 / 命中 | ✅ 自定义 Edge 组件（DOM 文本，可 `pointer-events` 精确命中） | ✅ canvas 文本 | ⚠️ canvas 文本，命中靠 `cy.on` 几何判定 | 自写 |
| pan/zoom/fit/minimap | ✅ 全内置（`Controls`/`MiniMap`/`fitView`） | ✅ 全内置 | ✅ 内置（minimap 插件） | 全自写 |
| **bundle 增量（gzip）** | **60.0KB** | **399.8KB**（+扩展包） | **136.8KB**（+wrapper + dom-node） | 0 |
| 200~500 节点余量 | 需开 `onlyRenderVisibleElements`（视口外不挂 DOM） | canvas 天然强 | canvas 天然强 | 取决于实现质量 |
| Electron 渲染进程注意 | 需给节点**显式宽高**（`measured` 由库测量，jsdom 下为 0）；无 SSR 顾虑 | 需 canvas 尺寸/DPR 处理 | 同 | — |

**依据**：`npm view @xyflow/react version peerDependencies license` → `12.12.0 / {react: ">=17"} / MIT`；`https://xyflow.com`；G6 主题机制见 `https://g6.antv.antgroup.com/en/manual/theme/custom-theme/`（"theme 是 Graph Options 的子集，元素样式为静态配置"）；G6 React 节点见 `https://g6.antv.vision/en/manual/element/node/overview`（`@antv/g6-extension-react` 提供 React 节点）；d3-force 随机源与手动 tick 见 `https://github.com/d3/d3-force`（`simulation.randomSource` 默认固定种子 LCG；`simulation.stop()` + `tick(n)` 可纯同步计算）。

### 2.2 决策

> **采用 `@xyflow/react@12.12.0` + `d3-force@3.0.0`。唯一新增运行依赖 2 个（gzip 合计 ≈ 65.7KB）。**

决定性理由只有一条，其余是加分项：**只有 React Flow 的"节点 = React 组件"+"节点是 DOM" 这两个事实同时成立**。用户的原始诉求是"拖拽元素应该是资料卡"——资料卡是带头像/名称/类型/副标题/多枚 handle 的复合组件，本项目已有同类组件（`EntityCard`）。G6/cytoscape 把节点画在 canvas 上，React 节点只是覆盖层插件，且两者主题都是 JS 对象：四套 `--app-*` 需要手写桥接层并在每次换肤重跑 `setTheme`/`stylesheet`，这正是"需支持更换主题"最容易被做成半成品的地方。bundle 60KB vs 137KB vs 400KB 只是顺带的结论。

**必须承认的代价**：200 张资料卡 = 200 个 DOM 子树（约 2000~2400 个元素），比原方案 pill 高 3~4 倍；React Flow 必须有视口虚拟化兜底（§6.3）。这一条是选型的**唯一真实风险**，已进 §9 与性能预算。

### 2.3 力导向布局

| 问题 | 结论 |
|---|---|
| 沿用自研 `force-sim.ts` 还是 `d3-force`？ | **用 `d3-force@3.0.0`**，不新建 `force-sim.ts`。自研三力模型要自己处理 alpha 衰减/收敛判据/碰撞松弛，而 `d3-force` 是这三个问题的既有最优解，且 5.7KB。 |
| 确定性播种（原 G9 圆环） | 播种仍是**我们的**逻辑：进 `simulation` 之前把 `x/y` 预置到半径 `R` 的圆环上（`θ = 2πi/N`）。d3 只在 `x` 为 `NaN` 时才用 phyllotaxis 自动铺开，显式值不覆盖。 |
| pin（原 `f` 标志） | `f=1` → `node.fx = x; node.fy = y`。d3 在每 tick 末尾把 `x` 复位为 `fx`、`vx` 清零，等价于原语义；取消 pin = `delete node.fx/fy`（置 `undefined`）+ `alphaTarget(0.3)` reheat。 |
| 停止判据 | `alphaMin=0.001 / alphaDecay=0.0228` → 自然 tick 数 `⌈log(alphaMin)/log(1-alphaDecay)⌉ = 300`（d3 文档明示）。首屏一次性算 `tick(300)` 后 `stop()`，不做常驻 rAF 循环。 |
| 单测能否不依赖 rAF | **能**。`.stop()` 后 `tick(n)` 是纯同步函数、不派发事件；`randomSource` 默认固定种子。断言方式：同输入跑两次 `tick(300)`，对 `x/y` 做 `toBeCloseTo(…, 3)` 逐点比对；再断言"同输入两次收敛后点集 `deepEqual`"。**禁止**断言具体像素（d3 内部迭代顺序是实现细节），只断言：① 两次一致 ② `f=1` 的点位移为 0 ③ 所有点两两距离 ≥ `2r`（碰撞生效）④ 连通分量重心间距 > 0（不塌缩）。 |
| 布局跑在哪 | 主线程一次性同步（200 节点 300 tick 估 30~80ms，见 §6.2 待实测）。若实测超 150ms 再迁 Worker（`d3-force` 纯函数，迁 Worker 只搬数组，不改协议）——**不预先做**。 |

### 2.4 被替代 / 作废的自研件

> ⚠️ 事实校正：以下文件**当前都不存在**（`find` 实测，R27 零代码基线）。因此不是"删除"，而是**不新建**。上一轮 13+1 件清单逐条处置：

| 上一轮清单条目 | 处置 | 说明 |
|---|---|---|
| `RelationGraph/index.tsx` | **作废 → `RelationCanvas/index.tsx`** | React Flow 取代浮层容器；职责变为"数据装配 + 提交编排" |
| `RelationGraph/index.scss` | 沿用（改名随目录） | 窗口根铺 `--app-bg`，卡片铺 `--app-surface` |
| `GraphCanvas.tsx` / `GraphNodeLayer.tsx` / `useGraphViewport.ts` | **三件全部作废（不新建）** | pan/zoom/画布事件归 `<ReactFlow>`，节点层归 `nodeTypes`，视口归 `useReactFlow().screenToFlowPosition / setViewport / fitView` + `onMoveEnd` 回写 |
| `utils/force-sim.ts` + `.test.ts` | **作废（不新建）** | 换 `d3-force`；新增 `utils/graph-layout.ts`（只做"播种 + 喂 d3 + 读回"的薄适配 + 单测） |
| `utils/relation-graph.ts` + `.test.ts` | **保留** | 纯函数层不受框架影响：跨作品过滤 G2、自环 G4、平行边合并 G6、`diagnostics` 五键、`planDegrade` |
| `GraphToolbar.tsx` | **保留** | 关系筛选 / 搜索 / 折叠 / 收窄；`Select` 弹层由 antd `colorBgElevated` 驱动（`ThemeProvider.tsx:83`），**不写进新 scss 就不用碰白名单** |
| `graph-theme.ts` | **保留但缩小职责** | 屏幕色改由 CSS 变量直读；本文件只服务**导出 PNG** 与 canvas 色板采样 |
| `utils/graph-layout-memory.ts` + `.test.ts` | **保留，改名 `graph-doc.ts`** | 从"读写 localStorage/config 布局"升级为"GraphDoc 编解码 + rev 冲突判定" |
| `export-graph-png.ts` + `.test.ts` | **作废 → 待重写** | 节点是 DOM，不能再 `canvas.toBlob()` 一把梭；见 §8 与 §9 |
| `index.test.tsx` | 作废（随浮层） | 新增 `RelationCanvas/index.test.tsx`（交互级：拖入/连线/确认/回滚） |

## §3 窗口化设计（ADR-27-02）

### 3.1 新窗口注册清单（逐条落点）

| # | 文件 | 改动 | 必须/建议 |
|---|---|---|---|
| 1-4 | `src/windows/RelationWindow/{index.html,main.tsx,App.tsx,index.scss}` | **整目录新建**，逐行对齐 `GlobalSettingWindow`：`main.tsx` 首行 `initThemeFromStorage()` + `installRendererLogger("relation")` + `ThemeProvider` + `ErrorBoundary windowName="relation"` + `import "@/shared/styles/themes.scss"`；`App.tsx` 订阅 `relation-window-context` + `novel-work-changed`，`WindowHeader` + 三栏（左卡片池 / 中画布 / 右属性）；`index.scss` 根铺 `--app-bg` | 必须 |
| 5 | `electron/edition.ts:26-32` | `WindowEntryKey` 联合类型 **+ `"relation"`** | 必须 |
| 6 | `electron/edition.ts:35-43` | `RENDERER_ENTRY_PATHS.relation = "src/windows/RelationWindow/index.html"` | 必须 |
| 7 | `electron/edition.ts:46-51` | `EDITION_WINDOW_ENTRIES.full = [..., "relation"]`；`.novel = [..., "relation"]`；**`.lite` 不加** | 必须 |
| 8 | `vite.config.ts` | **无需改**：`:19-23` 的 input 由 `EDITION_WINDOW_ENTRIES[edition].map(...)` 生成 | — |
| 9 | `electron/main.ts` | 新增 `createRelationWindow()`，逐行对齐 `createGlobalSettingWindow()`（`:711-755`）：单实例 `windowManager.get("relation")` → `raiseWindow()`；`1240×860`→**`1440×900`，min `1024×680`**；`ROUNDED_WINDOW_OPTIONS` + `titleBarStyle:"hidden"`；`attachWindowLoadGuard(win,"Relation",{windowName:"relation"})`；`forwardMaximizeState`；`windowManager.register("relation", win)`；`attachCloseGuard`；`loadRendererEntry(win,"relation")` | 必须 |
| 10 | `electron/main.ts`（`:1066` 附近） | 新增 `ipcMain.on("relation-window-open", (e, payload) => …)`：`EDITION === "lite"` 忽略 + **空 `workId` 拒绝开窗**（同 `pack-window-open` 口径 `:1013-1020`）+ 落盘到达日志 | 必须 |
| 11 | `electron/preload.ts:337-356` | `send` 的 `validChannels` **+ `'relation-window-open'`**（漏了 = 点击无反应，且 dev 下不易发现） | 必须 |
| 12 | `electron/main.ts`（`auth-logout` `:1095-1106`） | 关窗清单追加 `windowManager.get("relation")?.close()`（novel 数据属用户级，登出必须关） | 必须 |
| 13 | `src/shared/theme/themes.test.ts:430-443` | **白名单零改动**（决策）：窗口根铺 `--app-bg`、画布内资料卡铺 `--app-surface`（内容面）、交互态用 `--app-surface-hover/-active`；**不自绘任何浮层**。antd 弹层走 `ThemeProvider` 的 `colorBgElevated`（`:83`，已与 `--app-surface-elevated` 等值，`:201` 有断言）→ 与新 scss 无关。**唯一例外**：若将来在新 scss 里手写 `var(--app-surface-elevated)`，必须同一次提交加白名单（当前 12 项） | 必须 |

### 3.2 生命周期与上下文投递

```text
[主窗口] 点「关系网络」
   │ window.electronAPI.send("relation-window-open", { workId })
   ▼
[主进程] relationWindowContext = { workId, nonce }   ← 模块级变量（同 packWindowContext）
   ├─ 已存在窗口？ raiseWindow(existing); return
   └─ createRelationWindow()
        ├─ did-finish-load → sendTo("relation","relation-window-context", ctx)  ← 先天后显，同 :664-669
        └─ show

[主窗口] 切换作品 → broadcast("novel-work-changed",{workId,chapterId,nonce})
   ▼
[图窗口] 订阅同一 handler（与 PackWindow/App.tsx:56-64 完全同形）
        → 换 workId：先 flush 坐标 commit → 清 pending 连线 → 重新装载本书 GraphDoc
```

| 问题 | 决策 |
|---|---|
| workId 怎么传 | **两条路同形态**：开窗时 `relation-window-context`（主进程 `did-finish-load` 下发）；后续切换靠 `novel-work-changed` 广播。**不**用 query string（`app://` 下 query 会被缓存策略影响，且 pack 已证明 IPC 路径够用）。 |
| 主窗口是否禁用 | **否**，非模态。用户要能"图上一改 → 右边立刻看到"，主窗口必须活着且可交互。 |
| 打开时主窗口焦点/滚动 | 不碰主窗口：不 `hide()`、不 `reload()`、不 blur 处理。主窗口滚动位置 = 编辑器 DOM 状态，天然保留。`createRelationWindow` 里**不调用** `windowManager.get("novel")?.blur()`。 |
| 关闭后焦点回哪 | `win.on("closed")` 里 `raiseWindow(windowManager.get(PRIMARY_WINDOW_NAME))`（主窗为 `novel` / `main`，见 `:68`）。仅 `focus()`，不 `show()` 主窗口（隐藏到托盘的语义不破坏）。 |
| 关闭时 flush 什么 | **只 flush 坐标**（debounce 中的 `viewport`/`nodes`）。**不 flush 关系**——因为连线一经"二次确认"就已经提交落库（§4.4），窗口里不存在"未落库的用户决策"。这条把原 P0-7「零丢失」从"复杂草稿协议"降级为"一句话不变量"。 |

**P0-7「零丢失」在新形态下的等价断言（改写后）**：

| 原断言 | 新断言 |
|---|---|
| 关浮层不丢未保存的拖拽 | ① 拖动后 500ms 内自动 commit 坐标；② 关窗时 `beforeunload` 再 commit 一次；③ **坐标丢失不影响任何关系数据**（坐标是偏好，可丢） |
| Esc 关图前要确认 | 不适用（无浮层） |
| 切作品要关图 | 切换作品 → 图窗口重载为新书，旧书坐标已 commit；**pending 连线丢弃并 toast「未确认的连线已丢弃」** |

### 3.3 旧方案作废清单（逐条确认）

| 旧设计 | 新形态 | 结论 |
|---|---|---|
| `useNovelViewState` 的 `relGraphOpen` + `openRelGraph/closeRelGraph` | 状态在独立窗口，主窗口只需一个"开窗"按钮 | **作废** |
| 图并入 `pageOverlayOpen`（`useNovelViewState.ts:271`） | 无浮层 | **作废**（`pageOverlayOpen` 保持 `settingCenterOpen \|\| typeManagerOpen` 原样） |
| `pageOverlayOpen` 时把顶栏 `z-index` 抬到 1600 | 无浮层，顶栏层级不动 | **作废** |
| `handleEscape` 链首插入图分支（`useNovelPage.ts`） | 窗口内 Esc = 关边详情 / 清选中 | **作废** |
| `dismissPageOverlays` 追加一行（`useNovelViewState.ts:264`） | 不涉及 | **作废** |
| 图浮层 `z-index: 40` + `.nv-page__body` 末尾挂载（`NovelPage.tsx`） | 不涉及 | **作废** |
| `EntityPanel` 入口整行包 `import.meta.env.DEV` | 改为主窗口顶栏常驻按钮（窗口已上线即 P0） | **作废** |

**随之作废 / 改写的测试与守卫**

| 守卫 / 用例 | 处置 | 理由 |
|---|---|---|
| `RG-G-02`（`relGraphOpen` 不进 `pageOverlayOpen`） | **作废** | 对象不存在 |
| `RG-G-03`（Esc 链首是图） | **作废** | 对象不存在 |
| `RG-G-05`（零新增依赖） | **反转改写**：依赖白名单**恰为** `@xyflow/react`、`d3-force`；再出现第三个图库（`@antv/*` / `cytoscape*` / `react-force-graph*` / `d3` 全量）即红 | 需求变了，守卫要跟着变，否则守卫在阻碍需求 |
| `RG-G-04`（类型色板与正文同源） | **改写**：色值单一出口改为 `src/shared/styles/entity-type-colors.scss`（从 `EditorPane/index.scss:224-244` 上移），校验"该文件 6 个 token 与 `EditorPane` 引用一致" | 跨窗口禁止互引（`PackWindow/App.tsx` 注释同理），必须上移 |
| `RG-G-06`（派生层不含 React） | **保留**，`force-sim.ts` 换成 `graph-layout.ts` | 同一精神 |
| `RG-G-09`（30 张表逐字相等） | **保留原样即可**（本方案不新增表）；但**必须补一条**：`novel-db-split.test.ts` 现在只有"每张表都在 novel.db 出现"的**正向成员断言**，没有计数/逐字相等 → 新表不会让它变红。故 `RG-G-09` 是**独立新用例**，不是对现有文件的扩充 | 实测：`electron/novel-db-split.test.ts` 全文无 `30` 字面量 |
| `topbar-overlay-guard.test.ts` | **不动**（保持全绿） | 它守的是既有 `settingCenterOpen`/`typeManagerOpen` 浮层，本次不碰 → "没改它的测试还全绿"本身就是浮层零回归的证据 |
| `useNovelViewState.test.ts` 的计划 4 例（不进 `pageOverlayOpen` / `dismiss` 不关图 / Esc 链首 / 切作品关图） | **4 例全部作废，新增 0 例** | 该 hook 本次零改动 |
| `RG-X`（导出 PNG，10 例） | **重写**（见 §8） | 渲染介质从 canvas 变 DOM |

## §4 数据模型（ADR-27-03）

### 4.1 画布成员集合怎么存（三案对比）

| 方案 | 一本书多图 | 坐标与成员原子性 | 200 节点体积 | 并发写 | 需要 `refactor` | 需要迁移 |
|---|---|---|---|---|---|---|
| **① `novel_config` 单键 JSON** | ✅ 键后缀 `:<graphId>` | ✅ **天然原子**（一行即一份图） | ~6.5KB，SQLite TEXT 无压力 | SQLite 单行 upsert 原子；靠文内 `rev` 做乐观锁 | **否** | **零** |
| ② 新建 `novel_graph_canvas` + `novel_graph_nodes` | ✅ 外键 | ❌ 需跨表事务；成员增删与坐标是两类写 | 行数 200+，但每行仅 ~40B | 需事务 + 版本列 | **是**（新表） | 需建表 + 级联清理 |
| ③ 挂到 `novel_links` 加列 | ❌ 图 ≠ 边，孤立要素无落点 | ❌ 坐标挂在边上语义错位 | — | — | **是**（改列） | 改列 + 回填 |

> **推荐 ①。** 三条理由：**(a) 零 schema 变更** → 不必启用 `refactor`，从而不必打开"旧数据可丢弃"的口子（§7 的关键）；**(b) 原子性**——用户按"确认"时，成员集合、坐标、viewport 是**一份文档**，单行 upsert 不存在"成员写进去了坐标没写进去"的中间态；**(c) 读取形态匹配**——图窗口永远是"整本书整张图一次读"，从不需要"按节点查"，表结构的索引能力完全用不上。
> **触发迁到 ② 的唯一条件**：出现"一本书几十张图 + 图列表页 + 按图查询"的产品需求。届时再翻 `refactor` 一次性迁移，成本 = 一个读旧 JSON 的一次性脚本（不是兼容层，§6.7 允许）。

### 4.2 字段级 schema

```ts
/** 画布文档 v1 —— 存 novel_config.value（JSON 字符串），键见下 */
interface GraphDocV1 {
  v: 1;                                   // 文档版本；升版 = 丢弃重建（坐标可丢，见 §7）
  rev: number;                            // 乐观锁，每次成功提交 +1；0 = 尚未落库
  workId: string;
  graphId: string;                        // 起步恒为 "default"；键里冗余一份便于 LIKE 级联
  updatedAt: number;                      // Date.now()
  tf: boolean;                            // typeFilterTouched（沿用上版语义，与坐标同文档 = 同生共死）
  viewport: { k: number; tx: number; ty: number };   // React Flow 的 {zoom,x,y} 直接映射
  nodes: Array<[id: string, x: number, y: number, f: 0 | 1]>;  // 紧凑四元组，不用对象
}
```

**存储键**：`novel_rel_graph_v1:<workId>:<graphId>`（`novel_config.key` 单列主键，无 `work_id` 列 → workId 编进键，级联用 `LIKE 'novel_rel_graph_v1:<workId>:%'`）。

**体积估算**（沿用上轮"200 节点 5.85KB"实测口径，本次 `nodes` 用四元组 + 保留 3 位小数）：

| 规模 | 单节点 | 文档 | 说明 |
|---|---:|---:|---|
| 50 | ~31B | **1.7KB** | 典型书 |
| **200** | ~31B | **~6.4KB** | 与上轮 5.85KB 同量级（差值是 `rev/tf/viewport` 与 3 位小数） |
| 500 | ~31B | **~15.8KB** | 硬上限规模 |
| 1200（降级前极限） | ~31B | **~38KB** | 仍远小于 SQLite 单行 1GB 上限；IPC 单次 structured-clone 无感 |

### 4.3 写入通道

| 动作 | 通道 | SQL / 语义 |
|---|---|---|
| 新建 N 条关系 + 改 M 条备注 + 画布文档 | **新增 `novel-graph-commit`（单 IPC、单事务）** | 见下 |
| 单条新增（主窗口 `EntityDetail` 沿用） | `novel-link-add`（`:1414`）保持不动 | `INSERT INTO novel_links …` |
| 保留 `novel-link-note`？ | **不单独保留**。备注写入并入 `novel-graph-commit`（同一事务里能回滚）；若主窗口将来要改备注，再开单键通道 | 原因：两窗口两通道 → 同一行备注可能被两个事务交叉覆盖 |

```sql
-- ① 幂等建边：按 id 插入，绝不碰 note，绝不按四元组删（保住平行边）
INSERT INTO novel_links (id, from_type, from_id, to_type, to_id, relation, note)
VALUES (?, 'entity', ?, 'entity', ?, ?, NULL)
ON CONFLICT(id) DO NOTHING;          -- 重试安全：同 id 重复提交 = 无操作

-- ② 事务内去重（替代 UNIQUE 约束，避免 schema 变更）
SELECT id FROM novel_links
 WHERE from_type='entity' AND from_id=? AND to_type='entity' AND to_id=? AND relation=?;

-- ③ 备注（唯一写 note 的语句；changes===0 → 归入 rejected）
UPDATE novel_links SET note = ? WHERE id = ?;

-- ④ 画布文档（乐观锁：rev 必须等于 expectedRev，否则整体回滚）
INSERT INTO novel_config (key, value) VALUES (?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value
 WHERE json_extract(novel_config.value, '$.rev') = ?;   -- expectedRev
```

**为什么不用 `novel-link-set`**：`novel-pack-handlers.ts:644-653` 的 `upsertRealmLinkRow` 是 `DELETE … WHERE (from_type,from_id,to_type,relation)` 再 `INSERT`——它在**同一对端点 + 同一关系名**下会删掉已有行。图上连线恰恰最容易出现"同端点同关系名"（用户重复画一条即触发），一走这条路就是静默丢边。且它是"境界绑定"专用语义（`toType='level'`），不该被图复用。

**不需要唯一约束的理由**：`novel_links.id` 已是 `PRIMARY KEY`；平行边在数据模型里本就合法（`relation` 不同 = 两条独立边）；同 `relation` 的重复由**事务内 SELECT 去重**处理（②），语义等价且零 schema 变更。唯一残留风险是两个窗口同时插同一四元组 → 见 §5.3（主进程 `rev` + 去重 SELECT 都在同一事务内，跨进程串行化由 better-sqlite3 单连接保证）。

### 4.4 二次确认后的原子性

```text
[图窗口] 确认弹框「新增 3 条关系 / 修改 2 条备注 / 画布已调整」
   │ invoke("novel-graph-commit", { workId, graphId, expectedRev, doc, addLinks[3], noteUpdates[2] })
   ▼
[主进程] getDb().transaction(() => {            ← better-sqlite3 同步事务（同 :1546 / :1963 范式）
   1. 校验：所有 addLinks 两端节点属于 workId（novel_links 无 work_id，只能这里挡跨书边）
   2. 去重：四元组已存在 → 归 merged[]，不新增
   3. INSERT … ON CONFLICT(id) DO NOTHING     → created[] / skipped[]
   4. UPDATE note（changes===0 → rejected[]）
   5. rev 比对 → upsert doc（rev+1）
   return { ok:true, rev:rev+1, created, merged, notes, rejected }
 })                                            ← 任一步抛错 → 整体 ROLLBACK
   ▼
[图窗口] ok:false + code:"stale" → 弹「这本书的图已在别处改过」+ [重新载入]
         code:"invalid-target" → 指出具体节点，弹框不关
         code:"db"            → 弹框不关 + 保留全部待提交内容（不置灰「确认」）
```

| 决策 | 取值 | 理由 |
|---|---|---|
| 事务边界 | **单事务**（4 类写一起） | 分次提交 + 补偿在这个场景是反模式：补偿本身可能失败，而失败态正是"确认了但没生效"这类最伤信任的表现。一次事务，失败 = 什么都没发生，用户重按即可。 |
| 失败时 UI | **弹框不关、内容不清空、按钮保持可点**，附可在 1 次点击内完成的重试路径 | "确认了但没生效"必须被**看见**；最差的做法是关框 + toast（用户以为成功） |
| 坐标与关系是否同一事务 | **是** | 否则出现"边建好了、坐标没存" → 重开图节点散乱，用户会认为"它没记住我刚才摆的样子" |
| 幂等键 | `addLinks[].id`（渲染层生成 uuid） | 网络/IPC 重试、用户连按两次、主进程超时重发——三种情况都靠 `ON CONFLICT DO NOTHING` 兜住 |

### 4.5 级联与守卫

| 事项 | 落点 | 现状 |
|---|---|---|
| 删作品时清画布文档 | `novel-handlers.ts` 的 `novel-work-delete` `:618`，**必须排在 modifiers 之后**（同上一版 B2 风险②） | 新增 `DELETE FROM novel_config WHERE key LIKE 'novel_rel_graph_v1:<id>:%'` |
| 删要素时清画布成员 | 不需专门处理：读文档时对 `nodes` 中已不存在的 entityId 做丢弃（`diagnostics.droppedUnknown`） | 惰性收敛，避免在删要素路径上多一次全图重写 |
| `novel-db-split.test.ts` | **不改**（不新增表、不新增跨库导入） | 全绿是"没越界"的证据 |
| `novel-write-guard.test.ts` | 可能受级联插入位置影响 → **先跑它** | 见 §9-5 |

## §5 跨窗口写回与右栏同步（ADR-27-04）

### 5.1 事件链

```text
[图窗口] 确认 → novel-graph-commit（invoke，await 结果）
   ▼ ok
[图窗口] broadcast("novel-links-changed", {
             workId, rev,
             created: NovelLinkDTO[],        // 最多 N 条（首屏 3 条，极端 < 50）
             merged:  string[],              // 已存在、未新增的 linkId
             notes:   [{ id, note }]         // 改过的备注
         })
   ▼ (window-broadcast 自动排除发送者，main.ts:949-953)
[主窗口] 订阅 → 合并进本地 bundle.links（按 id upsert，不整表替换）
   ├─ EntityPanel 关联计数：由 bundle.links 派生 → 自动更新
   ├─ EntityDetail 关系区：`relations` 是 useMemo(links) 派生（useNovelData.ts:1822）→ 自动更新
   ├─ 支持面板 tab 徽标：若 badge 数来自 links → 自动；否则加一个 links.length 依赖
   └─ **不调用 novel-editor-load**（正文/草稿零影响）
```

反向（主窗口增删关系 → 图窗口）：同一条事件，方向反过来。`EntityDetail` 的 `onAddRelation/onRemoveRelation` 成功后也 `broadcast("novel-links-changed", { workId, created|removed })`；图窗口订阅后按 id 合并（新增则补节点、删除则去节点）。

### 5.2 复用 `novel-work-changed` 还是新增？

| 方案 | 结论 |
|---|---|
| 复用 `novel-work-changed` | **拒绝**。该事件语义是"作品/章节切换"，`PackWindow/App.tsx:44-52` 收到它就 `setContext(...)` → `key=workId#nonce` **整只重挂**，行囊会重新装载 bundle 并 flush 草稿。若用它传"关联变了"，行囊窗口会被无谓重挂（草稿往返、闪烁），且语义污染不可逆。 |
| 新增粗粒度 `novel-links-changed`（只带 workId） | **拒绝**。主窗口必须重新 `novel-editor-load` 才能知道变了什么；该通道一次拉**全部作品的 entities+links**（`novel-handlers.ts:1101-1117` 无 work 过滤）→ 200 要素规模下有明显闪动，且会把编辑器区域的可编辑状态打断。 |
| **新增细粒度 `novel-links-changed`（带 delta）** | **采用**。载荷就是本次变更的边/备注（KB 级），主窗口 Map 合并，零重载、零闪烁、零草稿风险。 |

**"不漏"的保证**：delta 由**主进程事务成功后的返回值**生成（不是渲染层自己记的账），因此"写进去了但没通知"不可能发生；接收侧合并按 `id` 幂等，重复投递无副作用。

### 5.3 并发

| 场景 | 处理 |
|---|---|
| 主窗口正在编辑同一本书的要素 | 要素（`novel_entities`）本次**不由图窗口写**（画布只动 links + config）→ 无冲突面 |
| 主窗口正在加同一对端点的边 | 图窗口 commit 内 `四元组 SELECT` 去重（§4.3 ②）→ 归入 `merged` 而非新增；两边各自 UI 都正确 |
| 两窗口同时改同一行 note | 后提交者覆盖（`UPDATE … WHERE id`）。**必须**：图窗口在打开边详情时记下原 note，提交时若主进程发现库里 note 已变 → 归入 `rejected` 并回传库中值，UI 提示"备注已被主窗口修改，已保留较新版本" |
| 两窗口同时改画布（图窗口理论上单实例，但快速关开可能并存） | `expectedRev` 版本比对（§4.3 ④）→ `stale` → 重载，不静默覆盖 |

### 5.4 真相源划分

| 状态 | 唯一真相源 | 说明 |
|---|---|---|
| `novel_links`（含 note） | **主进程**（`novel.db`） | 图窗口与主窗口都只是投影；任何写入必须走 commit 事务 |
| `GraphDoc`（成员/坐标/viewport/tf） | **主进程**（`novel_config`，带 `rev`） | 图窗口内存态是"未提交草稿"，500ms debounce 提交 |
| 当前选中节点 / 边详情展开态 / 搜索词 / 待确认连线 | **图窗口本地** | 关窗即弃；不进库 |
| 当前作品 / 章节 | **主窗口**（经 `novel-work-changed` 广播） | 图窗口只读跟随 |

## §6 性能预算（换框架后重算）

### 6.1 目标规模与降级档

规模沿用 **200 要素 / 500 关联**。降级档保留 121 / 201 / 401 三个数字，但**语义改变**：原方案是"pill → 色点"，新方案是"卡片细节档"（因为节点本来就是资料卡）。

| 可见节点数 | 卡片档位 | 卡片内容 | DOM/卡 | 说明 |
|---|---|---:|---:|---|
| ≤ 120 | **full** | 头像 32 + 名称 + 类型 chip + 副标题 + 关联数角标 | ~11 | 默认 |
| 121 ~ 200 | **compact** | 头像 24 + 名称 + 类型色点（去副标题、去角标） | ~7 | 目标规模落在这档 |
| 201 ~ 400 | **minimal** | 名称 + 左侧 3px 类型色条 | ~4 | 与 pill 同量级 |
| > 400 | **收窄**（复用 ③：只留角色类）+ minimal | 同上 | ~4 | 与提示条同时出现，明示可逆 |

**`onlyRenderVisibleElements` 常开**（三档都开）：视口外节点不挂 DOM，这使"200 要素"实际同时挂载数 ≈ 视口内 30~60 个。降级档因此是**双保险**（防止用户 fit 到全图导致全部进视口）。

### 6.2 首屏分段预算（窗口打开 → 首帧 < 1s）

| 段 | 动作 | 预算 | 实测口径 |
|---|---|---:|---|
| ① 读库 | `novel-editor-load` 子集（entities + links）或新增 `novel-graph-load(workId)` | **≤ 120ms** | 主进程打点 `performance.now()` 前后差 |
| ② 派生 | `buildRelationGraph`（G1~G9 + diagnostics） | **≤ 5ms**（上版 RG-P-06 口径） | 单测断言 |
| ③ 布局 | `d3-force` 300 tick（200 节点） | **≤ 150ms**（估 30~80ms，**待实测**） | 脚本：`tick(300)` 计时，项目外 |
| ④ 首绘 | React 挂载 + 视口内 30~60 张卡 | **≤ 250ms** | `PerformanceObserver('paint')` 打点 |
| 合计 | | **≤ 525ms**，余量 475ms | 窗口冷启（含 JS 解析）另计，`<1s` 含冷启 P95 |

> ⚠️ ④ 与 ③ 的数值是**复杂度推算**，不是实测。**必须在 S1 批次做一次 spike 实测**并回填本节（脚本放项目外，不进 CI，与 `RG-X` 导出口径一致）。

### 6.3 200 张资料卡 vs 200 个 pill

| 项 | 原方案（pill/色点） | 新方案（资料卡） | 倍数 |
|---|---:|---:|---|
| 每节点 DOM | 3~5 | full 档 ~11 / compact ~7 | **2.2~3.7×** |
| 200 节点总 DOM | 600~1000 | 1400~2200 | 同上 |
| 首绘 | 一次性 | 视口内 30~60 卡 = **330~660 DOM** | **实际反而更低** |

**结论**：`onlyRenderVisibleElements` 把"200 张卡"变成"视口内 ~50 张卡"，因此在**默认 fit-to-screen** 的初始状态下，新方案的实际挂载量与原方案相当甚至更少；真正危险的是用户手动 zoom out 到全景——此时降级档（minimal）+ 视口裁剪共同兜底。**不做**把卡片改回 pill 的方案（违反需求原文）。

## §7 重构范围与"不该动的东西"

### 7.1 结论：**不使用** `refactor` 授权

| 想做的事 | 是否真需要破坏性重构 | 替代做法 |
|---|---|---|
| 存画布成员/坐标 | ❌ | `novel_config` 单键 JSON（§4.1 ①） |
| 建关系时避免误删平行边 | ❌ | 新增 `novel-graph-commit`（按 id 插入），**不改** `novel_links` |
| 备注可写 | ❌ | `note` 列本就存在（`novel-db.ts:159`），`UPDATE` 即可 |
| 同关系去重 | ❌ | 事务内 `SELECT` 去重，**不加** UNIQUE 约束 |

> **理由**：`refactor` 的语义是"**允许**丢弃老数据"。本需求恰恰有一条硬约束——"用户已有的要素与关联不能丢"。把开关翻到 `refactor` 等于给未来任何一个改动发一张"可以重设 `novel_links`"的许可证，而重设关联表是本项目最容易"顺手把数据洗掉"的操作。**保持 `compat` = 把这条约束从"我们的自觉"变成"机制的强制"**。这是本方案最大的一处取舍：为了少写 200 行 schema 代码，宁可保留一条手工去重 SQL。

### 7.2 建议动 / 不该动

| 建议动（novel 域内） | 不该动 |
|---|---|
| 新增 `RelationWindow/**`（全新目录，零侵入） | `electron/db.ts`（checkin 域，一行都不碰） |
| `electron/edition.ts`（+1 键，3 处） | `src/shared` 中与小说无关的部分（ledger / todo / memo / 地图） |
| `electron/main.ts`（+`createRelationWindow` / +1 IPC / 登出关窗） | `src/shared/styles/themes.scss` 的**四套变量定义**（只读，不改值） |
| `electron/preload.ts`（+1 白名单项） | `work-numbering-guard` 等与本次无关的守卫 |
| `electron/handlers/novel-handlers.ts`（+`novel-graph-commit` / 级联清 config） | `CharacterPack/**` 内部结构（行囊不动，只可能被本方案的上移动作**引用**，不改内部） |
| `src/shared/styles/entity-type-colors.scss`（新建，从 `EditorPane/index.scss` 上移 6 色） | `electron/novel-db.ts` 的 30 张表结构（**零改动**是硬要求） |
| 主窗口：顶栏入口按钮、`useNovelData` 的 `novel-links-changed` 合并、`EntityDetail` 广播 | `useNovelViewState` 的浮层全套（不动 = 零回归） |
| `SupportPanel/ToolLauncher`：R27 卡从"规划中"转"已上线" | 测试文件（除 4 处断言按 §9 改） |

### 7.3 迁移风险

| 数据 | 处置 | 丢失后果 |
|---|---|---|
| `novel_entities` / `novel_links` / `novel_works` … | **必须保住，且本方案零迁移**（不改表、不改列、不新增表） | 用户的书与设定 |
| 旧"布局坐标" | **不存在**（R27 零代码基线，从未上线） | 无 |
| `GraphDoc` 的 `v` 升版 | 允许丢弃并重建（坐标是偏好） | 用户需重新摆一次，可接受 |
| `novel_config` 里别的键（`novel_editor_position` / session） | **不得误删**：级联只用 `LIKE 'novel_rel_graph_v1:%'` 前缀 | 编辑器位置丢失 / 崩溃恢复误判 |

## §8 与上一版分批计划的关系

| 原批次 | 新形态下 | 变化原因 | 新批次映射 |
|---|---|---|---|
| **B0 纯函数地基** | **保留（缩水）** | `relation-graph.ts`（G1~G9/`diagnostics`/`planDegrade`）不变；`force-sim.ts` 作废改 `graph-layout.ts`（d3 适配） | **S1** 的前半 |
| **B1 打开就有一张图** | **作废** | 浮层 → 独立窗口；挂载点、Esc、z-index 全部不存在 | 拆成 **S0**（窗口骨架）+ **S1**（框架接入） |
| **B2 拖得住、记得住** | **保留目标，形态改变** | 持久化从"config 布局条目"变"GraphDoc 整文档"；**双入口单一 opener 作废**（新窗口天然单入口） | **S2** |
| **B3 找得到、收得小** | **保留** | 工具栏/关系筛选/搜索/折叠/收窄与容器无关；Esc 三级作废 | **S3** |
| **B4 出去与留下** | **拆两半** | 备注：并入 commit 事务（保留）；**导出 PNG：作废重写**（DOM → 需 `html-to-image` 或按 `GraphDoc` 用 canvas 重绘一遍，是独立工作量且 `RG-X` 10 例要重写） | 备注 → **S3**；导出 → **S5（P1，可延后）** |
| **B5 超大图兜底** | **保留** | 阈值/提示条/可逆三条不变 | **S4** |

**新增批次**

| 批次 | 目标（详细计划下一轮出） |
|---|---|
| **S0 窗口骨架** | `relation` 键全链路可开可关；空窗口四主题无斑；上下文投递与切书跟随；登出关窗 |
| **S1 框架接入与资料卡节点** | 装 `@xyflow/react` + `d3-force`；`graph-layout.ts`；资料卡 full/compact/minimal 三档；虚拟化；`entity-type-colors.scss` 上移；spike 回填 §6.2 |
| **S2 画布模型与持久化** | `GraphDoc` 编解码 + 拖入补位 + pin + viewport + `rev` 乐观锁 + 500ms debounce + 关窗 flush |
| **S3 连线建关系 + 二次确认 + 写回** | Handle→`onConnect`→关系选择→确认弹框→`novel-graph-commit`→`novel-links-changed`→右栏同步；备注编辑 |
| **S4 降级与超大图** | 三档降级 + 收窄 + Top-500 + 提示条可逆 |
| **S5 导出（P1，可延后）** | 导出方案二选一（`html-to-image` 新依赖 vs 按 `GraphDoc` canvas 重绘）；`RG-X` 重写 |

**作废清单（一句话版）**：B1 整批作废；B4 的"导出"部分作废待重写；B2 的"双入口 opener"与全部 Esc/z-index 相关子项作废。**总人日必须重估**——原 19.0d 里 B1 的 4.5d 不成立（窗口骨架 + 框架接入是另一件事），而 S1 的 spike 与 `GraphDoc` 文档协议是原计划没有的净增量。

## §9 开工前必须闭环（6 条）

| # | 事项 | 谁 / 哪一步 | 漏了会怎样 |
|---|---|---|---|
| 1 | **AGENTS.md §6.7 开关状态**：工作区当前已是 `"novelArch": "refactor"` 且 `git diff` 可见、**未提交**（`git stash`/`checkout` 前请确认是谁改的）。本方案结论是**不需要** `refactor` → 必须**回退为 `compat`** 并在提交信息里说明"R27 不启用重构授权"；若坚持保留 `refactor`，则必须同一次提交写变更记录（§6.7 要求"改完必须提交"），否则下一个会话会误判已获破坏性授权 | 架构师 + team-lead，**S0 开工前** | 两种坏结局：① 别人看到 `refactor` 就放开手脚重设表 → 用户关联被洗；② 改了值却没提交 → 事实源与实际不一致，审计链断 |
| 2 | **依赖落地**：`pnpm add @xyflow/react@12.12.0 d3-force@3.0.0`（一次性、同一次提交）并跑 `pnpm check:deps` / `postinstall` 的 `fix-pnpm-links` 检查 | 实现者，S1 第一个提交 | `pnpm` 的 link 修复脚本与 lockfile 不一致 → 别人 `install` 后 `import` 解析失败；或有人"顺手"再引第三个图库 |
| 3 | **三处注册必须同改**：`WindowEntryKey` 联合类型 / `RENDERER_ENTRY_PATHS` / `EDITION_WINDOW_ENTRIES`，外加 `preload.ts` 的 `send` 白名单 | 实现者，S0 | 少任何一处都是"dev 能开、打包白屏"或"点击无反应且无日志"。dev 用 vite 直连 entry，最容易掩盖 `app://` 路径错误 |
| 4 | **架构约束**：`useNovelData` / `useNovelPage` / `useNovelViewState` **不得** import 图窗口的任何 service 或新 IPC 封装；图窗口通过 `novel-links-changed` 与主窗口通信，不共享模块 | 架构师写进 S2/S3 任务卡；评审把关 | 5 个穷举 mock `novel-service` 的测试文件（`useNovelData.global-setting-sync / note-sync / setting-preset`、`useNovelPage.qa`、`useNovelViewState`）会同时 `undefined is not a function`，红在"无关批"上 |
| 5 | **`novel-work-delete` 级联的插入位置**：清 `novel_rel_graph_v1:<id>:%` 必须排在 modifiers 之后；改前先跑 `novel-write-guard.test.ts` | S2 实现者 | 顺序断言红；更糟的是插在 modifiers 前 → 先清 config、后因外键失败回滚，留下"书还在、图没了"（虽然图可重建，但会引发对事务边界的怀疑） |
| 6 | **失败态契约**（产品文案 + 返回码）：`stale` / `invalid-target` / `db` 三种 `code` 的文案与按钮语义必须 PM 拍板并写进验收 | PM 定文案，架构定 code，**S3 开工前** | "确认了但没生效"是本需求唯一会直接摧毁信任的失败态；若 UI 关框 + toast，用户会认为已保存，下次打开发现少了三条边，且无法复现 |

## §10 修订记录（v2.1，2026-10-20）

本 ADR 的 §1~§9 为 v2 定稿；以下 6 处已被 `delta-v2`（PM）或 `batch-plan-v2` 取代，**以修订后为准**：

| # | 原条目 | 修订后 | 依据 |
|---|---|---|---|
| 1 | §4.2 `GraphDocV1.tf` 保留 | **删除 `tf`**（③ 收窄作废后无消费者；类型筛选降为窗口会话态） | delta-v2 §2.4 |
| 2 | §4.2 `nodes: [[id,x,y,f]]` | 改为 delta-v2 §2.4 的 `graphs{}/members{id:[x,y,fixed]}/rev/autoSeeded` 结构；**介质仍是 `novel_config` 单键**（PM 写的 `STORAGE_KEYS` 不实现） | delta-v2 §2.4 + §4.1 |
| 3 | §6.1 三档含「>400 收窄角色」 | **③ 与 ⑤ 作废**；只剩「① 密度档」，阈值 60/120/200/400 由 Spike 标定 | delta-v2 §2.3 |
| 4 | §3.2 切作品 → 静默重载 | **不静默**：横幅 + 用户选择 + 有草稿先确认 | delta-v2 W-05 |
| 5 | §3.2 关窗丢弃 pending 连线 + toast | **二次确认**，不静默丢 | delta-v2 W-03 |
| 6 | §2.4 / §8 导出「作废待重写」 | **定为 `capturePage`（候选 C）**，分辨率 = 视口 DPR 原生（否决 `zoomFactor=2`、否决透明档）；`novel-export-binary` 需**新建** | batch-plan-v2 附录 A |

另：`§9-1`（`novelArch` 开关）已由 team-lead 收口——工作区已回退为 `compat` 且 `git diff` 为空，**保持 `compat`**，`RG-G-08/09` 继续有效。
