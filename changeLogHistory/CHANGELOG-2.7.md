# Changelog · 2.7.x

> 自 `CHANGELOG.md` 按次版本拆分归档，条目内容与拆分前逐字一致（仅补了这一行说明）。
> 查历史请先看 `changeLogHistory/README.md` 的索引，再按版本号定位文件。

## [2.7.0] - 2026-10-27

### Added

- **AI 上下文加工层 `src/shared/ai/context/`**（R-AI-05）：把「作者每次手填要求」升级为
  「系统自动聚合本书设定」。
  - `collector.ts`：`BookSnapshot → AiBookContext`，按意图（naming / polish）决定采集字段与
    截断长度（要素 40/20 条、章节片段 800 字、已用名 40 条），避免把整本书塞进 prompt；
    并新增 `matchEntitiesInText` **反向匹配**——拿人物卡的名字/别名去句子里找，
    解决「划词是一整句、正向等值匹配命中率极低」的问题（单字名不参与，人物优先）。
  - `assembler.ts`：`assembleNamingSpec` / `assemblePolishSpec` 产出 `PromptSpec`
    （角色 / 上下文 / 约束 / 输出契约四段）。**新增 AI 功能 = 新增一个模板**，
    服务层与主进程零改动。
  - `output-spec.ts`：`OutputFormat`（text / json-array）契约 + 格式指令生成 +
    三层解析保险（prompt 强约束 → 最小 `[`~`]` 切片 JSON 解析 → 启发式兜底）。
- **起名结果带「寓意」**：输出改为 `json-array {"name","meaning"}`，结果卡在名字下方显示
  寓意（两行截断，hover 看全文）；模型不遵 JSON 时走文本兜底并在面板提示「寓意可能缺失」。
- **起名上下文自动灌入**：书名 / 题材 / 本书要素 / 境界体系 / 已用名自动进 prompt，
  描述输入框降级为「可选补充」（不填也能按本书设定起名）。
- **润色识别人物卡**：选区（及章节片段）中出现的角色自动带 `姓名 + 类型 + 简介` 注入
  prompt，并追加「保持人物性格与称呼」约束；一次最多 6 张，未命中不注入。
- **AI 调用日志**：`ai.db` 新增 `ai_log` 表（意图 / 模型 / prompt / 输出 / 错误码 / 耗时），
  IPC 通道 `ai-log-list`、`ai-log-clear` 已就绪（查看面板待接）。

### Changed

- **日志不再拆 `ipc.log`**：IPC 通信记录按 **DEBUG** 级别并入所属窗口当天的
  `YYYY-MM-DD.log`（模块名 `ipc`），与业务日志同一时间轴；仍只记失败与 >300ms 慢调用，
  仍受「记录 IPC」开关控制。
- **AI 调用同时写入本地日志**（模块名 `ai`，DEBUG 级）：prompt / output 各留 600 字预览，
  失败额外提一级到 `warn`，避免调高日志级别后看不见失败。
- `ai-context.ts` 标记为历史遗留：早期单轮模板保留但不再扩展，
  新增功能一律走 `context/assembler`（两套 prompt 并存必然漂移）。
- `AiGenerateRequest` 新增可选 `intent`（仅用于日志归类，服务层不解释）。

### 说明

- `ai_log` 表用 `CREATE TABLE IF NOT EXISTS` 幂等建表，存量 `ai.db` 下次打开自动补表，
  无需迁移脚本。
- 未落地：`novel_works.genre` 题材字段（Phase 2，需改建书 UI，可跳过）、调用日志查看面板。
