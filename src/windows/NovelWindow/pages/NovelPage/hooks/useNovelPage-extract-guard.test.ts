/**
 * AI 实体抽取守卫（R-AI-08，B6 判据②）
 *
 * 钉住这条链路上「错了也不会报错」的三处：
 * 1. **不存在自动入库分支**：抽取只产候选，落库只发生在用户点「建卡并入库」；
 * 2. **重名一律跳过**：即便被勾上也写不进去（覆盖作者手写简介不可逆）；
 * 3. **请求带全契约字段**：`intent` / `scope` / `outputFormat` 缺一个，
 *    主进程就无法按意图落日志、解析也会退化成文本兜底。
 *
 * 为什么用源码断言：useNovelPage 依赖编辑器实例（CodeMirror），纯单元测代价
 * 高，把这几条不变量钉在源码上最省（与 adopt / consent-scope 两个守卫同法）。
 *
 * ⚠️ 断言一律用正则：格式化会把属性 / 调用拆成多行，`toContain` 一段跨行文本
 * 会假红（见 AGENTS 的「源码型守卫禁断死一行」）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** 源码是 CRLF：跨行正则里写 `\n` 会全部失配，统一折叠成 LF 再断言 */
const SRC = readFileSync(
  path.resolve(
    process.cwd(),
    "src/windows/NovelWindow/pages/NovelPage/hooks/useNovelPage.ts",
  ),
  "utf8",
).replace(/\r\n/g, "\n");

/** 取一段函数体：从 start 到下一个 end 标记之前 */
function slice(start: string, end: string): string {
  const from = SRC.indexOf(start);
  expect(from, `找不到 ${start}`).toBeGreaterThan(-1);
  const to = SRC.indexOf(end, from);
  expect(to, `找不到 ${end}`).toBeGreaterThan(from);
  return SRC.slice(from, to);
}

describe("AI 实体抽取：只产候选，不自动入库（B6 判据②）", () => {
  it("doExtract 里没有任何写库调用（候选必须人工勾选）", () => {
    const body = slice("const doExtract = useCallback(", "const runEntityExtract = useCallback(");
    expect(body).not.toContain("addEntities");
    expect(body).not.toContain("saveEntitiesBatch");
    // 结果只进 state（setExtract），这是「只产候选」的实现形态
    expect(body).toMatch(/setExtract\(/);
  });

  it("落库入口只在 handleExtractConfirm，且过滤条件是「勾选 且 不重名」", () => {
    const body = slice("const handleExtractConfirm = useCallback(", "const handleExtractClose =");
    expect(body).toMatch(/item\.selected\s*&&\s*!item\.existingId/);
    expect(body).toMatch(/addEntitiesBatch\(/);
  });

  it("建卡成功后上报 adopt（含新建条数，采纳率因此可算）", () => {
    const body = slice("const handleExtractConfirm = useCallback(", "const handleExtractClose =");
    expect(body).toMatch(/intent:\s*"extract"/);
    expect(body).toMatch(/step:\s*"adopt"/);
    expect(body).toMatch(/itemCount:\s*created/);
  });

  it("请求带全契约字段：intent / scope / outputFormat", () => {
    const body = slice("const doExtract = useCallback(", "const runEntityExtract = useCallback(");
    expect(body).toMatch(/aiGenerateStructured\(/);
    expect(body).toMatch(/intent:\s*"extract"/);
    expect(body).toMatch(/scope,/);
    expect(body).toMatch(/outputFormat:\s*spec\.outputFormat/);
  });

  it("提示词经 registry 的 buildPromptSpec 组装（不在组件里手拼 system）", () => {
    const body = slice("const doExtract = useCallback(", "const runEntityExtract = useCallback(");
    expect(body).toMatch(/buildPromptSpec\(\s*"extract"/);
    expect(body).toMatch(/collectBookContext\(bookSnapshot,\s*"extract"\)/);
  });

  it("L3 授权与摘要共用 estimateScopePayload（发送量口径不能有两套）", () => {
    const body = slice("const extractPendingScope = useMemo(", "const doExtract = useCallback(");
    expect(body).toMatch(/estimateScopePayload\(/);
    expect(body).toMatch(/buildL3Payload\(/);
  });

  it("未授权时先记 pending 再走授权弹窗，不直接发请求", () => {
    const body = slice("const runEntityExtract = useCallback(", "const handleExtractConsentConfirm =");
    expect(body).toMatch(/setExtractPending\(/);
    expect(body).toMatch(/if\s*\(!aiConsent\.l3Enabled\)/);
  });
});
