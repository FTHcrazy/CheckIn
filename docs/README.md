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

### 进行中的需求（docs/prd/）

| 需求编号 | 主题 | 文档 | 状态 |
|----------|------|------|------|
| R-AI 路线图 | AI 能力未来方向与架构复核（长期参考，非单次需求） | [prd-ai-roadmap/ai-future-directions-prd.md](prd/prd-ai-roadmap/ai-future-directions-prd.md) · [ai-roadmap-architecture-review.md](prd/prd-ai-roadmap/ai-roadmap-architecture-review.md) | 参考稿；「上下文层未落地」的结论已被 2.7.0 推翻 |
| **R-AI 排期** | **做什么、什么顺序、做完怎么算完**（B1–B8 批次 + 准入纪律 + 编号裁决） | [prd-ai-roadmap/ai-roadmap-batch-plan.md](prd/prd-ai-roadmap/ai-roadmap-batch-plan.md) | **定稿（基线 2.8.1）**，后续 AI 排期以它为准 |

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

### docs/review/ — 审查报告（含未闭环待办）

| 文档 | 结论一句话 | 待办状态 |
|------|-----------|---------|
| [novel-product-review.md](review/novel-product-review.md) | novel 域产品视角审查，11 项改进清单（P0 数据安全 → P2 导入/洞察） | 备份恢复、回收站、章节树虚拟化已落地（2.3.0 / 2.5.0 / 2.x）；每章位置记忆、EPUB 导出/导入、跨书全文搜索、产品级埋点仍开放 |
| [novel-design-review.md](review/novel-design-review.md) | novel 域设计视角审查，10 项改进清单（阅读模式、底色解耦、字体选择…） | 底色解耦、字体选择、阅读模式（含滚动到章节边缘切上下章）已落地；每章位置记忆、编辑器加载失败态、保存失败重试、抽屉焦点管理仍开放 |

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
