/**
 * 关系推断守卫（R-AI-15，B7 判据）
 *
 * 钉住「错了也不会报错」的四条：
 * 1. **不存在自动写入分支**：`doRun` 只产候选，写库只在 `apply()`；
 * 2. **写入只走 App 传入的 `commitLinks`**：本 hook 不碰 IPC，否则就会出现
 *    第二条写通道（图与库不一致的全部历史成因都是这个）；
 * 3. **请求带全契约字段**：`intent` / `scope` / `outputFormat` 缺一个，
 *    主进程无法按意图落日志、解析也会退化成文本兜底；
 * 4. **L3 授权前置**：未开总开关时先弹授权，不直接发正文。
 *
 * 为什么用源码断言：本 hook 依赖 `window.electronAPI` 与 AI 通道，纯单元测要把
 * 整条 IPC 全 mock 一遍，代价远高于把不变量钉在源码上（与 useNovelPage 那几份
 * 守卫同法）。
 *
 * ⚠️ 断言一律用正则、切片截到下一个声明：格式化会把调用拆成多行，
 * `toContain` 一段跨行文本必然假红（AGENTS「源码型守卫禁断死一行」）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  path.resolve(process.cwd(), "src/windows/RelationWindow/hooks/useRelationSuggest.ts"),
  "utf8",
).replace(/\r\n/g, "\n");

/** 取一段函数体：从 start 到下一个 end 标记之前 */
function slice(start: string, end: string): string {
  const from = SRC.indexOf(start);
  expect(from, `找不到 ${start}`).toBeGreaterThan(-1);
  const to = SRC.indexOf(end, from + start.length);
  expect(to, `找不到 ${end}`).toBeGreaterThan(from);
  return SRC.slice(from, to);
}

const DO_RUN = () => slice("const doRun = useCallback(", "const run = useCallback(");
const APPLY = () => slice("const apply = useCallback(", "const reset = useCallback(");

describe("关系推断：只产候选，不自动写入（B7 判据）", () => {
  it("doRun 里没有任何提交 / 写库调用（候选必须人工勾选）", () => {
    const body = DO_RUN();
    expect(body).not.toContain("commitLinks");
    expect(body).not.toContain("commitGraph");
    expect(body).not.toContain("novel-graph-commit");
    // 结果只进 state（setSession），这是「只产候选」的实现形态
    expect(body).toMatch(/setSession\(/);
  });

  it("写入只发生在 apply()，且只经 App 传入的 commitLinks", () => {
    const body = APPLY();
    expect(body).toMatch(/commitLinks\(/);
    expect(body).not.toContain("commitGraph");
    expect(body).not.toContain("window.electronAPI");
  });

  it("写入条数只算勾选的候选，并上报 adopt（采纳率因此可算）", () => {
    const body = APPLY();
    expect(body).toMatch(/item\.selected/);
    expect(body).toMatch(/intent:\s*"relation"/);
    expect(body).toMatch(/step:\s*"adopt"/);
  });

  it("失败不清候选：commitLinks 返回 false 时直接 return，保留候选让作者重按", () => {
    const body = APPLY();
    expect(body).toMatch(/if\s*\(!ok\)\s*\{[\s\S]{0,200}return;/);
    expect(body).toMatch(/ok\s*=\s*await\s+commitLinks\(/);
  });

  it("请求带全契约字段：intent / scope / outputFormat / count", () => {
    const body = DO_RUN();
    expect(body).toMatch(/aiGenerateStructured\(/);
    expect(body).toMatch(/intent:\s*"relation"/);
    expect(body).toMatch(/scope,/);
    expect(body).toMatch(/outputFormat:\s*spec\.outputFormat/);
  });

  it("提示词经 registry 的 buildPromptSpec 组装，上下文经 collectBookContext 采集", () => {
    const body = DO_RUN();
    expect(body).toMatch(/buildPromptSpec\(\s*"relation"/);
    expect(body).toMatch(/collectBookContext\(snapshot,\s*"relation"\)/);
  });

  it("未授权时先弹授权（consentOpen），不直接发正文", () => {
    const body = slice("const run = useCallback(", "const confirmConsent = useCallback(");
    expect(body).toMatch(/if\s*\(!consent\.l3Enabled\)/);
    expect(body).toMatch(/setConsentOpen\(true\)/);
  });

  it("授权弹窗的估算与实际发送同源（同一份 buildPayload）", () => {
    const body = slice("const consentEstimate = useMemo(", "const consentNotice = useMemo(");
    expect(body).toMatch(/buildPayload\(/);
    expect(body).toMatch(/estimateText\(/);
  });

  it("章节正文懒加载：只在打开弹层时 editorLoad(true)，不在挂载时就拉全书正文", () => {
    expect(SRC).toMatch(/const loadChapters = useCallback\(/);
    expect(SRC).toMatch(/editorLoad\(true\)/);
    // 挂载期只允许「切书清缓存」，不允许直接调 loadChapters
    const mount = slice("useEffect(() => {\n    chaptersForRef.current = null;", "const openDialog =");
    expect(mount).not.toMatch(/loadChapters\(\)/);
  });
});
