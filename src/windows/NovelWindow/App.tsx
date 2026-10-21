import { useCallback, useEffect } from "react";
import {
  BookOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Badge, Button, Tooltip } from "antd";
import HelpCenter from "@/shared/components/HelpCenter";
import WindowHeader from "@/shared/components/WindowHeader";
import { HELP_COPY } from "@/shared/novel/guide-copy";
import { NOVEL_HELP_DOC } from "@/shared/novel/guide-doc";
import { IS_NOVEL_EDITION } from "@/shared/edition";
import { matchKeyEvent, useShortcutBindings } from "@/shared/shortcuts";
// 根级样式由 main.tsx 引入（两者都引会重复插入同一份 CSS）
import BookshelfPage from "./pages/BookshelfPage/BookshelfPage";
import NovelPage from "./pages/NovelPage/NovelPage";
import { selectHelpBadgeVisible, useGuideStore } from "./store/useGuideStore";
import { useEntityJumpStore } from "./store/useEntityJumpStore";
import { readEntityOpenPayload } from "./utils/entity-jump";

/**
 * NovelWindow —— CheckIn 小说窗口
 *
 * 双视图：书架主页（默认）↔ 编辑器。编辑器懒挂载——首次进入才 mount，
 * 之后常驻并用 display 切换显隐，保住未落库的键入内容（崩溃恢复另由
 * 会话标记驱动）。打开作品经 OpenWorkRequest（幂等 token）传递，由
 * NovelPage 消费后回调置空。
 *
 * 窗口形态随构建版本分叉（见 electron/edition.ts）：
 * - full 版：即关即销的子窗口，从主窗口侧边栏入口唤起
 * - novel 版：主窗口，登录后唤起、关闭进托盘；标题栏带设置入口
 *   （SettingsWindow 承载外观 / 账号等全局设置）
 *
 * 注意：PRD §2「零打断原则」明确移除了 Esc 关窗——编辑场景 Esc 属高频误触，
 * Esc 现在只用于退出专注模式（实现在 useNovelShortcuts）。
 */

/** novel 版主窗标题栏的设置入口：发起打开 SettingsWindow 请求（即关即销） */
function SettingsEntryButton() {
  return (
    <Tooltip title="设置" placement="bottom">
      <Button
        className="novel-window-header-btn"
        aria-label="设置"
        onClick={() => window.electronAPI?.send("settings-window-open", null)}
      >
        <SettingOutlined />
      </Button>
    </Tooltip>
  );
}

/**
 * 帮助入口（L3 常驻）：标题栏「？」，带未看完引导的红点（B-01）
 *
 * 红点是「引导是一次性的，帮助是长期的」的落点：Tour 关掉后功能仍需找得到，
 * 红点负责把跳过的作者拉回帮助中心。
 */
function HelpEntryButton() {
  const badgeVisible = useGuideStore(selectHelpBadgeVisible);
  const openHelp = useGuideStore((state) => state.openHelp);
  return (
    <Badge dot={badgeVisible}>
      <Tooltip title={HELP_COPY.badgeTip} placement="bottom">
        <Button
          className="novel-window-header-btn"
          aria-label={HELP_COPY.badgeTip}
          onClick={openHelp}
        >
          <QuestionCircleOutlined />
        </Button>
      </Tooltip>
    </Badge>
  );
}

export default function NovelWindowApp() {
  // 视图与跳转状态机收口在 store（见 store/useEntityJumpStore.ts）：
  // IPC 监听只注册一次，判定永远读 store 的当下状态，没有过期闭包
  const view = useEntityJumpStore((s) => s.view);
  const editorMounted = useEntityJumpStore((s) => s.editorMounted);
  const openRequest = useEntityJumpStore((s) => s.openRequest);
  const importRequest = useEntityJumpStore((s) => s.importRequest);
  const openWork = useEntityJumpStore((s) => s.openWork);
  const consumeOpenRequest = useEntityJumpStore((s) => s.consumeOpenRequest);
  const backToShelf = useEntityJumpStore((s) => s.backToShelf);
  const goToView = useEntityJumpStore((s) => s.goToView);
  const requestImport = useEntityJumpStore((s) => s.requestImport);
  const consumeImportRequest = useEntityJumpStore((s) => s.consumeImportRequest);
  const setBridge = useEntityJumpStore((s) => s.setBridge);
  const pendingJump = useEntityJumpStore((s) => s.pending);
  const jumpSaving = useEntityJumpStore((s) => s.saving);
  const deferredJump = useEntityJumpStore((s) => s.deferred);
  const handoff = useEntityJumpStore((s) => s.handoff);
  const retryDeferred = useEntityJumpStore((s) => s.retryDeferred);
  const confirmEntityJump = useEntityJumpStore((s) => s.confirmEntityJump);
  const cancelEntityJump = useEntityJumpStore((s) => s.cancelEntityJump);

  // ── 关系图 → 「在主窗口打开资料卡」（R27 / S6）──
  // 落点判定都在 store 的状态机里：书架直切（编辑器挂载过）/ 新窗口先恢复
  // 编辑器再重判 / 同书直开卡 / 异书只弹确认框 / 句柄缺席挂起重试。
  useEffect(() => {
    const api = window.electronAPI?.windowAPI;
    if (!api) return undefined;
    const handler = (...args: unknown[]): void => {
      const payload = readEntityOpenPayload(args[0]);
      if (!payload) return;
      handoff(payload);
    };
    // **只注册一次**：此前监听随 view 反复摘挂，「off 与 on 之间」到达的
    // 消息会被静默丢掉 —— 表现为「只唤起窗口，什么都不发生」。
    api.on("rel-open-entity", handler);
    return () => api.off("rel-open-entity", handler);
  }, [handoff]);

  /**
   * defer 的兜底重试。
   *
   * 挂起的跳转靠「句柄 / 视图变化」触发重判，但稳定态下这些依赖不再变化
   * （比如句柄恰好在一次 effect 清理的空窗里被摘走）—— 消息会永远卡住，
   * 表现为「只唤起窗口，不切书也不弹窗」。挂起期间每 300ms 重判一次：
   * 还没就绪就继续挂，能判定就消费掉（store 里 deferred 归零即停）。
   */
  useEffect(() => {
    if (view !== "editor" || !deferredJump) return undefined;
    const timer = window.setInterval(() => retryDeferred(), 300);
    return () => window.clearInterval(timer);
  }, [view, deferredJump, retryDeferred]);

  // ── 新手引导与帮助中心（L1/L3 编排在这一层：它要同时看见两个视图）──
  const hydrateGuide = useGuideStore((state) => state.hydrate);
  const helpOpen = useGuideStore((state) => state.helpOpen);
  const openHelp = useGuideStore((state) => state.openHelp);
  const closeHelp = useGuideStore((state) => state.closeHelp);
  const replayGuide = useGuideStore((state) => state.replay);
  const guideDone = useGuideStore((state) => state.record.state === "done");
  const guideHydrated = useGuideStore((state) => state.hydrated);
  const startGuide = useGuideStore((state) => state.start);

  // 首次读取引导状态：必须在渲染 Tour 之前完成，否则会拿默认记录误判为未开始
  useEffect(() => {
    void hydrateGuide();
  }, [hydrateGuide]);

  // F1 打开了帮助中心（挂在窗口层：书架页与编辑器页都要能唤出）。
  // 键位来自共享注册表，用户在设置窗口改过之后这里即刻跟随。
  const bindings = useShortcutBindings();
  const helpKeys = bindings.help ?? "F1";
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (!matchKeyEvent(event, helpKeys)) return;
      event.preventDefault();
      openHelp();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [openHelp, helpKeys]);

  /**
   * 引导启动收口在这一层：只有它同时知道「当前是哪个视图」。
   * 第 1 步属书架页、第 2-5 步属编辑器页，两个 Tour 实例各自只渲染属于自己的那一步，
   * 跨视图时由上一步的 Tour 结束、下一步的 Tour 接管（目标不可见会自动暂停等待，
   * 视图重新可见时由这里的 start() 改拍续播）。
   */
  useEffect(() => {
    if (!guideHydrated) return;
    startGuide(view === "editor" ? 2 : 1);
  }, [guideHydrated, view, startGuide]);

  /** 重看引导：按当前视图定位起始步（在编辑器里重看不该跳回书架第 1 步） */
  const handleReplayGuide = useCallback(() => {
    replayGuide(view === "editor" ? 2 : 1);
  }, [replayGuide, view]);

  // 编辑器从 display:none 恢复可见后派发 resize，让 CodeMirror 按新视口重测量
  useEffect(() => {
    if (view !== "editor") return;
    const raf = requestAnimationFrame(() => {
      window.dispatchEvent(new Event("resize"));
    });
    return () => cancelAnimationFrame(raf);
  }, [view]);

  return (
    <AntdApp className="novel-app-root">
      <div className="window-shell">
        <WindowHeader
          title="Novel 随笔"
          icon={<BookOutlined />}
          badge={view === "shelf" ? <span className="novel-badge">书架</span> : null}
          actions={
            <>
              <HelpEntryButton />
              {IS_NOVEL_EDITION ? <SettingsEntryButton /> : null}
            </>
          }
        />
        <div className="window-shell__body">
          <div className="novel-views">
            <div
              className={`novel-view${view === "shelf" ? "" : " is-hidden"}`}
              aria-hidden={view !== "shelf"}
            >
              <BookshelfPage
                visible={view === "shelf"}
                onOpenWork={openWork}
                importRequest={importRequest}
                onImportRequestConsumed={consumeImportRequest}
              />
            </div>
            {editorMounted && (
              <div
                className={`novel-view${view === "editor" ? "" : " is-hidden"}`}
                aria-hidden={view !== "editor"}
              >
                <NovelPage
                  openRequest={openRequest}
                  onOpenRequestConsumed={consumeOpenRequest}
                  onBackToShelf={backToShelf}
                  onImportBook={requestImport}
                  visible={view === "editor"}
                  onGoToView={goToView}
                  onEditorBridge={setBridge}
                  entityJump={pendingJump}
                  entityJumpSaving={jumpSaving}
                  onConfirmEntityJump={() => void confirmEntityJump()}
                  onCancelEntityJump={cancelEntityJump}
                />
              </div>
            )}
          </div>
        </div>
      </div>
      <HelpCenter
        open={helpOpen}
        doc={NOVEL_HELP_DOC}
        onClose={closeHelp}
        onReplayGuide={handleReplayGuide}
        guideDone={guideDone}
      />
    </AntdApp>
  );
}
