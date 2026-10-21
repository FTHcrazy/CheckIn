/**
 * RelationWindow 注册守卫（R27）
 *
 * 新增一个独立窗口要同时改六处，漏一处就是「点了没反应 / 打包后白屏 / 装载失败静默」：
 * ① `electron/edition.ts` 的入口路径 + 打包清单（lite 必须排除）；
 * ② 主进程 `createRelationWindow` + `relation-window-open` 开关；
 * ③ 登出时关窗（否则会留着上一账号的书）；
 * ④ preload 的 send 白名单（漏了 IPC 根本到不了主进程）；
 * ⑤ 渲染层入口 html 指向 main.tsx；
 * ⑥ `electron/window-load-guard.test.ts` 的 WINDOWS 清单（漏了守卫静默失效、测试不红）。
 *
 * 这些是纯文本契约，用 fs 读源码断言，不 import electron。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EDITION_WINDOW_ENTRIES, RENDERER_ENTRY_PATHS } from "../../../electron/edition";

const ROOT = process.cwd();
const read = (relativePath: string): string =>
  readFileSync(path.resolve(ROOT, relativePath), "utf8");

describe("RelationWindow：窗口注册", () => {
  it("入口路径登记为 RelationWindow/index.html", () => {
    expect(RENDERER_ENTRY_PATHS.relation).toBe("src/windows/RelationWindow/index.html");
    expect(() => read(RENDERER_ENTRY_PATHS.relation)).not.toThrow();
  });

  it("full / novel 打包本窗口，lite 不打包（novel 域整体缺席）", () => {
    expect(EDITION_WINDOW_ENTRIES.full).toContain("relation");
    expect(EDITION_WINDOW_ENTRIES.novel).toContain("relation");
    expect(EDITION_WINDOW_ENTRIES.lite).not.toContain("relation");
  });

  it("index.html 指向 RelationWindow/main.tsx", () => {
    const html = read("src/windows/RelationWindow/index.html");
    expect(html).toContain("/src/windows/RelationWindow/main.tsx");
  });

  it("preload 的 send 白名单包含 relation-window-open（漏了 IPC 到不了主进程）", () => {
    expect(read("electron/preload.ts")).toContain("'relation-window-open'");
  });
});

describe("RelationWindow：主进程生命周期", () => {
  const MAIN = read("electron/main.ts");

  it("有单实例创建函数与开关 IPC", () => {
    expect(MAIN).toContain("function createRelationWindow(");
    expect(MAIN).toContain('ipcMain.on("relation-window-open"');
    expect(MAIN).toContain('windowManager.register("relation"');
  });

  it("空 workId 拒绝开窗（没有上下文只能显示空壳，写回还会落错书）", () => {
    const at = MAIN.indexOf('ipcMain.on("relation-window-open"');
    expect(at).toBeGreaterThan(-1);
    const block = MAIN.slice(at, at + 900);
    expect(block).toContain("if (!workId)");
  });

  it("登出时关闭关系图窗口并清空上下文", () => {
    const at = MAIN.indexOf('ipcMain.on("auth-logout"');
    expect(at).toBeGreaterThan(-1);
    const block = MAIN.slice(at, at + 2600);
    expect(block).toContain('windowManager.get("relation")?.close()');
    expect(block).toContain("relationWindowContext = null");
  });

  it("上下文经 relation-window-context 下发（打开时 + 切书广播）", () => {
    expect(MAIN).toContain('"relation-window-context"');
    expect(read("src/windows/RelationWindow/hooks/useRelationContext.ts")).toContain(
      "novel-work-changed",
    );
  });
});

/**
 * S4 的两条「反向」契约：它们坏掉时界面**看不出异常**，只会慢慢变得难用。
 */
describe("RelationWindow：S4 反向同步与密度档", () => {
  const DATA = read("src/windows/RelationWindow/hooks/useRelationData.ts");
  const CANVAS = read("src/windows/RelationWindow/components/RelationCanvas/index.tsx");
  const NODE = read("src/windows/RelationWindow/components/EntityNode/index.tsx");

  it("增量只合并 links：applyLinkDelta 里绝不调用 load() / refresh()", () => {
    const start = DATA.indexOf("const applyLinkDelta = useCallback");
    const end = DATA.indexOf("useEffect(", start);
    expect(start).toBeGreaterThan(-1);
    const body = DATA.slice(start, end);
    expect(body).not.toContain("void load(");
    expect(body).not.toContain("refresh(");
    expect(body).toContain("setState((current)");
  });

  it("订阅的是 novel-links-changed，且 on/off 传同一个 handler", () => {
    expect(DATA).toContain('api.on("novel-links-changed", handler)');
    expect(DATA).toContain('api.off("novel-links-changed", handler)');
  });

  it("密度按成员数算（不按筛选后的可见数），且不改节点集合", () => {
    expect(CANVAS).toContain("resolveDensity(doc.nodes.length)");
    expect(CANVAS).not.toMatch(/resolveDensity\([^)]*filtered/);
    expect(CANVAS).not.toMatch(/doc\.nodes\.filter\(/);
  });

  it("画布仍然禁用 Delete / Backspace（误按一次就删掉真实关系）", () => {
    expect(CANVAS).toContain("deleteKeyCode={null}");
  });

  it("节点卡按密度档渲染：角标 / 名称 / 只画点三态都由 plan 决定", () => {
    expect(NODE).toContain("plan.showTypeChip");
    expect(NODE).toContain("plan.showName");
    expect(NODE).toContain("rel-node__name--on-hover");
  });
});

/**
 * S5 导出契约：导出走「取景 + 二进制落盘」两条独立通道，任何一个被换回
 * 文本通道（novel-export-file）都会「不报错但图坏了」。
 */
describe("RelationWindow：S5 导出", () => {
  const SERVICE = read("src/windows/RelationWindow/services/export-graph-png.ts");
  const HOOK = read("src/windows/RelationWindow/hooks/useExportPng.ts");
  const APP = read("src/windows/RelationWindow/App.tsx");
  const CANVAS = read("src/windows/RelationWindow/components/RelationCanvas/index.tsx");

  it("服务层含 exportBinary，绝不含 exportFile（复用文本通道 = 图坏且零报错）", () => {
    expect(SERVICE).toContain("exportBinary");
    // 剥掉注释再断言：文件头注释里点名 exportFile 是为了解释「为什么不复用」
    const code = SERVICE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    expect(code).not.toContain("exportFile");
  });

  it("取景走 captureWindow / relation-window-export，落盘走 exportBinary / novel-export-binary", () => {
    expect(SERVICE).toContain("captureWindow");
    expect(SERVICE).toContain("exportBinary");
  });

  it("导出抑制用纯 CSS 类（is-exporting），不触发 React 重渲染", () => {
    expect(HOOK).toContain("classList.add(EXPORT_CLASS)");
    expect(HOOK).toContain("classList.remove(EXPORT_CLASS)");
    // finally 保证失败 / 取消也摘类名
    expect(HOOK).toContain("finally");
  });

  it("取景矩形现算、DPR 现读（不缓存，窗口跨屏时会变）", () => {
    expect(HOOK).toContain("resolveCaptureRect(root.getBoundingClientRect())");
  });

  it("画布导出按钮有「先适应画布再导出」下拉，且导出前先冲刷坐标", () => {
    expect(CANVAS).toContain("先适应画布再导出");
    expect(APP).toContain("await graph.flush()");
  });

  it("导出前会冲刷未落库坐标，成功/失败都给反馈", () => {
    expect(APP).toContain("handleExport");
    expect(APP).toContain("关系图已导出为 PNG");
  });
});
