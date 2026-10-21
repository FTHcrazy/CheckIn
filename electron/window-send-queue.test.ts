/**
 * 跨窗口投递守卫（R27 / S6，`window-send-to` 统一承载「入队 + 拉起」）
 *
 * 钉住四件只有真机才会暴露的事：
 *
 * ① **窗口没开时不能静默丢消息**：以前每种跳转都在主进程单独维护一对 IPC
 *    （`relation-entity-open` / `relation-entity-take`）+ 一份 pending 变量。
 *    现在统一走 `window-send-to` 的 `queue` / `create` 选项 + `window-pending` 队列。
 * ② **窗口刚被拉起时事件会早于订阅**：preload 拉到消息先存收件箱，`on()` 注册
 *    时按事件名补投 —— 不再要求渲染层写「挂载后自取」的专属代码。
 * ③ **另一本书不能静默切**：只弹确认框，切书发生在 `flushSave()` 成功之后。
 * ④ 判定只此一处：窗口根监听 `rel-open-entity`，编辑器页只提供能力句柄。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (relative: string): string =>
  readFileSync(path.resolve(ROOT, relative), "utf8").replace(/\r\n/g, "\n");

const MAIN = read("electron/main.ts");
const PRELOAD = read("electron/preload.ts");
const RELATION_SERVICE = read("src/windows/RelationWindow/services/relation-service.ts");
const NOVEL_APP = read("src/windows/NovelWindow/App.tsx");
const NOVEL_PAGE = read("src/windows/NovelWindow/pages/NovelPage/NovelPage.tsx");
const JUMP_STORE = read("src/windows/NovelWindow/store/useEntityJumpStore.ts");

describe("主进程：window-send-to 统一承接「送不到就排队 / 先拉起」", () => {
  it("窗口不在且 create → 先入队再拉起", () => {
    const start = MAIN.indexOf('"window-send-to"');
    expect(start, "main.ts 里找不到 window-send-to").toBeGreaterThan(-1);
    const body = MAIN.slice(start, MAIN.indexOf("window-pending-drain", start));
    expect(body).toContain("pushPendingMessage(target");
    expect(body).toContain("canCreateWindow(target)");
    expect(body).toContain("createWindowFor(target)");
    // 先入队再创建：新窗口 preload 一定会 drain，不存在「创建后才发现没消息」
    expect(body.indexOf("pushPendingMessage")).toBeLessThan(body.indexOf("createWindowFor"));
    expect(body).toContain("delivered: created");
  });

  it("拉的起来才允许 create：lite 版没有这些窗口，不能假装成功", () => {
    const start = MAIN.indexOf("function canCreateWindow");
    expect(start).toBeGreaterThan(-1);
    const body = MAIN.slice(start, start + 400);
    expect(body).toContain('EDITION !== "lite"');
    expect(body).toContain("WINDOW_CREATORS");
    // 白名单式：不是任意窗口名都能被一条消息拉起来
    expect(MAIN).toContain("novel: createNovelWindow");
  });

  it("待投递消息由窗口自己 drain；窗口还没注册时返回 null（让 preload 重试）", () => {
    const start = MAIN.indexOf('ipcMain.handle("window-pending-drain"');
    expect(start).toBeGreaterThan(-1);
    const body = MAIN.slice(start, start + 700);
    expect(body).toContain("takePendingMessages(name)");
    expect(body).toContain("return null");
  });

  it("专属跳转通道已删除（消息类型不再需要主进程记名字）", () => {
    expect(MAIN).not.toContain('"relation-entity-open"');
    expect(MAIN).not.toContain('"relation-entity-take"');
    expect(MAIN).not.toContain("pendingEntityOpen");
    expect(PRELOAD).not.toContain("relation-entity-open");
    expect(PRELOAD).not.toContain("takePendingEntityOpen");
  });
});

describe("preload：收件箱 + 监听注册时补投", () => {
  it("sendTo 把选项压成一个参数再进 IPC（多摆一个位置参数就会被按位读错）", () => {
    const start = PRELOAD.indexOf("sendTo: (");
    expect(start).toBeGreaterThan(-1);
    const body = PRELOAD.slice(start, start + 1200);
    expect(body).toMatch(
      /trackedInvoke\(\s*'window-send-to',\s*target,\s*event,\s*data,\s*buildWindowSendOptions\(raise, options\),?\s*\)/,
    );
    // 曾经的写法：raise 与 options 各占一个位置参数 → 主进程只读到 raise，
    // `create` 静默失效（真机故障：窗口关了却「没能打开」）
    expect(body).not.toMatch(/window-send-to',\s*target,\s*event,\s*data,\s*raise,\s*options/);
    expect(body).toContain("delivered: boolean");
    expect(body).toContain("queued: boolean");
  });

  it("主进程两个位置参数都读（新旧产物错位共存时 create 不能丢）", () => {
    const start = MAIN.indexOf('ipcMain.handle(\n    "window-send-to"');
    expect(start).toBeGreaterThan(-1);
    const body = MAIN.slice(start, start + 1600);
    expect(body).toContain("readWindowSendOptions(optionsOrRaise, extraOptions)");
    expect(body).not.toContain("readWindowSendOptions(options)");
  });

  it("on() 注册完立刻补投（消息先到、监听后挂的时序也不丢）", () => {
    const start = PRELOAD.indexOf("on: (event: string, handler");
    const body = PRELOAD.slice(start, start + 900);
    expect(body).toContain("eventHandlers");
    expect(body).toContain("flushPendingInbox()");
  });

  it("drain 在 load 后重试一次（首次可能早于窗口注册）", () => {
    expect(PRELOAD).toContain("drainedPending");
    expect(PRELOAD).toContain("'window-pending-drain'");
    expect(PRELOAD).toContain("if (raw === null) return");
  });
});

describe("关系窗口：走通用通道，失败要说出来", () => {
  it("用 sendTo(..., { create: true })，不再有专属通道", () => {
    expect(RELATION_SERVICE).toContain("api.sendTo(");
    expect(RELATION_SERVICE).toContain('"rel-open-entity"');
    expect(RELATION_SERVICE).toContain("create: true");
    expect(RELATION_SERVICE).not.toContain("openEntityInNovel");
  });

  it("delivered / queued 任一为真都算送到（排队 = 窗口起来就投）", () => {
    expect(RELATION_SERVICE).toContain("result?.delivered || result?.queued");
  });

  it("真失败时有可见提示（点了没反应是最糟的失败）", () => {
    const app = read("src/windows/RelationWindow/App.tsx");
    expect(app).toContain("主窗口没能打开");
  });
});

describe("主窗口：判定只此一处，确认前不切书（状态机在 useEntityJumpStore）", () => {
  it("窗口根是唯一监听者且只注册一次，判定收口在 store 状态机", () => {
    expect(NOVEL_APP).toContain('api.on("rel-open-entity", handler)');
    // 判定经 zustand store：组件里不再有散落的 ref / 闭包判定
    expect(NOVEL_APP).toContain("handoff(payload)");
    expect(JUMP_STORE).toContain("resolveEntityJumpAction");
    expect(JUMP_STORE).toContain('if (action === "shelf")');
  });

  it("confirm 分支只挂起，不先切书（顺序 bug 的根因）", () => {
    const start = JUMP_STORE.indexOf('if (action === "confirm")');
    expect(start).toBeGreaterThan(-1);
    const body = JUMP_STORE.slice(start, JUMP_STORE.indexOf("if (!bridge) return;", start));
    expect(body).toContain("pending: payload");
    expect(body).not.toContain("switchWork");
    expect(body).not.toContain("openEntity");
    expect(body).not.toContain("openWork");
  });

  it("句柄缺席只挂起，不再兜底「直接切过去」（先切书再弹窗的第二条来源）", () => {
    const start = JUMP_STORE.indexOf('if (action === "defer")');
    expect(start).toBeGreaterThan(-1);
    const body = JUMP_STORE.slice(start, JUMP_STORE.indexOf('if (action === "shelf")', start));
    expect(body).toContain("deferred: payload");
    expect(body).not.toContain("openWork");
    expect(body).not.toContain("switchWork");
    // 句柄就绪必须立即重判 + 300ms 兜底重试，否则 defer 等于丢消息
    expect(JUMP_STORE).toContain("if (bridge && get().deferred) get().retryDeferred();");
    expect(NOVEL_APP).toContain("setInterval(() => retryDeferred(), 300)");
  });

  it("数据未就绪不许判定：空 id 不能当「空态直开」（第三条静默切书通道）", () => {
    const jump = read("src/windows/NovelWindow/utils/entity-jump.ts");
    expect(jump).toContain("editorReady");
    expect(jump).toContain('if (!input.hasBridge || !input.editorReady) return "defer";');
    // 句柄必须暴露就绪信号，且随 loading 翻转重新登记（否则 defer 永远等不到重判）
    expect(NOVEL_PAGE).toContain("ready: () => !data.loading");
    expect(NOVEL_PAGE).toContain("data.loading,");
  });

  it("窗口是刚被这条跳转拉起来的：不直切，先恢复编辑器再按真实上一本书重判", () => {
    const start = JUMP_STORE.indexOf('if (action === "shelf")');
    expect(start).toBeGreaterThan(-1);
    const body = JUMP_STORE.slice(start, JUMP_STORE.indexOf('if (action === "confirm")', start));
    expect(body).toContain("!state.editorMounted");
    expect(body).toContain("deferred: payload");
    // 直切（openWork）只允许发生在「编辑器真的挂载过」的书架态
    expect(body).toContain("state.openWork(payload.workId");
  });

  it("同一条消息重复投递不会做第二遍（收件箱补投 + 实时投递）", () => {
    expect(JUMP_STORE).toContain("ENTITY_JUMP_REPLAY_MS");
    expect(JUMP_STORE).toContain("lastKey");
  });

  it("确认后先保存、再切书、最后开卡（保存失败就 return）", () => {
    const start = JUMP_STORE.indexOf("confirmEntityJump: async");
    expect(start).toBeGreaterThan(-1);
    const body = JUMP_STORE.slice(start, start + 900);
    const save = body.indexOf("flushSave");
    const switchAt = body.indexOf("switchWork");
    const openAt = body.indexOf("openEntity");
    expect(save).toBeGreaterThan(-1);
    expect(save).toBeLessThan(switchAt);
    expect(switchAt).toBeLessThan(openAt);
    expect(body).toContain("return;");
  });

  it("回到书架同步作废挂起 / 待确认的跳转（「返回书架却切书」的根因）", () => {
    const start = JUMP_STORE.indexOf("backToShelf: () => {");
    expect(start).toBeGreaterThan(-1);
    const body = JUMP_STORE.slice(start, JUMP_STORE.indexOf("goToView: (target)", start));
    expect(body).toContain('view: "shelf"');
    expect(body).toContain("pending: null");
    expect(body).toContain("deferred: null");
  });

  it("编辑器页不再自己监听（双监听会先切书再弹窗），只交出能力句柄", () => {
    expect(NOVEL_PAGE).not.toContain('api.on("rel-open-entity"');
    expect(NOVEL_PAGE).toContain("onEditorBridge");
    // activeWorkId 必须是 getter，不能是快照
    expect(NOVEL_PAGE).toContain("activeWorkId: () => data.activeWorkId");
  });

  it("确认框由窗口根的状态驱动：两个按钮就是「取消 / 保存后跳转」", () => {
    expect(NOVEL_PAGE).toContain('cancelText="取消"');
    expect(NOVEL_PAGE).toContain('okText="保存后跳转"');
    expect(NOVEL_PAGE).toContain("open={entityJump !== null}");
    expect(NOVEL_APP).toContain("entityJump={pendingJump}");
  });

  it("落点判定走纯函数（书架 / 同书 / 异书三分支各一条用例）", () => {
    expect(NOVEL_APP).toContain("readEntityOpenPayload");
    expect(read("src/windows/NovelWindow/utils/entity-jump.test.ts")).toContain('"confirm"');
  });
});
