# 项目文档索引

> 本目录只放**文档**。代码规范的主体在仓库根 `AGENTS.md`，版本变更在 `CHANGELOG.md`，
> 历史版本在 `changeLogHistory/`。存储与命名规则见 `AGENTS.md` §5.3。

---

## 目录职责（三级）

| 目录 | 放什么 | 生命周期 | 谁能删 |
|------|--------|----------|--------|
| `docs/spec/` | **活规范**：长期有效、被代码或 `AGENTS.md` 直接引用、改版需同步守卫测试的技术规则 | 长期维护，随实现演进改版 | 不删，只改版 |
| `docs/review/` | **审查报告**：一次性的设计/产品/代码审查结论，**含尚未闭环的待办项** | 待办清空后整篇移入 `archive/` | 不删，只归档 |
| `docs/archive/` | **已完成或已作废的过程稿**：需求收口、技术预研、分批计划、验收方案、改造方案与验收对照 | 只读留档，不再修改 | 唯一允许整篇删除的目录（确认内容已被代码/规范完全吸收后） |

新增需求稿（还没开始的）放 `docs/prd/<需求编号>-<主题>.md`，交付完成后整组移入
`docs/archive/prd-<需求编号>/`。

> **长期模块例外**：地图是首个跨多批次的模块，文档分两组存放 ——
> 未闭环在 `docs/prd/prd-map-render/`，已闭环在 `docs/archive/prd-map/`，
> **入口是 [地图窗口模块总览](prd/prd-map-render/map-window-overview.md)**（先看它，再按需展开）。
> 归档文档内部指向旧路径的行文按历史记录理解（同 `CHANGELOG.md`，见文末规则 6）。

### 进行中的需求（docs/prd/）

| 需求编号 | 主题 | 文档 | 状态 |
|----------|------|------|------|
| R-AI 路线图 | AI 能力未来方向与架构复核（长期参考，非单次需求） | [prd-ai-roadmap/ai-future-directions-prd.md](prd/prd-ai-roadmap/ai-future-directions-prd.md) · [ai-roadmap-architecture-review.md](prd/prd-ai-roadmap/ai-roadmap-architecture-review.md) | 参考稿；「上下文层未落地」的结论已被 2.7.0 推翻 |
| **R-AI 排期** | **做什么、什么顺序、做完怎么算完**（B1–B8 批次 + 准入纪律 + 编号裁决） | [prd-ai-roadmap/ai-roadmap-batch-plan.md](prd/prd-ai-roadmap/ai-roadmap-batch-plan.md) | **定稿（基线 2.8.1）**，后续 AI 排期以它为准 |
| **R-MAP 地图窗口** | **地图模块总览（唯一入口）**：整体进度 / 能力地图 / 已完成时间线 / 未完成模块 / 文档去向 / 缺失清单 | [prd-map-render/map-window-overview.md](prd/prd-map-render/map-window-overview.md) | **维护中**（基线 2.30.0）；看地图先看这一份，其余文档都是它的展开 |
| **R-MAP 嵌套子图** | **区块内嵌子地图（单图/多图无级嵌套）主方案**（数据模型 `MapSubmap` / 递归场景图 / 两条生成路径 / 无级缩放 / 缓存扩展） | [prd-map-render/nested-submap-main.md](prd/prd-map-render/nested-submap-main.md) | **实现中**：Phase 2 / 2.4 已落地（2.18.0），**路径 A′ 跨图拷贝绑定已落地（2.32.0，拷贝语义一次答完引用/删除/跳转三问）**；剩余子图静态层缓存、子图内编辑（归 R-REG-10） |
| **R-MAP 嵌套子图·边界** | 无级缩放丝滑度与**边界割裂感**的成熟方案选型（共享几何 / 羽化 / 岛屿形态；自然地貌边界为可选增强非强制） | [prd-map-render/nested-submap-boundary.md](prd/prd-map-render/nested-submap-boundary.md) | **羽化带已落地（2.32.0，§2.2 有落地口径）**；岛屿形态/过渡地貌仍是可选增强待做 |
| **R-MAP 嵌套子图·道路** | **道路自动生成与层级归属**（地点要素自动连路 / 独立 roadLayer / 多种线条 / 子图只显示子图道路） | [prd-map-render/nested-submap-road.md](prd/prd-map-render/nested-submap-road.md) | 方案稿待评审；为嵌套子图主方案的「道路层」专篇（数据结构已升级为通用折线 `MapPolyline`） |
| **R-MAP 嵌套子图·要素** | **要素预留清单与架构分层**（素材散布区离散实例 / 通用折线 / 渲染铁律贴 PNG / DB+zustand+UI 三层） | [prd-map-render/nested-submap-elements.md](prd/prd-map-render/nested-submap-elements.md) | 方案稿待评审；为嵌套子图主方案的「要素扩展 + 状态架构」专篇 |
| **R-MAP 区域编辑** | **区域层级自定义 / 手动划分 / 子区域合并 / 叶子高亮**（四点增量；`regionSchema` 进文档、合并语义与子图提示、选中与高亮解耦） | [prd-map-render/region-editing.md](prd/prd-map-render/region-editing.md) · [archive/prd-map/map-region-editing-architecture.md](archive/prd-map/map-region-editing-architecture.md)（已归档） | **已实现**（2.19.0）：R-REG-01~05 五条 P0 全落地；P1（R-REG-06~10 顶点微调 / 删单块 / 改名改色 / 裁剪 / 子图内编辑）待排 |
| **R-MAP B4 图层 + 折线** | **图层面板（类型即图层 / 显隐 / 锁定）+ 折线要素（道路/河流/山脊/边界，可拖节点）**：7 条拍板项 + §9 三条已决（D8 不做平滑度滑杆 / D9 分组另立 R-MAP-29 / D10 子图内暂不开折线）、`layerState` 零写入、渲染栈 8→9 层、三批拆解与验收判据 | [prd-map-render/map-b4-layers-polyline-prd.md](prd/prd-map-render/map-b4-layers-polyline-prd.md) | **B4 三批全部落地（2.29.0 / 2.30.0 / 2.31.0）**：6 行面板 + 显隐/锁定/计数/折叠 + 折线绘制/平滑渲染/节点编辑/5 档样式/属性面板 + 河流变宽/山脊影线笔刷/闭合折线/复制粘贴微移；落地记录见 §6.1~6.3 |
| **R-MAP-21 ~ 28** | **与逆向目标的交互/体验差距收口**（一键成图生成器 / 素材体系 / 对象属性面板 / 图层面板 / 剪贴板与微移 / 折线与面 / 文字排版 / **map.db 持久化**） | [review/map-vs-reference-interaction-review.md](review/map-vs-reference-interaction-review.md) · [spec/map-db-spec.md](spec/map-db-spec.md) · [prd-map-render/map-asset-system-architecture.md](prd/prd-map-render/map-asset-system-architecture.md)（素材体系架构：地形枚举/选材引擎/导入/热门地图/AI 接口） | **B0（2.20.0）** `map.db` + 多图库；**B1（2.21.0）** 属性面板 + 剪贴板/微移；**B2（2.22.0）** 素材 6→45；**S1 + B3（2.25.0）** 地形语义层 + **52 张**素材标注 + 选材引擎 + 一键成图（现 52 张 / 9 展示分类）；**B4（图层 + 折线/面）已全量闭环**（2.29.0 图层面板、2.30.0 折线、2.31.0 打磨）；R-MAP-27 文字排版仍开放。其中 B4 的文档见[map-b4-layers-polyline-prd.md](prd/prd-map-render/map-b4-layers-polyline-prd.md)，逐项见[总览](prd/prd-map-render/map-window-overview.md) §3 |

> R-AI-01 ~ R-AI-05 已于 **2.8.1** 全部闭环，整组移入
> [`archive/prd-ai/`](archive/prd-ai/)（归档不改正文，详见下表）。
> 其中两条以「有意收敛」关闭，不是欠账：
> ① **FR-08 高级参数**首版只暴露「上下文长度」，`temperature` / `top-p` / 自定义 system 待有实测需求再开；
> ② **6 个埋点事件**不塞进 R-AI-01，转元能力 **M1a**（intent 契约 + `ai_event` 表）统一做。
>
> 2.8.1 补齐的三处：AI 配置页「获取 Key」外链引导（FR-05）、Ollama 自动列出已下载模型（FR-06）、
> 起名降级提示补「去设置」跳转（R-AI-02 FR-04）。

---

## 当前文档清单

### docs/spec/ — 活规范

| 文档 | 结论一句话 | 被谁引用 |
|------|-----------|---------|
| [graphic-theming-spec.md](spec/graphic-theming-spec.md) | 图形素材主题化只有两条正道：`currentColor` 或语义 token；禁止钉死色值、禁止一主题一份资源 | `AGENTS.md` §6.1.4 |
| [map-db-spec.md](spec/map-db-spec.md) | 地图用独立 `map.db`（与 checkin/novel 平级）：`doc_json` 整存 + `rev` 乐观锁 + 防抖 800ms 自动保存 + 关窗 flush；`work_id` 可空、先建图后绑定、删作品不级联删图 | `electron/map-db.ts`、`map-handlers.ts`、`map-db-guard.test.ts`、MapWindow |

### docs/review/ — 审查报告（含未闭环待办）

| 文档 | 结论一句话 | 待办状态 |
|------|-----------|---------|
| [novel-product-review.md](review/novel-product-review.md) | novel 域产品视角审查，11 项改进清单（P0 数据安全 → P2 导入/洞察） | 备份恢复、回收站、章节树虚拟化已落地（2.3.0 / 2.5.0 / 2.x）；每章位置记忆、EPUB 导出/导入、跨书全文搜索、产品级埋点仍开放 |
| [novel-design-review.md](review/novel-design-review.md) | novel 域设计视角审查，10 项改进清单（阅读模式、底色解耦、字体选择…） | 底色解耦、字体选择、阅读模式（含滚动到章节边缘切上下章）已落地；每章位置记忆、编辑器加载失败态、保存失败重试、抽屉焦点管理仍开放 |
| [map-vs-reference-interaction-review.md](review/map-vs-reference-interaction-review.md) | 地图与逆向目标（易制地图）的交互/体验差距：**渲染已对齐九成，差的是「内容」**——生成器只产陆地+区块，素材 5 张、无属性面板/图层/持久化；给出 R-MAP-21~28 与 B0–B4 分批 | B0（`map.db` 持久化）已落地 2.20.0；B1（属性面板 + 剪贴板/微移）已落地 2.21.0；B2（素材 6→45 + 点要素地名联动）已落地 2.22.0；B3 一键成图已落地 2.25.0；**B4 已全量闭环**（2.29.0 图层面板、2.30.0 折线、2.31.0 打磨）；R-MAP-27 文字排版仍开放 |
| [map-vs-reference-render-analysis.md](review/map-vs-reference-render-analysis.md) | 素材「和谐分布」机制逆向（`all_model_base.js` v1.122 静态分析）：「和谐」来自**网格布点 + 丛簇 + 连通性先验 + 地貌带分池 + 脚底 y 排序 + alpha 掩码留白**六件事，不是渲染技术；给出 P0/P1/P2 重建建议与对 PRD §4.3 的修订意见 | 分析定稿（静态推断，未做运行时捕获）；**已完成 14 项**：P0-1 地貌带 + P0-2 网格丛簇 + P1-2 z 序（2.26.0，§6.4）、素材比例（配额表/多片地形/`TERRAIN_SCALE`）+ 背景质感（浅滩/等深线/陆岸内阴影/海面暗角/程序纸纹）（2.27.0，§6.5）、**批次 A（P1-1 海岸内缩 + P1-3 z 分层）与批次 B（P2-1 纹理平铺 + 5 层内缩羽化）（2.28.0）**；**待办按执行序**：第 4~6 序＝P1-4 镜像翻转 → P2-2 区块层级衰减（⚠️ 原方案口径有误，见 §9.2.2 勘误）→ P2-3 落位避让；**阻塞**：素材池扩充（需美术，沼泽/雪原各仅 7 种）；自动生成分组 folder 的原阻塞点（依赖 B4 图层）已于 2.29.0 解除，现按 B4 PRD D9 另立需求号（预留 R-MAP-29），待产品决定。**状态与优先级唯一事实源＝[§9 执行总表](review/map-vs-reference-render-analysis.md#9-执行总表交接用)** |

### docs/archive/prd-map/ — 地图模块归档组

> 地图模块**已闭环**的过程稿。归档不改正文，只在顶部加「已归档 · 闭环版本 · 现行为准的去处」。
> 现存文档与未完成项的**唯一事实源**是
> [map-window-overview.md](prd/prd-map-render/map-window-overview.md)。

| 文档 | 结论一句话 | 闭环版本 |
|------|-----------|---------|
| [map-v1-prd.md](archive/prd-map/map-v1-prd.md) | v1 首版地图 PRD（R-MAP-01~15）：底图 + 素材 + 地点标记 + 连线；实现路线被 `map2` 取代 | 未按本文实施（8 条被现行实现覆盖） |
| [map-v1-architecture-research.md](archive/prd-map/map-v1-architecture-research.md) | 技术架构调研 v0.2：PixiJS 8 / WebGL / 无级缩放 / 2000+ 元素分层；§12 的 SVG 双层方案未采纳 | 2.17.x~2.18.0 |
| [map-coord-system-reference.ts](archive/prd-map/map-coord-system-reference.ts) | 坐标系参考实现（screen ↔ world ↔ 视图），现行由 `coords.ts` + 单测取代 | 2.18.0 |
| [map-render-alignment-prd.md](archive/prd-map/map-render-alignment-prd.md) | R-MAP-16~20 渲染观感对齐需求：陆地海岸 / 区块降级 / 文字层 / 三档风格 / 剔除·缓存·导出 | 2.17.x + 2.18.0 |
| [map-render-alignment-architecture.md](archive/prd-map/map-render-alignment-architecture.md) | 上述需求的工程落地方案（T01~T05 + 硬约定 + L-7 性能纪律） | 2.18.0 |
| [map-region-editing-architecture.md](archive/prd-map/map-region-editing-architecture.md) | 区域编辑的增量架构与 T1~T5 分解（P0 五条）；P1/P2 仍在 `region-editing.md` | 2.19.0 |

### docs/archive/ — 已闭环留档

| 文档 | 结论一句话 | 闭环版本 |
|------|-----------|---------|
| [visual-polish/novel-visual-polish-plan.md](archive/visual-polish/novel-visual-polish-plan.md) | 立体感与动效改造方案：5 档阴影 + motion token + 按下即反馈 | 1.47.0（规范沉淀进 `AGENTS.md` §6.1.3） |
| [visual-polish/novel-visual-polish-verification.md](archive/visual-polish/novel-visual-polish-verification.md) | 上述改造的改造前后对照与验收清单 | 1.47.0 |
| [prd-r27/r27-relationship-network-scope.md](archive/prd-r27/r27-relationship-network-scope.md) | R27 需求收口 v1.6（要什么；被 delta-v2 部分取代） | 2.x |
| [prd-r27/r27-relationship-network-preresearch.md](archive/prd-r27/r27-relationship-network-preresearch.md) | 技术预研 v1.4：框架选型、性能实测、落点 | 2.x |
| [prd-r27/r27-relationship-network-acceptance.md](archive/prd-r27/r27-relationship-network-acceptance.md) | 验收方案 167 例（P0 102 / P1 61 / P2 4） | 2.x |
| [prd-r27/r27-relationship-network-analysis.md](archive/prd-r27/r27-relationship-network-analysis.md) | PM 解读稿：把需求拆成 P0/P1/N 并归入分期 | 2.x |
| [prd-r27/r27-relationship-network-delta-v2.md](archive/prd-r27/r27-relationship-network-delta-v2.md) | 增量需求 v2：改独立窗口 + 资料卡画布 + 有限写回（推翻浮层方案） | 2.x |
| [prd-r27/r27-relationship-network-architecture-decision-v2.md](archive/prd-r27/r27-relationship-network-architecture-decision-v2.md) | 架构决策 v2：`@xyflow/react` + `d3-force`，`relation` 窗口，画布落 `novel_config` | 2.x |
| [prd-r27/r27-relationship-network-batch-plan-v2.md](archive/prd-r27/r27-relationship-network-batch-plan-v2.md) | 分批计划 v2（S0~S5）；v1 因沿用浮层方案已删除 | 2.x |
| [prd-ai/ai-architecture-decision.md](archive/prd-ai/ai-architecture-decision.md) | **R-AI-03** 架构决策：独立 `shared/ai/` 横向层，零重构接入 | 2.8.1 |
| [prd-ai/ai-technical-preresearch.md](archive/prd-ai/ai-technical-preresearch.md) | **R-AI-04** 预研：`net.fetch` + `ai.db` + `safeStorage` + 流式 + Ollama 五点结论 | 2.8.1 |
| [prd-ai/ai-model-config-scope.md](archive/prd-ai/ai-model-config-scope.md) | **R-AI-01** 模型配置层：BYOK + 本地模型，`ai.db` 随用户隔离 | 2.8.1 |
| [prd-ai/ai-naming-enhancement-prd.md](archive/prd-ai/ai-naming-enhancement-prd.md) | **R-AI-02** 起名增强：AI 试点功能，带降级与来源标识 | 2.8.1 |
| [prd-ai/ai-context-and-output-spec.md](archive/prd-ai/ai-context-and-output-spec.md) | **R-AI-05** 上下文加工层 & 输出模板契约（collector / 模板注册表 / JSON 三层保险） | 2.8.0 |
| [prd-ai/ai-review-report.md](archive/prd-ai/ai-review-report.md) | AI 域产品/设计/技术三视角审查与处置结论 | 2.8.1 |

> R27 已交付：`src/windows/RelationWindow/`（见 `CHANGELOG.md` 2.x「人物关系网络独立窗口」）。
> 已删除的 `r27-relationship-network-batch-plan.md`（v1）基于**已作废的页内浮层方案**，
> 其排期与工作量为无效数据，判断依据见 delta-v2 §1 与 architecture-decision-v2 §1。
>
> R-AI-01 ~ R-AI-05 六篇于 **2.8.1** 整组闭环归档（`archive/prd-ai/`）。
> 这批是「AI 从 0 到可用」的完整过程稿：需求 → 预研 → 架构决策 → 契约 → 审查，
> 归档后不再修改；**AI 接下来做什么一律看 [排期文档](prd/prd-ai-roadmap/ai-roadmap-batch-plan.md)**，
> 不要从这批旧稿里翻待办（它们描述的是 2.8.x 之前的缺口）。

---

## 存储规则速查

1. **一个主题一组文档**，组内统一前缀：`<需求编号>-<主题>-<体裁>.md`
   （体裁：`scope` 需求 / `preresearch` 预研 / `acceptance` 验收 / `analysis` 解读 /
   `architecture-decision` 架构决策 / `delta` 增量 / `batch-plan` 排期 / `review` 审查）。
2. **版本靠文件名后缀 `-v2`，不靠文内改版**：新方案推翻旧方案时，新建 `-v2` 并把旧稿
   移入 `archive/`；被完全取代的旧稿直接删除，不留「两份都像有效」的状态。
3. **每篇文档头部三行必填**：`状态`（草案/定稿/已归档）、`输入`（上游文档与版本）、
   `基线`（对应代码版本或提交）。缺基线的文档无法判断是否过时。
4. **移动文档必须同步引用**：仓库内所有 `docs/...` 路径引用在同一次改动里跟着改，
   用下面的命令自查，**不许留悬空路径**：

```bash
grep -rn "docs/[A-Za-z0-9._/-]*\.md" \
  --include="*.md" --include="*.ts" --include="*.tsx" --include="*.yaml" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist \
  --exclude-dir=dist-electron --exclude-dir=release --exclude-dir=changeLogHistory \
  --exclude-dir=archive . | grep "docs/"
```

> `--exclude-dir` 必须用：`| grep -v node_modules` 是**按行**过滤，行内容里没有
> `node_modules` 字样，扫不干净（实测会喷出几百条第三方包的文档路径）。

5. **归档不改正文**：整篇移动时只在顶部补一段「已归档 · 闭环版本 · 现行为准的去处」，
   不重写结论、不删章节——归档的价值是能追溯当时的判断依据。
6. **`CHANGELOG.md` / `changeLogHistory/` 里出现的 `docs/...` 路径是历史记录**，对应文件
   可能已按治理规则删除或移动。查历史时以「当时确实存在」理解即可，不要据此判定文档缺失；
   现存的文档一律以本索引为准。
